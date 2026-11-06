// Vehicle reports (Step 4): one overview for the Vehicle Insights screen, a health check that finds broken links in
// the Lead -> Test drive -> Booking -> Delivery -> After-sales chain, and a safe "repair" that re-runs the automation
// for whatever was missed (older records, an API that was down). Vehicle only; read-mostly; every repair is idempotent.
import { supabaseAdmin } from '../lib/supabase.js';
import { todayLocal } from '../lib/ist-date.js';
import { allocatePendingBookings, onBookingAllocated, onVehicleOrderCreated, syncModelProduct } from '../lib/vehicle-links.js';
import { runVehicleAftersales, type AftersalesResult } from './vehicle-aftersales.service.js';
import { parseLabourAmount, parsePartsUsed } from '../lib/vehicle-calc.js';
import { vehicleSchemeUsage } from '../lib/vehicle-schemes.js';

type Row = Record<string, unknown>;
const has = (v: unknown) => v !== null && v !== undefined && v !== '';
const num = (v: unknown) => (has(v) ? Number(v) || 0 : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const r2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
const HELD = ['Reserved', 'Booked', 'Allocated'];
const PENDING_BOOKING = ['Allocation Pending', 'Reserved', 'Confirmed'];
const UNIT_FOR_BOOKING: Record<string, string> = { Reserved: 'Reserved', Confirmed: 'Reserved', 'Vehicle Allocated': 'Allocated', 'Converted to Order': 'Booked' };
const LIMIT = 5000;

async function rows(table: string, org: string, ind: string, cols = '*', extra?: (q: any) => any): Promise<Row[]> {
  let q: any = supabaseAdmin.from(table).select(cols).eq('organization_id', org).eq('industry_type_id', ind).limit(LIMIT);
  if (extra) q = extra(q);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Row[];
}
const countBy = (list: Row[], key: string) => {
  const out: Record<string, number> = {};
  for (const r of list) { const k = str(r[key]) || 'Unknown'; out[k] = (out[k] ?? 0) + 1; }
  return out;
};
const daysSince = (iso: unknown) => (has(iso) ? Math.max(0, Math.floor((Date.now() - Date.parse(String(iso))) / DAY)) : 0);
const daysTo = (iso: unknown) => Math.round((Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) - Date.parse(`${todayLocal()}T00:00:00Z`)) / DAY);
const pct = (a: number, b: number) => (b > 0 ? r2((a / b) * 100) : 0);

// ================================================================ overview
export async function vehicleOverview(org: string, ind: string, days = 90) {
  const windowDays = Math.min(Math.max(Math.round(days) || 90, 7), 730);
  const since = new Date(Date.now() - windowDays * DAY).toISOString();
  const inWindow = (q: any) => q.gte('created_at', since);

  const orderQ = supabaseAdmin.from('sale_orders').select('id, total_amount, base_total, status, created_at, clients!inner(industry_type_id)').eq('organization_id', org).eq('clients.industry_type_id', ind).gte('created_at', since).limit(LIMIT);
  const collQ = supabaseAdmin.from('sales_collections').select('amount, clients!inner(industry_type_id)').eq('organization_id', org).eq('clients.industry_type_id', ind).gte('collected_at', since).limit(LIMIT);
  const [units, models, leads, drives, bookings, deliveries, finance, exchanges, services, policies, warranties, returns, orders, collections] = await Promise.all([
    rows('vehicle_units', org, ind, 'id, vin, model_id, model_name, status, purchase_cost, selling_price, created_at'),
    rows('vehicle_models', org, ind, 'id, model_name, variant, status'),
    rows('leads', org, ind, 'id, status, created_at', inWindow),
    rows('vehicle_test_drives', org, ind, 'id, status, created_at', inWindow),
    rows('vehicle_bookings', org, ind, 'id, status, vin, model_id, model_name, booking_amount, created_at'),
    rows('vehicle_deliveries', org, ind, 'id, status, pdi_status, documentation_status, payment_status, delivery_date, created_at'),
    rows('vehicle_finance_applications', org, ind, 'status, loan_amount, approved_amount, disbursed_amount, pending_amount'),
    rows('vehicle_exchanges', org, ind, 'status, approved_value, net_exchange_value'),
    rows('vehicle_service_records', org, ind, 'status, service_date, service_cost, service_type'),
    rows('vehicle_insurance_policies', org, ind, 'status, expiry_date, premium, vin'),
    rows('vehicle_warranties', org, ind, 'status, end_date'),
    rows('vehicle_returns', org, ind, 'status, return_type, refund_amount'),
    orderQ, collQ,
  ]);
  for (const res of [orders, collections]) if (res.error) throw res.error;
  const orderRows = ((orders.data ?? []) as unknown as Row[]).filter((o) => !['cancelled', 'pending_approval'].includes(str(o.status)));
  const collectionRows = (collections.data ?? []) as unknown as Row[];
  const today = todayLocal();

  // ---- stock
  const stockStatus = countBy(units, 'status');
  const sellable = units.filter((u) => u.status === 'Available');
  const ageing = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const u of sellable) { const d = daysSince(u.created_at); ageing[d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+'] += 1; }
  const waiting = bookings.filter((b) => !has(b.vin) && PENDING_BOOKING.includes(str(b.status)));
  const byModel = new Map<string, { model: string; available: number; held: number; waiting: number }>();
  const slot = (id: unknown, name: unknown) => { const k = str(id) || str(name) || 'Unknown'; if (!byModel.has(k)) byModel.set(k, { model: str(name) || k, available: 0, held: 0, waiting: 0 }); return byModel.get(k)!; };
  for (const m of models) slot(m.id, [m.model_name, m.variant].filter(has).join(' '));
  for (const u of units) { const s = slot(u.model_id, u.model_name); if (u.status === 'Available') s.available += 1; else if (HELD.includes(str(u.status))) s.held += 1; }
  for (const b of waiting) slot(b.model_id, b.model_name).waiting += 1;
  const modelRows = [...byModel.values()].map((m) => ({ ...m, shortage: Math.max(0, m.waiting - m.available) })).sort((a, b) => b.waiting - a.waiting || b.available - a.available);
  const oldestWait = waiting.reduce((max, b) => Math.max(max, daysSince(b.created_at)), 0);

  // ---- funnel (window)
  const winBookings = bookings.filter((b) => Date.parse(str(b.created_at)) >= Date.parse(since));
  const winDeliveries = deliveries.filter((d) => Date.parse(str(d.created_at)) >= Date.parse(since));
  const delivered = winDeliveries.filter((d) => d.status === 'Delivered').length;
  const funnel = {
    leads: leads.length, qualifiedLeads: leads.filter((l) => ['qualified', 'converted'].includes(str(l.status))).length,
    testDrives: drives.length, completedTestDrives: drives.filter((d) => d.status === 'Completed').length,
    bookings: winBookings.filter((b) => b.status !== 'Cancelled').length, deliveries: winDeliveries.filter((d) => d.status !== 'Cancelled').length, delivered,
    rates: { leadToTestDrive: pct(drives.length, leads.length), testDriveToBooking: pct(winBookings.length, drives.length), bookingToDelivered: pct(delivered, winBookings.filter((b) => b.status !== 'Cancelled').length) },
  };

  // ---- delivery pipeline
  const open = deliveries.filter((d) => !['Delivered', 'Cancelled'].includes(str(d.status)));
  const pipeline = {
    byStatus: countBy(deliveries, 'status'),
    blocked: { pdi: open.filter((d) => d.pdi_status !== 'Passed').length, documentation: open.filter((d) => d.documentation_status !== 'Complete').length, payment: open.filter((d) => d.payment_status !== 'Complete').length },
    readyToHandOver: open.filter((d) => d.status === 'Ready for Delivery').length,
  };

  // ---- money
  const sales = { orders: orderRows.length, revenue: r2(orderRows.reduce((s, o) => s + num(o.base_total ?? o.total_amount), 0)), collected: r2(collectionRows.reduce((s, c) => s + num(c.amount), 0)) };
  const loanStatuses = finance.filter((f) => f.status !== 'Not Required');
  const financeSummary = { byStatus: countBy(finance, 'status'), applied: r2(loanStatuses.reduce((s, f) => s + num(f.loan_amount), 0)), approved: r2(finance.reduce((s, f) => s + num(f.approved_amount), 0)), disbursed: r2(finance.reduce((s, f) => s + num(f.disbursed_amount), 0)), pending: r2(finance.reduce((s, f) => s + num(f.pending_amount), 0)) };
  const approvedEx = exchanges.filter((e) => ['Approved', 'Converted'].includes(str(e.status)));
  const exchangeSummary = { byStatus: countBy(exchanges, 'status'), approvedValue: r2(approvedEx.reduce((s, e) => s + num(e.approved_value), 0)), netValue: r2(approvedEx.reduce((s, e) => s + num(e.net_exchange_value ?? e.approved_value), 0)) };

  // ---- after-sales
  const scheduled = services.filter((s) => s.status === 'Scheduled' && has(s.service_date));
  const completedInWindow = services.filter((s) => s.status === 'Completed' && has(s.service_date) && -daysTo(s.service_date) <= windowDays);
  const afterSales = {
    services: { byStatus: countBy(services, 'status'), overdue: scheduled.filter((s) => daysTo(s.service_date) < 0).length, next7Days: scheduled.filter((s) => daysTo(s.service_date) >= 0 && daysTo(s.service_date) <= 7).length, revenue: r2(completedInWindow.reduce((s, x) => s + num(x.service_cost), 0)) },
    insurance: { byStatus: countBy(policies, 'status'), expiring30: policies.filter((p) => ['Active', 'Expiring Soon'].includes(str(p.status)) && has(p.expiry_date) && daysTo(p.expiry_date) >= 0 && daysTo(p.expiry_date) <= 30).length, expired: policies.filter((p) => p.status === 'Expired').length, premiumActive: r2(policies.filter((p) => ['Active', 'Expiring Soon'].includes(str(p.status))).reduce((s, p) => s + num(p.premium), 0)) },
    warranty: { byStatus: countBy(warranties, 'status'), expiring30: warranties.filter((w) => ['Active', 'Expiring Soon'].includes(str(w.status)) && has(w.end_date) && daysTo(w.end_date) >= 0 && daysTo(w.end_date) <= 30).length },
    returns: { byStatus: countBy(returns, 'status'), refunded: r2(returns.reduce((s, r) => s + num(r.refund_amount), 0)) },
  };

  return {
    generatedAt: new Date().toISOString(), today, windowDays,
    stock: { total: units.length, byStatus: stockStatus, available: sellable.length, ageing, stockValue: r2(sellable.reduce((s, u) => s + num(u.purchase_cost), 0)), potentialValue: r2(sellable.reduce((s, u) => s + num(u.selling_price), 0)), byModel: modelRows },
    bookings: { byStatus: countBy(bookings, 'status'), waitingForVehicle: waiting.length, oldestWaitDays: oldestWait, advanceAmount: r2(bookings.filter((b) => b.status !== 'Cancelled').reduce((s, b) => s + num(b.booking_amount), 0)) },
    funnel, pipeline, sales, finance: financeSummary, exchange: exchangeSummary, afterSales,
  };
}

// ================================================================ health check (find gaps)
export interface HealthCheck { key: string; label: string; count: number; fixable: boolean; samples: string[] }
const check = (key: string, label: string, list: string[], fixable: boolean): HealthCheck => ({ key, label, count: list.length, fixable, samples: list.slice(0, 5) });

interface Gaps {
  modelsNoProduct: Row[]; ordersNoBooking: Row[]; allocatedNoDelivery: Row[]; waitingWithStock: Row[]; orphanHolds: Row[]; bookingUnitMismatch: { vin: string; want: string; booking: string }[];
  deliveredNoRegistration: Row[]; deliveredNoWarranty: Row[]; deliveredUnitNotDelivered: Row[]; noClient: string[]; deliveredNoInsurance: Row[];
}

async function findGaps(org: string, ind: string): Promise<Gaps> {
  const [models, units, bookings, deliveries, registrations, warranties, policies, drives] = await Promise.all([
    rows('vehicle_models', org, ind, 'id, model_code, model_name, variant, make, brand, model_year, fuel_type, transmission, body_type, vehicle_category, vehicle_type, recommended_selling_price, ex_showroom_price, status, product_id, industry_type_id'),
    rows('vehicle_units', org, ind, 'id, vin, model_id, status'),
    rows('vehicle_bookings', org, ind, '*'),
    rows('vehicle_deliveries', org, ind, '*'),
    rows('vehicle_registrations', org, ind, 'vin'),
    rows('vehicle_warranties', org, ind, 'vin'),
    rows('vehicle_insurance_policies', org, ind, 'vin, status'),
    rows('vehicle_test_drives', org, ind, 'test_drive_number, client_id'),
  ]);
  const modelsNoProduct = models.filter((m) => !has(m.product_id));

  // orders of Vehicle clients that carry a vehicle model but have no booking
  const productToModel = new Set(models.filter((m) => has(m.product_id)).map((m) => str(m.product_id)));
  const { data: orderData, error } = await supabaseAdmin.from('sale_orders').select('id, order_number, status, clients!inner(industry_type_id), sale_order_items(product_id, quantity)').eq('organization_id', org).eq('clients.industry_type_id', ind).in('status', ['confirmed', 'completed']).order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  const bookingsByOrder = new Map<string, number>();
  for (const b of bookings) if (has(b.order_id)) bookingsByOrder.set(str(b.order_id), (bookingsByOrder.get(str(b.order_id)) ?? 0) + 1);
  const ordersNoBooking = ((orderData ?? []) as unknown as Row[]).filter((o) => {
    const lines = ((o.sale_order_items ?? []) as Row[]).filter((i) => productToModel.has(str(i.product_id)));
    return lines.length > 0 && !bookingsByOrder.has(str(o.id));
  });

  const liveDeliveries = deliveries.filter((d) => d.status !== 'Cancelled');
  const deliveryBookings = new Set(liveDeliveries.map((d) => str(d.booking_number)).filter(Boolean));
  const deliveryVins = new Set(liveDeliveries.map((d) => str(d.vin)).filter(Boolean));
  const allocatedNoDelivery = bookings.filter((b) => ['Vehicle Allocated', 'Converted to Order'].includes(str(b.status)) && has(b.vin) && !deliveryBookings.has(str(b.booking_number)) && !deliveryVins.has(str(b.vin)));

  const availableByModel = new Map<string, number>();
  for (const u of units) if (u.status === 'Available') availableByModel.set(str(u.model_id), (availableByModel.get(str(u.model_id)) ?? 0) + 1);
  const waitingWithStock = bookings.filter((b) => !has(b.vin) && PENDING_BOOKING.includes(str(b.status)) && has(b.model_id) && (availableByModel.get(str(b.model_id)) ?? 0) > 0);

  const activeHolds = new Map<string, string>(); // vin -> booking status
  for (const b of bookings) if (has(b.vin) && UNIT_FOR_BOOKING[str(b.status)]) activeHolds.set(str(b.vin), str(b.status));
  const orphanHolds = units.filter((u) => HELD.includes(str(u.status)) && !activeHolds.has(str(u.vin)));
  const bookingUnitMismatch: Gaps['bookingUnitMismatch'] = [];
  const unitByVin = new Map(units.map((u) => [str(u.vin), u]));
  for (const b of bookings) {
    const want = UNIT_FOR_BOOKING[str(b.status)];
    const u = has(b.vin) ? unitByVin.get(str(b.vin)) : undefined;
    if (want && u && ['Available', 'Received', 'PDI Pending'].includes(str(u.status))) bookingUnitMismatch.push({ vin: str(b.vin), want, booking: str(b.booking_number) });
  }

  const deliveredList = deliveries.filter((d) => d.status === 'Delivered' && has(d.vin));
  const regVins = new Set(registrations.map((r) => str(r.vin)));
  const warVins = new Set(warranties.map((w) => str(w.vin)));
  const insVins = new Set(policies.filter((p) => ['Active', 'Expiring Soon'].includes(str(p.status))).map((p) => str(p.vin)));
  const deliveredNoRegistration = deliveredList.filter((d) => !regVins.has(str(d.vin)));
  const deliveredNoWarranty = deliveredList.filter((d) => !warVins.has(str(d.vin)));
  const deliveredUnitNotDelivered = deliveredList.filter((d) => { const u = unitByVin.get(str(d.vin)); return u && !['Delivered', 'Under Service', 'Returned', 'Sold'].includes(str(u.status)); });
  const deliveredNoInsurance = deliveredList.filter((d) => d.insurance_status !== 'Not Applicable' && !insVins.has(str(d.vin)));

  const noClient = [
    ...bookings.filter((b) => !has(b.client_id) && b.status !== 'Cancelled').map((b) => `Booking ${str(b.booking_number)}`),
    ...deliveries.filter((d) => !has(d.client_id) && d.status !== 'Cancelled').map((d) => `Delivery ${str(d.delivery_number)}`),
    ...drives.filter((d) => !has(d.client_id)).map((d) => `Test drive ${str(d.test_drive_number)}`),
  ];
  return { modelsNoProduct, ordersNoBooking, allocatedNoDelivery, waitingWithStock, orphanHolds, bookingUnitMismatch, deliveredNoRegistration, deliveredNoWarranty, deliveredUnitNotDelivered, noClient, deliveredNoInsurance };
}

export async function vehicleHealth(org: string, ind: string): Promise<{ checkedAt: string; ok: boolean; checks: HealthCheck[] }> {
  const g = await findGaps(org, ind);
  const checks: HealthCheck[] = [
    check('models_without_product', 'Vehicle models with no Product (cannot be quoted)', g.modelsNoProduct.map((m) => str(m.model_code)), true),
    check('orders_without_booking', 'Confirmed vehicle orders with no booking', g.ordersNoBooking.map((o) => str(o.order_number)), true),
    check('allocated_without_delivery', 'Allocated bookings with no delivery file', g.allocatedNoDelivery.map((b) => str(b.booking_number)), true),
    check('waiting_with_stock', 'Bookings waiting for a vehicle although stock is available', g.waitingWithStock.map((b) => str(b.booking_number)), true),
    check('orphan_holds', 'Vehicles held (Reserved / Booked / Allocated) by no booking', g.orphanHolds.map((u) => str(u.vin)), true),
    check('booking_unit_mismatch', 'Booked vehicles whose stock status does not show the hold', g.bookingUnitMismatch.map((m) => `${m.vin} (${m.booking})`), true),
    check('delivered_no_registration', 'Delivered vehicles with no registration file', g.deliveredNoRegistration.map((d) => str(d.vin)), true),
    check('delivered_no_warranty', 'Delivered vehicles with no warranty', g.deliveredNoWarranty.map((d) => str(d.vin)), true),
    check('delivered_unit_not_delivered', 'Delivered vehicles still shown as in stock', g.deliveredUnitNotDelivered.map((d) => str(d.vin)), true),
    check('records_without_client', 'Bookings / deliveries / test drives not linked to a Client', g.noClient, false),
    check('delivered_no_insurance', 'Delivered vehicles with no active insurance policy', g.deliveredNoInsurance.map((d) => str(d.vin)), false),
  ];
  try { // spare parts at or below their reorder level (needs the step-5 SQL; skipped quietly without it)
    const { data: parts } = await supabaseAdmin.from('vehicle_parts').select('part_code, stock_quantity, reorder_level').eq('organization_id', org).eq('industry_type_id', ind).eq('status', 'Active').not('reorder_level', 'is', null).limit(LIMIT);
    const low = ((parts ?? []) as Row[]).filter((p) => num(p.stock_quantity) <= num(p.reorder_level)).map((p) => `${str(p.part_code)} (${num(p.stock_quantity)} left)`);
    checks.push(check('parts_low_stock', 'Spare parts at or below reorder level', low, false));
  } catch { /* parts table not created yet */ }
  return { checkedAt: new Date().toISOString(), ok: checks.every((c) => c.count === 0), checks };
}

// ================================================================ repair
export interface RepairResult { fixed: Record<string, number>; afterSales: AftersalesResult; health: Awaited<ReturnType<typeof vehicleHealth>> }

/** Re-runs the automation for what was missed. `onDelivered` is the route's own helper (registration + warranty on handover). */
export async function vehicleRepair(org: string, ind: string, onDelivered: (org: string, ind: string, delivery: Row) => Promise<void>): Promise<RepairResult> {
  const g = await findGaps(org, ind);
  const fixed: Record<string, number> = {};
  const bump = (k: string) => { fixed[k] = (fixed[k] ?? 0) + 1; };

  for (const m of g.modelsNoProduct) { await syncModelProduct(org, ind, m); bump('models_linked_to_products'); }
  for (const o of g.ordersNoBooking) { await onVehicleOrderCreated(org, str(o.id)); bump('orders_booked'); }
  // stock status first, so allocation below sees the truth
  for (const u of g.orphanHolds) { await supabaseAdmin.from('vehicle_units').update({ status: 'Available' }).eq('id', u.id as string).in('status', HELD); bump('orphan_holds_released'); }
  for (const m of g.bookingUnitMismatch) { await supabaseAdmin.from('vehicle_units').update({ status: m.want }).eq('organization_id', org).eq('industry_type_id', ind).eq('vin', m.vin).in('status', ['Available', 'Received', 'PDI Pending']); bump('unit_status_fixed'); }
  for (const d of g.deliveredUnitNotDelivered) { await supabaseAdmin.from('vehicle_units').update({ status: 'Delivered' }).eq('organization_id', org).eq('industry_type_id', ind).eq('vin', str(d.vin)); bump('delivered_units_fixed'); }
  const models = new Set(g.waitingWithStock.map((b) => str(b.model_id)));
  for (const id of models) { await allocatePendingBookings(org, ind, id); bump('waiting_models_allocated'); }
  for (const b of g.allocatedNoDelivery) { await onBookingAllocated(org, ind, b); bump('delivery_files_opened'); }
  const seen = new Set<string>();
  for (const d of [...g.deliveredNoRegistration, ...g.deliveredNoWarranty]) {
    if (seen.has(str(d.vin))) continue;
    seen.add(str(d.vin));
    await onDelivered(org, ind, d); bump('delivered_files_completed');
  }
  const afterSales = await runVehicleAftersales(org, ind);
  return { fixed, afterSales, health: await vehicleHealth(org, ind) };
} 

// ================================================================ reports (model / dealer sales, stock ageing, service revenue, stock vs Products)
const IN_STOCK = ['In Transit', 'Received', 'PDI Pending', 'Available', 'Reserved', 'Booked', 'Allocated', 'Demo'];
export async function vehicleReports(org: string, ind: string, days = 90) {
  const windowDays = Math.min(Math.max(Math.round(days) || 90, 7), 730);
  const sinceDate = new Date(Date.now() - windowDays * DAY).toISOString().slice(0, 10);
  const [units, models, deliveries, services] = await Promise.all([
    rows('vehicle_units', org, ind, 'vin, model_id, model_name, status, selling_price, purchase_cost, dealer_name, created_at'),
    rows('vehicle_models', org, ind, 'id, model_name, variant, product_id'),
    rows('vehicle_deliveries', org, ind, 'vin, dealer_name, delivery_date, status', (q: any) => q.eq('status', 'Delivered').gte('delivery_date', sinceDate)),
    rows('vehicle_service_records', org, ind, 'service_type, service_date, service_cost, status', (q: any) => q.eq('status', 'Completed').gte('service_date', sinceDate)),
  ]);
  const unitByVin = new Map(units.map((u) => [str(u.vin), u]));

  const byModel = new Map<string, { model: string; delivered: number; revenue: number }>();
  const byDealer = new Map<string, { dealer: string; delivered: number; revenue: number }>();
  for (const d of deliveries) {
    const u = unitByVin.get(str(d.vin));
    const price = u ? num(u.selling_price) : 0;
    const m = str(u?.model_name) || 'Unknown'; const dl = str(d.dealer_name) || str(u?.dealer_name) || 'No dealer';
    const a = byModel.get(m) ?? { model: m, delivered: 0, revenue: 0 }; a.delivered += 1; a.revenue += price; byModel.set(m, a);
    const b = byDealer.get(dl) ?? { dealer: dl, delivered: 0, revenue: 0 }; b.delivered += 1; b.revenue += price; byDealer.set(dl, b);
  }

  const buckets = { '0-30 days': 0, '31-60 days': 0, '61-90 days': 0, '90+ days': 0 };
  const oldest: { vin: string; model: string; days: number; status: string }[] = [];
  let stockValue = 0;
  for (const u of units.filter((x) => IN_STOCK.includes(str(x.status)))) {
    const age = daysSince(u.created_at);
    buckets[age <= 30 ? '0-30 days' : age <= 60 ? '31-60 days' : age <= 90 ? '61-90 days' : '90+ days'] += 1;
    stockValue += num(u.purchase_cost);
    oldest.push({ vin: str(u.vin), model: str(u.model_name), days: age, status: str(u.status) });
  }
  oldest.sort((a, b) => b.days - a.days);

  const svcType = new Map<string, { type: string; count: number; revenue: number }>();
  for (const sv of services) {
    const t = str(sv.service_type) || 'Service';
    const a = svcType.get(t) ?? { type: t, count: 0, revenue: 0 }; a.count += 1; a.revenue += num(sv.service_cost); svcType.set(t, a);
  }

  // Products (Core) stock vs real VIN stock: shown, never auto-changed (changing it would block / allow Core orders).
  const pids = models.map((m) => str(m.product_id)).filter(Boolean);
  const { data: prods, error } = pids.length ? await supabaseAdmin.from('products').select('id, stock_quantity').eq('organization_id', org).in('id', pids) : { data: [], error: null };
  if (error) throw error;
  const stockOf = new Map(((prods ?? []) as Row[]).map((p) => [str(p.id), num(p.stock_quantity)]));
  const stockVsProducts = models.map((m) => {
    const sellable = units.filter((u) => u.model_id === m.id && str(u.status) === 'Available').length;
    const inProducts = stockOf.get(str(m.product_id)) ?? 0;
    return { model: [str(m.model_name), str(m.variant)].filter(Boolean).join(' '), availableUnits: sellable, productStock: inProducts, difference: inProducts - sellable };
  });

  // Scheme-wise cost: orders / vehicles that took each scheme and the discount given (cancelled orders excluded). Never blocks the other reports.
  let schemeUsage: { scheme: string; schemeName: string; status: string; orders: number; vehicles: number; discountGiven: number; bookings: number }[] = [];
  try {
    const [usage, schemeRows, bookingRows] = await Promise.all([
      vehicleSchemeUsage(org),
      rows('vehicle_schemes', org, ind, 'scheme_id, scheme_name, status'),
      rows('vehicle_bookings', org, ind, 'scheme_name, status'),
    ]);
    const booked = new Map<string, number>();
    for (const b of bookingRows) if (has(b.scheme_name) && str(b.status) !== 'Cancelled') booked.set(str(b.scheme_name), (booked.get(str(b.scheme_name)) ?? 0) + 1);
    schemeUsage = schemeRows.map((sc) => { const u = usage.get(str(sc.scheme_id)); return { scheme: str(sc.scheme_id), schemeName: str(sc.scheme_name), status: str(sc.status), orders: u?.orders ?? 0, vehicles: u?.vehicles ?? 0, discountGiven: Math.round((u?.discount ?? 0) * 100) / 100, bookings: (booked.get(str(sc.scheme_name)) ?? 0) + (booked.get(str(sc.scheme_id)) ?? 0) }; })
      .sort((a, b) => b.discountGiven - a.discountGiven);
  } catch { /* scheme report is optional */ }

  const r = (n: number) => r2(n);
  return {
    windowDays,
    schemeUsage,
    modelSales: [...byModel.values()].map((x) => ({ ...x, revenue: r(x.revenue) })).sort((a, b) => b.delivered - a.delivered),
    dealerSales: [...byDealer.values()].map((x) => ({ ...x, revenue: r(x.revenue) })).sort((a, b) => b.delivered - a.delivered),
    stockAgeing: { inStock: Object.values(buckets).reduce((a, b) => a + b, 0), stockCostValue: r(stockValue), buckets, oldest: oldest.slice(0, 10) },
    serviceRevenue: { total: r([...svcType.values()].reduce((a, b) => a + b.revenue, 0)), byType: [...svcType.values()].map((x) => ({ ...x, revenue: r(x.revenue) })) },
    stockVsProducts,
  };
}

// ================================================================ delivery handover note data
export async function vehicleHandover(org: string, ind: string, deliveryId: string) {
  const { data: d, error } = await supabaseAdmin.from('vehicle_deliveries').select('*').eq('organization_id', org).eq('industry_type_id', ind).eq('id', deliveryId).maybeSingle();
  if (error) throw error;
  if (!d) return null;
  const del = d as Row;
  const [unit, client, order, coll, reg] = await Promise.all([
    has(del.vin) ? supabaseAdmin.from('vehicle_units').select('*').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', str(del.vin)).maybeSingle() : Promise.resolve({ data: null }),
    has(del.client_id) ? supabaseAdmin.from('clients').select('client_name').eq('organization_id', org).eq('id', str(del.client_id)).maybeSingle() : Promise.resolve({ data: null }),
    has(del.order_id) ? supabaseAdmin.from('sale_orders').select('order_number, total_amount, created_at').eq('organization_id', org).eq('id', str(del.order_id)).maybeSingle() : Promise.resolve({ data: null }),
    has(del.order_id) ? supabaseAdmin.from('sales_collections').select('amount, mode, reference_no').eq('organization_id', org).eq('sale_order_id', str(del.order_id)) : Promise.resolve({ data: [] as Row[] }),
    has(del.vin) ? supabaseAdmin.from('vehicle_registrations').select('registration_number, rc_status').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', str(del.vin)).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const u = (unit.data ?? null) as Row | null;
  const model = u && has(u.model_id) ? ((await supabaseAdmin.from('vehicle_models').select('make, model_name, variant, warranty').eq('organization_id', org).eq('id', str(u.model_id)).maybeSingle()).data as Row | null) : null;
  const o = (order.data ?? null) as Row | null;
  const payments = ((coll.data ?? []) as Row[]);
  return {
    delivery: del, unit: u, model,
    clientName: str((client.data as Row | null)?.client_name) || str(del.client_name),
    order: o ? { orderNumber: str(o.order_number), total: num(o.total_amount) } : null,
    paid: r2(payments.reduce((a, c) => a + num(c.amount), 0)),
    payments: payments.map((c) => ({ amount: num(c.amount), mode: str(c.mode), reference: str(c.reference_no) })),
    registration: (reg.data ?? null) as Row | null,
  };
}

// ================================================================ service bill data (printable in the admin; a service bill, not a GST tax invoice)
export async function vehicleServiceBill(org: string, ind: string, id: string) {
  const { data: rec, error } = await supabaseAdmin.from('vehicle_service_records').select('*').eq('organization_id', org).eq('industry_type_id', ind).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!rec) return null;
  const s = rec as Row;
  const lines = parsePartsUsed(s.parts_used);
  const { data: parts } = lines.length ? await supabaseAdmin.from('vehicle_parts').select('part_code, part_name, selling_price').eq('organization_id', org).eq('industry_type_id', ind) : { data: [] as Row[] };
  const byCode = new Map(((parts ?? []) as Row[]).map((p) => [str(p.part_code).toLowerCase(), p]));
  const partLines = lines.map((l) => { const p = byCode.get(l.code.toLowerCase()); const rate = num(p?.selling_price); return { code: l.code, name: str(p?.part_name) || l.code, qty: l.qty, rate, amount: r2(rate * l.qty) }; });
  const partsTotal = r2(partLines.reduce((a, l) => a + l.amount, 0));
  const labour = parseLabourAmount(s.labour);
  const [client, unit] = await Promise.all([
    has(s.client_id) ? supabaseAdmin.from('clients').select('client_name, phone, email, address').eq('organization_id', org).eq('id', str(s.client_id)).maybeSingle() : Promise.resolve({ data: null }),
    has(s.vin) ? supabaseAdmin.from('vehicle_units').select('model_name, variant, registration_number, color').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', str(s.vin)).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return { service: s, client: (client.data ?? null) as Row | null, unit: (unit.data ?? null) as Row | null, partLines, partsTotal, labour, total: num(s.service_cost) || r2(partsTotal + labour) };
}
