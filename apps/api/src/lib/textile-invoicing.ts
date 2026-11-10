/* eslint-disable @typescript-eslint/no-explicit-any */
// Textile GST sales invoice for a sales order. One code path for the manual "Create invoice" button and the auto-invoice on dispatch.
import { AppError } from '../errors/app-error.js';
import { financialYear } from './ist-date.js';
import { logger } from './logger.js';
import { supabaseAdmin } from './supabase.js';
import { addDays, bad, insertNumbered, num, r2, str, today, type Row } from './pharma-db.js';
import { invoiceTotals, isIntraState, splitGst, type InvoiceLine } from './textile-invoice-math.js';
import { assertRollsCoverOrder } from './textile-rolls.js';

const cleanPrefix = (v: unknown) => (str(v).replace(/[^A-Za-z0-9/-]/g, '') || 'INV');
const one = (v: any) => (Array.isArray(v) ? v[0] : v);

export async function liveInvoiceOf(orgId: string, orderId: string): Promise<Row | null> {
  const { data } = await supabaseAdmin.from('textile_invoices').select('id, invoice_number').eq('organization_id', orgId).eq('order_id', orderId).neq('status', 'Cancelled').limit(1);
  return ((data ?? []) as Row[])[0] ?? null;
}

/** requireAllocated: fabric rolls must cover the ordered metres (so the invoice matches what is really dispatched). */
export async function createTextileInvoice(orgId: string, it: string, orderId: string, actor: string | null, opts: { requireAllocated?: boolean } = {}): Promise<Row> {
  if (!orderId) throw bad('Select a sales order.');
  const { data: company } = await supabaseAdmin.from('textile_company_profile').select('*').eq('organization_id', orgId).eq('industry_type_id', it).maybeSingle();
  const co = company as Row | null;
  if (!co?.company_name) throw bad('Save your Company & GST details first. They print on every invoice.', 'COMPANY_PROFILE_REQUIRED');
  const { data: orderRow, error } = await supabaseAdmin.from('sale_orders')
    .select('id, order_number, status, client_id, tax_amount, clients!inner(*), sale_order_items(quantity, free_quantity, unit_price, discount_amount, subtotal, tax_percent, colour, products(product_name, product_code, hsn_code, tax_percent))')
    .eq('organization_id', orgId).eq('id', orderId).maybeSingle();
  if (error) throw error;
  const o = orderRow as Row | null;
  const cl: Row | undefined = o ? one(o.clients) : undefined;
  if (!o || !cl || cl.industry_type_id !== it) throw bad('That sales order does not exist in this industry.', 'INVALID_REFERENCE');
  if (['cancelled', 'rejected', 'draft', 'pending_approval'].includes(String(o.status))) throw bad(`Order ${o.order_number} is ${o.status} and cannot be invoiced.`);
  const live = await liveInvoiceOf(orgId, orderId);
  if (live) throw new AppError(409, 'DUPLICATE_RECORD', `Order ${o.order_number} already has invoice ${live.invoice_number}. Cancel it first to issue a new one.`);
  const items = (o.sale_order_items ?? []) as Row[];
  if (!items.length) throw bad(`Order ${o.order_number} has no items.`);
  if (opts.requireAllocated !== false) await assertRollsCoverOrder(orgId, orderId);

  const intra = isIntraState(co, cl);
  if (intra === null) throw bad(`Cannot decide CGST/SGST or IGST: add the state or GSTIN for ${cl.client_name} (and your own state in Company & GST).`);

  const { data: rolls } = await supabaseAdmin.from('textile_fabric_rolls').select('roll_number, product_code').eq('organization_id', orgId).eq('order_id', orderId);
  const rollsOf = new Map<string, string[]>();
  for (const r of (rolls ?? []) as Row[]) rollsOf.set(String(r.product_code), [...(rollsOf.get(String(r.product_code)) ?? []), String(r.roll_number)]);

  const lines: InvoiceLine[] = items.map((i) => {
    const p = one(i.products);
    // A taxed quotation fixed the GST % the customer was quoted: the invoice uses the same rate.
    const quoted = num(o.tax_amount) > 0 && num(i.tax_percent) > 0 ? num(i.tax_percent) : null;
    if (quoted === null && (p?.tax_percent === null || p?.tax_percent === undefined)) throw bad(`${p?.product_name ?? 'A product'} has no GST % set. Set it in Products before invoicing.`);
    const gst = quoted ?? num(p.tax_percent);
    const taxable = r2(num(i.subtotal));
    const g = splitGst(taxable, gst, intra);
    return {
      product_name: p.product_name, product_code: p.product_code, hsn_code: p.hsn_code ?? null, colour: i.colour ?? null,
      quantity: num(i.quantity), free_quantity: num(i.free_quantity), rate: num(i.unit_price), discount: num(i.discount_amount),
      taxable_value: taxable, gst_percent: gst, cgst: g.cgst, sgst: g.sgst, igst: g.igst, amount: r2(taxable + g.tax),
      roll_numbers: rollsOf.get(String(p.product_code)) ?? [],
    };
  });
  const totals = invoiceTotals(lines);
  const date = today();
  try {
    return await insertNumbered('textile_invoices', 'invoice_number', orgId, `${cleanPrefix(co.invoice_prefix)}-${financialYear(date)}-`, {
      industry_type_id: it, order_id: orderId, client_id: o.client_id, invoice_date: date, due_date: addDays(date, num(cl.credit_days)),
      supply_type: intra ? 'Intra-State (CGST + SGST)' : 'Inter-State (IGST)', place_of_supply: str(cl.state) || str(co.state) || null,
      lines, ...totals, status: 'Issued', company: co, created_by: actor,
    });
  } catch (e) {
    // The database allows one live invoice per order: a second click / second user lands here.
    const again = await liveInvoiceOf(orgId, orderId);
    if (again) throw new AppError(409, 'DUPLICATE_RECORD', `Order ${o.order_number} already has invoice ${again.invoice_number}.`);
    throw e;
  }
}

/** Automation: when an order is dispatched the GST invoice is raised by itself. Never blocks the dispatch. */
export async function autoInvoiceOnDispatch(orgId: string, it: string | null, orderId: string, actor: string | null): Promise<{ invoice: Row | null; note: string | null }> {
  if (!it) return { invoice: null, note: null };
  try {
    const live = await liveInvoiceOf(orgId, orderId);
    if (live) return { invoice: live, note: null };
    const { data: profile } = await supabaseAdmin.from('textile_company_profile').select('id').eq('organization_id', orgId).eq('industry_type_id', it).maybeSingle();
    if (!profile) return { invoice: null, note: 'No GST invoice was created: save Company & GST details in GST Sales Invoices to turn on automatic invoicing.' };
    const invoice = await createTextileInvoice(orgId, it, orderId, actor, { requireAllocated: false });
    return { invoice, note: null };
  } catch (e) {
    logger.warn({ err: e, orderId }, 'textile: automatic invoice on dispatch failed');
    return { invoice: null, note: `GST invoice was not created automatically: ${e instanceof Error ? e.message : 'unknown error'} Create it in GST Sales Invoices.` };
  }
}
