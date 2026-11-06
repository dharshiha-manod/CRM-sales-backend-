// Vehicle <-> core CRM links (Step 2). Everything here is Vehicle-only: each entry point first checks that the
// industry really is Vehicle and otherwise returns immediately, so FMCG / School / Textile / Pharma / Trading never run it.
// Automation never breaks the main save: every hook catches its own errors and logs them.
import { supabaseAdmin } from './supabase.js';
import { industryCodeOf } from './fmcg-market.js';
import { todayLocal } from './ist-date.js';
import { logger } from './logger.js';
import { VEHICLE_RESOURCES } from './vehicle-resources.js';
import { schemeCredit, stageFor } from './vehicle-calc.js';
import { defaultChecklistFor } from './vehicle-documents.js';
import { enqueueCustomerMessage } from './vehicle-notify.js';

type Row = Record<string, unknown>;

const has = (v: unknown) => v !== null && v !== undefined && v !== '';
const num = (v: unknown) => (has(v) ? Number(v) || 0 : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const HELD = ['Reserved', 'Booked', 'Allocated'];
const PENDING_BOOKING = ['Allocation Pending', 'Reserved', 'Confirmed'];
const OPEN_DELIVERY = ['Preparation', 'PDI Pending', 'Documentation Pending', 'Payment Pending', 'Ready for Delivery'];
const yes = (v: unknown) => ['yes', 'true', 'y'].includes(String(v ?? '').trim().toLowerCase());

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.error({ err: error }, `vehicle-links: ${label} failed`);
    return fallback;
  }
}

export async function isVehicleIndustry(org: string, industryTypeId?: string | null): Promise<boolean> {
  return (await industryCodeOf(org, industryTypeId)) === 'vehicle';
}

// ---------------------------------------------------------------- numbering
export async function nextVehicleCode(table: string, prefix: string, org: string, bump = 0): Promise<string> {
  const field = VEHICLE_RESOURCES.find((r) => r.table === table)?.codeField ?? 'id';
  const head = `${prefix}-${todayLocal().slice(0, 4)}-`;
  const { data, error } = await supabaseAdmin.from(table).select(field).eq('organization_id', org).like(field, `${head}%`).order(field, { ascending: false }).limit(1);
  if (error) throw error;
  const last = data && data[0] ? String((data[0] as unknown as Row)[field] ?? '') : '';
  const n = Number(last.slice(head.length)) || 0;
  return `${head}${String(n + 1 + bump).padStart(4, '0')}`;
}

// ---------------------------------------------------------------- small helpers
async function one(table: string, org: string, column: string, value: unknown, ind?: string | null): Promise<Row | null> {
  if (typeof value !== 'string' || !value) return null;
  let q = supabaseAdmin.from(table).select('*').eq('organization_id', org).eq(column, value);
  if (ind) q = q.eq('industry_type_id', ind);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw error;
  return (data as Row | null) ?? null;
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
async function setUnitStatus(org: string, ind: string, vin: unknown, status: string, onlyFrom?: string[]) {
  if (typeof vin !== 'string' || !vin) return;
  let q = supabaseAdmin.from('vehicle_units').update({ status }).eq('organization_id', org).eq('industry_type_id', ind).eq('vin', vin);
  if (onlyFrom) q = q.in('status', onlyFrom);
  await q;
}
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------- party (client / lead) resolution
/** Links a Vehicle record to the real Client (and Lead). A picked lead/client fills the name; a typed name is matched. */
export async function resolveParty(org: string, ind: string, src: Row, withLead: boolean): Promise<Row> {
  const out: Row = {};
  let clientId = has(src.client_id) ? String(src.client_id) : null;
  let leadId = withLead && has(src.lead_id) ? String(src.lead_id) : null;
  let name = str(src.client_name).trim();

  if (clientId) {
    const client = await one('clients', org, 'id', clientId);
    if (client) name = str(client.client_name) || name;
    else clientId = null;
  }
  if (!clientId && leadId) {
    const lead = await one('leads', org, 'id', leadId);
    if (lead) {
      if (has(lead.converted_client_id)) {
        clientId = String(lead.converted_client_id);
        const client = await one('clients', org, 'id', clientId);
        name = str(client?.client_name) || str(lead.company_name) || name;
      } else {
        name = str(lead.company_name) || name;
      }
    } else leadId = null;
  }
  if (!clientId && name) {
    const { data } = await supabaseAdmin.from('clients').select('id, client_name').eq('organization_id', org).eq('industry_type_id', ind).ilike('client_name', escapeLike(name)).limit(1).maybeSingle();
    if (data) { clientId = (data as Row).id as string; name = str((data as Row).client_name) || name; }
  }
  if (withLead && !leadId && (clientId || name)) {
    let q = supabaseAdmin.from('leads').select('id').eq('organization_id', org).eq('industry_type_id', ind).order('created_at', { ascending: false }).limit(1);
    q = clientId ? q.eq('converted_client_id', clientId) : q.ilike('company_name', escapeLike(name));
    const { data } = await q.maybeSingle();
    if (data) leadId = (data as Row).id as string;
  }
  if (name) out.client_name = name;
  if (clientId) out.client_id = clientId;
  if (leadId) out.lead_id = leadId;
  return out;
}

/** After-sales records only know the VIN: the owner is the customer the vehicle was delivered to. */
export async function ownerOfVin(org: string, ind: string, vin: unknown): Promise<{ client_id?: string; client_name?: string }> {
  if (typeof vin !== 'string' || !vin) return {};
  const base = () => supabaseAdmin.from('vehicle_deliveries').select('client_id, client_name').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', vin);
  let { data } = await base().eq('status', 'Delivered').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) ({ data } = await base().neq('status', 'Cancelled').order('created_at', { ascending: false }).limit(1).maybeSingle());
  const row = data as Row | null;
  return { client_id: has(row?.client_id) ? String(row!.client_id) : undefined, client_name: has(row?.client_name) ? String(row!.client_name) : undefined };
}

// ---------------------------------------------------------------- delivery stage / payments
/** The delivery stage follows what is still missing: PDI, then documents, then payment. */
export function deliveryStageFor(m: Row): string { return stageFor(m); }

/**
 * Open deliveries linked to a Core order turn Payment = Complete by themselves when
 * Core Collections + loan disbursed + approved exchange value cover the order total.
 */
export async function refreshDeliveryPayments(org: string, ind?: string | null): Promise<void> {
  await safe('refreshDeliveryPayments', async () => {
    let q = supabaseAdmin.from('vehicle_deliveries').select('*').eq('organization_id', org).not('order_id', 'is', null).in('status', OPEN_DELIVERY);
    if (ind) q = q.eq('industry_type_id', ind);
    const { data: rows, error } = await q;
    if (error) throw error;
    const open = ((rows ?? []) as Row[]).filter((d) => d.payment_status !== 'Complete');
    if (!open.length) return;
    const orderIds = [...new Set(open.map((d) => String(d.order_id)))];
    const [orders, coll, loans, exch] = await Promise.all([
      supabaseAdmin.from('sale_orders').select('id, total_amount, base_total, discount_amount').eq('organization_id', org).in('id', orderIds),
      supabaseAdmin.from('sales_collections').select('sale_order_id, amount, reference_no').eq('organization_id', org).in('sale_order_id', orderIds),
      supabaseAdmin.from('vehicle_finance_applications').select('order_id, disbursed_amount, application_number').eq('organization_id', org).in('order_id', orderIds),
      supabaseAdmin.from('vehicle_exchanges').select('order_id, approved_value, net_exchange_value, exchange_id').eq('organization_id', org).in('order_id', orderIds).in('status', ['Approved', 'Converted']),
    ]);
    const paid = new Map<string, number>();
    const add = (id: unknown, amount: number) => paid.set(String(id), (paid.get(String(id)) ?? 0) + amount);
    // loan / exchange money already posted to Core Collections (reference = application / exchange number) must not be counted twice
    const posted = new Set(((coll.data ?? []) as Row[]).map((c) => `${String(c.sale_order_id)}|${str(c.reference_no)}`));
    for (const c of (coll.data ?? []) as Row[]) add(c.sale_order_id, num(c.amount));
    for (const l of (loans.data ?? []) as Row[]) if (!posted.has(`${String(l.order_id)}|${str(l.application_number)}`)) add(l.order_id, num(l.disbursed_amount));
    for (const e of (exch.data ?? []) as Row[]) if (!posted.has(`${String(e.order_id)}|${str(e.exchange_id)}`)) add(e.order_id, has(e.net_exchange_value) ? num(e.net_exchange_value) : num(e.approved_value));
    const total = new Map<string, number>();
    const orderDiscount = new Map<string, number>();
    for (const o of (orders.data ?? []) as Row[]) {
      total.set(String(o.id), num(o.total_amount ?? o.base_total));
      orderDiscount.set(String(o.id), num(o.discount_amount));
    }
    // a scheme named on the booking (cash discount / fixed or % discount / exchange bonus) counts as credit against the order; the Core order total is left unchanged
    // (skipped when the order itself already carries a discount, because the scheme is then already taken off the order total)
    const { data: schemeBookings } = await supabaseAdmin.from('vehicle_bookings').select('order_id, scheme_name').eq('organization_id', org).in('order_id', orderIds).neq('status', 'Cancelled').not('scheme_name', 'is', null);
    for (const b of (schemeBookings ?? []) as Row[]) {
      const key = str(b.scheme_name).trim();
      if (!key || !ind) continue;
      const scheme = (await one('vehicle_schemes', org, 'scheme_name', key, ind)) ?? (await one('vehicle_schemes', org, 'scheme_id', key, ind));
      if (!scheme) continue;
      // the order already carries a discount -> the cash / fixed / % part is already off the order total, so only the exchange bonus (never put on a line) still counts
      const credit = (orderDiscount.get(String(b.order_id)) ?? 0) > 0
        ? (['Suspended', 'Draft'].includes(String(scheme.status)) ? 0 : num(scheme.exchange_bonus))
        : schemeCredit(scheme, total.get(String(b.order_id)) ?? 0);
      if (credit > 0) add(b.order_id, credit);
    }
    for (const d of open) {
      const t = total.get(String(d.order_id)) ?? 0;
      if (t > 0 && (paid.get(String(d.order_id)) ?? 0) >= t - 0.5) {
        const merged = { ...d, payment_status: 'Complete' };
        await supabaseAdmin.from('vehicle_deliveries').update({ payment_status: 'Complete', status: deliveryStageFor(merged) }).eq('id', d.id as string);
        if (deliveryStageFor(merged) === 'Ready for Delivery') await enqueueCustomerMessage(org, ind ?? null, { key: `dlv:${String(d.id)}:ready`, kind: 'delivery_ready', clientId: d.client_id, subject: 'Your vehicle is ready for delivery', body: `Dear ${str(d.client_name) || 'Customer'}, your vehicle ${str(d.vin)} is ready for delivery. Please contact us to confirm the handover time.` });
      }
    }
  }, undefined);
}

// ---------------------------------------------------------------- allocation (first in, first out)
/** Gives a waiting booking the oldest Available VIN of its model; with no stock it waits as Allocation Pending. */
export async function tryAllocate(org: string, ind: string, booking: Row): Promise<boolean> {
  return safe('tryAllocate', async () => {
    if (has(booking.vin) || !has(booking.model_id) || !PENDING_BOOKING.includes(String(booking.status))) return false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data: unit, error } = await supabaseAdmin.from('vehicle_units').select('*').eq('organization_id', org).eq('industry_type_id', ind).eq('model_id', booking.model_id as string).eq('status', 'Available').order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (error) throw error;
      if (!unit) {
        if (booking.status !== 'Allocation Pending') await supabaseAdmin.from('vehicle_bookings').update({ status: 'Allocation Pending' }).eq('id', booking.id as string);
        return false;
      }
      const u = unit as Row;
      // claim the unit: only one request can win it
      const { data: claimed } = await supabaseAdmin.from('vehicle_units').update({ status: 'Allocated' }).eq('id', u.id as string).eq('status', 'Available').select('id').maybeSingle();
      if (!claimed) continue;
      const patch: Row = { vin: u.vin, status: 'Vehicle Allocated' };
      if (!has(booking.dealer_id) && has(u.dealer_id)) { patch.dealer_id = u.dealer_id; patch.dealer_name = u.dealer_name ?? null; }
      const { data: updated } = await supabaseAdmin.from('vehicle_bookings').update(patch).eq('id', booking.id as string).is('vin', null).select().maybeSingle();
      if (!updated) { await supabaseAdmin.from('vehicle_units').update({ status: 'Available' }).eq('id', u.id as string); return false; }
      await onBookingAllocated(org, ind, updated as Row);
      return true;
    }
    return false;
  }, false);
}

/** New stock / a released unit serves the oldest waiting booking of that model, one after another. */
export async function allocatePendingBookings(org: string, ind: string, modelId: unknown): Promise<void> {
  if (!has(modelId)) return;
  await safe('allocatePendingBookings', async () => {
    for (let i = 0; i < 50; i += 1) {
      const { data: b } = await supabaseAdmin.from('vehicle_bookings').select('*').eq('organization_id', org).eq('industry_type_id', ind).eq('model_id', modelId as string).is('vin', null).in('status', PENDING_BOOKING).order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!b) return;
      if (!(await tryAllocate(org, ind, b as Row))) return; // no unit left for this model
    }
  }, undefined);
}

/** A booking holds a VIN: open the Delivery/PDI file, the Finance file (if needed) and link the Exchange. */
export async function onBookingAllocated(org: string, ind: string, booking: Row): Promise<void> {
  await safe('onBookingAllocated', async () => {
    if (!has(booking.vin)) return;
    const vin = String(booking.vin);
    const unit = await one('vehicle_units', org, 'vin', vin, ind);
    const bookingNo = booking.booking_number as string;

    // Delivery / PDI file
    const { data: existing } = await supabaseAdmin.from('vehicle_deliveries').select('id, vin, status').eq('organization_id', org).eq('industry_type_id', ind).eq('booking_number', bookingNo).neq('status', 'Cancelled').limit(1).maybeSingle();
    if (existing) {
      const ex = existing as Row;
      if (ex.vin !== vin && ex.status !== 'Delivered') await supabaseAdmin.from('vehicle_deliveries').update({ vin, engine_number: unit?.engine_number ?? null }).eq('id', ex.id as string);
    } else {
      const row: Row = {
        client_name: booking.client_name, client_id: booking.client_id ?? null, vin, engine_number: unit?.engine_number ?? null,
        sales_order_reference: booking.order_number ?? null, order_id: booking.order_id ?? null, order_number: booking.order_number ?? null, booking_number: bookingNo,
        dealer_id: booking.dealer_id ?? null, dealer_name: booking.dealer_name ?? null, sales_rep: booking.sales_rep ?? null,
        delivery_date: booking.expected_delivery_date ?? null, odometer: unit?.odometer ?? null,
        pdi_status: 'Not Started', documentation_status: 'Pending', payment_status: 'Pending', registration_status: 'Pending',
        insurance_status: booking.insurance_required !== undefined && booking.insurance_required !== null && !yes(booking.insurance_required) ? 'Not Applicable' : 'Pending',
        accessories_status: 'Pending', customer_acknowledgement: 'No', status: 'PDI Pending',
        document_checklist: await defaultChecklistFor(org, ind, { client_id: booking.client_id, booking_number: bookingNo, finance_required: booking.finance_required, insurance_required: booking.insurance_required }),
      };
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const number = await nextVehicleCode('vehicle_deliveries', 'DLV', org, attempt);
        const { error } = await supabaseAdmin.from('vehicle_deliveries').insert({ ...row, delivery_number: number, organization_id: org, industry_type_id: ind });
        if (!error) break;
        if (/document_checklist/.test(String(error.message))) { delete row.document_checklist; continue; } // column not added yet: open the file without the checklist
        if (error.code !== '23505') throw error;
      }
    }

    // Finance file
    if (yes(booking.finance_required)) {
      const { data: fin } = await supabaseAdmin.from('vehicle_finance_applications').select('id').eq('organization_id', org).eq('industry_type_id', ind).eq('booking_number', bookingNo).limit(1).maybeSingle();
      if (!fin) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const number = await nextVehicleCode('vehicle_finance_applications', 'FIN', org, attempt);
          const { error } = await supabaseAdmin.from('vehicle_finance_applications').insert({
            application_number: number, client_name: booking.client_name, client_id: booking.client_id ?? null, vin, order_id: booking.order_id ?? null,
            booking_number: bookingNo, sales_order_reference: booking.order_number ?? null, application_date: todayLocal(), status: 'Started',
            organization_id: org, industry_type_id: ind,
          });
          if (!error) break;
          if (error.code !== '23505') throw error;
        }
      }
    }

    // Registration file opens now (not after handover); insurance is chased by a follow-up call
    const { data: regExisting } = await supabaseAdmin.from('vehicle_registrations').select('id').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', vin).maybeSingle();
    if (!regExisting) await supabaseAdmin.from('vehicle_registrations').insert({ organization_id: org, industry_type_id: ind, vin, client_name: booking.client_name, client_id: booking.client_id ?? null, engine_number: unit?.engine_number ?? null, invoice_reference: booking.order_number ?? null, status: 'Pending' });
    if (yes(booking.insurance_required) && has(booking.client_id)) {
      const rep = await representativeFor(org, ind, booking.client_id, booking.lead_id);
      const title = `Arrange insurance: ${str(booking.client_name) || 'customer'} - ${vin}`;
      if (rep) {
        const { data: dupF } = await supabaseAdmin.from('follow_ups').select('id').eq('organization_id', org).eq('client_id', booking.client_id as string).eq('title', title).limit(1).maybeSingle();
        if (!dupF) await supabaseAdmin.from('follow_ups').insert({ organization_id: org, representative_id: rep, client_id: booking.client_id, title, due_at: new Date(Date.now() + 86_400_000).toISOString(), priority: 'high', follow_up_type: 'call', notes: `Booking ${bookingNo} needs insurance before handover. Add the policy in Insurance; the delivery file updates by itself.` });
      }
    }

    // Exchange record named on the booking
    if (has(booking.exchange_reference)) {
      await supabaseAdmin.from('vehicle_exchanges').update({ new_vehicle_vin: vin, booking_number: bookingNo, order_id: booking.order_id ?? null, sales_order_reference: booking.order_number ?? null })
        .eq('organization_id', org).eq('industry_type_id', ind).eq('exchange_id', String(booking.exchange_reference));
    }
    await refreshDeliveryPayments(org, ind);
  }, undefined);
}

// ---------------------------------------------------------------- model <-> Product (keeps Lead -> Quotation chain working)
async function ensureProductTag(org: string, productId: string, ind: string) {
  const { data } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', org).eq('product_id', productId).eq('industry_type_id', ind).limit(1).maybeSingle();
  if (!data) await supabaseAdmin.from('product_industry_types').insert({ organization_id: org, product_id: productId, industry_type_id: ind });
}

/** Every Vehicle model has a Product (tagged Vehicle) so the existing Lead -> Requirement -> Quotation chain can quote it. */
export async function syncModelProduct(org: string, ind: string, model: Row): Promise<void> {
  await safe('syncModelProduct', async () => {
    const name = [model.make ?? model.brand, model.model_name, model.variant].filter(has).map(String).join(' ').trim() || String(model.model_code);
    const price = num(model.recommended_selling_price) || num(model.ex_showroom_price);
    const status = model.status === 'Discontinued' ? 'inactive' : 'active';
    const category = str(model.vehicle_category) || str(model.vehicle_type) || 'Vehicle';
    const description = [model.fuel_type, model.transmission, model.body_type, model.model_year].filter(has).join(' · ') || null;
    if (has(model.product_id)) {
      await supabaseAdmin.from('products').update({ product_name: name, selling_price: price, status, category, description }).eq('organization_id', org).eq('id', model.product_id as string);
      await ensureProductTag(org, String(model.product_id), ind);
      return;
    }
    let product: Row | null = null;
    for (const code of [String(model.model_code), `VEH-${String(model.model_code)}`]) {
      const { data, error } = await supabaseAdmin.from('products').insert({ organization_id: org, product_code: code, product_name: name, category, description, selling_price: price, status, unit: 'pcs' }).select().single();
      if (!error) { product = data as Row; break; }
      if (error.code !== '23505') throw error;
    }
    if (!product) return;
    await ensureProductTag(org, String(product.id), ind);
    await supabaseAdmin.from('vehicle_models').update({ product_id: product.id }).eq('id', model.id as string);
  }, undefined);
}

/** A deleted model deactivates its Product (history stays complete). */
export async function retireModelProduct(org: string, model: Row): Promise<void> {
  if (!has(model.product_id)) return;
  await safe('retireModelProduct', async () => {
    await supabaseAdmin.from('products').update({ status: 'inactive' }).eq('organization_id', org).eq('id', model.product_id as string);
  }, undefined);
}

// ---------------------------------------------------------------- Products -> Vehicle model
// Vehicle details typed in the Products form are saved as "Label: value | Label: value" text in
// products.specification. Every Vehicle product keeps one vehicle_models row in step with it, so
// Units, Test drive, Booking and Schemes keep working without a separate Catalog entry.
const VEHICLE_SPEC_KEYS: Record<string, string> = {
  Make: 'make', Model: 'model', Variant: 'variant', Fuel: 'fuel', Transmission: 'transmission', Colour: 'colour',
  Year: 'year', 'Engine (cc)': 'engineCc', Seats: 'seats', Body: 'body', Condition: 'condition',
  'Engine type': 'engineType', Warranty: 'warranty', 'Service interval': 'serviceInterval',
};

function parseVehicleSpec(spec: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(spec ?? '').split(' | ')) {
    const index = part.indexOf(': ');
    if (index === -1) continue;
    const key = VEHICLE_SPEC_KEYS[part.slice(0, index)];
    if (key) out[key] = part.slice(index + 2).trim();
  }
  return out;
}

const numOrNull = (v: unknown) => (has(v) && Number.isFinite(Number(v)) ? Number(v) : null);

/** Called after a product is saved. Does nothing unless the product belongs to the Vehicle industry. */
export async function syncProductModel(org: string, product: Row): Promise<void> {
  await safe('syncProductModel', async () => {
    const { data: tags } = await supabaseAdmin.from('product_industry_types').select('industry_type_id').eq('organization_id', org).eq('product_id', product.id as string);
    let ind: string | null = null;
    for (const tag of (tags ?? []) as Row[]) {
      if (await isVehicleIndustry(org, tag.industry_type_id as string)) { ind = tag.industry_type_id as string; break; }
    }
    if (!ind) return; // not a Vehicle product

    const spec = parseVehicleSpec(product.specification);
    const make = spec.make || 'Other';
    const price = num(product.selling_price);
    const row = {
      make,
      brand: make,
      model_name: spec.model || str(product.product_name),
      variant: spec.variant || null,
      vehicle_type: spec.body || str(product.category) || null,
      vehicle_category: str(product.category) || null,
      body_type: spec.body || null,
      model_year: numOrNull(spec.year),
      fuel_type: spec.fuel || null,
      transmission: spec.transmission || null,
      engine_type: spec.engineType || null,
      engine_capacity: numOrNull(spec.engineCc),
      seating_capacity: numOrNull(spec.seats),
      condition: spec.condition || null,
      ex_showroom_price: has(product.mrp) ? num(product.mrp) : price,
      recommended_selling_price: price,
      warranty: spec.warranty || null,
      service_interval: spec.serviceInterval || null,
      status: product.status === 'inactive' ? 'Discontinued' : 'Active',
    };

    const { data: existing } = await supabaseAdmin.from('vehicle_models').select('id').eq('organization_id', org).eq('product_id', product.id as string).limit(1).maybeSingle();
    if (existing) {
      await supabaseAdmin.from('vehicle_models').update(row).eq('id', (existing as Row).id as string);
      return;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const modelCode = await nextVehicleCode('vehicle_models', 'MDL', org, attempt);
      const { error } = await supabaseAdmin.from('vehicle_models').insert({ ...row, model_code: modelCode, product_id: product.id, industry_type_id: ind, organization_id: org });
      if (!error) return;
      if (error.code !== '23505') throw error;
    }
  }, undefined);
}

// ---------------------------------------------------------------- Products: live stock + first units
/**
 * Vehicle products show the REAL number of Available units instead of the typed stock number.
 * Display only: products.stock_quantity in the database is not changed (Core orders still use it).
 */
export async function applyLiveVehicleStock(org: string, products: Row[]): Promise<Row[]> {
  return safe('applyLiveVehicleStock', async () => {
    const ids = products.map((p) => p.id as string).filter(Boolean);
    if (!ids.length) return products;
    const { data: models } = await supabaseAdmin.from('vehicle_models').select('id, product_id').eq('organization_id', org).in('product_id', ids);
    const modelRows = (models ?? []) as Row[];
    if (!modelRows.length) return products; // no Vehicle products in this list
    const { data: units } = await supabaseAdmin.from('vehicle_units').select('model_id').eq('organization_id', org).eq('status', 'Available').in('model_id', modelRows.map((m) => m.id as string));
    const availableByModel = new Map<string, number>();
    for (const unit of (units ?? []) as Row[]) availableByModel.set(str(unit.model_id), (availableByModel.get(str(unit.model_id)) ?? 0) + 1);
    const liveByProduct = new Map<string, number>();
    for (const model of modelRows) liveByProduct.set(str(model.product_id), availableByModel.get(str(model.id)) ?? 0);
    return products.map((p) => (liveByProduct.has(str(p.id)) ? { ...p, stock_quantity: liveByProduct.get(str(p.id)) } : p));
  }, products);
}

/**
 * New Vehicle product saved with "Opening units = N": creates N Available units with placeholder VINs
 * (TEMP-<model code>-001 ...) so stock, test drives and bookings work straight away.
 * Replace each TEMP VIN with the real one later. Max 50 at a time. Never blocks the product save.
 */
export async function createInitialUnits(org: string, product: Row, requested: unknown): Promise<void> {
  const count = Math.min(Math.floor(num(requested)), 50);
  if (!(count > 0)) return;
  await safe('createInitialUnits', async () => {
    const { data: model } = await supabaseAdmin.from('vehicle_models').select('id, model_code, model_name, variant, industry_type_id').eq('organization_id', org).eq('product_id', product.id as string).limit(1).maybeSingle();
    if (!model) return; // not a Vehicle product
    const m = model as Row;
    const { data: dealers } = await supabaseAdmin.from('vehicle_dealers').select('id, dealer_name').eq('organization_id', org).eq('industry_type_id', m.industry_type_id as string).limit(2);
    const dealer = ((dealers ?? []) as Row[]).length === 1 ? ((dealers ?? []) as Row[])[0] : null; // only when there is exactly one dealer
    const colour = parseVehicleSpec(product.specification).colour || null;
    const rows = Array.from({ length: count }, (_, i) => ({
      vin: `TEMP-${str(m.model_code)}-${String(i + 1).padStart(3, '0')}`,
      model_id: m.id,
      model_name: m.model_name,
      variant: m.variant ?? null,
      color: colour,
      status: 'Available',
      selling_price: num(product.selling_price) || null,
      dealer_id: dealer ? dealer.id : null,
      dealer_name: dealer ? dealer.dealer_name : null,
      industry_type_id: m.industry_type_id,
      organization_id: org,
    }));
    const { error } = await supabaseAdmin.from('vehicle_units').insert(rows);
    if (error && error.code !== '23505') throw error;
  }, undefined);
}

// ---------------------------------------------------------------- Dealer from lead / active on first approved quotation


/**
 * A Qualified lead with Customer type "Dealer" also gets a Dealer record (type Sub Dealer, status Pending Approval)
 * with the contact details copied across. Vehicle only; skipped if a dealer with that name already exists.
 */
export async function createDealerFromLead(org: string, lead: Row, customerType: unknown): Promise<void> {
  if (String(customerType ?? '').trim().toLowerCase() !== 'dealer') return;
  await safe('createDealerFromLead', async () => {
    const ind = has(lead.industry_type_id) ? String(lead.industry_type_id) : '';
    const name = str(lead.company_name).trim();
    if (!ind || !name || !(await isVehicleIndustry(org, ind))) return;
    const { data: existing } = await supabaseAdmin.from('vehicle_dealers').select('id').eq('organization_id', org).eq('industry_type_id', ind).ilike('dealer_name', escapeLike(name)).limit(1).maybeSingle();
    if (existing) return;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const dealerCode = await nextVehicleCode('vehicle_dealers', 'DLR', org, attempt);
      const { error } = await supabaseAdmin.from('vehicle_dealers').insert({
        dealer_code: dealerCode,
        dealer_name: name,
        dealer_type: 'Sub Dealer',
        contact_person: has(lead.contact_name) ? lead.contact_name : null,
        phone: has(lead.phone) ? lead.phone : null,
        email: has(lead.email) ? lead.email : null,
        address: has(lead.street_address) ? lead.street_address : null,
        city: has(lead.city) ? lead.city : null,
        state: has(lead.state) ? lead.state : null,
        status: 'Pending Approval',
        notes: `Created automatically from lead ${str(lead.lead_code)}.`,
        industry_type_id: ind,
        organization_id: org,
      });
      if (!error) return;
      if (error.code !== '23505') throw error;
    }
  }, undefined);
}

/** When a quotation is approved, the client's Dealer record (matched by name) changes from Pending Approval to Active. Vehicle only. */
export async function activateDealerForClient(org: string, clientId: unknown): Promise<void> {
  if (!has(clientId)) return;
  await safe('activateDealerForClient', async () => {
    const { data: client } = await supabaseAdmin.from('clients').select('client_name, industry_type_id').eq('organization_id', org).eq('id', clientId as string).maybeSingle();
    const c = (client ?? null) as Row | null;
    if (!c || !has(c.client_name) || !has(c.industry_type_id) || !(await isVehicleIndustry(org, String(c.industry_type_id)))) return;
    await supabaseAdmin.from('vehicle_dealers').update({ status: 'Active' }).eq('organization_id', org).eq('industry_type_id', String(c.industry_type_id)).ilike('dealer_name', escapeLike(str(c.client_name).trim())).eq('status', 'Pending Approval');
  }, undefined);
}

// ---------------------------------------------------------------- test drive follow-up
export async function representativeFor(org: string, ind: string, clientId: unknown, leadId: unknown): Promise<string | null> {
  if (has(leadId)) {
    const lead = await one('leads', org, 'id', leadId);
    if (lead && has(lead.representative_id)) return String(lead.representative_id);
  }
  if (has(clientId)) {
    const { data } = await supabaseAdmin.from('sales_representative_client_assignments').select('sales_representative_id').eq('organization_id', org).eq('client_id', clientId as string).eq('status', 'active').limit(1).maybeSingle();
    if (data) return (data as Row).sales_representative_id as string;
  }
  const { data } = await supabaseAdmin.from('sales_representative_industry_types').select('sales_representative_id').eq('organization_id', org).eq('industry_type_id', ind).limit(1).maybeSingle();
  return data ? ((data as Row).sales_representative_id as string) : null;
}

/** Completed test drive -> a draft booking (status Requested, no VIN, no allocation) so the rep only has to confirm it. Once per client + model. */
export async function draftBookingFromTestDrive(org: string, ind: string, drive: Row): Promise<void> {
  await safe('draftBookingFromTestDrive', async () => {
    if (drive.status !== 'Completed' || !has(drive.model_id) || !(has(drive.client_id) || has(drive.lead_id) || has(drive.client_name))) return;
    let q = supabaseAdmin.from('vehicle_bookings').select('id').eq('organization_id', org).eq('industry_type_id', ind).eq('model_id', drive.model_id as string).not('status', 'in', '(Cancelled)').limit(1);
    if (has(drive.client_id)) q = q.eq('client_id', drive.client_id as string);
    else if (has(drive.lead_id)) q = q.eq('lead_id', drive.lead_id as string);
    else q = q.eq('client_name', str(drive.client_name));
    const { data: dupe } = await q.maybeSingle();
    if (dupe) return;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { error } = await supabaseAdmin.from('vehicle_bookings').insert({
        booking_number: await nextVehicleCode('vehicle_bookings', 'BK', org, attempt), client_name: drive.client_name, client_id: drive.client_id ?? null, lead_id: drive.lead_id ?? null,
        model_id: drive.model_id, model_name: drive.model_name ?? null, dealer_id: drive.dealer_id ?? null, dealer_name: drive.dealer_name ?? null, sales_rep: drive.sales_rep ?? null,
        booking_date: todayLocal(), status: 'Requested', remarks: `Draft created after test drive ${str(drive.test_drive_number)}. Confirm with the customer.`, organization_id: org, industry_type_id: ind,
      });
      if (!error) return;
      if (error.code !== '23505') throw error;
    }
  }, undefined);
}

/** Completed test drive -> call follow-up next day (+ lead New -> Contacted). No Show -> reschedule follow-up. */
export async function followUpAfterTestDrive(org: string, ind: string, drive: Row): Promise<void> {
  await safe('followUpAfterTestDrive', async () => {
    const completed = drive.status === 'Completed';
    if (completed) await draftBookingFromTestDrive(org, ind, drive);
    const who = str(drive.client_name) || 'customer';
    const what = str(drive.model_name) || 'vehicle';
    const title = completed ? `Test drive follow-up: ${who} - ${what}` : `Reschedule test drive: ${who} - ${what}`;
    const due = new Date(`${addDays(todayLocal(), 1)}T10:00:00+05:30`).toISOString();
    const notes = completed
      ? `Test drive ${String(drive.test_drive_number)} completed.${has(drive.customer_feedback) ? ` Feedback: ${String(drive.customer_feedback)}` : ''} Call to ask about the booking.`
      : `Customer did not turn up for test drive ${String(drive.test_drive_number)}. Call and offer a new slot.`;

    if (has(drive.client_id)) {
      const rep = await representativeFor(org, ind, drive.client_id, drive.lead_id);
      if (rep) {
        const { data: dup } = await supabaseAdmin.from('follow_ups').select('id').eq('organization_id', org).eq('client_id', drive.client_id as string).eq('title', title).in('status', ['pending', 'in_progress']).limit(1).maybeSingle();
        if (!dup) await supabaseAdmin.from('follow_ups').insert({ organization_id: org, representative_id: rep, client_id: drive.client_id, title, due_at: due, priority: completed ? 'normal' : 'high', follow_up_type: 'call', notes });
      } else logger.warn({ driveId: drive.id }, 'vehicle-links: no sales representative found for the test drive follow-up');
    }
    if (has(drive.lead_id)) {
      const lead = await one('leads', org, 'id', drive.lead_id);
      if (lead) {
        const patch: Row = { next_action_due_at: due };
        if (completed && lead.status === 'new') patch.status = 'contacted';
        await supabaseAdmin.from('leads').update(patch).eq('organization_id', org).eq('id', lead.id as string);
        await supabaseAdmin.from('lead_activities').insert({ organization_id: org, lead_id: lead.id, activity_type: 'note_added', note: completed ? `Test drive ${String(drive.test_drive_number)} completed. Follow-up call set for tomorrow.` : `Test drive ${String(drive.test_drive_number)} was a no-show. Reschedule follow-up set for tomorrow.`, actor_id: null });
      }
    }
  }, undefined);
}

// ---------------------------------------------------------------- core order hooks (Vehicle only)
async function vehicleOrder(org: string, orderId: string): Promise<{ order: Row; ind: string } | null> {
  const { data } = await supabaseAdmin.from('sale_orders').select('id, order_number, status, client_id, representative_id, clients(industry_type_id, client_name), sale_order_items(product_id, quantity, vehicle_scheme_ref)').eq('organization_id', org).eq('id', orderId).maybeSingle();
  if (!data) return null;
  const order = data as unknown as Row;
  const client = (Array.isArray(order.clients) ? order.clients[0] : order.clients) as Row | null;
  const ind = client?.industry_type_id as string | undefined;
  if (!ind || !(await isVehicleIndustry(org, ind))) return null;
  order.client_name = client?.client_name;
  return { order, ind };
}

/** Order created / approved -> one Vehicle Booking per vehicle ordered, then auto-allocate a VIN. Runs once per order. */
export async function onVehicleOrderCreated(org: string, orderId: string): Promise<void> {
  await safe('onVehicleOrderCreated', async () => {
    const found = await vehicleOrder(org, orderId);
    if (!found) return;
    const { order, ind } = found;
    if (['cancelled', 'pending_approval'].includes(String(order.status))) return;
    const items = ((order.sale_order_items ?? []) as Row[]).filter((i) => has(i.product_id));
    if (!items.length) return;
    const { data: models } = await supabaseAdmin.from('vehicle_models').select('id, model_name, product_id').eq('organization_id', org).eq('industry_type_id', ind).in('product_id', items.map((i) => i.product_id as string));
    if (!models?.length) return; // an accessory-only order books nothing
    let leadId: string | null = null;
    if (has(order.client_id)) {
      const { data: lead } = await supabaseAdmin.from('leads').select('id').eq('organization_id', org).eq('converted_client_id', order.client_id as string).order('created_at', { ascending: false }).limit(1).maybeSingle();
      leadId = lead ? ((lead as Row).id as string) : null;
    }
    let repName: string | null = null;
    if (has(order.representative_id)) {
      const { data: rep } = await supabaseAdmin.from('sales_representatives').select('user_profiles(display_name)').eq('id', order.representative_id as string).maybeSingle();
      const profile = (rep as unknown as { user_profiles?: { display_name?: string } | { display_name?: string }[] | null } | null)?.user_profiles;
      repName = (Array.isArray(profile) ? profile[0]?.display_name : profile?.display_name) ?? null;
    }
    for (const model of models as Row[]) {
      const wanted = items.filter((i) => i.product_id === model.product_id).reduce((s, i) => s + Math.max(1, Math.round(num(i.quantity) || 1)), 0);
      const { count } = await supabaseAdmin.from('vehicle_bookings').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('order_id', orderId).eq('model_id', model.id as string);
      // the scheme that discounted this vehicle's order line (first one when several are stacked) is written on the booking
      const refs = items.filter((i) => i.product_id === model.product_id).map((i) => str(i.vehicle_scheme_ref)).find(Boolean);
      const firstId = refs ? refs.split('|').map((x) => x.trim()).find(Boolean) : undefined;
      const lineScheme = firstId ? await one('vehicle_schemes', org, 'scheme_id', firstId, ind) : null;
      for (let n = count ?? 0; n < wanted; n += 1) {
        let booking: Row | null = null;
        for (let attempt = 0; attempt < 5 && !booking; attempt += 1) {
          const { data, error } = await supabaseAdmin.from('vehicle_bookings').insert({
            booking_number: await nextVehicleCode('vehicle_bookings', 'BK', org, attempt), client_name: order.client_name, client_id: order.client_id, lead_id: leadId,
            model_id: model.id, model_name: model.model_name, order_id: orderId, order_number: order.order_number, sales_rep: repName, booking_date: todayLocal(),
            status: 'Confirmed', remarks: `Auto-created from order ${String(order.order_number)}.${lineScheme ? ` Scheme ${str(lineScheme.scheme_name)} applied on the order.` : ''}`, ...(lineScheme ? { scheme_name: lineScheme.scheme_name } : {}), organization_id: org, industry_type_id: ind,
          }).select().single();
          if (!error) booking = data as Row;
          else if (error.code !== '23505') throw error;
        }
        if (booking) await tryAllocate(org, ind, booking);
      }
    }
  }, undefined);
}

/** Order cancelled -> bookings cancelled, vehicles released to the next waiting booking, open deliveries cancelled. */
export async function onVehicleOrderCancelled(org: string, orderId: string): Promise<void> {
  await safe('onVehicleOrderCancelled', async () => {
    const found = await vehicleOrder(org, orderId);
    if (!found) return;
    const { ind } = found;
    const { data: bookings } = await supabaseAdmin.from('vehicle_bookings').select('*').eq('organization_id', org).eq('order_id', orderId).neq('status', 'Cancelled');
    const models = new Set<string>();
    for (const b of (bookings ?? []) as Row[]) {
      await supabaseAdmin.from('vehicle_bookings').update({ status: 'Cancelled', cancellation_reason: `Order ${String(b.order_number ?? '')} was cancelled.`.replace('  ', ' ') }).eq('id', b.id as string);
      if (has(b.vin)) await setUnitStatus(org, ind, b.vin, 'Available', HELD);
      if (has(b.model_id)) models.add(String(b.model_id));
    }
    const { data: deliveries } = await supabaseAdmin.from('vehicle_deliveries').select('id, vin').eq('organization_id', org).eq('order_id', orderId).in('status', OPEN_DELIVERY);
    for (const d of (deliveries ?? []) as Row[]) {
      await supabaseAdmin.from('vehicle_deliveries').update({ status: 'Cancelled' }).eq('id', d.id as string);
      if (has(d.vin)) await setUnitStatus(org, ind, d.vin, 'Available', HELD);
    }
    // money already received on the order (not loan / exchange credit) -> a refund request for staff to approve; nothing is paid out automatically
    const { data: seen } = await supabaseAdmin.from('vehicle_returns').select('id').eq('organization_id', org).eq('industry_type_id', ind).eq('order_id', orderId).limit(1).maybeSingle();
    if (!seen) {
      const [coll, loans, exch] = await Promise.all([
        supabaseAdmin.from('sales_collections').select('amount, reference_no').eq('organization_id', org).eq('sale_order_id', orderId),
        supabaseAdmin.from('vehicle_finance_applications').select('application_number').eq('organization_id', org).eq('order_id', orderId),
        supabaseAdmin.from('vehicle_exchanges').select('exchange_id').eq('organization_id', org).eq('order_id', orderId),
      ]);
      const credit = new Set([...((loans.data ?? []) as Row[]).map((l) => str(l.application_number)), ...((exch.data ?? []) as Row[]).map((e) => str(e.exchange_id))]);
      const paid = ((coll.data ?? []) as Row[]).filter((c) => !credit.has(str(c.reference_no))).reduce((s, c) => s + num(c.amount), 0);
      if (paid > 0) {
        const first = ((bookings ?? []) as Row[])[0];
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const { error } = await supabaseAdmin.from('vehicle_returns').insert({
            return_number: await nextVehicleCode('vehicle_returns', 'RTN', org, attempt), return_type: 'Sales Cancellation', client_name: found.order.client_name, client_id: found.order.client_id,
            order_id: orderId, sales_order_reference: found.order.order_number, booking_reference: first?.booking_number ?? null, vin: first?.vin ?? null,
            reason: `Order ${str(found.order.order_number)} was cancelled.`, request_date: todayLocal(), amount: paid, status: 'Under Review', organization_id: org, industry_type_id: ind,
          });
          if (!error) break;
          if (error.code !== '23505') throw error;
        }
      }
    }
    for (const modelId of models) await allocatePendingBookings(org, ind, modelId);
  }, undefined);
}