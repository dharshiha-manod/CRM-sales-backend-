// Vehicle only: one tax invoice per vehicle on a Core order. It is raised by itself when the Delivery / PDI file opens,
// follows the delivery (Paid when payment is Complete, Cancelled when the delivery / order is cancelled) and ticks the
// "Tax invoice" document on the delivery checklist. Amounts come from the Core order lines, never from the browser.
// Never throws: a failure here must not break the main save (errors are logged).
import { supabaseAdmin } from './supabase.js';
import { todayLocal } from './ist-date.js';
import { logger } from './logger.js';

type Row = Record<string, unknown>;
const has = (v: unknown) => v !== null && v !== undefined && v !== '';
const num = (v: unknown) => (has(v) ? Number(v) || 0 : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface InvoiceFigures { subtotal: number; discount_amount: number; tax_amount: number; total_amount: number }
export interface OrderLine { product_id?: unknown; quantity?: unknown; subtotal?: unknown; discount_amount?: unknown }

/**
 * Pure: the figures of ONE vehicle. The order line of that model is divided by its quantity; the order's tax is shared
 * between lines in proportion to their value. With no matching line the order total is split by the number of vehicles.
 */
export function invoiceFigures(order: { total_amount?: unknown; tax_amount?: unknown }, lines: OrderLine[], productId: unknown, vehicleCount: number): InvoiceFigures {
  const count = Math.max(1, vehicleCount);
  const mine = has(productId) ? lines.filter((l) => String(l.product_id) === String(productId)) : [];
  const allNet = lines.reduce((s, l) => s + num(l.subtotal), 0);
  if (mine.length && allNet > 0) {
    const qty = Math.max(1, mine.reduce((s, l) => s + num(l.quantity), 0));
    const net = mine.reduce((s, l) => s + num(l.subtotal), 0);
    const disc = mine.reduce((s, l) => s + num(l.discount_amount), 0);
    const tax = (num(order.tax_amount) * net) / allNet;
    const subtotal = r2((net + disc) / qty), discount_amount = r2(disc / qty), tax_amount = r2(tax / qty);
    return { subtotal, discount_amount, tax_amount, total_amount: r2(subtotal - discount_amount + tax_amount) };
  }
  const total = r2(num(order.total_amount) / count), tax = r2(num(order.tax_amount) / count);
  return { subtotal: r2(total - tax), discount_amount: 0, tax_amount: tax, total_amount: total };
}

/** Due date of an auto-raised invoice: today + VEHICLE_INVOICE_DUE_DAYS (default 0 = due on delivery). */
function dueDate(): string {
  const d = new Date(`${todayLocal()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Number(process.env.VEHICLE_INVOICE_DUE_DAYS ?? 0) || 0));
  return d.toISOString().slice(0, 10);
}

async function nextInvoiceNumber(org: string, bump: number): Promise<string> {
  const head = `INV-${todayLocal().slice(0, 4)}-`;
  const { data, error } = await supabaseAdmin.from('vehicle_invoices').select('invoice_number').eq('organization_id', org).like('invoice_number', `${head}%`).order('invoice_number', { ascending: false }).limit(1);
  if (error) throw error;
  const last = data && data[0] ? String((data[0] as Row).invoice_number ?? '') : '';
  return `${head}${String((Number(last.slice(head.length)) || 0) + 1 + bump).padStart(4, '0')}`;
}

async function liveInvoice(org: string, ind: string, vin: string, orderId: string): Promise<Row | null> {
  const { data } = await supabaseAdmin.from('vehicle_invoices').select('*').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', vin).eq('order_id', orderId).neq('status', 'Cancelled').limit(1).maybeSingle();
  return (data as Row | null) ?? null;
}

/** Raises the invoice of a delivery (once). `d` is a vehicle_deliveries row. Returns the invoice, or null when it cannot be raised yet. */
export async function ensureVehicleInvoice(org: string, ind: string, d: Row): Promise<Row | null> {
  try {
    if (!has(d.order_id) || !has(d.vin) || d.status === 'Cancelled') return null;
    const vin = String(d.vin), orderId = String(d.order_id);
    const existing = await liveInvoice(org, ind, vin, orderId);
    if (existing) return existing;

    const { data: ord } = await supabaseAdmin.from('sale_orders').select('id, order_number, total_amount, base_total, tax_amount, client_id').eq('organization_id', org).eq('id', orderId).maybeSingle();
    if (!ord) return null;
    const order = ord as Row;
    const [{ data: items }, { data: unit }, { count }] = await Promise.all([
      supabaseAdmin.from('sale_order_items').select('product_id, quantity, subtotal, discount_amount').eq('order_id', orderId),
      supabaseAdmin.from('vehicle_units').select('model_id').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', vin).maybeSingle(),
      supabaseAdmin.from('vehicle_bookings').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('order_id', orderId).neq('status', 'Cancelled'),
    ]);
    let productId: unknown = null;
    const modelId = (unit as Row | null)?.model_id;
    if (has(modelId)) {
      const { data: model } = await supabaseAdmin.from('vehicle_models').select('product_id').eq('organization_id', org).eq('id', String(modelId)).maybeSingle();
      productId = (model as Row | null)?.product_id ?? null;
    }
    const f = invoiceFigures(order, (items ?? []) as OrderLine[], productId, count ?? 1);
    if (f.total_amount <= 0) return null;
    const paid = d.payment_status === 'Complete';
    const row: Row = {
      organization_id: org, industry_type_id: ind, vin, order_id: orderId, order_number: order.order_number ?? d.order_number ?? null,
      booking_number: d.booking_number ?? null, delivery_number: d.delivery_number ?? null, client_id: d.client_id ?? order.client_id ?? null, client_name: d.client_name ?? null,
      invoice_date: todayLocal(), due_date: dueDate(), ...f, paid_amount: paid ? f.total_amount : 0, status: paid ? 'Paid' : 'Issued',
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await supabaseAdmin.from('vehicle_invoices').insert({ ...row, invoice_number: await nextInvoiceNumber(org, attempt) }).select().single();
      if (!error) return data as Row;
      if (error.code !== '23505') throw error;
      const raced = await liveInvoice(org, ind, vin, orderId); // another request raised it first
      if (raced) return raced;
    }
    return null;
  } catch (error) {
    logger.error({ err: error }, 'vehicle-invoice: could not raise the invoice');
    return null;
  }
}

/** Payment Complete on the delivery -> the invoice is Paid. */
export async function markVehicleInvoicePaid(org: string, ind: string, vin: unknown, orderId: unknown): Promise<void> {
  if (!has(vin) || !has(orderId)) return;
  try {
    const inv = await liveInvoice(org, ind, String(vin), String(orderId));
    if (!inv || inv.status !== 'Issued') return;
    await supabaseAdmin.from('vehicle_invoices').update({ status: 'Paid', paid_amount: inv.total_amount }).eq('id', inv.id as string).eq('status', 'Issued');
  } catch (error) { logger.error({ err: error }, 'vehicle-invoice: could not mark the invoice paid'); }
}

/** Delivery / order cancelled -> the Issued invoice is Cancelled (a Paid one stays: it goes through Returns / refund). */
export async function cancelVehicleInvoices(org: string, ind: string, by: { vin?: unknown; orderId?: unknown }): Promise<void> {
  if (!has(by.orderId)) return;
  try {
    let q = supabaseAdmin.from('vehicle_invoices').update({ status: 'Cancelled' }).eq('organization_id', org).eq('industry_type_id', ind).eq('order_id', String(by.orderId)).eq('status', 'Issued');
    if (has(by.vin)) q = q.eq('vin', String(by.vin));
    await q;
  } catch (error) { logger.error({ err: error }, 'vehicle-invoice: could not cancel the invoice'); }
}

// Older deliveries (made before this feature, or whose order was linked later) get their invoice on the next list / hourly run.
const REFRESH_MS = 5 * 60_000;
const lastBackfill = new Map<string, number>();
export async function backfillVehicleInvoices(org: string, ind: string | null): Promise<number> {
  if (!ind) return 0;
  const key = `${org}:${ind}`;
  if (Date.now() - (lastBackfill.get(key) ?? 0) < REFRESH_MS) return 0;
  lastBackfill.set(key, Date.now());
  let made = 0;
  try {
    const { data: deliveries } = await supabaseAdmin.from('vehicle_deliveries').select('*').eq('organization_id', org).eq('industry_type_id', ind).not('order_id', 'is', null).not('vin', 'is', null).neq('status', 'Cancelled').limit(500);
    const { data: invoices } = await supabaseAdmin.from('vehicle_invoices').select('vin, order_id').eq('organization_id', org).eq('industry_type_id', ind).neq('status', 'Cancelled').limit(5000);
    const have = new Set(((invoices ?? []) as Row[]).map((i) => `${str(i.vin)}|${str(i.order_id)}`));
    for (const d of ((deliveries ?? []) as Row[]).filter((x) => !have.has(`${str(x.vin)}|${str(x.order_id)}`)).slice(0, 100)) {
      if (await ensureVehicleInvoice(org, ind, d)) made += 1;
    }
  } catch (error) { logger.error({ err: error }, 'vehicle-invoice: backfill failed'); }
  return made;
}   