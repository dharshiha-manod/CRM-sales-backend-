// FMCG payment terms on an order (sale_orders.payment_type): credit | advance | cod.
//  - advance: goods cannot leave until some payment has been collected on the order.
//  - cod:     when the whole order is delivered, the unpaid balance is recorded as a cash collection automatically.
// Credit orders are unaffected (the client credit limit already controls them).
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';
import { logger } from './logger.js';
import type { IndustryScope } from './industry-scope.js';
import { refundedByOrder } from '../repositories/fmcg-refunds.repository.js';
import { createForOrder } from '../repositories/collections.repository.js';

const num = (v: unknown) => Number(v ?? 0) || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;

async function orderMoney(org: string, orderId: string) {
  const [paid, credits, refunded, order] = await Promise.all([
    supabaseAdmin.from('sales_collections').select('amount').eq('organization_id', org).eq('sale_order_id', orderId),
    supabaseAdmin.from('sales_returns').select('credit_amount').eq('organization_id', org).eq('order_id', orderId).eq('status', 'approved'),
    refundedByOrder(org, [orderId]),
    supabaseAdmin.from('sale_orders').select('total_amount').eq('organization_id', org).eq('id', orderId).maybeSingle(),
  ]);
  if (paid.error) throw paid.error;
  if (credits.error) throw credits.error;
  if (order.error) throw order.error;
  const collected = (paid.data ?? []).reduce((s, r) => s + num(r.amount), 0) - (refunded.get(orderId) ?? 0);
  const credited = (credits.data ?? []).reduce((s, r) => s + num(r.credit_amount), 0);
  return { collected, credited, total: num(order.data?.total_amount) };
}

/** Throws when an advance-payment order has no payment yet. Call just before a shipment is dispatched. */
export async function assertAdvanceReceived(org: string, order: { id: string; payment_type?: string | null }) {
  if (order.payment_type !== 'advance') return;
  const { collected } = await orderMoney(org, order.id);
  if (!(collected > 0.005)) throw new AppError(422, 'ADVANCE_NOT_RECEIVED', 'This is an advance-payment order and no payment has been collected yet. Record the advance in Collections, then dispatch.');
}

/** Cash-on-delivery: once the order is fully delivered, record the unpaid balance as a cash collection. Never throws. */
export async function collectCodOnDelivery(org: string, scope: IndustryScope, order: { id: string; payment_type?: string | null }) {
  if (order.payment_type !== 'cod') return;
  try {
    const { collected, credited, total } = await orderMoney(org, order.id);
    const balance = round2(total - credited - collected);
    if (balance <= 0.005) return;
    await createForOrder(org, { orderId: order.id, amount: balance, mode: 'cash', notes: 'Cash on delivery - collected automatically when the order was delivered' }, scope);
  } catch (error) {
    logger.error({ err: error, orderId: order.id }, 'Could not auto-record the cash-on-delivery payment; record it in Collections');
  }
}