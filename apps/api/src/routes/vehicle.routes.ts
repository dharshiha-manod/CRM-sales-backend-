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
  allocatePendingBookings, deliveryStageFor, followUpAfterTestDrive, insuranceSourceOf, nextVehicleCode, onBookingAllocated, ownerOfVin,
  refreshDeliveryPayments, releaseBookingFiles, representativeFor, resolveParty, retireModelProduct, syncModelProduct, syncProductModel, isVehicleIndustry, ensureBookingInsurance, tryAllocate,
} from '../lib/vehicle-links.js';
import { collectionsService } from '../services/collections.service.js';
import { cancelOrder } from '../repositories/orders.repository.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { runVehicleAftersales, scheduleNextService } from '../services/vehicle-aftersales.service.js';
import { parseLabourAmount, parsePartsUsed } from '../lib/vehicle-calc.js';
import { enqueueCustomerMessage, processCustomerMessages } from '../lib/vehicle-notify.js';
import { syncDeliveryDocuments } from '../lib/vehicle-doc-sync.js';
import { backfillVehicleInvoices, cancelVehicleInvoices, ensureVehicleInvoice, markVehicleInvoicePaid } from '../lib/vehicle-invoice.js';
import { customerFacts, schemeFitsCustomer, schemeRefsToIds, vehicleSchemeUsage } from '../lib/vehicle-schemes.js';
import { ALLOWED_DOCUMENT_TYPES, DOCUMENT_BUCKET, MAX_DOCUMENT_BYTES, defaultChecklistFor, documentsComplete, ensureDocumentBucket, normalizeChecklist, pendingDocumentNames, type DeliveryDoc } from '../lib/vehicle-documents.js';
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
// Insurance workflow: a policy starts as a request, is quoted, accepted and covered by a cover note, then becomes the Active policy.
const INSURANCE_SOURCES = ['Dealer arranged', "Customer's own", 'Not required'];
const INSURANCE_PRE_POLICY = ['Requested', 'Quoted', 'Customer Accepted', 'Cover Note Issued'];
const INSURANCE_COVERED = ['Cover Note Issued', 'Active', 'Expiring Soon'];

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
async function normalise(r: VehicleResource, orgId: string, industryTypeId: string, payload: Row, existing: Row | null, role?: string) {
  const m: Row = { ...(existing ?? {}), ...payload };
  // A trade-in valuation is money: only a manager / admin may approve, reject, convert or change the approved value.
  if (r.table === 'vehicle_exchanges' && !['super_admin', 'admin', 'sales_manager'].includes(String(role ?? ''))) {
    const moving = payload.status !== undefined && payload.status !== null && ['Approved', 'Rejected', 'Converted'].includes(String(payload.status)) && payload.status !== existing?.status;
    const valued = payload.approved_value !== undefined && num(payload.approved_value) !== num(existing?.approved_value);
    if (moving || valued) throw new AppError(403, 'EXCHANGE_APPROVAL_MANAGER_ONLY', 'Only a manager can approve, reject or value a trade-in. Ask a manager to complete this step.');
  }
  for (const k of ['vin', 'new_vehicle_vin']) {
    if (typeof payload[k] === 'string') payload[k] = (payload[k] as string).trim().toUpperCase();
  }
  // Model / dealer names always come from the linked master record.
  if (r.columns.includes('model_id') && has(payload.model_id)) {
    const model = await findOne('vehicle_models', orgId, industryTypeId, 'id', payload.model_id);
    if (!model) throw bad('The selected model does not exist.', 'INVALID_REFERENCE');
       payload.model_name = model.model_name;
    if (r.table === 'vehicle_units') payload.variant = model.variant ?? null;
    // Blank VIN on a new unit -> temporary VIN, same pattern as Products "Opening units".
    if (r.table === 'vehicle_units' && !existing && !has(payload.vin)) {
      let n = (await countWhere('vehicle_units', orgId, 'model_id', payload.model_id)) + 1;
      const tempVin = (i: number) => `TEMP-${String(model.model_code)}-${String(i).padStart(3, '0')}`;
      while (await findOne('vehicle_units', orgId, industryTypeId, 'vin', tempVin(n))) n += 1;
      payload.vin = tempVin(n);
    }
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
  // Automation: a booking with no dealer takes the showroom's own Branch, when the showroom has exactly one.
  if (r.table === 'vehicle_bookings' && !has(m.dealer_id) && !has(payload.dealer_id)) {
    const { data: branches } = await supabaseAdmin.from('vehicle_dealers').select('id, dealer_name').eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('dealer_type', 'Branch').limit(2);
    if (branches && branches.length === 1) { payload.dealer_id = (branches[0] as Row).id; payload.dealer_name = (branches[0] as Row).dealer_name; }
  }
  // Insurance on a booking is chosen as a source; the older Yes / No flag always follows it (other code still reads the flag).
  if (r.table === 'vehicle_bookings') {
    const isYes = (v: unknown) => ['yes', 'true', 'y'].includes(String(v ?? '').trim().toLowerCase());
    if (has(payload.insurance_required) && !has(payload.insurance_source)) {
      const src = isYes(payload.insurance_required) ? (has(existing?.insurance_source) && existing?.insurance_source !== 'Not required' ? String(existing?.insurance_source) : 'Dealer arranged') : 'Not required';
      payload.insurance_source = src; m.insurance_source = src;
    } else if (INSURANCE_SOURCES.includes(String(m.insurance_source ?? ''))) {
      const need = m.insurance_source === 'Not required' ? 'No' : 'Yes';
      payload.insurance_required = need; m.insurance_required = need;
    } else if (isYes(m.insurance_required) && !has(m.insurance_source)) {
      payload.insurance_source = 'Dealer arranged'; m.insurance_source = 'Dealer arranged';
    }
  }
  if (r.table === 'vehicle_deliveries' && has(payload.vin)) {
    const unit = await findOne('vehicle_units', orgId, industryTypeId, 'vin', payload.vin);
    if (unit && !has(m.engine_number) && unit.engine_number) payload.engine_number = unit.engine_number;
  }
  // Picking the Core order fills the rest: its client, and (when the order has exactly one booked vehicle) the VIN / booking number / amount paid.
  if (['vehicle_returns', 'vehicle_finance_applications', 'vehicle_exchanges', 'vehicle_deliveries'].includes(r.table) && has(m.order_id)) {
    const { data: ord } = await supabaseAdmin.from('sale_orders').select('id, client_id').eq('organization_id', orgId).eq('id', String(m.order_id)).maybeSingle();
    if (ord) {
      if (r.columns.includes('client_id') && !has(m.client_id) && has((ord as Row).client_id)) payload.client_id = (ord as Row).client_id;
      const vinKey = r.columns.includes('vin') ? 'vin' : r.columns.includes('new_vehicle_vin') ? 'new_vehicle_vin' : null;
      const refKey = ['booking_number', 'booking_reference'].find((k) => r.columns.includes(k));
      if ((vinKey && !has(m[vinKey])) || (refKey && !has(m[refKey]))) {
        const { data: bks } = await supabaseAdmin.from('vehicle_bookings').select('booking_number, vin').eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('order_id', String(m.order_id)).neq('status', 'Cancelled').limit(5);
        const live = (bks ?? []) as Row[];
        const withVin = live.filter((b) => has(b.vin));
        const one = withVin.length === 1 ? withVin[0]! : live.length === 1 ? live[0]! : null;
        if (one) {
          if (vinKey && !has(m[vinKey]) && has(one.vin)) payload[vinKey] = one.vin;
          if (refKey && !has(m[refKey])) payload[refKey] = one.booking_number;
        }
      }
      if (r.table === 'vehicle_returns' && !has(m.amount)) { // what the customer has paid on the order
        const { data: coll } = await supabaseAdmin.from('sales_collections').select('amount').eq('organization_id', orgId).eq('sale_order_id', String(m.order_id));
        const paid = ((coll ?? []) as Row[]).reduce((t, c) => t + num(c.amount), 0);
        if (paid > 0) payload.amount = paid;
      }
    }
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
  // Finance / Exchange / Returns keep the order number in sales_order_reference: picking the Core order fills it.
  if (!r.columns.includes('order_number') && r.columns.includes('sales_order_reference') && r.columns.includes('order_id') && has(payload.order_id)) {
    const { data: ord } = await supabaseAdmin.from('sale_orders').select('order_number').eq('organization_id', orgId).eq('id', payload.order_id as string).maybeSingle();
    if (!ord) throw bad('The selected order does not exist.', 'INVALID_REFERENCE');
    payload.sales_order_reference = (ord as Row).order_number;
  }
  // Booking -> Core Order: a booking turned into an order links to the client's matching open order (no second order ledger).
  // Automation: any live booking (not only 'Converted to Order') links itself to the client's matching open Core order, so nobody picks it by hand.
  if (r.table === 'vehicle_bookings' && m.status !== 'Cancelled' && !has(m.order_id) && !has(payload.order_id)) {
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
    // A manager / admin can approve a scheme; everyone else is held back by the rules below.
    const canApprove = ['super_admin', 'admin', 'sales_manager'].includes(String(role ?? ''));
    if (str(scheme.approval_required) === 'Yes' && !canApprove) throw bad(`Scheme "${key}" needs manager approval. Ask a manager to select it on this booking.`, 'SCHEME_APPROVAL_REQUIRED');
    if (has(scheme.customer_type) && scheme.customer_type !== 'All customers') {
      const facts = await customerFacts(orgId, m.client_id, has(m.order_id) ? String(m.order_id) : null);
      if (!canApprove && !(facts && schemeFitsCustomer(scheme.customer_type, facts.clientType, facts.isRepeat))) throw bad(`Scheme "${key}" is only for ${String(scheme.customer_type)} customers${facts ? '' : ' (pick the client on this booking first)'}. Ask a manager to select it for this customer.`, 'SCHEME_NOT_APPLICABLE');
    }
    // The linked order may already carry a scheme discount: another discount scheme cannot be stacked on the booking (an Exchange Bonus still can).
    if (has(m.order_id) && (num(scheme.discount_value) > 0 || num(scheme.cash_discount) > 0)) {
      const { data: lines } = await supabaseAdmin.from('sale_order_items').select('vehicle_scheme_ref, vehicle_scheme_name').eq('order_id', String(m.order_id)).not('vehicle_scheme_ref', 'is', null);
      const applied = ((lines ?? []) as Row[]).flatMap((l) => schemeRefsToIds(l.vehicle_scheme_ref));
      if (applied.length && !applied.includes(str(scheme.scheme_id))) throw bad(`Order ${str(m.order_number)} already has the scheme "${((lines ?? []) as Row[]).map((l) => str(l.vehicle_scheme_name)).filter(Boolean).join(', ')}" applied. Only an Exchange Bonus scheme can be added on the booking.`, 'SCHEME_ALREADY_APPLIED');
    }
    const benefit = [
      num(scheme.cash_discount) > 0 ? `cash discount ${num(scheme.cash_discount)}` : '',
      num(scheme.discount_value) > 0 ? `${String(scheme.discount_type ?? 'discount')} ${num(scheme.discount_value)}` : '',
      num(scheme.exchange_bonus) > 0 ? `exchange bonus ${num(scheme.exchange_bonus)}` : '',
      has(scheme.finance_offer) ? `finance: ${String(scheme.finance_offer)}` : '', has(scheme.accessories_offer) ? `accessories: ${String(scheme.accessories_offer)}` : '', has(scheme.insurance_offer) ? `insurance: ${String(scheme.insurance_offer)}` : '',
    ].filter(Boolean).join(', ');
    const note = `Scheme ${String(scheme.scheme_name)}${benefit ? ` — ${benefit}` : ''}.`;
    if (!str(m.remarks).includes(`Scheme ${String(scheme.scheme_name)}`)) payload.remarks = [str(m.remarks), note].filter(Boolean).join('\n');
  }
  if (r.table === 'vehicle_schemes') {
    if (has(m.start_date) && has(m.end_date) && String(m.end_date) < String(m.start_date)) throw bad('End date cannot be before the start date.', 'INVALID_DATE_RANGE');
    const dtype = String(m.discount_type ?? '');
    if (['Percentage', 'Fixed Amount', 'Per Vehicle'].includes(dtype) && num(m.discount_value) <= 0) throw bad('Enter the discount value.', 'INVALID_DISCOUNT');
    if (dtype === 'Exchange Bonus' && num(m.exchange_bonus) <= 0) throw bad('Enter the exchange bonus amount.', 'INVALID_DISCOUNT');
    // boxes that do not belong to the chosen type are cleared, so old hidden values never count as credit
    const keep: Record<string, string[]> = { 'Percentage': ['discount_value'], 'Fixed Amount': ['discount_value'], 'Per Vehicle': ['discount_value'], 'Exchange Bonus': ['exchange_bonus'], 'Campaign Offer': ['cash_discount', 'exchange_bonus'] };
    if (keep[dtype]) for (const k of ['discount_value', 'cash_discount', 'exchange_bonus']) if (!keep[dtype]!.includes(k) && has(m[k])) payload[k] = null;
    if (String(m.discount_type) === 'Percentage' && num(m.discount_value) > 100) throw bad('A percentage discount cannot be more than 100.', 'INVALID_DISCOUNT');
    if (!has(m.status)) payload.status = 'Active'; // a new scheme is live unless saved as Draft
    if (!has(m.approval_required)) payload.approval_required = 'No';
    if (!has(m.terms)) { // written automatically when left blank
      const bits = [`Valid ${has(m.start_date) ? `from ${String(m.start_date)}` : 'from today'}${has(m.end_date) ? ` to ${String(m.end_date)}` : ' until withdrawn'}`];
      if (has(m.model_name)) bits.push(`on ${String(m.model_name)}`);
      if (has(m.dealer_name)) bits.push(`at ${String(m.dealer_name)}`);
      if (has(m.customer_type) && m.customer_type !== 'All customers') bits.push(`for ${String(m.customer_type)} customers`);
      payload.terms = `${bits.join(' ')}.`;
    }
    if ((payload.status ?? m.status) === 'Active' && has(m.end_date) && String(m.end_date) < todayLocal()) payload.status = 'Expired'; // already over
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
  if (r.table === 'vehicle_invoices') { // the total is always calculated here, never trusted from the browser
    if (!has(m.invoice_date)) payload.invoice_date = todayLocal();
     if (!has(m.due_date)) payload.due_date = String(payload.invoice_date ?? m.invoice_date).slice(0, 10);
    if (!has(m.status)) payload.status = 'Issued';
    const total = Math.round((num(m.subtotal) - num(m.discount_amount) + num(m.tax_amount)) * 100) / 100;
    payload.total_amount = total;
    if ((payload.status ?? m.status) === 'Paid') payload.paid_amount = total;
  }
  if (r.table === 'vehicle_insurance_policies') {
    // Who arranges the cover: a policy opened from a booking keeps that booking's choice; one typed in by hand is dealer arranged.
    if (!['Dealer arranged', "Customer's own"].includes(String(m.insurance_source ?? ''))) {
      let source = 'Dealer arranged';
      if (has(m.booking_number)) {
        const booking = await findOne('vehicle_bookings', orgId, industryTypeId, 'booking_number', m.booking_number);
        if (booking && insuranceSourceOf(booking) === "Customer's own") source = "Customer's own";
      }
      payload.insurance_source = source; m.insurance_source = source;
    }
    if (!has(m.policy_type)) { payload.policy_type = 'Comprehensive'; m.policy_type = 'Comprehensive'; }
    if (!has(m.coverage)) { payload.coverage = `${String(m.policy_type)} cover${has(m.vin) ? ` for ${String(m.vin)}` : ''}`; m.coverage = payload.coverage; }
    // Less typing: dates and status follow by themselves (Cancelled is the only status chosen by hand).
    const isDay = (v: unknown) => /^\d{4}-\d{2}-\d{2}/.test(String(v ?? ''));
    const today = todayLocal();
    if (!isDay(m.start_date)) { payload.start_date = today; m.start_date = today; }
    if (!isDay(m.expiry_date)) {
      const d = new Date(`${String(m.start_date).slice(0, 10)}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1);
      const exp = d.toISOString().slice(0, 10); payload.expiry_date = exp; m.expiry_date = exp;
    }
    if (m.status !== 'Cancelled' && !INSURANCE_PRE_POLICY.includes(String(m.status ?? ''))) { // Requested / Quoted / Customer Accepted / Cover Note Issued are chosen by hand
      const exp = String(m.expiry_date).slice(0, 10);
      const soon = new Date(`${today}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 30);
      const st = exp < today ? 'Expired' : exp <= soon.toISOString().slice(0, 10) ? 'Expiring Soon' : 'Active';
      payload.status = st; m.status = st;
    }
  }
  if (r.table === 'vehicle_deliveries') {
    // Document checklist (Vehicle only): when a delivery has one, Documentation follows it by itself - it cannot be set by hand.
    const checklist = Array.isArray(m.document_checklist) ? (m.document_checklist as DeliveryDoc[]) : [];
    if (checklist.length) { const docStatus = documentsComplete(checklist) ? 'Complete' : 'Pending'; payload.documentation_status = docStatus; m.documentation_status = docStatus; }
    const status = String(m.status ?? '');
    if (['Preparation', 'PDI Pending', 'Documentation Pending', 'Payment Pending', 'Ready for Delivery'].includes(status)) {
      payload.status = deliveryStageFor(m);
    }
    // handing over now: a blank date, or a planned (future) date, becomes today's date
    if ((payload.status ?? m.status) === 'Delivered' && existing?.status !== 'Delivered' && (!has(m.delivery_date) || String(m.delivery_date) > todayLocal())) {
      payload.delivery_date = todayLocal(); m.delivery_date = payload.delivery_date;
    }
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
  if (r.table === 'vehicle_insurance_policies' && status !== 'Cancelled') {
    // Real-world insurance flow. Dealer arranged: the showroom gets the quote, the customer accepts, the insurer issues a cover note, then the policy.
    // Customer's own: the customer already bought cover elsewhere, so there is no quote / acceptance / cover note: the showroom only collects and checks the policy copy.
    const own = m.insurance_source === "Customer's own";
    if (own && ['Quoted', 'Customer Accepted', 'Cover Note Issued'].includes(status)) throw bad('The customer arranged this insurance, so there is no quote or cover note to track. Collect the policy copy, then set the status to Active.');
    if (['Quoted', 'Customer Accepted', 'Cover Note Issued', 'Active'].includes(status) && !has(m.provider)) throw bad(own ? 'Enter the insurance company named on the customer\u2019s policy.' : 'Enter the insurance provider that gave the quote.');
    if (!own && ['Quoted', 'Customer Accepted', 'Cover Note Issued', 'Active'].includes(status) && !has(m.premium)) throw bad('Enter the premium from the insurer\u2019s quote.');
    if (['Cover Note Issued', 'Active'].includes(status) && !has(m.policy_document_reference)) throw bad(own ? 'Enter the policy number from the customer\u2019s policy copy.' : 'Enter the insurer\u2019s cover note / policy number.');
  }

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
           // a booking whose vehicle was already handed over no longer holds it (matters when a returned vehicle is sold again)
      const handedOver = (others ?? []).length ? new Set(((((await supabaseAdmin.from('vehicle_deliveries').select('booking_number').eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', m.vin as string).eq('status', 'Delivered')).data) ?? []) as Row[]).map((x) => str(x.booking_number))) : new Set<string>();
      const liveOthers = ((others ?? []) as Row[]).filter((o) => !handedOver.has(str(o.booking_number)));
      if (liveOthers.length) throw new AppError(409, 'VIN_ALREADY_BOOKED',`Vehicle ${String(m.vin)} is already held by booking ${String(liveOthers[0]!.booking_number)}. Open that booking and edit it instead of adding a new one, or pick a different Available VIN.`);
      if (BLOCKED_UNIT.includes(String(unit.status))) throw bad(`Vehicle ${String(m.vin)} is ${String(unit.status)} and cannot be booked.`);
    }
  }
  if (r.table === 'vehicle_deliveries') {
    // a failed PDI / a cancelled delivery must say why
    if (m.pdi_status === 'Failed' && !has(m.remarks)) throw bad('Enter the reason in Remarks when PDI is marked Failed.');
    if (status === 'Cancelled' && !has(m.remarks)) throw bad('Enter the cancellation reason in Remarks.');
    if (existing?.status === 'Cancelled' && status !== 'Cancelled') throw bad('A cancelled delivery cannot be reopened. Create a new delivery instead.');
    // a vehicle can be on one open delivery only, and only a vehicle that can still be sold
    if (has(m.vin) && status !== 'Cancelled' && (!existing || existing.vin !== m.vin)) {
      const unit = await findOne('vehicle_units', orgId, ind, 'vin', m.vin);
      if (unit && BLOCKED_UNIT.includes(String(unit.status))) throw bad(`Vehicle ${String(m.vin)} is ${String(unit.status)} and cannot be put on a delivery.`);
      let dq = supabaseAdmin.from('vehicle_deliveries').select('delivery_number').eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', String(m.vin)).not('status', 'in', '(Delivered,Cancelled)');
      if (existing?.id) dq = dq.neq('id', existing.id as string);
      const { data: openOnes, error: dErr } = await dq.limit(1);
      if (dErr) throw dErr;
      if ((openOnes ?? []).length) throw new AppError(409, 'VIN_ALREADY_IN_DELIVERY', `Vehicle ${String(m.vin)} is already on open delivery ${String((openOnes as Row[])[0]!.delivery_number)}. Open that delivery instead, or pick a different vehicle.`);
    }
  }
  if (r.table === 'vehicle_deliveries' && status === 'Delivered') {
    if (!has(m.vin)) throw bad('Select the vehicle (VIN) before marking the delivery as Delivered.');
    const gaps: string[] = [];
    if (!['Fitted', 'Not Applicable'].includes(String(m.accessories_status))) gaps.push('accessories must be Fitted (or Not Applicable)');
    if (m.pdi_status !== 'Passed') gaps.push('PDI must be Passed');
    const checklist = Array.isArray(m.document_checklist) ? (m.document_checklist as DeliveryDoc[]) : [];
    if (checklist.length && !documentsComplete(checklist)) gaps.push(`documents still pending: ${pendingDocumentNames(checklist).join(', ')}`);
    else if (m.documentation_status !== 'Complete') gaps.push('documentation must be Complete');
    if (m.payment_status !== 'Complete') gaps.push('payment must be Complete');
    // insurance is always settled before handover: a policy is added (Complete) or the customer does not need one (Not Applicable)
    if (!['Complete', 'Not Applicable'].includes(String(m.insurance_status))) gaps.push('insurance must be Complete (add the policy in Insurance) or set to Not Applicable');
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
      else if (status === 'Cancelled' && changed('status')) await setUnitStatus(orgId, ind, row.vin, 'Available', HELD);
    }
    if (status === 'Cancelled') { if (changed('status')) await releaseBookingFiles(orgId, ind, { ...row, model_id: row.model_id ?? before?.model_id }); } // open delivery + invoice cancelled, VIN released to the next waiting booking
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
    if (row.status === 'Cancelled') { if (changed('status')) await cancelVehicleInvoices(orgId, ind, { vin: row.vin, orderId: row.order_id }); }
    else {
      await ensureVehicleInvoice(orgId, ind, row); // one tax invoice per vehicle on the order, raised by itself
      if (row.payment_status === 'Complete') await markVehicleInvoicePaid(orgId, ind, row.vin, row.order_id);
      await syncDeliveryDocuments(orgId, ind, row.vin); // the Tax invoice paper ticks itself
    }
    if (row.status === 'Delivered' && changed('status')) await onDelivered(orgId, ind, row);
    else if (!['Delivered', 'Cancelled'].includes(String(row.status))) await refreshDeliveryPayments(orgId, ind);
  }

  if (r.table === 'vehicle_registrations') {
       if (row.status === 'Completed' && has(row.registration_number)) {
      await supabaseAdmin.from('vehicle_service_records').update({ registration_number: row.registration_number }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string).is('registration_number', null); // service files show the plate once it is issued
      await supabaseAdmin.from('vehicle_units').update({ registration_number: row.registration_number }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string);
      await supabaseAdmin.from('vehicle_deliveries').update({ registration_status: 'Complete' }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string).neq('status', 'Cancelled');
    }
  }

  if (r.table === 'vehicle_insurance_policies') {
    if (INSURANCE_COVERED.includes(String(row.status)) && has(row.vin)) { // a cover note is valid cover, so the delivery file counts it
      await supabaseAdmin.from('vehicle_deliveries').update({ insurance_status: 'Complete' }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string).neq('status', 'Cancelled');
      await supabaseAdmin.from('vehicle_registrations').update({ insurance_reference: row.policy_number }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string).is('insurance_reference', null);
    } else if (['Cancelled', 'Expired'].includes(String(row.status)) && has(row.vin)) { // the only cover is gone: the delivery is no longer insured
      const { data: live } = await supabaseAdmin.from('vehicle_insurance_policies').select('id').eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string).in('status', INSURANCE_COVERED).limit(1);
      if (!(live ?? []).length) await supabaseAdmin.from('vehicle_deliveries').update({ insurance_status: 'Pending' }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', row.vin as string).eq('insurance_status', 'Complete').in('status', DELIVERY_OPEN);
    }
  }

  // Loan money / exchange value count towards the order's payment; the delivery's payment status follows by itself.
  if (scope && has(row.order_id)) {
    if (r.table === 'vehicle_finance_applications' && row.status === 'Disbursed') await postOrderPayment(orgId, scope, row.order_id, num(row.disbursed_amount), String(row.application_number), `Loan disbursed ${String(row.application_number)}`);
    if (r.table === 'vehicle_exchanges' && ['Approved', 'Converted'].includes(String(row.status))) {
      await postOrderPayment(orgId, scope, row.order_id, has(row.net_exchange_value) ? num(row.net_exchange_value) : num(row.approved_value), String(row.exchange_id), `Exchange value ${String(row.exchange_id)}`);
    }
  }
  if (r.table === 'vehicle_finance_applications' && row.status === 'Rejected' && changed('status') && has(row.client_id)) { // a rejected loan must not sit unnoticed: the rep calls the customer
    try {
      const rep = await representativeFor(orgId, ind, row.client_id, null);
      const title = `Loan rejected: ${str(row.client_name) || 'customer'}${has(row.vin) ? ` - ${str(row.vin)}` : ''} (${str(row.application_number)})`;
      if (rep) {
        const { data: dupF } = await supabaseAdmin.from('follow_ups').select('id').eq('organization_id', orgId).eq('client_id', row.client_id as string).eq('title', title).limit(1).maybeSingle();
        if (!dupF) await supabaseAdmin.from('follow_ups').insert({ organization_id: orgId, representative_id: rep, client_id: row.client_id, title, due_at: new Date(Date.now() + 3_600_000).toISOString(), priority: 'high', follow_up_type: 'call', notes: `Finance application ${str(row.application_number)} was rejected${has(row.finance_provider) ? ` by ${str(row.finance_provider)}` : ''}. Offer another lender or a higher down payment; the delivery cannot be paid in full until this is settled.` });
      }
    } catch (e) { logger.warn({ err: e, application: row.application_number }, 'vehicle: loan-rejected follow-up could not be created'); }
  }
  if (r.table === 'vehicle_finance_applications' || r.table === 'vehicle_exchanges') await refreshDeliveryPayments(orgId, ind);
  if (r.table === 'vehicle_finance_applications' || r.table === 'vehicle_insurance_policies') await syncDeliveryDocuments(orgId, ind, row.vin);

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
    if (changed('status')) { // the customer hears that the vehicle is ready
      await enqueueCustomerMessage(orgId, ind, { key: `srv-done:${String(row.id)}`, kind: 'service_done', clientId: row.client_id, subject: 'Your vehicle service is complete', body: `Dear ${str(row.client_name) || 'Customer'}, the service of your vehicle ${str(row.vin)} (${str(row.service_number)}) is complete. Thank you for choosing us.` });
      void processCustomerMessages(orgId);
    }
  }

  if (r.table === 'vehicle_returns') {
    const status = String(row.status);
    if (row.return_type === 'Booking Cancellation' && status === 'Approved' && changed('status') && has(row.booking_reference)) {
      const booking = await findOne('vehicle_bookings', orgId, ind, 'booking_number', row.booking_reference);
      if (booking && booking.status !== 'Cancelled') {
        await supabaseAdmin.from('vehicle_bookings').update({ status: 'Cancelled', cancellation_reason: str(row.reason) || `Return ${String(row.return_number)}` }).eq('id', booking.id as string);
        await releaseBookingFiles(orgId, ind, booking); // its open delivery + invoice are cancelled and the VIN goes to the next waiting booking
      }
    }
    if (['Vehicle Return', 'Sales Cancellation'].includes(String(row.return_type)) && status === 'Vehicle Received' && has(row.vin)) {
      await setUnitStatus(orgId, ind, row.vin, 'Returned');
    }
    // Exchange cancellation approved: the trade-in on that order is withdrawn (any money already credited is refunded through this return's refund amount).
    if (row.return_type === 'Exchange Cancellation' && status === 'Approved' && changed('status') && has(row.order_id)) {
      await supabaseAdmin.from('vehicle_exchanges').update({ status: 'Rejected' }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('order_id', String(row.order_id)).in('status', ['Approved', 'Converted']);
      await refreshDeliveryPayments(orgId, ind);
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
  if (has(d.booking_number) && has(d.order_id)) { // the booking has done its job: it is now an order that was delivered
    await supabaseAdmin.from('vehicle_bookings').update({ status: 'Converted to Order' }).eq('organization_id', orgId).eq('industry_type_id', ind).eq('booking_number', String(d.booking_number)).in('status', ['Reserved', 'Confirmed', 'Allocation Pending', 'Vehicle Allocated']);
  }
  if (has(d.order_id)) { // handed over and fully paid (the Delivered gate checks payment): the Core order is done
    const left = await countWhere('vehicle_deliveries', orgId, 'order_id', d.order_id, (q) => q.neq('status', 'Delivered').neq('status', 'Cancelled'));
    if (left === 0) await supabaseAdmin.from('sale_orders').update({ status: 'completed' }).eq('organization_id', orgId).eq('id', d.order_id as string).eq('status', 'confirmed');
  }
  const base = { organization_id: orgId, industry_type_id: ind, vin, client_name: d.client_name, client_id: d.client_id ?? null };
  const regR = resOf('registrations'), warR = resOf('warranties');
  const { data: reg } = await supabaseAdmin.from('vehicle_registrations').select('id, client_id, client_name').eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', vin).maybeSingle();
  const sameOwner = (o: Row | null) => !o || (has(o.client_id) && has(d.client_id) ? o.client_id === d.client_id : str(o.client_name) === str(d.client_name));
  if (reg && !sameOwner(reg as Row)) { // a returned vehicle sold again: the new owner needs a fresh registration (ownership transfer)
    await supabaseAdmin.from('vehicle_registrations').update({ client_name: d.client_name, client_id: d.client_id ?? null, delivery_reference: d.delivery_number, invoice_reference: d.sales_order_reference ?? null, status: 'Pending', completion_date: null, submitted_date: null, remarks: `Vehicle sold again to ${str(d.client_name)}: transfer of ownership needed.` }).eq('id', (reg as Row).id as string);
  }
  if (!reg) {
    await supabaseAdmin.from('vehicle_registrations').insert({ ...base, engine_number: d.engine_number ?? null, delivery_reference: d.delivery_number, invoice_reference: d.sales_order_reference ?? null, status: 'Pending' });
  }
  const { data: war } = await supabaseAdmin.from('vehicle_warranties').select('id, client_id, client_name').eq('organization_id', orgId).eq('industry_type_id', ind).eq('vin', vin).maybeSingle();
  if (war && !sameOwner(war as Row)) await supabaseAdmin.from('vehicle_warranties').update({ client_name: d.client_name, client_id: d.client_id ?? null }).eq('id', (war as Row).id as string); // the warranty stays with the vehicle, the owner changes
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
const VIN_CHILDREN: [string, string][] = [['vehicle_bookings', 'vin'], ['vehicle_test_drives', 'vin'], ['vehicle_deliveries', 'vin'], ['vehicle_registrations', 'vin'], ['vehicle_finance_applications', 'vin'], ['vehicle_insurance_policies', 'vin'], ['vehicle_warranties', 'vin'], ['vehicle_service_records', 'vin'], ['vehicle_returns', 'vin'], ['vehicle_invoices', 'vin'], ['vehicle_exchanges', 'new_vehicle_vin']];
async function assertCanDelete(r: VehicleResource, orgId: string, row: Row) {
  const inUse = (what: string) => new AppError(409, 'RECORD_IN_USE', `This record is used by ${what}. Remove or reassign them first.`);
  if (r.table === 'vehicle_models') {
    const n = (await countWhere('vehicle_units', orgId, 'model_id', row.id)) + (await countWhere('vehicle_bookings', orgId, 'model_id', row.id)) + (await countWhere('vehicle_test_drives', orgId, 'model_id', row.id)) + (await countWhere('vehicle_schemes', orgId, 'model_id', row.id));
    if (n) throw inUse(`${n} unit / booking / test drive / scheme record(s)`);
  }
  if (r.table === 'vehicle_schemes') {
    const used = (await countWhere('vehicle_bookings', orgId, 'scheme_name', row.scheme_name)) + (await countWhere('vehicle_bookings', orgId, 'scheme_name', row.scheme_id));
    const like = `%|${str(row.scheme_id)}|%`;
    const { count: orderLines } = await supabaseAdmin.from('sale_order_items').select('id, sale_orders!inner(organization_id)', { count: 'exact', head: true }).like('vehicle_scheme_ref', like).eq('sale_orders.organization_id', orgId);
    const { count: quoteLines } = await supabaseAdmin.from('quotation_items').select('id, quotations!inner(organization_id)', { count: 'exact', head: true }).like('vehicle_scheme_ref', like).eq('quotations.organization_id', orgId);
    const n = used + (orderLines ?? 0) + (quoteLines ?? 0);
    if (n) throw new AppError(409, 'RECORD_IN_USE', `This scheme is used by ${n} booking / order / quotation record(s), so it cannot be deleted. Set its status to Suspended or Expired instead.`);
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
  if (r.table === 'vehicle_invoices' && row.status !== 'Cancelled') throw new AppError(409, 'RECORD_IN_USE', 'Cancel this invoice first (set its status to Cancelled). Issued invoices are not deleted.');
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
// ---------------------------------------------------------------- delivery document checklist
const DELIVERY_OPEN = ['Preparation', 'PDI Pending', 'Documentation Pending', 'Payment Pending', 'Ready for Delivery'];
const deliveryNotFound = () => new AppError(404, 'RECORD_NOT_FOUND', 'Delivery record was not found.');
async function loadDelivery(req: Req): Promise<Row> {
  const { data, error } = await supabaseAdmin.from('vehicle_deliveries').select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
  if (error) throw error;
  if (!data) throw deliveryNotFound();
  assertRecordInScope(req.industryScope!, (data as Row).industry_type_id as string | null, deliveryNotFound());
  return data as Row;
}
vehicleRouter.get('/vehicle/deliveries/:id/documents', authenticate, reader, async (req, res) => {
  const d = await loadDelivery(req);
  const saved = Array.isArray(d.document_checklist) && d.document_checklist.length > 0;
  const documents = saved ? (d.document_checklist as DeliveryDoc[]) : await defaultChecklistFor(org(req), String(d.industry_type_id), d);
  res.json({ data: { delivery_number: d.delivery_number, client_name: d.client_name, status: d.status, locked: ['Delivered', 'Cancelled'].includes(String(d.status)), saved, documents } });
});
const docPrefix = (req: Req, d: Row) => `${org(req)}/${String(d.id)}/`;
// Step 1 of an upload: the API approves the file (type, size, this delivery's own folder) and hands back a one-time upload token.
vehicleRouter.post('/vehicle/deliveries/:id/documents/upload-url', authenticate, manager, async (req, res) => {
  const d = await loadDelivery(req);
  if (['Delivered', 'Cancelled'].includes(String(d.status))) throw bad('This delivery is closed, so its documents can no longer be changed.');
  const b = (req.body ?? {}) as { contentType?: unknown; size?: unknown };
  const ext = ALLOWED_DOCUMENT_TYPES[String(b.contentType)];
  if (!ext) throw bad('Only PDF, JPG, PNG, WEBP or HEIC files are allowed.');
  const size = Number(b.size);
  if (!size || size > MAX_DOCUMENT_BYTES) throw bad('The file must be under 10 MB.');
  await ensureDocumentBucket();
  const path = `${docPrefix(req, d)}${crypto.randomUUID()}.${ext}`;
  const { data, error } = await supabaseAdmin.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new AppError(500, 'UPLOAD_NOT_READY', `Could not start the upload: ${error?.message ?? 'unknown error'}`);
  res.json({ data: { bucket: DOCUMENT_BUCKET, path, token: data.token } });
});
// View a file: a 5 minute signed link, only for files inside this delivery's folder.
vehicleRouter.get('/vehicle/deliveries/:id/documents/file', authenticate, reader, async (req, res) => {
  const d = await loadDelivery(req);
  const path = String(req.query.path ?? '');
  if (!path.startsWith(docPrefix(req, d)) || path.includes('..')) throw bad('This file does not belong to this delivery.');
  const { data, error } = await supabaseAdmin.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, 300);
  if (error || !data) throw new AppError(404, 'FILE_NOT_FOUND', 'The file could not be found.');
  res.json({ data: { url: data.signedUrl } });
});
vehicleRouter.put('/vehicle/deliveries/:id/documents', authenticate, manager, async (req, res) => {
  const d = await loadDelivery(req);
  if (['Delivered', 'Cancelled'].includes(String(d.status))) throw bad('This delivery is closed, so its documents can no longer be changed.');
  const parsed = normalizeChecklist((req.body as { documents?: unknown } | undefined)?.documents, docPrefix(req, d));
  if (!parsed.ok) throw bad(parsed.message);
  const payload: Row = { document_checklist: parsed.docs };
  if (parsed.docs.length) payload.documentation_status = documentsComplete(parsed.docs) ? 'Complete' : 'Pending';
  if (DELIVERY_OPEN.includes(String(d.status))) payload.status = deliveryStageFor({ ...d, ...payload });
  const { data, error } = await supabaseAdmin.from('vehicle_deliveries').update(payload).eq('organization_id', org(req)).eq('id', idOf(req)).select().maybeSingle();
  if (error) {
    if (/document_checklist/.test(String(error.message))) throw bad('The document_checklist column is missing. Run: alter table vehicle_deliveries add column if not exists document_checklist jsonb;');
    throw error;
  }
  if (!data) throw deliveryNotFound();
  await afterSave(resOf('deliveries'), org(req), String(d.industry_type_id), data as Row, d, req.industryScope, req.auth?.sub);
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
      const merged = await normalise(r, org(req), ind, payload, null, req.industryScope?.role);
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
    if (r.table === 'vehicle_deliveries' || r.table === 'vehicle_invoices') await backfillVehicleInvoices(org(req), ind); // older deliveries get their invoice
    if (r.table === 'vehicle_models') { // models saved before Step 2 get their product now
      let mq = supabaseAdmin.from('vehicle_models').select('*').eq('organization_id', org(req)).is('product_id', null);
      if (ind) mq = mq.eq('industry_type_id', ind);
      for (const m of ((await mq).data ?? []) as Row[]) await syncModelProduct(org(req), m.industry_type_id as string, m);
    }
    if (r.table === 'vehicle_models' && ind && await isVehicleIndustry(org(req), ind)) { // Vehicle products saved without a model row (older saves) get their model now, so every dropdown lists them
      try {
        const { data: tags } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', org(req)).eq('industry_type_id', ind);
        const productIds = ((tags ?? []) as Row[]).map((t) => String(t.product_id));
        if (productIds.length) {
          const { data: linked } = await supabaseAdmin.from('vehicle_models').select('product_id').eq('organization_id', org(req)).in('product_id', productIds);
          const haveModel = new Set(((linked ?? []) as Row[]).map((m) => String(m.product_id)));
          const missing = productIds.filter((id) => !haveModel.has(id));
          if (missing.length) {
            const { data: products } = await supabaseAdmin.from('products').select('*').eq('organization_id', org(req)).in('id', missing);
            for (const p of (products ?? []) as Row[]) await syncProductModel(org(req), p);
          }
        }
      } catch (e) { logger.warn({ err: e }, 'vehicle models: backfill from products failed'); }
    }
    if (r.table === 'vehicle_insurance_policies' && ind) { // bookings that already hold a vehicle but have no insurance file yet (e.g. made before the free-insurance scheme was linked) get it now
      try {
        const { data: held } = await supabaseAdmin.from('vehicle_bookings').select('*').eq('organization_id', org(req)).eq('industry_type_id', ind).not('vin', 'is', null).neq('status', 'Cancelled').limit(50);
        for (const b of (held ?? []) as Row[]) await ensureBookingInsurance(org(req), ind, b);
      } catch (e) { logger.warn({ err: e }, 'vehicle insurance: backfill from bookings failed'); }
    }
    let q = supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).order('created_at', { ascending: false });
    if (ind) q = q.eq('industry_type_id', ind);
    const { data, error } = await q;
    if (error) throw error;
    if (r.table === 'vehicle_schemes') { // usage numbers for the Schemes page (how often a scheme was used and what it cost)
      try {
        const usage = await vehicleSchemeUsage(org(req));
        const { data: bk } = await supabaseAdmin.from('vehicle_bookings').select('scheme_name').eq('organization_id', org(req)).neq('status', 'Cancelled').not('scheme_name', 'is', null);
        const booked = new Map<string, number>();
        for (const b of (bk ?? []) as Row[]) booked.set(str(b.scheme_name), (booked.get(str(b.scheme_name)) ?? 0) + 1);
        // model / branch names always come from the linked Models / Dealers record (older schemes saved only the id)
        const { data: mm } = await supabaseAdmin.from('vehicle_models').select('id, model_name, variant').eq('organization_id', org(req));
        const { data: dd } = await supabaseAdmin.from('vehicle_dealers').select('id, dealer_name').eq('organization_id', org(req));
        const modelName = new Map(((mm ?? []) as Row[]).map((m) => [str(m.id), [str(m.model_name), str(m.variant)].filter(Boolean).join(' ')]));
        const dealerName = new Map(((dd ?? []) as Row[]).map((d) => [str(d.id), str(d.dealer_name)]));
        for (const row of (data ?? []) as Row[]) {
          if (has(row.model_id) && modelName.get(str(row.model_id))) row.model_name = modelName.get(str(row.model_id));
          if (has(row.dealer_id) && dealerName.get(str(row.dealer_id))) row.dealer_name = dealerName.get(str(row.dealer_id));
          const u = usage.get(str(row.scheme_id));
          row.times_used = u?.orders ?? 0; row.vehicles_sold = u?.vehicles ?? 0; row.total_discount = u?.discount ?? 0;
          row.bookings = (booked.get(str(row.scheme_name)) ?? 0) + (booked.get(str(row.scheme_id)) ?? 0);
        }
      } catch (e) { logger.warn({ err: e }, 'vehicle schemes: usage numbers unavailable'); }
    }
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
    const payload = clean(r, r.table === 'vehicle_units' ? { status: 'Received', ...req.body } : req.body);
    const ind = resolveIndustryTypeId(req.industryScope!, typeof payload.industry_type_id === 'string' ? payload.industry_type_id : undefined);
    if (!ind) throw bad('industry_type_id is required.');
    validateValues(r, payload, false);
    const autoCode = !has(payload[r.codeField]) && r.codeField !== 'vin';
    if (autoCode) payload[r.codeField] = await nextVehicleCode(r.table, r.prefix, org(req));
    const merged = await normalise(r, org(req), ind, payload, null, req.industryScope?.role);
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
    const merged = await normalise(r, org(req), ind, payload, ex, req.industryScope?.role);
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