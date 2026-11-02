import { assertNoActiveShipments } from './fmcg-shipment.repository.js';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { getOrderConfig, industryTypeIdOfClient } from '../lib/settings.js';
import { assertRecordInScope, type IndustryScope } from '../lib/industry-scope.js';
import { assertPharmaLicenseValid } from '../lib/pharma-license.js';
import { assertCreditOnApproval, assertWithinCreditLimit } from '../lib/credit.js'; // <-- NEW (assertCreditOnApproval added)
import { documentCurrencyForClient, isFmcgIndustry, toBase, type DocumentCurrency } from '../lib/fmcg-market.js';
import { bestSchemeFor, loadLiveSchemes, type LiveScheme } from '../lib/fmcg-schemes.js';
import { applyAllocations, planAllocations, readAllocation, releaseStockForOrder, takeStockForOrder, tracksOrderStock, type Allocation } from '../lib/stock.js';
import { billedTotalsForCoreOrders } from './trading.repository.js';
import { refundedByOrder } from './fmcg-refunds.repository.js';
import { releaseRollsForOrder } from '../lib/textile-rolls.js';
import { applySchoolAdvance, applySchoolPricingToOrder, isSchoolIndustry, loadSchoolContext, restoreSchoolAdvance, schoolStamp } from '../lib/school.js';
const fail = (error: unknown): never => { throw error; };
type OrderItem = { productId: string; quantity: number; discountPercent: number; freeQuantity?: number };

/** FMCG clients order in their own currency (local = INR @ 1); everyone else gets doc = null (columns untouched, no schemes). */
async function clientMarket(organizationId: string, clientId: string): Promise<{ doc: DocumentCurrency | null; industryTypeId: string | null }> {
  const { data: client, error } = await supabaseAdmin.from('clients').select('industry_type_id, country_code, currency_code').eq('id', clientId).eq('organization_id', organizationId).maybeSingle();
  if (error) fail(error);
  const c = client as { country_code?: string | null; currency_code?: string | null; industry_type_id?: string | null } | null;
  return { doc: await documentCurrencyForClient(organizationId, c), industryTypeId: c?.industry_type_id ?? null };
}
/** Catalog prices are rupee prices; convert to the order currency (1 unit of currency = rate INR). */
const priceIn = (inrPrice: number, doc: DocumentCurrency | null) => (doc && doc.exchange_rate !== 1 ? Math.round((inrPrice / doc.exchange_rate) * 100) / 100 : inrPrice);

/** Order lines in the order currency. A line with a typed discount keeps it; otherwise a live FMCG scheme may apply. */
function buildOrderLines(items: OrderItem[], productById: Map<string, { id: string; selling_price: unknown }>, doc: DocumentCurrency | null, schemes: LiveScheme[]) {
  return items.map((item) => {
    const product = productById.get(item.productId)!;
    const unitPrice = priceIn(Number(product.selling_price), doc);
    const gross = unitPrice * item.quantity;
    const applied = doc && !item.discountPercent ? bestSchemeFor(schemes, product.id, item.quantity, unitPrice, doc.exchange_rate) : null;
    const discountAmount = applied ? applied.discountAmount : Math.round(gross * item.discountPercent) / 100;
    return { product_id: product.id, quantity: item.quantity, unit_price: unitPrice, discount_amount: discountAmount, subtotal: gross - discountAmount, ...((item as { colour?: string | null }).colour ? { colour: (item as { colour?: string | null }).colour } : {}), ...(applied ? { scheme_id: applied.schemeId } : {}), ...(doc && (Number(item.freeQuantity) > 0 || applied) ? { free_quantity: Number(item.freeQuantity) > 0 ? Number(item.freeQuantity) : applied?.freeQuantity ?? 0 } : {}) };
  });
}

/** Orders with a return/damage entry that is still pending or approved cannot be cancelled or have their items changed. */
async function assertNoReturns(organizationId: string, orderId: string, action: string) {
  const { data, error } = await supabaseAdmin.from('sales_returns').select('id').eq('organization_id', organizationId).eq('order_id', orderId).in('status', ['pending', 'approved']).limit(1);
  if (error) fail(error);
  if ((data ?? []).length > 0) throw new AppError(422, 'ORDER_HAS_RETURNS', `This order has a return/damage entry, so it cannot be ${action}. Reject or delete that entry first.`);
}

/** FMCG orders take stock the moment they are confirmed. If stock is short the order is removed again and the error is shown. */
async function takeStockOrUndo(organizationId: string, orderId: string, isFmcg: boolean) {
  if (!isFmcg) return;
  try { await takeStockForOrder(organizationId, orderId); } catch (error) {
    await supabaseAdmin.from('sale_orders').delete().eq('id', orderId).eq('organization_id', organizationId);
    throw error;
  }
}

export function formatOrderNumber(format: string): string {
  const year = String(new Date().getFullYear());
  const randomSeq = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return format.replace('{YYYY}', year).replace('{0000}', randomSeq);
}

/** Same format as formatOrderNumber, but re-rolls if that number is already used in this organization. */
export async function uniqueOrderNumber(organizationId: string, format: string): Promise<string> {
  let candidate = formatOrderNumber(format);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data } = await supabaseAdmin.from('sale_orders').select('id').eq('organization_id', organizationId).eq('order_number', candidate).limit(1);
    if (!data || data.length === 0) return candidate;
    candidate = formatOrderNumber(format);
  }
  return candidate;
}

export async function createOrderFromVisit(organizationId: string, representativeId: string, visitId: string, input: { items: OrderItem[]; notes?: string | null }) {
  const { data: visit, error: visitError } = await supabaseAdmin.from('field_visits').select('id, client_id').eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).in('status', ['checked_in', 'in_progress']).maybeSingle();
  if (visitError) fail(visitError);
  if (!visit?.client_id) throw new AppError(422, 'ORDER_REQUIRES_ASSIGNED_CLIENT', 'An order can only be created from an active visit with an assigned client.');

  const productIds = input.items.map((item) => item.productId);
  const { data: products, error: productError } = await supabaseAdmin.from('products').select('id, product_code, product_name, selling_price').eq('organization_id', organizationId).eq('status', 'active').in('id', productIds);
  if (productError) fail(productError);
  if ((products ?? []).length !== new Set(productIds).size) throw new AppError(422, 'INVALID_ORDER_PRODUCT', 'One or more selected products are unavailable.');
  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const { doc, industryTypeId } = await clientMarket(organizationId, visit.client_id);
  const tracksStock = Boolean(doc) || await tracksOrderStock(organizationId, industryTypeId);
  // School only: apply this school's negotiated price rules. Everyone else gets the same items / products back, unchanged.
  const schoolCtx = await loadSchoolContext(organizationId, { id: visit.client_id, industry_type_id: industryTypeId }, productIds);
  const priced = applySchoolPricingToOrder(schoolCtx, input.items, productById);
  const lines = buildOrderLines(priced.items, priced.productById, doc, doc ? await loadLiveSchemes(organizationId, industryTypeId, productIds) : []);

  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const discount = lines.reduce((sum, line) => sum + line.discount_amount, 0);
  const totalInr = doc ? toBase(total, doc.exchange_rate) : total;

  // Each industry has its own Order Configuration — use the one for this visit's client.
  const orderConfig = await getOrderConfig(organizationId, await industryTypeIdOfClient(organizationId, visit.client_id));

  if (totalInr < orderConfig.minOrderValue) {
    throw new AppError(422, 'ORDER_BELOW_MINIMUM', `Order total (₹${totalInr}) is below the minimum order value of ₹${orderConfig.minOrderValue} set in Settings.`);
  }

  await assertPharmaLicenseValid(organizationId, visit.client_id);
  await assertWithinCreditLimit(organizationId, visit.client_id, totalInr);

  const orderNumber = await uniqueOrderNumber(organizationId, orderConfig.numberingFormat);
  const initialStatus = orderConfig.approvalRequired ? 'pending_approval' : 'confirmed';
  // Check stock BEFORE saving anything, so a short-stock order never gets created (or uses up an order number).
  if (tracksStock && initialStatus === 'confirmed') await planAllocations(organizationId, lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, free_quantity: (l as { free_quantity?: number }).free_quantity ?? 0 })));

  const { data: order, error: orderError } = await supabaseAdmin.from('sale_orders').insert({ organization_id: organizationId, order_number: orderNumber, visit_id: visit.id, client_id: visit.client_id, representative_id: representativeId, discount_amount: discount, total_amount: total, notes: input.notes, status: initialStatus, ...(doc ? { ...doc, base_total: totalInr } : {}), ...schoolStamp(schoolCtx) }).select().single();
  if (orderError) fail(orderError);

  const { data: savedLines, error: lineError } = await supabaseAdmin.from('sale_order_items').insert(lines.map((line) => ({ ...line, order_id: order.id }))).select();
  if (lineError) { await supabaseAdmin.from('sale_orders').delete().eq('id', order.id).eq('organization_id', organizationId); fail(lineError); }

  if (initialStatus === 'confirmed') await takeStockOrUndo(organizationId, order.id as string, tracksStock);
  await applySchoolAdvance(organizationId, schoolCtx, order);
  return { ...order, items: savedLines, stock_deducted: initialStatus === 'confirmed' && tracksStock };
}

export async function createManualOrder(organizationId: string, scope: IndustryScope, input: { clientId?: string | null; clientName?: string | null; representativeId: string; items: OrderItem[]; notes?: string | null }) {
  if (!input.clientId) throw new AppError(422, 'ORDER_REQUIRES_ASSIGNED_CLIENT', 'Select an existing client. Orders for clients outside the client list are not supported yet.');

  const { data: client, error: clientError } = await supabaseAdmin.from('clients').select('id, industry_type_id').eq('id', input.clientId).eq('organization_id', organizationId).maybeSingle();
  if (clientError) fail(clientError);
  const clientNotFound = new AppError(404, 'CLIENT_NOT_FOUND', 'The selected client was not found.');
  if (!client) throw clientNotFound;
  assertRecordInScope(scope, client.industry_type_id as string | null, clientNotFound);

  const { data: rep, error: repError } = await supabaseAdmin.from('sales_representatives').select('id').eq('id', input.representativeId).eq('organization_id', organizationId).eq('status', 'active').maybeSingle();
  if (repError) fail(repError);
  if (!rep) throw new AppError(422, 'INVALID_REPRESENTATIVE', 'Select an active sales representative.');

  // The order's rep must be the client's own rep, otherwise the beat / follow-up / target credit goes to the wrong person.
  const { data: owners, error: ownersError } = await supabaseAdmin.from('sales_representative_client_assignments').select('sales_representative_id').eq('organization_id', organizationId).eq('client_id', client.id as string).eq('status', 'active');
  if (ownersError) fail(ownersError);
  if ((owners ?? []).length > 0 && !(owners ?? []).some((o) => o.sales_representative_id === rep.id)) {
    throw new AppError(422, 'REPRESENTATIVE_NOT_ASSIGNED', "This client is assigned to a different sales representative. Select the client's own representative.");
  }

  const productIds = input.items.map((item) => item.productId);
  const { data: products, error: productError } = await supabaseAdmin.from('products').select('id, product_code, product_name, selling_price').eq('organization_id', organizationId).eq('status', 'active').in('id', productIds);
  if (productError) fail(productError);
  if ((products ?? []).length !== new Set(productIds).size) throw new AppError(422, 'INVALID_ORDER_PRODUCT', 'One or more selected products are unavailable.');

  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const { doc, industryTypeId: clientIndustryId } = await clientMarket(organizationId, client.id as string);
  const tracksStock = Boolean(doc) || await tracksOrderStock(organizationId, clientIndustryId);
  const schoolCtx = await loadSchoolContext(organizationId, { id: client.id as string, industry_type_id: client.industry_type_id as string | null }, productIds);
  const priced = applySchoolPricingToOrder(schoolCtx, input.items, productById);
  const lines = buildOrderLines(priced.items, priced.productById, doc, doc ? await loadLiveSchemes(organizationId, client.industry_type_id as string | null, productIds) : []);

  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const discount = lines.reduce((sum, line) => sum + line.discount_amount, 0);
  const totalInr = doc ? toBase(total, doc.exchange_rate) : total;

  const orderConfig = await getOrderConfig(organizationId, client.industry_type_id as string | null);
  if (totalInr < orderConfig.minOrderValue) {
    throw new AppError(422, 'ORDER_BELOW_MINIMUM', `Order total (₹${totalInr}) is below the minimum order value of ₹${orderConfig.minOrderValue} set in Settings.`);
  }

  await assertPharmaLicenseValid(organizationId, client.id as string);
  await assertWithinCreditLimit(organizationId, client.id as string, totalInr);

  const orderNumber = await uniqueOrderNumber(organizationId, orderConfig.numberingFormat);
  const initialStatus = orderConfig.approvalRequired ? 'pending_approval' : 'confirmed';
  // Check stock BEFORE saving anything, so a short-stock order never gets created (same as the visit path).
  if (tracksStock && initialStatus === 'confirmed') await planAllocations(organizationId, lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, free_quantity: (l as { free_quantity?: number }).free_quantity ?? 0 })));

  const { data: order, error: orderError } = await supabaseAdmin.from('sale_orders').insert({ organization_id: organizationId, order_number: orderNumber, visit_id: null, client_id: client.id, representative_id: rep.id, discount_amount: discount, total_amount: total, notes: input.notes, status: initialStatus, ...(doc ? { ...doc, base_total: totalInr } : {}), ...schoolStamp(schoolCtx) }).select().single();
  if (orderError) fail(orderError);

  const { data: savedLines, error: lineError } = await supabaseAdmin.from('sale_order_items').insert(lines.map((line) => ({ ...line, order_id: order.id }))).select();
  if (lineError) { await supabaseAdmin.from('sale_orders').delete().eq('id', order.id).eq('organization_id', organizationId); fail(lineError); }

  if (initialStatus === 'confirmed') await takeStockOrUndo(organizationId, order.id as string, tracksStock);
  await applySchoolAdvance(organizationId, schoolCtx, order);
  return { ...order, items: savedLines, stock_deducted: initialStatus === 'confirmed' && tracksStock };
}

export async function listOrders(organizationId: string, representativeId?: string, industryTypeId?: string | null) {
  let query = supabaseAdmin.from('sale_orders').select('*, clients!inner(client_code, client_name, city, industry_type_id, country_code, credit_limit, credit_days, industry_types(name)), sales_representatives(employee_code, user_profiles(display_name)), sale_order_items(quantity, free_quantity, scheme_id, unit_price, discount_amount, subtotal, tax_amount, colour, products(id, product_code, product_name, unit, mrp, discount_percent))').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100);
  if (industryTypeId) query = query.eq('clients.industry_type_id', industryTypeId);
  const { data, error } = await query; if (error) return fail(error);
  const orders = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>;
  // Approved returns / damage are credit notes: the order keeps its total, but the client owes that much less.
  const credits = await approvedReturnCredits(organizationId, orders.map((o) => o.id));
  // Trading orders: what their final (Sent / Paid) invoices add up to. 0 for every other order.
  const billed = await billedTotalsForCoreOrders(organizationId, orders.map((o) => o.id));
  // How much of that credit has already been paid back to the client (only orders that have a credit are looked up).
  const refunded = await refundedByOrder(organizationId, orders.filter((o) => (credits.get(o.id)?.credit ?? 0) > 0).map((o) => o.id));
  return orders.map((o) => ({ ...o, refunded_amount: refunded.get(o.id) ?? 0, returns_credit: credits.get(o.id)?.credit ?? 0, returns_credit_base: credits.get(o.id)?.base ?? 0, billed_total: billed.get(o.id) ?? 0 }));
}

/** order id -> total approved return/damage credit (in the order's currency and in INR). */
export async function approvedReturnCredits(organizationId: string, orderIds: string[]) {
  const result = new Map<string, { credit: number; base: number }>();
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('sales_returns').select('order_id, credit_amount, base_credit').eq('organization_id', organizationId).eq('status', 'approved').in('order_id', orderIds.slice(i, i + 100));
    if (error) { if (/sales_returns/.test(error.message)) return result; fail(error); }
    for (const row of data ?? []) {
      const entry = result.get(row.order_id as string) ?? { credit: 0, base: 0 };
      entry.credit += Number(row.credit_amount ?? 0); entry.base += Number(row.base_credit ?? 0);
      result.set(row.order_id as string, entry);
    }
  }
  return result;
}

export async function cancelOrder(organizationId: string, scope: IndustryScope, id: string, reason?: string | null) {
  const { data: order, error: fetchError } = await supabaseAdmin.from('sale_orders').select('id, status, notes, stock_deducted, dispatch_status, textile_delivery_status, client_id, clients!inner(industry_type_id)').eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (fetchError) fail(fetchError);
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  if (!order) throw notFound;
  assertRecordInScope(scope, (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null, notFound);
  if (order.status === 'cancelled') return order;
  await assertNoActiveShipments(organizationId, id, 'cancelled');
  if (order.status === 'completed') throw new AppError(422, 'ORDER_ALREADY_COMPLETED', 'A completed order cannot be cancelled.');
  if (order.status !== 'pending_approval') {
    const orderConfig = await getOrderConfig(organizationId, (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null);
    if (!orderConfig.allowCancellation) throw new AppError(422, 'CANCELLATION_DISABLED', 'Order cancellation is turned off in Settings → Order Configuration.');
  }

  await assertNoReturns(organizationId, id, 'cancelled');
  // School: goods that already left (dispatched / delivered) cannot be cancelled - undo the dispatch first or record a return.
  if (['dispatched', 'delivered'].includes(String((order as { dispatch_status?: string | null }).dispatch_status ?? '')) && await isSchoolIndustry(organizationId, (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null)) {
    throw new AppError(422, 'ORDER_ALREADY_DISPATCHED', 'This order has already been dispatched. Move it back to Pending first, or record a sales return.');
  }
  // Textile: fabric that has already been dispatched cannot be cancelled - record a sales return instead.
  if ((order as { textile_delivery_status?: string | null }).textile_delivery_status) throw new AppError(422, 'ORDER_ALREADY_DISPATCHED', 'This order has already been dispatched. Record a sales return instead of cancelling it.');
  if (order.stock_deducted) await releaseStockForOrder(organizationId, id);
  const notes = reason?.trim() ? `${order.notes ? order.notes + '\n' : ''}Cancelled: ${reason.trim()}` : order.notes;
  const { data, error } = await supabaseAdmin.from('sale_orders').update({ status: 'cancelled', notes }).eq('id', id).eq('organization_id', organizationId).select().single();
  if (error) { if (order.stock_deducted) await takeStockForOrder(organizationId, id).catch(() => undefined); return fail(error); }
  // School only: the advance this order had used up goes back to the school (no-op for every other industry).
  await restoreSchoolAdvance(organizationId, id, order.client_id as string, (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null);
  await releaseRollsForOrder(organizationId, id); // Textile: rolls Issued to this order go back to In stock (no-op for other industries)
  return data;
}

export async function approveOrder(organizationId: string, scope: IndustryScope, id: string) {
  const { data: order, error: fetchError } = await supabaseAdmin.from('sale_orders').select('id, status, client_id, clients!inner(industry_type_id)').eq('id', id).eq('organization_id', organizationId).maybeSingle(); // <-- NEW (client_id added)
  if (fetchError) fail(fetchError);
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  if (!order) throw notFound;
  assertRecordInScope(scope, (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null, notFound);
  if (order.status !== 'pending_approval') throw new AppError(422, 'ORDER_NOT_PENDING_APPROVAL', `A ${order.status} order is not awaiting approval.`);
  await assertPharmaLicenseValid(organizationId, order.client_id as string | null);
  await assertCreditOnApproval(organizationId, order.client_id as string | null); // <-- NEW: credit may have changed while the order waited

  const { data, error } = await supabaseAdmin.from('sale_orders').update({ status: 'confirmed' }).eq('id', id).eq('organization_id', organizationId).eq('status', 'pending_approval').select().single();
  if (error) return fail(error);
  // Stock is taken when the order becomes a real (confirmed) sale. If stock ran short, the order goes back to waiting.
  if (await tracksOrderStock(organizationId, (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null)) {
    try { await takeStockForOrder(organizationId, id); } catch (stockError) {
      await supabaseAdmin.from('sale_orders').update({ status: 'pending_approval' }).eq('id', id).eq('organization_id', organizationId);
      throw stockError;
    }
  }
  // School only: orders waiting for approval skip the advance at creation, so use it up now that the order is confirmed (no-op for every other industry).
  const approvedSchoolCtx = await loadSchoolContext(organizationId, { id: order.client_id as string, industry_type_id: (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null }, []);
  await applySchoolAdvance(organizationId, approvedSchoolCtx, data);
  return data;
}

export async function updateOrder(organizationId: string, scope: IndustryScope, id: string, input: { items?: OrderItem[]; notes?: string | null }) {
  const { data: order, error: fetchError } = await supabaseAdmin.from('sale_orders').select('id, status, client_id, total_amount, base_total, currency_code, stock_deducted, tax_amount, dispatch_status, clients!inner(industry_type_id)').eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (fetchError) fail(fetchError);
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  if (!order) throw notFound;
  const orderIndustryTypeId = (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null;
  assertRecordInScope(scope, orderIndustryTypeId, notFound);
  const orderConfig = await getOrderConfig(organizationId, orderIndustryTypeId);
  if (!orderConfig.allowEditing) throw new AppError(422, 'EDITING_DISABLED', 'Order editing is turned off in Settings → Order Configuration.');
  if (order.status === 'cancelled' || order.status === 'completed') throw new AppError(422, 'ORDER_NOT_EDITABLE', `A ${order.status} order cannot be edited.`);

  // A foreign-currency order keeps the price, currency and rate it was agreed at. Re-pricing its lines at rupee
  // catalog prices would leave a USD order with INR numbers and a stale INR value, so line edits are blocked.
  const orderCurrency = String((order as { currency_code?: string | null }).currency_code ?? 'INR').toUpperCase();
  if (input.items && orderCurrency !== 'INR') throw new AppError(422, 'FOREIGN_ORDER_ITEMS_LOCKED', `This order is in ${orderCurrency}. Its items cannot be edited; cancel it and create a new quotation instead. Notes can still be edited.`);

  const update: Record<string, unknown> = {};
  if (input.notes !== undefined) update.notes = input.notes;

  if (input.items) {
    await assertNoReturns(organizationId, id, 'edited');
    await assertNoActiveShipments(organizationId, id, 'edited');
    // School only: once the goods have left the store the lines are locked, and an order whose total includes tax
    // (converted from a quotation) cannot be re-priced here because this edit path has no tax. Notes stay editable.
    if (await isSchoolIndustry(organizationId, orderIndustryTypeId)) {
      if (['dispatched', 'delivered'].includes(String((order as { dispatch_status?: string | null }).dispatch_status ?? ''))) throw new AppError(422, 'ORDER_DISPATCHED', 'The goods on this order have already been dispatched. Undo the dispatch first, or record a sales return.');
      if (Number((order as { tax_amount?: number | null }).tax_amount ?? 0) > 0) throw new AppError(422, 'ORDER_HAS_TAX', 'This order includes tax from its quotation, so its items cannot be edited here. Cancel it and create a new quotation instead. Notes can still be edited.');
    }
    const productIds = input.items.map((item) => item.productId);
    const { data: products, error: productError } = await supabaseAdmin.from('products').select('id, product_code, product_name, selling_price').eq('organization_id', organizationId).eq('status', 'active').in('id', productIds);
    if (productError) fail(productError);
    if ((products ?? []).length !== new Set(productIds).size) throw new AppError(422, 'INVALID_ORDER_PRODUCT', 'One or more selected products are unavailable.');

    const productById = new Map((products ?? []).map((product) => [product.id, product]));
    const { doc } = await clientMarket(organizationId, order.client_id as string);
    const schoolCtx = await loadSchoolContext(organizationId, { id: order.client_id as string, industry_type_id: orderIndustryTypeId }, productIds);
    const priced = applySchoolPricingToOrder(schoolCtx, input.items, productById);
    const lines = buildOrderLines(priced.items, priced.productById, doc, doc ? await loadLiveSchemes(organizationId, orderIndustryTypeId, productIds) : []);
    const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
    const discount = lines.reduce((sum, line) => sum + line.discount_amount, 0);
    const totalInr = doc ? toBase(total, doc.exchange_rate) : total;
    if (totalInr < orderConfig.minOrderValue) throw new AppError(422, 'ORDER_BELOW_MINIMUM', `Order total (₹${totalInr}) is below the minimum order value of ₹${orderConfig.minOrderValue} set in Settings.`);
    // The old total is already part of the client's unpaid balance, so only the increase is new credit.
    await assertWithinCreditLimit(organizationId, order.client_id as string | null, totalInr - Number(order.base_total ?? order.total_amount ?? 0));

    // Stock: give back exactly what the old lines took, take what the new lines need. If stock is short, the old state is restored.
    let oldAllocs: Allocation[] = [];
    let newAllocs: Allocation[] = [];
    let newPlan = new Map<string, Allocation[]>();
    if (order.stock_deducted) {
      const { data: oldLines, error: oldError } = await supabaseAdmin.from('sale_order_items').select('batch_allocations').eq('order_id', id);
      if (oldError) fail(oldError);
      oldAllocs = (oldLines ?? []).map((l) => readAllocation(l.batch_allocations)).filter((a): a is Allocation => a !== null);
      await applyAllocations(organizationId, oldAllocs, 'give');
      try {
        newPlan = await planAllocations(organizationId, lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, free_quantity: (l as { free_quantity?: number }).free_quantity ?? 0 })));
        newAllocs = [...newPlan.values()].flat();
        await applyAllocations(organizationId, newAllocs, 'take');
      } catch (stockError) {
        await applyAllocations(organizationId, oldAllocs, 'take').catch(() => undefined);
        throw stockError;
      }
    }

    const { error: deleteError } = await supabaseAdmin.from('sale_order_items').delete().eq('order_id', id);
    if (deleteError) {
      if (order.stock_deducted) { await applyAllocations(organizationId, newAllocs, 'give').catch(() => undefined); await applyAllocations(organizationId, oldAllocs, 'take').catch(() => undefined); }
      fail(deleteError);
    }
    const { error: lineError } = await supabaseAdmin.from('sale_order_items').insert(lines.map((line, index) => ({ ...line, order_id: id, batch_allocations: newPlan.get(String(index))?.[0] ?? null })));
    if (lineError) {
      if (order.stock_deducted) { await applyAllocations(organizationId, newAllocs, 'give').catch(() => undefined); await supabaseAdmin.from('sale_orders').update({ stock_deducted: false }).eq('id', id).eq('organization_id', organizationId); }
      fail(lineError);
    }
    update.total_amount = total;
    update.discount_amount = discount;
    if (doc) update.base_total = totalInr;
  }

  if (Object.keys(update).length === 0) return order;

  const { data, error } = await supabaseAdmin.from('sale_orders').update(update).eq('id', id).eq('organization_id', organizationId).select('*, sale_order_items(quantity, free_quantity, scheme_id, unit_price, discount_amount, subtotal, colour, products(id, product_code, product_name, unit, mrp, discount_percent))').single();
  return error ? fail(error) : data;
}