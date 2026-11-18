/* eslint-disable @typescript-eslint/no-explicit-any */
// School GST sales invoices + GST credit notes (distributor / wholesaler billing).
// Same rules as the Textile GST invoice: CGST+SGST inside the state, IGST outside, one live invoice per order.
import { AppError } from '../errors/app-error.js';
import { financialYear } from './ist-date.js';
import { logger } from './logger.js';
import { supabaseAdmin } from './supabase.js';
import { addDays, bad, insertNumbered, num, r2, str, today, type Row } from './pharma-db.js';
import { invoiceTotals, isIntraState, splitGst } from './textile-invoice-math.js';

const one = (v: any) => (Array.isArray(v) ? v[0] : v);
const cleanPrefix = (v: unknown) => str(v).replace(/[^A-Za-z0-9/-]/g, '') || 'INV';

export interface SchoolInvoiceLine {
  product_id: string | null; product_name: string; product_code: string; hsn_code: string | null;
  quantity: number; free_quantity: number; rate: number; discount: number;
  taxable_value: number; gst_percent: number; cgst: number; sgst: number; igst: number; amount: number;
}

export async function liveSchoolInvoiceOf(org: string, orderId: string): Promise<Row | null> {
  const { data } = await supabaseAdmin.from('school_invoices').select('id, invoice_number').eq('organization_id', org).eq('order_id', orderId).neq('status', 'Cancelled').limit(1);
  return ((data ?? []) as Row[])[0] ?? null;
}

/** Creates the GST invoice for one dispatched / delivered School order. */
export async function createSchoolInvoice(org: string, it: string, orderId: string, actor: string | null): Promise<Row> {
  if (!orderId) throw bad('Select a sales order.');
  const { data: company } = await supabaseAdmin.from('school_company_profile').select('*').eq('organization_id', org).eq('industry_type_id', it).maybeSingle();
  const co = company as Row | null;
  if (!co?.company_name) throw bad('Save your Company & GST details first. They print on every invoice.', 'COMPANY_PROFILE_REQUIRED');
  const { data: orderRow, error } = await supabaseAdmin.from('sale_orders')
    .select('id, order_number, status, dispatch_status, client_id, tax_amount, clients!inner(*), sale_order_items(product_id, quantity, free_quantity, unit_price, discount_amount, subtotal, tax_percent, products(product_name, product_code, hsn_code, tax_percent))')
    .eq('organization_id', org).eq('id', orderId).maybeSingle();
  if (error) throw error;
  const o = orderRow as Row | null;
  const cl: Row | undefined = o ? one(o.clients) : undefined;
  if (!o || !cl || cl.industry_type_id !== it) throw bad('That sales order does not exist in this industry.', 'INVALID_REFERENCE');
  if (['cancelled', 'rejected', 'draft', 'pending_approval'].includes(String(o.status))) throw bad(`Order ${o.order_number} is ${o.status} and cannot be invoiced.`);
  if (!['dispatched', 'delivered'].includes(String(o.dispatch_status ?? ''))) throw bad(`Dispatch order ${o.order_number} first, so the invoice matches the goods that left the store.`, 'NOT_DISPATCHED');
  const live = await liveSchoolInvoiceOf(org, orderId);
  if (live) throw new AppError(409, 'DUPLICATE_RECORD', `Order ${o.order_number} already has invoice ${live.invoice_number}. Cancel it first to issue a new one.`);
  const items = (o.sale_order_items ?? []) as Row[];
  if (!items.length) throw bad(`Order ${o.order_number} has no items.`);

  const intra = isIntraState(co, cl);
  if (intra === null) throw bad(`Cannot decide CGST/SGST or IGST: add the state or GSTIN for ${cl.client_name} (and your own state in Company & GST).`);

  const lines: SchoolInvoiceLine[] = items.map((i) => {
    const p = one(i.products);
    // A taxed quotation fixed the GST % the school was quoted: the invoice uses the same rate.
    const quoted = num(o.tax_amount) > 0 && num(i.tax_percent) > 0 ? num(i.tax_percent) : null;
    if (quoted === null && (p?.tax_percent === null || p?.tax_percent === undefined)) throw bad(`${p?.product_name ?? 'A product'} has no GST % set. Set it in Products before invoicing.`);
    const gst = quoted ?? num(p.tax_percent);
    const taxable = r2(num(i.subtotal));
    const g = splitGst(taxable, gst, intra);
    return {
      product_id: i.product_id ?? null, product_name: p.product_name, product_code: p.product_code, hsn_code: p.hsn_code ?? null,
      quantity: num(i.quantity), free_quantity: num(i.free_quantity), rate: num(i.unit_price), discount: num(i.discount_amount),
      taxable_value: taxable, gst_percent: gst, cgst: g.cgst, sgst: g.sgst, igst: g.igst, amount: r2(taxable + g.tax),
    };
  });
  const totals = invoiceTotals(lines);
  const date = today();
  try {
    return await insertNumbered('school_invoices', 'invoice_number', org, `${cleanPrefix(co.invoice_prefix)}-${financialYear(date)}-`, {
      industry_type_id: it, order_id: orderId, client_id: o.client_id, invoice_date: date, due_date: addDays(date, num(cl.credit_days)),
      supply_type: intra ? 'Intra-State (CGST + SGST)' : 'Inter-State (IGST)', place_of_supply: str(cl.state) || str(co.state) || null,
      lines, ...totals, status: 'Issued', company: co, created_by: actor,
    });
  } catch (e) {
    const again = await liveSchoolInvoiceOf(org, orderId); // the database allows one live invoice per order
    if (again) throw new AppError(409, 'DUPLICATE_RECORD', `Order ${o.order_number} already has invoice ${again.invoice_number}.`);
    throw e;
  }
}

/** Credit note against one invoice. lines = which invoice lines (by position) and how many units are credited. */
export async function createSchoolCreditNote(org: string, it: string, input: { invoiceId: string; reason: string; lines: { index: number; quantity: number }[] }, actor: string | null): Promise<Row> {
  const reason = str(input.reason);
  if (!reason) throw bad('Enter the reason for the credit note.');
  if (!input.lines?.length) throw bad('Select at least one line to credit.');
  const { data: inv, error } = await supabaseAdmin.from('school_invoices').select('*').eq('organization_id', org).eq('industry_type_id', it).eq('id', input.invoiceId).maybeSingle();
  if (error) throw error;
  const invoice = inv as Row | null;
  if (!invoice) throw new AppError(404, 'RECORD_NOT_FOUND', 'Invoice was not found.');
  if (invoice.status === 'Cancelled') throw bad('A cancelled invoice cannot get a credit note.');
  const { data: prior } = await supabaseAdmin.from('school_credit_notes').select('lines').eq('organization_id', org).eq('invoice_id', input.invoiceId).neq('status', 'Cancelled');
  const credited = new Map<number, number>();
  for (const cn of (prior ?? []) as Row[]) for (const l of (cn.lines ?? []) as Row[]) credited.set(Number(l.index), (credited.get(Number(l.index)) ?? 0) + num(l.quantity));
  const intra = String(invoice.supply_type).startsWith('Intra');
  const invLines = (invoice.lines ?? []) as SchoolInvoiceLine[];
  const seen = new Set<number>();
  const lines = input.lines.map((req) => {
    const idx = Number(req.index); const qty = num(req.quantity);
    const src = invLines[idx];
    if (!src || seen.has(idx)) throw bad('A selected invoice line is not valid.');
    seen.add(idx);
    if (!(qty > 0)) throw bad(`Enter a quantity for ${src.product_name}.`);
    const left = src.quantity - (credited.get(idx) ?? 0);
    if (qty > left + 1e-9) throw bad(`${src.product_name}: only ${left} unit(s) can still be credited.`);
    const taxable = r2((src.taxable_value * qty) / (src.quantity || 1));
    const g = splitGst(taxable, src.gst_percent, intra);
    return { index: idx, product_id: src.product_id, product_name: src.product_name, product_code: src.product_code, hsn_code: src.hsn_code, quantity: qty, rate: src.rate, taxable_value: taxable, gst_percent: src.gst_percent, cgst: g.cgst, sgst: g.sgst, igst: g.igst, amount: r2(taxable + g.tax) };
  });
  const totals = invoiceTotals(lines);
  const date = today();
  return insertNumbered('school_credit_notes', 'credit_note_number', org, `CN-${financialYear(date)}-`, {
    industry_type_id: it, invoice_id: invoice.id, order_id: invoice.order_id, client_id: invoice.client_id, note_date: date, reason, lines, ...totals, status: 'Issued', created_by: actor,
  });
}

/** What each School order was actually invoiced (GST included). Orders without an invoice are simply absent. */
export async function schoolInvoicedByOrder(org: string, orderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    for (let i = 0; i < orderIds.length; i += 100) {
      const { data, error } = await supabaseAdmin.from('school_invoices').select('order_id, total_amount').eq('organization_id', org).neq('status', 'Cancelled').in('order_id', orderIds.slice(i, i + 100));
      if (error) return out; // table missing (migration not run yet): behave exactly as before
      for (const r of (data ?? []) as { order_id: string; total_amount: unknown }[]) out.set(r.order_id, (out.get(r.order_id) ?? 0) + (Number(r.total_amount) || 0));
    }
  } catch (e) { logger.warn({ err: e }, 'school: invoiced-by-order lookup failed'); }
  return out;
}

export async function assertNoLiveSchoolInvoice(org: string, orderId: string, action: 'edited' | 'cancelled'): Promise<void> {
  let live: { invoice_number?: string }[] | null = null;
  try {
    const { data, error } = await supabaseAdmin.from('school_invoices').select('invoice_number').eq('organization_id', org).eq('order_id', orderId).neq('status', 'Cancelled').limit(1);
    if (error) return; // table missing / not School
    live = data as { invoice_number?: string }[] | null;
  } catch { return; }
  if (live && live.length) throw new AppError(422, 'ORDER_HAS_INVOICE', `This order already has GST invoice ${live[0].invoice_number}, so it cannot be ${action}. Cancel the invoice first in GST Sales Invoices.`);
}