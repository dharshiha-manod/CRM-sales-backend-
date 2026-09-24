// NEW — full file.
//
// Closes the loop that "Send to supplier" left open: an email went out,
// but nothing ever came back into the CRM. A supplier's reply always
// lands in the same mailbox that sent the enquiry (because the outgoing
// mail sets a normal Reply-To/From), so this polls that mailbox over
// IMAP, finds replies that reference a Purchase Enquiry, and:
//   1. Flips the enquiry's status to 'Supplier Responded' — but only if
//      it's still 'Sent', so a reply never drags an enquiry that's
//      already moved further (Negotiation, Approved, ...) backwards.
//   2. Appends the reply's sender + date + plain-text body into the
//      enquiry's Notes, newest first, so it's readable without leaving
//      the CRM — same "never overwrite, just add a dated entry" pattern
//      Currency Management uses for rate history.
//
// Deliberately does NOT try to parse a quoted rate out of the email body.
// Free-form supplier emails are far too inconsistent ("500000 INR",
// "5 lakh", "$6k CIF", quoted rate buried in a paragraph, or a
// reply-with-attachment) to extract reliably — a wrong auto-filled
// number is worse than no number, so that part stays a manual, deliberate
// step for a human reading the (now easy to find) reply text.
//
// Entirely opt-in: if SUPPLIER_REPLY_IMAP_HOST/USER/PASS aren't set in
// the environment, startSupplierReplyPolling() below simply does nothing
// and every other Purchase Enquiry behaviour is completely unaffected.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

// Matches "ENQ-2026-0001" wherever it appears in a subject or body —
// this is the same autoGenerate prefix TradingPurchaseEnquiryPage.tsx
// uses for enquiry_number, and the sent email's subject is literally
// `Purchase Enquiry ${enquiry.enquiry_number} from ${companyName}`, so a
// plain reply ("Re: Purchase Enquiry ENQ-2026-0001 from ...") always
// carries it straight through.
const ENQUIRY_NUMBER_PATTERN = /ENQ-\d{4}-\d{4,}/i;

function extractEnquiryNumber(subject: string | undefined, text: string | undefined): string | null {
  const fromSubject = subject?.match(ENQUIRY_NUMBER_PATTERN)?.[0];
  if (fromSubject) return fromSubject.toUpperCase();
  const fromBody = text?.match(ENQUIRY_NUMBER_PATTERN)?.[0];
  return fromBody ? fromBody.toUpperCase() : null;
}

/** Trims a reply down to just the new text, dropping the quoted "On ... wrote:" trail most mail clients append. */
function stripQuotedReplyTail(text: string): string {
  const markers = [/\r?\n\s*On .+wrote:\s*$/im, /\r?\n\s*-{2,}\s*Original Message\s*-{2,}/im, /\r?\n>.*$/s];
  let out = text;
  for (const marker of markers) {
    const idx = out.search(marker);
    if (idx > 0) out = out.slice(0, idx);
  }
  return out.trim();
}

async function processMessage(uid: number, client: ImapFlow, org: string | null): Promise<void> {
  const { content } = await client.download(String(uid), undefined, { uid: true });
  const parsed = await simpleParser(content);
  const subject = parsed.subject ?? '';
  const bodyText = stripQuotedReplyTail(parsed.text ?? '');
  const enquiryNumber = extractEnquiryNumber(subject, bodyText);
  if (!enquiryNumber) return; // not a reply to a Purchase Enquiry — leave it alone

  // No organization_id filter here: this mailbox is configured once per
  // deployment (one SUPPLIER_REPLY_IMAP_USER), so in practice it only
  // ever sees replies for whichever organization(s) share that inbox. If
  // you run one mailbox across multiple organizations in the same
  // database, narrow this with .eq('organization_id', org) once you have
  // a reliable way to know which org a given mailbox belongs to.
  const query = supabaseAdmin.from('trading_purchase_enquiries').select('id, status, notes, supplier_name').eq('enquiry_number', enquiryNumber).limit(1);
  const { data: enquiry, error } = org ? await query.eq('organization_id', org).maybeSingle() : await query.maybeSingle();
  if (error) { logger.error({ err: error, enquiryNumber }, 'Failed to look up enquiry for supplier reply'); return; }
  if (!enquiry) { logger.warn({ enquiryNumber }, 'Supplier reply referenced an enquiry number that was not found'); return; }

  const from = parsed.from?.text ?? 'unknown sender';
  const when = (parsed.date ?? new Date()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const entry = `--- Supplier reply received ${when} from ${from} ---\n${bodyText || '(no readable text body — see the original email)'}`;
  const nextNotes = [entry, enquiry.notes].filter(Boolean).join('\n\n');

  const patch: Record<string, unknown> = { notes: nextNotes };
  if (enquiry.status === 'Sent') patch.status = 'Supplier Responded';

  const { error: updateError } = await supabaseAdmin.from('trading_purchase_enquiries').update(patch).eq('id', enquiry.id);
  if (updateError) { logger.error({ err: updateError, enquiryNumber }, 'Failed to save supplier reply onto enquiry'); return; }
  logger.info({ enquiryNumber, statusChanged: patch.status === 'Supplier Responded' }, 'Supplier reply filed onto Purchase Enquiry');
}

async function pollOnce(): Promise<void> {
  const client = new ImapFlow({
    host: env.SUPPLIER_REPLY_IMAP_HOST!,
    port: env.SUPPLIER_REPLY_IMAP_PORT,
    secure: env.SUPPLIER_REPLY_IMAP_PORT === 993,
    auth: { user: env.SUPPLIER_REPLY_IMAP_USER!, pass: env.SUPPLIER_REPLY_IMAP_PASS! },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // \Seen is the marker of record for "already processed" — fetching a
      // message below flips it to seen automatically, which is what makes
      // the next poll's search naturally skip it. Simple, and it survives
      // an API restart with no extra table to keep in sync.
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of uids || []) {
        try {
          await processMessage(uid, client, null);
        } catch (err) {
          logger.error({ err, uid }, 'Failed to process a candidate supplier-reply email');
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    logger.error({ err }, 'Supplier-reply IMAP poll failed');
  } finally {
    try { await client.logout(); } catch { /* connection may already be closed */ }
  }
}

let pollTimer: NodeJS.Timeout | null = null;

/** Call once at server startup. No-op unless the IMAP env vars are set. */
export function startSupplierReplyPolling(): void {
  if (!env.SUPPLIER_REPLY_IMAP_HOST || !env.SUPPLIER_REPLY_IMAP_USER || !env.SUPPLIER_REPLY_IMAP_PASS) {
    logger.info('Supplier-reply IMAP polling not configured — Purchase Enquiry replies stay manual.');
    return;
  }
  if (pollTimer) return; // already running
  const intervalMs = env.SUPPLIER_REPLY_POLL_MINUTES * 60_000;
  logger.info({ minutes: env.SUPPLIER_REPLY_POLL_MINUTES }, 'Starting supplier-reply IMAP polling');
  void pollOnce();
  pollTimer = setInterval(() => void pollOnce(), intervalMs);
}

export function stopSupplierReplyPolling(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}