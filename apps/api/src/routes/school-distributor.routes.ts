/* eslint-disable @typescript-eslint/no-explicit-any */
// School distributor / wholesaler back office: Company & GST, suppliers, purchase orders, GRN, supplier payments,
// GST invoices, GST credit notes and reports. Every route refuses to run unless the industry is School.
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { isSchoolIndustry } from '../lib/school.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { all, bad, diffDays, industryProducts, num, r2, today, type Row } from '../lib/pharma-db.js';
import { isGstin } from '../lib/textile-invoice-math.js';
import { createSchoolCreditNote, createSchoolInvoice } from '../lib/school-gst.js';
import { cancelGrn, createGrn, createPurchaseOrder, createSupplierPayment, setPurchaseOrderStatus, supplierOutstanding } from '../lib/school-purchase.js';

export const schoolDistributorRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
type Req = Parameters<RequestHandler>[0];

const org = (req: Req) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };
const idOf = (req: Req) => { const v = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id; if (!v) throw new AppError(400, 'INVALID_ID', 'A record id is required.'); return v; };
const actorOf = (req: Req) => ((req as unknown as { auth?: { sub?: string } }).auth?.sub as string | undefined) ?? null;
const body = (req: Req): Row => { const b = req.body; if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('A JSON object body is required.'); return b as Row; };
const blank = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v ?? null);
/** The School industry id this request may use. Other industries get a 422. */
async function it(req: Req): Promise<string> {
  const requested = typeof req.query.industryTypeId === 'string' && req.query.industryTypeId ? req.query.industryTypeId : (typeof req.body?.industryTypeId === 'string' ? req.body.industryTypeId : (typeof req.body?.industry_type_id === 'string' ? req.body.industry_type_id : null));
  const id = resolveIndustryTypeId(req.industryScope!, requested);
  if (!id || !(await isSchoolIndustry(org(req), id))) throw new AppError(422, 'NOT_SCHOOL', 'This is only available in the School industry.');
  return id;
}
const route = (handler: (req: Req, res: Parameters<RequestHandler>[1], industry: string) => Promise<unknown>): RequestHandler => async (req, res, next) => {
  try { await handler(req, res, await it(req)); } catch (e) { next(e); }
};

// ------------------------------------------------------------------ Company & GST profile
const profileSchema = z.object({
  company_name: z.string().trim().min(1, 'Company name is required.').max(200),
  gstin: z.string().trim().toUpperCase().optional().nullable().or(z.literal('')),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN format is invalid (e.g. AABCM1234F).').optional().nullable().or(z.literal('')),
  address: z.string().trim().max(300).optional().nullable(), city: z.string().trim().max(100).optional().nullable(), state: z.string().trim().max(100).optional().nullable(),
  pincode: z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits.').optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(30).optional().nullable(), email: z.string().trim().email('Email address is not valid.').optional().nullable().or(z.literal('')),
  invoice_prefix: z.string().trim().regex(/^[A-Za-z0-9/-]{1,10}$/, 'Invoice prefix can use letters, digits, - and / (max 10).').optional().nullable().or(z.literal('')),
  bank_name: z.string().trim().max(100).optional().nullable(), bank_account: z.string().trim().max(40).optional().nullable(), bank_ifsc: z.string().trim().max(20).optional().nullable(),
  terms: z.string().trim().max(1000).optional().nullable(),
}).passthrough();

schoolDistributorRouter.get('/school/company-profile', authenticate, manager, route(async (req, res, industry) => {
  const { data, error } = await supabaseAdmin.from('school_company_profile').select('*').eq('organization_id', org(req)).eq('industry_type_id', industry).maybeSingle();
  if (error) throw error;
  res.json({ data });
}));
schoolDistributorRouter.put('/school/company-profile', authenticate, manager, route(async (req, res, industry) => {
  const input = profileSchema.parse(req.body ?? {});
  if (input.gstin && !isGstin(input.gstin)) throw bad('GSTIN format is invalid (15 characters, e.g. 33AABCM1234F1Z4).');
  const keys = ['company_name', 'gstin', 'pan', 'address', 'city', 'state', 'pincode', 'phone', 'email', 'invoice_prefix', 'bank_name', 'bank_account', 'bank_ifsc', 'terms'] as const;
  const row: Row = Object.fromEntries(keys.map((k) => [k, blank((input as Row)[k])]));
  row.invoice_prefix = row.invoice_prefix ?? 'INV';
  const { data, error } = await supabaseAdmin.from('school_company_profile')
    .upsert({ ...row, organization_id: org(req), industry_type_id: industry, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,industry_type_id' }).select().single();
  if (error) throw error;
  res.json({ data });
}));

// ------------------------------------------------------------------ Suppliers (publishers / manufacturers / wholesalers we buy from)
const SUPPLIER_COLS = ['supplier_code', 'supplier_name', 'contact_person', 'phone', 'email', 'gstin', 'address', 'city', 'state', 'payment_terms_days', 'notes', 'status'] as const;
function supplierRow(input: Row, partial: boolean): Row {
  const row: Row = {};
  for (const k of SUPPLIER_COLS) if (!partial || input[k] !== undefined) row[k] = k === 'payment_terms_days' ? Math.max(0, Math.round(num(input[k]))) : blank(input[k]);
  if (!partial && (!row.supplier_code || !row.supplier_name)) throw bad('supplier_code, supplier_name are required.');
  if (row.gstin && !isGstin(String(row.gstin))) throw bad('GSTIN format is invalid (15 characters).');
  if (row.status !== undefined && !['Active', 'Inactive'].includes(String(row.status))) throw bad('Status must be Active or Inactive.');
  if (row.status === null) delete row.status;
  return row;
}
schoolDistributorRouter.get('/school/suppliers', authenticate, manager, route(async (req, res, industry) => {
  res.json({ data: await all(() => supabaseAdmin.from('school_suppliers').select('*').eq('organization_id', org(req)).eq('industry_type_id', industry).order('created_at', { ascending: false })) });
}));
schoolDistributorRouter.post('/school/suppliers', authenticate, manager, route(async (req, res, industry) => {
  const { data, error } = await supabaseAdmin.from('school_suppliers').insert({ ...supplierRow(body(req), false), organization_id: org(req), industry_type_id: industry }).select().single();
  if (error) throw error.code === '23505' ? new AppError(409, 'DUPLICATE_RECORD', 'A supplier with this code already exists.') : error;
  res.status(201).json({ data });
}));
schoolDistributorRouter.patch('/school/suppliers/:id', authenticate, manager, route(async (req, res, industry) => {
  const { data, error } = await supabaseAdmin.from('school_suppliers').update(supplierRow(body(req), true)).eq('organization_id', org(req)).eq('industry_type_id', industry).eq('id', idOf(req)).select().maybeSingle();
  if (error) throw error.code === '23505' ? new AppError(409, 'DUPLICATE_RECORD', 'A supplier with this code already exists.') : error;
  if (!data) throw new AppError(404, 'RECORD_NOT_FOUND', 'Supplier was not found.');
  res.json({ data });
}));
schoolDistributorRouter.delete('/school/suppliers/:id', authenticate, manager, route(async (req, res, industry) => {
  const id = idOf(req);
  for (const table of ['school_purchase_orders', 'school_grns', 'school_supplier_payments']) {
    const { count } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', org(req)).eq('supplier_id', id);
    if ((count ?? 0) > 0) throw new AppError(409, 'SUPPLIER_IN_USE', 'This supplier has orders, receipts or payments, so it cannot be deleted. Set it to Inactive instead.');
  }
  const { error } = await supabaseAdmin.from('school_suppliers').delete().eq('organization_id', org(req)).eq('industry_type_id', industry).eq('id', id);
  if (error) throw error;
  res.json({ data: { id } });
}));

// ------------------------------------------------------------------ Purchase orders
schoolDistributorRouter.get('/school/purchase-orders', authenticate, manager, route(async (req, res, industry) => {
  res.json({ data: await all(() => supabaseAdmin.from('school_purchase_orders').select('*, school_suppliers(supplier_name, supplier_code)').eq('organization_id', org(req)).eq('industry_type_id', industry).order('created_at', { ascending: false })) });
}));
schoolDistributorRouter.post('/school/purchase-orders', authenticate, manager, route(async (req, res, industry) => {
  res.status(201).json({ data: await createPurchaseOrder(org(req), industry, body(req), actorOf(req)) });
}));
schoolDistributorRouter.patch('/school/purchase-orders/:id', authenticate, manager, route(async (req, res, industry) => {
  res.json({ data: await setPurchaseOrderStatus(org(req), industry, idOf(req), String(body(req).status ?? '')) });
}));

// ------------------------------------------------------------------ Goods receipt (GRN)
schoolDistributorRouter.get('/school/grns', authenticate, manager, route(async (req, res, industry) => {
  res.json({ data: await all(() => supabaseAdmin.from('school_grns').select('*, school_suppliers(supplier_name, supplier_code), school_purchase_orders(po_number)').eq('organization_id', org(req)).eq('industry_type_id', industry).order('created_at', { ascending: false })) });
}));
schoolDistributorRouter.post('/school/grns', authenticate, manager, route(async (req, res, industry) => {
  res.status(201).json({ data: await createGrn(org(req), industry, body(req), actorOf(req)) });
}));
schoolDistributorRouter.post('/school/grns/:id/cancel', authenticate, manager, route(async (req, res, industry) => {
  res.json({ data: await cancelGrn(org(req), industry, idOf(req)) });
}));

// ------------------------------------------------------------------ Supplier payments + payables
schoolDistributorRouter.get('/school/supplier-payments', authenticate, manager, route(async (req, res, industry) => {
  res.json({ data: await all(() => supabaseAdmin.from('school_supplier_payments').select('*, school_suppliers(supplier_name, supplier_code), school_grns(grn_number)').eq('organization_id', org(req)).eq('industry_type_id', industry).order('created_at', { ascending: false })) });
}));
schoolDistributorRouter.post('/school/supplier-payments', authenticate, manager, route(async (req, res, industry) => {
  res.status(201).json({ data: await createSupplierPayment(org(req), industry, body(req), actorOf(req)) });
}));
schoolDistributorRouter.delete('/school/supplier-payments/:id', authenticate, requireRoles('super_admin', 'admin'), route(async (req, res, industry) => {
  const { error } = await supabaseAdmin.from('school_supplier_payments').delete().eq('organization_id', org(req)).eq('industry_type_id', industry).eq('id', idOf(req));
  if (error) throw error;
  res.json({ data: { id: idOf(req) } });
}));
schoolDistributorRouter.get('/school/supplier-outstanding', authenticate, manager, route(async (req, res, industry) => {
  res.json({ data: await supplierOutstanding(org(req), industry) });
}));

// ------------------------------------------------------------------ GST sales invoices
schoolDistributorRouter.get('/school/invoices', authenticate, manager, route(async (req, res, industry) => {
  res.json({ data: await all(() => supabaseAdmin.from('school_invoices').select('*, clients(client_name, client_code), sale_orders(order_number)').eq('organization_id', org(req)).eq('industry_type_id', industry).order('created_at', { ascending: false })) });
}));
schoolDistributorRouter.get('/school/invoices/pending-orders', authenticate, manager, route(async (req, res, industry) => {
  const orders = await all(() => supabaseAdmin.from('sale_orders').select('id, order_number, total_amount, dispatch_status, status, clients!inner(client_name, industry_type_id)')
    .eq('organization_id', org(req)).eq('clients.industry_type_id', industry).in('dispatch_status', ['dispatched', 'delivered']).not('status', 'in', '(cancelled,rejected,draft,pending_approval)'));
  const invoiced = new Set((await all(() => supabaseAdmin.from('school_invoices').select('order_id').eq('organization_id', org(req)).eq('industry_type_id', industry).neq('status', 'Cancelled'))).map((r) => String(r.order_id)));
  res.json({ data: orders.filter((o) => !invoiced.has(String(o.id))).map((o) => ({ id: o.id, order_number: o.order_number, client_name: (Array.isArray(o.clients) ? o.clients[0] : o.clients)?.client_name ?? null, total_amount: o.total_amount, delivery_status: o.dispatch_status })) });
}));
schoolDistributorRouter.post('/school/invoices', authenticate, manager, route(async (req, res, industry) => {
  res.status(201).json({ data: await createSchoolInvoice(org(req), industry, String(body(req).orderId ?? ''), actorOf(req)) });
}));
schoolDistributorRouter.post('/school/invoices/:id/cancel', authenticate, manager, route(async (req, res, industry) => {
  const reason = String(body(req).reason ?? '').trim();
  if (!reason) throw bad('Enter the reason for cancelling.');
  const { count } = await supabaseAdmin.from('school_credit_notes').select('id', { count: 'exact', head: true }).eq('organization_id', org(req)).eq('invoice_id', idOf(req)).neq('status', 'Cancelled');
  if ((count ?? 0) > 0) throw bad('This invoice has credit notes. Cancel them first.');
  const { data, error } = await supabaseAdmin.from('school_invoices').update({ status: 'Cancelled', cancel_reason: reason }).eq('organization_id', org(req)).eq('industry_type_id', industry).eq('id', idOf(req)).eq('status', 'Issued').select().maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(404, 'RECORD_NOT_FOUND', 'Invoice was not found or is already cancelled.');
  res.json({ data });
}));

// ------------------------------------------------------------------ GST credit notes
schoolDistributorRouter.get('/school/credit-notes', authenticate, manager, route(async (req, res, industry) => {
  res.json({ data: await all(() => supabaseAdmin.from('school_credit_notes').select('*, clients(client_name, client_code), school_invoices(invoice_number)').eq('organization_id', org(req)).eq('industry_type_id', industry).order('created_at', { ascending: false })) });
}));
schoolDistributorRouter.post('/school/credit-notes', authenticate, manager, route(async (req, res, industry) => {
  const b = body(req);
  res.status(201).json({ data: await createSchoolCreditNote(org(req), industry, { invoiceId: String(b.invoiceId ?? ''), reason: String(b.reason ?? ''), lines: Array.isArray(b.lines) ? (b.lines as { index: number; quantity: number }[]) : [] }, actorOf(req)) });
}));
schoolDistributorRouter.post('/school/credit-notes/:id/cancel', authenticate, manager, route(async (req, res, industry) => {
  const { data, error } = await supabaseAdmin.from('school_credit_notes').update({ status: 'Cancelled' }).eq('organization_id', org(req)).eq('industry_type_id', industry).eq('id', idOf(req)).eq('status', 'Issued').select().maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(404, 'RECORD_NOT_FOUND', 'Credit note was not found or is already cancelled.');
  res.json({ data });
}));

// ------------------------------------------------------------------ Reports
// Receivables ageing: invoice total - returns credit on the order - money collected on the order, bucketed by days past the due date.
schoolDistributorRouter.get('/school/reports/receivables-ageing', authenticate, manager, route(async (req, res, industry) => {
  const invoices = await all(() => supabaseAdmin.from('school_invoices').select('id, invoice_number, order_id, client_id, invoice_date, due_date, total_amount, clients(client_name, client_code), sale_orders(returns_credit)').eq('organization_id', org(req)).eq('industry_type_id', industry).neq('status', 'Cancelled'));
  const orderIds = [...new Set(invoices.map((i) => String(i.order_id)))];
  const paid = new Map<string, number>();
  for (let i = 0; i < orderIds.length; i += 100) {
    const rows = await all(() => supabaseAdmin.from('collections').select('sale_order_id, amount').eq('organization_id', org(req)).in('sale_order_id', orderIds.slice(i, i + 100)));
    for (const c of rows) paid.set(String(c.sale_order_id), (paid.get(String(c.sale_order_id)) ?? 0) + num(c.amount));
  }
  const now = today();
  const rows = invoices.map((inv) => {
    const order = Array.isArray(inv.sale_orders) ? inv.sale_orders[0] : inv.sale_orders;
    const outstanding = r2(num(inv.total_amount) - num(order?.returns_credit) - (paid.get(String(inv.order_id)) ?? 0));
    const overdue = inv.due_date ? diffDays(now, String(inv.due_date)) : 0;
    const bucket = overdue <= 0 ? 'Not due' : overdue <= 30 ? '1-30' : overdue <= 60 ? '31-60' : overdue <= 90 ? '61-90' : '90+';
    const client = Array.isArray(inv.clients) ? inv.clients[0] : inv.clients;
    return { invoice_number: inv.invoice_number, client_name: client?.client_name ?? '', client_code: client?.client_code ?? '', invoice_date: inv.invoice_date, due_date: inv.due_date, total_amount: num(inv.total_amount), outstanding: outstanding < 1 ? 0 : outstanding, days_overdue: Math.max(0, overdue), bucket };
  }).filter((r) => r.outstanding > 0).sort((a, b) => b.days_overdue - a.days_overdue);
  const buckets: Record<string, number> = { 'Not due': 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const r of rows) buckets[r.bucket] = r2(buckets[r.bucket] + r.outstanding);
  res.json({ data: { rows, buckets, total: r2(rows.reduce((s, r) => s + r.outstanding, 0)) } });
}));

schoolDistributorRouter.get('/school/reports/low-stock', authenticate, manager, route(async (req, res, industry) => {
  const rows = (await industryProducts(org(req), industry))
    .filter((p) => p.stock_quantity !== null && p.stock_quantity !== undefined && p.min_stock_level !== null && p.min_stock_level !== undefined && num(p.stock_quantity) <= num(p.min_stock_level))
    .map((p) => ({ product_code: p.product_code, product_name: p.product_name, unit: p.unit, stock_quantity: num(p.stock_quantity), min_stock_level: num(p.min_stock_level), shortfall: r2(num(p.min_stock_level) - num(p.stock_quantity)) }))
    .sort((a, b) => b.shortfall - a.shortfall);
  res.json({ data: { rows } });
}));

// Movement register for one product: goods received (GRN) and goods dispatched to schools. Manual inventory
// adjustments and return restocks are not in this register, so the running net is not the shelf balance.
schoolDistributorRouter.get('/school/reports/stock-movements', authenticate, manager, route(async (req, res, industry) => {
  const productId = String(req.query.productId ?? '');
  const product = (await industryProducts(org(req), industry)).find((p) => String(p.id) === productId);
  if (!product) throw bad('Select a product.', 'INVALID_REFERENCE');
  const grns = await all(() => supabaseAdmin.from('school_grns').select('grn_number, received_date, lines').eq('organization_id', org(req)).eq('industry_type_id', industry).eq('status', 'Posted'));
  const moves: Row[] = [];
  for (const g of grns) for (const l of (g.lines ?? []) as Row[]) if (String(l.product_id) === productId) moves.push({ date: g.received_date, type: 'Goods received', ref: g.grn_number, quantity: num(l.quantity) });
  const sold = await all(() => supabaseAdmin.from('sale_order_items').select('quantity, free_quantity, sale_orders!inner(order_number, dispatch_status, school_dispatched_at, organization_id, clients!inner(client_name, industry_type_id))').eq('product_id', productId).eq('sale_orders.organization_id', org(req)));
  for (const s of sold) {
    const o = Array.isArray(s.sale_orders) ? s.sale_orders[0] : s.sale_orders; const c = Array.isArray(o?.clients) ? o.clients[0] : o?.clients;
    if (!o || c?.industry_type_id !== industry || !['dispatched', 'delivered'].includes(String(o.dispatch_status))) continue;
    moves.push({ date: String(o.school_dispatched_at ?? '').slice(0, 10) || null, type: 'Dispatched', ref: `${o.order_number} · ${c?.client_name ?? ''}`, quantity: -(num(s.quantity) + num(s.free_quantity)) });
  }
  moves.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
  let net = 0;
  const rows = moves.map((m) => { net = r2(net + num(m.quantity)); return { ...m, running_net: net }; });
  res.json({ data: { product: { product_code: product.product_code, product_name: product.product_name, stock_quantity: product.stock_quantity === null ? null : num(product.stock_quantity), min_stock_level: product.min_stock_level ?? null }, rows } });
}));

// GST sales register (GSTR-1 style): invoices less credit notes between two dates (default: this financial year).
schoolDistributorRouter.get('/school/reports/gst-register', authenticate, manager, route(async (req, res, industry) => {
  const t = today(); const fyStart = `${Number(t.slice(5, 7)) >= 4 ? t.slice(0, 4) : Number(t.slice(0, 4)) - 1}-04-01`;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from ?? '')) ? String(req.query.from) : fyStart;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to ?? '')) ? String(req.query.to) : t;
  const inv = await all(() => supabaseAdmin.from('school_invoices').select('invoice_number, invoice_date, supply_type, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, clients(client_name, gstin)').eq('organization_id', org(req)).eq('industry_type_id', industry).eq('status', 'Issued').gte('invoice_date', from).lte('invoice_date', to).order('invoice_date'));
  const cn = await all(() => supabaseAdmin.from('school_credit_notes').select('credit_note_number, note_date, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, clients(client_name, gstin)').eq('organization_id', org(req)).eq('industry_type_id', industry).eq('status', 'Issued').gte('note_date', from).lte('note_date', to).order('note_date'));
  const sum = (rows: Row[], k: string) => r2(rows.reduce((s, r) => s + num(r[k]), 0));
  const net = (k: string) => r2(sum(inv, k) - sum(cn, k));
  res.json({ data: { from, to, invoices: inv, creditNotes: cn, net: { taxable: net('taxable_amount'), cgst: net('cgst_amount'), sgst: net('sgst_amount'), igst: net('igst_amount'), total: net('total_amount') } } });
}));