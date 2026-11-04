/* eslint-disable @typescript-eslint/no-explicit-any */
// Pharma Distributor backend: Suppliers, Purchase Orders, GRN, Purchase Returns, Supplier Payments,
// Stock Ledger, Scan & Barcodes, GST Sales Invoices, Customer Outstanding, Reports, Distributor summary.
// Own tables (pharma_suppliers, pharma_purchase_orders, pharma_grn, ...). Nothing here touches other industries.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { todayLocal } from '../lib/ist-date.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { assertRecordInScope, resolveIndustryTypeId } from '../lib/industry-scope.js';
import { daysLeft, expiryStatus, isSellable, PHARMA_BLOCK_SALE_DAYS, tooShortShelfLife } from '../lib/pharma-rules.js';
import { getPharmaExpiryRules } from '../lib/settings.js';
import { changeBatchQty, syncProductStock } from './pharma.routes.js';
import { createPharmaInvoice } from '../lib/pharma-invoicing.js';
import { pendingCreditNotes, reissueCreditNotes } from '../lib/pharma-credit-notes.js';
import { serialized } from '../lib/serialize.js';
import { buildEInvoice } from '../lib/pharma-einvoice.js';
import { pharmaInvoicedByOrder } from '../lib/pharma-billing.js';
import { onPoOrdered } from '../services/pharma-automation-plus.service.js';

export const pharmaDistributorRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
const reader = requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative');

type Req = Parameters<RequestHandler>[0];
type Row = Record<string, any>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const r2 = (v: number) => Math.round(v * 100) / 100;
const today = () => todayLocal();
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const bad = (msg: string, code = 'VALIDATION_ERROR') => new AppError(400, code, msg);
const org = (req: Req) => {
  const v = req.header('x-organization-id');
  if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return v;
};
const idOf = (req: Req) => {
  const v = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!v) throw bad('A record id is required.', 'INVALID_ID');
  return v;
};
const actorOf = (req: Req) => ((req as unknown as { auth?: { sub?: string } }).auth?.sub as string | undefined) ?? null;
const scopeIt = (req: Req, v: unknown) => {
  const it = resolveIndustryTypeId(req.industryScope!, typeof v === 'string' && v ? v : null);
  if (!it) throw bad('industryTypeId is required.');
  return it;
};
const qIt = (req: Req) => scopeIt(req, req.query.industryTypeId);
const bIt = (req: Req) => scopeIt(req, (req.body ?? {}).industryTypeId);
const notFound = (what: string) => new AppError(404, 'RECORD_NOT_FOUND', `${what} was not found.`);

/** Loads every row of a query (Supabase returns at most 1000 per request). */
async function all(build: () => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function nextNo(table: string, field: string, orgId: string, prefix: string) {
  const { data, error } = await supabaseAdmin.from(table).select(field).eq('organization_id', orgId).like(field, `${prefix}%`);
  if (error) throw error;
  const top = Math.max(0, ...((data ?? []) as unknown as Row[]).map((x) => Number(/(\d+)$/.exec(String(x[field] ?? ''))?.[1] ?? 0)));
  return `${prefix}${String(top + 1).padStart(4, '0')}`;
}
async function insertNumbered(table: string, field: string, orgId: string, prefix: string, row: Row): Promise<Row> {
  for (let i = 0; i < 4; i += 1) {
    const no = await nextNo(table, field, orgId, prefix);
    const { data, error } = await supabaseAdmin.from(table).insert({ ...row, [field]: no, organization_id: orgId }).select().single();
    if (!error) return data as Row;
    if (error.code !== '23505') throw error;
  }
  throw new AppError(409, 'DUPLICATE_RECORD', 'Could not allocate a new number. Please try again.');
}
const gstTotals = (lines: Row[]) => {
  const subtotal = r2(lines.reduce((s, l) => s + num(l.quantity) * num(l.rate), 0));
  const tax = r2(lines.reduce((s, l) => s + (num(l.quantity) * num(l.rate) * num(l.gst_percent)) / 100, 0));
  return { subtotal, tax_amount: tax, total_amount: r2(subtotal + tax) };
};

// ---- products of the active industry -------------------------------------------
const PRODUCT_COLS = 'id, product_code, product_name, unit, cost_price, selling_price, tax_percent, hsn_code, min_stock_level, stock_quantity';
async function industryProductIds(orgId: string, it: string): Promise<string[]> {
  const rows = await all(() => supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', orgId).eq('industry_type_id', it));
  return rows.map((r) => r.product_id as string);
}
async function productMap(orgId: string, it: string, codes: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  const list = [...new Set(codes.filter(Boolean))];
  if (!list.length) return out;
  const { data, error } = await supabaseAdmin.from('products').select(PRODUCT_COLS).eq('organization_id', orgId).in('product_code', list);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return out;
  const { data: tags, error: e2 } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', orgId).eq('industry_type_id', it).in('product_id', rows.map((r) => r.id));
  if (e2) throw e2;
  const ok = new Set(((tags ?? []) as Row[]).map((t) => t.product_id));
  for (const p of rows) if (ok.has(p.id)) out.set(String(p.product_code), p);
  return out;
}

// ---- undo helper: if a multi-step post fails half way, everything already done is reversed ----
type Undo = () => Promise<void>;
async function runUndo(undo: Undo[]) { for (const u of [...undo].reverse()) { try { await u(); } catch { /* best effort */ } } }

// =============================================================== Company is in pharma.routes.ts

// =============================================================== Suppliers
const SUPPLIER_FIELDS = ['supplier_name', 'contact_person', 'phone', 'email', 'city', 'state', 'address', 'gstin', 'drug_license_number', 'drug_license_valid_till', 'payment_terms_days', 'status'];
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
function supplierPayload(body: Row, partial: boolean): Row {
  const out: Row = {};
  for (const k of SUPPLIER_FIELDS) if (k in body) { const v = body[k]; out[k] = typeof v === 'string' ? (v.trim() || null) : (v ?? null); }
  if ((!partial || 'supplier_name' in out) && !out.supplier_name) throw bad('Supplier name is required.');
  if (out.gstin) { out.gstin = String(out.gstin).toUpperCase(); if (!GSTIN_RE.test(out.gstin)) throw bad('Supplier GSTIN format is invalid (15 characters, e.g. 33AABCM1234F1Z4).'); }
  if (out.drug_license_valid_till && !isDate(out.drug_license_valid_till)) throw bad('Licence valid-till must be a valid date.');
  if (out.email && !/^\S+@\S+\.\S+$/.test(String(out.email))) throw bad('Email address is not valid.');
  if ('payment_terms_days' in out) {
    const n = out.payment_terms_days === null ? 30 : Number(out.payment_terms_days);
    if (Number.isNaN(n) || n < 0) throw bad('Payment terms must be zero or more days.');
    out.payment_terms_days = Math.round(n);
  }
  if ('status' in out) { out.status = out.status ?? 'active'; if (!['active', 'inactive'].includes(String(out.status))) throw bad('Status must be active or inactive.'); }
  return out;
}
async function getSupplier(orgId: string, it: string, id: unknown): Promise<Row> {
  if (!str(id)) throw bad('Select a supplier.');
  const { data, error } = await supabaseAdmin.from('pharma_suppliers').select('*').eq('organization_id', orgId).eq('id', String(id)).maybeSingle();
  if (error) throw error;
  if (!data || (data as Row).industry_type_id !== it) throw bad('That supplier does not exist in this industry.', 'INVALID_REFERENCE');
  return data as Row;
}
/** A supplier whose drug licence has run out cannot receive new orders or deliver goods. Not recorded = cannot be judged. */
function supplierLicenceProblem(sup: Row): string | null {
  const till = String(sup.drug_license_valid_till ?? '').slice(0, 10);
  return till && till < today() ? `${sup.supplier_name}: drug licence ${str(sup.drug_license_number) || '(no number)'} expired on ${till}. Update the supplier licence first.` : null;
}
pharmaDistributorRouter.get('/pharma/suppliers', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('pharma_suppliers').select('*').eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('supplier_name'));
  res.json({ data });
});
pharmaDistributorRouter.post('/pharma/suppliers', authenticate, manager, async (req, res) => {
  const it = bIt(req); const orgId = org(req);
  const p = supplierPayload((req.body ?? {}) as Row, false);
  const { data: same } = await supabaseAdmin.from('pharma_suppliers').select('id').eq('organization_id', orgId).eq('industry_type_id', it).ilike('supplier_name', String(p.supplier_name)).limit(1);
  if (same && same.length) throw new AppError(409, 'DUPLICATE_RECORD', `A supplier named ${p.supplier_name} already exists.`);
  const data = await insertNumbered('pharma_suppliers', 'supplier_code', orgId, 'SUP-', { ...p, status: p.status ?? 'active', payment_terms_days: p.payment_terms_days ?? 30, industry_type_id: it });
  res.status(201).json({ data });
});
pharmaDistributorRouter.patch('/pharma/suppliers/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const { data: ex, error } = await supabaseAdmin.from('pharma_suppliers').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (error) throw error;
  if (!ex) throw notFound('Supplier');
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound('Supplier'));
  const p = supplierPayload((req.body ?? {}) as Row, true);
  if (p.supplier_name && String(p.supplier_name).toLowerCase() !== String((ex as Row).supplier_name).toLowerCase()) {
    const { data: same } = await supabaseAdmin.from('pharma_suppliers').select('id').eq('organization_id', orgId).eq('industry_type_id', (ex as Row).industry_type_id).ilike('supplier_name', String(p.supplier_name)).neq('id', idOf(req)).limit(1);
    if (same && same.length) throw new AppError(409, 'DUPLICATE_RECORD', `A supplier named ${p.supplier_name} already exists.`);
  }
  const { data, error: e2 } = await supabaseAdmin.from('pharma_suppliers').update(p).eq('organization_id', orgId).eq('id', idOf(req)).select().single();
  if (e2) throw e2;
  res.json({ data });
});
pharmaDistributorRouter.delete('/pharma/suppliers/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req); const id = idOf(req);
  const { data: ex } = await supabaseAdmin.from('pharma_suppliers').select('*').eq('organization_id', orgId).eq('id', id).maybeSingle();
  if (!ex) throw notFound('Supplier');
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound('Supplier'));
  for (const [table, label] of [['pharma_purchase_orders', 'purchase order(s)'], ['pharma_grn', 'goods receipt(s)'], ['pharma_purchase_returns', 'purchase return(s)'], ['pharma_supplier_payments', 'payment(s)']] as const) {
    const { count } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('supplier_id', id);
    if (count) throw new AppError(409, 'RECORD_IN_USE', `This supplier has ${count} ${label}. Mark it Inactive instead of deleting.`);
  }
  const { error } = await supabaseAdmin.from('pharma_suppliers').delete().eq('organization_id', orgId).eq('id', id);
  if (error) throw error;
  res.json({ data: ex });
});

// =============================================================== Purchase Orders
pharmaDistributorRouter.get('/pharma/purchase-orders', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('pharma_purchase_orders').select('*, pharma_suppliers(supplier_name, supplier_code)').eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('created_at', { ascending: false }));
  res.json({ data });
});
pharmaDistributorRouter.post('/pharma/purchase-orders', authenticate, manager, async (req, res) => {
  const b = (req.body ?? {}) as Row; const it = bIt(req); const orgId = org(req);
  const status = b.status === 'Ordered' ? 'Ordered' : 'Draft';
  const sup = await getSupplier(orgId, it, b.supplier_id);
  if (sup.status !== 'active') throw bad(`${sup.supplier_name} is inactive and cannot receive new orders.`);
  { const lp = supplierLicenceProblem(sup); if (lp) throw bad(lp, 'SUPPLIER_LICENSE_EXPIRED'); }
  const raw = (Array.isArray(b.lines) ? b.lines : []).filter((l: Row) => str(l.product_code) || num(l.quantity) > 0);
  if (!raw.length) throw bad('Add at least one item to the order.');
  const orderDate = str(b.order_date) || today(); const expected = str(b.expected_date) || null;
  if (!isDate(orderDate)) throw bad('Order date is not valid.');
  if (expected && (!isDate(expected) || expected < orderDate)) throw bad('Expected delivery cannot be before the order date.');
  const products = await productMap(orgId, it, raw.map((l: Row) => str(l.product_code)));
  const lines = raw.map((l: Row, i: number) => {
    const p = products.get(str(l.product_code));
    if (!p) throw bad(`Item ${i + 1}: pick a product that exists in this industry.`);
    const quantity = Number(l.quantity); const rate = Number(l.rate === '' || l.rate == null ? p.cost_price ?? 0 : l.rate); const gst = Number(l.gst_percent === '' || l.gst_percent == null ? p.tax_percent ?? 0 : l.gst_percent);
    if (!(quantity > 0)) throw bad(`Item ${i + 1} (${p.product_name}): quantity must be more than zero.`);
    if (Number.isNaN(rate) || rate < 0) throw bad(`Item ${i + 1} (${p.product_name}): rate cannot be negative.`);
    if (Number.isNaN(gst) || gst < 0 || gst > 100) throw bad(`Item ${i + 1} (${p.product_name}): GST % must be between 0 and 100.`);
    return { product_code: p.product_code, product_name: p.product_name, quantity, received_quantity: 0, rate: r2(rate), gst_percent: gst };
  });
  const data = await insertNumbered('pharma_purchase_orders', 'po_number', orgId, `PO-${new Date().getFullYear()}-`, { industry_type_id: it, supplier_id: sup.id, order_date: orderDate, expected_date: expected, notes: str(b.notes) || null, status, lines, ...gstTotals(lines), created_by: actorOf(req) });
  res.status(201).json({ data });
});
pharmaDistributorRouter.patch('/pharma/purchase-orders/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const { data: ex } = await supabaseAdmin.from('pharma_purchase_orders').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Purchase order');
  const po = ex as Row;
  assertRecordInScope(req.industryScope!, po.industry_type_id, notFound('Purchase order'));
  const to = str((req.body ?? {}).status);
  const received = (po.lines as Row[]).reduce((s, l) => s + num(l.received_quantity), 0);
  if (to === 'Ordered') { if (po.status !== 'Draft') throw bad('Only a Draft order can be marked Ordered.'); }
  else if (to === 'Cancelled') {
    if (!['Draft', 'Ordered'].includes(po.status)) throw bad(`A ${po.status} order cannot be cancelled.`);
    if (received > 0) throw bad('Goods were already received against this order, so it cannot be cancelled.');
  } else if (to === 'Closed') { // short-close: the supplier will not deliver the rest, so the pending quantity stops counting as "on order"
    if (po.status !== 'Partially Received') throw bad('Only a Partially Received order can be closed. Cancel a Draft/Ordered order instead.');
  } else throw bad('Status must be Ordered, Cancelled or Closed.');
  const { data, error } = await supabaseAdmin.from('pharma_purchase_orders').update({ status: to }).eq('organization_id', orgId).eq('id', po.id).select().single();
  if (!error && to === 'Ordered') void onPoOrdered(orgId, String(po.industry_type_id), String(po.id)); // sends to the supplier when Auto-send is on
  if (error) throw error;
  res.json({ data });
});
pharmaDistributorRouter.delete('/pharma/purchase-orders/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const { data: ex } = await supabaseAdmin.from('pharma_purchase_orders').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Purchase order');
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound('Purchase order'));
  if ((ex as Row).status !== 'Draft') throw bad('Only a Draft purchase order can be deleted. Cancel it instead.');
  const { error } = await supabaseAdmin.from('pharma_purchase_orders').delete().eq('organization_id', orgId).eq('id', idOf(req));
  if (error) throw error;
  res.json({ data: ex });
});

// =============================================================== GRN (goods in -> creates / tops up batches)
pharmaDistributorRouter.get('/pharma/grn', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('pharma_grn').select('*, pharma_suppliers(supplier_name, supplier_code)').eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('created_at', { ascending: false }));
  res.json({ data });
});
pharmaDistributorRouter.post('/pharma/grn', authenticate, manager, (req, res, next) => {
  // two receipts against the same PO run one after the other, so both cannot count the same pending quantity
  const key = `grn-po:${str((req.body ?? {}).po_id) || str((req.body ?? {}).supplier_id)}`;
  serialized(key, () => grnPost(req, res)).catch(next);
});
async function grnPost(req: Req, res: any) {
  const b = (req.body ?? {}) as Row; const it = bIt(req); const orgId = org(req); const actor = actorOf(req);
  const sup = await getSupplier(orgId, it, b.supplier_id);
  if (sup.status !== 'active') throw bad(`${sup.supplier_name} is inactive. Make it Active before receiving goods.`);
  { const lp = supplierLicenceProblem(sup); if (lp) throw bad(lp, 'SUPPLIER_LICENSE_EXPIRED'); }
  const minShelfDays = Math.max(PHARMA_BLOCK_SALE_DAYS, (await getPharmaExpiryRules(orgId)).blockSaleWithinDaysOfExpiry);
  const grnDate = str(b.grn_date) || today();
  if (!isDate(grnDate)) throw bad('Received date is not valid.');
  let po: Row | null = null;
  if (str(b.po_id)) {
    const { data } = await supabaseAdmin.from('pharma_purchase_orders').select('*').eq('organization_id', orgId).eq('id', String(b.po_id)).maybeSingle();
    po = (data as Row) ?? null;
    if (!po || po.industry_type_id !== it) throw bad('That purchase order does not exist in this industry.', 'INVALID_REFERENCE');
    if (po.supplier_id !== sup.id) throw bad('That purchase order belongs to a different supplier.');
    if (!['Ordered', 'Partially Received'].includes(po.status)) throw bad(`Purchase order ${po.po_number} is ${po.status} and cannot receive goods.`);
  }
  const raw = (Array.isArray(b.lines) ? b.lines : []).filter((l: Row) => str(l.product_code) || str(l.batch_number) || num(l.quantity) > 0);
  if (!raw.length) throw bad('Add at least one received item.');
  const products = await productMap(orgId, it, raw.map((l: Row) => str(l.product_code)));
  const lines = raw.map((l: Row, i: number) => {
    const n = i + 1; const p = products.get(str(l.product_code));
    if (!p) throw bad(`Item ${n}: pick a product that exists in this industry.`);
    const batch = str(l.batch_number); if (!batch) throw bad(`Item ${n} (${p.product_name}): batch number is required.`);
    const expiry = str(l.expiry_date); if (!isDate(expiry)) throw bad(`Item ${n} (${p.product_name}): a valid expiry date is required.`);
    if (expiry < today()) throw bad(`Item ${n} (${p.product_name}): batch ${batch} is already expired and cannot be received.`);
    if (tooShortShelfLife(expiry, minShelfDays, today())) throw bad(`Item ${n} (${p.product_name}): batch ${batch} expires on ${expiry}, inside the ${minShelfDays}-day sale-block window, so it could never be sold. Return it to the supplier instead of receiving it.`, 'SHORT_SHELF_LIFE');
    const mfg = str(l.manufacture_date) || null;
    if (mfg && (!isDate(mfg) || mfg > expiry)) throw bad(`Item ${n} (${p.product_name}): manufacture date must be a valid date before the expiry.`);
    const quantity = Number(l.quantity || 0); const free = Number(l.free_quantity || 0);
    if (Number.isNaN(quantity) || Number.isNaN(free) || quantity < 0 || free < 0) throw bad(`Item ${n} (${p.product_name}): quantity cannot be negative.`);
    if (quantity + free <= 0) throw bad(`Item ${n} (${p.product_name}): enter a quantity.`);
    const rate = Number(l.rate === '' || l.rate == null ? p.cost_price ?? 0 : l.rate); const gst = Number(l.gst_percent === '' || l.gst_percent == null ? p.tax_percent ?? 0 : l.gst_percent);
    const mrp = l.mrp === '' || l.mrp == null ? null : Number(l.mrp);
    if (Number.isNaN(rate) || rate < 0) throw bad(`Item ${n} (${p.product_name}): rate cannot be negative.`);
    if (Number.isNaN(gst) || gst < 0 || gst > 100) throw bad(`Item ${n} (${p.product_name}): GST % must be between 0 and 100.`);
    if (mrp !== null && (Number.isNaN(mrp) || mrp < 0)) throw bad(`Item ${n} (${p.product_name}): MRP cannot be negative.`);
    return { product_code: p.product_code, product_name: p.product_name, unit: p.unit ?? null, batch_number: batch, manufacture_date: mfg, expiry_date: expiry, quantity, free_quantity: free, rate: r2(rate), mrp, gst_percent: gst };
  });
  // Against a PO: only items on the order, and never more than what is still pending.
  const poLines: Row[] | null = po ? (po.lines as Row[]).map((l) => ({ ...l })) : null;
  if (poLines) {
    const byCode = new Map<string, number>();
    for (const l of lines) byCode.set(l.product_code, (byCode.get(l.product_code) ?? 0) + l.quantity);
    for (const [code, qty] of byCode) {
      const pending = poLines.filter((l) => l.product_code === code).reduce((s, l) => s + num(l.quantity) - num(l.received_quantity), 0);
      if (!poLines.some((l) => l.product_code === code)) throw bad(`${code} is not on purchase order ${po!.po_number}.`);
      if (qty > pending + 1e-9) throw bad(`Only ${pending} unit(s) of ${code} are still pending on ${po!.po_number} (free units are not counted).`);
    }
  }
  const undo: Undo[] = []; const touched = new Set<string>();
  try {
    for (const l of lines) {
      const units = l.quantity + l.free_quantity;
      const { data: found, error } = await supabaseAdmin.from('pharma_batches').select('*').eq('organization_id', orgId).eq('batch_number', l.batch_number).maybeSingle();
      if (error) throw error;
      let batchId: string;
      if (found) {
        const ex = found as Row;
        if (ex.industry_type_id !== it || ex.product_code !== l.product_code) throw bad(`Batch ${l.batch_number} already exists for another product. Use a different batch number.`);
        if (String(ex.expiry_date).slice(0, 10) !== l.expiry_date) throw bad(`Batch ${l.batch_number} already exists with expiry ${String(ex.expiry_date).slice(0, 10)}. The expiry date must match.`);
        if (['Recalled', 'Quarantined'].includes(String(ex.status))) throw bad(`Batch ${l.batch_number} is ${ex.status}. Stock cannot be added to it.`);
        batchId = ex.id;
        const patch = { purchase_rate: l.rate, gst_percent: l.gst_percent, ...(l.mrp !== null ? { mrp: l.mrp } : {}) };
        const before = { purchase_rate: ex.purchase_rate ?? null, gst_percent: ex.gst_percent ?? null, mrp: ex.mrp ?? null };
        await supabaseAdmin.from('pharma_batches').update(patch).eq('organization_id', orgId).eq('id', batchId);
        undo.push(async () => { await supabaseAdmin.from('pharma_batches').update(before).eq('organization_id', orgId).eq('id', batchId); });
      } else {
        const { data: made, error: e2 } = await supabaseAdmin.from('pharma_batches').insert({
          organization_id: orgId, industry_type_id: it, batch_number: l.batch_number, product_code: l.product_code, product_name: l.product_name,
          manufacture_date: l.manufacture_date, expiry_date: l.expiry_date, quantity: 0, unit: l.unit, supplier: sup.supplier_name,
          status: expiryStatus(l.expiry_date), purchase_rate: l.rate, mrp: l.mrp, gst_percent: l.gst_percent,
        }).select('id').single();
        if (e2) throw e2;
        batchId = (made as Row).id;
        undo.push(async () => { await supabaseAdmin.from('pharma_stock_movements').delete().eq('organization_id', orgId).eq('batch_id', batchId); await supabaseAdmin.from('pharma_batches').delete().eq('organization_id', orgId).eq('id', batchId); });
      }
      await changeBatchQty(orgId, batchId, units, 'GRN', actor);
      if (found) undo.push(async () => { await changeBatchQty(orgId, batchId, -units, 'GRN reversed', actor); });
      touched.add(l.product_code);
    }
    const grn = await insertNumbered('pharma_grn', 'grn_number', orgId, `GRN-${new Date().getFullYear()}-`, {
      industry_type_id: it, supplier_id: sup.id, po_id: po?.id ?? null, grn_date: grnDate, supplier_invoice_no: str(b.supplier_invoice_no) || null,
      notes: str(b.notes) || null, status: 'Posted', lines, ...gstTotals(lines), created_by: actor,
    });
    if (po && poLines) {
      for (const l of lines) {
        let left = l.quantity;
        for (const pl of poLines.filter((x) => x.product_code === l.product_code)) {
          const room = num(pl.quantity) - num(pl.received_quantity); const take = Math.min(room, left);
          if (take > 0) { pl.received_quantity = num(pl.received_quantity) + take; left -= take; }
        }
      }
      const done = poLines.every((l) => num(l.received_quantity) + 1e-9 >= num(l.quantity));
      const { error } = await supabaseAdmin.from('pharma_purchase_orders').update({ lines: poLines, status: done ? 'Received' : 'Partially Received' }).eq('organization_id', orgId).eq('id', po.id);
      if (error) { await supabaseAdmin.from('pharma_grn').delete().eq('organization_id', orgId).eq('id', grn.id); throw error; }
    }
    for (const code of touched) await syncProductStock(orgId, it, code);
    res.status(201).json({ data: grn });
  } catch (e) {
    await runUndo(undo);
    for (const code of touched) await syncProductStock(orgId, it, code);
    throw e;
  }
}


// Cancel a posted GRN: takes its stock back out, rolls the PO back, and drops it from supplier payables. Only possible while the stock is still there and the supplier is not overpaid.
pharmaDistributorRouter.post('/pharma/grn/:id/cancel', authenticate, manager, async (req, res) => {
  const orgId = org(req); const actor = actorOf(req);
  const reason = str((req.body ?? {}).reason);
  if (!reason) throw bad('Enter a reason for cancelling this goods receipt.');
  const { data: ex } = await supabaseAdmin.from('pharma_grn').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Goods receipt');
  const grn = ex as Row; const it = String(grn.industry_type_id);
  assertRecordInScope(req.industryScope!, grn.industry_type_id, notFound('Goods receipt'));
  if (grn.status === 'Cancelled') throw bad('This goods receipt is already cancelled.');
  const lines = (grn.lines ?? []) as Row[];
  const need = new Map<string, number>();
  for (const l of lines) need.set(str(l.batch_number), (need.get(str(l.batch_number)) ?? 0) + num(l.quantity) + num(l.free_quantity));
  const { data: bs, error: be } = await supabaseAdmin.from('pharma_batches').select('id, batch_number, product_code, quantity').eq('organization_id', orgId).eq('industry_type_id', it).in('batch_number', [...need.keys()]);
  if (be) throw be;
  const batch = new Map(((bs ?? []) as Row[]).map((b) => [String(b.batch_number), b]));
  for (const [bn, units] of need) {
    const b = batch.get(bn);
    if (!b) throw new AppError(409, 'RECORD_IN_USE', `Batch ${bn} no longer exists, so this receipt cannot be cancelled.`);
    if (num(b.quantity) + 1e-9 < units) throw new AppError(409, 'RECORD_IN_USE', `Batch ${bn} has only ${num(b.quantity)} unit(s) left but this receipt added ${units}. Part of it was already sold or moved, so the receipt cannot be cancelled. Use a Purchase Return for the rest.`);
  }
  const bal = (await supplierBalances(orgId, it)).find((x) => x.supplier_id === grn.supplier_id);
  if (bal && num(bal.outstanding) - num(grn.total_amount) < -0.005) throw new AppError(409, 'RECORD_IN_USE', `Cancelling this receipt would leave ${bal.supplier_name} overpaid by ${r2(num(grn.total_amount) - num(bal.outstanding))}. Payments already made against it must be settled first.`);

  const undo: Undo[] = []; const touched = new Set<string>();
  try {
    // claim first, so a double click can never take the stock out twice
    const { data: claimed, error: ce } = await supabaseAdmin.from('pharma_grn').update({ status: 'Cancelled', cancel_reason: reason, cancelled_at: new Date().toISOString() }).eq('organization_id', orgId).eq('id', grn.id).neq('status', 'Cancelled').select().maybeSingle();
    if (ce) throw ce;
    if (!claimed) throw bad('This goods receipt is already cancelled.');
    undo.push(async () => { await supabaseAdmin.from('pharma_grn').update({ status: grn.status, cancel_reason: null, cancelled_at: null }).eq('organization_id', orgId).eq('id', grn.id); });
    for (const [bn, units] of need) {
      const b = batch.get(bn)!;
      await changeBatchQty(orgId, b.id, -units, `GRN ${grn.grn_number} cancelled`, actor);
      undo.push(async () => { await changeBatchQty(orgId, b.id, units, 'GRN cancel reversed', actor); });
      touched.add(String(b.product_code));
    }
    if (grn.po_id) {
      const { data: pr } = await supabaseAdmin.from('pharma_purchase_orders').select('*').eq('organization_id', orgId).eq('id', grn.po_id).maybeSingle();
      const po = pr as Row | null;
      if (po) {
        const before = { lines: po.lines, status: po.status };
        const poLines = (po.lines as Row[]).map((l) => ({ ...l }));
        for (const l of lines) {
          let left = num(l.quantity);
          for (const pl of poLines.filter((x) => x.product_code === l.product_code)) { const take = Math.min(num(pl.received_quantity), left); if (take > 0) { pl.received_quantity = num(pl.received_quantity) - take; left -= take; } }
        }
        const status = ['Closed', 'Cancelled'].includes(po.status) ? po.status : poLines.some((l) => num(l.received_quantity) > 1e-9) ? 'Partially Received' : 'Ordered';
        const { error: pe } = await supabaseAdmin.from('pharma_purchase_orders').update({ lines: poLines, status }).eq('organization_id', orgId).eq('id', po.id);
        if (pe) throw pe;
        undo.push(async () => { await supabaseAdmin.from('pharma_purchase_orders').update(before).eq('organization_id', orgId).eq('id', po.id); });
      }
    }
    for (const code of touched) await syncProductStock(orgId, it, code);
    res.json({ data: claimed });
  } catch (e) {
    await runUndo(undo);
    for (const code of touched) await syncProductStock(orgId, it, code);
    throw e;
  }
});

/** supplier_id -> units delivered for one batch, from live (not cancelled) goods receipts. */
async function receivedFromSupplier(orgId: string, it: string, batchNo: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await all(() => supabaseAdmin.from('pharma_grn').select('supplier_id, lines').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled'));
  for (const g of rows) for (const l of (g.lines ?? []) as Row[]) if (str(l.batch_number) === batchNo) out.set(String(g.supplier_id), (out.get(String(g.supplier_id)) ?? 0) + num(l.quantity) + num(l.free_quantity));
  return out;
}
// =============================================================== Purchase Returns (goods back to supplier)
pharmaDistributorRouter.get('/pharma/purchase-returns', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('pharma_purchase_returns').select('*, pharma_suppliers(supplier_name, supplier_code)').eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('created_at', { ascending: false }));
  res.json({ data });
});
pharmaDistributorRouter.post('/pharma/purchase-returns', authenticate, manager, (req, res, next) => {
  // two returns for the same supplier run one after the other, so both cannot count the same "still returnable" quantity
  serialized(`prt:${str((req.body ?? {}).supplier_id)}`, () => purchaseReturnPost(req, res)).catch(next);
});
async function purchaseReturnPost(req: Req, res: any) {
  const b = (req.body ?? {}) as Row; const it = bIt(req); const orgId = org(req); const actor = actorOf(req);
  const sup = await getSupplier(orgId, it, b.supplier_id);
  const retDate = str(b.return_date) || today();
  if (!isDate(retDate)) throw bad('Return date is not valid.');
  const raw = (Array.isArray(b.lines) ? b.lines : []).filter((l: Row) => str(l.batch_number) || num(l.quantity) > 0);
  if (!raw.length) throw bad('Add at least one returned item.');
  const wanted = new Map<string, number>();
  const lines: Row[] = []; const batches = new Map<string, Row>();
  for (const [i, l] of raw.entries()) {
    const n = i + 1; const bn = str(l.batch_number); if (!bn) throw bad(`Item ${n}: select a batch.`);
    let batch = batches.get(bn);
    if (!batch) {
      const { data } = await supabaseAdmin.from('pharma_batches').select('*').eq('organization_id', orgId).eq('industry_type_id', it).eq('batch_number', bn).maybeSingle();
      if (!data) throw bad(`Item ${n}: batch ${bn} does not exist in this industry.`, 'INVALID_REFERENCE');
      batch = data as Row; batches.set(bn, batch);
      const got = await receivedFromSupplier(orgId, it, bn);
      if (got.size) { // proven by goods-receipt history
        if (!got.has(String(sup.id))) throw bad(`Item ${n}: batch ${bn} was not received from ${sup.supplier_name}. Select the supplier it came from.`);
      } else if (!str(batch.supplier)) throw bad(`Item ${n}: batch ${bn} has no goods receipt and no supplier recorded, so it cannot be returned to ${sup.supplier_name}. Set the supplier on the batch first.`);
      else if (str(batch.supplier).toLowerCase() !== String(sup.supplier_name).toLowerCase()) throw bad(`Item ${n}: batch ${bn} was supplied by ${str(batch.supplier)}, not ${sup.supplier_name}. Select the correct supplier.`);
      const delivered = got.get(String(sup.id)) ?? 0;
      if (delivered > 0) {
        const { data: prior } = await supabaseAdmin.from('pharma_purchase_returns').select('lines').eq('organization_id', orgId).eq('industry_type_id', it).eq('supplier_id', sup.id);
        const sent = ((prior ?? []) as Row[]).flatMap((r) => (r.lines ?? []) as Row[]).filter((x) => str(x.batch_number) === bn).reduce((t, x) => t + num(x.quantity), 0);
        const q = Number(l.quantity);
        if (q > 0 && q + sent > delivered + 1e-9) throw bad(`Item ${n}: ${sup.supplier_name} delivered ${delivered} unit(s) of batch ${bn} and ${sent} were already returned, so only ${Math.max(delivered - sent, 0)} can still go back.`);
      }
    }
    const quantity = Number(l.quantity); if (!(quantity > 0)) throw bad(`Item ${n}: quantity must be more than zero.`);
    wanted.set(bn, (wanted.get(bn) ?? 0) + quantity);
    if ((wanted.get(bn) ?? 0) > num(batch.quantity)) throw bad(`Batch ${bn} has only ${num(batch.quantity)} unit(s) in stock.`);
    const rate = Number(l.rate === '' || l.rate == null ? batch.purchase_rate ?? 0 : l.rate); const gst = Number(l.gst_percent === '' || l.gst_percent == null ? batch.gst_percent ?? 0 : l.gst_percent);
    if (Number.isNaN(rate) || rate < 0) throw bad(`Item ${n}: rate cannot be negative.`);
    if (Number.isNaN(gst) || gst < 0 || gst > 100) throw bad(`Item ${n}: GST % must be between 0 and 100.`);
    lines.push({ product_code: batch.product_code, product_name: batch.product_name, batch_number: bn, quantity, rate: r2(rate), gst_percent: gst });
  }
  const undo: Undo[] = []; const touched = new Set<string>();
  try {
    const ret = await insertNumbered('pharma_purchase_returns', 'return_number', orgId, `PRT-${new Date().getFullYear()}-`, {
      industry_type_id: it, supplier_id: sup.id, return_date: retDate, reason: str(b.reason) || null, status: 'Posted', lines, ...gstTotals(lines), created_by: actor,
    });
    undo.push(async () => { await supabaseAdmin.from('pharma_purchase_returns').delete().eq('organization_id', orgId).eq('id', ret.id); });
    for (const l of lines) {
      const batch = batches.get(l.batch_number)!;
      await changeBatchQty(orgId, batch.id, -l.quantity, `Purchase return ${ret.return_number}`, actor);
      undo.push(async () => { await changeBatchQty(orgId, batch.id, l.quantity, 'Purchase return reversed', actor); });
      touched.add(String(batch.product_code));
    }
    for (const code of touched) await syncProductStock(orgId, it, code);
    res.status(201).json({ data: ret });
  } catch (e) { await runUndo(undo); for (const code of touched) await syncProductStock(orgId, it, code); throw e; }
}

// =============================================================== Supplier balances and payments
async function supplierBalances(orgId: string, it: string): Promise<Row[]> {
  const [sups, grns, rets, pays] = await Promise.all([
    all(() => supabaseAdmin.from('pharma_suppliers').select('id, supplier_code, supplier_name').eq('organization_id', orgId).eq('industry_type_id', it).order('supplier_name')),
    all(() => supabaseAdmin.from('pharma_grn').select('supplier_id, total_amount').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled')),
    all(() => supabaseAdmin.from('pharma_purchase_returns').select('supplier_id, accepted_amount').eq('organization_id', orgId).eq('industry_type_id', it).eq('status', 'Accepted')),
all(() => supabaseAdmin.from('pharma_supplier_payments').select('supplier_id, amount').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled')),
  ]);
  const sum = (rows: Row[], key: string) => { const m = new Map<string, number>(); for (const r of rows) m.set(r.supplier_id, (m.get(r.supplier_id) ?? 0) + num(r[key])); return m; };
  const g = sum(grns, 'total_amount'); const r = sum(rets, 'accepted_amount'); const p = sum(pays, 'amount');
  return sups.map((s) => {
    const purchased = r2(g.get(s.id) ?? 0); const returned = r2(r.get(s.id) ?? 0); const paid = r2(p.get(s.id) ?? 0);
    return { supplier_id: s.id, supplier_code: s.supplier_code, supplier_name: s.supplier_name, purchased, returned, paid, outstanding: r2(purchased - returned - paid) };
  });
}
pharmaDistributorRouter.get('/pharma/supplier-outstanding', authenticate, manager, async (req, res) => {
  res.json({ data: await supplierBalances(org(req), qIt(req)) });
});
pharmaDistributorRouter.get('/pharma/supplier-payments', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('pharma_supplier_payments').select('*, pharma_suppliers(supplier_name, supplier_code), pharma_grn(grn_number)').eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('created_at', { ascending: false }));
  res.json({ data });
});
const PAY_MODES  = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Other'];
pharmaDistributorRouter.post('/pharma/supplier-payments', authenticate, manager, (req, res, next) => {
  serialized(`spy:${str((req.body ?? {}).supplier_id)}`, () => supplierPaymentPost(req, res)).catch(next); // balance check + insert must not interleave
});
async function supplierPaymentPost(req: Req, res: any) {
  const b = (req.body ?? {}) as Row; const it = bIt(req); const orgId = org(req);
  const sup = await getSupplier(orgId, it, b.supplier_id);
  const amount = Number(b.amount); if (!(amount > 0)) throw bad('Payment amount must be more than zero.');
  const mode = str(b.mode); if (!PAY_MODES.includes(mode)) throw bad(`Payment mode must be one of: ${PAY_MODES.join(', ')}.`);
  const date = str(b.payment_date) || today(); if (!isDate(date)) throw bad('Payment date is not valid.');
  const bal = (await supplierBalances(orgId, it)).find((x) => x.supplier_id === sup.id);
  if (amount > num(bal?.outstanding) + 0.005) throw bad(`Payment ${r2(amount)} is more than the ${r2(num(bal?.outstanding))} still owed to ${sup.supplier_name}.`);
  // Optional: pay a specific supplier bill (GRN). Without it the payment is applied to the oldest open bill first (Automation > supplier bills).
  let grnId: string | null = null;
  if (str(b.grn_id)) {
    const { data: g } = await supabaseAdmin.from('pharma_grn').select('id, grn_number, supplier_id, total_amount, status').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', str(b.grn_id)).maybeSingle();
    const grn = g as Row | null;
    if (!grn || grn.supplier_id !== sup.id) throw bad('Pick a bill (GRN) that belongs to this supplier.', 'INVALID_REFERENCE');
    if (grn.status === 'Cancelled') throw bad(`GRN ${grn.grn_number} is cancelled and cannot be paid.`);
    const onBill = await all(() => supabaseAdmin.from('pharma_supplier_payments').select('amount').eq('organization_id', orgId).eq('grn_id', grn.id).neq('status', 'Cancelled'));
    const left = r2(num(grn.total_amount) - onBill.reduce((t, x) => t + num(x.amount), 0));
    if (amount > left + 0.005) throw bad(`Payment ${r2(amount)} is more than the ${left} still open on ${grn.grn_number}.`);
    grnId = grn.id as string;
  }
  const data = await insertNumbered('pharma_supplier_payments', 'payment_number', orgId, `SPY-${new Date().getFullYear()}-`, { industry_type_id: it, supplier_id: sup.id, grn_id: grnId, amount: r2(amount), mode, payment_date: date, reference_no: str(b.reference_no) || null, created_by: actorOf(req) });
  res.status(201).json({ data });
}
// A wrong payment is cancelled (kept for audit, no longer counted): the supplier balance and the bill go back up.
pharmaDistributorRouter.post('/pharma/supplier-payments/:id/cancel', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const reason = str((req.body ?? {}).reason);
  if (!reason) throw bad('Enter a reason for cancelling this payment.');
  const { data: ex } = await supabaseAdmin.from('pharma_supplier_payments').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Payment');
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound('Payment'));
  if ((ex as Row).status === 'Cancelled') throw bad('This payment is already cancelled.');
  const { data, error } = await supabaseAdmin.from('pharma_supplier_payments').update({ status: 'Cancelled', cancel_reason: reason, cancelled_at: new Date().toISOString() }).eq('organization_id', orgId).eq('id', idOf(req)).select().single();
  if (error) throw error;
  res.json({ data });
});

// =============================================================== Stock ledger
// Batches whose stock no longer equals the sum of their ledger movements (a lost audit row or a manual DB edit). Empty list = ledger is complete.
pharmaDistributorRouter.get('/pharma/stock-ledger/check', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = qIt(req);
  const batches = await all(() => supabaseAdmin.from('pharma_batches').select('id, batch_number, product_name, quantity').eq('organization_id', orgId).eq('industry_type_id', it));
  const sums = new Map<string, number>();
  const mv = await all(() => supabaseAdmin.from('pharma_stock_movements').select('batch_id, delta').eq('organization_id', orgId));
  for (const m of mv) sums.set(String(m.batch_id), (sums.get(String(m.batch_id)) ?? 0) + num(m.delta));
  const drift = batches.map((b) => ({ batch_number: b.batch_number, product_name: b.product_name, stock: num(b.quantity), ledger: r2(sums.get(String(b.id)) ?? 0), difference: r2(num(b.quantity) - (sums.get(String(b.id)) ?? 0)) })).filter((d) => Math.abs(d.difference) > 0.005);
  res.json({ data: drift });
});
pharmaDistributorRouter.get('/pharma/stock-ledger', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = qIt(req);
  const batches = await all(() => supabaseAdmin.from('pharma_batches').select('id, product_name, product_code').eq('organization_id', orgId).eq('industry_type_id', it));
  const byId = new Map(batches.map((b) => [b.id as string, b]));
   const ids = [...byId.keys()]; const found: Row[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('pharma_stock_movements').select('*').eq('organization_id', orgId).in('batch_id', ids.slice(i, i + 100)).order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    found.push(...((data ?? []) as Row[]));
  }
  found.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const rows = found.filter((m) => byId.has(m.batch_id)).slice(0, 500).map((m) => ({ ...m, product_name: byId.get(m.batch_id)!.product_name, product_code: byId.get(m.batch_id)!.product_code }));
  res.json({ data: rows });
});

// =============================================================== Scan & Barcodes
pharmaDistributorRouter.get('/pharma/scan', authenticate, reader, async (req, res) => {
  const orgId = org(req); const it = qIt(req); const code = str(req.query.code);
  if (!code) { res.json({ data: null }); return; }
  const { data: link } = await supabaseAdmin.from('pharma_barcodes').select('product_code').eq('organization_id', orgId).eq('industry_type_id', it).eq('barcode', code).maybeSingle();
  const productCode = (link as Row | null)?.product_code ?? code;
  const product = (await productMap(orgId, it, [String(productCode)])).get(String(productCode));
  if (!product) { res.json({ data: null }); return; }
  const minDays = Math.max(PHARMA_BLOCK_SALE_DAYS, (await getPharmaExpiryRules(orgId)).blockSaleWithinDaysOfExpiry);
  const { data: bs, error } = await supabaseAdmin.from('pharma_batches').select('*').eq('organization_id', orgId).eq('industry_type_id', it).eq('product_code', product.product_code).gt('quantity', 0).order('expiry_date', { ascending: true });
  if (error) throw error;
  const batches = ((bs ?? []) as Row[]).map((x) => ({ batch_number: x.batch_number, manufacture_date: x.manufacture_date, expiry_date: x.expiry_date, days_left: daysLeft(x.expiry_date), quantity: num(x.quantity), mrp: x.mrp ?? null, sellable: isSellable(x, today(), minDays) }));
  res.json({ data: { product, batches } });
});
pharmaDistributorRouter.post('/pharma/barcodes', authenticate, manager, async (req, res) => {
  const b = (req.body ?? {}) as Row; const orgId = org(req); const it = bIt(req);
  const barcode = str(b.barcode); const code = str(b.product_code);
  if (!barcode) throw bad('Barcode is required.');
  if (barcode.length > 64) throw bad('Barcode is too long.');
  const product = (await productMap(orgId, it, [code])).get(code);
  if (!product) throw bad('Pick a product that exists in this industry.', 'INVALID_REFERENCE');
  const { data: ex } = await supabaseAdmin.from('pharma_barcodes').select('product_code').eq('organization_id', orgId).eq('industry_type_id', it).eq('barcode', barcode).maybeSingle();
  if (ex && (ex as Row).product_code !== code) throw new AppError(409, 'DUPLICATE_RECORD', `Barcode ${barcode} is already linked to ${(ex as Row).product_code}.`);
  if (!ex) { const { error } = await supabaseAdmin.from('pharma_barcodes').insert({ organization_id: orgId, industry_type_id: it, barcode, product_code: code }); if (error) throw error; }
  res.status(201).json({ data: { barcode, product_code: code } });
});

// =============================================================== Customer outstanding & ageing
async function customerBalances(orgId: string, it: string): Promise<Row[]> {
  const orders = await all(() => supabaseAdmin.from('sale_orders')
    .select('id, client_id, total_amount, created_at, status, clients!inner(client_code, client_name, industry_type_id, credit_limit)')
    .eq('organization_id', orgId).eq('clients.industry_type_id', it).not('status', 'in', '("cancelled","rejected","draft","pending_approval")').order('created_at', { ascending: false }));
  const ids = orders.map((o) => o.id as string);
 const invoiced = await pharmaInvoicedByOrder(orgId, ids);
  // Ageing counts days past the live invoice's due date (same rule as the payment reminders); orders with no invoice yet fall back to the order date.
  const dueByOrder = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data: invs } = await supabaseAdmin.from('pharma_invoices').select('order_id, due_date, invoice_date').eq('organization_id', orgId).neq('status', 'Cancelled').in('order_id', ids.slice(i, i + 100));
    for (const x of (invs ?? []) as Row[]) { const d = String(x.due_date ?? x.invoice_date ?? '').slice(0, 10); const k = String(x.order_id); if (d && (!dueByOrder.has(k) || d < (dueByOrder.get(k) as string))) dueByOrder.set(k, d); }
  }
  const paid = new Map<string, number>(); const credit = new Map<string, number>(); const back = new Map<string, number>();
  const add = (m: Map<string, number>, k: unknown, v: unknown) => m.set(String(k), (m.get(String(k)) ?? 0) + num(v));
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [c, r, f] = await Promise.all([
      supabaseAdmin.from('sales_collections').select('sale_order_id, amount').eq('organization_id', orgId).in('sale_order_id', chunk),
      supabaseAdmin.from('sales_returns').select('order_id, credit_amount').eq('organization_id', orgId).eq('status', 'approved').in('order_id', chunk),
      supabaseAdmin.from('sales_refunds').select('order_id, amount').eq('organization_id', orgId).in('order_id', chunk),
    ]);
    if (c.error) throw c.error;
    if (r.error && !/sales_returns/.test(r.error.message)) throw r.error;
    if (f.error && !/sales_refunds/.test(f.error.message)) throw f.error;
    for (const x of (c.data ?? []) as Row[]) add(paid, x.sale_order_id, x.amount);
    for (const x of (r.data ?? []) as Row[]) add(credit, x.order_id, x.credit_amount);
    for (const x of (f.data ?? []) as Row[]) add(back, x.order_id, x.amount);
  }
  const now = Date.now(); const out = new Map<string, Row>();
  for (const o of orders) {
    const cl = Array.isArray(o.clients) ? o.clients[0] : o.clients;
    const e = out.get(o.client_id) ?? { client_id: o.client_id, client_code: cl?.client_code, client_name: cl?.client_name, billed: 0, collected: 0, credit_notes: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0, outstanding: 0, credit_limit: num(cl?.credit_limit), over_limit: false };
    const total = Math.max(num(o.total_amount), invoiced.get(o.id) ?? 0); const col = paid.get(o.id) ?? 0; const cr = credit.get(o.id) ?? 0; const rf = back.get(o.id) ?? 0;
    const open = total - col - cr + rf;
    e.billed += total; e.collected += col; e.credit_notes += cr; e.outstanding += open;
    if (open > 0.005) {
   const dueIso = dueByOrder.get(String(o.id)); const age = dueIso ? Math.max(0, Math.floor((now - Date.parse(dueIso)) / 86_400_000)) : Math.floor((now - Date.parse(String(o.created_at))) / 86_400_000);
      const k = age <= 30 ? 'b0_30' : age <= 60 ? 'b31_60' : age <= 90 ? 'b61_90' : 'b90_plus';
      e[k] += open;
    }
    out.set(o.client_id, e);
  }
  return [...out.values()].map((e) => {
    for (const k of ['billed', 'collected', 'credit_notes', 'b0_30', 'b31_60', 'b61_90', 'b90_plus', 'outstanding']) e[k] = r2(e[k]);
    e.over_limit = e.credit_limit > 0 && e.outstanding > e.credit_limit;
    return e;
  }).sort((a, b) => b.outstanding - a.outstanding);
}
pharmaDistributorRouter.get('/pharma/customer-outstanding', authenticate, manager, async (req, res) => {
  res.json({ data: await customerBalances(org(req), qIt(req)) });
});

// =============================================================== GST Sales Invoices
/** Adds paid_amount / balance_amount / payment_status to invoices. Payments live in Collections by order; approved credit notes and refunds adjust the balance exactly like Customer Outstanding. */
async function withPaymentStatus(orgId: string, invoices: Row[]): Promise<Row[]> {
  try {
    const orderIds = [...new Set(invoices.map((i) => String(i.order_id)))];
    const paid = new Map<string, number>(); const credit = new Map<string, number>(); const back = new Map<string, number>();
    const add = (m: Map<string, number>, k: unknown, v: unknown) => m.set(String(k), (m.get(String(k)) ?? 0) + num(v));
    for (let i = 0; i < orderIds.length; i += 100) {
      const chunk = orderIds.slice(i, i + 100);
      const [c, r, f] = await Promise.all([
        supabaseAdmin.from('sales_collections').select('sale_order_id, amount').eq('organization_id', orgId).in('sale_order_id', chunk),
        supabaseAdmin.from('sales_returns').select('order_id, credit_amount').eq('organization_id', orgId).eq('status', 'approved').in('order_id', chunk),
        supabaseAdmin.from('sales_refunds').select('order_id, amount').eq('organization_id', orgId).in('order_id', chunk),
      ]);
      if (c.error) throw c.error;
      for (const x of (c.data ?? []) as Row[]) add(paid, x.sale_order_id, x.amount);
      if (!r.error) for (const x of (r.data ?? []) as Row[]) add(credit, x.order_id, x.credit_amount);
      if (!f.error) for (const x of (f.data ?? []) as Row[]) add(back, x.order_id, x.amount);
    }
    const t = today();
    return invoices.map((i) => {
      if (i.status === 'Cancelled') return { ...i, paid_amount: 0, balance_amount: 0, payment_status: 'Cancelled' };
      const k = String(i.order_id); const total = num(i.total_amount);
      const settled = r2(num(paid.get(k)) + num(credit.get(k)) - num(back.get(k)));
      const balance = r2(Math.max(0, total - settled));
      const due = String(i.due_date ?? i.invoice_date ?? '').slice(0, 10);
      const payment_status = balance <= 0.005 ? 'Paid' : due && due < t ? 'Overdue' : settled > 0.005 ? 'Partial' : 'Unpaid';
      return { ...i, paid_amount: Math.min(total, Math.max(0, settled)), balance_amount: balance, payment_status };
    });
  } catch { return invoices; } // best effort: the list still loads without payment status
}
pharmaDistributorRouter.get('/pharma/invoices', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('pharma_invoices').select('*, clients(client_name, client_code)').eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('created_at', { ascending: false }));
  res.json({ data: await withPaymentStatus(org(req), data) });
});
pharmaDistributorRouter.get('/pharma/invoices/:id', authenticate, manager, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('pharma_invoices').select('*, clients(*)').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Invoice');
  assertRecordInScope(req.industryScope!, (data as Row).industry_type_id, notFound('Invoice'));
  res.json({ data });
});
pharmaDistributorRouter.post('/pharma/invoices', authenticate, manager, async (req, res) => {
  const it = bIt(req);
  const data = await serialized(`inv:${str((req.body ?? {}).order_id)}`, () => createPharmaInvoice(org(req), it, str((req.body ?? {}).order_id), actorOf(req), { requireDispatched: (req.body ?? {}).allow_before_dispatch !== true })); // two clicks cannot issue two invoices
  try { await reissueCreditNotes(org(req), it, actorOf(req)); } catch { /* best effort: also available from /pharma/credit-notes/reissue */ }
  res.status(201).json({ data });
});
// E-invoice (IRP) JSON for one invoice. Upload it to the IRP / your GSP; `missing` lists what the IRP would reject.
pharmaDistributorRouter.get('/pharma/invoices/:id/einvoice-json', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const { data: ex } = await supabaseAdmin.from('pharma_invoices').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Invoice');
  const inv = ex as Row; assertRecordInScope(req.industryScope!, inv.industry_type_id, notFound('Invoice'));
  if (inv.status === 'Cancelled') throw bad('A cancelled invoice cannot be sent for e-invoicing.');
  const { data: cl } = await supabaseAdmin.from('clients').select('*').eq('organization_id', orgId).eq('id', inv.client_id).maybeSingle();
  res.json({ data: buildEInvoice(inv, (inv.company ?? {}) as Row, (cl ?? {}) as Row) });
});
// Approved returns whose customer credit has no GST credit note yet (shows what failed or was waiting for an invoice).
pharmaDistributorRouter.get('/pharma/credit-notes/missing', authenticate, manager, async (req, res) => {
  res.json({ data: await pendingCreditNotes(org(req), qIt(req)) });
});
pharmaDistributorRouter.post('/pharma/credit-notes/reissue', authenticate, manager, async (req, res) => {
  res.json({ data: await reissueCreditNotes(org(req), bIt(req), actorOf(req)) });
});
// Last known MRP / rate per product, so the GRN screen can prefill what the supplier rarely changes.
pharmaDistributorRouter.get('/pharma/grn-hints', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = qIt(req);
  const codes = str(req.query.codes).split(',').map((c) => c.trim()).filter(Boolean).slice(0, 100);
  const out: Row = {};
  if (codes.length) {
    const rows = await all(() => supabaseAdmin.from('pharma_batches').select('product_code, mrp, purchase_rate, gst_percent, created_at').eq('organization_id', orgId).eq('industry_type_id', it).in('product_code', codes).order('created_at', { ascending: false }));
    for (const r of rows) if (!out[r.product_code]) out[r.product_code] = { mrp: r.mrp ?? null, purchase_rate: r.purchase_rate ?? null, gst_percent: r.gst_percent ?? null };
  }
  res.json({ data: out });
});
pharmaDistributorRouter.post('/pharma/invoices/:id/cancel', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const { data: ex } = await supabaseAdmin.from('pharma_invoices').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Invoice');
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound('Invoice'));
    if ((ex as Row).status === 'Cancelled') throw bad('This invoice is already cancelled.');
  { const { count: cn } = await supabaseAdmin.from('pharma_credit_notes').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('invoice_id', idOf(req)).neq('status', 'Cancelled');
    if (cn) throw new AppError(409, 'RECORD_IN_USE', `This invoice has ${cn} credit note(s) against it, so it cannot be cancelled.`); }
  const reason = str((req.body ?? {}).reason);
  if (!reason) throw bad('Enter a reason for cancelling this invoice.');
  if ((req.body ?? {}).confirm_paid !== true) { // money already collected on the order must be a deliberate decision (refund / re-invoice), not a side effect
    const { data: col, error: cerr } = await supabaseAdmin.from('sales_collections').select('amount').eq('organization_id', orgId).eq('sale_order_id', (ex as Row).order_id);
    if (cerr) throw cerr;
    const paid = r2(((col ?? []) as Row[]).reduce((t, c) => t + num(c.amount), 0));
    if (paid > 0) throw new AppError(409, 'INVOICE_HAS_PAYMENTS', `Payments received: ${paid} was already collected on this order. Cancelling the invoice leaves that money on the order.`);
  }
  const { data, error } = await supabaseAdmin.from('pharma_invoices').update({ status: 'Cancelled', cancel_reason: reason, cancelled_at: new Date().toISOString() }).eq('organization_id', orgId).eq('id', idOf(req)).select().single();
  if (error) throw error;
  res.json({ data });
});

// =============================================================== Dashboard block + Reports
async function lowStockProducts(orgId: string, it: string): Promise<Row[]> {
  const ids = await industryProductIds(orgId, it);
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('products').select(PRODUCT_COLS).eq('organization_id', orgId).in('id', ids.slice(i, i + 100));
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Row[]));
  }
  return out.filter((p) => p.min_stock_level !== null && p.min_stock_level !== undefined && p.stock_quantity !== null && num(p.stock_quantity) <= num(p.min_stock_level));
}
pharmaDistributorRouter.get('/pharma/distributor-summary', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = qIt(req);
  const [low, sup, cust, pos] = await Promise.all([
    lowStockProducts(orgId, it), supplierBalances(orgId, it), customerBalances(orgId, it),
    supabaseAdmin.from('pharma_purchase_orders').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('industry_type_id', it).in('status', ['Ordered', 'Partially Received']),
  ]);
  res.json({ data: {
    lowStock: low.length,
    payables: r2(sup.reduce((s, r) => s + Math.max(0, num(r.outstanding)), 0)),
    receivables: r2(cust.reduce((s, r) => s + Math.max(0, num(r.outstanding)), 0)),
    openPurchaseOrders: pos.count ?? 0,
  } });
});
pharmaDistributorRouter.get('/pharma/reports/:kind', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = qIt(req); const kind = String(req.params.kind);
  const from = isDate(req.query.from) ? String(req.query.from) : null; const to = isDate(req.query.to) ? String(req.query.to) : null;
  const ranged = (q: any, col: string) => { let x = q; if (from) x = x.gte(col, from); if (to) x = x.lte(col, to); return x; };
  let data: Row[] = [];
  if (kind === 'sales') {
    const rows = await all(() => ranged(supabaseAdmin.from('pharma_invoices').select('invoice_number, invoice_date, supply_type, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, clients(client_name)').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled'), 'invoice_date').order('invoice_date', { ascending: false }));
    data = rows.map((r) => ({ invoice_no: r.invoice_number, date: r.invoice_date, customer: (Array.isArray(r.clients) ? r.clients[0] : r.clients)?.client_name ?? '', supply_type: r.supply_type, taxable: num(r.taxable_amount), cgst: num(r.cgst_amount), sgst: num(r.sgst_amount), igst: num(r.igst_amount), total: num(r.total_amount) }));
  } else if (kind === 'purchase') {
    const rows = await all(() => ranged(supabaseAdmin.from('pharma_grn').select('grn_number, grn_date, supplier_invoice_no, subtotal, tax_amount, total_amount, pharma_suppliers(supplier_name)').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled'), 'grn_date').order('grn_date', { ascending: false }));
    data = rows.map((r) => ({ grn_no: r.grn_number, date: r.grn_date, supplier: (Array.isArray(r.pharma_suppliers) ? r.pharma_suppliers[0] : r.pharma_suppliers)?.supplier_name ?? '', supplier_invoice: r.supplier_invoice_no ?? '', taxable: num(r.subtotal), gst: num(r.tax_amount), total: num(r.total_amount) }));
  } else if (kind === 'inventory' || kind === 'expiry') {
    const rows = await all(() => supabaseAdmin.from('pharma_batches').select('*').eq('organization_id', orgId).eq('industry_type_id', it).gt('quantity', 0).order('expiry_date'));
    data = rows.map((r) => ({ product: r.product_name, batch: r.batch_number, expiry: String(r.expiry_date ?? '').slice(0, 10), days_left: daysLeft(r.expiry_date) ?? 0, quantity: num(r.quantity), purchase_rate: num(r.purchase_rate), stock_value: r2(num(r.quantity) * num(r.purchase_rate)), status: r.status }))
      .filter((r) => kind === 'inventory' || r.days_left <= 180);
  } else if (kind === 'low-stock') {
    data = (await lowStockProducts(orgId, it)).map((p) => ({ product_code: p.product_code, product: p.product_name, stock: num(p.stock_quantity), reorder_level: num(p.min_stock_level), shortfall: Math.max(0, num(p.min_stock_level) - num(p.stock_quantity)) }));
  } else if (kind === 'customer-outstanding') data = await customerBalances(orgId, it);
  else if (kind === 'supplier-outstanding') data = await supplierBalances(orgId, it);
  else if (kind === 'credit-notes') {
    const rows = await all(() => ranged(supabaseAdmin.from('pharma_credit_notes').select('note_number, note_date, client_id, invoice_number, reason, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled'), 'note_date').order('note_date', { ascending: false }));
    const cids = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
    const cn = new Map<string, string>();
    if (cids.length) { const { data: cs } = await supabaseAdmin.from('clients').select('id, client_name').in('id', cids); for (const c of (cs ?? []) as Row[]) cn.set(String(c.id), String(c.client_name ?? '')); }
    data = rows.map((r) => ({ note_no: r.note_number, date: r.note_date, customer: cn.get(String(r.client_id)) ?? '', invoice: r.invoice_number ?? '', reason: r.reason ?? '', taxable: num(r.taxable_amount), cgst: num(r.cgst_amount), sgst: num(r.sgst_amount), igst: num(r.igst_amount), total: num(r.total_amount) }));
  } else if (kind === 'debit-notes') { // a purchase return is the GST debit note to the supplier
    const rows = await all(() => ranged(supabaseAdmin.from('pharma_purchase_returns').select('return_number, return_date, reason, subtotal, tax_amount, total_amount, pharma_suppliers(supplier_name)').eq('organization_id', orgId).eq('industry_type_id', it), 'return_date').order('return_date', { ascending: false }));
    data = rows.map((r) => ({ debit_note_no: r.return_number, date: r.return_date, supplier: (Array.isArray(r.pharma_suppliers) ? r.pharma_suppliers[0] : r.pharma_suppliers)?.supplier_name ?? '', reason: r.reason ?? '', taxable: num(r.subtotal), gst: num(r.tax_amount), total: num(r.total_amount) }));
  }
  else if (kind === 'gstr1' || kind === 'hsn' || kind === 'schedule-register') {
    const one = (v: any) => (Array.isArray(v) ? v[0] : v);
    const invs = await all(() => ranged(supabaseAdmin.from('pharma_invoices').select('invoice_number, invoice_date, place_of_supply, supply_type, lines, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, clients(client_name, gstin, industry_details)').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled'), 'invoice_date').order('invoice_date', { ascending: false }));
    if (kind === 'gstr1') {
      data = invs.map((r) => { const c = one(r.clients); const gstin = str(c?.gstin); return { invoice_no: r.invoice_number, date: r.invoice_date, customer: c?.client_name ?? '', gstin, type: gstin ? 'B2B' : 'B2C', place_of_supply: r.place_of_supply ?? '', supply_type: r.supply_type, taxable: num(r.taxable_amount), cgst: num(r.cgst_amount), sgst: num(r.sgst_amount), igst: num(r.igst_amount), total: num(r.total_amount) }; });
    } else if (kind === 'hsn') { // invoices minus credit notes, grouped by HSN + GST rate
      const cns = await all(() => ranged(supabaseAdmin.from('pharma_credit_notes').select('lines').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled'), 'note_date'));
      const g = new Map<string, Row>();
      const add = (l: Row, sign: number) => {
        const key = `${str(l.hsn_code)}|${num(l.gst_percent)}`;
        const e = g.get(key) ?? { hsn: str(l.hsn_code) || 'Not set', gst_percent: num(l.gst_percent), quantity: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        e.quantity += sign * (num(l.quantity) + num(l.free_quantity)); e.taxable += sign * num(l.taxable_value); e.cgst += sign * num(l.cgst); e.sgst += sign * num(l.sgst); e.igst += sign * num(l.igst);
        g.set(key, e);
      };
      for (const i of invs) for (const l of (i.lines ?? []) as Row[]) add(l, 1);
      for (const c of cns) for (const l of (c.lines ?? []) as Row[]) add(l, -1);
      data = [...g.values()].map((e) => ({ hsn: e.hsn, gst_percent: e.gst_percent, quantity: e.quantity, taxable: r2(e.taxable), cgst: r2(e.cgst), sgst: r2(e.sgst), igst: r2(e.igst), total_tax: r2(e.cgst + e.sgst + e.igst) })).sort((a, b) => String(a.hsn).localeCompare(String(b.hsn)));
    } else { // Schedule H / H1 / X / Narcotic sales register
      const { data: sch, error: se } = await supabaseAdmin.from('pharma_drug_schedules').select('product_code, schedule').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Inactive');
      if (se) throw se;
      const sched = new Map(((sch ?? []) as Row[]).map((s) => [String(s.product_code), String(s.schedule)]));
      const rows: Row[] = [];
      for (const i of invs) {
        const c = one(i.clients); const d = (c?.industry_details && typeof c.industry_details === 'object' ? c.industry_details : {}) as Row;
        for (const l of (i.lines ?? []) as Row[]) {
          const s = sched.get(str(l.product_code)); if (!s) continue;
          const bs = (l.batches ?? []) as Row[];
          rows.push({ date: i.invoice_date, invoice_no: i.invoice_number, customer: c?.client_name ?? '', drug_licence_no: str(d.drugLicenseNumber), product: l.product_name, schedule: s, batch: bs.map((b) => b.batch_number).join(', '), expiry: bs.map((b) => String(b.expiry_date ?? '').slice(0, 10)).join(', '), quantity: num(l.quantity) + num(l.free_quantity) });
        }
      }
      data = rows;
    }
  } else if (kind === 'gstr3b') { // indicative summary: outward tax less input tax credit
    const [invs, cns, grns, prs, sups, co] = await Promise.all([
      all(() => ranged(supabaseAdmin.from('pharma_invoices').select('taxable_amount, cgst_amount, sgst_amount, igst_amount').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled'), 'invoice_date')),
      all(() => ranged(supabaseAdmin.from('pharma_credit_notes').select('taxable_amount, cgst_amount, sgst_amount, igst_amount').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled'), 'note_date')),
      all(() => ranged(supabaseAdmin.from('pharma_grn').select('supplier_id, subtotal, tax_amount').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled'), 'grn_date')),
      all(() => ranged(supabaseAdmin.from('pharma_purchase_returns').select('supplier_id, subtotal, tax_amount').eq('organization_id', orgId).eq('industry_type_id', it), 'return_date')),
      all(() => supabaseAdmin.from('pharma_suppliers').select('id, gstin, state').eq('organization_id', orgId).eq('industry_type_id', it)),
      supabaseAdmin.from('pharma_company_profile').select('gstin, state').eq('organization_id', orgId).eq('industry_type_id', it).maybeSingle(),
    ]);
    const mine = ((co.data ?? {}) as Row); const supBy = new Map(sups.map((s) => [s.id as string, s]));
    const intra = (supplierId: string) => {
      const s = supBy.get(supplierId); const a = str(mine.gstin).slice(0, 2); const b = str(s?.gstin).slice(0, 2);
      if (/^\d{2}$/.test(a) && /^\d{2}$/.test(b)) return a === b;
      return !!str(mine.state) && str(mine.state).toLowerCase() === str(s?.state).toLowerCase();
    };
    const out = { taxable: 0, igst: 0, cgst: 0, sgst: 0 }; const itc = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    const addOut = (r: Row, sign: number) => { out.taxable += sign * num(r.taxable_amount); out.igst += sign * num(r.igst_amount); out.cgst += sign * num(r.cgst_amount); out.sgst += sign * num(r.sgst_amount); };
    const addItc = (r: Row, sign: number) => { const tax = num(r.tax_amount); itc.taxable += sign * num(r.subtotal); if (intra(String(r.supplier_id))) { itc.cgst += (sign * tax) / 2; itc.sgst += (sign * tax) / 2; } else itc.igst += sign * tax; };
    for (const r of invs) addOut(r, 1); for (const r of cns) addOut(r, -1);
    for (const r of grns) addItc(r, 1); for (const r of prs) addItc(r, -1);
    const row = (section: string, v: { taxable: number; igst: number; cgst: number; sgst: number }) => ({ section, taxable: r2(v.taxable), igst: r2(v.igst), cgst: r2(v.cgst), sgst: r2(v.sgst), total_tax: r2(v.igst + v.cgst + v.sgst) });
    data = [row('3.1 Outward supplies (net of credit notes)', out), row('4 Input tax credit (purchases less debit notes)', itc), row('Net GST payable (negative = credit carried forward)', { taxable: 0, igst: out.igst - itc.igst, cgst: out.cgst - itc.cgst, sgst: out.sgst - itc.sgst })];
  }
  else throw bad('Unknown report.');
  res.json({ data });
});