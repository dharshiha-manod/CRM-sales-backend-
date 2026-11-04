// Pharma order delivery: Pending -> Packed -> Dispatched -> Delivered (saved in the database, not the browser).
// Pharma only: the handler checks the order belongs to the Pharma industry. Other industries never use this route.
// Stock is NOT moved here: Pharma takes the batch stock when the order is confirmed (stock_deducted), so dispatch only records the movement.
// Once an order is Dispatched / Delivered the existing rules apply by themselves: GST invoice allowed, order locked (edit / cancel blocked),
// "invoice when dispatched" automation can fire, and recall re-pick leaves the order alone.
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import { industryCodeOf } from '../lib/fmcg-market.js';

export const pharmaDeliveryRouter = Router();
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
  status: z.enum(['pending', 'packed', 'dispatched', 'delivered']),
  vehicleNo: z.string().trim().max(60).nullable().optional(), // vehicle number or LR / transporter receipt number
  receivedBy: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
// Forward one step at a time; a mistake can be undone one step back until the goods are delivered (then it is a sales return).
const NEXT: Record<string, string[]> = { pending: ['packed'], packed: ['dispatched', 'pending'], dispatched: ['delivered', 'packed'], delivered: [] };

pharmaDeliveryRouter.patch('/pharma/orders/:id/delivery', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const input = deliverySchema.parse(req.body ?? {});
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  const { data: order, error } = await supabaseAdmin.from('sale_orders')
    .select('id, status, dispatch_status, pharma_packed_at, pharma_dispatched_at, pharma_vehicle_no, clients!inner(industry_type_id)')
    .eq('id', idOf(req)).eq('organization_id', orgId).maybeSingle();
  if (error) throw error;
  if (!order) throw notFound;
  const industryTypeId = clientOf(order)?.industry_type_id ?? null;
  assertRecordInScope(req.industryScope!, industryTypeId, notFound);
  if ((await industryCodeOf(orgId, industryTypeId)) !== 'pharma') throw new AppError(422, 'DELIVERY_PHARMA_ONLY', 'This delivery tracking is for Pharma orders only.');
  if (order.status !== 'confirmed') throw new AppError(422, 'ORDER_NOT_CONFIRMED', 'Only a confirmed order can be packed, dispatched or delivered.');

  const current = String(order.dispatch_status ?? 'pending');
  const target = input.status;
  if (current === target) return res.json({ data: order });
  if (!(NEXT[current] ?? []).includes(target)) {
    throw new AppError(422, 'INVALID_DELIVERY_STEP', current === 'delivered' ? 'A delivered order cannot be changed. Record a sales return instead.' : `An order cannot go from ${current} to ${target}.`);
  }
  const note = input.note?.trim() || null;
  const vehicleNo = input.vehicleNo?.trim() || null;
  const receivedBy = input.receivedBy?.trim() || null;
  if (target === 'dispatched' && !vehicleNo && !order.pharma_vehicle_no) throw new AppError(422, 'VEHICLE_REQUIRED', 'Enter the vehicle number or LR number the goods are leaving with.');
  if (target === 'delivered' && !receivedBy) throw new AppError(422, 'RECEIVER_REQUIRED', 'Enter the name of the person at the customer who received the goods.');
  const nowIso = new Date().toISOString();

  const patch: Row = { dispatch_status: target };
  if (target === 'packed') { patch.pharma_packed_at = nowIso; if (current === 'dispatched') { patch.pharma_dispatched_at = null; patch.pharma_vehicle_no = null; } } // undo dispatch
  if (target === 'pending') { patch.pharma_packed_at = null; }
  if (target === 'dispatched') { patch.pharma_dispatched_at = nowIso; if (vehicleNo) patch.pharma_vehicle_no = vehicleNo; if (!order.pharma_packed_at) patch.pharma_packed_at = nowIso; }
  if (target === 'delivered') { patch.pharma_delivered_at = nowIso; patch.pharma_received_by = receivedBy; }
  if (note !== null || target === 'pending') patch.pharma_delivery_note = note;

  // Claim the step: only one request can move the order out of its current step (double click / two users).
  const { data: saved, error: saveError } = await supabaseAdmin.from('sale_orders').update(patch)
    .eq('id', order.id as string).eq('organization_id', orgId).eq('dispatch_status', current).select();
  if (saveError) throw saveError;
  if (!saved || saved.length === 0) throw new AppError(409, 'DELIVERY_CHANGED', 'This order was just updated by someone else. Refresh and try again.');
  res.json({ data: saved[0] });
});
