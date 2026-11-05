// Customer messages for the Vehicle industry. Messages are queued in vehicle_notifications (once per key) and sent by
// e-mail through the existing SMTP settings, and to WhatsApp / SMS through an optional webhook:
//   VEHICLE_NOTIFY_WEBHOOK_URL   POST { to, email, subject, body, kind } (your WhatsApp / SMS gateway or a Zapier / n8n hook)
//   VEHICLE_NOTIFY_WEBHOOK_TOKEN optional, sent as "Authorization: Bearer <token>"
// With neither SMTP nor webhook configured, messages simply stay queued. Nothing here can break a save.
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { supabaseAdmin } from './supabase.js';

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export async function enqueueCustomerMessage(org: string, ind: string | null, m: { key: string; kind: string; clientId: unknown; subject: string; body: string }): Promise<void> {
  try {
    if (!m.clientId) return;
    const { error } = await supabaseAdmin.from('vehicle_notifications').insert({ organization_id: org, industry_type_id: ind, key: m.key, kind: m.kind, client_id: m.clientId, subject: m.subject, body: m.body });
    if (error && error.code !== '23505') throw error;
  } catch (err) { logger.warn({ err, key: m.key }, 'vehicle-notify: could not queue the message'); }
}

const smtpReady = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM);
const webhookUrl = () => process.env.VEHICLE_NOTIFY_WEBHOOK_URL || '';

export async function processCustomerMessages(org: string, limit = 40): Promise<{ sent: number; failed: number; noContact: number }> {
  const out = { sent: 0, failed: 0, noContact: 0 };
  if (!smtpReady() && !webhookUrl()) return out; // nothing to send with: keep them queued
  try {
    const { data } = await supabaseAdmin.from('vehicle_notifications').select('*').eq('organization_id', org).eq('status', 'queued').order('created_at', { ascending: true }).limit(limit);
    const transport = smtpReady() ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }) : null;
    for (const n of (data ?? []) as Row[]) {
      const { data: client } = await supabaseAdmin.from('clients').select('client_name, email, phone').eq('organization_id', org).eq('id', n.client_id as string).maybeSingle();
      const c = (client ?? {}) as Row;
      const email = str(c.email).trim(), phone = str(c.phone).trim();
      const channels: string[] = []; let error = '';
      if (email && transport) {
        try { await transport.sendMail({ from: env.MAIL_FROM, to: email, subject: str(n.subject), text: str(n.body) }); channels.push('email'); } catch (e) { error = e instanceof Error ? e.message : 'email failed'; }
      }
      if ((phone || email) && webhookUrl()) {
        try {
          const res = await fetch(webhookUrl(), { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.VEHICLE_NOTIFY_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.VEHICLE_NOTIFY_WEBHOOK_TOKEN}` } : {}) }, body: JSON.stringify({ to: phone, email, name: str(c.client_name), subject: str(n.subject), body: str(n.body), kind: n.kind }) });
          if (!res.ok) throw new Error(`webhook ${res.status}`);
          channels.push('webhook');
        } catch (e) { error = e instanceof Error ? e.message : 'webhook failed'; }
      }
      const attempts = Number(n.attempts ?? 0) + 1;
      let patch: Row;
      if (channels.length) { patch = { status: 'sent', channels: channels.join(','), attempts, sent_at: new Date().toISOString(), error: null }; out.sent += 1; }
      else if (!email && !phone) { patch = { status: 'no_contact', attempts, error: 'Client has no email or phone.' }; out.noContact += 1; }
      else { patch = { status: attempts >= 3 ? 'failed' : 'queued', attempts, error: error || 'No channel could send this message.' }; if (attempts >= 3) out.failed += 1; }
      await supabaseAdmin.from('vehicle_notifications').update(patch).eq('id', n.id as string);
    }
  } catch (err) { logger.error({ err }, 'vehicle-notify: processing failed'); }
  return out;
}
