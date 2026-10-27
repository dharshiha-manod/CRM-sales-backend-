// FMCG: an order becomes "completed" on its own once every unit is delivered AND it is fully settled
// (payments + approved return credits >= order total). Only FMCG orders ever reach dispatch_status 'delivered',
// so other industries are never touched. Never throws: it is a follow-up, it must not block the action that called it.
import { supabaseAdmin } from './supabase.js';
import { logger } from './logger.js';
import { industryCodeOf, isFmcgIndustry } from './fmcg-market.js';
import { fmcgInvoicedByOrder } from './fmcg-paperwork.js';
import { refundedByOrder } from '../repositories/fmcg-refunds.repository.js';

const num = (v: unknown) => Number(v ?? 0) || 0;

export async function completeOrderIfSettled(org: string, orderId: string): Promise<boolean> {
  try {
    const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, status, dispatch_status, total_amount, clients!inner(industry_type_id)').eq('id', orderId).eq('organization_id', org).maybeSingle();
    if (error) throw error;
    if (!order || order.status !== 'confirmed' || order.dispatch_status !== 'delivered') return false;
    const orderIndustryId = (order.clients as unknown as { industry_type_id?: string | null } | null)?.industry_type_id ?? null;
    const isFmcg = await isFmcgIndustry(org, orderIndustryId);
    const isSchool = !isFmcg && (await industryCodeOf(org, orderIndustryId)) === 'school';
    if (!isFmcg && !isSchool) return false; // FMCG + School only
    const [paid, credits] = await Promise.all([
      supabaseAdmin.from('sales_collections').select('amount').eq('organization_id', org).eq('sale_order_id', orderId),
      supabaseAdmin.from('sales_returns').select('credit_amount').eq('organization_id', org).eq('order_id', orderId).eq('status', 'approved'),
    ]);
    if (paid.error) throw paid.error;
    if (credits.error) throw credits.error;
    const refunded = (await refundedByOrder(org, [orderId])).get(orderId) ?? 0; // money paid back to the client no longer counts as settled
    const settled = (paid.data ?? []).reduce((s, r) => s + num(r.amount), 0) - refunded + (credits.data ?? []).reduce((s, r) => s + num(r.credit_amount), 0);
    // The customer may have been invoiced more than the goods (freight / extra charges): the payable amount is the larger of the two.
    const invoiced = (await fmcgInvoicedByOrder(org, [orderId])).get(orderId) ?? 0;
    // School customers pay round rupee amounts: a shortfall under Rs 1 (paise from tax) is round-off, not a real due. FMCG keeps the exact rule.
    const tolerance = isSchool ? 0.99 : 0.005;
    if (settled + tolerance < Math.max(num(order.total_amount), invoiced)) return false;
    const { error: updateError } = await supabaseAdmin.from('sale_orders').update({ status: 'completed' }).eq('id', orderId).eq('organization_id', org).eq('status', 'confirmed');
    if (updateError) throw updateError;
    return true;
  } catch (error) {
    logger.error({ err: error, orderId }, 'Could not check whether the FMCG order is complete');
    return false;
  }
}