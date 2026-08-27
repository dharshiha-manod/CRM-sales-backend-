import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

const fail = (error: unknown): never => { throw error; };
type OrderItem = { productId: string; quantity: number; discountPercent: number };

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
  const orderNumber = `FS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: order, error: orderError } = await supabaseAdmin.from('sale_orders').insert({ organization_id: organizationId, order_number: orderNumber, visit_id: visit.id, client_id: visit.client_id, representative_id: representativeId, discount_amount: discount, total_amount: total, notes: input.notes, status: 'confirmed' }).select().single();
  if (orderError) fail(orderError);
  const { data: savedLines, error: lineError } = await supabaseAdmin.from('sale_order_items').insert(lines.map((line) => ({ ...line, order_id: order.id }))).select();
  if (lineError) { await supabaseAdmin.from('sale_orders').delete().eq('id', order.id).eq('organization_id', organizationId); fail(lineError); }
  return { ...order, items: savedLines };
}

export async function listOrders(organizationId: string, representativeId?: string) {
  let query = supabaseAdmin.from('sale_orders').select('*, clients(client_code, client_name), sales_representatives(employee_code, user_profiles(display_name)), sale_order_items(quantity, unit_price, discount_amount, subtotal, products(product_code, product_name))').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100);
  if (representativeId) query = query.eq('representative_id', representativeId);
  const { data, error } = await query; return error ? fail(error) : data;
}
