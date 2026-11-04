// api/src/services/pharma-po-reply-poller.service.ts  (full file, replaces the earlier version)
// Reads supplier replies to Purchase Orders AND Purchase Returns from the same IMAP mailbox.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const DOC_NUMBER = /(PO|PRT)-\d{4}-\d{4,}/i;
const LOOKBACK_DAYS = 7;

function stripQuotedTail(text: string): string {
  const markers = [/\r?\n\s*On .+wrote:\s*$/im, /\r?\n\s*-{2,}\s*Original Message\s*-{2,}/im, /\r?\n>.*$/s];
  let out = text;
  for (const m of markers) { const i = out.search(m); if (i > 0) out = out.slice(0, i); }
  return out.trim();
}

type DocRow = { id: string; supplier_mail_status?: string; supplier_mailed_at?: string | null; supplier_replied_at?: string | null; po_number?: string; return_number?: string; pharma_suppliers?: { email?: string | null } | { email?: string | null }[] | null };
type Outcome = 'updated' | 'not-a-po-mail' | 'own-outgoing' | 'no-matching-po' | 'older-than-send' | 'already-filed' | 'save-failed';

async function processMessage(uid: number, client: ImapFlow): Promise<Outcome> {
  const download = await client.download(String(uid), undefined, { uid: true });
  if (!download?.content) return 'not-a-po-mail'; // message vanished or could not be read: skip it instead of crashing the poll
  const parsed = await simpleParser(download.content);
  const subject = parsed.subject ?? '';
  const body = stripQuotedTail(parsed.text ?? '');
  const docNumber = (subject.match(DOC_NUMBER)?.[0] ?? (parsed.text ?? '').match(DOC_NUMBER)?.[0])?.toUpperCase();
  if (!docNumber) return 'not-a-po-mail';
  const isReturn = docNumber.startsWith('PRT-');
  const table = isReturn ? 'pharma_purchase_returns' : 'pharma_purchase_orders';
  const numberCol = isReturn ? 'return_number' : 'po_number';

  const sender = parsed.from?.value?.[0]?.address?.toLowerCase() ?? '';
  const own = [env.SUPPLIER_REPLY_IMAP_USER, env.SMTP_USER, env.MAIL_FROM].filter(Boolean).map((a) => String(a).toLowerCase());
  const isReply = Boolean(parsed.inReplyTo) || /^\s*re:/i.test(subject);
  if (sender && !isReply && own.includes(sender)) return 'own-outgoing';

  const { data, error } = await supabaseAdmin
    .from(table)
    .select(`id, ${numberCol}, supplier_mail_status, supplier_mailed_at, supplier_replied_at, pharma_suppliers(email)`)
    .eq(numberCol, docNumber)
    .in('supplier_mail_status', ['Sent', 'Replied'])
    .order('supplier_mailed_at', { ascending: false });
  if (error) { logger.error({ err: error, docNumber }, 'Supplier reply lookup failed'); return 'save-failed'; }
  const rows = (data ?? []) as unknown as DocRow[];
  const emailOf = (r: DocRow) => String((Array.isArray(r.pharma_suppliers) ? r.pharma_suppliers[0] : r.pharma_suppliers)?.email ?? '').toLowerCase();
  const po = rows.find((r) => emailOf(r) === sender) ?? (rows.length === 1 ? rows[0] : null);
  if (!po) { logger.warn({ docNumber, sender }, 'Supplier reply did not match a sent document'); return 'no-matching-po'; }

  const when = parsed.date ?? new Date();
  // 60 s of slack so a reply sent right after the mail is never treated as "older"
  if (po.supplier_mailed_at && when.getTime() < new Date(po.supplier_mailed_at).getTime() - 60_000) return 'older-than-send';
  if (po.supplier_replied_at && when <= new Date(po.supplier_replied_at)) return 'already-filed';

  const { error: upErr } = await supabaseAdmin.from(table).update({
    supplier_mail_status: 'Replied',
    supplier_replied_at: when.toISOString(),
    supplier_reply_from: parsed.from?.text ?? sender,
    supplier_reply_text: (body || '(no readable text - open the original email)').slice(0, 4000),
    supplier_reply_message_id: parsed.messageId ?? null,
  }).eq('id', po.id);
  if (upErr) { logger.error({ err: upErr, docNumber }, 'Failed to save supplier reply'); return 'save-failed'; }
  logger.info({ docNumber }, 'Supplier reply filed');
  return 'updated';
}

export type PoPollResult = { configured: boolean; candidates: number; updated: number; skipped: string[]; error?: string };

const isConfigured = () => Boolean(env.SUPPLIER_REPLY_IMAP_HOST && env.SUPPLIER_REPLY_IMAP_USER && env.SUPPLIER_REPLY_IMAP_PASS);
let running = false;

async function pollOnce(): Promise<PoPollResult> {
  const result: PoPollResult = { configured: isConfigured(), candidates: 0, updated: 0, skipped: [] };
  if (!result.configured) return result;
  if (running) { result.skipped.push('a check is already running'); return result; }
  running = true;
  const client = new ImapFlow({
    host: env.SUPPLIER_REPLY_IMAP_HOST!, port: env.SUPPLIER_REPLY_IMAP_PORT,
    secure: env.SUPPLIER_REPLY_IMAP_PORT === 993,
    auth: { user: env.SUPPLIER_REPLY_IMAP_USER!, pass: env.SUPPLIER_REPLY_IMAP_PASS! }, logger: false,
  });
  client.on('error', (err) => logger.error({ err }, 'IMAP error during supplier reply poll'));
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
      const found = new Set<number>();
      for (const subject of ['Purchase order', 'Purchase return']) {
        for (const uid of (await client.search({ since, subject }, { uid: true })) || []) found.add(uid);
      }
      const uids = [...found];
      result.candidates = uids.length;
      const counts: Record<string, number> = {};
      for (const uid of uids) {
        try {
          const o = await processMessage(uid, client);
          if (o === 'updated') result.updated += 1; else counts[o] = (counts[o] ?? 0) + 1;
        } catch (err) { logger.error({ err, uid }, 'Supplier reply email failed'); counts['error'] = (counts['error'] ?? 0) + 1; }
      }
      result.skipped = Object.entries(counts).map(([k, v]) => `${v} ${k.replace(/-/g, ' ')}`);
      logger.info({ candidates: result.candidates, updated: result.updated, skipped: counts }, 'Supplier reply poll finished');
    } finally { lock.release(); }
  } catch (err: unknown) {
    const e = err as { responseText?: string; message?: string } | null;
    result.error = String(e?.responseText || e?.message || err);
    logger.error({ err }, 'Supplier reply IMAP poll failed');
  } finally { running = false; try { await client.logout(); } catch { /* already closed */ } }
  return result;
}

/** Used by the "Check replies now" button. */
export const checkPoRepliesNow = () => pollOnce();

let timer: NodeJS.Timeout | null = null;
export function startPoReplyPolling(): void {
  if (!isConfigured()) { logger.warn('Reply polling NOT started: SUPPLIER_REPLY_IMAP_HOST / USER / PASS are missing in the API .env'); return; }
  if (timer) return;
  logger.info({ minutes: env.SUPPLIER_REPLY_POLL_MINUTES }, 'Starting purchase-order / purchase-return reply polling');
  void pollOnce();
  timer = setInterval(() => void pollOnce(), env.SUPPLIER_REPLY_POLL_MINUTES * 60_000);
}