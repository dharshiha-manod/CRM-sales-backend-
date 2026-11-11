/* eslint-disable @typescript-eslint/no-explicit-any */
// Textile purchase side: Suppliers / Mills, Purchase Orders, Goods Receipt (GRN).
// Receiving a PO creates the individual fabric rolls (with their quality result and ledger entry).
// Own tables (textile_suppliers, textile_purchase_orders, textile_grns). Nothing here touches other industries.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { todayLocal } from '../lib/ist-date.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { assertRecordInScope, resolveIndustryTypeId } from '../lib/industry-scope.js';
import { syncProductStockFromRolls } from '../lib/textile-rolls.js';
import { overReceivedLines, poStatusFromReceipts, rpcError } from '../lib/textile-grn.js';

export const textilePurchaseRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');

type Req = Parameters<RequestHandler>[0];
type Row = Record<string, any>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const r2 = (v: number) => Math.round(v * 100) / 100;
const today = () => todayLocal();
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
const scopeIt = (req: Req, v: unknown) => {
  const it = resolveIndustryTypeId(req.industryScope!, typeof v === 'string' && v ? v : null);
  if (!it) throw bad('industryTypeId is required.');
  return it;
};
const qIt = (req: Req) => scopeIt(req, req.query.industryTypeId);
const bIt = (req: Req) => scopeIt(req, (req.body ?? {}).industryTypeId);
const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

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

// ---- products of the active (textile) industry ------------------------------------------
const PRODUCT_COLS = 'id, product_code, product_name, unit, cost_price, tax_percent, textile_details';
async function productMap(orgId: string, it: string, codes: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  const list = [...new Set(codes.filter(Boolean))];
  if (!list.length) return out;
  const { data, error } = await supabaseAdmin.from('products').select(PRODUCT_COLS).eq('organization_id', orgId).in('product_code', list);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return out;
  const { data: tags, error: e2 } = await supabaseAdmin.from('product_industry_types').select('product_id')
    .eq('organization_id', orgId).eq('industry_type_id', it).in('product_id', rows.map((r) => r.id));
  if (e2) throw e2;
  const ok = new Set(((tags ?? []) as Row[]).map((t) => t.product_id));
  for (const p of rows) if (ok.has(p.id)) out.set(String(p.product_code), p);
  return out;
}
const coloursOf = (p: Row): string[] => ((p.textile_details?.colors ?? []) as { name?: string }[]).map((c) => String(c.name ?? '')).filter(Boolean);
const same = (a: unknown, b: unknown) => str(a).toLowerCase() === str(b).toLowerCase();

// =============================================================== Suppliers / Mills
const SUPPLIER_FIELDS = ['supplier_name', 'supplier_type', 'contact_person', 'phone', 'email', 'address', 'city', 'state', 'gstin', 'pan', 'payment_terms_days', 'notes', 'status'];
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const SUPPLIER_TYPES = ['Mill', 'Trader', 'Agent'];
function supplierPayload(body: Row, partial: boolean): Row {
  const out: Row = {};
  for (const k of SUPPLIER_FIELDS) if (k in body) { const v = body[k]; out[k] = typeof v === 'string' ? (v.trim() || null) : (v ?? null); }
  if ((!partial || 'supplier_name' in out) && !out.supplier_name) throw bad('Supplier name is required.');
  if (out.gstin) { out.gstin = String(out.gstin).toUpperCase(); if (!GSTIN_RE.test(out.gstin)) throw bad('GSTIN format is invalid (15 characters, e.g. 33AABCM1234F1Z4).'); }
  if (out.pan) { out.pan = String(out.pan).toUpperCase(); if (!PAN_RE.test(out.pan)) throw bad('PAN format is invalid (e.g. AABCM1234F).'); }
  if (out.email && !/^\S+@\S+\.\S+$/.test(String(out.email))) throw bad('Email address is not valid.');
  if ('supplier_type' in out) { out.supplier_type = out.supplier_type ?? 'Mill'; if (!SUPPLIER_TYPES.includes(String(out.supplier_type))) throw bad(`Supplier type must be one of: ${SUPPLIER_TYPES.join(', ')}.`); }
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
  const { data, error } = await supabaseAdmin.from('textile_suppliers').select('*').eq('organization_id', orgId).eq('id', String(id)).maybeSingle();
  if (error) throw error;
  if (!data || (data as Row).industry_type_id !== it) throw bad('That supplier does not exist in this industry.');
  return data as Row;
}

textilePurchaseRouter.get('/textile/suppliers', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('textile_suppliers').select('*').eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('supplier_name'));
  res.json({ data });
});
textilePurchaseRouter.post('/textile/suppliers', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = bIt(req);
  const p = supplierPayload(req.body ?? {}, false);
  const { data: dupe } = await supabaseAdmin.from('textile_suppliers').select('id').eq('organization_id', orgId).eq('industry_type_id', it).ilike('supplier_name', like(String(p.supplier_name))).limit(1);
  if ((dupe ?? []).length) throw new AppError(409, 'DUPLICATE_RECORD', `A supplier named "${String(p.supplier_name)}" already exists.`);
  const data = await insertNumbered('textile_suppliers', 'supplier_code', orgId, 'TSUP-', { ...p, industry_type_id: it, created_by: actorOf(req) });
  res.status(201).json({ data });
});
textilePurchaseRouter.patch('/textile/suppliers/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const { data: ex, error } = await supabaseAdmin.from('textile_suppliers').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (error) throw error;
  if (!ex) throw notFound('Supplier');
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound('Supplier'));
  const p = supplierPayload(req.body ?? {}, true);
  if (p.supplier_name && !same(p.supplier_name, (ex as Row).supplier_name)) {
    const { data: dupe } = await supabaseAdmin.from('textile_suppliers').select('id').eq('organization_id', orgId).eq('industry_type_id', (ex as Row).industry_type_id).ilike('supplier_name', like(String(p.supplier_name))).neq('id', idOf(req)).limit(1);
    if ((dupe ?? []).length) throw new AppError(409, 'DUPLICATE_RECORD', `A supplier named "${String(p.supplier_name)}" already exists.`);
  }
  if (!Object.keys(p).length) return res.json({ data: ex });
  const { data, error: e2 } = await supabaseAdmin.from('textile_suppliers').update(p).eq('organization_id', orgId).eq('id', idOf(req)).select().single();
  if (e2) throw e2;
  return res.json({ data });
});
textilePurchaseRouter.delete('/textile/suppliers/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const { data: ex } = await supabaseAdmin.from('textile_suppliers').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Supplier');
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound('Supplier'));
  const { count } = await supabaseAdmin.from('textile_purchase_orders').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('supplier_id', idOf(req));
  if (count) throw new AppError(409, 'RECORD_IN_USE', `This supplier has ${count} purchase order(s). Mark it inactive instead of deleting it.`);
  const { error } = await supabaseAdmin.from('textile_suppliers').delete().eq('organization_id', orgId).eq('id', idOf(req));
  if (error) throw error;
  res.json({ data: ex });
});

// =============================================================== Purchase orders
async function buildPoLines(orgId: string, it: string, raw: Row[]): Promise<Row[]> {
  const products = await productMap(orgId, it, raw.map((l) => str(l.product_code)));
  const seen = new Set<string>();
  return raw.map((l, i) => {
    const p = products.get(str(l.product_code));
    if (!p) throw bad(`Item ${i + 1}: pick a product that exists in this industry.`);
    const quantity = Number(l.quantity);
    const rate = Number(l.rate === '' || l.rate == null ? p.cost_price ?? 0 : l.rate);
    const gst = Number(l.gst_percent === '' || l.gst_percent == null ? p.tax_percent ?? 0 : l.gst_percent);
    if (!(quantity > 0)) throw bad(`Item ${i + 1} (${p.product_name}): metres must be more than zero.`);
    if (Number.isNaN(rate) || rate < 0) throw bad(`Item ${i + 1} (${p.product_name}): rate cannot be negative.`);
    if (Number.isNaN(gst) || gst < 0 || gst > 100) throw bad(`Item ${i + 1} (${p.product_name}): GST % must be between 0 and 100.`);
    let colour = str(l.colour);
    const colours = coloursOf(p);
    if (colour && colours.length) {
      const hit = colours.find((c) => same(c, colour));
      if (!hit) throw bad(`Item ${i + 1} (${p.product_name}): colour "${colour}" is not on this product. Add it in Products first.`);
      colour = hit;
    }
    const key = `${p.product_code}|${colour.toLowerCase()}`;
    if (seen.has(key)) throw bad(`Item ${i + 1}: ${p.product_name}${colour ? ` (${colour})` : ''} is listed twice. Combine the metres in one line.`);
    seen.add(key);
    return { product_code: p.product_code, product_name: p.product_name, colour: colour || null, quantity: r2(quantity), received_quantity: 0, rate: r2(rate), gst_percent: gst };
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

textilePurchaseRouter.get('/textile/purchase-orders', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('textile_purchase_orders').select('*, textile_suppliers(supplier_name, supplier_code)').eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('created_at', { ascending: false }));
  res.json({ data });
});
textilePurchaseRouter.post('/textile/purchase-orders', authenticate, manager, async (req, res) => {
  const b = (req.body ?? {}) as Row; const it = bIt(req); const orgId = org(req);
  const status = b.status === 'Ordered' ? 'Ordered' : 'Draft';
  const sup = await getSupplier(orgId, it, b.supplier_id);
  if (sup.status !== 'active') throw bad(`${sup.supplier_name} is inactive and cannot receive new orders.`);
  const raw = (Array.isArray(b.lines) ? b.lines : []).filter((l: Row) => str(l.product_code) || num(l.quantity) > 0);
  if (!raw.length) throw bad('Add at least one fabric line to the order.');
  const orderDate = str(b.order_date) || today(); const expected = str(b.expected_date) || null;
  if (!isDate(orderDate)) throw bad('Order date is not valid.');
  if (expected && (!isDate(expected) || expected < orderDate)) throw bad('Expected delivery cannot be before the order date.');
  const lines = await buildPoLines(orgId, it, raw);
  const data = await insertNumbered('textile_purchase_orders', 'po_number', orgId, `TPO-${new Date().getFullYear()}-`, {
    industry_type_id: it, supplier_id: sup.id, order_date: orderDate, expected_date: expected, tolerance_percent: tolOf(b.tolerance_percent),
    notes: str(b.notes) || null, status, lines, ...poTotals(lines), created_by: actorOf(req),
  });
  res.status(201).json({ data });
});
textilePurchaseRouter.patch('/textile/purchase-orders/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req); const b = (req.body ?? {}) as Row;
  const { data: ex } = await supabaseAdmin.from('textile_purchase_orders').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Purchase order');
  const po = ex as Row;
  assertRecordInScope(req.industryScope!, po.industry_type_id, notFound('Purchase order'));
  const to = str(b.status);
  const received = (po.lines as Row[]).reduce((s, l) => s + num(l.received_quantity), 0);
  const patch: Row = {};

  if (b.lines !== undefined || b.supplier_id !== undefined || b.order_date !== undefined || b.expected_date !== undefined || b.notes !== undefined || b.tolerance_percent !== undefined) {
    if (po.status !== 'Draft') throw bad('Only a Draft purchase order can be edited.');
    if (b.supplier_id !== undefined) { const sup = await getSupplier(orgId, po.industry_type_id, b.supplier_id); if (sup.status !== 'active') throw bad(`${sup.supplier_name} is inactive.`); patch.supplier_id = sup.id; }
    if (b.order_date !== undefined) { if (!isDate(b.order_date)) throw bad('Order date is not valid.'); patch.order_date = b.order_date; }
    if (b.expected_date !== undefined) { const e = str(b.expected_date) || null; if (e && !isDate(e)) throw bad('Expected date is not valid.'); patch.expected_date = e; }
    if (b.notes !== undefined) patch.notes = str(b.notes) || null;
    if (b.tolerance_percent !== undefined) patch.tolerance_percent = tolOf(b.tolerance_percent);
    if (b.lines !== undefined) {
      const raw = (Array.isArray(b.lines) ? b.lines : []).filter((l: Row) => str(l.product_code) || num(l.quantity) > 0);
      if (!raw.length) throw bad('Add at least one fabric line to the order.');
      const lines = await buildPoLines(orgId, po.industry_type_id, raw);
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
    } else if (to === 'Closed') { // short-close: the mill will not deliver the rest
      if (po.status !== 'Partially Received') throw bad('Only a Partially Received order can be closed. Cancel a Draft/Ordered order instead.');
    } else throw bad('Status must be Ordered, Cancelled or Closed.');
    patch.status = to;
  }
  if (!Object.keys(patch).length) throw bad('Nothing to change.');
  const { data, error } = await supabaseAdmin.from('textile_purchase_orders').update(patch).eq('organization_id', orgId).eq('id', po.id).select().single();
  if (error) throw error;
  res.json({ data });
});
textilePurchaseRouter.delete('/textile/purchase-orders/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const { data: ex } = await supabaseAdmin.from('textile_purchase_orders').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Purchase order');
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound('Purchase order'));
  if ((ex as Row).status !== 'Draft') throw bad('Only a Draft purchase order can be deleted. Cancel it instead.');
  const { error } = await supabaseAdmin.from('textile_purchase_orders').delete().eq('organization_id', orgId).eq('id', idOf(req));
  if (error) throw error;
  res.json({ data: ex });
});

// =============================================================== Goods receipt (GRN) - creates the rolls
const GRADES = ['A', 'B', 'C', 'Reject'];
const INSPECTIONS = ['Pass', 'Fail', 'Pending'];

textilePurchaseRouter.get('/textile/grns', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('textile_grns').select('*, textile_suppliers(supplier_name, supplier_code), textile_purchase_orders(po_number)').eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('created_at', { ascending: false }));
  res.json({ data });
});

textilePurchaseRouter.post('/textile/grns', authenticate, manager, async (req, res) => {
  const b = (req.body ?? {}) as Row; const it = bIt(req); const orgId = org(req);
  const { data: poRow } = await supabaseAdmin.from('textile_purchase_orders').select('*').eq('organization_id', orgId).eq('id', str(b.po_id)).maybeSingle();
  if (!poRow) throw bad('Select the purchase order these rolls were received against.');
  const po = poRow as Row;
  if (po.industry_type_id !== it) throw bad('That purchase order does not belong to this industry.');
  if (!['Ordered', 'Partially Received'].includes(po.status)) throw bad(`Goods can only be received against an Ordered or Partially Received purchase order (this one is ${po.status}).`);
  const receivedDate = str(b.received_date) || today();
  if (!isDate(receivedDate)) throw bad('Received date is not valid.');
  if (receivedDate > today()) throw bad('Received date cannot be in the future.');
  const invoiceNo = str(b.supplier_invoice_no);
  if (invoiceNo) { // the same supplier bill must not be booked twice (double bill = double payment)
    const { data: sameInv } = await supabaseAdmin.from('textile_grns').select('grn_number').eq('organization_id', orgId).eq('industry_type_id', it)
      .eq('supplier_id', po.supplier_id).eq('status', 'Posted').ilike('supplier_invoice_no', like(invoiceNo)).limit(1);
    if ((sameInv ?? []).length) throw new AppError(409, 'DUPLICATE_RECORD', `Supplier invoice ${invoiceNo} is already recorded on ${String((sameInv as Row[])[0].grn_number)}. Check the number, or cancel that receipt first.`);
  }
  const rollsIn = (Array.isArray(b.rolls) ? b.rolls : []) as Row[];
  if (!rollsIn.length) throw bad('Add at least one roll.');
  if (rollsIn.length > 500) throw bad('A receipt can hold at most 500 rolls. Split it into two receipts.');

  const poLines: Row[] = (po.lines as Row[]).map((l) => ({ ...l }));
  const tol = num(po.tolerance_percent);
  const products = await productMap(orgId, it, rollsIn.map((r) => str(r.product_code)));

  // roll numbers: typed ones must be unique, the rest are generated as FR-YYYYMMDD-0001 ...
  const prefix = `FR-${receivedDate.replace(/-/g, '')}-`;
  let seq = await maxSuffix('textile_fabric_rolls', 'roll_number', orgId, prefix);
  const typed = rollsIn.map((r) => str(r.roll_number)).filter(Boolean);
  if (new Set(typed.map((t) => t.toLowerCase())).size !== typed.length) throw bad('The same roll number is entered twice.');
  if (typed.length) {
    const { data: clash } = await supabaseAdmin.from('textile_fabric_rolls').select('roll_number').eq('organization_id', orgId).in('roll_number', typed);
    if ((clash ?? []).length) throw new AppError(409, 'DUPLICATE_RECORD', `Roll number ${(clash as Row[])[0].roll_number} already exists.`);
  }

  const added = new Map<number, number>(); // PO line index -> metres in this receipt
  const grnLines: Row[] = [];
  rollsIn.forEach((r, i) => {
    const n = i + 1;
    const code = str(r.product_code);
    const p = products.get(code);
    if (!p) throw bad(`Roll ${n}: pick a fabric product that exists in this industry.`);
    let colour = str(r.colour);
    const colours = coloursOf(p);
    if (colours.length) {
      if (!colour) throw bad(`Roll ${n} (${p.product_name}): pick the colour.`);
      const hit = colours.find((c) => same(c, colour));
      if (!hit) throw bad(`Roll ${n} (${p.product_name}): colour "${colour}" is not on this product.`);
      colour = hit;
    }
    const cands = (poLines as Row[]).map((l, idx) => ({ l, idx })).filter((x) => x.l.product_code === code);
    const hit = (colour ? cands.find((x) => same(x.l.colour, colour)) : undefined) ?? cands.find((x) => !str(x.l.colour));
    if (!hit) throw bad(`Roll ${n}: ${p.product_name}${colour ? ` (${colour})` : ''} is not on purchase order ${po.po_number}.`);
    const length = Number(r.length_meters);
    if (!(length > 0) || length > 100000) throw bad(`Roll ${n}: length must be more than zero metres.`);
    const inspection = str(r.inspection) || 'Pending';
    if (!INSPECTIONS.includes(inspection)) throw bad(`Roll ${n}: inspection must be Pass, Fail or Pending.`);
    let grade = str(r.quality_grade) || null;
    if (grade && !GRADES.includes(grade)) throw bad(`Roll ${n}: grade must be one of ${GRADES.join(', ')}.`);
    if (inspection === 'Fail' && !grade) grade = 'Reject';
    const td = (p.textile_details ?? {}) as Row;
    const gsm = r.gsm === '' || r.gsm == null ? (td.gsm ?? null) : Number(r.gsm);
    const widthDefault = td.width == null ? null : td.widthUnit === 'cm' ? r2(Number(td.width) / 2.54) : Number(td.width);
    const width = r.width_inches === '' || r.width_inches == null ? widthDefault : Number(r.width_inches);
    if ((gsm != null && (Number.isNaN(Number(gsm)) || Number(gsm) < 0)) || (width != null && (Number.isNaN(Number(width)) || Number(width) < 0))) throw bad(`Roll ${n}: GSM and width cannot be negative.`);
    const rollNumber = str(r.roll_number) || `${prefix}${String((seq += 1)).padStart(4, '0')}`;
    const metres = r2(length);
    added.set(hit.idx, r2((added.get(hit.idx) ?? 0) + metres));
    grnLines.push({
      roll_number: rollNumber, product_code: code, product_name: p.product_name, colour: colour || null, fabric_type: td.fabricType || 'Other',
      lot_number: str(r.lot_number) || null, length_meters: metres, gsm: gsm == null ? null : Number(gsm), width_inches: width == null ? null : Number(width),
      quality_grade: grade, warehouse_location: str(r.warehouse_location) || null, inspection, po_line: hit.idx,
      rate: num(hit.l.rate), gst_percent: num(hit.l.gst_percent),
      amount: r2(metres * num(hit.l.rate) * (1 + num(hit.l.gst_percent) / 100)),
    });
  });
  for (const idx of overReceivedLines(poLines, added, tol)) {
    const l = poLines[idx];
    throw bad(`${l?.product_name ?? 'Item'}${l?.colour ? ` (${l.colour})` : ''}: ordered ${num(l?.quantity)} m, already received ${num(l?.received_quantity)} m, this receipt adds ${added.get(idx)} m - more than the order allows${tol ? ` (tolerance ${tol}%)` : ''}.`);
  }

  // Everything below happens in ONE database transaction (textile_grn_post): the PO is locked, the rolls, quality
  // results, roll ledger and PO status are written together, or nothing is written at all.
  const { data: sup } = await supabaseAdmin.from('textile_suppliers').select('supplier_name').eq('organization_id', orgId).eq('id', po.supplier_id).maybeSingle();
  const year = new Date().getFullYear();
  const grnPrefix = `TGRN-${year}-`;
  const addedObj: Record<string, number> = {};
  for (const [idx, add] of added) addedObj[String(idx)] = add;
  let grn: Row | null = null;
  for (let attempt = 0; attempt < 4 && !grn; attempt += 1) {
    const grnNumber = `${grnPrefix}${String((await maxSuffix('textile_grns', 'grn_number', orgId, grnPrefix)) + 1).padStart(4, '0')}`;
    const { data, error } = await supabaseAdmin.rpc('textile_grn_post', {
      p_org: orgId, p_it: it, p_po: po.id, p_user: actorOf(req),
      p_grn: {
        grn_number: grnNumber, received_date: receivedDate, supplier_invoice_no: str(b.supplier_invoice_no) || null, transporter: str(b.transporter) || null,
        vehicle_number: str(b.vehicle_number) || null, lr_number: str(b.lr_number) || null, notes: str(b.notes) || null, supplier_name: (sup as Row | null)?.supplier_name ?? null,
      },
      p_rolls: grnLines, p_added: addedObj,
    });
    if (!error) { grn = data as Row; break; }
    if (error.code === '23505' && /grn_number/.test(`${error.message ?? ''} ${error.details ?? ''}`)) continue; // someone took that GRN number: try the next one
    throw rpcError(error);
  }
  if (!grn) throw new AppError(409, 'DUPLICATE_RECORD', 'Could not allocate a new receipt number. Please try again.');
  for (const code of new Set(grnLines.map((l) => l.product_code as string))) await syncProductStockFromRolls(orgId, code);
  res.status(201).json({ data: grn });
});

// Cancel a receipt: only while none of its rolls has been touched (cut, damaged, allocated, sold).
textilePurchaseRouter.post('/textile/grns/:id/cancel', authenticate, manager, async (req, res) => {
  const orgId = org(req); const undo: Undo[] = [];
  const reason = str((req.body ?? {}).reason);
  if (reason.length < 3) throw bad('A reason is required to cancel a goods receipt.');
  const { data: ex } = await supabaseAdmin.from('textile_grns').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound('Goods receipt');
  const grn = ex as Row;
  assertRecordInScope(req.industryScope!, grn.industry_type_id, notFound('Goods receipt'));
  if (grn.status !== 'Posted') throw bad(`This goods receipt is already ${grn.status}.`);
  const lines = grn.lines as Row[];
  const numbers = lines.map((l) => String(l.roll_number));
  const { data: rolls, error } = await supabaseAdmin.from('textile_fabric_rolls').select('*').eq('organization_id', orgId).in('roll_number', numbers);
  if (error) throw error;
  const byNo = new Map(((rolls ?? []) as Row[]).map((r) => [String(r.roll_number), r]));
  const used: string[] = [];
  for (const l of lines) {
    const r = byNo.get(String(l.roll_number));
    if (!r) continue; // already gone
    const untouched = !r.order_id && ['In stock', 'Quarantine', 'Damaged'].includes(String(r.status))
      && Math.abs(num(r.length_meters) - num(l.length_meters)) < 1e-9 && num(r.reserved_meters) === 0 && num(r.sold_meters) === 0 && num(r.damaged_meters) === 0;
    if (!untouched) used.push(String(r.roll_number));
  }
  if (used.length) throw bad(`These rolls were already used (cut, damaged or allocated), so the receipt cannot be cancelled: ${used.slice(0, 8).join(', ')}${used.length > 8 ? '…' : ''}.`, 'GRN_IN_USE');

  try {
    const { data: claimed, error: ce } = await supabaseAdmin.from('textile_grns').update({ status: 'Cancelled', cancel_reason: reason, cancelled_at: new Date().toISOString() })
      .eq('organization_id', orgId).eq('id', grn.id).eq('status', 'Posted').select('id');
    if (ce) throw ce;
    if (!claimed || !claimed.length) throw new AppError(409, 'GRN_CHANGED', 'This goods receipt was just changed by someone else. Refresh and try again.');
    undo.push(async () => { await supabaseAdmin.from('textile_grns').update({ status: 'Posted', cancel_reason: null, cancelled_at: null }).eq('organization_id', orgId).eq('id', grn.id); });

    const { data: poRow } = await supabaseAdmin.from('textile_purchase_orders').select('*').eq('organization_id', orgId).eq('id', grn.po_id).maybeSingle();
    if (poRow) {
      const po = poRow as Row; const poLines: Row[] = (po.lines as Row[]).map((l) => ({ ...l }));
      for (const l of lines) { const t = poLines[Number(l.po_line)]; if (t) t.received_quantity = Math.max(0, r2(num(t.received_quantity) - num(l.length_meters))); }
      const status = po.status === 'Closed' || po.status === 'Cancelled' ? po.status : poStatusFromReceipts(poLines, num(po.tolerance_percent));
      const before = { lines: po.lines, status: po.status };
      const { error: pe } = await supabaseAdmin.from('textile_purchase_orders').update({ lines: poLines, status }).eq('organization_id', orgId).eq('id', po.id);
      if (pe) throw pe;
      undo.push(async () => { await supabaseAdmin.from('textile_purchase_orders').update(before).eq('organization_id', orgId).eq('id', po.id); });
    }

    const present = ((rolls ?? []) as Row[]);
    if (present.length) {
      await supabaseAdmin.from('textile_roll_transactions').insert(present.map((r) => ({
        organization_id: orgId, industry_type_id: r.industry_type_id, roll_id: r.id, roll_number: r.roll_number, txn_type: 'adjustment',
        quantity_m: r.length_meters, available_delta: -num(r.length_meters), balance_after: 0, note: `${String(grn.grn_number)} cancelled: ${reason}`, created_by: actorOf(req),
      })));
      await supabaseAdmin.from('textile_quality_inspections').delete().eq('organization_id', orgId).in('inspection_code', numbers.map((n) => `QI-${n}`)).eq('inspector_name', `GRN ${String(grn.grn_number)}`);
      const { error: de } = await supabaseAdmin.from('textile_fabric_rolls').delete().eq('organization_id', orgId).in('id', present.map((r) => r.id as string));
      if (de) throw de;
    }
    for (const code of new Set(lines.map((l) => String(l.product_code)))) await syncProductStockFromRolls(orgId, code);
    res.json({ data: { id: grn.id, status: 'Cancelled' } });
  } catch (e) {
    await runUndo(undo);
    throw e;
  }
});