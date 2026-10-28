// Textile order delivery: Dispatched -> Out for delivery -> Delivered (with the receiver's name as proof of delivery).
// Textile only: the handler checks the order belongs to the Textile industry. Other industries never use this route.
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import { industryCodeOf } from '../lib/fmcg-market.js';
import { assertRollsCoverOrder, markRollsSoldForOrder } from '../lib/textile-rolls.js';

export const textileDeliveryRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');

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
const clientOf = (row: { clients?: unknown }) => (Array.isArray(row.clients) ? row.clients[0] : row.clients) as { industry_type_id?: string | null } | null;

const deliverySchema = z.object({
  status: z.enum(['dispatched', 'out_for_delivery', 'delivered']),
  receivedBy: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});
const NEXT: Record<string, string[]> = { none: ['dispatched'], dispatched: ['out_for_delivery', 'delivered'], out_for_delivery: ['delivered'], delivered: [] };

textileDeliveryRouter.patch('/textile/orders/:id/delivery', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const input = deliverySchema.parse(req.body ?? {});
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  const { data: order, error } = await supabaseAdmin.from('sale_orders')
    .select('id, status, textile_delivery_status, textile_dispatched_at, clients!inner(industry_type_id)')
    .eq('id', idOf(req)).eq('organization_id', orgId).maybeSingle();
  if (error) throw error;
  if (!order) throw notFound;
  const industryTypeId = clientOf(order)?.industry_type_id ?? null;
  assertRecordInScope(req.industryScope!, industryTypeId, notFound);
  if ((await industryCodeOf(orgId, industryTypeId)) !== 'textile') throw new AppError(422, 'DELIVERY_TEXTILE_ONLY', 'Delivery tracking is available for Textile orders only.');
  if (order.status !== 'confirmed') throw new AppError(422, 'ORDER_NOT_CONFIRMED', 'Only a confirmed order can be dispatched or delivered.');

  const current = (order.textile_delivery_status as string | null) ?? null;
  const target = input.status;
  if (current === target) return res.json({ data: order });
  if (!(NEXT[current ?? 'none'] ?? []).includes(target)) {
    throw new AppError(422, 'INVALID_DELIVERY_STEP', current === 'delivered' ? 'A delivered order cannot be changed. Record a sales return instead.' : `An order cannot go from ${current ?? 'confirmed'} to ${target}.`);
  }
  const receivedBy = input.receivedBy?.trim();
  if (target === 'delivered' && !receivedBy) throw new AppError(422, 'RECEIVER_REQUIRED', 'Enter the name of the person at the client who received the fabric.');
  if (target === 'dispatched') await assertRollsCoverOrder(orgId, order.id as string);
  const note = input.note?.trim() || null;
  const nowIso = new Date().toISOString();

  const patch: Row = { textile_delivery_status: target };
  if (note) patch.textile_delivery_note = note;
  if (target === 'dispatched') patch.textile_dispatched_at = nowIso;
  if (target === 'delivered') {
    if (!order.textile_dispatched_at) patch.textile_dispatched_at = nowIso;
    patch.textile_delivered_at = nowIso;
    patch.textile_received_by = receivedBy;
  }
  // Claim the step: only one request can move the order out of its current step (double click / two users).
  const base = supabaseAdmin.from('sale_orders').update(patch).eq('id', order.id as string).eq('organization_id', orgId);
  const { data: saved, error: saveError } = await (current === null ? base.is('textile_delivery_status', null) : base.eq('textile_delivery_status', current)).select();
  if (saveError) throw saveError;
  if (!saved || saved.length === 0) throw new AppError(409, 'DELIVERY_CHANGED', 'This order was just updated by someone else. Refresh and try again.');
  await markRollsSoldForOrder(orgId, order.id as string);
  res.json({ data: saved[0] });
});