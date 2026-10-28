// Textile industry CRUD (Design, Colour & Size, Fabric Roll, Sample, Quality).
// Own tables, own routes: nothing here touches Trading / FMCG / School / other industries.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { assertRecordInScope, resolveIndustryTypeId } from '../lib/industry-scope.js';
import { TEXTILE_RESOURCES, type TextileResource } from '../lib/textile-resources.js';
import { createMovement } from '../repositories/inventory.repository.js';
import { syncProductStockFromRolls } from '../lib/textile-rolls.js';

export const textileRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
// Sales reps get READ-ONLY access to the catalogue-type modules (not Quality Inspections).
const reader = requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative');

type Req = Parameters<RequestHandler>[0];
type Row = Record<string, unknown>;

const org = (req: Req) => {
  const v = req.header('x-organization-id');
  if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return v;
};
const idOf = (req: Req) => {
  const v = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!v) throw new AppError(400, 'INVALID_ID', 'A resource id is required');
  return v;
};
const dup = (r: TextileResource, e: { details?: string | null }) => {
  const m = /Key \(([^)]+)\)/.exec(e.details ?? '');
  return new AppError(409, 'DUPLICATE_RECORD', `A ${r.path} record with that value already exists${m ? ` (same: ${m[1]})` : ''}.`);
};
function clean(r: TextileResource, body: unknown): Row {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'VALIDATION_ERROR', 'A JSON object body is required.');
  const allowed = new Set([...r.columns, 'status']);
  const out: Row = {};
  for (const [k, v] of Object.entries(body as Row)) if (allowed.has(k)) out[k] = v === '' ? null : v;
  return out;
}

// Value checks: allowed status values, no negative quantities, valid colour hex.
// `partial` = PATCH (only fields that were sent are checked).
function validateValues(r: TextileResource, payload: Row, partial: boolean) {
  if (payload.status !== undefined && payload.status !== null && !r.statuses.includes(String(payload.status))) {
    throw new AppError(400, 'VALIDATION_ERROR', `status must be one of: ${r.statuses.join(', ')}.`);
  }
  for (const k of r.nonNegative) {
    const v = payload[k];
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (Number.isNaN(n)) throw new AppError(400, 'VALIDATION_ERROR', `${k} must be a number.`);
    if (n < 0) throw new AppError(400, 'VALIDATION_ERROR', `${k} cannot be negative.`);
  }
  if (r.table === 'textile_variants' && payload.colour_hex && !/^#[0-9a-fA-F]{6}$/.test(String(payload.colour_hex))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'colour_hex must look like #RRGGBB.');
  }
  if (partial) {
    const blank = r.requiredFields.filter((k) => k in payload && (payload[k] === null || payload[k] === ''));
    if (blank.length) throw new AppError(400, 'VALIDATION_ERROR', `${blank.join(', ')} cannot be empty.`);
  }
}

async function existsIn(table: string, orgId: string, industryTypeId: string, column: string, value: unknown): Promise<boolean> {
  return (await countWhere(table, orgId, industryTypeId, column, value)) > 0;
}

// Links between Textile records must point at something that really exists (same organization + industry).
async function assertLinks(r: TextileResource, orgId: string, industryTypeId: string, payload: Row) {
   if (r.table === 'textile_variants' && payload.design_code) {
    if (!(await existsIn('textile_designs', orgId, industryTypeId, 'design_code', payload.design_code))) {
      throw new AppError(400, 'INVALID_REFERENCE', `Design ${String(payload.design_code)} does not exist. Create it in Design & Pattern first.`);
    }
  }
  // A sample is cut from a real fabric product (the design_code column now holds the product code).
  if (r.table === 'textile_samples' && payload.design_code) {
    const { data: product } = await supabaseAdmin.from('products').select('id').eq('organization_id', orgId).eq('product_code', payload.design_code as string).maybeSingle();
    if (!product) throw new AppError(400, 'INVALID_REFERENCE', `Product ${String(payload.design_code)} does not exist. Add it in Products first.`);
  }
  if (r.table === 'textile_quality_inspections' && payload.roll_number) {
    if (!(await existsIn('textile_fabric_rolls', orgId, industryTypeId, 'roll_number', payload.roll_number))) {
      throw new AppError(400, 'INVALID_REFERENCE', `Fabric roll ${String(payload.roll_number)} does not exist. Add it in Fabric Roll first.`);
    }
  }
}

// ---- links between Textile modules ------------------------------------------

// Quality inspection -> Fabric roll: the roll takes the inspected grade; a Fail marks it Damaged;
// a Pass on a Damaged roll puts it back In stock. Only the LATEST inspection of a roll drives it
// (editing an old inspection never overrides a newer result), and a Sold / Issued roll is never reopened.
async function isLatestInspection(orgId: string, insp: Row): Promise<boolean> {
  let q = supabaseAdmin.from('textile_quality_inspections').select('id')
    .eq('organization_id', orgId).eq('roll_number', insp.roll_number as string)
    .order('inspection_date', { ascending: false }).order('created_at', { ascending: false }).limit(1);
  if (typeof insp.industry_type_id === 'string') q = q.eq('industry_type_id', insp.industry_type_id);
  const { data } = await q;
  const latest = (data as { id: string }[] | null)?.[0];
  return !latest || latest.id === insp.id;
}
async function syncRollFromInspection(orgId: string, insp: Row) {
  const rollNumber = insp.roll_number;
  if (typeof rollNumber !== 'string' || !rollNumber) return;
  if (!(await isLatestInspection(orgId, insp))) return;
  const update: Row = {};
  if (insp.grade) update.quality_grade = insp.grade;
  if (insp.status === 'Fail') { update.status = 'Damaged'; if (!insp.grade) update.quality_grade = 'Reject'; }
  if (Object.keys(update).length === 0 && insp.status !== 'Pass') return;
  if (Object.keys(update).length > 0) {
    let q = supabaseAdmin.from('textile_fabric_rolls').update(update)
      .eq('organization_id', orgId).eq('roll_number', rollNumber);
    if (typeof insp.industry_type_id === 'string') q = q.eq('industry_type_id', insp.industry_type_id);
    if (update.status) q = q.neq('status', 'Sold'); // never reopen a sold roll
    await q; // best effort: the inspection itself is already saved
  }
  if (insp.status === 'Pass') {
    let q = supabaseAdmin.from('textile_fabric_rolls').update({ status: 'In stock' })
      .eq('organization_id', orgId).eq('roll_number', rollNumber).eq('status', 'Damaged');
    if (typeof insp.industry_type_id === 'string') q = q.eq('industry_type_id', insp.industry_type_id);
    await q;
  }
}

// Sample approved -> its Design moves from Draft to Active.
async function syncDesignFromSample(orgId: string, sample: Row) {
  if (sample.status !== 'Approved' || typeof sample.design_code !== 'string' || !sample.design_code) return;
  let q = supabaseAdmin.from('textile_designs').update({ status: 'Active' })
    .eq('organization_id', orgId).eq('design_code', sample.design_code).eq('status', 'Draft');
  if (typeof sample.industry_type_id === 'string') q = q.eq('industry_type_id', sample.industry_type_id);
  await q;
}

// Variant stock -> Inventory: when a Textile product has the same product code as the variant's SKU,
// the change in variant stock is posted to Inventory as an adjustment on that product.
// No matching Textile product = the stock simply stays on the variant (nothing else changes).
async function syncVariantStockToInventory(req: Req, variant: Row, delta: number) {
  if (!delta) return;
  const sku = variant.sku;
  const industryTypeId = variant.industry_type_id;
  if (typeof sku !== 'string' || !sku || typeof industryTypeId !== 'string') return;
  const orgId = org(req);
  const { data: product, error } = await supabaseAdmin.from('products').select('id')
    .eq('organization_id', orgId).eq('product_code', sku).limit(1).maybeSingle();
  if (error) throw error;
  if (!product) return;
  const { data: tag, error: tagError } = await supabaseAdmin.from('product_industry_types').select('product_id')
    .eq('organization_id', orgId).eq('product_id', (product as { id: string }).id).eq('industry_type_id', industryTypeId).maybeSingle();
  if (tagError) throw tagError;
  if (!tag) return; // product belongs to another industry: never touch it
  await createMovement(orgId, req.auth!.sub as string, req.industryScope!, {
    type: 'adjustment', productId: (product as { id: string }).id, quantity: delta,
    reason: 'Textile variant stock', reference: sku,
  });
}

async function afterSave(table: string, orgId: string, row: Row) {
  if (table === 'textile_fabric_rolls') await syncProductStockFromRolls(orgId, row.product_code);
  if (table === 'textile_quality_inspections') await syncRollFromInspection(orgId, row);
  
}

async function countWhere(table: string, orgId: string, industryTypeId: unknown, column: string, value: unknown): Promise<number> {
  if (typeof value !== 'string' || !value) return 0;
  let q = supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq(column, value);
  if (typeof industryTypeId === 'string') q = q.eq('industry_type_id', industryTypeId);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

// A design with variants / samples, or a roll with inspections, cannot be deleted.
async function assertCanDelete(table: string, orgId: string, row: Row) {
  if (table === 'textile_designs') {
    const variants = await countWhere('textile_variants', orgId, row.industry_type_id, 'design_code', row.design_code);
    const samples = await countWhere('textile_samples', orgId, row.industry_type_id, 'design_code', row.design_code);
    if (variants || samples) {
      throw new AppError(409, 'RECORD_IN_USE', `This design is used by ${variants} colour/size variant(s) and ${samples} sample(s). Remove or reassign them first.`);
    }
  }
  if (table === 'textile_fabric_rolls') {
    if (row.order_id && ['Issued', 'Sold'].includes(String(row.status))) {
      throw new AppError(409, 'RECORD_IN_USE', `This roll is ${String(row.status)} against order ${String(row.order_number ?? '')}. Release it from the order first.`);
    }
    const inspections = await countWhere('textile_quality_inspections', orgId, row.industry_type_id, 'roll_number', row.roll_number);
    if (inspections) throw new AppError(409, 'RECORD_IN_USE', `This roll has ${inspections} quality inspection(s). Remove them first.`);
  }
}

// ---- Fabric roll <-> Order link ------------------------------------------------
// Roll.status follows its order: confirmed order -> Issued, dispatched / delivered / completed -> Sold,
// cancelled -> released back to In stock. Orders themselves are never modified from here.
type OrderRow = { id: string; order_number: string; status: string; dispatch_status?: string | null; textile_delivery_status?: string | null };
const today = () => new Date().toISOString().slice(0, 10);
function rollStatusForOrder(o: OrderRow): 'Issued' | 'Sold' | 'Release' {
  if (o.status === 'cancelled') return 'Release';
  if (o.status === 'completed' || ['dispatched', 'delivered'].includes(String(o.dispatch_status ?? ''))) return 'Sold';
  // Delivery tracking: once the fabric has left for the client, the rolls are sold.
  if (['dispatched', 'out_for_delivery', 'delivered'].includes(String(o.textile_delivery_status ?? ''))) return 'Sold';
  return 'Issued';
}

async function loadOrderForRoll(orgId: string, industryTypeId: string, orderId: string): Promise<OrderRow> {
  const { data, error } = await supabaseAdmin.from('sale_orders')
    .select('id, order_number, status, dispatch_status, textile_delivery_status, clients!inner(industry_type_id)')
    .eq('organization_id', orgId).eq('id', orderId).maybeSingle();
  if (error) throw error;
  const row = data as (OrderRow & { clients: { industry_type_id?: string | null } | { industry_type_id?: string | null }[] }) | null;
  const client = Array.isArray(row?.clients) ? row?.clients[0] : row?.clients;
  if (!row || client?.industry_type_id !== industryTypeId) {
    throw new AppError(400, 'INVALID_REFERENCE', 'That order does not exist in this industry.');
  }
  if (row.status === 'cancelled') throw new AppError(400, 'INVALID_REFERENCE', 'A cancelled order cannot be allocated to a roll.');
  return row;
}

// A roll may only be allocated when: its latest inspection is Pass, it is the same product as an order line,
// and the order still needs more metres of that product.
async function assertRollCanBeAllocated(orgId: string, industryTypeId: string, orderId: string, roll: { id?: string; roll_number?: unknown; product_code?: unknown }) {
  const rollNumber = typeof roll.roll_number === 'string' ? roll.roll_number : '';
  const productCode = typeof roll.product_code === 'string' ? roll.product_code : '';
  if (!productCode) throw new AppError(400, 'VALIDATION_ERROR', 'Set the product code on this roll before allocating it to an order.');

  const { data: insp, error: ie } = await supabaseAdmin.from('textile_quality_inspections').select('status')
    .eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('roll_number', rollNumber)
    .order('inspection_date', { ascending: false }).order('created_at', { ascending: false }).limit(1);
  if (ie) throw ie;
  const latest = (insp as { status: string }[] | null)?.[0];
  if (!latest) throw new AppError(400, 'INSPECTION_REQUIRED', `Roll ${rollNumber} has no quality inspection. Inspect it (Pass) before allocating it to an order.`);
  if (latest.status !== 'Pass') throw new AppError(400, 'INSPECTION_REQUIRED', `Roll ${rollNumber} did not pass its latest quality inspection.`);

  const { data: lines, error: le } = await supabaseAdmin.from('sale_order_items')
    .select('quantity, free_quantity, products(product_code)').eq('order_id', orderId);
  if (le) throw le;
  let needed = 0; let matched = false;
  for (const l of (lines ?? []) as unknown as { quantity: number | null; free_quantity: number | null; products: { product_code?: string } | { product_code?: string }[] | null }[]) {
    const p = Array.isArray(l.products) ? l.products[0] : l.products;
    if (p?.product_code === productCode) { matched = true; needed += (Number(l.quantity) || 0) + (Number(l.free_quantity) || 0); }
  }
  if (!matched) throw new AppError(400, 'VALIDATION_ERROR', `This order has no line for product ${productCode}. The roll must be the same product as the order.`);

  let q = supabaseAdmin.from('textile_fabric_rolls').select('length_meters')
    .eq('organization_id', orgId).eq('order_id', orderId).eq('product_code', productCode).in('status', ['Issued', 'Sold']);
  if (roll.id) q = q.neq('id', roll.id);
  const { data: others } = await q;
  const allocated = ((others ?? []) as { length_meters: number | null }[]).reduce((s, r) => s + (Number(r.length_meters) || 0), 0);
  if (allocated >= needed) throw new AppError(409, 'ORDER_FULLY_ALLOCATED', `This order is already fully covered (${allocated} m allocated of ${needed} m ordered).`);
}

// Prepares the order-link columns of a Fabric Roll before it is saved. `existing` is null on create.
async function prepareRollOrderLink(orgId: string, industryTypeId: string, payload: Row, existing: Row | null) {
  if (!('order_id' in payload)) return;
  const newOrderId = typeof payload.order_id === 'string' && payload.order_id ? payload.order_id : null;
  const oldOrderId = (existing?.order_id as string | null | undefined) ?? null;
  const oldStatus = existing?.status as string | undefined;
  if (newOrderId === oldOrderId) {
    delete payload.order_id; // nothing allocated, or same order: keep the link exactly as it is
    return;
  }
  if (!newOrderId) { // releasing the roll from its order
    if (oldStatus === 'Sold') throw new AppError(409, 'ROLL_ALREADY_SOLD', 'This roll is already sold against its order and cannot be released.');
    payload.order_id = null; payload.order_number = null; payload.issued_date = null; payload.sold_date = null;
    if (oldStatus === 'Issued' && payload.status === undefined) payload.status = 'In stock';
    if (oldStatus === 'Issued' && payload.status === 'Issued') payload.status = 'In stock';
    return;
  }
  if (oldStatus === 'Damaged' || payload.status === 'Damaged') throw new AppError(400, 'VALIDATION_ERROR', 'A damaged roll cannot be allocated to an order.');
  if (oldStatus === 'Sold') throw new AppError(409, 'ROLL_ALREADY_SOLD', 'This roll is already sold and cannot be moved to another order.');
  const order = await loadOrderForRoll(orgId, industryTypeId, newOrderId);
  await assertRollCanBeAllocated(orgId, industryTypeId, order.id, {
    id: existing?.id as string | undefined,
    roll_number: payload.roll_number ?? existing?.roll_number,
    product_code: payload.product_code ?? existing?.product_code,
  });
  payload.order_id = order.id;
  payload.order_number = order.order_number;
  const next = rollStatusForOrder(order);
  payload.status = next === 'Sold' ? 'Sold' : 'Issued';
  payload.issued_date = today();
  payload.sold_date = next === 'Sold' ? today() : null;
}

// Brings roll statuses in line with their orders. Best effort: a failure here never blocks the list.
async function syncRollsFromOrders(orgId: string, industryTypeId: string | null) {
  try {
    let q = supabaseAdmin.from('textile_fabric_rolls').select('id, status, order_id, product_code')
      .eq('organization_id', orgId).not('order_id', 'is', null).in('status', ['Issued', 'Sold']);
    if (industryTypeId) q = q.eq('industry_type_id', industryTypeId);
    const { data: rolls } = await q;
    const list = (rolls ?? []) as { id: string; status: string; order_id: string; product_code?: string | null }[];
    if (!list.length) return;
    const ids = [...new Set(list.map((r) => r.order_id))];
    const { data: orders } = await supabaseAdmin.from('sale_orders').select('id, order_number, status, dispatch_status, textile_delivery_status')
      .eq('organization_id', orgId).in('id', ids);
    const byId = new Map(((orders ?? []) as OrderRow[]).map((o) => [o.id, o]));
    for (const roll of list) {
      const order = byId.get(roll.order_id);
      if (!order) continue;
      const want = rollStatusForOrder(order);
      if (want === 'Release' && roll.status === 'Issued') {
        await supabaseAdmin.from('textile_fabric_rolls').update({ status: 'In stock', order_id: null, order_number: null, issued_date: null, sold_date: null })
          .eq('organization_id', orgId).eq('id', roll.id);
        await syncProductStockFromRolls(orgId, roll.product_code);
      } else if (want === 'Sold' && roll.status !== 'Sold') {
        await supabaseAdmin.from('textile_fabric_rolls').update({ status: 'Sold', sold_date: today() })
          .eq('organization_id', orgId).eq('id', roll.id);
      }
    }
  } catch { /* keep the list working even if the order sync fails */ }
}

// Marks each variant as 'Linked' (a Textile product with the same code exists, so stock posts to Inventory) or 'Not linked'.
async function withInventoryStatus(orgId: string, rows: Row[]): Promise<Row[]> {
  const skus = [...new Set(rows.map((r) => r.sku).filter((v): v is string => typeof v === 'string' && !!v))];
  const linked = new Set<string>();
  if (skus.length) {
    const { data: products } = await supabaseAdmin.from('products').select('id, product_code').eq('organization_id', orgId).in('product_code', skus);
    const prods = (products ?? []) as { id: string; product_code: string }[];
    if (prods.length) {
      const { data: tags } = await supabaseAdmin.from('product_industry_types').select('product_id, industry_type_id')
        .eq('organization_id', orgId).in('product_id', prods.map((p) => p.id));
      const tagSet = new Set(((tags ?? []) as { product_id: string; industry_type_id: string }[]).map((t) => `${t.product_id}|${t.industry_type_id}`));
      for (const r of rows) {
        const p = prods.find((x) => x.product_code === r.sku);
        if (p && tagSet.has(`${p.id}|${r.industry_type_id}`)) linked.add(String(r.sku));
      }
    }
  }
  return rows.map((r) => ({ ...r, inventory_status: linked.has(String(r.sku)) ? 'Linked' : 'Not linked' }));
}

// Roll stock summary (by status, grade and fabric type) for Reports / Inventory.
textileRouter.get('/textile/fabric-rolls-summary', authenticate, reader, async (req, res) => {
  const industryTypeId = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  await syncRollsFromOrders(org(req), industryTypeId);
  let q = supabaseAdmin.from('textile_fabric_rolls').select('status, quality_grade, fabric_type, length_meters').eq('organization_id', org(req));
  if (industryTypeId) q = q.eq('industry_type_id', industryTypeId);
  const { data, error } = await q;
  if (error) throw error;
  const group = (key: 'status' | 'quality_grade' | 'fabric_type') => {
    const m = new Map<string, { label: string; rolls: number; meters: number }>();
    for (const r of (data ?? []) as Row[]) {
      const label = String(r[key] ?? 'Ungraded');
      const g = m.get(label) ?? { label, rolls: 0, meters: 0 };
      g.rolls += 1; g.meters += Number(r.length_meters) || 0;
      m.set(label, g);
    }
    return [...m.values()].sort((a, b) => b.meters - a.meters);
  };
  const rows = (data ?? []) as Row[];
  res.json({ data: {
    total_rolls: rows.length,
    total_meters: rows.reduce((s, r) => s + (Number(r.length_meters) || 0), 0),
    by_status: group('status'), by_grade: group('quality_grade'), by_fabric_type: group('fabric_type'),
  } });
});

// ---- generic CRUD ------------------------------------------------------------

for (const r of TEXTILE_RESOURCES) {
  const base = `/textile/${r.path}`;
  const notFound = () => new AppError(404, 'RECORD_NOT_FOUND', `${r.path} record was not found.`);
  const isVariants = r.table === 'textile_variants';
  const isRolls = r.table === 'textile_fabric_rolls';
  const readRoles = r.table === 'textile_quality_inspections' ? manager : reader; // reps: read-only, not on Quality

  textileRouter.get(base, authenticate, readRoles, async (req, res) => {
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
    if (isRolls) await syncRollsFromOrders(org(req), industryTypeId);
    let q = supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).order('created_at', { ascending: false });
    if (industryTypeId) q = q.eq('industry_type_id', industryTypeId);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ data: isVariants ? await withInventoryStatus(org(req), (data ?? []) as Row[]) : data });
  });

  textileRouter.get(`${base}/:id`, authenticate, readRoles, async (req, res) => {
    const { data, error } = await supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    assertRecordInScope(req.industryScope!, (data as { industry_type_id?: string | null }).industry_type_id, notFound());
    res.json({ data: isVariants ? (await withInventoryStatus(org(req), [data as Row]))[0] : data });
  });

  textileRouter.post(base, authenticate, manager, async (req, res) => {
    const payload = clean(r, req.body);
    validateValues(r, payload, false);
    const missing = r.requiredFields.filter((k) => payload[k] === undefined || payload[k] === null || payload[k] === '');
    if (missing.length) throw new AppError(400, 'VALIDATION_ERROR', `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required.`);
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, typeof payload.industry_type_id === 'string' ? payload.industry_type_id : undefined);
    if (!industryTypeId) throw new AppError(400, 'VALIDATION_ERROR', 'industry_type_id is required.');
    await assertLinks(r, org(req), industryTypeId, payload);
    if (isRolls) await prepareRollOrderLink(org(req), industryTypeId, payload, null);
    const { data, error } = await supabaseAdmin.from(r.table).insert({ ...payload, industry_type_id: industryTypeId, organization_id: org(req) }).select().single();
    if (error) { if (error.code === '23505') throw dup(r, error); throw error; }
    if (isVariants) {
      try {
        await syncVariantStockToInventory(req, data as Row, Number((data as Row).stock_quantity) || 0);
      } catch (e) {
        await supabaseAdmin.from(r.table).delete().eq('organization_id', org(req)).eq('id', (data as Row).id as string); // nothing half-saved
        throw e;
      }
    }
    await afterSave(r.table, org(req), data as Row);
    res.status(201).json({ data });
  });

  textileRouter.patch(`${base}/:id`, authenticate, manager, async (req, res) => {
    const payload = clean(r, req.body);
    delete payload.industry_type_id; // a record never moves between industries
    validateValues(r, payload, true);
    const { data: existing, error: e1 } = await supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
    if (e1) throw e1;
    if (!existing) throw notFound();
    assertRecordInScope(req.industryScope!, (existing as { industry_type_id?: string | null }).industry_type_id, notFound());
    const existingIndustry = (existing as { industry_type_id?: string | null }).industry_type_id;
    if (existingIndustry) await assertLinks(r, org(req), existingIndustry, payload);
    if (isRolls && existingIndustry) await prepareRollOrderLink(org(req), existingIndustry, payload, existing as Row);
    const { data, error } = await supabaseAdmin.from(r.table).update(payload).eq('organization_id', org(req)).eq('id', idOf(req)).select().maybeSingle();
    if (error) { if (error.code === '23505') throw dup(r, error); throw error; }
    if (!data) throw notFound();
    if (isVariants) {
      const ex = existing as Row; const nw = data as Row;
      const beforeSku = ex.sku as string; const afterSku = nw.sku as string;
      const before = Number(ex.stock_quantity) || 0; const after = Number(nw.stock_quantity) || 0;
      let movedOut = false;
      try {
        if (beforeSku !== afterSku) { // SKU changed: move the stock from the old product to the new one
          await syncVariantStockToInventory(req, { ...nw, sku: beforeSku }, -before);
          movedOut = true;
          await syncVariantStockToInventory(req, nw, after);
        } else if (after !== before) {
          await syncVariantStockToInventory(req, nw, after - before);
        }
      } catch (e) {
        try { if (movedOut) await syncVariantStockToInventory(req, { ...nw, sku: beforeSku }, before); } catch { /* best effort */ }
        await supabaseAdmin.from(r.table).update({ sku: beforeSku, stock_quantity: before }).eq('organization_id', org(req)).eq('id', idOf(req)); // roll back
        throw e;
      }
    }
    await afterSave(r.table, org(req), data as Row);
    if (isRolls && (existing as Row).product_code !== (data as Row).product_code) await syncProductStockFromRolls(org(req), (existing as Row).product_code);
    res.json({ data });
  });

  textileRouter.delete(`${base}/:id`, authenticate, manager, async (req, res) => {
    const { data: existing, error: e1 } = await supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
    if (e1) throw e1;
    if (!existing) throw notFound();
    assertRecordInScope(req.industryScope!, (existing as { industry_type_id?: string | null }).industry_type_id, notFound());
    await assertCanDelete(r.table, org(req), existing as Row);
    if (isVariants) { // take this variant's stock back out of Inventory before it disappears (no-op when not linked)
      const qty = Number((existing as Row).stock_quantity) || 0;
      if (qty) await syncVariantStockToInventory(req, existing as Row, -qty);
    }
    const { data, error } = await supabaseAdmin.from(r.table).delete().eq('organization_id', org(req)).eq('id', idOf(req)).select().maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    if (isRolls) await syncProductStockFromRolls(org(req), (existing as Row).product_code);
    res.json({ data });
  });
}