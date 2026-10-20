import { approvedReturnCredits } from './orders.repository.js';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { getCollectionConfig, industryTypeIdOfClient } from '../lib/settings.js';
import { completeOrderIfSettled } from '../lib/order-completion.js';
import { refundedByOrder } from './fmcg-refunds.repository.js';
import { billedTotalsForCoreOrders,syncInvoicePaymentsForSaleOrder } from './trading.repository.js';

// Maps your app's internal mode codes to the labels shown in Settings →
// Collection Configuration → Payment Methods, so we can check the right toggle.
const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  other: 'Other',
};

async function assertPaymentAllowed(organizationId: string, mode: string, referenceNo: string | null | undefined, industryTypeId?: string | null) {
  const config = await getCollectionConfig(organizationId, industryTypeId);
  const label = PAYMENT_MODE_LABELS[mode] ?? mode;
  if (config.paymentMethods[label] === false) {
    throw new AppError(422, 'PAYMENT_METHOD_DISABLED', `${label} is not an enabled payment method. An Admin can enable it in Settings → Collection Configuration.`);
  }
   const MODES_WITH_REFERENCE = ['upi', 'bank_transfer', 'cheque'];
  if (config.receiptRequired && MODES_WITH_REFERENCE.includes(mode) && !referenceNo?.trim()) {
    throw new AppError(422, 'RECEIPT_NUMBER_REQUIRED', `A reference number is required for ${label} payments. This can be turned off in Settings → Collection Configuration.`);
  }
}

export async function createFromVisit(organizationId: string, representativeId: string, visitId: string, input: { amount: number; mode: string; referenceNo?: string | null; saleOrderId?: string | null; notes?: string | null }) {
  const { data: visit, error: visitError } = await supabaseAdmin.from('field_visits').select('id, client_id').eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).in('status', ['checked_in', 'in_progress']).maybeSingle();
  if (visitError) throw visitError;
  if (!visit?.client_id) throw new AppError(422, 'COLLECTION_REQUIRES_CLIENT', 'A collection requires a visit linked to a client.');
  await assertPaymentAllowed(organizationId, input.mode, input.referenceNo, await industryTypeIdOfClient(organizationId, visit.client_id));
  if (input.saleOrderId) {
    const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, total_amount, exchange_rate').eq('id', input.saleOrderId).eq('organization_id', organizationId).eq('visit_id', visit.id).eq('client_id', visit.client_id).eq('representative_id', representativeId).maybeSingle();
    if (error) throw error;
    if (!order) throw new AppError(422, 'INVALID_COLLECTION_ORDER', 'The selected order does not belong to this active visit, client, and representative.');
    const { data: priorCollections, error: collectionError } = await supabaseAdmin.from('sales_collections').select('amount').eq('organization_id', organizationId).eq('sale_order_id', order.id);
    if (collectionError) throw collectionError;
    const alreadyCollected = (priorCollections ?? []).reduce((sum, collection) => sum + Number(collection.amount), 0) - ((await refundedByOrder(organizationId, [order.id as string])).get(order.id as string) ?? 0); // refunded money is no longer collected
    const visitCredit = (await approvedReturnCredits(organizationId, [order.id as string])).get(order.id as string)?.credit ?? 0;
    // A Trading order can be billed for more than it was quoted (extra shipment charges): the payable amount is the larger of the two.
    const visitRate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : 1;
    const visitPayable = Math.max(Number(order.total_amount), ((await billedTotalsForCoreOrders(organizationId, [order.id as string])).get(order.id as string) ?? 0) / visitRate);
    if (alreadyCollected + input.amount > visitPayable - visitCredit + 0.00001) {
      throw new AppError(422, 'COLLECTION_EXCEEDS_ORDER_TOTAL', `Collection exceeds the remaining order balance of ${Math.max(0, visitPayable - visitCredit - alreadyCollected).toFixed(2)}.`);
    }
  }
  const { data, error } = await supabaseAdmin.from('sales_collections').insert({ organization_id: organizationId, client_id: visit.client_id, representative_id: representativeId, visit_id: visit.id, sale_order_id: input.saleOrderId ?? null, amount: input.amount, mode: input.mode, reference_no: input.referenceNo ?? null, notes: input.notes ?? null }).select().single();
  if (error) throw error;
  await syncInvoicePaymentsForSaleOrder(organizationId, input.saleOrderId ?? null);
  if (input.saleOrderId) await completeOrderIfSettled(organizationId, input.saleOrderId);
  return data;
}

export async function createForOrder(organizationId: string, input: { orderId: string; amount: number; mode: string; referenceNo?: string | null; notes?: string | null }, scope: IndustryScope) {
  const { data: order, error: orderError } = await supabaseAdmin
    .from('sale_orders')
    .select('id, client_id, representative_id, total_amount, exchange_rate, status, clients!inner(industry_type_id)')
    .eq('id', input.orderId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order || !order.client_id || !order.representative_id) throw new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
assertRecordInScope(scope, (order.clients as unknown as { industry_type_id?: string | null } | null)?.industry_type_id ?? null, new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.'));
  // Payment methods / receipt rules are per industry — check them against this order's industry.
  await assertPaymentAllowed(organizationId, input.mode, input.referenceNo, (order.clients as unknown as { industry_type_id?: string | null } | null)?.industry_type_id ?? null);
  if (order.status === 'cancelled') throw new AppError(422, 'COLLECTION_CANCELLED_ORDER', 'A payment cannot be recorded for a cancelled order.');

  const { data: priorCollections, error: collectionsError } = await supabaseAdmin
    .from('sales_collections')
    .select('amount')
    .eq('organization_id', organizationId)
    .eq('sale_order_id', order.id);
  if (collectionsError) throw collectionsError;
  const alreadyCollected = (priorCollections ?? []).reduce((sum, collection) => sum + Number(collection.amount), 0) - ((await refundedByOrder(organizationId, [order.id as string])).get(order.id as string) ?? 0); // refunded money is no longer collected
  const credited = (await approvedReturnCredits(organizationId, [order.id as string])).get(order.id as string)?.credit ?? 0;
  // A Trading order can be billed for more than it was quoted (extra shipment charges): the payable amount is the larger of the two.
  const billed = (await billedTotalsForCoreOrders(organizationId, [order.id as string])).get(order.id as string) ?? 0;
  const orderRate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : 1;
  const balance = Math.max(Number(order.total_amount), billed / orderRate) - credited - alreadyCollected;
  if (input.amount > balance + 0.00001) {
    throw new AppError(422, 'COLLECTION_EXCEEDS_ORDER_TOTAL', `Collection exceeds the remaining order balance of ${Math.max(0, balance).toFixed(2)}.`);
  }

  // Duplicate guard: the same payment (order, amount, mode, reference) saved twice within 2 minutes - a double click -
  // is refused, and a cheque / UTR reference already used on this order cannot be recorded again.
  const { data: sameOrder, error: duplicateError } = await supabaseAdmin.from('sales_collections')
    .select('amount, mode, reference_no, created_at').eq('organization_id', organizationId).eq('sale_order_id', order.id);
  if (duplicateError) throw duplicateError;
  const reference = (input.referenceNo ?? '').trim();
  const recent = Date.now() - 120000;
  const duplicate = (sameOrder ?? []).some((p) => (reference && String(p.reference_no ?? '').trim() === reference)
    || (Number(p.amount) === Number(input.amount) && p.mode === input.mode && String(p.reference_no ?? '').trim() === reference && new Date(String(p.created_at)).getTime() > recent));
  if (duplicate) throw new AppError(409, 'DUPLICATE_COLLECTION', 'This payment was already recorded for this order (same amount and reference). Check the payment list before saving again.');

  const { data, error } = await supabaseAdmin.from('sales_collections').insert({
    organization_id: organizationId,
    client_id: order.client_id,
    representative_id: order.representative_id,
    sale_order_id: order.id,
    amount: input.amount,
    mode: input.mode,
    reference_no: input.referenceNo ?? null,
    notes: input.notes ?? null,
  }).select().single();
  if (error) throw error;
  await syncInvoicePaymentsForSaleOrder(organizationId, order.id as string);
  await completeOrderIfSettled(organizationId, order.id as string);
  return data;
}

export async function listCollections(organizationId: string, representativeId?: string, industryTypeId?: string | null) {
  let query = supabaseAdmin.from('sales_collections').select('*, clients!inner(client_code, client_name, industry_type_id), sales_representatives(employee_code, user_profiles(display_name)), sale_orders(order_number, currency_code, exchange_rate)').eq('organization_id', organizationId).order('collected_at', { ascending: false }).limit(100);
  if (representativeId) query = query.eq('representative_id', representativeId);
  if (industryTypeId) query = query.eq('clients.industry_type_id', industryTypeId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}