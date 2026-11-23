/* eslint-disable @typescript-eslint/no-explicit-any */
// FMCG purchase side (distributor buys from the company): Vendors, Purchase Orders, Goods Receipt (GRN), reorder suggestions.
// Receiving a PO creates / tops up the product batch (batch no, mfg, expiry), adds product stock and writes a stock_in movement.
// Own tables (fmcg_vendors, fmcg_purchase_orders, fmcg_grns). Nothing here touches other industries.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { todayLocal } from '../lib/ist-date.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { isFmcgIndustry } from '../lib/fmcg-market.js';
import { changeBatch } from '../lib/stock.js';
import { changeProductStock } from '../repositories/products.repository.js';
import { createBatch } from '../repositories/product-batches.repository.js';

export const fmcgPurchaseRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');

type Req = Parameters<RequestHandler>[0];
type Row = Record<string, any>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const r2 = (v: number) => Math.round(v * 100) / 100;
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const bad = (msg: string, code = 'VALIDATION_ERROR') => new AppError(400, code, msg);
const notFound = (what: string) => new AppError(404, 'RECORD_NOT_FOUND', `${what} was not found.`);
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
const fmcgId = async (req: Req): Promise<string> => {
  const id = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!id || !(await isFmcgIndustry(org(req), id))) throw new AppError(422, 'NOT_FMCG', 'Purchasing is only available in the FMCG industry.');
  return id;
};
const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const same = (a: unknown, b: unknown) => str(a).toLowerCase() === str(b).toLowerCase();

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
async function maxSuffix(table: string, field: string, orgId: string, prefix: string): Promise<number> {
  const { data, error } = await supabaseAdmin.from(table).select(field).eq('organization_id', orgId).like(field, `${like(prefix)}%`);
  if (error) throw error;
  return Math.max(0, ...((data ?? []) as unknown as Row[]).map((x) => Number(/(\d+)$/.exec(String(x[field] ?? ''))?.[1] ?? 0)));
}
async function insertNumbered(table: string, field: string, orgId: string, prefix: string, row: Row): Promise<Row> {
  for (let i = 0; i < 4; i += 1) {
    const no = `${prefix}${String((await maxSuffix(table, field, orgId, prefix)) + 1).padStart(4, '0')}`;
    const { data, error } = await supabaseAdmin.from(table).insert({ ...row, [field]: no, organization_id: orgId }).select().single();
    if (!error) return data as Row;
    if (error.code !== '23505') throw error;
  }
  throw new AppError(409, 'DUPLICATE_RECORD', 'Could not allocate a new number. Please try again.');
}
type Undo = () => Promise<void>;
async function runUndo(undo: Undo[]) { for (const u of [...undo].reverse()) { try { await u(); } catch { /* best effort */ } } }

// ---- products of the FMCG industry ---------------------------------------------------------
async function productsById(orgId: string, it: string, ids: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return out;
  const { data, error } = await supabaseAdmin.from('products').select('id, product_code, product_name, unit, cost_price, tax_percent').eq('organization_id', orgId).in('id', list);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return out;
  const { data: tags, error: e2 } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', orgId).eq('industry_type_id', it).in('product_id', rows.map((r) => r.id));
  if (e2) throw e2;
  const ok = new Set(((tags ?? []) as Row[]).map((t) => t.product_id));
  for (const p of rows) if (ok.has(p.id)) out.set(String(p.id), p);
  return out;
}

// =============================================================== Vendors / Companies
const VENDOR_FIELDS = ['vendor_name', 'vendor_type', 'contact_person', 'phone', 'email', 'address', 'city', 'state', 'gstin', 'pan', 'payment_terms_days', 'notes', 'status'];
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const VENDOR_TYPES = ['Company', 'Super stockist', 'Dealer', 'Other'];
function vendorPayload(body: Row, partial: boolean): Row {
  const out: Row = {};
  for (const k of VENDOR_FIELDS) if (k in body) { const v = body[k]; out[k] = typeof v === 'string' ? (v.trim() || null) : (v ?? null); }
  if ((!partial || 'vendor_name' in out) && !out.vendor_name) throw bad('Vendor name is required.');
  if (out.gstin) { out.gstin = String(out.gstin).toUpperCase(); if (!GSTIN_RE.test(out.gstin)) throw bad('GSTIN format is invalid (15 characters, e.g. 33AABCM1234F1Z4).'); }
  if (out.pan) { out.pan = String(out.pan).toUpperCase(); if (!PAN_RE.test(out.pan)) throw bad('PAN format is invalid (e.g. AABCM1234F).'); }
  if (out.email && !/^\S+@\S+\.\S+$/.test(String(out.email))) throw bad('Email address is not valid.');
  if ('vendor_type' in out) { out.vendor_type = out.vendor_type ?? 'Company'; if (!VENDOR_TYPES.includes(String(out.vendor_type))) throw bad(`Vendor type must be one of: ${VENDOR_TYPES.join(', ')}.`); }
  if ('payment_terms_days' in out) {
    const n = out.payment_terms_days === null ? 30 : Number(out.payment_terms_days);
    if (Number.isNaN(n) || n < 0) throw bad('Payment terms must be zero or more days.');
    out.payment_terms_days = Math.round(n);
  }
  if ('status' in out) { out.status = out.status ?? 'active'; if (!['active', 'inactive'].includes(String(out.status))) throw bad('Status must be active or inactive.'); }
  return out;
}
async function getVendor(orgId: string, it: string, id: unknown): Promise<Row> {
  if (!str(id)) throw bad('Select a vendor.');
  const { data, error } = await supabaseAdmin.from('fmcg_vendors').select('*').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', String(id)).maybeSingle();
  if (error) throw error;
  if (!data) throw bad('That vendor does not exist in this industry.');
  return data as Row;
}

fmcgPurchaseRouter.get('/fmcg/vendors', authenticate, manager, async (req, res) => {
  const it = await fmcgId(req);
  res.json({ data: await all(() => supabaseAdmin.from('fmcg_vendors').select('*').eq('organization_id', org(req)).eq('industry_type_id', it).order('vendor_name')) });
});
fmcgPurchaseRouter.post('/fmcg/vendors', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = await fmcgId(req);
  const p = vendorPayload(req.body ?? {}, false);
  const { data: dupe } = await supabaseAdmin.from('fmcg_vendors').select('id').eq('organization_id', orgId).eq('industry_type_id', it).ilike('vendor_name', like(String(p.vendor_name))).limit(1);
  if ((dupe ?? []).length) throw new AppError(409, 'DUPLICATE_RECORD', `A vendor named "${String(p.vendor_name)}" already exists.`);
  res.status(201).json({ data: await insertNumbered('fmcg_vendors', 'vendor_code', orgId, 'FVEN-', { ...p, industry_type_id: it, created_by: actorOf(req) }) });
});
fmcgPurchaseRouter.patch('/fmcg/vendors/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = await fmcgId(req);
  const ex = await getVendor(orgId, it, idOf(req));
  const p = vendorPayload(req.body ?? {}, true);
  if (p.vendor_name && !same(p.vendor_name, ex.vendor_name)) {
    const { data: dupe } = await supabaseAdmin.from('fmcg_vendors').select('id').eq('organization_id', orgId).eq('industry_type_id', it).ilike('vendor_name', like(String(p.vendor_name))).neq('id', ex.id).limit(1);
    if ((dupe ?? []).length) throw new AppError(409, 'DUPLICATE_RECORD', `A vendor named "${String(p.vendor_name)}" already exists.`);
  }
  if (!Object.keys(p).length) return res.json({ data: ex });
  const { data, error } = await supabaseAdmin.from('fmcg_vendors').update(p).eq('organization_id', orgId).eq('id', ex.id).select().single();
  if (error) throw error;
  return res.json({ data });
});
fmcgPurchaseRouter.delete('/fmcg/vendors/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = await fmcgId(req);
  const ex = await getVendor(orgId, it, idOf(req));
  const { count } = await supabaseAdmin.from('fmcg_purchase_orders').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('vendor_id', ex.id);
  if (count) throw new AppError(409, 'RECORD_IN_USE', `This vendor has ${count} purchase order(s). Mark it inactive instead of deleting it.`);
  const { error } = await supabaseAdmin.from('fmcg_vendors').delete().eq('organization_id', orgId).eq('id', ex.id);
  if (error) throw error;
  res.json({ data: ex });
});

// =============================================================== Purchase orders
async function buildPoLines(orgId: string, it: string, raw: Row[]): Promise<Row[]> {
  const products = await productsById(orgId, it, raw.map((l) => str(l.product_id)));
  const seen = new Set<string>();
  return raw.map((l, i) => {
    const p = products.get(str(l.product_id));
    if (!p) throw bad(`Item ${i + 1}: pick a product that exists in this industry.`);
    const quantity = Number(l.quantity);
    const rate = Number(l.rate === '' || l.rate == null ? p.cost_price ?? 0 : l.rate);
    const gst = Number(l.gst_percent === '' || l.gst_percent == null ? p.tax_percent ?? 0 : l.gst_percent);
    if (!(quantity > 0)) throw bad(`Item ${i + 1} (${p.product_name}): quantity must be more than zero.`);
    if (Number.isNaN(rate) || rate < 0) throw bad(`Item ${i + 1} (${p.product_name}): rate cannot be negative.`);
    if (Number.isNaN(gst) || gst < 0 || gst > 100) throw bad(`Item ${i + 1} (${p.product_name}): GST % must be between 0 and 100.`);
    if (seen.has(p.id)) throw bad(`Item ${i + 1}: ${p.product_name} is listed twice. Combine the quantity in one line.`);
    seen.add(p.id);
    return { product_id: p.id, product_code: p.product_code, product_name: p.product_name, quantity: r2(quantity), received_quantity: 0, rate: r2(rate), gst_percent: gst };
  });
}
const poTotals = (lines: Row[]) => {
  const subtotal = r2(lines.reduce((s, l) => s + num(l.quantity) * num(l.rate), 0));
  const tax = r2(lines.reduce((s, l) => s + (num(l.quantity) * num(l.rate) * num(l.gst_percent)) / 100, 0));
  return { subtotal, tax_amount: tax, total_amount: r2(subtotal + tax) };
};
const tolOf = (v: unknown) => {
  const n = v === '' || v == null ? 0 : Number(v);
  if (Number.isNaN(n) || n < 0 || n > 100) throw bad('Tolerance % must be between 0 and 100.');
  return r2(n);
};
/** PO status from the received quantities (tolerance % lets a line count as complete when slightly short). */
function poStatusFromReceipts(lines: Row[], tol: number): 'Ordered' | 'Partially Received' | 'Received' {
  if (!lines.some((l) => num(l.received_quantity) > 0)) return 'Ordered';
  return lines.every((l) => num(l.received_quantity) + 1e-9 >= num(l.quantity) * (1 - tol / 100)) ? 'Received' : 'Partially Received';
}

fmcgPurchaseRouter.get('/fmcg/purchase-orders', authenticate, manager, async (req, res) => {
  const it = await fmcgId(req);
  res.json({ data: await all(() => supabaseAdmin.from('fmcg_purchase_orders').select('*, fmcg_vendors(vendor_name, vendor_code)').eq('organization_id', org(req)).eq('industry_type_id', it).order('created_at', { ascending: false })) });
});
fmcgPurchaseRouter.post('/fmcg/purchase-orders', authenticate, manager, async (req, res) => {
  const b = (req.body ?? {}) as Row; const orgId = org(req); const it = await fmcgId(req);
  const status = b.status === 'Ordered' ? 'Ordered' : 'Draft';
  const v = await getVendor(orgId, it, b.vendor_id);
  if (v.status !== 'active') throw bad(`${v.vendor_name} is inactive and cannot receive new orders.`);
  const raw = (Array.isArray(b.lines) ? b.lines : []).filter((l: Row) => str(l.product_id) || num(l.quantity) > 0);
  if (!raw.length) throw bad('Add at least one product to the order.');
  const orderDate = str(b.order_date) || todayLocal(); const expected = str(b.expected_date) || null;
  if (!isDate(orderDate)) throw bad('Order date is not valid.');
  if (expected && (!isDate(expected) || expected < orderDate)) throw bad('Expected delivery cannot be before the order date.');
  const lines = await buildPoLines(orgId, it, raw);
  const data = await insertNumbered('fmcg_purchase_orders', 'po_number', orgId, `FPO-${todayLocal().slice(0, 4)}-`, {
    industry_type_id: it, vendor_id: v.id, order_date: orderDate, expected_date: expected, tolerance_percent: tolOf(b.tolerance_percent),
    notes: str(b.notes) || null, status, lines, ...poTotals(lines), created_by: actorOf(req),
  });
  res.status(201).json({ data });
});
fmcgPurchaseRouter.patch('/fmcg/purchase-orders/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = await fmcgId(req); const b = (req.body ?? {}) as Row;
  const { data: ex } = await supabaseAdmin.from('fmcg_purchase_orders').select('*').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Purchase order');
  const po = ex as Row;
  const to = str(b.status);
  const received = (po.lines as Row[]).reduce((s, l) => s + num(l.received_quantity), 0);
  const patch: Row = {};
  if (b.lines !== undefined || b.vendor_id !== undefined || b.order_date !== undefined || b.expected_date !== undefined || b.notes !== undefined || b.tolerance_percent !== undefined) {
    if (po.status !== 'Draft') throw bad('Only a Draft purchase order can be edited.');
    if (b.vendor_id !== undefined) { const v = await getVendor(orgId, it, b.vendor_id); if (v.status !== 'active') throw bad(`${v.vendor_name} is inactive.`); patch.vendor_id = v.id; }
    if (b.order_date !== undefined) { if (!isDate(b.order_date)) throw bad('Order date is not valid.'); patch.order_date = b.order_date; }
    if (b.expected_date !== undefined) { const e = str(b.expected_date) || null; if (e && !isDate(e)) throw bad('Expected date is not valid.'); patch.expected_date = e; }
    if (b.notes !== undefined) patch.notes = str(b.notes) || null;
    if (b.tolerance_percent !== undefined) patch.tolerance_percent = tolOf(b.tolerance_percent);
    if (b.lines !== undefined) {
      const raw = (Array.isArray(b.lines) ? b.lines : []).filter((l: Row) => str(l.product_id) || num(l.quantity) > 0);
      if (!raw.length) throw bad('Add at least one product to the order.');
      const lines = await buildPoLines(orgId, it, raw);
      Object.assign(patch, { lines, ...poTotals(lines) });
    }
    const od = (patch.order_date ?? po.order_date) as string; const ed = (patch.expected_date !== undefined ? patch.expected_date : po.expected_date) as string | null;
    if (ed && ed < od) throw bad('Expected delivery cannot be before the order date.');
  }
  if (to) {
    if (to === 'Ordered') { if (po.status !== 'Draft') throw bad('Only a Draft order can be marked Ordered.'); }
    else if (to === 'Cancelled') {
      if (!['Draft', 'Ordered'].includes(po.status)) throw bad(`A ${po.status} order cannot be cancelled.`);
      if (received > 0) throw bad('Goods were already received against this order, so it cannot be cancelled.');
    } else if (to === 'Closed') { // short-close: the company will not deliver the rest
      if (po.status !== 'Partially Received') throw bad('Only a Partially Received order can be closed. Cancel a Draft/Ordered order instead.');
    } else throw bad('Status must be Ordered, Cancelled or Closed.');
    patch.status = to;
  }
  if (!Object.keys(patch).length) throw bad('Nothing to change.');
  const { data, error } = await supabaseAdmin.from('fmcg_purchase_orders').update(patch).eq('organization_id', orgId).eq('id', po.id).select().single();
  if (error) throw error;
  res.json({ data });
});
fmcgPurchaseRouter.delete('/fmcg/purchase-orders/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = await fmcgId(req);
  const { data: ex } = await supabaseAdmin.from('fmcg_purchase_orders').select('*').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Purchase order');
  if ((ex as Row).status !== 'Draft') throw bad('Only a Draft purchase order can be deleted. Cancel it instead.');
  const { error } = await supabaseAdmin.from('fmcg_purchase_orders').delete().eq('organization_id', orgId).eq('id', idOf(req));
  if (error) throw error;
  res.json({ data: ex });
});

// =============================================================== Reorder suggestions -> draft POs
const OPEN_PO = ['Draft', 'Ordered', 'Partially Received'];
export async function reorderPlan(orgId: string, it: string): Promise<{ items: Row[]; unassigned: Row[] }> {
  const tagRows = await all(() => supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', orgId).eq('industry_type_id', it).order('product_id'));
  const ids = tagRows.map((t) => String(t.product_id));
  const low: Row[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('products').select('id, product_code, product_name, stock_quantity, min_stock_level, cost_price, tax_percent').eq('organization_id', orgId).eq('status', 'active').in('id', ids.slice(i, i + 100));
    if (error) { if ((error as { code?: string }).code === '42703') return { items: [], unassigned: [] }; throw error; } // min_stock_level column not added yet
    for (const p of (data ?? []) as Row[]) if (num(p.min_stock_level) > 0 && p.stock_quantity != null && num(p.stock_quantity) <= num(p.min_stock_level)) low.push(p);
  }
  if (!low.length) return { items: [], unassigned: [] };
  const pos = await all(() => supabaseAdmin.from('fmcg_purchase_orders').select('vendor_id, status, lines, created_at').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled').order('created_at', { ascending: false }));
  const vendors = new Map((await all(() => supabaseAdmin.from('fmcg_vendors').select('id, vendor_name, status').eq('organization_id', orgId).eq('industry_type_id', it))).map((v) => [String(v.id), v]));
  const onOrder = new Map<string, number>(); const lastVendor = new Map<string, string>();
  for (const po of pos) for (const l of (po.lines ?? []) as Row[]) {
    const pid = String(l.product_id);
    if (OPEN_PO.includes(po.status)) onOrder.set(pid, (onOrder.get(pid) ?? 0) + Math.max(0, num(l.quantity) - num(l.received_quantity)));
    if (!lastVendor.has(pid)) lastVendor.set(pid, String(po.vendor_id)); // newest PO first
  }
  const items: Row[] = []; const unassigned: Row[] = [];
  for (const p of low) {
    const target = num(p.min_stock_level) * 2; // order back up to twice the minimum level
    const qty = Math.ceil(target - num(p.stock_quantity) - (onOrder.get(String(p.id)) ?? 0));
    if (qty <= 0) continue; // already covered by an open PO
    const vid = lastVendor.get(String(p.id)); const v = vid ? vendors.get(vid) : undefined;
    const row = { product_id: p.id, product_code: p.product_code, product_name: p.product_name, stock: num(p.stock_quantity), min_stock_level: num(p.min_stock_level), on_order: onOrder.get(String(p.id)) ?? 0, quantity: qty, rate: num(p.cost_price), gst_percent: num(p.tax_percent), vendor_id: v && v.status === 'active' ? v.id : null, vendor_name: v?.vendor_name ?? null };
    (row.vendor_id ? items : unassigned).push(row);
  }
  return { items, unassigned };
}
fmcgPurchaseRouter.get('/fmcg/purchase-orders/reorder-suggestions', authenticate, manager, async (req, res) => {
  res.json({ data: await reorderPlan(org(req), await fmcgId(req)) });
});

/** Creates one Draft PO per vendor from the low-stock plan. Safe to repeat: stock already on an open PO is not ordered again. */
export async function createReorderDrafts(orgId: string, it: string, actor: string | null, note = 'Auto-drafted from low stock'): Promise<{ created: Row[]; unassigned: Row[] }> {
  const plan = await reorderPlan(orgId, it);
  const byVendor = new Map<string, Row[]>();
  for (const i of plan.items) byVendor.set(i.vendor_id, [...(byVendor.get(i.vendor_id) ?? []), i]);
  const created: Row[] = [];
  for (const [vendorId, items] of byVendor) {
    const lines = items.map((i) => ({ product_id: i.product_id, product_code: i.product_code, product_name: i.product_name, quantity: i.quantity, received_quantity: 0, rate: r2(i.rate), gst_percent: i.gst_percent }));
    created.push(await insertNumbered('fmcg_purchase_orders', 'po_number', orgId, `FPO-${todayLocal().slice(0, 4)}-`, {
      industry_type_id: it, vendor_id: vendorId, order_date: todayLocal(), expected_date: null, tolerance_percent: 0, status: 'Draft',
      notes: note, lines, ...poTotals(lines), created_by: actor,
    }));
  }
  return { created, unassigned: plan.unassigned };
}
fmcgPurchaseRouter.post('/fmcg/purchase-orders/reorder-drafts', authenticate, manager, async (req, res) => {
  res.status(201).json({ data: await createReorderDrafts(org(req), await fmcgId(req), actorOf(req)) });
}); 

// =============================================================== Goods receipt (GRN) - creates / tops up batches and stock
fmcgPurchaseRouter.get('/fmcg/grns', authenticate, manager, async (req, res) => {
  const it = await fmcgId(req);
  res.json({ data: await all(() => supabaseAdmin.from('fmcg_grns').select('*, fmcg_vendors(vendor_name, vendor_code), fmcg_purchase_orders(po_number)').eq('organization_id', org(req)).eq('industry_type_id', it).order('created_at', { ascending: false })) });
});

/** Puts one received line on the shelf: tops up the batch if that batch number already exists, otherwise creates it. */
async function receiveLine(orgId: string, scope: any, it: string, l: Row): Promise<{ batchId: string; batchNo: string; expiry: string | null; undo: Undo }> {
  const qty = num(l.quantity); const batchNo = str(l.batch_no);
  if (batchNo) {
    const { data: ex } = await supabaseAdmin.from('product_batches').select('id, batch_no, expiry_date').eq('organization_id', orgId).eq('product_id', l.product_id).eq('batch_no', batchNo).maybeSingle();
    if (ex) {
      const exExpiry = ex.expiry_date ? String(ex.expiry_date).slice(0, 10) : null;
      if (l.expiry_date && exExpiry && exExpiry !== l.expiry_date) throw new AppError(409, 'BATCH_EXPIRY_MISMATCH', `Batch ${batchNo} of ${l.product_name} already exists with expiry ${exExpiry}. Check the batch number or the expiry date.`);
      await changeProductStock(orgId, l.product_id, qty, false);
      try { await changeBatch(orgId, ex.id as string, qty); } catch (e) { await changeProductStock(orgId, l.product_id, -qty, true).catch(() => undefined); throw e; }
      return { batchId: ex.id as string, batchNo, expiry: exExpiry, undo: async () => { await changeBatch(orgId, ex.id as string, -qty).catch(() => undefined); await changeProductStock(orgId, l.product_id, -qty, true).catch(() => undefined); } };
    }
  }
  const batch = (await createBatch(orgId, scope, { productId: l.product_id, batchNo: batchNo || undefined, mfgDate: l.mfg_date, expiryDate: l.expiry_date, quantity: qty, isNewStock: true }, it)) as Row;
  return {
    batchId: batch.id, batchNo: String(batch.batch_no), expiry: batch.expiry_date ? String(batch.expiry_date).slice(0, 10) : null,
    undo: async () => { await supabaseAdmin.from('product_batches').delete().eq('organization_id', orgId).eq('id', batch.id); await changeProductStock(orgId, l.product_id, -qty, true).catch(() => undefined); },
  };
}
async function displayName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabaseAdmin.from('user_profiles').select('display_name').eq('id', userId).maybeSingle();
  return (data as Row | null)?.display_name ?? null;
}
async function logMovement(orgId: string, userId: string | null, name: string | null, l: Row, type: 'stock_in' | 'adjustment', qty: number, ref: string, reason: string) {
  const { error } = await supabaseAdmin.from('inventory_movements').insert({
    organization_id: orgId, product_id: l.product_id, representative_id: null, movement_type: type, quantity: qty, batch: l.batch_no ?? null, mfg_date: l.mfg_date ?? null, expiry_date: l.expiry_date ?? null,
    reference: ref, reason, remarks: null, created_by: userId, created_by_name: name,
  });
  if (error) console.error('[fmcg-grn] stock ledger row lost', ref, error.message); // audit only; never blocks the receipt
}

fmcgPurchaseRouter.post('/fmcg/grns', authenticate, manager, async (req, res) => {
  const b = (req.body ?? {}) as Row; const orgId = org(req); const it = await fmcgId(req);
  const { data: poRow } = await supabaseAdmin.from('fmcg_purchase_orders').select('*').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', str(b.po_id)).maybeSingle();
  if (!poRow) throw bad('Select the purchase order these goods were received against.');
  const po = poRow as Row;
  if (!['Ordered', 'Partially Received'].includes(po.status)) throw bad(`Goods can only be received against an Ordered or Partially Received purchase order (this one is ${po.status}).`);
  const receivedDate = str(b.received_date) || todayLocal();
  if (!isDate(receivedDate)) throw bad('Received date is not valid.');
  if (receivedDate > todayLocal()) throw bad('Received date cannot be in the future.');
  const invoiceNo = str(b.vendor_invoice_no);
  if (invoiceNo) { // the same vendor bill must not be booked twice
    const { data: dup } = await supabaseAdmin.from('fmcg_grns').select('grn_number').eq('organization_id', orgId).eq('industry_type_id', it).eq('vendor_id', po.vendor_id).eq('status', 'Posted').ilike('vendor_invoice_no', like(invoiceNo)).limit(1);
    if ((dup ?? []).length) throw new AppError(409, 'DUPLICATE_RECORD', `Vendor invoice ${invoiceNo} is already recorded on ${String((dup as Row[])[0].grn_number)}.`);
  }
  const poLines = po.lines as Row[];
  const incoming = ((Array.isArray(b.lines) ? b.lines : []) as Row[]).filter((l) => num(l.quantity) > 0);
  if (!incoming.length) throw bad('Enter the received quantity for at least one product.');
  const added = new Map<number, number>(); const lines: Row[] = [];
  for (const l of incoming) {
    const idx = Number(l.po_line_index); const pl = poLines[idx];
    if (!pl) throw bad('A received line does not match the purchase order.');
    const mfg = str(l.mfg_date) || null; const exp = str(l.expiry_date) || null;
    if ((mfg && !isDate(mfg)) || (exp && !isDate(exp))) throw bad(`${pl.product_name}: manufacturing / expiry date is not valid.`);
    if (mfg && exp && exp < mfg) throw bad(`${pl.product_name}: expiry cannot be before the manufacturing date.`);
    const q = r2(num(l.quantity));
    added.set(idx, (added.get(idx) ?? 0) + q);
    lines.push({ po_line_index: idx, product_id: pl.product_id, product_code: pl.product_code, product_name: pl.product_name, quantity: q, batch_no: str(l.batch_no) || null, mfg_date: mfg, expiry_date: exp, rate: pl.rate });
  }
  const tol = num(po.tolerance_percent);
  for (const [idx, add] of added) {
    const pl = poLines[idx];
    if (num(pl.received_quantity) + add > num(pl.quantity) * (1 + tol / 100) + 1e-9) throw bad(`${pl.product_name}: receiving ${add} would go over the ordered ${pl.quantity} (already received ${pl.received_quantity}).`);
  }

  const undo: Undo[] = []; const posted: Row[] = [];
  let grn: Row;
  try {
    for (const l of lines) {
      const done = await receiveLine(orgId, req.industryScope!, it, l);
      undo.push(done.undo);
      posted.push({ ...l, batch_id: done.batchId, batch_no: done.batchNo, expiry_date: done.expiry });
    }
    grn = await insertNumbered('fmcg_grns', 'grn_number', orgId, `FGRN-${todayLocal().slice(0, 4)}-`, {
      industry_type_id: it, po_id: po.id, vendor_id: po.vendor_id, received_date: receivedDate, vendor_invoice_no: invoiceNo || null, notes: str(b.notes) || null,
      status: 'Posted', lines: posted, total_quantity: r2(posted.reduce((s, l) => s + num(l.quantity), 0)), created_by: actorOf(req),
    });
    undo.push(async () => { await supabaseAdmin.from('fmcg_grns').delete().eq('organization_id', orgId).eq('id', grn.id); });
    const newLines = poLines.map((l, i) => ({ ...l, received_quantity: r2(num(l.received_quantity) + (added.get(i) ?? 0)) }));
    const { error } = await supabaseAdmin.from('fmcg_purchase_orders').update({ lines: newLines, status: poStatusFromReceipts(newLines, tol) }).eq('organization_id', orgId).eq('id', po.id);
    if (error) throw error;
  } catch (e) { await runUndo(undo); throw e; }
  const name = await displayName(actorOf(req));
  for (const l of posted) await logMovement(orgId, actorOf(req), name, l, 'stock_in', num(l.quantity), String(grn.grn_number), 'Goods received (GRN)');
  res.status(201).json({ data: grn });
});

// Cancel a receipt: takes the units back out of their batches and the PO goes back to what was really received.
fmcgPurchaseRouter.patch('/fmcg/grns/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = await fmcgId(req);
  if (str((req.body ?? {}).status) !== 'Cancelled') throw bad('The only change allowed on a receipt is Cancelled.');
  const { data: g } = await supabaseAdmin.from('fmcg_grns').select('*').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', idOf(req)).maybeSingle();
  if (!g) throw notFound('Goods receipt');
  const grn = g as Row;
  if (grn.status !== 'Posted') throw bad('This receipt is already cancelled.');
  const lines = grn.lines as Row[];
  for (const l of lines) { // every unit must still be on the shelf, otherwise stock would go wrong
    const { data: bt } = await supabaseAdmin.from('product_batches').select('quantity').eq('organization_id', orgId).eq('id', l.batch_id).maybeSingle();
    if (!bt || num(bt.quantity) + 1e-9 < num(l.quantity)) throw new AppError(422, 'GRN_STOCK_USED', `Batch ${l.batch_no} of ${l.product_name} has fewer than ${l.quantity} unit(s) left (some were already sold or written off), so this receipt cannot be cancelled.`);
  }
  const undo: Undo[] = [];
  try {
    for (const l of lines) {
      const qty = num(l.quantity);
      await changeBatch(orgId, l.batch_id, -qty);
      undo.push(async () => { await changeBatch(orgId, l.batch_id, qty); });
      await changeProductStock(orgId, l.product_id, -qty, false);
      undo.push(async () => { await changeProductStock(orgId, l.product_id, qty, true); });
    }
    const { data: poRow } = await supabaseAdmin.from('fmcg_purchase_orders').select('*').eq('organization_id', orgId).eq('id', grn.po_id).maybeSingle();
    if (poRow) {
      const po = poRow as Row;
      const back = new Map<number, number>();
      for (const l of lines) back.set(Number(l.po_line_index), (back.get(Number(l.po_line_index)) ?? 0) + num(l.quantity));
      const newLines = (po.lines as Row[]).map((l, i) => ({ ...l, received_quantity: Math.max(0, r2(num(l.received_quantity) - (back.get(i) ?? 0))) }));
      const patch: Row = { lines: newLines };
      if (po.status !== 'Cancelled') patch.status = poStatusFromReceipts(newLines, num(po.tolerance_percent));
      const { error } = await supabaseAdmin.from('fmcg_purchase_orders').update(patch).eq('organization_id', orgId).eq('id', po.id);
      if (error) throw error;
    }
    const { error: e2 } = await supabaseAdmin.from('fmcg_grns').update({ status: 'Cancelled' }).eq('organization_id', orgId).eq('id', grn.id);
    if (e2) throw e2;
  } catch (e) { await runUndo(undo); throw e; }
  const name = await displayName(actorOf(req));
  for (const l of lines) await logMovement(orgId, actorOf(req), name, l, 'adjustment', -num(l.quantity), `CANCEL-${String(grn.grn_number)}`, 'Goods receipt cancelled');
  res.json({ data: { ...grn, status: 'Cancelled' } });
});