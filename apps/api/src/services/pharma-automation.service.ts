/* eslint-disable @typescript-eslint/no-explicit-any */
// Pharma Distributor automation: auto-reorder, auto-invoice, payment reminders, supplier bills (due dates),
// near-expiry actions, recall customer list and the "Today" worklist. DB only: no imports from the route files (no cycles).
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { all, addDays, claim, diffDays, industryProducts, insertNumbered, gstTotals, note, num, r2, str, today, type Row } from '../lib/pharma-db.js';
import { createPharmaInvoice } from '../lib/pharma-invoicing.js';
import { daysLeft } from '../lib/pharma-rules.js';

// ------------------------------------------------------------------ settings
export type AutoSettings = { auto_reorder: boolean; cover_days: number; auto_invoice: 'off' | 'confirm' | 'dispatch'; auto_invoice_since: string; email_invoice: boolean; auto_reminders: boolean; remind_before_days: number; remind_after_days: number; auto_send_po: boolean; auto_send_po_since: string; auto_approve_po_below: number; auto_expiry_return: 'off' | 'expired'; escalate_days: number; credit_hold_days: number; digest_enabled: boolean; digest_hour: number; digest_email: string | null; digest_phone: string | null };
const DEFAULTS: AutoSettings = { auto_reorder: true, cover_days: 30, auto_invoice: 'off', auto_invoice_since: new Date().toISOString(), email_invoice: false, auto_reminders: true, remind_before_days: 3, remind_after_days: 7, auto_send_po: false, auto_send_po_since: new Date().toISOString(), auto_approve_po_below: 0, auto_expiry_return: 'off', escalate_days: 0, credit_hold_days: 0, digest_enabled: false, digest_hour: 8, digest_email: null, digest_phone: null };
export async function getSettings(orgId: string, it: string): Promise<AutoSettings> {
  const { data, error } = await supabaseAdmin.from('pharma_automation_settings').select('*').eq('organization_id', orgId).eq('industry_type_id', it).maybeSingle();
  if (error) throw error;
  return { ...DEFAULTS, ...((data as Row | null) ?? {}) } as AutoSettings;
}
export async function saveSettings(orgId: string, it: string, body: Row): Promise<AutoSettings> {
  const cur = await getSettings(orgId, it);
  const int = (v: unknown, d: number, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const mode = ['off', 'confirm', 'dispatch'].includes(String(body.auto_invoice)) ? (body.auto_invoice as AutoSettings['auto_invoice']) : cur.auto_invoice;
  const row = {
    organization_id: orgId, industry_type_id: it,
    auto_reorder: typeof body.auto_reorder === 'boolean' ? body.auto_reorder : cur.auto_reorder,
    cover_days: int(body.cover_days, cur.cover_days, 7, 180),
    auto_invoice: mode,
    // turning auto-invoice on (from off) starts the clock now, so old orders are never invoiced in bulk
    auto_invoice_since: cur.auto_invoice === 'off' && mode !== 'off' ? new Date().toISOString() : cur.auto_invoice_since,
    email_invoice: typeof body.email_invoice === 'boolean' ? body.email_invoice : cur.email_invoice,
    auto_reminders: typeof body.auto_reminders === 'boolean' ? body.auto_reminders : cur.auto_reminders,
    remind_before_days: int(body.remind_before_days, cur.remind_before_days, 0, 30),
      remind_after_days: int(body.remind_after_days, cur.remind_after_days, 1, 90),
    auto_send_po: typeof body.auto_send_po === 'boolean' ? body.auto_send_po : cur.auto_send_po,
    auto_send_po_since: !cur.auto_send_po && body.auto_send_po === true ? new Date().toISOString() : cur.auto_send_po_since, // only POs ordered after switching on are sent
    auto_approve_po_below: Math.max(0, Number(body.auto_approve_po_below ?? cur.auto_approve_po_below) || 0),
    auto_expiry_return: ['off', 'expired'].includes(String(body.auto_expiry_return)) ? (body.auto_expiry_return as AutoSettings['auto_expiry_return']) : cur.auto_expiry_return,
    escalate_days: int(body.escalate_days, cur.escalate_days, 0, 365),
    credit_hold_days: int(body.credit_hold_days, cur.credit_hold_days, 0, 365),
    digest_enabled: typeof body.digest_enabled === 'boolean' ? body.digest_enabled : cur.digest_enabled,
    digest_hour: int(body.digest_hour, cur.digest_hour, 0, 23),
    digest_email: body.digest_email === undefined ? cur.digest_email : (/^\S+@\S+\.\S+$/.test(String(body.digest_email).trim()) ? String(body.digest_email).trim() : null),
    digest_phone: body.digest_phone === undefined ? cur.digest_phone : (String(body.digest_phone).replace(/[^\d+]/g, '') || null),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from('pharma_automation_settings').upsert(row, { onConflict: 'organization_id,industry_type_id' }).select('*').single();
  if (error) throw error;
  return data as AutoSettings;
}

// ------------------------------------------------------------------ messaging (email + optional WhatsApp webhook)
export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (!to || !env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.MAIL_FROM) return false;
  try {
    await nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }).sendMail({ from: env.MAIL_FROM, to, subject, html });
    return true;
  } catch (err) { logger.error({ err, to }, 'Pharma automation email failed'); return false; }
}
/** WhatsApp has no free automatic API. If WHATSAPP_WEBHOOK_URL is set (your WhatsApp Business / Gupshup / Twilio bridge) the text is POSTed to it as {to,text}. */
export async function sendWhatsApp(phone: string, text: string): Promise<boolean> {
  const url = process.env.WHATSAPP_WEBHOOK_URL;
  const to = waNumber(phone);
  if (!url || !to) return false;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.WHATSAPP_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.WHATSAPP_WEBHOOK_TOKEN}` } : {}) }, body: JSON.stringify({ to, text }) });
    return res.ok;
  } catch (err) { logger.error({ err }, 'Pharma automation WhatsApp webhook failed'); return false; }
}
export const waNumber = (phone: unknown) => { const d = String(phone ?? '').replace(/\D/g, ''); if (d.length === 10) return `91${d}`; return d.length >= 11 ? d : ''; };
export const waLink = (phone: unknown, text: string) => { const n = waNumber(phone); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null; };
const phoneOf = (c: Row | undefined) => str(c?.phone) || str(c?.mobile) || str(c?.contact_phone) || str(c?.contact_number) || '';
const emailOf = (c: Row | undefined) => str(c?.email) || str(c?.contact_email) || '';
const one = (v: any): any => (Array.isArray(v) ? v[0] : v);

// ------------------------------------------------------------------ 1. auto-reorder
const OPEN_PO = ['Draft', 'Ordered', 'Partially Received'];
export async function reorderPlan(orgId: string, it: string): Promise<{ items: Row[]; unassigned: Row[] }> {
  const st = await getSettings(orgId, it);
  const products = await industryProducts(orgId, it);
  const low = products.filter((p) => p.min_stock_level !== null && p.min_stock_level !== undefined && p.stock_quantity !== null && num(p.stock_quantity) <= num(p.min_stock_level));
  if (!low.length) return { items: [], unassigned: [] };
  const [rules, pos, grns, sups] = await Promise.all([
    all(() => supabaseAdmin.from('pharma_reorder_rules').select('*').eq('organization_id', orgId).eq('industry_type_id', it)),
    all(() => supabaseAdmin.from('pharma_purchase_orders').select('lines').eq('organization_id', orgId).eq('industry_type_id', it).in('status', OPEN_PO)),
    supabaseAdmin.from('pharma_grn').select('supplier_id, lines').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled').order('created_at', { ascending: false }).limit(300),
    all(() => supabaseAdmin.from('pharma_suppliers').select('id, supplier_name, status').eq('organization_id', orgId).eq('industry_type_id', it)),
  ]);
  const supById = new Map(sups.map((s) => [s.id as string, s]));
  const ruleBy = new Map(rules.map((r) => [String(r.product_code), r]));
  const onOrder = new Map<string, number>();
  for (const po of pos) for (const l of (po.lines ?? []) as Row[]) onOrder.set(String(l.product_code), (onOrder.get(String(l.product_code)) ?? 0) + Math.max(0, num(l.quantity) - num(l.received_quantity)));
  const lastSupplier = new Map<string, string>();
  for (const g of ((grns.data ?? []) as Row[])) for (const l of (g.lines ?? []) as Row[]) if (!lastSupplier.has(String(l.product_code))) lastSupplier.set(String(l.product_code), g.supplier_id);
  // recent demand (units sold in the cover window)
  const since = new Date(Date.now() - st.cover_days * 86_400_000).toISOString();
  const demand = new Map<string, number>();
  try {
    const orders = await all(() => supabaseAdmin.from('sale_orders').select('id, clients!inner(industry_type_id)').eq('organization_id', orgId).eq('clients.industry_type_id', it).gte('created_at', since).not('status', 'in', '("cancelled","rejected","draft","pending_approval")'));
    const ids = orders.map((o) => o.id as string);
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabaseAdmin.from('sale_order_items').select('quantity, products(product_code)').in('order_id', ids.slice(i, i + 100));
      for (const x of (data ?? []) as Row[]) { const c = str(one(x.products)?.product_code); if (c) demand.set(c, (demand.get(c) ?? 0) + num(x.quantity)); }
    }
  } catch { /* no sales history: fall back to reorder level */ }
  const items: Row[] = []; const unassigned: Row[] = [];
  for (const p of low) {
    const code = String(p.product_code); const ord = onOrder.get(code) ?? 0; const eff = num(p.stock_quantity) + ord;
    if (eff > num(p.min_stock_level)) continue; // already covered by an open order
    const rule = ruleBy.get(code);
    const target = Math.max(demand.get(code) ?? 0, num(p.min_stock_level) * 2);
    const qty = rule?.reorder_qty ? num(rule.reorder_qty) : Math.ceil(target - eff);
    if (!(qty > 0)) continue;
    const supId = (rule?.preferred_supplier_id as string | undefined) ?? lastSupplier.get(code) ?? null;
    const sup = supId ? supById.get(supId) : undefined;
    const row = { product_code: code, product_name: p.product_name, stock: num(p.stock_quantity), reorder_level: num(p.min_stock_level), on_order: ord, sold_recent: demand.get(code) ?? 0, qty, rate: num(p.cost_price), gst_percent: num(p.tax_percent), supplier_id: sup && sup.status === 'active' ? sup.id : null, supplier_name: sup?.supplier_name ?? null, basis: rule?.reorder_qty ? 'fixed qty' : 'recent sales / 2x reorder level' };
    (row.supplier_id ? items : unassigned).push(row);
  }
  return { items, unassigned };
}
export async function createReorderDrafts(orgId: string, it: string, actor: string | null): Promise<{ created: Row[]; unassigned: Row[] }> {
  const plan = await reorderPlan(orgId, it);
  const bySup = new Map<string, Row[]>();
  for (const i of plan.items) bySup.set(i.supplier_id, [...(bySup.get(i.supplier_id) ?? []), i]);
  const created: Row[] = [];
  for (const [supplierId, rows] of bySup) {
    const lines = rows.map((r) => ({ product_code: r.product_code, product_name: r.product_name, quantity: r.qty, received_quantity: 0, rate: r2(r.rate), gst_percent: r.gst_percent }));
    const po = await insertNumbered('pharma_purchase_orders', 'po_number', orgId, `PO-${new Date().getFullYear()}-`, { industry_type_id: it, supplier_id: supplierId, order_date: today(), expected_date: null, notes: 'Auto-generated reorder (stock at or below reorder level). Review and mark Ordered.', status: 'Draft', auto_generated: true, lines, ...gstTotals(lines), created_by: actor });
    created.push({ ...po, supplier_name: rows[0].supplier_name });
  }
  return { created, unassigned: plan.unassigned };
}

// ------------------------------------------------------------------ 2. supplier bills with due dates (payments applied oldest-first)
export async function supplierBills(orgId: string, it: string): Promise<Row[]> {
  const [sups, grns, rets, pays] = await Promise.all([
    all(() => supabaseAdmin.from('pharma_suppliers').select('id, supplier_code, supplier_name, payment_terms_days, phone').eq('organization_id', orgId).eq('industry_type_id', it)),
    all(() => supabaseAdmin.from('pharma_grn').select('id, grn_number, grn_date, supplier_id, supplier_invoice_no, total_amount').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled').order('grn_date', { ascending: true })),
    all(() => supabaseAdmin.from('pharma_purchase_returns').select('supplier_id, accepted_amount').eq('organization_id', orgId).eq('industry_type_id', it).eq('status', 'Accepted')),
all(() => supabaseAdmin.from('pharma_supplier_payments').select('supplier_id, amount, grn_id').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled')),
  ]);
  const pool = new Map<string, number>();
  for (const r of rets) pool.set(r.supplier_id, (pool.get(r.supplier_id) ?? 0) + num(r.accepted_amount));
   const onBill = new Map<string, number>(); // payments made against a specific bill go to that bill; the rest is applied oldest-first
  const billTotal = new Map<string, number>(grns.map((g) => [g.id as string, num(g.total_amount)]));
  for (const p of pays) { if (p.grn_id && billTotal.has(p.grn_id)) onBill.set(p.grn_id, (onBill.get(p.grn_id) ?? 0) + num(p.amount)); else pool.set(p.supplier_id, (pool.get(p.supplier_id) ?? 0) + num(p.amount)); } // a payment on a cancelled bill goes back to the pool
  for (const g of grns) { const extra = (onBill.get(g.id) ?? 0) - num(g.total_amount); if (extra > 0.005) { onBill.set(g.id, num(g.total_amount)); pool.set(g.supplier_id, (pool.get(g.supplier_id) ?? 0) + extra); } } // paid more than the bill: the extra covers other bills
  const supBy = new Map(sups.map((s) => [s.id as string, s]));
  const t = today(); const out: Row[] = [];
  for (const g of grns) {
    const credit = pool.get(g.supplier_id) ?? 0; const amount = num(g.total_amount); const direct = Math.min(onBill.get(g.id) ?? 0, amount);
    const applied = Math.min(credit, amount - direct); pool.set(g.supplier_id, credit - applied);
    const open = r2(amount - direct - applied); if (open <= 0.005) continue;
    const s = supBy.get(g.supplier_id); const due = addDays(String(g.grn_date), num(s?.payment_terms_days ?? 30));
    out.push({ grn_id: g.id, grn_number: g.grn_number, supplier_id: g.supplier_id, supplier_name: s?.supplier_name ?? '', supplier_code: s?.supplier_code ?? '', supplier_invoice_no: g.supplier_invoice_no ?? '', bill_date: String(g.grn_date).slice(0, 10), due_date: due, amount, open, days_overdue: diffDays(t, due) });
  }
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date));
}

// ------------------------------------------------------------------ 3. customer invoices: paid / open / overdue (linked to Collections by order)
export async function invoiceDues(orgId: string, it: string): Promise<Row[]> {
  const invs = await all(() => supabaseAdmin.from('pharma_invoices').select('id, invoice_number, order_id, client_id, invoice_date, due_date, total_amount, clients(*)').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled'));
  if (!invs.length) return [];
  const orderIds = [...new Set(invs.map((i) => i.order_id as string))];
  const paid = new Map<string, number>(); const credit = new Map<string, number>(); const back = new Map<string, number>(); const rep = new Map<string, string | null>();
  const add = (m: Map<string, number>, k: unknown, v: unknown) => m.set(String(k), (m.get(String(k)) ?? 0) + num(v));
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const [c, r, f, o] = await Promise.all([
      supabaseAdmin.from('sales_collections').select('sale_order_id, amount').eq('organization_id', orgId).in('sale_order_id', chunk),
      supabaseAdmin.from('sales_returns').select('order_id, credit_amount').eq('organization_id', orgId).eq('status', 'approved').in('order_id', chunk),
      supabaseAdmin.from('sales_refunds').select('order_id, amount').eq('organization_id', orgId).in('order_id', chunk),
      supabaseAdmin.from('sale_orders').select('id, representative_id').eq('organization_id', orgId).in('id', chunk),
    ]);
    if (c.error) throw c.error;
    for (const x of (c.data ?? []) as Row[]) add(paid, x.sale_order_id, x.amount);
    if (!r.error) for (const x of (r.data ?? []) as Row[]) add(credit, x.order_id, x.credit_amount);
    if (!f.error) for (const x of (f.data ?? []) as Row[]) add(back, x.order_id, x.amount);
    for (const x of (o.data ?? []) as Row[]) rep.set(x.id, x.representative_id ?? null);
  }
  const t = today();
  return invs.map((i) => {
    const cl = one(i.clients) as Row | undefined; const total = num(i.total_amount);
    const open = r2(total - (paid.get(i.order_id) ?? 0) - (credit.get(i.order_id) ?? 0) + (back.get(i.order_id) ?? 0));
    const due = String(i.due_date ?? i.invoice_date).slice(0, 10);
    return { invoice_id: i.id, invoice_number: i.invoice_number, order_id: i.order_id, client_id: i.client_id, client_name: cl?.client_name ?? '', phone: phoneOf(cl), email: emailOf(cl), representative_id: rep.get(i.order_id) ?? null, invoice_date: String(i.invoice_date).slice(0, 10), due_date: due, total, paid: r2(paid.get(i.order_id) ?? 0), open, days_overdue: diffDays(t, due), status: open <= 0.005 ? 'Paid' : (paid.get(i.order_id) ?? 0) > 0 ? 'Part paid' : 'Unpaid' };
  }).filter((x) => x.status !== 'Paid').sort((a, b) => b.days_overdue - a.days_overdue);
}
const reminderText = (d: Row, company: string) => d.days_overdue > 0
  ? `Dear ${d.client_name}, invoice ${d.invoice_number} for Rs ${d.open.toLocaleString('en-IN')} was due on ${d.due_date} (${d.days_overdue} day(s) ago). Kindly arrange payment. Thank you - ${company}`
  : d.days_overdue === 0 ? `Dear ${d.client_name}, invoice ${d.invoice_number} for Rs ${d.open.toLocaleString('en-IN')} is due today. Thank you - ${company}`
  : `Dear ${d.client_name}, a friendly reminder: invoice ${d.invoice_number} for Rs ${d.open.toLocaleString('en-IN')} is due on ${d.due_date}. Thank you - ${company}`;
export async function companyName(orgId: string, it: string) {
  const { data } = await supabaseAdmin.from('pharma_company_profile').select('company_name').eq('organization_id', orgId).eq('industry_type_id', it).maybeSingle();
  return str((data as Row | null)?.company_name) || 'Our team';
}
/** Payment reminders: 3 days before, on the due date, and 7 days after (days configurable). Each stage fires once per invoice. */
export async function runReminders(orgId: string, it: string, actor: string | null = null) {
  const st = await getSettings(orgId, it); const out = { followUps: 0, emails: 0, whatsapp: 0, checked: 0 };
  if (!st.auto_reminders) return out;
  const co = await companyName(orgId, it);
  for (const d of (await invoiceDues(orgId, it)).filter((x) => x.open > 0.005)) {
    out.checked += 1;
    // overdue reminders repeat every 7 days (overdue, overdue-w1, overdue-w2 ...), each once. The first keeps its old key, so nothing already sent is repeated.
    const week = Math.floor(Math.max(0, d.days_overdue - st.remind_after_days) / 7);
    const stage = d.days_overdue >= st.remind_after_days ? (week === 0 ? 'overdue' : `overdue-w${week}`) : d.days_overdue >= 0 ? 'due' : d.days_overdue >= -st.remind_before_days ? 'pre' : null;
        if (st.escalate_days > 0 && d.days_overdue >= st.escalate_days && await claim(orgId, it, `remind:${d.invoice_id}:escalated`, 'reminder', { invoice: d.invoice_number, stage: 'escalated', open: d.open })) {
      const msg = `ESCALATION: invoice ${d.invoice_number} for ${d.client_name} is ${d.days_overdue} days overdue, Rs ${d.open.toLocaleString('en-IN')} still open.`;
      if (d.representative_id) {
        const { error: ee } = await supabaseAdmin.from('follow_ups').insert({ organization_id: orgId, representative_id: d.representative_id, client_id: d.client_id, sale_order_id: d.order_id, title: `ESCALATION - ${d.days_overdue} days overdue: ${d.invoice_number}`, due_at: new Date().toISOString(), priority: 'high', follow_up_type: 'visit', notes: `${msg} Visit the customer and collect, or agree a date.` });
        if (!ee) out.followUps += 1;
      }
      if (st.digest_email && await sendMail(st.digest_email, `Escalation - ${d.invoice_number}`, `<p>${msg}</p>`)) out.emails += 1;
      if (st.digest_phone && await sendWhatsApp(st.digest_phone, msg)) out.whatsapp += 1;
    }
    if (!stage) continue;
    if (!(await claim(orgId, it, `remind:${d.invoice_id}:${stage}`, 'reminder', { invoice: d.invoice_number, stage, open: d.open }))) continue;
    const text = reminderText(d, co);
    if (d.representative_id) {
      const { error } = await supabaseAdmin.from('follow_ups').insert({ organization_id: orgId, representative_id: d.representative_id, client_id: d.client_id, sale_order_id: d.order_id, title: `Payment ${stage === 'pre' ? 'due soon' : stage === 'due' ? 'due today' : 'overdue'}: ${d.invoice_number}`, due_at: new Date().toISOString(), priority: stage.startsWith('overdue') ? 'high' : 'normal', follow_up_type: 'call', notes: `${text}${actor ? '' : ' (automatic reminder)'}` });
      if (!error) out.followUps += 1;
    }
    if (await sendMail(d.email, `Payment reminder - ${d.invoice_number}`, `<p>${text}</p>`)) out.emails += 1;
    if (await sendWhatsApp(d.phone, text)) out.whatsapp += 1;
  }
  return out;
}

// ------------------------------------------------------------------ 4. auto-invoice
const SKIP_STATUS = '("cancelled","rejected","draft","pending_approval")';
export async function ordersToInvoice(orgId: string, it: string, mode: 'confirm' | 'dispatch' | 'all-dispatched', since: string | null): Promise<Row[]> {
  // Oldest first, page by page, until enough UNINVOICED orders are found. A single "first 500" page would be full of already-invoiced
  // orders on a busy account, and newer orders would then never be invoiced.
  const WANT = 60; const PAGE = 500; const found: Row[] = [];
  for (let from = 0; found.length < WANT && from < 20_000; from += PAGE) {
    let q: any = supabaseAdmin.from('sale_orders').select('id, order_number, status, dispatch_status, created_at, clients!inner(client_name, industry_type_id)').eq('organization_id', orgId).eq('clients.industry_type_id', it).not('status', 'in', SKIP_STATUS).order('created_at', { ascending: true }).range(from, from + PAGE - 1);
    if (since) q = q.gte('created_at', since);
    const { data, error } = await q; if (error) throw error;
    let orders = (data ?? []) as Row[];
    const lastPage = orders.length < PAGE;
    if (mode !== 'confirm') orders = orders.filter((o) => ['dispatched', 'delivered'].includes(String(o.dispatch_status ?? '')) || ['delivered', 'completed'].includes(String(o.status)));
    if (orders.length) {
      const have = new Set<string>();
      const ids = orders.map((o) => o.id as string);
      for (let i = 0; i < ids.length; i += 100) {
        const { data: inv, error: ie } = await supabaseAdmin.from('pharma_invoices').select('order_id').eq('organization_id', orgId).neq('status', 'Cancelled').in('order_id', ids.slice(i, i + 100));
        if (ie) throw ie;
        for (const x of (inv ?? []) as Row[]) have.add(x.order_id);
      }
      for (const o of orders) if (!have.has(o.id)) found.push({ order_id: o.id, order_number: o.order_number, client_name: one(o.clients)?.client_name ?? '', status: o.status, dispatch_status: o.dispatch_status ?? null, created_at: o.created_at });
    }
    if (lastPage) break;
  }
  return found;
}
export async function runAutoInvoices(orgId: string, it: string, actor: string | null = null) {
  const st = await getSettings(orgId, it); const out = { issued: [] as string[], skipped: [] as { order: string; reason: string }[], emailed: 0 };
  if (st.auto_invoice === 'off') return out;
  const todo = (await ordersToInvoice(orgId, it, st.auto_invoice, st.auto_invoice_since)).slice(0, 50);
  const co = await companyName(orgId, it);
  for (const o of todo) {
    try {
      const inv = await createPharmaInvoice(orgId, it, o.order_id, actor);
      out.issued.push(String(inv.invoice_number));
      await claim(orgId, it, `autoinvoice:${o.order_id}`, 'invoice', { invoice: inv.invoice_number }).catch(() => false);
      if (st.email_invoice) {
        const { data: cl } = await supabaseAdmin.from('clients').select('*').eq('id', inv.client_id).maybeSingle();
        const html = `<p>Dear ${str((cl as Row | null)?.client_name) || 'Sir / Madam'},</p><p>Invoice <b>${inv.invoice_number}</b> dated ${String(inv.invoice_date).slice(0, 10)} for <b>Rs ${num(inv.total_amount).toLocaleString('en-IN')}</b> has been raised against order ${o.order_number}. Payment is due on ${String(inv.due_date).slice(0, 10)}.</p><p>Thank you,<br>${co}</p>`;
        if (await sendMail(emailOf(cl as Row), `Invoice ${inv.invoice_number} - ${co}`, html)) out.emailed += 1;
      }
    } catch (e: any) {
      const reason = String(e?.message ?? 'Could not invoice');
      out.skipped.push({ order: o.order_number, reason });
      await note(orgId, it, 'invoice-skipped', `skip:${o.order_id}`, { order: o.order_number, reason });
    }
  }
  return out;
}

// ------------------------------------------------------------------ 5. near-expiry actions + recall customers
export async function expiryActions(orgId: string, it: string): Promise<Row[]> {
  const [batches, sups] = await Promise.all([
    all(() => supabaseAdmin.from('pharma_batches').select('*').eq('organization_id', orgId).eq('industry_type_id', it).gt('quantity', 0).order('expiry_date')),
    all(() => supabaseAdmin.from('pharma_suppliers').select('id, supplier_name, status').eq('organization_id', orgId).eq('industry_type_id', it)),
  ]);
  const supByName = new Map(sups.map((s) => [String(s.supplier_name).toLowerCase(), s]));
  const out: Row[] = [];
  for (const b of batches) {
    const d = daysLeft(b.expiry_date); if (d === null || d > 90) continue;
    const sup = supByName.get(String(b.supplier ?? '').toLowerCase());
    const action = d < 0 ? 'Expired: return to supplier / write off' : d <= 30 ? 'Critical: return to supplier or clear stock now' : 'Expiring: push sales / offer a scheme';
    out.push({ batch_id: b.id, batch_number: b.batch_number, product_name: b.product_name, product_code: b.product_code, quantity: num(b.quantity), expiry_date: String(b.expiry_date).slice(0, 10), days_left: d, status: b.status, supplier_id: sup?.id ?? null, supplier_name: sup?.supplier_name ?? b.supplier ?? null, stock_value: r2(num(b.quantity) * num(b.purchase_rate)), action, can_return: Boolean(sup) && d <= 30 && !['Recalled'].includes(String(b.status)) });
  }
  return out;
}
export async function recallCustomers(orgId: string, it: string, batchNumber: string): Promise<Row[]> {
  const { data: items } = await supabaseAdmin.from('sale_order_items').select('order_id, batch_allocations').contains('batch_allocations', { batches: [{ batchNo: batchNumber, src: 'pharma' }] });
  const ids = [...new Set(((items ?? []) as Row[]).map((i) => i.order_id as string))];
  const units = new Map<string, number>();
  for (const i of (items ?? []) as Row[]) for (const p of ((i.batch_allocations?.batches ?? []) as Row[])) if (p.batchNo === batchNumber) units.set(i.order_id, (units.get(i.order_id) ?? 0) + num(p.quantity));
  const byClient = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabaseAdmin.from('sale_orders').select('id, order_number, client_id, clients!inner(*)').eq('organization_id', orgId).eq('clients.industry_type_id', it).neq('status', 'cancelled').in('id', ids.slice(i, i + 100)); // cancelled orders never shipped: no recall notice
    for (const o of (data ?? []) as Row[]) {
      const c = one(o.clients) as Row; const e = byClient.get(o.client_id) ?? { client_id: o.client_id, client_name: c.client_name, phone: phoneOf(c), email: emailOf(c), orders: [] as string[], units: 0 };
      e.orders.push(o.order_number); e.units += units.get(o.id) ?? 0; byClient.set(o.client_id, e);
    }
  }
  const co = await companyName(orgId, it);
  return [...byClient.values()].map((e) => ({ ...e, whatsapp: waLink(e.phone, `Dear ${e.client_name}, product recall notice from ${co}: batch ${batchNumber} supplied to you on order(s) ${e.orders.join(', ')} (${e.units} units) is being recalled. Please stop using / selling it and keep the stock aside for collection.`) }));
}
export async function notifyRecallCustomers(orgId: string, it: string, batchNumber: string, recallCode: string) {
  const co = await companyName(orgId, it); const out = { emails: 0, whatsapp: 0, customers: 0 };
  for (const c of await recallCustomers(orgId, it, batchNumber)) {
    if (!(await claim(orgId, it, `recall-notice:${recallCode}:${c.client_id}`, 'recall-notice', { client: c.client_name }))) continue;
    out.customers += 1;
    const text = `Dear ${c.client_name}, product recall notice from ${co}: batch ${batchNumber} supplied on order(s) ${c.orders.join(', ')} (${c.units} units) is being recalled. Please stop using / selling it and keep the stock aside for collection.`;
    if (await sendMail(c.email, `Product recall notice - batch ${batchNumber}`, `<p>${text}</p>`)) out.emails += 1;
    if (await sendWhatsApp(c.phone, text)) out.whatsapp += 1;
  }
  return out;
}

// ------------------------------------------------------------------ 6. Today worklist
export async function todaySummary(orgId: string, it: string) {
  const st = await getSettings(orgId, it); const t = today();
  const [plan, bills, dues, exp, pos, recalls, toInvoice] = await Promise.all([
    reorderPlan(orgId, it).catch(() => ({ items: [], unassigned: [] })),
    supplierBills(orgId, it).catch(() => []), invoiceDues(orgId, it).catch(() => []), expiryActions(orgId, it).catch(() => []),
    all(() => supabaseAdmin.from('pharma_purchase_orders').select('po_number, status, expected_date, auto_generated, pharma_suppliers(supplier_name)').eq('organization_id', orgId).eq('industry_type_id', it).in('status', ['Draft', 'Ordered', 'Partially Received'])).catch(() => []),
    supabaseAdmin.from('pharma_recalls').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Closed'),
    ordersToInvoice(orgId, it, 'all-dispatched', st.auto_invoice === 'off' ? new Date(Date.now() - 30 * 86_400_000).toISOString() : st.auto_invoice_since).catch(() => []),
  ]);
  const sum = (rows: Row[], f: (r: Row) => boolean) => r2(rows.filter(f).reduce((s, r) => s + r.open, 0));
  return {
    settings: st,
    reorder: { suggested: plan.items.length, withoutSupplier: plan.unassigned.length },
    draftPOsToApprove: pos.filter((p) => p.status === 'Draft').length,
    goodsDueToday: pos.filter((p) => ['Ordered', 'Partially Received'].includes(p.status) && p.expected_date && String(p.expected_date).slice(0, 10) <= t).length,
    invoicesToIssue: toInvoice.length,
    receivables: { overdue: sum(dues, (r) => r.days_overdue > 0), dueToday: sum(dues, (r) => r.days_overdue === 0), dueThisWeek: sum(dues, (r) => r.days_overdue < 0 && r.days_overdue >= -7), overdueInvoices: dues.filter((r) => r.days_overdue > 0).length },
    payables: { overdue: sum(bills, (r) => r.days_overdue > 0), dueToday: sum(bills, (r) => r.days_overdue === 0), dueThisWeek: sum(bills, (r) => r.days_overdue < 0 && r.days_overdue >= -7), overdueBills: bills.filter((r) => r.days_overdue > 0).length },
    expiry: { expiredWithStock: exp.filter((e) => e.days_left < 0).length, within30: exp.filter((e) => e.days_left >= 0 && e.days_left <= 30).length, within90: exp.length },
    openRecalls: recalls.count ?? 0,
  };
}

// ------------------------------------------------------------------ scheduler entry
export async function runAutomationForScope(orgId: string, it: string) {
  const st = await getSettings(orgId, it);
  const result: Row = {};
  if (st.auto_reorder) { try { const r = await createReorderDrafts(orgId, it, null); result.reorderDrafts = r.created.length; } catch (err) { logger.error({ err, orgId }, 'Pharma auto-reorder failed'); } }
  try { result.invoices = await runAutoInvoices(orgId, it); } catch (err) { logger.error({ err, orgId }, 'Pharma auto-invoice failed'); }
  try { result.reminders = await runReminders(orgId, it); } catch (err) { logger.error({ err, orgId }, 'Pharma reminders failed'); }
  try {
    // open recalls: tell every customer who received the batch (once per customer per recall)
    const { data: rc } = await supabaseAdmin.from('pharma_recalls').select('recall_code, batch_number').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Closed');
    result.recallNotices = 0;
    for (const r of (rc ?? []) as Row[]) result.recallNotices += (await notifyRecallCustomers(orgId, it, String(r.batch_number), String(r.recall_code))).customers;
  } catch (err) { logger.error({ err, orgId }, 'Pharma recall notices failed'); }
  return result;
}
export async function listScopes(): Promise<{ org: string; it: string }[]> {
  const seen = new Map<string, { org: string; it: string }>();
  for (const table of ['pharma_company_profile', 'pharma_suppliers']) {
    for (let from = 0; from < 200_000; from += 1000) { // every row, not just the first 5000
      const { data, error } = await supabaseAdmin.from(table).select('organization_id, industry_type_id').order('organization_id').range(from, from + 999);
      if (error) { if ((error as { code?: string }).code !== '42P01') logger.error({ err: error, table }, 'Pharma automation could not list scopes'); break; }
      for (const r of (data ?? []) as Row[]) if (r.organization_id && r.industry_type_id) seen.set(`${r.organization_id}|${r.industry_type_id}`, { org: r.organization_id, it: r.industry_type_id });
      if (!data || data.length < 1000) break;
    }
  }
  return [...seen.values()];
}