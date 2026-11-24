/* eslint-disable @typescript-eslint/no-explicit-any */
// Purchase order e-mail to the supplier, with automatic tracking.
//   Sent      -> the PO is e-mailed once (idempotent); the e-mail carries a private link.
//   Opened    -> the supplier's page reports "opened" (a JS ping, so mail scanners that only fetch the link do not count).
//   Confirmed / Declined -> the supplier answers on that page. A confirmed delivery date replaces the expected date.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { logger } from './logger.js';
import { supabaseAdmin } from './supabase.js';
import { bad, num, str, type Row } from './pharma-db.js';

const one = (v: any) => (Array.isArray(v) ? v[0] : v);
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const inr = (v: unknown) => `&#8377;${num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TOKEN_DAYS = 60;

export type PoMailResult = { emailed: boolean; to: string | null; reason: string | null; link: string | null };

function transport() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.MAIL_FROM) return null;
  return nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
}

async function companyOf(org: string, it: string): Promise<Row> {
  const { data } = await supabaseAdmin.from('school_company_profile').select('company_name, gstin, address, city, state, pincode, phone, email, terms').eq('organization_id', org).eq('industry_type_id', it).maybeSingle();
  return (data ?? {}) as Row;
}

function poHtml(po: Row, co: Row, supplierName: string, link: string): string {
  const lines = (po.lines ?? []) as Row[];
  const th = 'padding:10px 12px;background:#f1f5f9;color:#475569;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;border-bottom:1px solid #e2e8f0';
  const td = 'padding:11px 12px;border-bottom:1px solid #eef2f7;font-size:14px;color:#1f2937';
  const rows = lines.map((l) => `<tr><td style="${td}">${esc(l.product_name)}<div style="font-size:12px;color:#94a3b8">${esc(l.product_code)}</div></td><td align="right" style="${td}">${num(l.quantity)}</td><td align="right" style="${td}">${inr(l.rate)}</td><td align="right" style="${td}">${num(l.gst_percent)}%</td><td align="right" style="${td}">${inr(l.amount)}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 10px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e9ef;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937">
<tr><td style="background:#0f172a;padding:20px 26px"><span style="font-size:19px;font-weight:700;color:#fff">${esc(co.company_name || 'Purchase order')}</span><span style="float:right;color:#f59e0b;font-size:12px;font-weight:700;letter-spacing:1px">PURCHASE ORDER</span></td></tr>
<tr><td style="padding:26px 26px 6px"><h1 style="margin:0 0 6px;font-size:21px;color:#0f172a">${esc(po.po_number)}</h1>
<p style="margin:0 0 14px;font-size:14px;color:#334155">Dear ${esc(supplierName) || 'Sir / Madam'}, please supply the items below${po.expected_date ? ` by <b>${esc(String(po.expected_date).slice(0, 10))}</b>` : ''}. Open the order to confirm it and tell us your delivery date.</p></td></tr>
<tr><td style="padding:0 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;overflow:hidden"><thead><tr><th align="left" style="${th}">Item</th><th align="right" style="${th}">Qty</th><th align="right" style="${th}">Rate</th><th align="right" style="${th}">GST</th><th align="right" style="${th}">Amount</th></tr></thead><tbody>${rows}</tbody></table></td></tr>
<tr><td style="padding:12px 26px 0" align="right"><div style="font-size:14px;color:#64748b">Sub-total ${inr(po.subtotal)} &nbsp;·&nbsp; GST ${inr(po.tax_amount)}</div><div style="font-size:19px;font-weight:700;color:#0f172a;margin-top:4px">Total ${inr(po.total_amount)}</div></td></tr>
${po.notes ? `<tr><td style="padding:12px 26px 0;font-size:13px;color:#475569"><b>Notes:</b> ${esc(po.notes)}</td></tr>` : ''}
<tr><td align="center" style="padding:30px 26px 8px"><a href="${esc(link)}" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:700;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:8px">View &amp; confirm order</a></td></tr>
<tr><td align="center" style="padding:4px 26px 22px;font-size:12px;color:#94a3b8">Or copy this link: <a href="${esc(link)}" style="color:#64748b">${esc(link)}</a></td></tr>
<tr><td style="padding:18px 26px;background:#f8fafc;border-top:1px solid #e5e9ef;font-size:12px;line-height:1.6;color:#64748b"><b>${esc(co.company_name)}</b><br>${esc(co.address)} ${esc(co.city)} ${esc(co.state)} ${esc(co.pincode)}<br>${co.gstin ? `GSTIN ${esc(co.gstin)} · ` : ''}${esc(co.phone)} ${esc(co.email)}</td></tr>
</table></td></tr></table></body></html>`;
}

/** E-mails one PO to its supplier. Never throws for mail problems: it records them and returns the reason. */
export async function emailPurchaseOrder(org: string, it: string, poId: string, opts: { resend?: boolean } = {}): Promise<PoMailResult> {
  const { data, error } = await supabaseAdmin.from('school_purchase_orders').select('*, school_suppliers(supplier_name, email)').eq('organization_id', org).eq('industry_type_id', it).eq('id', poId).maybeSingle();
  if (error) throw error;
  const po = data as Row | null;
  if (!po) throw new AppError(404, 'RECORD_NOT_FOUND', 'Purchase order was not found.');
  if (!['Sent', 'Partially received'].includes(String(po.status))) throw bad('Mark the purchase order as Sent before e-mailing it to the supplier.');
  const supplier = one(po.school_suppliers) as Row | undefined;
  const to = str(supplier?.email);
  const base = env.PUBLIC_APP_URL?.replace(/\/$/, '');
  const link = po.public_token && base ? `${base}/po/${po.public_token}` : null;

  if (!opts.resend && po.mailed_at) return { emailed: false, to: str(po.supplier_email) || to || null, reason: 'Already e-mailed', link };
  const fail = async (reason: string): Promise<PoMailResult> => {
    await supabaseAdmin.from('school_purchase_orders').update({ mail_status: 'Failed', mail_error: reason.slice(0, 300), mailed_at: null }).eq('organization_id', org).eq('id', poId);
    return { emailed: false, to: to || null, reason, link };
  };
  if (!to) return fail(`${str(supplier?.supplier_name) || 'The supplier'} has no e-mail address. Add it in Suppliers / Publishers, then use Resend.`);
  if (!base) return fail('PUBLIC_APP_URL is not set in the API .env, so the order link cannot be created.');
  const mailer = transport();
  if (!mailer) return fail('E-mail is not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM to the API .env.');

  // Claim the send first so a double click or a retry can never e-mail the supplier twice.
  const token = str(po.public_token) || crypto.randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  if (!opts.resend) {
    const { data: claimed } = await supabaseAdmin.from('school_purchase_orders').update({ mailed_at: now }).eq('organization_id', org).eq('id', poId).is('mailed_at', null).select('id');
    if (!claimed?.length) return { emailed: false, to, reason: 'Already e-mailed', link: `${base}/po/${token}` };
  }
  const publicLink = `${base}/po/${token}`;
  const co = await companyOf(org, it);
  try {
    const result = await mailer.sendMail({
      from: env.MAIL_FROM, to, replyTo: str(co.email) || undefined, subject: `Purchase order ${po.po_number} from ${str(co.company_name) || 'us'}`,
      html: poHtml(po, co, str(supplier?.supplier_name), publicLink),
      text: `Purchase order ${po.po_number} from ${str(co.company_name)}. Total ${num(po.total_amount).toFixed(2)}. View and confirm: ${publicLink}`,
    });
    if (!result.accepted.map(String).includes(to)) throw new Error(`The mail server did not accept delivery to ${to}.`);
    await supabaseAdmin.from('school_purchase_orders').update({
      public_token: token, token_expires_at: new Date(Date.now() + TOKEN_DAYS * 86_400_000).toISOString(), supplier_email: to, mailed_at: now, mail_status: 'Emailed', mail_error: null,
    }).eq('organization_id', org).eq('id', poId);
    logger.info({ po: po.po_number, to, messageId: result.messageId }, 'School PO e-mailed to supplier');
    return { emailed: true, to, reason: null, link: publicLink };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP error';
    logger.error({ err, po: po.po_number, to }, 'School PO e-mail failed');
    return fail(`E-mail could not be delivered: ${msg}`);
  }
}

// ------------------------------------------------------------------ what the supplier's page uses (no login)
async function byToken(token: string): Promise<Row> {
  if (!/^[a-f0-9]{48}$/.test(token)) throw new AppError(404, 'LINK_INVALID', 'This link is not valid.');
  const { data, error } = await supabaseAdmin.from('school_purchase_orders').select('*, school_suppliers(supplier_name)').eq('public_token', token).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(404, 'LINK_INVALID', 'This link is not valid.');
  const po = data as Row;
  if (po.token_expires_at && Date.parse(String(po.token_expires_at)) < Date.now()) throw new AppError(410, 'LINK_EXPIRED', 'This link has expired. Please ask the buyer to resend the order.');
  return po;
}

export async function getPublicPo(token: string) {
  const po = await byToken(token);
  const co = await companyOf(String(po.organization_id), String(po.industry_type_id));
  return {
    po_number: po.po_number, order_date: po.order_date, expected_date: po.expected_date, status: po.status, notes: po.notes,
    supplier_name: one(po.school_suppliers)?.supplier_name ?? null,
    lines: ((po.lines ?? []) as Row[]).map((l) => ({ product_name: l.product_name, product_code: l.product_code, quantity: l.quantity, rate: l.rate, gst_percent: l.gst_percent, amount: l.amount })),
    subtotal: po.subtotal, tax_amount: po.tax_amount, total_amount: po.total_amount,
    supplier_response: po.supplier_response, responded_at: po.responded_at, supplier_delivery_date: po.supplier_delivery_date, supplier_note: po.supplier_note,
    can_respond: !po.supplier_response && ['Sent', 'Partially received'].includes(String(po.status)),
    can_ship: po.supplier_response !== 'Declined' && ['Sent', 'Partially received'].includes(String(po.status)),
    shipped_at: po.shipped_at ?? null, shipment_invoice_no: po.shipment_invoice_no ?? null, shipment_vehicle_no: po.shipment_vehicle_no ?? null, shipment_eta: po.shipment_eta ?? null,
    company: { name: co.company_name ?? null, gstin: co.gstin ?? null, address: [co.address, co.city, co.state, co.pincode].filter(Boolean).join(' '), phone: co.phone ?? null, email: co.email ?? null },
  };
}

/** Called by the supplier's page after it renders. This is what flips the order to "Opened". */
export async function markPoOpened(token: string): Promise<void> {
  const po = await byToken(token);
  await supabaseAdmin.from('school_purchase_orders').update({ viewed_at: po.viewed_at ?? new Date().toISOString(), view_count: num(po.view_count) + 1 }).eq('id', po.id);
}

export async function respondPublicPo(token: string, input: Row): Promise<{ supplier_response: string }> {
  const po = await byToken(token);
  const decision = str(input.decision);
  if (!['confirm', 'decline'].includes(decision)) throw bad('Choose Confirm or Decline.');
  if (!['Sent', 'Partially received'].includes(String(po.status))) throw bad('This order is no longer open, so it cannot be answered.');
  if (po.supplier_response) throw new AppError(409, 'ALREADY_ANSWERED', `This order was already ${String(po.supplier_response).toLowerCase()}.`);
  const date = str(input.delivery_date);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < String(po.order_date).slice(0, 10) || Date.parse(date) > Date.now() + 365 * 86_400_000)) throw bad('Enter a valid delivery date.');
  const note = str(input.note).slice(0, 500);
  const now = new Date().toISOString();
  const response = decision === 'confirm' ? 'Confirmed' : 'Declined';
  const patch: Row = { supplier_response: response, responded_at: now, supplier_note: note || null, viewed_at: po.viewed_at ?? now, supplier_delivery_date: decision === 'confirm' && date ? date : null };
  if (decision === 'confirm' && date) patch.expected_date = date; // the supplier's promised date becomes the expected date
  const { data: claimed, error } = await supabaseAdmin.from('school_purchase_orders').update(patch).eq('id', po.id).is('supplier_response', null).select('id');
  if (error) throw error;
  if (!claimed?.length) throw new AppError(409, 'ALREADY_ANSWERED', 'This order was just answered.');
  // Tell the buyer straight away (best effort).
  try {
    const co = await companyOf(String(po.organization_id), String(po.industry_type_id)); const mailer = transport();
    if (mailer && str(co.email)) {
      await mailer.sendMail({ from: env.MAIL_FROM, to: str(co.email), subject: `${po.po_number} ${response.toLowerCase()} by ${str(one(po.school_suppliers)?.supplier_name) || 'supplier'}`,
        html: `<p><b>${esc(one(po.school_suppliers)?.supplier_name)}</b> has <b>${response.toLowerCase()}</b> purchase order <b>${esc(po.po_number)}</b>.</p>${patch.supplier_delivery_date ? `<p>Promised delivery: <b>${esc(patch.supplier_delivery_date)}</b></p>` : ''}${note ? `<p>Note: ${esc(note)}</p>` : ''}` });
    }
  } catch (err) { logger.warn({ err }, 'School PO response notice failed'); }
  return { supplier_response: response };
}

/** The supplier tells us the goods are on the way. Shipping also counts as accepting the order, and the ETA becomes the expected date. */
export async function shipPublicPo(token: string, input: Row): Promise<{ shipped: true }> {
  const po = await byToken(token);
  if (!['Sent', 'Partially received'].includes(String(po.status))) throw bad('This order is no longer open.');
  if (po.supplier_response === 'Declined') throw bad('You declined this order, so it cannot be shipped.');
  const invoice = str(input.invoice_no).slice(0, 60); const vehicle = str(input.vehicle_no).slice(0, 60); const eta = str(input.eta); const note = str(input.note).slice(0, 300);
  if (!invoice && !vehicle) throw bad('Enter your invoice number or the vehicle / LR number.');
  if (eta && (!/^\d{4}-\d{2}-\d{2}$/.test(eta) || eta < String(po.order_date).slice(0, 10) || Date.parse(eta) > Date.now() + 365 * 86_400_000)) throw bad('Enter a valid arrival date.');
  const now = new Date().toISOString();
  const patch: Row = { shipped_at: now, shipment_invoice_no: invoice || null, shipment_vehicle_no: vehicle || null, shipment_eta: eta || null, shipment_note: note || null, viewed_at: po.viewed_at ?? now };
  if (!po.supplier_response) { patch.supplier_response = 'Confirmed'; patch.responded_at = now; }
  if (eta) patch.expected_date = eta;
  const { error } = await supabaseAdmin.from('school_purchase_orders').update(patch).eq('id', po.id);
  if (error) throw error;
  try {
    const co = await companyOf(String(po.organization_id), String(po.industry_type_id)); const mailer = transport();
    if (mailer && str(co.email)) {
      await mailer.sendMail({ from: env.MAIL_FROM, to: str(co.email), subject: `${po.po_number} shipped by ${str(one(po.school_suppliers)?.supplier_name) || 'supplier'}`,
        html: `<p><b>${esc(one(po.school_suppliers)?.supplier_name)}</b> has shipped purchase order <b>${esc(po.po_number)}</b>.</p><p>Invoice: <b>${esc(invoice || '—')}</b> · Vehicle / LR: <b>${esc(vehicle || '—')}</b>${eta ? ` · Arriving: <b>${esc(eta)}</b>` : ''}</p>${note ? `<p>${esc(note)}</p>` : ''}<p>It now shows in Goods Receipt under Arriving.</p>` });
    }
  } catch (err) { logger.warn({ err }, 'School PO shipment notice failed'); }
  return { shipped: true };
}