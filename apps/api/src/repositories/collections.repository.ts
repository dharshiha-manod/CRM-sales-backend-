import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';

export async function createFromVisit(organizationId: string, representativeId: string, visitId: string, input: { amount: number; mode: string; referenceNo?: string | null; saleOrderId?: string | null; notes?: string | null }) {
  const { data: visit, error: visitError } = await supabaseAdmin.from('field_visits').select('id, client_id').eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).in('status', ['checked_in', 'in_progress']).maybeSingle();
  if (visitError) throw visitError;
  if (!visit?.client_id) throw new AppError(422, 'COLLECTION_REQUIRES_CLIENT', 'A collection requires a visit linked to a client.');
  if (input.saleOrderId) {
    const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, total_amount').eq('id', input.saleOrderId).eq('organization_id', organizationId).eq('visit_id', visit.id).eq('client_id', visit.client_id).eq('representative_id', representativeId).maybeSingle();
    if (error) throw error;
    if (!order) throw new AppError(422, 'INVALID_COLLECTION_ORDER', 'The selected order does not belong to this active visit, client, and representative.');
    const { data: priorCollections, error: collectionError } = await supabaseAdmin.from('sales_collections').select('amount').eq('organization_id', organizationId).eq('sale_order_id', order.id);
    if (collectionError) throw collectionError;
    const alreadyCollected = (priorCollections ?? []).reduce((sum, collection) => sum + Number(collection.amount), 0);
    if (alreadyCollected + input.amount > Number(order.total_amount) + 0.00001) {
      throw new AppError(422, 'COLLECTION_EXCEEDS_ORDER_TOTAL', `Collection exceeds the remaining order balance of ${(Number(order.total_amount) - alreadyCollected).toFixed(2)}.`);
    }
  }
  const { data, error } = await supabaseAdmin.from('sales_collections').insert({ organization_id: organizationId, client_id: visit.client_id, representative_id: representativeId, visit_id: visit.id, sale_order_id: input.saleOrderId ?? null, amount: input.amount, mode: input.mode, reference_no: input.referenceNo ?? null, notes: input.notes ?? null }).select().single();
  if (error) throw error;
  return data;
}

export async function createForOrder(organizationId: string, input: { orderId: string; amount: number; mode: string; referenceNo?: string | null; notes?: string | null }, scope: IndustryScope) {
  const { data: order, error: orderError } = await supabaseAdmin
    .from('sale_orders')
    .select('id, client_id, representative_id, total_amount, status, clients!inner(industry_type_id)')
    .eq('id', input.orderId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order || !order.client_id || !order.representative_id) throw new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  assertRecordInScope(scope, order.clients?.industry_type_id, new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.'));
  if (order.status === 'cancelled') throw new AppError(422, 'COLLECTION_CANCELLED_ORDER', 'A payment cannot be recorded for a cancelled order.');

  const { data: priorCollections, error: collectionsError } = await supabaseAdmin
    .from('sales_collections')
    .select('amount')
    .eq('organization_id', organizationId)
    .eq('sale_order_id', order.id);
  if (collectionsError) throw collectionsError;
  const alreadyCollected = (priorCollections ?? []).reduce((sum, collection) => sum + Number(collection.amount), 0);
  const balance = Number(order.total_amount) - alreadyCollected;
  if (input.amount > balance + 0.00001) {
    throw new AppError(422, 'COLLECTION_EXCEEDS_ORDER_TOTAL', `Collection exceeds the remaining order balance of ${Math.max(0, balance).toFixed(2)}.`);
  }

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
  return data;
}

export async function listCollections(organizationId: string, representativeId?: string, industryTypeId?: string | null) {
  let query = supabaseAdmin.from('sales_collections').select('*, clients!inner(client_code, client_name, industry_type_id), sales_representatives(employee_code, user_profiles(display_name)), sale_orders(order_number)').eq('organization_id', organizationId).order('collected_at', { ascending: false }).limit(100);
  if (representativeId) query = query.eq('representative_id', representativeId);
  if (industryTypeId) query = query.eq('clients.industry_type_id', industryTypeId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
