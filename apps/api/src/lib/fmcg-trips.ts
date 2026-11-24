/* eslint-disable @typescript-eslint/no-explicit-any */
// FMCG delivery trips: one vehicle / driver / day carrying many packed shipments (many customers).
//  - Planned: pick packed shipments for the trip.
//  - Dispatch: every packed shipment is dispatched through the normal shipment logic (so e-way bill, advance-payment and
//    export checks still apply). A stop that is blocked stays packed with the reason shown; the rest go out.
//  - Deliver a stop: records who received it and short / damaged units (damage lands on Sales Return & Damage as before,
//    cash-on-delivery is collected automatically). When every stop is delivered the trip completes itself.
//  - Settle: expected COD cash vs expenses vs cash handed over by the driver.
import { AppError } from '../errors/app-error.js';
import { updateShipment } from '../repositories/fmcg-shipment.repository.js';
import type { IndustryScope } from './industry-scope.js';
import { todayLocal } from './ist-date.js';
import { supabaseAdmin } from './supabase.js';

type Row = Record<string, any>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const bad = (msg: string) => new AppError(400, 'VALIDATION_ERROR', msg);
const notFound = () => new AppError(404, 'RECORD_NOT_FOUND', 'Trip was not found.');
const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function pageAll(build: () => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Cash the driver should hold: COD collected on this trip, minus his expenses, minus what he handed over. Positive = short. */
export function cashShortfall(expectedCash: number, expenses: number, handedOver: number): number {
  return r2(expectedCash - expenses - handedOver);
}
/** A trip is done when it has at least one live stop and none of them is still packed / on the road. */
export function tripIsComplete(stopStatuses: string[]): boolean {
  const live = stopStatuses.filter((s) => s !== 'cancelled');
  return live.length > 0 && live.every((s) => s === 'delivered');
}

async function nextTripNo(org: string): Promise<string> {
  const prefix = `TRIP-${todayLocal().slice(0, 4)}-`;
  const { data, error } = await supabaseAdmin.from('fmcg_trips').select('trip_no').eq('organization_id', org).like('trip_no', `${like(prefix)}%`);
  if (error) throw error;
  const max = Math.max(0, ...((data ?? []) as Row[]).map((r) => Number(/(\d+)$/.exec(String(r.trip_no))?.[1] ?? 0)));
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

async function loadTrip(org: string, it: string, id: string): Promise<Row> {
  const { data, error } = await supabaseAdmin.from('fmcg_trips').select('*').eq('organization_id', org).eq('industry_type_id', it).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound();
  return data as Row;
}

const SHIPMENT_SELECT = 'id, shipment_no, status, order_id, trip_id, delivered_at, received_by, fmcg_shipment_items(id, order_item_id, quantity, short_quantity, damaged_quantity), sale_orders(order_number, total_amount, payment_type, clients(client_name, city))';
const one = (v: any) => (Array.isArray(v) ? v[0] : v) ?? null;

async function stopsOf(org: string, tripIds: string[]): Promise<Row[]> {
  if (!tripIds.length) return [];
  const rows = await pageAll(() => supabaseAdmin.from('fmcg_shipments').select(SHIPMENT_SELECT).eq('organization_id', org).in('trip_id', tripIds).order('shipment_no'));
  const itemIds = [...new Set(rows.flatMap((s) => (s.fmcg_shipment_items ?? []).map((i: Row) => String(i.order_item_id))))];
  const names = new Map<string, string>();
  for (let i = 0; i < itemIds.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('sale_order_items').select('id, products(product_name)').in('id', itemIds.slice(i, i + 100));
    if (error) throw error;
    for (const r of (data ?? []) as Row[]) names.set(String(r.id), one(r.products)?.product_name ?? 'Product');
  }
  return rows.map((s) => {
    const order = one(s.sale_orders); const client = one(order?.clients);
    return {
      id: s.id, trip_id: s.trip_id, shipment_no: s.shipment_no, status: s.status, order_id: s.order_id, order_number: order?.order_number ?? null, order_total: num(order?.total_amount), payment_type: order?.payment_type ?? null,
      client_name: client?.client_name ?? '—', city: client?.city ?? null, delivered_at: s.delivered_at ?? null, received_by: s.received_by ?? null,
      items: (s.fmcg_shipment_items ?? []).map((i: Row) => ({ id: i.id, product_name: names.get(String(i.order_item_id)) ?? 'Product', quantity: num(i.quantity), short_quantity: num(i.short_quantity), damaged_quantity: num(i.damaged_quantity) })),
    };
  });
}

/** COD cash collected automatically on delivery for the orders of the delivered stops of one trip. */
async function codCollected(org: string, stops: Row[]): Promise<number> {
  const orderIds = [...new Set(stops.filter((s) => s.status === 'delivered' && s.payment_type === 'cod').map((s) => String(s.order_id)))];
  if (!orderIds.length) return 0;
  const { data, error } = await supabaseAdmin.from('sales_collections').select('amount, notes').eq('organization_id', org).eq('mode', 'cash').in('sale_order_id', orderIds);
  if (error) throw error;
  return r2(((data ?? []) as Row[]).filter((c) => String(c.notes ?? '').startsWith('Cash on delivery')).reduce((s, c) => s + num(c.amount), 0));
}

export async function listTrips(org: string, it: string) {
  const trips = await pageAll(() => supabaseAdmin.from('fmcg_trips').select('*').eq('organization_id', org).eq('industry_type_id', it).order('created_at', { ascending: false }).order('id'));
  const stops = await stopsOf(org, trips.map((t) => String(t.id)));
  return trips.map((t) => {
    const mine = stops.filter((s) => s.trip_id === t.id);
    return { ...t, stop_count: mine.length, delivered_count: mine.filter((s) => s.status === 'delivered').length, value: r2(mine.reduce((a, s) => a + s.order_total, 0)) };
  });
}

export async function getTrip(org: string, it: string, id: string) {
  const trip = await loadTrip(org, it, id);
  const stops = await stopsOf(org, [id]);
  const expected = await codCollected(org, stops);
  return { ...trip, stops, cod_expected: expected, shortfall: cashShortfall(expected, num(trip.expenses), num(trip.cash_handed_over)) };
}

export async function availableShipments(org: string, it: string) {
  const rows = await pageAll(() => supabaseAdmin.from('fmcg_shipments').select(`${SHIPMENT_SELECT.replace('sale_orders(', 'sale_orders!inner(').replace('clients(', 'clients!inner(industry_type_id, ')}`).eq('organization_id', org).eq('status', 'packed').is('trip_id', null).eq('sale_orders.clients.industry_type_id', it).order('shipment_no'));
  return rows.map((s) => {
    const order = one(s.sale_orders); const client = one(order?.clients);
    return { id: s.id, shipment_no: s.shipment_no, order_number: order?.order_number ?? null, order_total: num(order?.total_amount), payment_type: order?.payment_type ?? null, client_name: client?.client_name ?? '—', city: client?.city ?? null, units: r2((s.fmcg_shipment_items ?? []).reduce((a: number, i: Row) => a + num(i.quantity), 0)) };
  });
}

function detailsPayload(b: Row): Row {
  const out: Row = {};
  if ('trip_date' in b) { if (!isDate(b.trip_date)) throw bad('Trip date is not valid.'); out.trip_date = b.trip_date; }
  for (const k of ['route_name', 'vehicle_no', 'driver_name', 'driver_phone', 'notes']) if (k in b) out[k] = str(b[k]) || null;
  if (out.driver_phone && !/^\+?[0-9 -]{7,16}$/.test(String(out.driver_phone))) throw bad('Driver phone must be a valid phone number.');
  if (out.vehicle_no) out.vehicle_no = String(out.vehicle_no).toUpperCase();
  return out;
}

export async function createTrip(org: string, it: string, userId: string | null, body: Row) {
  const p = detailsPayload({ trip_date: todayLocal(), ...body });
  if (!p.vehicle_no) throw bad('Enter the vehicle number.');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabaseAdmin.from('fmcg_trips').insert({ ...p, organization_id: org, industry_type_id: it, trip_no: await nextTripNo(org), status: 'planned', created_by: userId }).select().single();
    if (!error) {
      const ids = Array.isArray(body.shipment_ids) ? body.shipment_ids.map(String) : [];
      if (ids.length) { try { await addStops(org, it, String((data as Row).id), ids); } catch (e) { await supabaseAdmin.from('fmcg_trips').delete().eq('id', (data as Row).id); throw e; } }
      return getTrip(org, it, String((data as Row).id));
    }
    if ((error as { code?: string }).code !== '23505') throw error;
  }
  throw new AppError(409, 'DUPLICATE_RECORD', 'Could not allocate a trip number. Please try again.');
}

export async function updateTrip(org: string, it: string, id: string, body: Row) {
  const trip = await loadTrip(org, it, id);
  if (trip.status !== 'planned') throw bad('Only a planned trip can be edited.');
  const p = detailsPayload(body);
  if (!Object.keys(p).length) throw bad('Nothing to change.');
  if ('vehicle_no' in p && !p.vehicle_no) throw bad('Enter the vehicle number.');
  const { error } = await supabaseAdmin.from('fmcg_trips').update({ ...p, updated_at: new Date().toISOString() }).eq('organization_id', org).eq('id', id);
  if (error) throw error;
  return getTrip(org, it, id);
}

export async function cancelTrip(org: string, it: string, id: string) {
  const trip = await loadTrip(org, it, id);
  if (trip.status !== 'planned') throw bad('Only a planned trip can be cancelled. A trip that has left must be completed.');
  await supabaseAdmin.from('fmcg_shipments').update({ trip_id: null }).eq('organization_id', org).eq('trip_id', id);
  const { error } = await supabaseAdmin.from('fmcg_trips').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('organization_id', org).eq('id', id);
  if (error) throw error;
  return getTrip(org, it, id);
}

async function addStops(org: string, it: string, tripId: string, shipmentIds: string[]) {
  const ids = [...new Set(shipmentIds)];
  if (!ids.length) throw bad('Select at least one shipment.');
  const { data, error } = await supabaseAdmin.from('fmcg_shipments').select('id, shipment_no, status, trip_id, sale_orders!inner(clients!inner(industry_type_id))').eq('organization_id', org).in('id', ids);
  if (error) throw error;
  const found = (data ?? []) as Row[];
  if (found.length !== ids.length) throw bad('A selected shipment was not found.');
  for (const s of found) {
    if (one(one(s.sale_orders)?.clients)?.industry_type_id !== it) throw bad(`${s.shipment_no} does not belong to this industry.`);
    if (s.status !== 'packed') throw bad(`${s.shipment_no} is ${s.status}. Only packed shipments can be put on a trip.`);
    if (s.trip_id && s.trip_id !== tripId) throw bad(`${s.shipment_no} is already on another trip.`);
  }
  const { error: upErr } = await supabaseAdmin.from('fmcg_shipments').update({ trip_id: tripId }).eq('organization_id', org).in('id', ids).is('trip_id', null);
  if (upErr) throw upErr;
}

export async function addShipmentsToTrip(org: string, it: string, id: string, shipmentIds: string[]) {
  const trip = await loadTrip(org, it, id);
  if (trip.status !== 'planned') throw bad('Shipments can only be added to a planned trip.');
  await addStops(org, it, id, shipmentIds);
  return getTrip(org, it, id);
}

export async function removeShipmentFromTrip(org: string, it: string, id: string, shipmentId: string) {
  const trip = await loadTrip(org, it, id);
  if (trip.status !== 'planned') throw bad('A stop can only be removed from a planned trip.');
  const { error } = await supabaseAdmin.from('fmcg_shipments').update({ trip_id: null }).eq('organization_id', org).eq('trip_id', id).eq('id', shipmentId).eq('status', 'packed');
  if (error) throw error;
  return getTrip(org, it, id);
}

/** Dispatches every packed stop. Blocked stops stay packed (the reason is returned); the trip leaves if at least one stop went out. */
export async function dispatchTrip(org: string, scope: IndustryScope, it: string, userId: string, id: string) {
  const trip = await loadTrip(org, it, id);
  if (trip.status !== 'planned' && trip.status !== 'dispatched') throw bad(`A ${trip.status} trip cannot be dispatched.`);
  const stops = (await stopsOf(org, [id])).filter((s) => s.status === 'packed');
  if (!stops.length) throw bad(trip.status === 'planned' ? 'Add at least one packed shipment before dispatching.' : 'No packed stops are left on this trip.');
  const today = todayLocal(); const shippedAt = String(trip.trip_date).slice(0, 10) <= today ? String(trip.trip_date).slice(0, 10) : today;
  const results: Array<{ shipment_no: string; ok: boolean; message?: string }> = [];
  for (const s of stops) {
    try {
      await updateShipment(org, scope, String(s.id), { status: 'dispatched', shippedAt, transportRef: trip.vehicle_no, driverName: trip.driver_name, driverPhone: trip.driver_phone }, userId);
      results.push({ shipment_no: s.shipment_no, ok: true });
    } catch (e) { results.push({ shipment_no: s.shipment_no, ok: false, message: e instanceof Error ? e.message : 'Could not dispatch.' }); }
  }
  if (!results.some((r) => r.ok)) throw new AppError(422, 'TRIP_DISPATCH_BLOCKED', `Nothing could be dispatched. ${results.map((r) => `${r.shipment_no}: ${r.message}`).join(' ')}`);
  if (trip.status === 'planned') await supabaseAdmin.from('fmcg_trips').update({ status: 'dispatched', dispatched_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('organization_id', org).eq('id', id);
  return { trip: await getTrip(org, it, id), results };
}

export async function deliverStop(org: string, scope: IndustryScope, it: string, userId: string, id: string, shipmentId: string, body: Row) {
  const trip = await loadTrip(org, it, id);
  if (trip.status !== 'dispatched') throw bad('Stops can only be delivered while the trip is on the road.');
  const stop = (await stopsOf(org, [id])).find((s) => s.id === shipmentId);
  if (!stop) throw bad('That shipment is not on this trip.');
  if (stop.status !== 'dispatched') throw bad(`${stop.shipment_no} is ${stop.status}; only a dispatched stop can be delivered.`);
  const deliveredAt = str(body.delivered_at) || todayLocal();
  if (!isDate(deliveredAt)) throw bad('Delivered date is not valid.');
  const receipt = (Array.isArray(body.receipt) ? body.receipt : []).map((r: Row) => ({ itemId: r.item_id, shortQuantity: num(r.short_quantity), damagedQuantity: num(r.damaged_quantity) }));
  await updateShipment(org, scope, shipmentId, { status: 'delivered', deliveredAt, receivedBy: str(body.received_by) || null, receipt }, userId);
  const after = await stopsOf(org, [id]);
  if (tripIsComplete(after.map((s) => s.status))) await supabaseAdmin.from('fmcg_trips').update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('organization_id', org).eq('id', id).eq('status', 'dispatched');
  return getTrip(org, it, id);
}

export async function settleTrip(org: string, it: string, id: string, body: Row) {
  const trip = await loadTrip(org, it, id);
  if (trip.status !== 'completed') throw bad('A trip can be settled once every stop is delivered.');
  const read = (v: unknown, label: string) => { const n = v === '' || v == null ? 0 : Number(v); if (Number.isNaN(n) || n < 0) throw bad(`${label} cannot be negative.`); return r2(n); };
  const { error } = await supabaseAdmin.from('fmcg_trips').update({ expenses: read(body.expenses, 'Expenses'), cash_handed_over: read(body.cash_handed_over, 'Cash handed over'), settlement_notes: str(body.settlement_notes) || null, settled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('organization_id', org).eq('id', id);
  if (error) throw error;
  return getTrip(org, it, id);
}