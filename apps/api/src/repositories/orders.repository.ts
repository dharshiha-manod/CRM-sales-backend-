import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { getOrderConfig } from '../lib/settings.js';
import { assertRecordInScope, type IndustryScope } from '../lib/industry-scope.js';

const fail = (error: unknown): never => { throw error; };
type OrderItem = { productId: string; quantity: number; discountPercent: number };

export function formatOrderNumber(format: string): string {
  const year = String(new Date().getFullYear());
  const randomSeq = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return format.replace('{YYYY}', year).replace('{0000}', randomSeq);
}

export async function createOrderFromVisit(organizationId: string, representativeId: string, visitId: string, input: { items: OrderItem[]; notes?: string | null }) {
  const { data: visit, error: visitError } = await supabaseAdmin.from('field_visits').select('id, client_id').eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).in('status', ['checked_in', 'in_progress']).maybeSingle();
  if (visitError) fail(visitError);
  if (!visit?.client_id) throw new AppError(422, 'ORDER_REQUIRES_ASSIGNED_CLIENT', 'An order can only be created from an active visit with an assigned client.');

  const productIds = input.items.map((item) => item.productId);
  const { data: products, error: productError } = await supabaseAdmin.from('products').select('id, product_code, product_name, selling_price').eq('organization_id', organizationId).eq('status', 'active').in('id', productIds);
  if (productError) fail(productError);
  if ((products ?? []).length !== productIds.length) throw new AppError(422, 'INVALID_ORDER_PRODUCT', 'One or more selected products are unavailable.');

  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const lines = input.items.map((item) => { const product = productById.get(item.productId)!; const unitPrice = Number(product.selling_price); const gross = unitPrice * item.quantity; const discountAmount = Math.round(gross * item.discountPercent) / 100; return { product_id: product.id, quantity: item.quantity, unit_price: unitPrice, discount_amount: discountAmount, subtotal: gross - discountAmount }; });

  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const discount = lines.reduce((sum, line) => sum + line.discount_amount, 0);

  const orderConfig = await getOrderConfig(organizationId);

  if (total < orderConfig.minOrderValue) {
    throw new AppError(422, 'ORDER_BELOW_MINIMUM', `Order total (₹${total}) is below the minimum order value of ₹${orderConfig.minOrderValue} set in Settings.`);
  }

  const orderNumber = formatOrderNumber(orderConfig.numberingFormat);
  const initialStatus = orderConfig.approvalRequired ? 'pending_approval' : 'confirmed';

  const { data: order, error: orderError } = await supabaseAdmin.from('sale_orders').insert({ organization_id: organizationId, order_number: orderNumber, visit_id: visit.id, client_id: visit.client_id, representative_id: representativeId, discount_amount: discount, total_amount: total, notes: input.notes, status: initialStatus }).select().single();
  if (orderError) fail(orderError);

  const { data: savedLines, error: lineError } = await supabaseAdmin.from('sale_order_items').insert(lines.map((line) => ({ ...line, order_id: order.id }))).select();
  if (lineError) { await supabaseAdmin.from('sale_orders').delete().eq('id', order.id).eq('organization_id', organizationId); fail(lineError); }

  return { ...order, items: savedLines };
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

  const productIds = input.items.map((item) => item.productId);
  const { data: products, error: productError } = await supabaseAdmin.from('products').select('id, product_code, product_name, selling_price').eq('organization_id', organizationId).eq('status', 'active').in('id', productIds);
  if (productError) fail(productError);
  if ((products ?? []).length !== new Set(productIds).size) throw new AppError(422, 'INVALID_ORDER_PRODUCT', 'One or more selected products are unavailable.');

  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const lines = input.items.map((item) => { const product = productById.get(item.productId)!; const unitPrice = Number(product.selling_price); const gross = unitPrice * item.quantity; const discountAmount = Math.round(gross * item.discountPercent) / 100; return { product_id: product.id, quantity: item.quantity, unit_price: unitPrice, discount_amount: discountAmount, subtotal: gross - discountAmount }; });

  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const discount = lines.reduce((sum, line) => sum + line.discount_amount, 0);

  const orderConfig = await getOrderConfig(organizationId);
  if (total < orderConfig.minOrderValue) {
    throw new AppError(422, 'ORDER_BELOW_MINIMUM', `Order total (₹${total}) is below the minimum order value of ₹${orderConfig.minOrderValue} set in Settings.`);
  }

  const orderNumber = formatOrderNumber(orderConfig.numberingFormat);
  const initialStatus = orderConfig.approvalRequired ? 'pending_approval' : 'confirmed';

  const { data: order, error: orderError } = await supabaseAdmin.from('sale_orders').insert({ organization_id: organizationId, order_number: orderNumber, visit_id: null, client_id: client.id, representative_id: rep.id, discount_amount: discount, total_amount: total, notes: input.notes, status: initialStatus }).select().single();
  if (orderError) fail(orderError);

  const { data: savedLines, error: lineError } = await supabaseAdmin.from('sale_order_items').insert(lines.map((line) => ({ ...line, order_id: order.id }))).select();
  if (lineError) { await supabaseAdmin.from('sale_orders').delete().eq('id', order.id).eq('organization_id', organizationId); fail(lineError); }

  return { ...order, items: savedLines };
}

export async function listOrders(organizationId: string, representativeId?: string, industryTypeId?: string | null) {
  let query = supabaseAdmin.from('sale_orders').select('*, clients!inner(client_code, client_name, industry_type_id, industry_types(name)), sales_representatives(employee_code, user_profiles(display_name)), sale_order_items(quantity, unit_price, discount_amount, subtotal, products(product_code, product_name))').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100);
  if (representativeId) query = query.eq('representative_id', representativeId);
  if (industryTypeId) query = query.eq('clients.industry_type_id', industryTypeId);
  const { data, error } = await query; return error ? fail(error) : data;
}

export async function cancelOrder(organizationId: string, scope: IndustryScope, id: string, reason?: string | null) {
  const { data: order, error: fetchError } = await supabaseAdmin.from('sale_orders').select('id, status, notes, clients!inner(industry_type_id)').eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (fetchError) fail(fetchError);
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  if (!order) throw notFound;
  assertRecordInScope(scope, (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null, notFound);
  if (order.status === 'cancelled') return order;
  if (order.status === 'completed') throw new AppError(422, 'ORDER_ALREADY_COMPLETED', 'A completed order cannot be cancelled.');
  if (order.status !== 'pending_approval') {
    const orderConfig = await getOrderConfig(organizationId);
    if (!orderConfig.allowCancellation) throw new AppError(422, 'CANCELLATION_DISABLED', 'Order cancellation is turned off in Settings → Order Configuration.');
  }

  const notes = reason?.trim() ? `${order.notes ? order.notes + '\n' : ''}Cancelled: ${reason.trim()}` : order.notes;
  const { data, error } = await supabaseAdmin.from('sale_orders').update({ status: 'cancelled', notes }).eq('id', id).eq('organization_id', organizationId).select().single();
  return error ? fail(error) : data;
}

export async function approveOrder(organizationId: string, scope: IndustryScope, id: string) {
  const { data: order, error: fetchError } = await supabaseAdmin.from('sale_orders').select('id, status, clients!inner(industry_type_id)').eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (fetchError) fail(fetchError);
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  if (!order) throw notFound;
  assertRecordInScope(scope, (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null, notFound);
  if (order.status !== 'pending_approval') throw new AppError(422, 'ORDER_NOT_PENDING_APPROVAL', `A ${order.status} order is not awaiting approval.`);

  const { data, error } = await supabaseAdmin.from('sale_orders').update({ status: 'confirmed' }).eq('id', id).eq('organization_id', organizationId).select().single();
  return error ? fail(error) : data;
}

export async function updateOrder(organizationId: string, scope: IndustryScope, id: string, input: { items?: OrderItem[]; notes?: string | null }) {
  const orderConfig = await getOrderConfig(organizationId);
  if (!orderConfig.allowEditing) throw new AppError(422, 'EDITING_DISABLED', 'Order editing is turned off in Settings → Order Configuration.');

  const { data: order, error: fetchError } = await supabaseAdmin.from('sale_orders').select('id, status, clients!inner(industry_type_id)').eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (fetchError) fail(fetchError);
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  if (!order) throw notFound;
  assertRecordInScope(scope, (order.clients as { industry_type_id?: string | null } | null)?.industry_type_id ?? null, notFound);
  if (order.status === 'cancelled' || order.status === 'completed') throw new AppError(422, 'ORDER_NOT_EDITABLE', `A ${order.status} order cannot be edited.`);

  const update: Record<string, unknown> = {};
  if (input.notes !== undefined) update.notes = input.notes;

  if (input.items) {
    const productIds = input.items.map((item) => item.productId);
    const { data: products, error: productError } = await supabaseAdmin.from('products').select('id, product_code, product_name, selling_price').eq('organization_id', organizationId).eq('status', 'active').in('id', productIds);
    if (productError) fail(productError);
    if ((products ?? []).length !== new Set(productIds).size) throw new AppError(422, 'INVALID_ORDER_PRODUCT', 'One or more selected products are unavailable.');

    const productById = new Map((products ?? []).map((product) => [product.id, product]));
    const lines = input.items.map((item) => { const product = productById.get(item.productId)!; const unitPrice = Number(product.selling_price); const gross = unitPrice * item.quantity; const discountAmount = Math.round(gross * item.discountPercent) / 100; return { product_id: product.id, quantity: item.quantity, unit_price: unitPrice, discount_amount: discountAmount, subtotal: gross - discountAmount }; });
    const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
    const discount = lines.reduce((sum, line) => sum + line.discount_amount, 0);
    if (total < orderConfig.minOrderValue) throw new AppError(422, 'ORDER_BELOW_MINIMUM', `Order total (₹${total}) is below the minimum order value of ₹${orderConfig.minOrderValue} set in Settings.`);

    const { error: deleteError } = await supabaseAdmin.from('sale_order_items').delete().eq('order_id', id);
    if (deleteError) fail(deleteError);
    const { error: lineError } = await supabaseAdmin.from('sale_order_items').insert(lines.map((line) => ({ ...line, order_id: id })));
    if (lineError) fail(lineError);
    update.total_amount = total;
    update.discount_amount = discount;
  }

  if (Object.keys(update).length === 0) return order;

  const { data, error } = await supabaseAdmin.from('sale_orders').update(update).eq('id', id).eq('organization_id', organizationId).select('*, sale_order_items(quantity, unit_price, discount_amount, subtotal, products(product_code, product_name))').single();
  return error ? fail(error) : data;
}