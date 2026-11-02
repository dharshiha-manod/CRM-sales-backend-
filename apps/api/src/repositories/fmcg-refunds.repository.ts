// FMCG refunds: when an approved return credit (or an overpayment) leaves a client having paid MORE than the order is worth,
// the extra is money we owe back. A refund records that payout, so the order and the client's outstanding stay correct.
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope, type IndustryScope } from '../lib/industry-scope.js';
import { industryCodeOf, isFmcgIndustry, toBase } from '../lib/fmcg-market.js';

const fail = (error: unknown): never => { throw error; };
const num = (v: unknown) => Number(v ?? 0) || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;

export const refundSchema = z.object({
  orderId: z.string().uuid(),
  amount: z.number().finite().positive().max(1e9),
  mode: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'other']),
  referenceNo: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});
export type RefundInput = z.infer<typeof refundSchema>;

/** order id -> total refunded (in the order's currency). Missing table (migration not run yet) = nothing refunded. */
export async function refundedByOrder(org: string, orderIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('sales_refunds').select('order_id, amount').eq('organization_id', org).in('order_id', orderIds.slice(i, i + 100));
    if (error) { if (/sales_refunds/.test(error.message)) return result; fail(error); }
    for (const row of data ?? []) result.set(row.order_id as string, round2((result.get(row.order_id as string) ?? 0) + num(row.amount)));
  }
  return result;
}

export async function listRefunds(org: string, industryTypeId: string) {
  const { data, error } = await supabaseAdmin.from('sales_refunds')
    .select('*, sale_orders(order_number, currency_code), clients!inner(client_code, client_name, industry_type_id)')
    .eq('organization_id', org).eq('clients.industry_type_id', industryTypeId).order('created_at', { ascending: false }).limit(500);
  if (error) fail(error);
  return data ?? [];
}

export async function createRefund(org: string, userId: string, scope: IndustryScope, input: RefundInput) {
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, status, client_id, total_amount, currency_code, exchange_rate, clients!inner(industry_type_id)').eq('id', input.orderId).eq('organization_id', org).maybeSingle();
  if (error) fail(error);
  if (!order || !order.client_id) throw notFound;
  const industryTypeId = (order.clients as unknown as { industry_type_id?: string | null } | null)?.industry_type_id ?? null;
  assertRecordInScope(scope, industryTypeId, notFound);
  // FMCG, School and Pharma (same refund rules: money owed back after an approved return credit)
  if (!(await isFmcgIndustry(org, industryTypeId)) && !['school', 'pharma'].includes((await industryCodeOf(org, industryTypeId)) ?? '')) throw new AppError(422, 'NOT_FMCG', 'Refunds are only available in the FMCG, School and Pharma industries.');
  if (order.status === 'cancelled') throw new AppError(422, 'ORDER_CANCELLED', 'A cancelled order cannot be refunded here.');

  const [paid, credits, refunds] = await Promise.all([
    supabaseAdmin.from('sales_collections').select('amount').eq('organization_id', org).eq('sale_order_id', order.id),
    supabaseAdmin.from('sales_returns').select('credit_amount').eq('organization_id', org).eq('order_id', order.id).eq('status', 'approved'),
    supabaseAdmin.from('sales_refunds').select('amount, mode, reference_no, created_at').eq('organization_id', org).eq('order_id', order.id),
  ]);
  if (paid.error) fail(paid.error);
  if (credits.error) fail(credits.error);
  if (refunds.error) fail(refunds.error);
  const collected = (paid.data ?? []).reduce((s, r) => s + num(r.amount), 0);
  const credited = (credits.data ?? []).reduce((s, r) => s + num(r.credit_amount), 0);
  const refunded = (refunds.data ?? []).reduce((s, r) => s + num(r.amount), 0);
  const due = round2(collected - refunded + credited - num(order.total_amount)); // what the client overpaid and has not got back yet
  if (due <= 0.005) throw new AppError(422, 'NOTHING_TO_REFUND', 'This client has not paid more than the order is worth, so there is nothing to refund.');
  if (input.amount > due + 0.005) throw new AppError(422, 'REFUND_EXCEEDS_DUE', `Only ${due.toFixed(2)} can be refunded on this order.`);

  const reference = (input.referenceNo ?? '').trim();
  const recent = Date.now() - 120000;
  const duplicate = (refunds.data ?? []).some((r) => (reference && String(r.reference_no ?? '').trim() === reference)
    || (num(r.amount) === input.amount && r.mode === input.mode && new Date(String(r.created_at)).getTime() > recent));
  if (duplicate) throw new AppError(409, 'DUPLICATE_REFUND', 'This refund was already recorded (same amount or reference). Check the refund list before saving again.');

  const rate = Number(order.exchange_rate ?? 1) || 1;
  const { data, error: insertError } = await supabaseAdmin.from('sales_refunds').insert({
    organization_id: org, order_id: order.id, client_id: order.client_id, amount: input.amount, mode: input.mode, reference_no: reference || null, notes: input.notes || null,
    currency_code: String(order.currency_code ?? 'INR'), exchange_rate: rate, base_amount: toBase(input.amount, rate), created_by: userId,
  }).select().single();
  if (insertError) fail(insertError);
  return data;
}