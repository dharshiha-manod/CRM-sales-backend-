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
import { promoteEnquiriesToComparison } from './purchase-enquiry-comparison.service.js';

// Matches "ENQ-2026-0001" wherever it appears in a subject or body —
// this is the same autoGenerate prefix TradingPurchaseEnquiryPage.tsx
// uses for enquiry_number, and the sent email's subject is literally
// `Purchase Enquiry ${enquiry.enquiry_number} from ${companyName}`, so a
// plain reply ("Re: Purchase Enquiry ENQ-2026-0001 from ...") always
// carries it straight through.
const ENQUIRY_NUMBER_PATTERN = /ENQ-\d{4}-\d{4,}/i;

// How far back each poll looks for replies. Replies are matched whether or not
// they were already opened in Gmail (a person reading the inbox marks mail as
// \Seen, which used to make the poller skip it forever). Duplicates are
// prevented by the Message-ID stored in the enquiry's Notes instead.
const LOOKBACK_DAYS = 7;

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

// Reads the labelled lines from the email's quote form ("Quoted rate: 500").
// Only exact labels are read, so a free-text reply is never guessed at.
function parseQuoteFromReply(text: string) {
  const line = (label: string) => text.match(new RegExp(`^[ \\t]*${label}[ \\t]*[:=][ \\t]*(.+)$`, 'im'))?.[1]?.trim() ?? '';
  const num = (label: string) => {
    const n = Number(line(label).replace(/,/g, '').match(/\d+(\.\d+)?/)?.[0]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const currency = line('Currency').match(/\b[A-Za-z]{3}\b/)?.[0]?.toUpperCase() ?? '';
  return {
    requested_rate: num('Quoted rate'),
       discount_percent: num('Discount %'),
    discount_amount: num('Discount amount'),
    tax_percent: num('Tax %'),
    currency,
    delivery_terms: line('Delivery terms'),
    payment_terms: line('Payment terms'),
  };
}

async function processMessage(uid: number, client: ImapFlow, org: string | null): Promise<void> {
  const { content } = await client.download(String(uid), undefined, { uid: true });
  const parsed = await simpleParser(content);
  const subject = parsed.subject ?? '';
  const bodyText = stripQuotedReplyTail(parsed.text ?? '');
  const enquiryNumber = extractEnquiryNumber(subject, bodyText);
  if (!enquiryNumber) return; // not a reply to a Purchase Enquiry — leave it alone

  // Ignore mail sent FROM this mailbox (e.g. our own outgoing enquiry) — only
  // supplier replies should be filed.
  const senderAddress = parsed.from?.value?.[0]?.address?.toLowerCase();
  const ownAddresses = [env.SUPPLIER_REPLY_IMAP_USER, env.SMTP_USER, env.MAIL_FROM].filter(Boolean).map((a) => String(a).toLowerCase());
  // Skip our own outgoing enquiry, but not a reply that merely comes from the same mailbox
  // (e.g. when a supplier's saved email is the company mailbox, as in testing).
  const isReply = Boolean(parsed.inReplyTo) || /^\s*re:/i.test(subject);
  if (senderAddress && !isReply && ownAddresses.some((own) => own === senderAddress || own.includes(`<${senderAddress}>`))) return;     
  const messageRef = parsed.messageId ?? `${senderAddress ?? 'unknown'}|${parsed.date?.toISOString() ?? ''}`;

  // No organization_id filter here: this mailbox is configured once per
  // deployment (one SUPPLIER_REPLY_IMAP_USER), so in practice it only
  // ever sees replies for whichever organization(s) share that inbox. If
  // you run one mailbox across multiple organizations in the same
  // database, narrow this with .eq('organization_id', org) once you have
  // a reliable way to know which org a given mailbox belongs to.
  const query = supabaseAdmin.from('trading_purchase_enquiries').select('*').eq('enquiry_number', enquiryNumber).limit(1);
  const { data: enquiry, error } = org ? await query.eq('organization_id', org).maybeSingle() : await query.maybeSingle();
  if (error) { logger.error({ err: error, enquiryNumber }, 'Failed to look up enquiry for supplier reply'); return; }
  if (!enquiry) { logger.warn({ enquiryNumber }, 'Supplier reply referenced an enquiry number that was not found'); return; }

  // Already filed on an earlier poll (same Message-ID is stored in the Notes).
  if (enquiry.notes && String(enquiry.notes).includes(messageRef)) return;
  // A reply older than this enquiry belongs to an earlier enquiry that reused
  // the same number (e.g. a deleted test record), not to this one.
  const createdAt = enquiry.created_at ? new Date(String(enquiry.created_at)) : null;
  if (createdAt && parsed.date && parsed.date < createdAt) return;

  const from = parsed.from?.text ?? 'unknown sender';
  const when = (parsed.date ?? new Date()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const entry = `--- Supplier reply received ${when} from ${from} (ref ${messageRef}) ---\n${bodyText || '(no readable text body — see the original email)'}`;
  const nextNotes = [entry, enquiry.notes].filter(Boolean).join('\n\n');

  const patch: Record<string, unknown> = { notes: nextNotes };
  if (enquiry.status === 'Sent') patch.status = 'Supplier Responded';

    // The supplier's reply is the source of truth for what they quoted, so it replaces the
  // Price List defaults. Once the enquiry reaches Negotiation or later, it is left alone.
  const currentStatus = String(enquiry.status || 'Draft');
  if (['Draft', 'Sent', 'Supplier Responded', 'Under Comparison'].includes(currentStatus)) {
    const quote = parseQuoteFromReply(bodyText);
    if (quote.requested_rate !== null && quote.requested_rate > 0) patch.requested_rate = quote.requested_rate;
    if (quote.discount_percent !== null) {
      patch.discount_percent = quote.discount_percent;
    } else if (quote.discount_amount !== null && quote.discount_amount > 0) {
      // Supplier gave an amount: convert to % of (rate x quantity).
      const rate = Number(patch.requested_rate ?? enquiry.requested_rate);
      const gross = rate * Number(enquiry.quantity);
      if (gross > 0) patch.discount_percent = Math.round((quote.discount_amount / gross) * 10000) / 100;
    }
    if (quote.tax_percent !== null) patch.tax_percent = quote.tax_percent;
    if (quote.currency) patch.currency = quote.currency;
    if (quote.delivery_terms) patch.delivery_terms = quote.delivery_terms;
    if (quote.payment_terms) patch.payment_terms = quote.payment_terms;
  }

  const { error: updateError } = await supabaseAdmin.from('trading_purchase_enquiries').update(patch).eq('id', enquiry.id);
  if (updateError) { logger.error({ err: updateError, enquiryNumber }, 'Failed to save supplier reply onto enquiry'); return; }
  logger.info({ enquiryNumber, statusChanged: patch.status === 'Supplier Responded' }, 'Supplier reply filed onto Purchase Enquiry');
  // Two or more suppliers replied for this product -> ready to compare.
  if (patch.status === 'Supplier Responded') await promoteEnquiriesToComparison(String(enquiry.organization_id), enquiry as Record<string, unknown>);
}

async function pollOnce(): Promise<void> {
  const client = new ImapFlow({
    host: env.SUPPLIER_REPLY_IMAP_HOST!,
    port: env.SUPPLIER_REPLY_IMAP_PORT,
    secure: env.SUPPLIER_REPLY_IMAP_PORT === 993,
    auth: { user: env.SUPPLIER_REPLY_IMAP_USER!, pass: env.SUPPLIER_REPLY_IMAP_PASS! },
    logger: false,
  });
  // Without this, a dropped connection (e.g. Gmail closing an idle IMAP
  // session — ECONNRESET) is an unhandled 'error' event, which crashes
  // the whole Node process, not just this poll. Logging it here lets
  // the surrounding try/catch below handle the failure normally instead.
  client.on('error', (err) => {
    logger.error({ err }, 'IMAP connection error during supplier-reply poll');
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Not based on \Seen any more: opening a reply in Gmail marks it seen,
      // and the poller would then never file it. Instead every poll looks at
      // recent mail mentioning an enquiry number, and processMessage skips
      // ones already filed (Message-ID kept in the enquiry's Notes).
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since, subject: 'ENQ-' }, { uid: true });
      logger.info({ candidates: (uids || []).length }, 'Supplier-reply poll: checking emails that mention an enquiry number');
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