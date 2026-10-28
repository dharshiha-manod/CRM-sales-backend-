// Textile: rolls allocated to an order, and returning a delivered roll (credit note + stock back).
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import { industryCodeOf, toBase } from '../lib/fmcg-market.js';
import { syncProductStockFromRolls } from '../lib/textile-rolls.js';

export const textileOrderRollsRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
const reader = requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative');

type Req = Parameters<RequestHandler>[0];
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
const clientOf = (row: { clients?: unknown }) => (Array.isArray(row.clients) ? row.clients[0] : row.clients) as { industry_type_id?: string | null } | null;

async function loadTextileOrder(req: Req, select: string) {
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  const { data, error } = await supabaseAdmin.from('sale_orders').select(`${select}, clients!inner(industry_type_id)`)
    .eq('id', idOf(req)).eq('organization_id', org(req)).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound;
  const order = data as unknown as Record<string, unknown>;
  const industryTypeId = clientOf(order)?.industry_type_id ?? null;
  assertRecordInScope(req.industryScope!, industryTypeId, notFound);
  if ((await industryCodeOf(org(req), industryTypeId)) !== 'textile') throw new AppError(422, 'TEXTILE_ONLY', 'This is available for Textile orders only.');
  return order;
}

// Rolls allocated to this order.
textileOrderRollsRouter.get('/textile/orders/:id/rolls', authenticate, reader, async (req, res) => {
  const order = await loadTextileOrder(req, 'id');
  const { data, error } = await supabaseAdmin.from('textile_fabric_rolls')
    .select('id, roll_number, product_code, fabric_type, colour, length_meters, quality_grade, status')
    .eq('organization_id', org(req)).eq('order_id', order.id as string).order('roll_number');
  if (error) throw error;
  res.json({ data: data ?? [] });
});

const returnSchema = z.object({
  rollId: z.string().uuid(),
  condition: z.enum(['good', 'damaged']),
  reason: z.string().trim().max(500).optional().nullable(),
  creditClient: z.boolean().optional(),
});

// Return a delivered (Sold) roll: the client is credited, a good roll goes back In stock, a damaged one is marked Damaged.
textileOrderRollsRouter.post('/textile/orders/:id/return-roll', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const input = returnSchema.parse(req.body ?? {});
  const order = await loadTextileOrder(req, 'id, status, client_id, currency_code, exchange_rate');
  if (!['confirmed', 'completed'].includes(String(order.status))) throw new AppError(422, 'ORDER_NOT_RETURNABLE', 'Only a confirmed or completed order can have a return.');

  const { data: roll, error: re } = await supabaseAdmin.from('textile_fabric_rolls').select('*')
    .eq('organization_id', orgId).eq('id', input.rollId).maybeSingle();
  if (re) throw re;
  if (!roll || roll.order_id !== order.id) throw new AppError(404, 'ROLL_NOT_FOUND', 'That roll is not on this order.');
  if (roll.status !== 'Sold') throw new AppError(422, 'ROLL_NOT_SOLD', 'Only a dispatched (Sold) roll can be returned.');

  const { data: lines, error: le } = await supabaseAdmin.from('sale_order_items')
    .select('quantity, subtotal, tax_amount, products!inner(id, product_code)').eq('order_id', order.id as string);
  if (le) throw le;
  const mine = ((lines ?? []) as unknown as { quantity: number | null; subtotal: number | null; tax_amount: number | null; products: { id: string; product_code: string } | { id: string; product_code: string }[] }[])
    .map((l) => ({ ...l, p: Array.isArray(l.products) ? l.products[0] : l.products }))
    .filter((l) => l.p?.product_code === roll.product_code);
  if (!mine.length) throw new AppError(422, 'PRODUCT_NOT_ON_ORDER', 'This roll\'s product is not on the order.');
  const productId = mine[0].p.id;
  const paidQty = mine.reduce((s, l) => s + num(l.quantity), 0);
  const paidTotal = mine.reduce((s, l) => s + num(l.subtotal) + num(l.tax_amount), 0);

  const { data: prior } = await supabaseAdmin.from('sales_returns').select('credit_amount')
    .eq('organization_id', orgId).eq('order_id', order.id as string).eq('product_id', productId).in('status', ['pending', 'approved']);
  const alreadyCredited = ((prior ?? []) as { credit_amount: number | null }[]).reduce((s, r) => s + num(r.credit_amount), 0);

  const metres = num(roll.length_meters);
  const creditClient = input.condition === 'damaged' ? input.creditClient !== false : true;
  const credit = creditClient && paidQty > 0 ? round2(Math.max(0, Math.min((paidTotal / paidQty) * metres, paidTotal - alreadyCredited))) : 0;
  const rate = num(order.exchange_rate) || 1;

  const { data: ret, error: ie } = await supabaseAdmin.from('sales_returns').insert({
    organization_id: orgId, order_id: order.id, client_id: order.client_id, product_id: productId, quantity: metres,
    kind: input.condition === 'damaged' ? 'damage' : 'return',
    reason: [`Roll ${String(roll.roll_number)}`, input.reason?.trim()].filter(Boolean).join(' - '),
    restock: input.condition === 'good', credit_client: creditClient, status: 'approved',
    currency_code: String(order.currency_code ?? 'INR'), exchange_rate: rate, credit_amount: credit, base_credit: toBase(credit, rate),
    created_by: req.auth!.sub as string, decided_by: req.auth!.sub as string, decided_at: new Date().toISOString(),
  }).select('id').single();
  if (ie) throw ie;

  const { data: moved, error: ue } = await supabaseAdmin.from('textile_fabric_rolls')
    .update({ status: input.condition === 'good' ? 'In stock' : 'Damaged', order_id: null, order_number: null, issued_date: null, sold_date: null })
    .eq('organization_id', orgId).eq('id', input.rollId).eq('status', 'Sold').select('id');
  if (ue || !moved || moved.length === 0) {
    await supabaseAdmin.from('sales_returns').delete().eq('id', (ret as { id: string }).id); // nothing half-saved
    if (ue) throw ue;
    throw new AppError(409, 'ROLL_CHANGED', 'This roll was just changed by someone else. Refresh and try again.');
  }
  await syncProductStockFromRolls(orgId, roll.product_code);

  const { data: all } = await supabaseAdmin.from('sales_returns').select('credit_amount')
    .eq('organization_id', orgId).eq('order_id', order.id as string).eq('status', 'approved');
  res.status(201).json({ data: { credit, returns_credit: round2(((all ?? []) as { credit_amount: number | null }[]).reduce((s, r) => s + num(r.credit_amount), 0)) } });
});