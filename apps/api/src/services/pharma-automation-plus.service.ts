/* eslint-disable @typescript-eslint/no-explicit-any */
// Pharma automation, part 2: send purchase orders to suppliers, auto-approve small reorder drafts, return expired stock, daily summary.
import { AppError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { bad, claim, note, num, str, today, type Row } from '../lib/pharma-db.js';
import { companyName, getSettings, sendMail, sendWhatsApp, todaySummary, waLink, type AutoSettings } from './pharma-automation.service.js';
import { returnBatchToSupplier } from '../routes/pharma-automation.routes.js';

const one = (v: any): any => (Array.isArray(v) ? v[0] : v);
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const inr = (v: unknown) => `Rs ${num(v).toLocaleString('en-IN')}`;

// ------------------------------------------------------------------ 1. purchase orders to suppliers
export async function sendPurchaseOrder(orgId: string, it: string, poId: string) {
  const { data, error } = await supabaseAdmin.from('pharma_purchase_orders').select('*, pharma_suppliers(supplier_name, email, phone)').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', poId).maybeSingle();
  if (error) throw error;
  const po = data as Row | null; if (!po) throw new AppError(404, 'RECORD_NOT_FOUND', 'Purchase order was not found.');
  const sup = one(po.pharma_suppliers) as Row | undefined;
  const co = await companyName(orgId, it);
  const lines = (po.lines ?? []) as Row[];
  const text = `Purchase order ${po.po_number} from ${co}: ${lines.map((l) => `${l.product_name} x ${l.quantity}`).join(', ')}. Total ${inr(po.total_amount)}.${po.expected_date ? ` Expected by ${String(po.expected_date).slice(0, 10)}.` : ''} Please confirm.`;
  const html = `<p>Dear ${esc(sup?.supplier_name) || 'Sir / Madam'},</p><p>Please supply the following against purchase order <b>${esc(po.po_number)}</b>${po.expected_date ? ` by ${esc(String(po.expected_date).slice(0, 10))}` : ''}:</p>`
    + `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse"><tr><th>Product</th><th>Qty</th><th>Rate</th><th>GST %</th></tr>${lines.map((l) => `<tr><td>${esc(l.product_name)}</td><td align="right">${num(l.quantity)}</td><td align="right">${num(l.rate).toFixed(2)}</td><td align="right">${num(l.gst_percent)}</td></tr>`).join('')}</table>`
    + `<p><b>Total: ${inr(po.total_amount)}</b></p><p>Please confirm receipt. Thank you - ${esc(co)}</p>`;
  const emailed = await sendMail(str(sup?.email), `Purchase order ${po.po_number} - ${co}`, html);
  const whatsapp = await sendWhatsApp(str(sup?.phone), text);
  return { po_number: String(po.po_number), to: str(sup?.email), emailed, whatsapp, whatsapp_link: waLink(sup?.phone, text) };
}

// ------------------------------------------------------------------ 1b. purchase return note to the supplier
export async function sendPurchaseReturn(orgId: string, it: string, id: string) {
  const { data, error } = await supabaseAdmin.from('pharma_purchase_returns').select('*, pharma_suppliers(supplier_name, email, phone)').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', id).maybeSingle();
  if (error) throw error;
  const r = data as Row | null; if (!r) throw new AppError(404, 'RECORD_NOT_FOUND', 'Purchase return was not found.');
  const sup = one(r.pharma_suppliers) as Row | undefined;
  const co = await companyName(orgId, it);
  const lines = (r.lines ?? []) as Row[];
  const text = `Purchase return ${r.return_number} from ${co}: ${lines.map((l) => `${l.product_name} batch ${l.batch_number} x ${l.quantity}`).join(', ')}. Credit value ${inr(r.total_amount)}.${r.reason ? ` Reason: ${r.reason}.` : ''} Please confirm and issue a credit note.`;
  const html = `<p>Dear ${esc(sup?.supplier_name) || 'Sir / Madam'},</p><p>We are returning the following goods against purchase return <b>${esc(r.return_number)}</b> dated ${esc(String(r.return_date).slice(0, 10))}.${r.reason ? ` Reason: ${esc(r.reason)}.` : ''}</p>`
    + `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse"><tr><th>Product</th><th>Batch</th><th>Qty</th><th>Rate</th><th>GST %</th></tr>${lines.map((l) => `<tr><td>${esc(l.product_name)}</td><td>${esc(l.batch_number)}</td><td align="right">${num(l.quantity)}</td><td align="right">${num(l.rate).toFixed(2)}</td><td align="right">${num(l.gst_percent)}</td></tr>`).join('')}</table>`
    + `<p><b>Credit value: ${inr(r.total_amount)}</b></p><p>Please confirm receipt and issue a credit note for this amount. Thank you - ${esc(co)}</p>`;
  const emailed = await sendMail(str(sup?.email), `Purchase return ${r.return_number} - ${co}`, html);
  const whatsapp = await sendWhatsApp(str(sup?.phone), text);
  if (emailed) await supabaseAdmin.from('pharma_purchase_returns').update({
    supplier_mailed_at: new Date().toISOString(), supplier_mailed_to: str(sup?.email),
    supplier_mail_status: r.supplier_mail_status === 'Replied' ? 'Replied' : 'Sent',
    status: r.status === 'Posted' ? 'Sent' : r.status,
  }).eq('organization_id', orgId).eq('id', id);
  return { return_number: String(r.return_number), to: str(sup?.email), emailed, whatsapp, whatsapp_link: waLink(sup?.phone, text) };
}

// ------------------------------------------------------------------ 1d. GST invoice to the customer
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number): string => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
function inWords(n: number): string {
  if (n === 0) return 'Zero';
  const p: string[] = []; const cr = Math.floor(n / 1e7); const lk = Math.floor((n % 1e7) / 1e5); const th = Math.floor((n % 1e5) / 1e3); const h = Math.floor((n % 1e3) / 100); const r = n % 100;
  if (cr) p.push(`${two(cr)} Crore`); if (lk) p.push(`${two(lk)} Lakh`); if (th) p.push(`${two(th)} Thousand`); if (h) p.push(`${ONES[h]} Hundred`); if (r) p.push(two(r));
  return p.join(' ');
}
const d10 = (v: unknown) => String(v ?? '').slice(0, 10);
const f2 = (v: unknown) => num(v).toFixed(2);

function invoiceEmailHtml(inv: Row, c: Row, cl: Row): string {
  const inter = String(inv.supply_type).startsWith('Inter');
  const th = 'border:1px solid #999;padding:5px;background:#f1f1f1;text-align:left';
  const td = 'border:1px solid #999;padding:5px;vertical-align:top';
  const rows = ((inv.lines ?? []) as Row[]).map((l, i) => `<tr><td style="${td}">${i + 1}</td><td style="${td}">${esc(l.product_name)}</td><td style="${td}">${esc(l.hsn_code)}</td>`
    + `<td style="${td}">${((l.batches ?? []) as Row[]).map((b) => `${esc(b.batch_number)}${b.expiry_date ? ` (Exp ${esc(b.expiry_date)})` : ''}`).join('<br>')}</td>`
    + `<td style="${td};text-align:right">${num(l.quantity)}${num(l.free_quantity) ? ` + ${num(l.free_quantity)} free` : ''}</td><td style="${td};text-align:right">${f2(l.rate)}</td><td style="${td};text-align:right">${f2(l.discount)}</td>`
    + `<td style="${td};text-align:right">${f2(l.taxable_value)}</td><td style="${td};text-align:right">${num(l.gst_percent)}%</td><td style="${td};text-align:right">${f2(num(l.cgst) + num(l.sgst) + num(l.igst))}</td></tr>`).join('');
  const tot = (label: string, v: unknown, bold = false) => `<tr><td style="padding:2px 8px">${bold ? '<b>' : ''}${label}${bold ? '</b>' : ''}</td><td style="padding:2px 8px;text-align:right">${bold ? '<b>' : ''}${f2(v)}${bold ? '</b>' : ''}</td></tr>`;
  return `<div style="font:13px Arial,sans-serif;color:#111;max-width:820px">`
    + `<p>Dear ${esc(cl.client_name) || 'Sir / Madam'},</p><p>Please find your tax invoice <b>${esc(inv.invoice_number)}</b> from ${esc(c.company_name) || 'us'} below. Thank you for your business.</p>`
    + `<h2 style="margin:12px 0 8px;font-size:18px">TAX INVOICE</h2>`
    + `<table style="width:100%;border-collapse:collapse"><tr><td style="${td};width:50%"><b>${esc(c.company_name)}</b><br>${esc(c.address)}<br>GSTIN: ${esc(c.gstin)}<br>Drug Licence: ${esc(c.drug_license_number)}<br>${esc(c.phone)}</td>`
    + `<td style="${td}">Invoice No: <b>${esc(inv.invoice_number)}</b><br>Date: ${esc(d10(inv.invoice_date))}<br>Due: ${esc(d10(inv.due_date))}<br>Supply: ${esc(inv.supply_type)}<br>Place of supply: ${esc(inv.place_of_supply)}</td></tr></table>`
    + `<p style="margin:10px 0 4px"><b>Bill to: ${esc(cl.client_name)}</b><br>${esc(cl.street_address)} ${esc(cl.city)} ${esc(cl.state)}<br>GSTIN: ${esc(cl.gstin)}</p>`
    + `<table style="width:100%;border-collapse:collapse;margin-top:8px"><tr><th style="${th}">#</th><th style="${th}">Medicine</th><th style="${th}">HSN</th><th style="${th}">Batch / Expiry</th><th style="${th}">Qty</th><th style="${th}">Rate</th><th style="${th}">Disc.</th><th style="${th}">Taxable</th><th style="${th}">GST</th><th style="${th}">Tax amt</th></tr>${rows}</table>`
    + `<table style="margin:10px 0 0 auto;border-collapse:collapse">${tot('Taxable value', inv.taxable_amount)}${inter ? tot('IGST', inv.igst_amount) : tot('CGST', inv.cgst_amount) + tot('SGST', inv.sgst_amount)}${tot('Round off', inv.round_off)}${tot('Total (Rs)', inv.total_amount, true)}</table>`
    + `<p><b>Amount in words:</b> Rupees ${inWords(Math.round(num(inv.total_amount)))} Only</p>`
    + (c.bank_details ? `<p>${esc(c.bank_details)}</p>` : '') + (c.terms ? `<p style="color:#555">${esc(c.terms)}</p>` : '')
    + `<p>Thank you - ${esc(c.company_name)}</p></div>`;
}

export async function sendInvoice(orgId: string, it: string, id: string) {
  const { data, error } = await supabaseAdmin.from('pharma_invoices').select('*, clients(*)').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', id).maybeSingle();
  if (error) throw error;
  const inv = data as Row | null; if (!inv) throw new AppError(404, 'RECORD_NOT_FOUND', 'Invoice was not found.');
  if (inv.status === 'Cancelled') throw bad('A cancelled invoice cannot be sent.');
  const cl = (one(inv.clients) ?? {}) as Row;
  const { data: cp } = await supabaseAdmin.from('pharma_company_profile').select('*').eq('organization_id', orgId).eq('industry_type_id', it).maybeSingle();
  const c = (cp ?? {}) as Row;
  const co = str(c.company_name) || (await companyName(orgId, it));
  const to = str(cl.email) || str(cl.contact_email);
  const text = `Dear ${str(cl.client_name) || 'Sir / Madam'}, invoice ${inv.invoice_number} dated ${d10(inv.invoice_date)} from ${co}. Total ${inr(inv.total_amount)}, due ${d10(inv.due_date)}. Thank you.`;
  const emailed = await sendMail(to, `Tax invoice ${inv.invoice_number} - ${co}`, invoiceEmailHtml(inv, c, cl));
  const phone = str(cl.phone) || str(cl.contact_phone);
  const whatsapp = await sendWhatsApp(phone, text);
  if (emailed) await supabaseAdmin.from('pharma_invoices').update({ client_mailed_at: new Date().toISOString(), client_mailed_to: to }).eq('organization_id', orgId).eq('id', id);
  return { invoice_number: String(inv.invoice_number), to, emailed, whatsapp, whatsapp_link: waLink(phone, text) };
}

async function loadReturn(orgId: string, it: string, id: string): Promise<Row> {
  const { data, error } = await supabaseAdmin.from('pharma_purchase_returns').select('*').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(404, 'RECORD_NOT_FOUND', 'Purchase return was not found.');
  return data as Row;
}
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime());

// ------------------------------------------------------------------ 1c. dispatch details and supplier acceptance (credit note)
export async function dispatchPurchaseReturn(orgId: string, it: string, id: string, input: Row) {
  const r = await loadReturn(orgId, it, id);
  if (r.status === 'Accepted') throw bad('This return is already accepted by the supplier.');
  const carrier = str(input.carrier); if (!carrier) throw bad('Enter the courier or transport name.');
  const date = str(input.dispatch_date) || today(); if (!isDay(date)) throw bad('Dispatch date is not valid.');
  const { data, error } = await supabaseAdmin.from('pharma_purchase_returns').update({
    status: 'Dispatched', dispatched_at: date, dispatch_carrier: carrier, dispatch_tracking_no: str(input.tracking_no) || null, dispatch_note: str(input.note) || null,
  }).eq('organization_id', orgId).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

/** Supplier accepted the goods and issued a credit note. Only now does the supplier balance go down. */
export async function acceptPurchaseReturn(orgId: string, it: string, id: string, input: Row) {
  const r = await loadReturn(orgId, it, id);
  if (r.status === 'Accepted') throw bad('This return is already accepted.');
  const cn = str(input.credit_note_number); if (!cn) throw bad('Enter the supplier credit note number.');
  const date = str(input.accepted_date) || today(); if (!isDay(date)) throw bad('Credit note date is not valid.');
  const total = num(r.total_amount);
  const amt = input.accepted_amount === undefined || input.accepted_amount === null || input.accepted_amount === '' ? total : Number(input.accepted_amount);
  if (!(amt > 0) || amt > total + 0.005) throw bad(`Accepted amount must be more than zero and not more than ${total}.`);
  const { data, error } = await supabaseAdmin.from('pharma_purchase_returns').update({
    status: 'Accepted', accepted_at: date, credit_note_number: cn, accepted_amount: Math.round(amt * 100) / 100,
  }).eq('organization_id', orgId).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

/** Sends one PO the first time it is called for that PO (idempotent). Used when a PO becomes Ordered. Returns true when it sent now. */
export async function onPoOrdered(orgId: string, it: string, poId: string): Promise<boolean> {
  try {
    const st = await getSettings(orgId, it);
    if (!st.auto_send_po) return false;
    if (!(await claim(orgId, it, `po-sent:${poId}`, 'po-sent', {}))) return false;
    const r = await sendPurchaseOrder(orgId, it, poId);
    await note(orgId, it, 'po-sent-result', `po-sent-result:${poId}`, { po: r.po_number, emailed: r.emailed, whatsapp: r.whatsapp });
    return true;
  } catch (err) { logger.error({ err, poId }, 'Pharma auto-send purchase order failed'); return false; }
}

/** Draft reorder POs (auto-generated) up to the limit are ordered without waiting for a person. */
export async function autoApproveDrafts(orgId: string, it: string, st: AutoSettings): Promise<number> {
  if (!(num(st.auto_approve_po_below) > 0)) return 0;
  const { data, error } = await supabaseAdmin.from('pharma_purchase_orders').select('id, total_amount, pharma_suppliers(status)').eq('organization_id', orgId).eq('industry_type_id', it).eq('status', 'Draft').eq('auto_generated', true).lte('total_amount', num(st.auto_approve_po_below)).limit(50);
  if (error) throw error;
  let n = 0;
  for (const po of (data ?? []) as Row[]) {
    if (one(po.pharma_suppliers)?.status !== 'active') continue;
    const { error: e2 } = await supabaseAdmin.from('pharma_purchase_orders').update({ status: 'Ordered' }).eq('organization_id', orgId).eq('id', po.id).eq('status', 'Draft');
    if (!e2) { n += 1; await onPoOrdered(orgId, it, String(po.id)); }
  }
  return n;
}

/** POs created straight as Ordered (since auto-send was switched on) are picked up here. */
export async function sendNewOrderedPOs(orgId: string, it: string, st: AutoSettings): Promise<number> {
  if (!st.auto_send_po) return 0;
  const { data } = await supabaseAdmin.from('pharma_purchase_orders').select('id').eq('organization_id', orgId).eq('industry_type_id', it).eq('status', 'Ordered').gte('created_at', st.auto_send_po_since).limit(50);
  let n = 0;
  for (const r of (data ?? []) as Row[]) if (await onPoOrdered(orgId, it, String(r.id))) n += 1;
  return n;
}

// ------------------------------------------------------------------ 2. expired stock goes back to the supplier
export async function runExpiryAutomation(orgId: string, it: string, st: AutoSettings): Promise<number> {
  if (st.auto_expiry_return !== 'expired') return 0;
  const { data } = await supabaseAdmin.from('pharma_batches').select('id, batch_number, status').eq('organization_id', orgId).eq('industry_type_id', it).gt('quantity', 0).lt('expiry_date', today()).limit(25);
  let n = 0;
  for (const b of (data ?? []) as Row[]) {
    if (['Recalled', 'Quarantined'].includes(String(b.status))) continue; // recalls and manual holds stay with a person
    const key = `expiry-return:${b.id}`;
    if (!(await claim(orgId, it, key, 'expiry-return', { batch: b.batch_number }))) continue;
    try {
      await returnBatchToSupplier(orgId, it, null, { batch_number: String(b.batch_number), reason: 'Expired stock returned to supplier (automatic)', source_type: 'expiry', source_ref: String(b.batch_number) });
      n += 1;
    } catch (e: any) {
      // e.g. the supplier is not in Supplier Management yet: free the key so it is tried again once fixed, and say why
      await supabaseAdmin.from('pharma_automation_log').delete().eq('organization_id', orgId).eq('log_key', key);
      await note(orgId, it, 'expiry-return-skipped', `expiry-skip:${b.id}`, { batch: b.batch_number, reason: String(e?.message ?? '') });
    }
  }
  return n;
}

// ------------------------------------------------------------------ 3. daily summary (email / WhatsApp)
export async function runDigest(orgId: string, it: string, st: AutoSettings, force = false) {
  const out = { sent: false, emailed: false, whatsapp: false, text: '' };
  const ist = new Date(Date.now() + 330 * 60_000); const istDate = ist.toISOString().slice(0, 10);
  if (!force) {
    if (!st.digest_enabled || ist.getUTCHours() < num(st.digest_hour)) return out;
    if (!(await claim(orgId, it, `digest:${istDate}`, 'digest', {}))) return out;
  }
  if (!str(st.digest_email) && !str(st.digest_phone)) throw new AppError(400, 'VALIDATION_ERROR', 'Add a summary email or WhatsApp number in Automation settings first.');
  const d = await todaySummary(orgId, it); const co = await companyName(orgId, it);
  const r = d.receivables as any; const p = d.payables as any; const e = d.expiry as any;
  out.text = [
    `${co} - daily summary ${istDate}`,
    `To collect: ${inr(r?.overdue)} overdue (${r?.overdueInvoices ?? 0} invoices), ${inr(r?.dueToday)} due today, ${inr(r?.dueThisWeek)} this week`,
    `To pay: ${inr(p?.overdue)} overdue (${p?.overdueBills ?? 0} bills), ${inr(p?.dueToday)} due today, ${inr(p?.dueThisWeek)} this week`,
    `Stock: ${e?.expiredWithStock ?? 0} expired batches with stock, ${e?.within30 ?? 0} expiring within 30 days, ${e?.within90 ?? 0} within 90 days`,
    `Orders: ${d.draftPOsToApprove} draft POs to approve, ${d.goodsDueToday} deliveries due, ${d.invoicesToIssue} invoices to issue, ${d.reorder.suggested} reorder suggestions`,
    `Open recalls: ${d.openRecalls}`,
  ].join('\n');
  out.emailed = await sendMail(str(st.digest_email), `Daily summary - ${co} - ${istDate}`, `<pre style="font:14px Arial">${esc(out.text)}</pre>`);
  out.whatsapp = await sendWhatsApp(str(st.digest_phone), out.text);
  out.sent = out.emailed || out.whatsapp;
  // Nothing went out (SMTP / webhook down): free today's claim so the next run retries instead of skipping the whole day.
  if (!force && !out.sent) await supabaseAdmin.from('pharma_automation_log').delete().eq('organization_id', orgId).eq('log_key', `digest:${istDate}`);
  return out;
}

// ------------------------------------------------------------------ scheduler entry
export async function runPlusForScope(orgId: string, it: string) {
  const st = await getSettings(orgId, it); const result: Row = {};
  try { result.poApproved = await autoApproveDrafts(orgId, it, st); } catch (err) { logger.error({ err, orgId }, 'Pharma PO auto-approve failed'); }
  try { result.poSent = await sendNewOrderedPOs(orgId, it, st); } catch (err) { logger.error({ err, orgId }, 'Pharma PO auto-send failed'); }
  try { result.expiryReturns = await runExpiryAutomation(orgId, it, st); } catch (err) { logger.error({ err, orgId }, 'Pharma expiry automation failed'); }
  try { result.digestSent = (await runDigest(orgId, it, st)).sent; } catch (err) { logger.error({ err, orgId }, 'Pharma daily summary failed'); }
  return result;
}