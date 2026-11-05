// Vehicle (automobile dealership) CRUD + automation between the Vehicle modules.
// Own tables, own routes: nothing here touches FMCG / School / Textile / Pharma / Trading.
import { Router, type RequestHandler } from 'express';
import { logger } from '../lib/logger.js';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { assertRecordInScope, resolveIndustryTypeId } from '../lib/industry-scope.js';
import { todayLocal } from '../lib/ist-date.js';
import { VEHICLE_RESOURCES, type VehicleResource } from '../lib/vehicle-resources.js';
import {
  allocatePendingBookings, deliveryStageFor, followUpAfterTestDrive, nextVehicleCode, onBookingAllocated, ownerOfVin,
  refreshDeliveryPayments, resolveParty, retireModelProduct, syncModelProduct, tryAllocate,
} from '../lib/vehicle-links.js';
import { collectionsService } from '../services/collections.service.js';
import { cancelOrder } from '../repositories/orders.repository.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { runVehicleAftersales, scheduleNextService } from '../services/vehicle-aftersales.service.js';
import { parseLabourAmount, parsePartsUsed } from '../lib/vehicle-calc.js';
import { enqueueCustomerMessage, processCustomerMessages } from '../lib/vehicle-notify.js';
import { vehicleHandover, vehicleHealth, vehicleOverview, vehicleReports, vehicleRepair, vehicleServiceBill } from '../services/vehicle-insights.service.js';

export const vehicleRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
const reader = requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative');
const writerRep = requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative');

type Req = Parameters<RequestHandler>[0];
type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const has = (v: unknown) => v !== null && v !== undefined && v !== '';

const org = (req: Req) => {
  const v = req.header('x-organization-id');
  if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return v;
};
const idOf = (req: Req) => {
  const v = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!v) throw new AppError(400, 'INVALID_ID', 'A resource id is required');
  return v;
};
const bad = (msg: string, code = 'VALIDATION_ERROR') => new AppError(400, code, msg);
const dup = (r: VehicleResource, e: { details?: string | null }) => {
  const m = /Key \(([^)]+)\)/.exec(e.details ?? '');
  return new AppError(409, 'DUPLICATE_RECORD', `A ${r.path} record with that value already exists${m ? ` (same: ${m[1]})` : ''}.`);
};
const resOf = (path: string) => VEHICLE_RESOURCES.find((x) => x.path === path)!;

function clean(r: VehicleResource, body: unknown): Row {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('A JSON object body is required.');
  const allowed = new Set([...r.columns, 'status']);
  const out: Row = {};
  for (const [k, v] of Object.entries(body as Row)) if (allowed.has(k)) out[k] = v === '' ? null : v;
  return out;
}

// ---------------------------------------------------------------- small DB helpers
async function findOne(table: string, orgId: string, industryTypeId: string, column: string, value: unknown): Promise<Row | null> {
  if (typeof value !== 'string' || !value) return null;
  const { data, error } = await supabaseAdmin.from(table).select('*').eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq(column, value).limit(1).maybeSingle();
  if (error) throw error;
  return (data as Row | null) ?? null;
}
async function countWhere(table: string, orgId: string, column: string, value: unknown, extra?: (q: any) => any): Promise<number> {
  if (typeof value !== 'string' || !value) return 0;
  let q: any = supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq(column, value);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}
async function setUnitStatus(orgId: string, industryTypeId: string, vin: unknown, status: string, onlyFrom?: string[]) {
  if (typeof vin !== 'string' || !vin) return;
  let q = supabaseAdmin.from('vehicle_units').update({ status }).eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('vin', vin);
  if (onlyFrom) q = q.in('status', onlyFrom);
  await q; // best effort: the main record is already saved
}

// ---------------------------------------------------------------- normalise (auto-fill / calculate)
// Runs on every create / update. `m` = existing row merged with the incoming change.
async function normalise(r: VehicleResource, orgId: string, industryTypeId: string, payload: Row, existing: Row | null) {
  const m: Row = { ...(existing ?? {}), ...payload };
  for (const k of ['vin', 'new_vehicle_vin']) {
    if (typeof payload[k] === 'string') payload[k] = (payload[k] as string).trim().toUpperCase();
  }
  // Model / dealer names always come from the linked master record.
  if (r.columns.includes('model_id') && has(payload.model_id)) {
    const model = await findOne('vehicle_models', orgId, industryTypeId, 'id', payload.model_id);
    if (!model) throw bad('The selected model does not exist.', 'INVALID_REFERENCE');
    payload.model_name = model.model_name;
    if (r.table === 'vehicle_units') payload.variant = model.variant ?? null;
  }
  if (r.columns.includes('dealer_id') && has(payload.dealer_id)) {
    const dealer = await findOne('vehicle_dealers', orgId, industryTypeId, 'id', payload.dealer_id);
    if (!dealer) throw bad('The selected dealer does not exist.', 'INVALID_REFERENCE');
    payload.dealer_name = dealer.dealer_name;
  }
  // A unit picked on a child record fills what the unit already knows.
  if (has(payload.vin) && ['vehicle_bookings', 'vehicle_test_drives'].includes(r.table)) {
    const unit = await findOne('vehicle_units', orgId, industryTypeId, 'vin', payload.vin);
    if (unit) {
      if (!has(m.model_id) && unit.model_id) { payload.model_id = unit.model_id; payload.model_name = unit.model_name; }
      if (!has(m.dealer_id) && unit.dealer_id) { payload.dealer_id = unit.dealer_id; payload.dealer_name = unit.dealer_name; }
    }
  }
  if (r.table === 'vehicle_deliveries' && has(payload.vin)) {
    const unit = await findOne('vehicle_units', orgId, industryTypeId, 'vin', payload.vin);
    if (unit && !has(m.engine_number) && unit.engine_number) payload.engine_number = unit.engine_number;
  }
  // Link the record to the real Client (and Lead): a typed name is matched, a picked lead/client fills the name.
  if (r.columns.includes('client_id')) {
    const src: Row = { ...m, ...payload };
    // the name was edited by hand: re-match it instead of keeping the old client
    if (existing && payload.client_name !== undefined && payload.client_id === undefined && payload.lead_id === undefined && payload.client_name !== existing.client_name) {
      src.client_id = null; src.lead_id = null; payload.client_id = null;
      if (r.columns.includes('lead_id')) payload.lead_id = null;
    }
    const party = await resolveParty(orgId, industryTypeId, src, r.columns.includes('lead_id'));
    for (const [k, v] of Object.entries(party)) if (v !== undefined && (k === 'client_name' || !has((m as Row)[k]) || payload[k] !== undefined)) payload[k] = v;
    // after-sales records only know the VIN: the owner is the customer the vehicle was delivered to
    if (!has({ ...m, ...payload }.client_id) && has(payload.vin ?? m.vin)) {
      const owner = await ownerOfVin(orgId, industryTypeId, payload.vin ?? m.vin);
      if (owner.client_id) payload.client_id = owner.client_id;
      if (!has({ ...m, ...payload }.client_name) && owner.client_name) payload.client_name = owner.client_name;
    }
  }
  if (r.columns.includes('order_number') && has(payload.order_id)) {
    const { data: ord } = await supabaseAdmin.from('sale_orders').select('order_number, clients(industry_type_id)').eq('organization_id', orgId).eq('id', payload.order_id as string).maybeSingle();
    if (!ord) throw bad('The selected order does not exist.', 'INVALID_REFERENCE');
    payload.order_number = (ord as Row).order_number;
  }
  // Booking -> Core Order: a booking turned into an order links to the client's matching open order (no second order ledger).
  if (r.table === 'vehicle_bookings' && m.status === 'Converted to Order' && !has(m.order_id) && !has(payload.order_id)) {
    const clientId = has(m.client_id) ? String(m.client_id) : has(payload.client_id) ? String(payload.client_id) : null;
    const model = has(m.model_id) ? await findOne('vehicle_models', orgId, industryTypeId, 'id', m.model_id) : null;
    if (clientId && model && has(model.product_id)) {
      const { data: cands } = await supabaseAdmin.from('sale_orders').select('id, order_number, status, sale_order_items!inner(product_id)').eq('organization_id', orgId).eq('client_id', clientId).eq('sale_order_items.product_id', model.product_id as string).not('status', 'in', '(cancelled,pending_approval)').order('created_at', { ascending: false }).limit(10);
      for (const o of (cands ?? []) as Row[]) {
        const { count } = await supabaseAdmin.from('vehicle_bookings').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('order_id', o.id as string).eq('model_id', model.id as string).neq('status', 'Cancelled');
        if (!count) { payload.order_id = o.id; payload.order_number = o.order_number; break; }
      }
    }
  }
  if (r.table === 'vehicle_bookings' && has(m.scheme_name) && m.status !== 'Cancelled' && (!existing || existing.scheme_name !== m.scheme_name)) {
    const key = String(m.scheme_name).trim();
    const scheme = (await findOne('vehicle_schemes', orgId, industryTypeId, 'scheme_name', key)) ?? (await findOne('vehicle_schemes', orgId, industryTypeId, 'scheme_id', key));
    if (!scheme) throw bad(`Scheme "${key}" does not exist. Create it in Schemes & Discounts first.`, 'INVALID_REFERENCE');
    const today = todayLocal();
    if (scheme.status !== 'Active') throw bad(`Scheme "${key}" is ${String(scheme.status)}, not Active.`, 'SCHEME_NOT_ACTIVE');
    if (has(scheme.start_date) && String(scheme.start_date) > today) throw bad(`Scheme "${key}" starts on ${String(scheme.start_date)}.`, 'SCHEME_NOT_ACTIVE');
    if (has(scheme.end_date) && String(scheme.end_date) < today) throw bad(`Scheme "${key}" ended on ${String(scheme.end_date)}.`, 'SCHEME_NOT_ACTIVE');
    if (has(scheme.model_id) && has(m.model_id) && scheme.model_id !== m.model_id) throw bad(`Scheme "${key}" is for ${String(scheme.model_name)}, not the model on this booking.`, 'SCHEME_NOT_APPLICABLE');
    if (has(scheme.dealer_id) && has(m.dealer_id) && scheme.dealer_id !== m.dealer_id) throw bad(`Scheme "${key}" is for dealer ${String(scheme.dealer_name)}, not the dealer on this booking.`, 'SCHEME_NOT_APPLICABLE');
    const benefit = [
      num(scheme.cash_discount) > 0 ? `cash discount ${num(scheme.cash_discount)}` : '',
      num(scheme.discount_value) > 0 ? `${String(scheme.discount_type ?? 'discount')} ${num(scheme.discount_value)}` : '',
      num(scheme.exchange_bonus) > 0 ? `exchange bonus ${num(scheme.exchange_bonus)}` : '',
      has(scheme.finance_offer) ? `finance: ${String(scheme.finance_offer)}` : '', has(scheme.accessories_offer) ? `accessories: ${String(scheme.accessories_offer)}` : '', has(scheme.insurance_offer) ? `insurance: ${String(scheme.insurance_offer)}` : '',
    ].filter(Boolean).join(', ');
    const note = `Scheme ${String(scheme.scheme_name)}${benefit ? ` — ${benefit}` : ''}.`;
    if (!str(m.remarks).includes(`Scheme ${String(scheme.scheme_name)}`)) payload.remarks = [str(m.remarks), note].filter(Boolean).join('\n');
  }
  if (r.table === 'vehicle_finance_applications') {
    const loan = num(m.loan_amount), rate = num(m.interest_rate), n = num(m.tenure_months);
    if (!has(payload.emi) && loan > 0 && n > 0 && (payload.loan_amount !== undefined || payload.interest_rate !== undefined || payload.tenure_months !== undefined || !has(m.emi))) {
      const i = rate / 12 / 100;
      payload.emi = Math.round((i === 0 ? loan / n : (loan * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1)) * 100) / 100;
    }
    if (has(m.approved_amount) || payload.disbursed_amount !== undefined) {
      payload.pending_amount = Math.max(num(m.approved_amount) - num(m.disbursed_amount), 0);
    }
  }
  if (r.table === 'vehicle_exchanges' && has(m.approved_value)) {
    payload.net_exchange_value = num(m.approved_value) - num(m.outstanding_loan);
  }
  if (r.table === 'vehicle_registrations' && m.status === 'Completed' && !has(m.completion_date)) payload.completion_date = todayLocal();
  if (r.table === 'vehicle_deliveries') {
    const status = String(m.status ?? '');
    if (['Preparation', 'PDI Pending', 'Documentation Pending', 'Payment Pending', 'Ready for Delivery'].includes(status)) {
      payload.status = deliveryStageFor(m);
    }
    if ((payload.status ?? m.status) === 'Delivered' && !has(m.delivery_date)) payload.delivery_date = todayLocal();
  }
  return { ...m, ...payload } as Row;
}

// ---------------------------------------------------------------- validate
const BLOCKED_UNIT = ['Sold', 'Delivered', 'Damaged', 'Under Service', 'Returned', 'In Transit'];
const UNIT_FOR_BOOKING: Record<string, string> = { Reserved: 'Reserved', Confirmed: 'Reserved', 'Vehicle Allocated': 'Allocated', 'Converted to Order': 'Booked' };
const HELD = ['Reserved', 'Booked', 'Allocated'];

function validateValues(r: VehicleResource, p: Row, partial: boolean) {
  if (p.status !== undefined && p.status !== null && !r.statuses.includes(String(p.status))) throw bad(`status must be one of: ${r.statuses.join(', ')}.`);
  for (const k of r.nonNegative) {
    if (!has(p[k])) continue;
    const n = Number(p[k]);
    if (Number.isNaN(n)) throw bad(`${k} must be a number.`);
    if (n < 0) throw bad(`${k} cannot be negative.`);
  }
  if (partial) {
    const blank = r.requiredFields.filter((k) => k in p && !has(p[k]));
    if (blank.length) throw bad(`${blank.join(', ')} cannot be empty.`);
  }
}

// Business rules on the merged record `m`.
async function assertRules(r: VehicleResource, orgId: string, ind: string, m: Row, existing: Row | null) {
  const status = String(m.status ?? '');
  // links: every VIN must be a real unit of this organization / industry
  for (const k of ['vin', 'new_vehicle_vin']) {
    if (r.columns.includes(k) && has(m[k]) && r.table !== 'vehicle_units') {
      if (!(await findOne('vehicle_units', orgId, ind, 'vin', m[k]))) throw bad(`Vehicle ${String(m[k])} does not exist. Add it in Vehicle Catalog > Units first.`, 'INVALID_REFERENCE');
    }
  }
  if (r.columns.includes('start_date') && r.columns.includes('end_date') && has(m.start_date) && has(m.end_date) && String(m.end_date) < String(m.start_date)) throw bad('End date cannot be before the start date.');
  if (r.table === 'vehicle_insurance_policies' && has(m.start_date) && has(m.expiry_date) && String(m.expiry_date) < String(m.start_date)) throw bad('Expiry date cannot be before the start date.');

  if (r.table === 'vehicle_schemes') {
    if (m.discount_type === 'Percentage' && num(m.discount_value) > 100) throw bad('A percentage discount cannot be more than 100.');
  }
  if (r.table === 'vehicle_test_drives') {
    if (has(m.odometer_start) && has(m.odometer_end) && num(m.odometer_end) < num(m.odometer_start)) throw bad('End odometer cannot be lower than the start odometer.');
    if (['In Progress', 'Completed'].includes(status) && m.license_verified !== 'Yes') throw bad('Verify the customer\u2019s driving licence before the test drive starts.');
    if (has(m.vin) && !['Cancelled', 'No Show', 'Requested'].includes(status)) {
      const unit = await findOne('vehicle_units', orgId, ind, 'vin', m.vin);
      if (unit && ['Sold', 'Delivered', 'Damaged', 'Under Service', 'Returned', 'Reserved', 'Booked', 'Allocated'].includes(String(unit.status))) throw bad(`Vehicle ${String(m.vin)} is ${String(unit.status)} and cannot be used for a test drive.`);
    }
    // No two live test drives of the same vehicle or the same sales representative may overlap in time.
    const mins = (t: unknown) => { const x = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '')); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
    const s0 = mins(m.start_time);
    if (has(m.drive_date) && s0 !== null && !['Cancelled', 'No Show', 'Completed'].includes(status)) {
      const e0 = mins(m.end_time) ?? s0 + 60;
      let q = supabaseAdmin.from('vehicle_test_drives').select('test_drive_number, vin, sales_rep, start_time, end_time').eq('organization_id', orgId).eq('industry_type_id', ind).eq('drive_date', String(m.drive_date)).in('status', ['Requested', 'Scheduled', 'Confirmed', 'In Progress']);
      if (existing?.id) q = q.neq('id', existing.id as string);
      const { data: sameDay, error } = await q;
      if (error) throw error;
      for (const o of (sameDay ?? []) as Row[]) {
        const s1 = mins(o.start_time); if (s1 === null) continue;
        const e1 = mins(o.end_time) ?? s1 + 60;
        if (s0 < e1 && s1 < e0) {
          if (has(m.vin) && o.vin === m.vin) throw new AppError(409, 'TEST_DRIVE_CLASH', `Vehicle ${String(m.vin)} is already booked for test drive ${String(o.test_drive_number)} at that time.`);
          if (has(m.sales_rep) && o.sales_rep === m.sales_rep) throw new AppError(409, 'TEST_DRIVE_CLASH', `${String(m.sales_rep)} already has test drive ${String(o.test_drive_number)} at that time.`);
        }
      }
    }
  }
  if (r.table === 'vehicle_bookings') {
    if (status === 'Cancelled' && !has(m.cancellation_reason)) throw bad('Enter the cancellation reason.');
    if (status === 'Converted to Order' && !has(m.order_id)) throw bad('No open order was found for this client and model. Create the order in Orders first (or pick it), then convert the booking.', 'ORDER_REQUIRED');
    if (has(m.vin) && UNIT_FOR_BOOKING[status]) {
      const unit = (await findOne('vehicle_units', orgId, ind, 'vin', m.vin))!;
      if (has(m.model_id) && unit.model_id && unit.model_id !== m.model_id) throw bad(`Vehicle ${String(m.vin)} is a ${String(unit.model_name)}, not the model selected on this booking.`);
      let q = supabaseAdmin.from('vehicle_bookings').select('booking_number').eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', m.vin as string).in('status', Object.keys(UNIT_FOR_BOOKING));
      if (existing?.id) q = q.neq('id', existing.id as string);
      const { data: others, error } = await q;
      if (error) throw error;
      if ((others ?? []).length) throw new AppError(409, 'VIN_ALREADY_BOOKED', `Vehicle ${String(m.vin)} is already held by booking ${String((others as Row[])[0]!.booking_number)}.`);
      if (BLOCKED_UNIT.includes(String(unit.status))) throw bad(`Vehicle ${String(m.vin)} is ${String(unit.status)} and cannot be booked.`);
    }
  }
  if (r.table === 'vehicle_deliveries' && status === 'Delivered') {
    if (!has(m.vin)) throw bad('Select the vehicle (VIN) before marking the delivery as Delivered.');
    const gaps: string[] = [];
    if (m.pdi_status !== 'Passed') gaps.push('PDI must be Passed');
    if (m.documentation_status !== 'Complete') gaps.push('documentation must be Complete');
    if (m.payment_status !== 'Complete') gaps.push('payment must be Complete');
    // insurance blocks handover only when the booking asked for it (older deliveries with a default Pending are not stopped)
    if (!['Complete', 'Not Applicable'].includes(String(m.insurance_status)) && has(m.booking_number)) {
      const bk = await findOne('vehicle_bookings', orgId, ind, 'booking_number', m.booking_number);
      if (bk && ['yes', 'true', 'y'].includes(String(bk.insurance_required ?? '').trim().toLowerCase())) gaps.push('insurance must be Complete (the booking requires it) or set to Not Applicable');
    }
    // optional: VEHICLE_REQUIRE_REGISTRATION_BEFORE_DELIVERY=yes makes registration a handover requirement too
    if (process.env.VEHICLE_REQUIRE_REGISTRATION_BEFORE_DELIVERY === 'yes' && !['Complete', 'Not Applicable'].includes(String(m.registration_status))) gaps.push('registration must be Complete (or Not Applicable)');
    if (m.customer_acknowledgement !== 'Yes') gaps.push('customer acknowledgement must be Yes');
    if (gaps.length) throw bad(`Cannot mark as Delivered: ${gaps.join(', ')}.`, 'DELIVERY_NOT_READY');
    const unit = await findOne('vehicle_units', orgId, ind, 'vin', m.vin);
    if (unit && ['Damaged', 'Returned'].includes(String(unit.status))) throw bad(`Vehicle ${String(m.vin)} is ${String(unit.status)} and cannot be delivered.`);
  }
  if (r.table === 'vehicle_registrations' && status === 'Completed' && !has(m.registration_number)) throw bad('Enter the registration number before completing the registration.');
  if (r.table === 'vehicle_finance_applications') {
    if (status === 'Approved' && !has(m.approved_amount)) throw bad('Enter the approved amount for an Approved application.');
    if (status === 'Disbursed' && num(m.disbursed_amount) <= 0) throw bad('Enter the disbursed amount for a Disbursed application.');
    if (num(m.disbursed_amount) > num(m.approved_amount) && has(m.approved_amount)) throw bad('Disbursed amount cannot be more than the approved amount.');
  }
  if (r.table === 'vehicle_exchanges') {
    if (status === 'Approved' && !has(m.approved_value)) throw bad('Enter the approved value for an Approved exchange.');
    if (num(m.outstanding_loan) > num(m.approved_value) && has(m.approved_value)) throw bad('Outstanding loan is more than the approved value \u2014 settle the loan difference with the customer first.', 'EXCHANGE_LOAN_EXCEEDS_VALUE');
  }
  if (r.table === 'vehicle_service_records') {
    if (m.service_type === 'Warranty Service' && has(m.vin)) {
      const { data, error } = await supabaseAdmin.from('vehicle_warranties').select('id').eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', m.vin as string).in('status', ['Active', 'Expiring Soon', 'Claimed']).limit(1);
      if (error) throw error;
      if (!(data ?? []).length) throw bad(`Vehicle ${String(m.vin)} has no active warranty, so it cannot be booked as a Warranty Service.`, 'NO_ACTIVE_WARRANTY');
    }
  }
  if (r.table === 'vehicle_returns') {
    if (status === 'Refunded' && num(m.refund_amount) <= 0) throw bad('Enter the refund amount before marking as Refunded.');
    if (has(m.amount) && num(m.refund_amount) > num(m.amount)) throw bad('Refund amount cannot be more than the amount paid.');
    if (m.return_type === 'Booking Cancellation' && has(m.booking_reference) && !(await findOne('vehicle_bookings', orgId, ind, 'booking_number', m.booking_reference))) {
      throw bad(`Booking ${String(m.booking_reference)} does not exist.`, 'INVALID_REFERENCE');
    }
  }
}

// ---------------------------------------------------------------- automation after a save
/** Posts money to Core Collections once (the reference is unique per order). Never breaks the save. */
async function postOrderPayment(orgId: string, scope: IndustryScope, orderId: unknown, amount: number, reference: string, notes: string): Promise<boolean> {
  if (!has(orderId) || amount <= 0) return false;
  try {
    const { data: dupe } = await supabaseAdmin.from('sales_collections').select('id').eq('organization_id', orgId).eq('sale_order_id', String(orderId)).eq('reference_no', reference).limit(1).maybeSingle();
    if (dupe) return true;
    await collectionsService.createForOrder(orgId, { orderId: String(orderId), amount, mode: 'other', referenceNo: reference, notes }, scope);
    return true;
  } catch (e) {
    logger.warn({ err: e, reference }, 'vehicle: payment could not be posted to Collections');
    return false;
  }
}
async function postBookingAmount(orgId: string, row: Row, scope: IndustryScope) {
  if (!has(row.order_id) || num(row.booking_amount) <= 0 || has(row.payment_reference) || row.status === 'Cancelled') return;
  if (await postOrderPayment(orgId, scope, row.order_id, num(row.booking_amount), String(row.booking_number), `Booking advance ${String(row.booking_number)}`)) {
    await supabaseAdmin.from('vehicle_bookings').update({ payment_reference: row.booking_number }).eq('id', row.id as string);
    row.payment_reference = row.booking_number;
  }
}

async function afterSave(r: VehicleResource, orgId: string, ind: string, row: Row, before: Row | null, scope?: IndustryScope, userId?: string) {
  const changed = (k: string) => !before || before[k] !== row[k];
  if (r.table === 'vehicle_bookings' && scope) await postBookingAmount(orgId, row, scope);

  if (r.table === 'vehicle_models') await syncModelProduct(orgId, ind, row); // keeps the Products master (and so the Lead -> Quotation chain) in step

  if (r.table === 'vehicle_units' && row.status === 'Received' && changed('status')) { // incoming stock goes straight to PDI
    await setUnitStatus(orgId, ind, row.vin, 'PDI Pending', ['Received']);
    row.status = 'PDI Pending';
  }
  if (r.table === 'vehicle_test_drives' && has(row.vin) && changed('status')) { // the demo car is off the sale list while it is out
    if (row.status === 'In Progress') await setUnitStatus(orgId, ind, row.vin, 'Demo', ['Available']);
    else if (['Completed', 'Cancelled', 'No Show'].includes(String(row.status))) {
      const unit = await findOne('vehicle_units', orgId, ind, 'vin', row.vin);
      if (unit?.status === 'Demo') { await setUnitStatus(orgId, ind, row.vin, 'Available', ['Demo']); await allocatePendingBookings(orgId, ind, unit.model_id); }
    }
  }
  if (r.table === 'vehicle_units' && row.status === 'Available' && changed('status')) await allocatePendingBookings(orgId, ind, row.model_id); // new stock serves waiting bookings

  if (r.table === 'vehicle_test_drives' && ['Completed', 'No Show'].includes(String(row.status)) && changed('status')) await followUpAfterTestDrive(orgId, ind, row);

  if (r.table === 'vehicle_bookings') {
    const status = String(row.status);
    const want = UNIT_FOR_BOOKING[status];
    if (before && has(before.vin) && before.vin !== row.vin) await setUnitStatus(orgId, ind, before.vin, 'Available', HELD); // VIN swapped: free the old one
    if (has(row.vin)) {
      if (want) await setUnitStatus(orgId, ind, row.vin, want, ['Available', 'Received', 'PDI Pending', ...HELD]);
      else if (status === 'Cancelled') await setUnitStatus(orgId, ind, row.vin, 'Available', HELD);
    }
    if (status === 'Cancelled') await allocatePendingBookings(orgId, ind, before?.model_id ?? row.model_id); // the released unit goes to the next waiting booking
    else if (!has(row.vin)) await tryAllocate(orgId, ind, row); // Confirmed / pending with no VIN: take the oldest available unit of that model
    else if (['Vehicle Allocated', 'Converted to Order'].includes(status)) await onBookingAllocated(orgId, ind, row); // opens delivery (+ finance) file
  }

  if (r.table === 'vehicle_deliveries') {
    // Unit PDI done -> unit is sale-ready.
    if (row.pdi_status === 'Passed' && has(row.vin)) await setUnitStatus(orgId, ind, row.vin, 'Available', ['PDI Pending']);
    if (row.status === 'Cancelled' && has(row.vin) && before?.status !== 'Cancelled') await setUnitStatus(orgId, ind, row.vin, 'Available', HELD);
    if (changed('status') && ['Ready for Delivery', 'Delivered'].includes(String(row.status))) {
      const ready = row.status === 'Ready for Delivery';
      await enqueueCustomerMessage(orgId, ind, { key: `dlv:${String(row.id)}:${ready ? 'ready' : 'done'}`, kind: ready ? 'delivery_ready' : 'delivered', clientId: row.client_id, subject: ready ? 'Your vehicle is ready for delivery' : 'Thank you for choosing us',
        body: ready ? `Dear ${str(row.client_name) || 'Customer'}, your vehicle ${str(row.vin)} is ready for delivery. Please contact us to confirm the handover time.` : `Dear ${str(row.client_name) || 'Customer'}, congratulations on your new vehicle ${str(row.vin)}. Your first service will be scheduled for you. Drive safe!` });
      void processCustomerMessages(orgId);
    }
    if (row.status === 'Delivered' && changed('status')) await onDelivered(orgId, ind, row);
    else if (!['Delivered', 'Cancelled'].includes(String(row.status))) await refreshDeliveryPayments(orgId, ind);
  }

  if (r.table === 'vehicle_registrations') {
    if (row.status === 'Completed' && has(row.registration_number)) {
      await supabaseAdmin.from('vehicle_units').update({ registration_number: row.registration_number }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string);
      await supabaseAdmin.from('vehicle_deliveries').update({ registration_status: 'Complete' }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string).neq('status', 'Cancelled');
    }
  }

  if (r.table === 'vehicle_insurance_policies') {
    if (['Active', 'Expiring Soon'].includes(String(row.status)) && has(row.vin)) {
      await supabaseAdmin.from('vehicle_deliveries').update({ insurance_status: 'Complete' }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string).neq('status', 'Cancelled');
      await supabaseAdmin.from('vehicle_registrations').update({ insurance_reference: row.policy_number }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string).is('insurance_reference', null);
    }
  }

  // Loan money / exchange value count towards the order's payment; the delivery's payment status follows by itself.
  if (scope && has(row.order_id)) {
    if (r.table === 'vehicle_finance_applications' && row.status === 'Disbursed') await postOrderPayment(orgId, scope, row.order_id, num(row.disbursed_amount), String(row.application_number), `Loan disbursed ${String(row.application_number)}`);
    if (r.table === 'vehicle_exchanges' && ['Approved', 'Converted'].includes(String(row.status))) {
      await postOrderPayment(orgId, scope, row.order_id, has(row.net_exchange_value) ? num(row.net_exchange_value) : num(row.approved_value), String(row.exchange_id), `Exchange value ${String(row.exchange_id)}`);
    }
  }
  if (r.table === 'vehicle_finance_applications' || r.table === 'vehicle_exchanges') await refreshDeliveryPayments(orgId, ind);

  if (r.table === 'vehicle_service_records' && row.status === 'Completed' && has(row.vin)) {
    if (has(row.odometer)) {
      const unit = await findOne('vehicle_units', orgId, ind, 'vin', row.vin);
      if (unit && num(row.odometer) > num(unit.odometer)) await supabaseAdmin.from('vehicle_units').update({ odometer: row.odometer }).eq('id', unit.id as string);
    }
    if (row.service_type === 'Warranty Service' && changed('status')) {
      const { data: w } = await supabaseAdmin.from('vehicle_warranties').select('id, warranty_claims').eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string).limit(1).maybeSingle();
      if (w) {
        const line = `${String(row.service_number)} (${String(row.service_date ?? todayLocal())}): ${String(row.complaint ?? 'warranty service')}`;
        const old = str((w as Row).warranty_claims);
        await supabaseAdmin.from('vehicle_warranties').update({ warranty_claims: old ? `${old}\n${line}` : line, service_history_reference: row.service_number }).eq('id', (w as Row).id as string);
      }
    }
    await consumeServiceParts(orgId, ind, row); // parts used leave the parts stock once, and the bill amount is filled in
    await scheduleNextService(orgId, ind, row); // the next periodic service is booked by itself
  }

  if (r.table === 'vehicle_returns') {
    const status = String(row.status);
    if (row.return_type === 'Booking Cancellation' && status === 'Approved' && changed('status') && has(row.booking_reference)) {
      const booking = await findOne('vehicle_bookings', orgId, ind, 'booking_number', row.booking_reference);
      if (booking && booking.status !== 'Cancelled') {
        await supabaseAdmin.from('vehicle_bookings').update({ status: 'Cancelled', cancellation_reason: str(row.reason) || `Return ${String(row.return_number)}` }).eq('id', booking.id as string);
        if (has(booking.vin)) await setUnitStatus(orgId, ind, booking.vin, 'Available', HELD);
      }
    }
    if (['Vehicle Return', 'Sales Cancellation'].includes(String(row.return_type)) && status === 'Vehicle Received' && has(row.vin)) {
      await setUnitStatus(orgId, ind, row.vin, 'Returned');
    }
    // Sales cancellation approved: cancel the Core order (this also cancels its bookings and releases the VINs).
    if (row.return_type === 'Sales Cancellation' && status === 'Approved' && changed('status') && has(row.order_id) && scope) {
      try { await cancelOrder(orgId, scope, String(row.order_id), `Vehicle return ${String(row.return_number)}`); }
      catch (e) { logger.warn({ err: e, ret: row.return_number }, 'vehicle: order could not be cancelled from the return'); }
    }
    // Refund paid: record it against the Core order so its balance is right.
    if (status === 'Refunded' && changed('status') && has(row.order_id) && num(row.refund_amount) > 0) {
      try {
        const reference = String(row.return_number);
        const { data: seen } = await supabaseAdmin.from('sales_refunds').select('id').eq('organization_id', orgId).eq('order_id', String(row.order_id)).eq('reference_no', reference).limit(1).maybeSingle();
        if (!seen) {
          const { data: ord } = await supabaseAdmin.from('sale_orders').select('client_id, currency_code, exchange_rate').eq('organization_id', orgId).eq('id', String(row.order_id)).maybeSingle();
          if (ord) {
            const rate = Number((ord as Row).exchange_rate ?? 1) || 1;
            await supabaseAdmin.from('sales_refunds').insert({ organization_id: orgId, order_id: row.order_id, client_id: (ord as Row).client_id, amount: num(row.refund_amount), mode: 'other', reference_no: reference, notes: `Vehicle return ${reference}`, currency_code: String((ord as Row).currency_code ?? 'INR'), exchange_rate: rate, base_amount: Math.round(num(row.refund_amount) * rate * 100) / 100, created_by: userId ?? null });
          }
        }
      } catch (e) { logger.warn({ err: e, ret: row.return_number }, 'vehicle: refund could not be recorded on the order'); }
    }
    // Inspection finished: a returned vehicle goes back to stock (or is marked Damaged if its condition is Poor).
    if (['Refunded', 'Closed'].includes(status) && changed('status') && ['Vehicle Return', 'Sales Cancellation'].includes(String(row.return_type)) && has(row.vin)) {
      const unit = await findOne('vehicle_units', orgId, ind, 'vin', row.vin);
      if (unit && unit.status === 'Returned') {
        const next = row.vehicle_condition === 'Poor' ? 'Damaged' : 'Available';
        await setUnitStatus(orgId, ind, row.vin, next, ['Returned']);
        if (next === 'Available') await allocatePendingBookings(orgId, ind, unit.model_id);
      }
    }
  }
}

// Service completed -> parts leave stock once ("CODE x 2" per line in Parts used); service cost = parts + labour when left empty.
async function consumeServiceParts(orgId: string, ind: string, row: Row) {
  try {
    const lines = parsePartsUsed(row.parts_used);
    if (!lines.length || row.parts_deducted === true) return;
    const { data: claimed } = await supabaseAdmin.from('vehicle_service_records').update({ parts_deducted: true }).eq('id', row.id as string).eq('parts_deducted', false).select('id').maybeSingle();
    if (!claimed) return; // already taken (or the step-5 SQL has not been run)
    let partsTotal = 0; const issues: string[] = [];
    for (const l of lines) {
      const { data: part } = await supabaseAdmin.from('vehicle_parts').select('*').eq('organization_id', orgId).eq('industry_type_id', ind).ilike('part_code', l.code.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(1).maybeSingle();
      if (!part) { issues.push(`${l.code}: not in Parts master`); continue; }
      const p = part as Row;
      const have = num(p.stock_quantity), take = Math.min(have, l.qty);
      partsTotal += l.qty * num(p.selling_price);
      if (take < l.qty) issues.push(`${l.code}: needed ${l.qty}, had ${have}`);
      if (take > 0) await supabaseAdmin.from('vehicle_parts').update({ stock_quantity: have - take }).eq('id', p.id as string).eq('stock_quantity', p.stock_quantity as number); // compare-and-swap
    }
    const patch: Row = {};
    if (!has(row.service_cost) || num(row.service_cost) === 0) { const total = partsTotal + parseLabourAmount(row.labour); if (total > 0) patch.service_cost = total; }
    if (issues.length) patch.resolution = [str(row.resolution), `Parts check: ${issues.join('; ')}`].filter(Boolean).join('\n');
    if (Object.keys(patch).length) await supabaseAdmin.from('vehicle_service_records').update(patch).eq('id', row.id as string);
  } catch (e) { logger.warn({ err: e, service: row.service_number }, 'vehicle: service parts could not be taken from stock'); }
}

// Delivery handed over -> unit Delivered, registration file opened, warranty started. No manual re-entry.
async function onDelivered(orgId: string, ind: string, d: Row) {
  const vin = d.vin as string;
  if (!has(vin) || (has(d.industry_type_id) && d.industry_type_id !== ind)) return; // only this industry's own delivery
  await setUnitStatus(orgId, ind, vin, 'Delivered');
  if (has(d.order_id)) { // handed over and fully paid (the Delivered gate checks payment): the Core order is done
    const left = await countWhere('vehicle_deliveries', orgId, 'order_id', d.order_id, (q) => q.neq('status', 'Delivered').neq('status', 'Cancelled'));
    if (left === 0) await supabaseAdmin.from('sale_orders').update({ status: 'completed' }).eq('organization_id', orgId).eq('id', d.order_id as string).eq('status', 'confirmed');
  }
  const base = { organization_id: orgId, industry_type_id: ind, vin, client_name: d.client_name };
  const regR = resOf('registrations'), warR = resOf('warranties');
  const { data: reg } = await supabaseAdmin.from('vehicle_registrations').select('id').eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', vin).maybeSingle();
  if (!reg) {
    await supabaseAdmin.from('vehicle_registrations').insert({ ...base, engine_number: d.engine_number ?? null, delivery_reference: d.delivery_number, invoice_reference: d.sales_order_reference ?? null, status: 'Pending' });
  }
  const { data: war } = await supabaseAdmin.from('vehicle_warranties').select('id').eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', vin).maybeSingle();
  if (!war) {
    const unit = await findOne('vehicle_units', orgId, ind, 'vin', vin);
    const model = unit?.model_id ? await findOne('vehicle_models', orgId, ind, 'id', unit.model_id) : null;
    const start = str(d.delivery_date) || todayLocal();
    let end: string | null = null;
    const w = str(model?.warranty);
    const yrs = /(\d+(?:\.\d+)?)\s*(?:year|yr)/i.exec(w), mos = /(\d+)\s*month/i.exec(w);
    if (yrs || mos) {
      const dt = new Date(`${start}T00:00:00Z`);
      if (yrs) dt.setUTCMonth(dt.getUTCMonth() + Math.round(Number(yrs[1]) * 12)); else dt.setUTCMonth(dt.getUTCMonth() + Number(mos![1]));
      end = dt.toISOString().slice(0, 10);
    }
    await supabaseAdmin.from('vehicle_warranties').insert({ ...base, warranty_number: await nextVehicleCode(warR.table, warR.prefix, orgId), start_date: start, end_date: end, coverage: w || null, status: 'Active' });
  }
  void regR;
}

// ---------------------------------------------------------------- delete guards
const VIN_CHILDREN: [string, string][] = [['vehicle_bookings', 'vin'], ['vehicle_test_drives', 'vin'], ['vehicle_deliveries', 'vin'], ['vehicle_registrations', 'vin'], ['vehicle_finance_applications', 'vin'], ['vehicle_insurance_policies', 'vin'], ['vehicle_warranties', 'vin'], ['vehicle_service_records', 'vin'], ['vehicle_returns', 'vin'], ['vehicle_exchanges', 'new_vehicle_vin']];
async function assertCanDelete(r: VehicleResource, orgId: string, row: Row) {
  const inUse = (what: string) => new AppError(409, 'RECORD_IN_USE', `This record is used by ${what}. Remove or reassign them first.`);
  if (r.table === 'vehicle_models') {
    const n = (await countWhere('vehicle_units', orgId, 'model_id', row.id)) + (await countWhere('vehicle_bookings', orgId, 'model_id', row.id)) + (await countWhere('vehicle_test_drives', orgId, 'model_id', row.id)) + (await countWhere('vehicle_schemes', orgId, 'model_id', row.id));
    if (n) throw inUse(`${n} unit / booking / test drive / scheme record(s)`);
  }
  if (r.table === 'vehicle_dealers') {
    const n = (await countWhere('vehicle_units', orgId, 'dealer_id', row.id)) + (await countWhere('vehicle_bookings', orgId, 'dealer_id', row.id)) + (await countWhere('vehicle_deliveries', orgId, 'dealer_id', row.id));
    if (n) throw inUse(`${n} unit / booking / delivery record(s)`);
  }
  if (r.table === 'vehicle_units') {
    if (['Sold', 'Delivered'].includes(String(row.status))) throw new AppError(409, 'RECORD_IN_USE', `This vehicle is ${String(row.status)} and cannot be deleted.`);
    for (const [t, c] of VIN_CHILDREN) {
      const n = await countWhere(t, orgId, c, row.vin);
      if (n) throw inUse(`${n} ${t.replace('vehicle_', '').replace(/_/g, ' ')} record(s)`);
    }
  }
  if (r.table === 'vehicle_deliveries' && row.status === 'Delivered') throw new AppError(409, 'RECORD_IN_USE', 'A delivered vehicle\u2019s delivery record cannot be deleted.');
  if (r.table === 'vehicle_bookings' && ['Vehicle Allocated', 'Converted to Order'].includes(String(row.status))) throw new AppError(409, 'RECORD_IN_USE', 'Cancel this booking first (it holds a vehicle).');
}

// ---------------------------------------------------------------- date-driven statuses (best effort, run on list)
const DATE_REFRESH_MS = 5 * 60_000;
const lastDateRefresh = new Map<string, number>();
async function refreshDateStatuses(r: VehicleResource, orgId: string, ind: string | null) {
  const key = `${orgId}:${ind ?? ''}:${r.table}`;
  if (Date.now() - (lastDateRefresh.get(key) ?? 0) < DATE_REFRESH_MS) return;
  lastDateRefresh.set(key, Date.now());
  try {
    const today = todayLocal();
    const soon = new Date(`${today}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 30);
    const soonStr = soon.toISOString().slice(0, 10);
    const scoped = (q: any) => (ind ? q.eq('industry_type_id', ind) : q);
    const upd = (status: string, build: (q: any) => any) => build(scoped(supabaseAdmin.from(r.table).update({ status }).eq('organization_id', orgId)));
    if (r.table === 'vehicle_schemes') {
      await upd('Expired', (q) => q.eq('status', 'Active').lt('end_date', today));
    } else if (r.table === 'vehicle_insurance_policies' || r.table === 'vehicle_warranties') {
      const col = r.table === 'vehicle_insurance_policies' ? 'expiry_date' : 'end_date';
      await upd('Expired', (q) => q.in('status', ['Active', 'Expiring Soon']).lt(col, today));
      await upd('Expiring Soon', (q) => q.eq('status', 'Active').gte(col, today).lte(col, soonStr));
      await upd('Active', (q) => q.in('status', ['Expiring Soon', 'Expired']).gt(col, soonStr));
    }
  } catch { /* keep the list working */ }
}

// ---------------------------------------------------------------- run the after-sales automation now (it also runs by itself every hour)
vehicleRouter.post('/vehicle/automation/run', authenticate, manager, async (req, res) => {
  const ind = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!ind) throw bad('Select the Vehicle industry first.');
  res.json({ data: await runVehicleAftersales(org(req), ind) });
});

// ---------------------------------------------------------------- insights: overview, health check, repair
const insightInd = (req: Req) => {
  const ind = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!ind) throw bad('Select the Vehicle industry first.');
  return ind;
};
vehicleRouter.get('/vehicle/insights/overview', authenticate, reader, async (req, res) => {
  res.json({ data: await vehicleOverview(org(req), insightInd(req), Number(req.query.days) || 90) });
});
vehicleRouter.get('/vehicle/insights/health', authenticate, manager, async (req, res) => {
  res.json({ data: await vehicleHealth(org(req), insightInd(req)) });
});
vehicleRouter.get('/vehicle/insights/reports', authenticate, reader, async (req, res) => {
  res.json({ data: await vehicleReports(org(req), insightInd(req), Number(req.query.days) || 90) });
});
vehicleRouter.get('/vehicle/deliveries/:id/handover', authenticate, reader, async (req, res) => {
  const ind = insightInd(req);
  const data = await vehicleHandover(org(req), ind, idOf(req));
  if (!data) throw new AppError(404, 'RECORD_NOT_FOUND', 'Delivery record was not found.');
  res.json({ data });
});
vehicleRouter.get('/vehicle/service-records/:id/bill', authenticate, reader, async (req, res) => {
  const data = await vehicleServiceBill(org(req), insightInd(req), idOf(req));
  if (!data) throw new AppError(404, 'RECORD_NOT_FOUND', 'Service record was not found.');
  res.json({ data });
});
vehicleRouter.post('/vehicle/notifications/send', authenticate, manager, async (req, res) => {
  res.json({ data: await processCustomerMessages(org(req)) });
});
vehicleRouter.post('/vehicle/insights/repair', authenticate, manager, async (req, res) => {
  res.json({ data: await vehicleRepair(org(req), insightInd(req), (o, i, d) => onDelivered(o, i, d)) });
});

// ---------------------------------------------------------------- stock intake: bulk VIN import + PDI pass
// POST /vehicle/units/bulk { units: [{ vin, model_id, color, ... }] } (max 500): each row goes through the same checks as a single add; bad rows are reported, good rows are saved.
vehicleRouter.post('/vehicle/units/bulk', authenticate, manager, async (req, res) => {
  const r = resOf('units');
  const list = (req.body as { units?: unknown })?.units;
  if (!Array.isArray(list) || !list.length) throw bad('units must be a non-empty array.');
  if (list.length > 500) throw bad('Import at most 500 units at a time.');
  const created: string[] = []; const errors: { row: number; vin: string; error: string }[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] as Row;
    try {
      const payload = clean(r, { status: 'Received', ...item });
      const ind = resolveIndustryTypeId(req.industryScope!, typeof payload.industry_type_id === 'string' ? payload.industry_type_id : (typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined));
      if (!ind) throw bad('industry_type_id is required.');
      validateValues(r, payload, false);
      const merged = await normalise(r, org(req), ind, payload, null);
      if (!has(merged.vin)) throw bad('vin is required.');
      await assertRules(r, org(req), ind, merged, null);
      const { data, error } = await supabaseAdmin.from(r.table).insert({ ...payload, industry_type_id: ind, organization_id: org(req) }).select().single();
      if (error) { if (error.code === '23505') throw dup(r, error); throw error; }
      await afterSave(r, org(req), ind, data as Row, null, req.industryScope, req.auth?.sub);
      created.push(String((data as Row).vin));
    } catch (e) { errors.push({ row: i + 1, vin: str(item?.vin), error: e instanceof Error ? e.message : 'Could not save' }); }
  }
  res.status(created.length ? 201 : 400).json({ data: { created: created.length, vins: created, errors } });
});

// POST /vehicle/units/pdi-pass { vins: [...] }: PDI done -> Received / PDI Pending units become Available and serve waiting bookings.
vehicleRouter.post('/vehicle/units/pdi-pass', authenticate, manager, async (req, res) => {
  const ind = insightInd(req);
  const vins = (req.body as { vins?: unknown })?.vins;
  if (!Array.isArray(vins) || !vins.length) throw bad('vins must be a non-empty array.');
  const { data, error } = await supabaseAdmin.from('vehicle_units').update({ status: 'Available' }).eq('organization_id', org(req)).eq('industry_type_id', ind).in('vin', vins.map((v) => String(v).trim().toUpperCase())).in('status', ['Received', 'PDI Pending']).select('vin, model_id');
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  for (const m of new Set(rows.map((x) => String(x.model_id)))) await allocatePendingBookings(org(req), ind, m);
  res.json({ data: { passed: rows.length, vins: rows.map((x) => x.vin) } });
});

// ---------------------------------------------------------------- generic CRUD
for (const r of VEHICLE_RESOURCES) {
  const base = `/vehicle/${r.path}`;
  const notFound = () => new AppError(404, 'RECORD_NOT_FOUND', `${r.path} record was not found.`);
  const writer = r.write === 'rep' ? writerRep : manager;
  const datedStatuses = ['vehicle_schemes', 'vehicle_insurance_policies', 'vehicle_warranties'].includes(r.table);

  vehicleRouter.get(base, authenticate, reader, async (req, res) => {
    const ind = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
    if (datedStatuses) await refreshDateStatuses(r, org(req), ind);
    if (r.table === 'vehicle_deliveries') await refreshDeliveryPayments(org(req), ind);
    if (r.table === 'vehicle_models') { // models saved before Step 2 get their product now
      let mq = supabaseAdmin.from('vehicle_models').select('*').eq('organization_id', org(req)).is('product_id', null);
      if (ind) mq = mq.eq('industry_type_id', ind);
      for (const m of ((await mq).data ?? []) as Row[]) await syncModelProduct(org(req), m.industry_type_id as string, m);
    }
    let q = supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).order('created_at', { ascending: false });
    if (ind) q = q.eq('industry_type_id', ind);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ data });
  });

  vehicleRouter.get(`${base}/:id`, authenticate, reader, async (req, res) => {
    const { data, error } = await supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    assertRecordInScope(req.industryScope!, (data as Row).industry_type_id as string | null, notFound());
    res.json({ data });
  });

  vehicleRouter.post(base, authenticate, writer, async (req, res) => {
    const payload = clean(r, req.body);
    const ind = resolveIndustryTypeId(req.industryScope!, typeof payload.industry_type_id === 'string' ? payload.industry_type_id : undefined);
    if (!ind) throw bad('industry_type_id is required.');
    validateValues(r, payload, false);
    const autoCode = !has(payload[r.codeField]) && r.codeField !== 'vin';
    if (autoCode) payload[r.codeField] = await nextVehicleCode(r.table, r.prefix, org(req));
    const merged = await normalise(r, org(req), ind, payload, null);
    const missing = r.requiredFields.filter((k) => !has(merged[k]));
    if (missing.length) throw bad(`${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required.`);
    await assertRules(r, org(req), ind, merged, null);
    let attempt = 0;
    for (;;) {
      const { data, error } = await supabaseAdmin.from(r.table).insert({ ...payload, industry_type_id: ind, organization_id: org(req) }).select().single();
      if (error) {
        if (error.code === '23505' && autoCode && attempt < 5) { attempt += 1; payload[r.codeField] = await nextVehicleCode(r.table, r.prefix, org(req), attempt); continue; }
        if (error.code === '23505') throw dup(r, error);
        throw error;
      }
      await afterSave(r, org(req), ind, data as Row, null, req.industryScope, req.auth?.sub);
      res.status(201).json({ data });
      return;
    }
  });

  vehicleRouter.patch(`${base}/:id`, authenticate, writer, async (req, res) => {
    const payload = clean(r, req.body);
    delete payload.industry_type_id; // a record never moves between industries
    validateValues(r, payload, true);
    const { data: existing, error: e1 } = await supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
    if (e1) throw e1;
    if (!existing) throw notFound();
    const ex = existing as Row;
    assertRecordInScope(req.industryScope!, ex.industry_type_id as string | null, notFound());
    const ind = ex.industry_type_id as string;
    if (ex.status === 'Delivered' && r.table === 'vehicle_deliveries' && payload.status && payload.status !== 'Delivered') throw bad('A delivered vehicle cannot be moved back.');
    const merged = await normalise(r, org(req), ind, payload, ex);
    await assertRules(r, org(req), ind, merged, ex);
    const { data, error } = await supabaseAdmin.from(r.table).update(payload).eq('organization_id', org(req)).eq('id', idOf(req)).select().maybeSingle();
    if (error) { if (error.code === '23505') throw dup(r, error); throw error; }
    if (!data) throw notFound();
    await afterSave(r, org(req), ind, data as Row, ex, req.industryScope, req.auth?.sub);
    res.json({ data });
  });

  vehicleRouter.delete(`${base}/:id`, authenticate, manager, async (req, res) => {
    const { data: existing, error: e1 } = await supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
    if (e1) throw e1;
    if (!existing) throw notFound();
    assertRecordInScope(req.industryScope!, (existing as Row).industry_type_id as string | null, notFound());
    await assertCanDelete(r, org(req), existing as Row);
    const { data, error } = await supabaseAdmin.from(r.table).delete().eq('organization_id', org(req)).eq('id', idOf(req)).select().maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    if (r.table === 'vehicle_models') await retireModelProduct(org(req), existing as Row);
    if (r.table === 'vehicle_bookings' && has((existing as Row).vin)) await setUnitStatus(org(req), (existing as Row).industry_type_id as string, (existing as Row).vin, 'Available', HELD);
    res.json({ data });
  });
}