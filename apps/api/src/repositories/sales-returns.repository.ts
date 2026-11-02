// FMCG sales returns & damage. An APPROVED entry lowers the client's outstanding (credit note); an approved
// good return with "restock" also puts the units back on the shelf, into the batches they were sold from.
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope, type IndustryScope } from '../lib/industry-scope.js';
import { industryCodeOf, isFmcgIndustry, toBase } from '../lib/fmcg-market.js';
import { restockFromOrder } from '../lib/stock.js';
import { completeOrderIfSettled } from '../lib/order-completion.js';
import { isSchoolIndustry } from '../lib/school.js';

const fail = (error: unknown): never => { throw error; };
const SELECT = '*, sale_orders(order_number, currency_code), clients(client_code, client_name), products(product_code, product_name)';
const round2 = (v: number) => Math.round(v * 100) / 100;

export const returnSchema = z.object({
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().finite().positive().max(1e7),
  kind: z.enum(['return', 'damage']),
  reason: z.string().trim().max(500).optional().nullable(),
   restock: z.boolean().optional(),
  creditClient: z.boolean().optional(),
});
export type ReturnInput = z.infer<typeof returnSchema>;

export async function listReturns(org: string, opts: { industryTypeId?: string | null; representativeId?: string }) {
  let orderIds: string[] | null = null;
  if (opts.representativeId) {
    const { data, error } = await supabaseAdmin.from('sale_orders').select('id').eq('organization_id', org).eq('representative_id', opts.representativeId);
    if (error) fail(error);
    orderIds = (data ?? []).map((o) => o.id as string);
    if (orderIds.length === 0) return [];
  }
  let query = supabaseAdmin.from('sales_returns').select(opts.industryTypeId ? SELECT.replace('clients(', 'clients!inner(').replace('client_name)', 'client_name, industry_type_id)') : SELECT).eq('organization_id', org).order('created_at', { ascending: false }).limit(500);
  if (opts.industryTypeId) query = query.eq('clients.industry_type_id', opts.industryTypeId);
  if (orderIds) query = query.in('order_id', orderIds.slice(0, 300));
  const { data, error } = await query;
  if (error) fail(error);
  return data ?? [];
}

export async function createReturn(org: string, userId: string, scope: IndustryScope, input: ReturnInput, representativeId?: string, updateId?: string) {
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, status, client_id, representative_id, currency_code, exchange_rate, dispatch_status, clients!inner(industry_type_id)').eq('id', input.orderId).eq('organization_id', org).maybeSingle();
  if (error) fail(error);
  if (!order || !order.client_id) throw notFound;
  const industryTypeId = (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null;
  assertRecordInScope(scope, industryTypeId, notFound);
  if (representativeId && order.representative_id !== representativeId) throw notFound;
  const isSchool = await isSchoolIndustry(org, industryTypeId); // School orders use the same return / damage + approval flow
  const isPharma = (await industryCodeOf(org, industryTypeId)) === 'pharma'; // Pharma medicine returns raise their credit note through this same table
  if (!isSchool && !isPharma && !(await isFmcgIndustry(org, industryTypeId))) throw new AppError(422, 'NOT_FMCG', 'Returns & damage are only available in the FMCG and Pharma industries.');
  if (['cancelled', 'rejected', 'pending_approval'].includes(String(order.status))) throw new AppError(422, 'ORDER_NOT_RETURNABLE', `A ${String(order.status).replace('_', ' ')} order has nothing to return.`);
  if (isSchool && !['dispatched', 'delivered'].includes(String((order as { dispatch_status?: string | null }).dispatch_status ?? 'pending'))) throw new AppError(422, 'NOT_DISPATCHED', 'These goods have not been dispatched yet, so there is nothing to return. Cancel the order instead.');

  const { data: lines, error: lineError } = await supabaseAdmin.from('sale_order_items').select('id, quantity, free_quantity, subtotal, tax_amount').eq('order_id', order.id).eq('product_id', input.productId);
  if (lineError) fail(lineError);
  const paidQty = (lines ?? []).reduce((s, l) => s + Number(l.quantity ?? 0), 0);
  const freeQty = (lines ?? []).reduce((s, l) => s + Number(l.free_quantity ?? 0), 0);
  const sold = paidQty + freeQty; // free units can come back too, but earn no credit
  if (sold <= 0) throw new AppError(422, 'PRODUCT_NOT_ON_ORDER', 'That product is not on this order.');
  const paid = (lines ?? []).reduce((s, l) => s + Number(l.subtotal ?? 0), 0);
  const paidTax = (lines ?? []).reduce((s, l) => s + Number(l.tax_amount ?? 0), 0);
  let priorQuery = supabaseAdmin.from('sales_returns').select('quantity, credit_client').eq('organization_id', org).eq('order_id', order.id).eq('product_id', input.productId).in('status', ['pending', 'approved']);
  if (updateId) priorQuery = priorQuery.neq('id', updateId);
  const { data: prior, error: priorError } = await priorQuery;
  if (priorError) fail(priorError);
  const already = (prior ?? []).reduce((s, r) => s + Number(r.quantity ?? 0), 0);
  // Units from entries where the client bears the loss earn no credit, so they must not use up the free-unit allowance.
  const alreadyCredited = (prior ?? []).reduce((s, r) => s + (r.credit_client === false ? 0 : Number(r.quantity ?? 0)), 0);
  // When the order has shipments, only goods that were actually dispatched can come back. Orders with no shipments (local, delivered without a shipment record) keep the old rule.
  const { data: ships, error: shipError } = await supabaseAdmin.from('fmcg_shipments').select('status, fmcg_shipment_items(order_item_id, quantity)').eq('organization_id', org).eq('order_id', order.id).neq('status', 'cancelled');
  if (shipError) fail(shipError);
  let returnable = sold;
  if ((ships ?? []).length > 0) {
    const itemIds = new Set((lines ?? []).map((l) => l.id as string));
    returnable = Math.min(sold, (ships ?? []).filter((s) => s.status === 'dispatched' || s.status === 'delivered')
      .reduce((sum, s) => sum + ((s.fmcg_shipment_items ?? []) as Array<{ order_item_id: string; quantity: number }>).filter((i) => itemIds.has(i.order_item_id)).reduce((a, i) => a + Number(i.quantity), 0), 0));
    if (returnable <= 0) throw new AppError(422, 'NOT_DISPATCHED', 'These goods have not been dispatched yet, so there is nothing to return. Cancel the shipment instead.');
  }
  if (input.quantity + already > returnable + 1e-9) throw new AppError(422, 'RETURN_EXCEEDS_ORDER', `Only ${Math.max(0, returnable - already)} unit(s) of this product can still be returned or written off on this order.`);

  const rate = Number(order.exchange_rate ?? 1) || 1;
  // Free units are returned first and earn no credit; only paid units are credited, at what the client actually paid per unit.
const creditableNow = Math.max(0, alreadyCredited + input.quantity - freeQty) - Math.max(0, alreadyCredited - freeQty);
  // Damage can be the client's own loss (e.g. damaged at their outlet): then no credit and the client pays for the goods.
  const creditClient = input.kind === 'damage' ? input.creditClient !== false : true;
  // what the client actually paid per unit (after discounts), in the order's currency
   const credit = creditClient && paidQty > 0 ? round2(((paid + paidTax) / paidQty) * creditableNow) : 0;
  const row = {
    organization_id: org, order_id: order.id, client_id: order.client_id, product_id: input.productId, quantity: input.quantity,
    kind: input.kind, reason: input.reason || null, restock: input.kind === 'return' ? Boolean(input.restock) : false, credit_client: creditClient, status: 'pending',
    currency_code: String(order.currency_code ?? 'INR'), exchange_rate: rate, credit_amount: credit, base_credit: toBase(credit, rate),
  };
  const { data, error: insertError } = updateId
    ? await supabaseAdmin.from('sales_returns').update(row).eq('id', updateId).eq('organization_id', org).eq('status', 'pending').select(SELECT).single()
    : await supabaseAdmin.from('sales_returns').insert({ ...row, created_by: userId }).select(SELECT).single();
  if (insertError) fail(insertError);
  return data;
}

async function loadForDecision(org: string, scope: IndustryScope, id: string) {
  const notFound = new AppError(404, 'RETURN_NOT_FOUND', 'Return / damage entry not found.');
  const { data, error } = await supabaseAdmin.from('sales_returns').select('*, clients!inner(industry_type_id)').eq('id', id).eq('organization_id', org).maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound;
  assertRecordInScope(scope, (data.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null, notFound);
  return data as Record<string, unknown> & { id: string; status: string; kind: string; restock: boolean; order_id: string; product_id: string; quantity: number };
}

export async function decideReturn(org: string, userId: string, scope: IndustryScope, id: string, status: 'approved' | 'rejected') {
  const entry = await loadForDecision(org, scope, id);
  if (entry.status !== 'pending') throw new AppError(422, 'RETURN_ALREADY_DECIDED', `This entry is already ${entry.status}.`);
  // The status filter makes double-clicks and two admins safe: only one of them wins.
  const { data: won, error } = await supabaseAdmin.from('sales_returns').update({ status, decided_by: userId, decided_at: new Date().toISOString() }).eq('id', id).eq('organization_id', org).eq('status', 'pending').select('id').maybeSingle();
  if (error) fail(error);
  if (!won) throw new AppError(409, 'RETURN_ALREADY_DECIDED', 'Someone else already decided this entry.');
  if (status === 'approved' && entry.kind === 'return' && entry.restock) {
    try { await restockFromOrder(org, entry.order_id, entry.product_id, Number(entry.quantity)); } catch (stockError) {
      await supabaseAdmin.from('sales_returns').update({ status: 'pending', decided_by: null, decided_at: null }).eq('id', id).eq('organization_id', org);
      throw stockError;
    }
  }
  if (status === 'approved') await completeOrderIfSettled(org, entry.order_id); // the credit may settle a delivered order
  const { data, error: readError } = await supabaseAdmin.from('sales_returns').select(SELECT).eq('id', id).single();
  return readError ? fail(readError) : data;
}

export async function updateReturn(org: string, userId: string, scope: IndustryScope, id: string, input: ReturnInput) {
  const entry = await loadForDecision(org, scope, id);
  if (entry.status !== 'pending') throw new AppError(422, 'RETURN_NOT_EDITABLE', 'Only pending entries can be edited. An approved or rejected entry is final.');
  return createReturn(org, userId, scope, { ...input, orderId: entry.order_id, productId: entry.product_id }, undefined, id);
}

export async function deleteReturn(org: string, scope: IndustryScope, id: string) {  const entry = await loadForDecision(org, scope, id);
  if (entry.status === 'approved') throw new AppError(422, 'RETURN_APPROVED', 'An approved entry has already changed the client balance and stock, so it cannot be deleted.');
  const { error } = await supabaseAdmin.from('sales_returns').delete().eq('id', id).eq('organization_id', org).neq('status', 'approved');
  if (error) fail(error);
}
/**
 * Delivery receipt -> Sales Return & Damage. When a shipment is delivered, what the receipt records becomes a PENDING entry:
 *  - damaged units -> a "damage" entry (client credited by default; edit to "client bears the loss" before approving)
 *  - short units (never arrived) -> a "return" entry, not restocked, so the client is not billed for goods they never got
 * Re-saving the receipt updates the still-pending entry; approved / rejected entries are never touched.
 */
export async function syncDamageFromDelivery(org: string, userId: string, scope: IndustryScope, shipmentId: string, shipmentNo: string, orderId: string) {
  const { data: items, error } = await supabaseAdmin.from('fmcg_shipment_items').select('order_item_id, damaged_quantity, short_quantity').eq('shipment_id', shipmentId);
  if (error) fail(error);
  const itemIds = (items ?? []).map((i) => i.order_item_id as string);
  const productOfItem = new Map<string, string>();
  if (itemIds.length) {
    const { data: lines, error: lineError } = await supabaseAdmin.from('sale_order_items').select('id, product_id').in('id', itemIds);
    if (lineError) fail(lineError);
    for (const l of lines ?? []) productOfItem.set(l.id as string, l.product_id as string);
  }
  const total = (column: 'damaged_quantity' | 'short_quantity') => {
    const byProduct = new Map<string, number>();
    for (const i of items ?? []) {
      const productId = productOfItem.get(i.order_item_id as string);
      if (productId) byProduct.set(productId, round2((byProduct.get(productId) ?? 0) + Number(i[column] ?? 0)));
    }
    return byProduct;
  };

  const plans: Array<{ kind: 'damage' | 'return'; reason: string; quantities: Map<string, number> }> = [
    { kind: 'damage', reason: `Damaged on delivery (${shipmentNo})`, quantities: total('damaged_quantity') },
    { kind: 'return', reason: `Short delivery (${shipmentNo})`, quantities: total('short_quantity') },
  ];

  for (const plan of plans) {
    const { data: existing, error: existingError } = await supabaseAdmin.from('sales_returns').select('id, product_id, status, quantity').eq('organization_id', org).eq('order_id', orderId).eq('reason', plan.reason);
    if (existingError) fail(existingError);
    for (const [productId, quantity] of plan.quantities) {
      const entry = (existing ?? []).find((e) => e.product_id === productId);
      const input = { orderId, productId, quantity, kind: plan.kind, reason: plan.reason, creditClient: true, restock: false };
      if (!entry) {
        if (quantity > 0) await createReturn(org, userId, scope, input);
      } else if (entry.status === 'pending') {
        if (quantity <= 0) await supabaseAdmin.from('sales_returns').delete().eq('id', entry.id).eq('organization_id', org).eq('status', 'pending');
        else if (Number(entry.quantity) !== quantity) await createReturn(org, userId, scope, input, undefined, entry.id as string);
      }
    }
  }
}