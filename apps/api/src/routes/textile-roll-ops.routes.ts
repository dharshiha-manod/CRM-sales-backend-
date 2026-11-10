// Textile roll operations: ledger, damaged length, stock correction, and cutting metres off a roll for an order.
// Every metre change goes through lib/textile-roll-ledger.ts (atomic, never negative, always logged).
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import { industryCodeOf } from '../lib/fmcg-market.js';
import { syncProductStockFromRolls } from '../lib/textile-rolls.js';
import { cutMetresForOrder, cutRelease, cutReserve, moveRoll } from '../lib/textile-roll-ledger.js';

export const textileRollOpsRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
const reader = requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative');

type Req = Parameters<RequestHandler>[0];
type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;
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
const userId = (req: Req) => (req.auth?.sub as string | undefined) ?? null;
const clientOf = (row: { clients?: unknown }) => (Array.isArray(row.clients) ? row.clients[0] : row.clients) as { industry_type_id?: string | null } | null;

async function loadRoll(req: Req): Promise<Row> {
  const notFound = new AppError(404, 'ROLL_NOT_FOUND', 'Fabric roll not found.');
  const { data, error } = await supabaseAdmin.from('textile_fabric_rolls').select('*')
    .eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound;
  assertRecordInScope(req.industryScope!, (data as { industry_type_id?: string | null }).industry_type_id, notFound);
  return data as Row;
}

async function loadTextileOrder(req: Req, select: string): Promise<Row> {
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  const { data, error } = await supabaseAdmin.from('sale_orders').select(`${select}, clients!inner(industry_type_id)`)
    .eq('id', idOf(req)).eq('organization_id', org(req)).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound;
  const order = data as unknown as Row;
  const industryTypeId = clientOf(order)?.industry_type_id ?? null;
  assertRecordInScope(req.industryScope!, industryTypeId, notFound);
  if ((await industryCodeOf(org(req), industryTypeId)) !== 'textile') throw new AppError(422, 'TEXTILE_ONLY', 'This is available for Textile orders only.');
  return order;
}

// ---- Ledger of one roll -------------------------------------------------------------------
textileRollOpsRouter.get('/textile/fabric-rolls/:id/transactions', authenticate, reader, async (req, res) => {
  const roll = await loadRoll(req);
  const [{ data: txns, error: te }, { data: cuts, error: ce }] = await Promise.all([
    supabaseAdmin.from('textile_roll_transactions').select('*').eq('organization_id', org(req)).eq('roll_id', roll.id as string)
      .order('created_at', { ascending: false }).limit(500),
    supabaseAdmin.from('textile_roll_allocations').select('id, order_id, order_number, metres, status, created_at')
      .eq('organization_id', org(req)).eq('roll_id', roll.id as string).order('created_at', { ascending: false }),
  ]);
  if (te) throw te;
  if (ce) throw ce;
  res.json({ data: { roll, transactions: txns ?? [], cuts: cuts ?? [] } });
});

// ---- Damaged / defective length --------------------------------------------------------------
const metresSchema = z.object({
  metres: z.coerce.number().positive().max(100000),
  reason: z.string().trim().max(500).optional().nullable(),
});

textileRollOpsRouter.post('/textile/fabric-rolls/:id/damage', authenticate, manager, async (req, res) => {
  const input = metresSchema.parse(req.body ?? {});
  const roll = await loadRoll(req);
  if (roll.status !== 'In stock') throw new AppError(409, 'ROLL_NOT_AVAILABLE', `Only an In stock roll can have damaged length recorded (this roll is ${String(roll.status)}).`);
  const metres = round2(input.metres);
  const result = await moveRoll(org(req), userId(req), roll.id as string, {
    type: 'damage', quantity: metres, delta: -metres, damaged: metres, note: input.reason?.trim() || 'Damaged length',
  });
  await syncProductStockFromRolls(org(req), roll.product_code);
  res.status(201).json({ data: result });
});

// ---- Stock correction (physical re-measure, found / lost metres) -----------------------------------
const adjustSchema = z.object({
  metres: z.coerce.number().refine((n) => n !== 0, 'metres cannot be zero').refine((n) => Math.abs(n) <= 100000, 'metres is too large'),
  reason: z.string().trim().min(3, 'A reason is required for a stock correction').max(500),
});

textileRollOpsRouter.post('/textile/fabric-rolls/:id/adjust', authenticate, manager, async (req, res) => {
  const input = adjustSchema.parse(req.body ?? {});
  const roll = await loadRoll(req);
  if (!['In stock', 'Quarantine', 'Damaged'].includes(String(roll.status))) {
    throw new AppError(409, 'ROLL_NOT_AVAILABLE', `A ${String(roll.status)} roll cannot be corrected here.`);
  }
  const delta = round2(input.metres);
  const result = await moveRoll(org(req), userId(req), roll.id as string, {
    type: 'adjustment', quantity: Math.abs(delta), delta, note: input.reason,
  });
  await syncProductStockFromRolls(org(req), roll.product_code);
  res.status(201).json({ data: result });
});

// ---- Cutting metres off a roll for an order ----------------------------------------------------------
type Line = { quantity: number | null; free_quantity: number | null; colour?: string | null; products: { product_code?: string; product_name?: string } | { product_code?: string; product_name?: string }[] | null };
const prodOf = (l: Line) => (Array.isArray(l.products) ? l.products[0] : l.products) ?? {};

function orderIsOpenForCuts(o: Row) {
  if (o.status === 'cancelled' || o.status === 'completed') return false;
  if (['dispatched', 'delivered'].includes(String(o.dispatch_status ?? ''))) return false;
  if (['dispatched', 'out_for_delivery', 'delivered'].includes(String(o.textile_delivery_status ?? ''))) return false;
  return true;
}

// What the order still needs, and which rolls can be cut for it.
textileRollOpsRouter.get('/textile/orders/:id/cut-options', authenticate, reader, async (req, res) => {
  const orgId = org(req);
  const order = await loadTextileOrder(req, 'id, status, dispatch_status, textile_delivery_status, organization_id');
  const { data: items, error } = await supabaseAdmin.from('sale_order_items')
    .select('quantity, free_quantity, colour, products(product_code, product_name)').eq('order_id', order.id as string);
  if (error) throw error;

  const need = new Map<string, { product_code: string; product_name: string; ordered: number; colours: string[] }>();
  for (const l of (items ?? []) as unknown as Line[]) {
    const p = prodOf(l);
    if (!p.product_code) continue;
    const cur = need.get(p.product_code) ?? { product_code: p.product_code, product_name: p.product_name ?? p.product_code, ordered: 0, colours: [] };
    cur.ordered += num(l.quantity) + num(l.free_quantity);
    if (l.colour && !cur.colours.includes(l.colour)) cur.colours.push(l.colour);
    need.set(p.product_code, cur);
  }

  const lines: Row[] = [];
  for (const n of need.values()) {
    const { data: whole } = await supabaseAdmin.from('textile_fabric_rolls').select('length_meters')
      .eq('organization_id', orgId).eq('order_id', order.id as string).eq('product_code', n.product_code).in('status', ['Issued', 'Sold']);
    const wholeM = ((whole ?? []) as { length_meters: number | null }[]).reduce((s, r) => s + num(r.length_meters), 0);
    const cutM = await cutMetresForOrder(orgId, order.id as string, n.product_code);
    lines.push({ ...n, covered: round2(wholeM + cutM), remaining: round2(Math.max(0, n.ordered - wholeM - cutM)) });
  }

  let rolls: Row[] = [];
  if (orderIsOpenForCuts(order) && need.size) {
    const { data: candidates, error: re } = await supabaseAdmin.from('textile_fabric_rolls')
      .select('id, roll_number, product_code, fabric_type, colour, lot_number, length_meters, quality_grade, warehouse_location')
      .eq('organization_id', orgId).eq('status', 'In stock').gt('length_meters', 0).in('product_code', [...need.keys()])
      .order('lot_number', { ascending: true }).order('roll_number', { ascending: true });
    if (re) throw re;
    const list = (candidates ?? []) as Row[];
    // Only rolls whose LATEST inspection is Pass can be cut.
    const { data: insp } = list.length
      ? await supabaseAdmin.from('textile_quality_inspections').select('roll_number, status, inspection_date, created_at')
          .eq('organization_id', orgId).in('roll_number', list.map((r) => r.roll_number as string))
          .order('inspection_date', { ascending: false }).order('created_at', { ascending: false })
      : { data: [] as Row[] };
    const latest = new Map<string, string>();
    for (const i of (insp ?? []) as { roll_number: string; status: string }[]) if (!latest.has(i.roll_number)) latest.set(i.roll_number, i.status);
    rolls = list.filter((r) => latest.get(r.roll_number as string) === 'Pass');
  }
  res.json({ data: { open: orderIsOpenForCuts(order), lines, rolls } });
});

const cutSchema = z.object({ rollId: z.string().uuid(), metres: z.coerce.number().positive().max(100000) });

textileRollOpsRouter.post('/textile/orders/:id/cut-roll', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const input = cutSchema.parse(req.body ?? {});
  const metres = round2(input.metres);
  const order = await loadTextileOrder(req, 'id, order_number, status, client_id, dispatch_status, textile_delivery_status');
  if (!orderIsOpenForCuts(order)) throw new AppError(409, 'ORDER_NOT_OPEN', 'This order is cancelled, completed or already dispatched, so no more fabric can be cut for it.');

  const { data: roll, error: re } = await supabaseAdmin.from('textile_fabric_rolls').select('*')
    .eq('organization_id', orgId).eq('id', input.rollId).maybeSingle();
  if (re) throw re;
  const notFound = new AppError(404, 'ROLL_NOT_FOUND', 'Fabric roll not found.');
  if (!roll) throw notFound;
  assertRecordInScope(req.industryScope!, (roll as { industry_type_id?: string | null }).industry_type_id, notFound);
  const r = roll as Row;
  const productCode = typeof r.product_code === 'string' ? r.product_code : '';
  if (!productCode) throw new AppError(400, 'VALIDATION_ERROR', 'Set the product code on this roll before cutting it for an order.');
  if (r.status !== 'In stock') throw new AppError(409, 'ROLL_NOT_AVAILABLE', `Roll ${String(r.roll_number)} is ${String(r.status)} and cannot be cut.`);
  if (metres > num(r.length_meters) + 1e-9) {
    throw new AppError(422, 'INSUFFICIENT_LENGTH', `Roll ${String(r.roll_number)} has only ${num(r.length_meters)} m available (you asked for ${metres} m).`);
  }

  // Inspection gate: latest inspection must be Pass (same rule as whole-roll allocation).
  const { data: insp, error: ie } = await supabaseAdmin.from('textile_quality_inspections').select('status')
    .eq('organization_id', orgId).eq('roll_number', r.roll_number as string)
    .order('inspection_date', { ascending: false }).order('created_at', { ascending: false }).limit(1);
  if (ie) throw ie;
  const latest = (insp as { status: string }[] | null)?.[0];
  if (!latest) throw new AppError(400, 'INSPECTION_REQUIRED', `Roll ${String(r.roll_number)} has no quality inspection. Inspect it (Pass) before cutting it for an order.`);
  if (latest.status !== 'Pass') throw new AppError(400, 'INSPECTION_REQUIRED', `Roll ${String(r.roll_number)} did not pass its latest quality inspection.`);

  // The order must have a line for this product, and may not be over-covered.
  const { data: items, error: le } = await supabaseAdmin.from('sale_order_items')
    .select('quantity, free_quantity, products(product_code)').eq('order_id', order.id as string);
  if (le) throw le;
  let ordered = 0; let matched = false;
  for (const l of (items ?? []) as unknown as Line[]) {
    if (prodOf(l).product_code === productCode) { matched = true; ordered += num(l.quantity) + num(l.free_quantity); }
  }
  if (!matched) throw new AppError(400, 'VALIDATION_ERROR', `This order has no line for product ${productCode}. The roll must be the same product as the order.`);
  const { data: whole } = await supabaseAdmin.from('textile_fabric_rolls').select('length_meters')
    .eq('organization_id', orgId).eq('order_id', order.id as string).eq('product_code', productCode).in('status', ['Issued', 'Sold']);
  const covered = ((whole ?? []) as { length_meters: number | null }[]).reduce((s, x) => s + num(x.length_meters), 0)
    + (await cutMetresForOrder(orgId, order.id as string, productCode));
  const remaining = round2(ordered - covered);
  if (remaining <= 0) throw new AppError(409, 'ORDER_FULLY_ALLOCATED', `This order is already fully covered (${round2(covered)} m of ${round2(ordered)} m).`);
  if (metres > remaining + 1e-9) throw new AppError(422, 'OVER_ALLOCATION', `This order needs only ${remaining} m more of ${productCode}. Cut ${remaining} m or less.`);

  const result = await cutReserve(orgId, userId(req), {
    rollId: input.rollId, orderId: order.id as string, orderNumber: String(order.order_number ?? ''),
    clientId: (order.client_id as string | null) ?? null, productCode, metres,
  });
  await syncProductStockFromRolls(orgId, productCode);
  res.status(201).json({ data: { ...result, remaining_after: round2(remaining - metres) } });
});

// Cuts of one order.
textileRollOpsRouter.get('/textile/orders/:id/cuts', authenticate, reader, async (req, res) => {
  const order = await loadTextileOrder(req, 'id');
  const { data, error } = await supabaseAdmin.from('textile_roll_allocations')
    .select('id, roll_id, roll_number, product_code, metres, status, created_at, sold_at')
    .eq('organization_id', org(req)).eq('order_id', order.id as string).neq('status', 'Released').order('created_at', { ascending: true });
  if (error) throw error;
  res.json({ data: data ?? [] });
});

// Remove a still-Reserved cut: the metres go back on the roll.
textileRollOpsRouter.delete('/textile/cuts/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const notFound = new AppError(404, 'CUT_NOT_FOUND', 'Cut not found.');
  const { data: cut, error } = await supabaseAdmin.from('textile_roll_allocations').select('*')
    .eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (error) throw error;
  if (!cut) throw notFound;
  assertRecordInScope(req.industryScope!, (cut as { industry_type_id?: string | null }).industry_type_id, notFound);
  const c = cut as Row;
  if (c.status === 'Sold') throw new AppError(409, 'CUT_ALREADY_SOLD', 'This fabric was already dispatched. Record a return instead.');
  if (c.status === 'Released') throw new AppError(409, 'CUT_ALREADY_RELEASED', 'This cut was already released.');
  await cutRelease(orgId, userId(req), c.id as string, 'Cut removed from order');
  await syncProductStockFromRolls(orgId, c.product_code);
  res.json({ data: { id: c.id, status: 'Released' } });
});