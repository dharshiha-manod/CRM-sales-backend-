/* eslint-disable @typescript-eslint/no-explicit-any */
// GST invoice creation for a sales order (moved out of pharma-distributor.routes.ts so the automation job can call the same code).
import { AppError } from '../errors/app-error.js';
import { financialYear } from './ist-date.js';
import { supabaseAdmin } from './supabase.js';
import { addDays, all, bad, insertNumbered, num, r2, str, today, type Row } from './pharma-db.js';

const cleanPrefix = (v: unknown) => (str(v).replace(/[^A-Za-z0-9/-]/g, '') || 'INV');

/** requireDispatched: manual invoicing only invoices goods that have left the warehouse (the auto-invoice setting decides for the job). */
export async function createPharmaInvoice(orgId: string, it: string, orderId: string, actor: string | null, opts: { requireDispatched?: boolean } = {}): Promise<Row> {
  if (!orderId) throw bad('Select a sales order.');
  const { data: company } = await supabaseAdmin.from('pharma_company_profile').select('*').eq('organization_id', orgId).eq('industry_type_id', it).maybeSingle();
  const co = company as Row | null;
  if (!co?.company_name) throw bad('Save your Company & GST details first. They print on every invoice.', 'COMPANY_PROFILE_REQUIRED');
  const { data: orderRow, error } = await supabaseAdmin.from('sale_orders')
    .select('id, order_number, status, client_id, tax_amount, dispatch_status, clients!inner(*), sale_order_items(quantity, free_quantity, unit_price, discount_amount, subtotal, tax_percent, batch_allocations, products(product_name, product_code, hsn_code, tax_percent))')
    .eq('organization_id', orgId).eq('id', orderId).maybeSingle();
  if (error) throw error;
  const o = orderRow as Row | null;
  const cl: Row | undefined = o ? (Array.isArray(o.clients) ? o.clients[0] : o.clients) : undefined;
  if (!o || !cl || cl.industry_type_id !== it) throw bad('That sales order does not exist in this industry.', 'INVALID_REFERENCE');
  if (['cancelled', 'rejected', 'draft', 'pending_approval'].includes(String(o.status))) throw bad(`Order ${o.order_number} is ${o.status} and cannot be invoiced.`);
  if (opts.requireDispatched && !['dispatched', 'delivered'].includes(String(o.dispatch_status ?? ''))) throw bad(`Goods not dispatched: order ${o.order_number} has not been dispatched yet. Invoice it once the goods leave, or confirm to invoice early.`, 'NOT_DISPATCHED');
  const { data: live } = await supabaseAdmin.from('pharma_invoices').select('invoice_number').eq('organization_id', orgId).eq('order_id', orderId).neq('status', 'Cancelled').limit(1);
  if (live && live.length) throw new AppError(409, 'DUPLICATE_RECORD', `Order ${o.order_number} already has invoice ${(live[0] as Row).invoice_number}. Cancel it first to issue a new one.`);
  const items = (o.sale_order_items ?? []) as Row[];
  if (!items.length) throw bad(`Order ${o.order_number} has no items.`);
  const code = (g: unknown) => (/^\d{2}/.test(str(g)) ? str(g).slice(0, 2) : null);
  let intra: boolean | null = null;
  if (code(co.gstin) && code(cl.gstin)) intra = code(co.gstin) === code(cl.gstin);
  else if (str(co.state) && str(cl.state)) intra = str(co.state).toLowerCase() === str(cl.state).toLowerCase();
  if (intra === null) throw bad(`Cannot decide CGST/SGST or IGST: add the state or GSTIN for ${cl.client_name} (and your own state in Company & GST).`);
  const batchNos = [...new Set(items.flatMap((i) => (((i.batch_allocations as Row | null)?.batches ?? []) as Row[]).map((p) => str(p.batchNo))).filter(Boolean))];
  const expiry = new Map<string, string>();
  if (batchNos.length) {
    const bs = await all(() => supabaseAdmin.from('pharma_batches').select('batch_number, expiry_date').eq('organization_id', orgId).in('batch_number', batchNos));
    for (const x of bs) expiry.set(String(x.batch_number), String(x.expiry_date ?? '').slice(0, 10));
  }
  const lines = items.map((i) => {
    const p = Array.isArray(i.products) ? i.products[0] : i.products;
    // Order came from a taxed quotation: the customer was quoted that line's GST %, so the invoice must use the same rate (the credit note already assumes it).
    const quotedGst = num(o.tax_amount) > 0 && i.tax_percent !== null && i.tax_percent !== undefined && num(i.tax_percent) > 0 ? num(i.tax_percent) : null;
    if (quotedGst === null && (p?.tax_percent === null || p?.tax_percent === undefined)) throw bad(`${p?.product_name ?? 'A product'} has no GST % set. Set it in Products before invoicing.`);
    const gst = quotedGst ?? num(p.tax_percent); const taxable = r2(num(i.subtotal)); const tax = r2((taxable * gst) / 100);
    const cgst = intra ? r2(tax / 2) : 0; const sgst = intra ? r2(tax - cgst) : 0; const igst = intra ? 0 : tax;
    const batches = (((i.batch_allocations as Row | null)?.batches ?? []) as Row[]).map((x) => ({ batch_number: str(x.batchNo), expiry_date: expiry.get(str(x.batchNo)) ?? null }));
    return { product_name: p.product_name, product_code: p.product_code, hsn_code: p.hsn_code ?? null, batches, quantity: num(i.quantity), free_quantity: num(i.free_quantity), rate: num(i.unit_price), discount: num(i.discount_amount), taxable_value: taxable, gst_percent: gst, cgst, sgst, igst };
  });
  const taxable = r2(lines.reduce((s, l) => s + l.taxable_value, 0));
  const cgst = r2(lines.reduce((s, l) => s + l.cgst, 0)); const sgst = r2(lines.reduce((s, l) => s + l.sgst, 0)); const igst = r2(lines.reduce((s, l) => s + l.igst, 0));
  const exact = taxable + cgst + sgst + igst; const total = Math.round(exact);
  const date = today(); const due = addDays(date, num(cl.credit_days));
  const prefix = cleanPrefix(co.invoice_prefix);
  return insertNumbered('pharma_invoices', 'invoice_number', orgId, `${prefix}-${financialYear(date)}-`, {
    industry_type_id: it, order_id: orderId, client_id: o.client_id, invoice_date: date, due_date: due, supply_type: intra ? 'Intra-State (CGST + SGST)' : 'Inter-State (IGST)',
    place_of_supply: str(cl.state) || str(co.state) || null, lines, taxable_amount: taxable, cgst_amount: cgst, sgst_amount: sgst, igst_amount: igst,
    round_off: r2(total - exact), total_amount: total, status: 'Issued', company: co, created_by: actor,
  });
}