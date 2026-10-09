// Proper shipments for FMCG orders (local AND international clients).
// One order can have many shipments (partial deliveries, several vehicles / containers).
// Other industries never use this; their orders keep dispatch_status 'pending'.
import { AppError } from '../errors/app-error.js';
import { assertRecordInScope, resolveIndustryTypeId, type IndustryScope } from '../lib/industry-scope.js';
import { isFmcgIndustry, marketScopeOf } from '../lib/fmcg-market.js';
import { supabaseAdmin } from '../lib/supabase.js';

const CORE_EXPORT_DOCS: Array<[string, string]> = [['commercial_invoice', 'Commercial invoice'], ['packing_list', 'Packing list'], ['bill_of_lading', 'Bill of lading / airway bill']];
const bad = (message: string) => new AppError(422, 'INVALID_SHIPMENT', message);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

type OrderRow = {
  id: string; status: string; incoterm: string | null; port_of_loading: string | null; port_of_discharge: string | null; export_docs: Record<string, boolean> | null;
  clients: { industry_type_id?: string | null; country_code?: string | null };
  sale_order_items: Array<{ id: string; quantity: number; free_quantity: number | null; products: { product_name?: string | null; product_code?: string | null } | null }>;
};
type ShipmentRow = {
  id: string; shipment_no: string; status: string; transport_ref: string | null; shipped_at: string | null; expected_arrival: string | null; delivered_at: string | null; notes: string | null; created_at: string;
  fmcg_shipment_items: Array<{ order_item_id: string; quantity: number }>;
};

const dateOrNull = (v: unknown, label: string): string | null => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${label} must be a valid date.`);
  return v;
};
const textOrNull = (v: unknown, label: string, max: number): string | null => {
  if (v == null || v === '') return null;
  const t = String(v).trim().replace(/\u0000/g, '');
  if (t.length > max) throw bad(`${label} is too long (max ${max} characters).`);
  return t || null;
};

async function loadOrder(org: string, scope: IndustryScope, orderId: string): Promise<OrderRow> {
  const { data, error } = await supabaseAdmin.from('sale_orders')
    .select('id, status, incoterm, port_of_loading, port_of_discharge, export_docs, clients!inner(industry_type_id, country_code), sale_order_items(id, quantity, free_quantity, products(product_name, product_code))')
    .eq('id', orderId).eq('organization_id', org).maybeSingle();
  if (error) throw new AppError(500, 'SHIPMENT_LOOKUP_FAILED', error.message, error);
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  if (!data) throw notFound;
  const order = data as unknown as OrderRow;
  assertRecordInScope(scope, order.clients?.industry_type_id, notFound);
  if (!(await isFmcgIndustry(org, order.clients?.industry_type_id))) throw new AppError(422, 'NOT_FMCG', 'Shipments are only available for FMCG orders.');
  return order;
}

async function buildView(org: string, order: OrderRow) {
  const { data, error } = await supabaseAdmin.from('fmcg_shipments')
    .select('id, shipment_no, status, transport_ref, shipped_at, expected_arrival, delivered_at, notes, created_at, fmcg_shipment_items(order_item_id, quantity)')
    .eq('organization_id', org).eq('order_id', order.id).order('created_at', { ascending: true });
  if (error) throw new AppError(500, 'SHIPMENT_LIST_FAILED', error.message, error);
  const shipments = (data ?? []) as unknown as ShipmentRow[];
  const live = shipments.filter((s) => s.status !== 'cancelled');
  const qtyIn = (list: ShipmentRow[], itemId: string) => round3(list.reduce((sum, s) => sum + s.fmcg_shipment_items.filter((i) => i.order_item_id === itemId).reduce((a, i) => a + Number(i.quantity), 0), 0));
  const sent = live.filter((s) => s.status === 'dispatched' || s.status === 'delivered');
  const packing = live.filter((s) => s.status === 'packed');
  const lines = order.sale_order_items.map((item) => {
    const ordered = round3(Number(item.quantity) + Number(item.free_quantity ?? 0));
    const shipped = qtyIn(sent, item.id);
    const packed = qtyIn(packing, item.id);
    return { order_item_id: item.id, product_name: item.products?.product_name ?? 'Product', product_code: item.products?.product_code ?? '', ordered, shipped, packed, remaining: round3(ordered - shipped - packed) };
  });
  const nameOf = new Map(lines.map((l) => [l.order_item_id, l.product_name]));
  const totalOrdered = round3(lines.reduce((a, l) => a + l.ordered, 0));
  const totalShipped = round3(lines.reduce((a, l) => a + l.shipped, 0));
  let dispatchStatus = 'pending';
  if (live.length > 0) {
    if (totalShipped <= 0) dispatchStatus = 'packed';
    else if (totalShipped < totalOrdered) dispatchStatus = 'partially_shipped';
    else dispatchStatus = live.every((s) => s.status === 'delivered') ? 'delivered' : 'dispatched';
  }
  return {
    dispatch_status: dispatchStatus, total_ordered: totalOrdered, total_shipped: totalShipped, lines,
    shipments: shipments.map((s) => ({ ...s, fmcg_shipment_items: undefined, items: s.fmcg_shipment_items.map((i) => ({ order_item_id: i.order_item_id, product_name: nameOf.get(i.order_item_id) ?? 'Product', quantity: Number(i.quantity) })) })),
  };
}

async function syncAndView(org: string, order: OrderRow) {
  const view = await buildView(org, order);
  const { error } = await supabaseAdmin.from('sale_orders').update({ dispatch_status: view.dispatch_status }).eq('id', order.id).eq('organization_id', org);
  if (error) throw new AppError(500, 'SHIPMENT_SYNC_FAILED', error.message, error);
  return view;
}

export async function getShipments(org: string, scope: IndustryScope, orderId: string) {
  return buildView(org, await loadOrder(org, scope, orderId));
}

type CreateInput = { items?: unknown; transportRef?: unknown; expectedArrival?: unknown; notes?: unknown };
export async function createShipment(org: string, scope: IndustryScope, userId: string, orderId: string, input: CreateInput) {
  const order = await loadOrder(org, scope, orderId);
  if (order.status !== 'confirmed' && order.status !== 'completed') throw new AppError(422, 'ORDER_NOT_CONFIRMED', 'Shipments can be created only after the order is confirmed (not pending approval or cancelled).');
  if (!Array.isArray(input.items) || input.items.length === 0) throw bad('Add at least one product to the shipment.');
  const current = await buildView(org, order);
  const remainingOf = new Map(current.lines.map((l) => [l.order_item_id, l.remaining]));
  const seen = new Set<string>();
  const items = (input.items as Array<{ orderItemId?: unknown; quantity?: unknown }>).map((raw) => {
    const id = String(raw.orderItemId ?? '');
    const qty = round3(Number(raw.quantity));
    if (!remainingOf.has(id)) throw bad('A product in this shipment does not belong to the order.');
    if (seen.has(id)) throw bad('A product appears twice in this shipment.');
    seen.add(id);
    if (!Number.isFinite(qty) || qty <= 0) throw bad('Shipment quantity must be more than 0.');
    if (qty > (remainingOf.get(id) as number)) throw bad(`Only ${remainingOf.get(id)} unit(s) of a product are left to ship.`);
    return { order_item_id: id, quantity: qty };
  });
  const transport = textOrNull(input.transportRef, 'Vehicle / container number', 80);
  const expected = dateOrNull(input.expectedArrival, 'Expected arrival');
  const notes = textOrNull(input.notes, 'Notes', 500);

  const year = new Date().getFullYear();
  const { count } = await supabaseAdmin.from('fmcg_shipments').select('id', { count: 'exact', head: true }).eq('organization_id', org).like('shipment_no', `SH-${year}-%`);
  let created: { id: string } | null = null;
  for (let attempt = 0; attempt < 6 && !created; attempt += 1) {
    const shipmentNo = `SH-${year}-${String((count ?? 0) + 1 + attempt).padStart(4, '0')}`;
    const { data, error } = await supabaseAdmin.from('fmcg_shipments')
      .insert({ organization_id: org, order_id: orderId, shipment_no: shipmentNo, status: 'packed', transport_ref: transport, expected_arrival: expected, notes, created_by: userId })
      .select('id').single();
    if (!error) { created = data as { id: string }; break; }
    if ((error as { code?: string }).code !== '23505') throw new AppError(500, 'SHIPMENT_CREATE_FAILED', error.message, error);
  }
  if (!created) throw new AppError(500, 'SHIPMENT_NUMBER_FAILED', 'Could not generate a shipment number. Please try again.');
  const { error: itemError } = await supabaseAdmin.from('fmcg_shipment_items').insert(items.map((i) => ({ ...i, shipment_id: created!.id })));
  if (itemError) {
    await supabaseAdmin.from('fmcg_shipments').delete().eq('id', created.id);
    throw new AppError(500, 'SHIPMENT_ITEMS_FAILED', itemError.message, itemError);
  }
  return syncAndView(org, order);
}

type UpdateInput = { status?: unknown; transportRef?: unknown; shippedAt?: unknown; expectedArrival?: unknown; deliveredAt?: unknown; notes?: unknown };
const NEXT: Record<string, string[]> = { packed: ['packed', 'dispatched', 'cancelled'], dispatched: ['dispatched', 'delivered'], delivered: ['delivered'], cancelled: [] };

export async function updateShipment(org: string, scope: IndustryScope, shipmentId: string, input: UpdateInput) {
  const { data, error } = await supabaseAdmin.from('fmcg_shipments')
    .select('id, order_id, status, transport_ref, shipped_at, expected_arrival, delivered_at, notes').eq('id', shipmentId).eq('organization_id', org).maybeSingle();
  if (error) throw new AppError(500, 'SHIPMENT_LOOKUP_FAILED', error.message, error);
  if (!data) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found.');
  const row = data as unknown as { id: string; order_id: string; status: string; transport_ref: string | null; shipped_at: string | null; expected_arrival: string | null; delivered_at: string | null; notes: string | null };
  const order = await loadOrder(org, scope, row.order_id);

  const target = String(input.status ?? row.status);
  if (row.status === 'cancelled') throw bad('A cancelled shipment cannot be changed.');
  if (!(NEXT[row.status] ?? []).includes(target)) {
    if (row.status === 'dispatched' && target === 'cancelled') throw bad('Dispatched goods cannot be cancelled. Record a sales return instead.');
    throw bad(`A ${row.status} shipment cannot be moved to ${target}.`);
  }
  let shipped = input.shippedAt !== undefined ? dateOrNull(input.shippedAt, 'Ship date') : row.shipped_at;
  const expected = input.expectedArrival !== undefined ? dateOrNull(input.expectedArrival, 'Expected arrival') : row.expected_arrival;
  let delivered = input.deliveredAt !== undefined ? dateOrNull(input.deliveredAt, 'Delivered date') : row.delivered_at;
  const transport = input.transportRef !== undefined ? textOrNull(input.transportRef, 'Vehicle / container number', 80) : row.transport_ref;
  const notes = input.notes !== undefined ? textOrNull(input.notes, 'Notes', 500) : row.notes;

  if (target === 'packed') { shipped = null; delivered = null; }
  if (target === 'dispatched') delivered = null;
  if ((target === 'dispatched' || target === 'delivered') && !shipped) throw bad('Enter the ship date.');
  if (target === 'delivered' && !delivered) throw bad('Enter the delivered date.');
  if (shipped && delivered && delivered < shipped) throw bad('Delivered date cannot be before the ship date.');
  if (shipped && expected && expected < shipped) throw bad('Expected arrival cannot be before the ship date.');
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  if ((shipped && shipped > tomorrow) || (delivered && delivered > tomorrow)) throw bad('Ship and delivered dates cannot be in the future.');

  // International shipments need their export paperwork before the goods leave.
  if (target === 'dispatched' && row.status === 'packed' && marketScopeOf(order.clients?.country_code) === 'international') {
    const missing: string[] = [];
    if (!order.incoterm) missing.push('Incoterm');
    if (!order.port_of_loading) missing.push('Port of loading');
    if (!order.port_of_discharge) missing.push('Port of discharge');
    for (const [key, label] of CORE_EXPORT_DOCS) if (!order.export_docs?.[key]) missing.push(label);
    if (missing.length) throw new AppError(422, 'EXPORT_DOCS_INCOMPLETE', `Complete the export details before dispatch. Missing: ${missing.join(', ')}.`);
  }

  const { error: updateError } = await supabaseAdmin.from('fmcg_shipments')
    .update({ status: target, transport_ref: transport, shipped_at: shipped, expected_arrival: expected, delivered_at: delivered, notes })
    .eq('id', shipmentId).eq('organization_id', org);
  if (updateError) throw new AppError(500, 'SHIPMENT_SAVE_FAILED', updateError.message, updateError);
  return syncAndView(org, order);
}

/** Used by order cancel / order-item edit: an order that has live shipments must not lose its lines or stock. */
export async function assertNoActiveShipments(org: string, orderId: string, action: 'cancelled' | 'edited') {
  const { data, error } = await supabaseAdmin.from('fmcg_shipments').select('status').eq('organization_id', org).eq('order_id', orderId).neq('status', 'cancelled');
  if (error) throw new AppError(500, 'SHIPMENT_CHECK_FAILED', error.message, error);
  const live = (data ?? []) as Array<{ status: string }>;
  if (live.length === 0) return;
  if (live.some((s) => s.status === 'dispatched' || s.status === 'delivered')) {
    throw new AppError(422, 'ORDER_HAS_DISPATCHED_SHIPMENTS', `This order has dispatched goods, so it cannot be ${action}. Record a sales return for anything sent back.`);
  }
  throw new AppError(422, 'ORDER_HAS_PACKED_SHIPMENTS', `This order has a packed shipment. Cancel the shipment first, then the order can be ${action}.`);
}

// Payment type (credit / advance / cash on delivery) - saved on the order for FMCG, instead of the browser.
export const PAYMENT_TYPES = ['credit', 'advance', 'cod'] as const;
export async function updatePaymentType(org: string, scope: IndustryScope, id: string, paymentType: unknown) {
  if (typeof paymentType !== 'string' || !(PAYMENT_TYPES as readonly string[]).includes(paymentType)) throw bad(`Payment type must be one of: ${PAYMENT_TYPES.join(', ')}.`);
  const order = await loadOrder(org, scope, id);
  if (order.status === 'cancelled') throw new AppError(422, 'ORDER_CANCELLED', 'A cancelled order cannot be changed.');
  const { data: saved, error } = await supabaseAdmin.from('sale_orders').update({ payment_type: paymentType }).eq('id', id).eq('organization_id', org).select('id, payment_type').single();
  if (error) throw new AppError(500, 'PAYMENT_TYPE_SAVE_FAILED', error.message, error);
  return saved;
}
/** Every shipment of the organization (FMCG), newest first - used by the Shipments page. Industry-scoped like Orders. */
export async function listAllShipments(org: string, scope: IndustryScope) {
  const industryId = resolveIndustryTypeId(scope, null);
  let query = supabaseAdmin.from('fmcg_shipments')
    .select('id, order_id, shipment_no, status, transport_ref, shipped_at, expected_arrival, delivered_at, notes, created_at, fmcg_shipment_items(order_item_id, quantity), sale_orders!inner(order_number, status, clients!inner(client_code, client_name, country_code, industry_type_id), sale_order_items(id, products(product_name, product_code)))')
    .eq('organization_id', org).order('created_at', { ascending: false }).limit(2000);
  if (industryId) query = query.eq('sale_orders.clients.industry_type_id', industryId);
  const { data, error } = await query;
  if (error) throw new AppError(500, 'SHIPMENT_LIST_FAILED', error.message, error);
  type Row = {
    id: string; order_id: string; shipment_no: string; status: string; transport_ref: string | null; shipped_at: string | null; expected_arrival: string | null; delivered_at: string | null; notes: string | null; created_at: string;
    fmcg_shipment_items: Array<{ order_item_id: string; quantity: number }>;
    sale_orders: { order_number: string; status: string; clients: { client_code: string | null; client_name: string; country_code: string | null }; sale_order_items: Array<{ id: string; products: { product_name?: string | null; product_code?: string | null } | null }> };
  };
  return ((data ?? []) as unknown as Row[]).map((s) => {
    const names = new Map(s.sale_orders.sale_order_items.map((i) => [i.id, i.products?.product_name ?? 'Product']));
    const items = s.fmcg_shipment_items.map((i) => ({ product_name: names.get(i.order_item_id) ?? 'Product', quantity: Number(i.quantity) }));
    return {
      id: s.id, order_id: s.order_id, shipment_no: s.shipment_no, status: s.status, transport_ref: s.transport_ref, shipped_at: s.shipped_at, expected_arrival: s.expected_arrival, delivered_at: s.delivered_at, notes: s.notes, created_at: s.created_at,
      order_number: s.sale_orders.order_number, order_status: s.sale_orders.status,
      client_code: s.sale_orders.clients.client_code, client_name: s.sale_orders.clients.client_name,
      market: marketScopeOf(s.sale_orders.clients.country_code),
      total_quantity: round3(items.reduce((a, i) => a + i.quantity, 0)), items,
    };
  });
}