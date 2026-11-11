/* eslint-disable @typescript-eslint/no-explicit-any */
// FILE: api/src/routes/textile-automation.routes.ts
// Textile Automation Center (Textile industry only; every query is limited to the active Industry Type).
//   GET  /textile/automation/summary          -> counts for the Automation Center cards
//   GET  /textile/reorder-suggestions         -> products below minimum stock (after counting metres already on order)
//   POST /textile/reorder-suggestions/create-po -> one Draft purchase order per supplier
//   GET  /textile/qc-queue                    -> rolls waiting for inspection (Quarantine, no inspection yet)
//   POST /textile/samples/:id/create-requirement -> approved sample becomes an open Requirement (then Quotation as usual)
// Nothing here changes any existing Textile route or any other industry.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { todayLocal } from '../lib/ist-date.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { createRequirement } from '../repositories/requirements.repository.js';
import { pendingCreditReturns, supplierOutstanding } from '../lib/textile-finance.js';
import { pendingCustomerRefunds, returnableRolls } from '../lib/textile-returns.js';

export const textileAutomationRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');

type Req = Parameters<RequestHandler>[0];
type Row = Record<string, any>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const r2 = (v: number) => Math.round(v * 100) / 100;
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

// ---------------------------------------------------------------- products of this industry
async function industryProducts(orgId: string, it: string): Promise<Row[]> {
  const ids = (await all(() => supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', orgId).eq('industry_type_id', it).order('product_id')))
    .map((r) => r.product_id as string);
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('products')
      .select('id, product_code, product_name, stock_quantity, min_stock_level, cost_price, tax_percent, supplier_name, status')
      .eq('organization_id', orgId).eq('status', 'active').in('id', ids.slice(i, i + 100));
    // min_stock_level comes from migration 20261020_products_min_stock.sql; before it runs there is simply nothing to suggest.
    if (error) { if ((error as { code?: string }).code === '42703') return []; throw error; }
    out.push(...((data ?? []) as Row[]));
  }
  return out;
}

const OPEN_PO = ['Ordered', 'Partially Received'];

/** Metres still to arrive per product code from open purchase orders. */
async function onOrderMetres(orgId: string, it: string): Promise<{ onOrder: Map<string, number>; lastSupplier: Map<string, { id: string; name: string }> }> {
  const pos = await all(() => supabaseAdmin.from('textile_purchase_orders').select('id, supplier_id, status, lines, created_at, textile_suppliers(supplier_name)')
    .eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled').order('created_at', { ascending: false }));
  const onOrder = new Map<string, number>();
  const lastSupplier = new Map<string, { id: string; name: string }>();
  for (const po of pos) {
    const sup = { id: po.supplier_id as string, name: String(po.textile_suppliers?.supplier_name ?? '') };
    for (const l of (po.lines ?? []) as Row[]) {
      const code = str(l.product_code);
      if (!code) continue;
      if (!lastSupplier.has(code)) lastSupplier.set(code, sup); // newest PO first
      if (OPEN_PO.includes(po.status) || po.status === 'Draft') onOrder.set(code, r2((onOrder.get(code) ?? 0) + Math.max(0, num(l.quantity) - num(l.received_quantity))));
    }
  }
  return { onOrder, lastSupplier };
}

async function reorderList(orgId: string, it: string): Promise<Row[]> {
  const products = await industryProducts(orgId, it);
  const withMin = products.filter((p) => num(p.min_stock_level) > 0);
  if (!withMin.length) return [];
  const { onOrder, lastSupplier } = await onOrderMetres(orgId, it);
  // Rolls received but still waiting for inspection are stock on the way in: do not suggest them again.
  for (const r of await all(() => supabaseAdmin.from('textile_fabric_rolls').select('product_code, length_meters').eq('organization_id', orgId).eq('industry_type_id', it).eq('status', 'Quarantine'))) {
    const code = str(r.product_code);
    if (code) onOrder.set(code, r2((onOrder.get(code) ?? 0) + num(r.length_meters)));
  }
  const suppliers = await all(() => supabaseAdmin.from('textile_suppliers').select('id, supplier_name, status').eq('organization_id', orgId).eq('industry_type_id', it));
  const byName = new Map(suppliers.filter((s) => s.status === 'active').map((s) => [String(s.supplier_name).toLowerCase(), s]));
  const out: Row[] = [];
  for (const p of withMin) {
    const stock = num(p.stock_quantity); const min = num(p.min_stock_level); const incoming = onOrder.get(String(p.product_code)) ?? 0;
    const shortBy = r2(min - (stock + incoming));
    if (shortBy <= 0) continue;
    const last = lastSupplier.get(String(p.product_code));
    const named = byName.get(String(p.supplier_name ?? '').toLowerCase());
    const sup = last ?? (named ? { id: named.id as string, name: String(named.supplier_name) } : null);
    out.push({
      product_code: p.product_code, product_name: p.product_name, stock, min_stock_level: min, on_order: incoming, short_by: shortBy,
      suggested_quantity: Math.ceil(shortBy), rate: num(p.cost_price), gst_percent: num(p.tax_percent),
      supplier_id: sup?.id ?? null, supplier_name: sup?.name ?? null,
    });
  }
  return out.sort((a, b) => b.short_by - a.short_by);
}

textileAutomationRouter.get('/textile/reorder-suggestions', authenticate, manager, async (req, res) => {
  res.json({ data: await reorderList(org(req), qIt(req)) });
});

textileAutomationRouter.post('/textile/reorder-suggestions/create-po', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = bIt(req); const b = (req.body ?? {}) as Row;
  const items = (Array.isArray(b.items) ? b.items : []) as Row[];
  if (!items.length) throw bad('Select at least one product to reorder.');
  const products = await industryProducts(orgId, it);
  const byCode = new Map(products.map((p) => [String(p.product_code), p]));
  const bySupplier = new Map<string, Row[]>();
  for (const [i, it2] of items.entries()) {
    const p = byCode.get(str(it2.product_code));
    if (!p) throw bad(`Item ${i + 1}: product ${str(it2.product_code)} does not exist in this industry.`);
    const quantity = Number(it2.quantity);
    if (!(quantity > 0)) throw bad(`${p.product_name}: metres must be more than zero.`);
    const supplierId = str(it2.supplier_id);
    if (!supplierId) throw bad(`${p.product_name}: pick a supplier / mill first.`);
    const line = { product_code: p.product_code, product_name: p.product_name, colour: null, quantity: r2(quantity), received_quantity: 0, rate: r2(num(p.cost_price)), gst_percent: num(p.tax_percent) };
    bySupplier.set(supplierId, [...(bySupplier.get(supplierId) ?? []), line]);
  }
  const { data: sups, error } = await supabaseAdmin.from('textile_suppliers').select('id, supplier_name, status')
    .eq('organization_id', orgId).eq('industry_type_id', it).in('id', [...bySupplier.keys()]);
  if (error) throw error;
  const supById = new Map(((sups ?? []) as Row[]).map((s) => [s.id as string, s]));
  for (const id of bySupplier.keys()) {
    const s = supById.get(id);
    if (!s) throw bad('One of the selected suppliers does not belong to this industry.');
    if (s.status !== 'active') throw bad(`${s.supplier_name} is inactive and cannot receive new orders.`);
  }
  const created: Row[] = [];
  for (const [supplierId, lines] of bySupplier) {
    const subtotal = r2(lines.reduce((s, l) => s + num(l.quantity) * num(l.rate), 0));
    const tax = r2(lines.reduce((s, l) => s + (num(l.quantity) * num(l.rate) * num(l.gst_percent)) / 100, 0));
    created.push(await insertNumbered('textile_purchase_orders', 'po_number', orgId, `TPO-${new Date().getFullYear()}-`, {
      industry_type_id: it, supplier_id: supplierId, order_date: todayLocal(), expected_date: null, tolerance_percent: 0,
      notes: 'Auto-created from low-stock reorder suggestions', status: 'Draft', lines, subtotal, tax_amount: tax, total_amount: r2(subtotal + tax), created_by: actorOf(req),
    }));
  }
  res.status(201).json({ data: created });
});

// ---------------------------------------------------------------- QC queue
async function qcQueue(orgId: string, it: string): Promise<Row[]> {
  const rolls = await all(() => supabaseAdmin.from('textile_fabric_rolls')
    .select('id, roll_number, product_code, fabric_type, colour, length_meters, lot_number, supplier_name, received_date, status')
    .eq('organization_id', orgId).eq('industry_type_id', it).eq('status', 'Quarantine').order('received_date', { ascending: true }));
  if (!rolls.length) return [];
  const done = new Set<string>();
  const numbers = rolls.map((r) => String(r.roll_number));
  for (let i = 0; i < numbers.length; i += 200) {
    const { data, error } = await supabaseAdmin.from('textile_quality_inspections').select('roll_number')
      .eq('organization_id', orgId).eq('industry_type_id', it).in('roll_number', numbers.slice(i, i + 200));
    if (error) throw error;
    for (const x of (data ?? []) as Row[]) done.add(String(x.roll_number));
  }
  const today = todayLocal();
  return rolls.filter((r) => !done.has(String(r.roll_number))).map((r) => ({
    ...r, days_waiting: r.received_date ? Math.max(0, Math.round((Date.parse(today) - Date.parse(String(r.received_date))) / 86400000)) : 0,
  }));
}
textileAutomationRouter.get('/textile/qc-queue', authenticate, manager, async (req, res) => {
  res.json({ data: await qcQueue(org(req), qIt(req)) });
});

// ---------------------------------------------------------------- approved sample -> requirement
textileAutomationRouter.post('/textile/samples/:id/create-requirement', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = bIt(req); const b = (req.body ?? {}) as Row;
  const { data: sampleRow, error: se } = await supabaseAdmin.from('textile_samples').select('*').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', idOf(req)).maybeSingle();
  if (se) throw se;
  if (!sampleRow) throw new AppError(404, 'RECORD_NOT_FOUND', 'Sample was not found.');
  const sample = sampleRow as Row;
  if (sample.status !== 'Approved') throw bad('Only an Approved sample can be turned into a requirement.');
  const metres = Number(b.quantity);
  if (!(metres > 0)) throw bad('Enter how many metres the client wants.');

  const { data: client } = await supabaseAdmin.from('clients').select('id, client_name').eq('organization_id', orgId).eq('industry_type_id', it).eq('client_name', sample.client_name).maybeSingle();
  if (!client) throw bad(`Client "${String(sample.client_name)}" was not found in this industry. Add or fix the client first.`);
  const { data: product } = sample.design_code
    ? await supabaseAdmin.from('products').select('id').eq('organization_id', orgId).eq('product_code', sample.design_code).maybeSingle()
    : { data: null };
  if (!product) throw bad('This sample has no valid product. Pick the product on the sample first.');

  const title = `Order from approved sample ${String(sample.sample_code)}`;
  const { data: dup } = await supabaseAdmin.from('requirements').select('id, status').eq('organization_id', orgId).eq('client_id', (client as Row).id).eq('title', title).neq('status', 'dropped').limit(1);
  if ((dup ?? []).length) throw new AppError(409, 'DUPLICATE_RECORD', 'A requirement was already created from this sample.');

  // Representative: the one assigned to this client, else the signed-in user's own profile, else any active representative.
  let repId: string | null = null;
  const { data: assigned } = await supabaseAdmin.from('sales_representative_client_assignments').select('sales_representative_id').eq('organization_id', orgId).eq('client_id', (client as Row).id).limit(1);
  repId = ((assigned ?? [])[0] as Row | undefined)?.sales_representative_id ?? null;
  if (!repId && actorOf(req)) {
    const { data: mine } = await supabaseAdmin.from('sales_representatives').select('id').eq('organization_id', orgId).eq('user_id', actorOf(req)).eq('status', 'active').maybeSingle();
    repId = (mine as Row | null)?.id ?? null;
  }
  if (!repId) {
    const { data: any1 } = await supabaseAdmin.from('sales_representatives').select('id').eq('organization_id', orgId).eq('status', 'active').limit(1);
    repId = ((any1 ?? [])[0] as Row | undefined)?.id ?? null;
  }
  if (!repId) throw bad('Add at least one active sales representative first (Sales representatives).');

  const data = await createRequirement(orgId, repId, {
    clientId: (client as Row).id, title, description: `Client approved the sample ${String(sample.sample_code)}. Ready to quote.`, urgency: 'normal',
    items: [{ productId: (product as Row).id, quantity: r2(metres), notes: `From approved sample ${String(sample.sample_code)}` }],
  } as any);
  res.status(201).json({ data });
});

// ---------------------------------------------------------------- summary for the Automation Center
textileAutomationRouter.get('/textile/automation/summary', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = qIt(req); const today = todayLocal();
  const [rolls, samples, pos, reorder, qc, dues, creditPending, refundsDue, sendBack, debitNotes] = await Promise.all([
    all(() => supabaseAdmin.from('textile_fabric_rolls').select('status, length_meters').eq('organization_id', orgId).eq('industry_type_id', it)),
    all(() => supabaseAdmin.from('textile_samples').select('status, expected_response_date').eq('organization_id', orgId).eq('industry_type_id', it)),
    all(() => supabaseAdmin.from('textile_purchase_orders').select('status, expected_date, total_amount').eq('organization_id', orgId).eq('industry_type_id', it)),
    reorderList(orgId, it),
    qcQueue(orgId, it),
    supplierOutstanding(orgId, it).catch(() => [] as Row[]), // payments table not created yet -> zero
    pendingCreditReturns(orgId, it).catch(() => [] as Row[]),
    pendingCustomerRefunds(orgId, it).catch(() => [] as Row[]), // customers who paid more than the order is now worth
    returnableRolls(orgId, it).catch(() => [] as Row[]), // damaged / rejected rolls still on the shelf that came from a GRN
    all(() => supabaseAdmin.from('textile_debit_notes').select('total_amount, note_date').eq('organization_id', orgId).eq('industry_type_id', it).eq('status', 'Issued')).catch(() => [] as Row[]),
  ]);
  const inStock = rolls.filter((r) => r.status === 'In stock');
  const openPos = pos.filter((p) => OPEN_PO.includes(p.status));
  res.json({
    data: {
      rolls_in_stock: inStock.length,
      metres_in_stock: r2(inStock.reduce((s, r) => s + num(r.length_meters), 0)),
      qc_waiting: qc.length,
      damaged_rolls: rolls.filter((r) => r.status === 'Damaged').length,
      samples_pending: samples.filter((s) => s.status === 'Pending').length,
      samples_overdue: samples.filter((s) => s.status === 'Pending' && s.expected_response_date && String(s.expected_response_date) < today).length,
      samples_approved: samples.filter((s) => s.status === 'Approved').length,
      open_pos: openPos.length,
      overdue_pos: openPos.filter((p) => p.expected_date && String(p.expected_date) < today).length,
      draft_pos: pos.filter((p) => p.status === 'Draft').length,
      reorder_count: reorder.length,
      supplier_outstanding: r2(dues.reduce((t, d) => t + num(d.outstanding), 0)),
      supplier_overdue: r2(dues.reduce((t, d) => t + num(d.overdue_1_30) + num(d.overdue_31_60) + num(d.overdue_60_plus), 0)),
      credit_notes_pending: creditPending.length,
      customer_refunds_due: refundsDue.length,
      customer_refunds_amount: r2(refundsDue.reduce((t, x) => t + num(x.due), 0)),
      supplier_credit: r2(dues.reduce((t, d) => t + num(d.advance), 0)),
      rolls_to_send_back: sendBack.filter((r) => r.suggested).length,
      metres_to_send_back: r2(sendBack.filter((r) => r.suggested).reduce((t, r) => t + num(r.available), 0)),
      debit_notes_total: r2(debitNotes.reduce((t, d) => t + num(d.total_amount), 0)),
    },
  });
});