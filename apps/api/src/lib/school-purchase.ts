/* eslint-disable @typescript-eslint/no-explicit-any */
// School purchase side: purchase orders, goods receipt (GRN, which puts stock on the shelf) and supplier payments.
import { AppError } from '../errors/app-error.js';
import { financialYear } from './ist-date.js';
import { supabaseAdmin } from './supabase.js';
import { all, bad, industryProducts, insertNumbered, num, r2, str, today, type Row } from './pharma-db.js';
import { changeProductStock } from '../repositories/products.repository.js';

const notFound = (what: string) => new AppError(404, 'RECORD_NOT_FOUND', `${what} was not found.`);
const lineAmount = (l: { quantity: number; rate: number; gst_percent: number }) => r2(l.quantity * l.rate * (1 + l.gst_percent / 100));
const totalsOf = (lines: { quantity: number; rate: number; gst_percent: number }[]) => {
  const subtotal = r2(lines.reduce((s, l) => s + l.quantity * l.rate, 0));
  const total = r2(lines.reduce((s, l) => s + lineAmount(l), 0));
  return { subtotal, tax_amount: r2(total - subtotal), total_amount: total };
};

async function supplierOf(org: string, it: string, id: unknown): Promise<Row> {
  const { data, error } = await supabaseAdmin.from('school_suppliers').select('*').eq('organization_id', org).eq('industry_type_id', it).eq('id', String(id ?? '')).maybeSingle();
  if (error) throw error;
  if (!data) throw bad('Select a valid supplier.', 'INVALID_REFERENCE');
  if ((data as Row).status !== 'Active') throw bad('That supplier is inactive.');
  return data as Row;
}

// ------------------------------------------------------------------ purchase orders
export async function createPurchaseOrder(org: string, it: string, input: Row, actor: string | null): Promise<Row> {
  const supplier = await supplierOf(org, it, input.supplier_id);
  const raw = Array.isArray(input.lines) ? (input.lines as Row[]) : [];
  if (!raw.length) throw bad('Add at least one product line.');
  const products = new Map((await industryProducts(org, it)).map((p) => [String(p.id), p]));
  const seen = new Set<string>();
  const lines = raw.map((l) => {
    const p = products.get(String(l.product_id ?? ''));
    if (!p) throw bad('A product on the order is not part of this industry.', 'INVALID_REFERENCE');
    if (seen.has(String(p.id))) throw bad(`${p.product_name} is on the order twice. Merge the lines.`);
    seen.add(String(p.id));
    const quantity = num(l.quantity); const rate = num(l.rate); const gst = l.gst_percent === undefined || l.gst_percent === '' ? num(p.tax_percent) : num(l.gst_percent);
    if (!(quantity > 0)) throw bad(`Enter a quantity for ${p.product_name}.`);
    if (rate < 0 || gst < 0 || gst > 100) throw bad(`Rate or GST % is not valid for ${p.product_name}.`);
    return { product_id: p.id, product_name: p.product_name, product_code: p.product_code, hsn_code: p.hsn_code ?? null, quantity, received_quantity: 0, rate, gst_percent: gst, amount: lineAmount({ quantity, rate, gst_percent: gst }) };
  });
  const date = str(input.order_date) || today();
  return insertNumbered('school_purchase_orders', 'po_number', org, `PO-${financialYear(date)}-`, {
    industry_type_id: it, supplier_id: supplier.id, order_date: date, expected_date: str(input.expected_date) || null, status: 'Draft',
    lines, ...totalsOf(lines), notes: str(input.notes) || null, created_by: actor,
  });
}

export async function setPurchaseOrderStatus(org: string, it: string, id: string, status: string): Promise<Row> {
  if (!['Draft', 'Sent', 'Cancelled'].includes(status)) throw bad('A purchase order can only be set to Draft, Sent or Cancelled by hand. Receiving goods updates the rest.');
  const { data: po } = await supabaseAdmin.from('school_purchase_orders').select('id, status, lines').eq('organization_id', org).eq('industry_type_id', it).eq('id', id).maybeSingle();
  if (!po) throw notFound('Purchase order');
  const current = String((po as Row).status);
  if (['Partially received', 'Received'].includes(current)) throw bad('Goods were already received against this order, so its status cannot be changed.');
  if (current === 'Cancelled' && status !== 'Cancelled') throw bad('A cancelled order cannot be reopened. Create a new one.');
  const { data, error } = await supabaseAdmin.from('school_purchase_orders').update({ status }).eq('organization_id', org).eq('id', id).select().single();
  if (error) throw error;
  return data as Row;
}

// ------------------------------------------------------------------ goods receipt (GRN)
async function applyPoReceipt(org: string, poId: string, deltas: Map<string, number>) {
  const { data: po } = await supabaseAdmin.from('school_purchase_orders').select('id, status, lines').eq('organization_id', org).eq('id', poId).maybeSingle();
  if (!po) return;
  const lines = ((po as Row).lines as Row[]).map((l) => ({ ...l, received_quantity: Math.max(0, r2(num(l.received_quantity) + (deltas.get(String(l.product_id)) ?? 0))) }));
  const allIn = lines.every((l) => num(l.received_quantity) >= num(l.quantity));
  const any = lines.some((l) => num(l.received_quantity) > 0);
  const status = allIn ? 'Received' : any ? 'Partially received' : 'Sent';
  await supabaseAdmin.from('school_purchase_orders').update({ lines, status }).eq('organization_id', org).eq('id', poId);
}

export async function createGrn(org: string, it: string, input: Row, actor: string | null): Promise<Row> {
  let po: Row | null = null;
  let supplierId = input.supplier_id;
  if (input.po_id) {
    const { data } = await supabaseAdmin.from('school_purchase_orders').select('*').eq('organization_id', org).eq('industry_type_id', it).eq('id', String(input.po_id)).maybeSingle();
    po = data as Row | null;
    if (!po) throw bad('Select a valid purchase order.', 'INVALID_REFERENCE');
    if (['Draft', 'Cancelled', 'Received'].includes(String(po.status))) throw bad(`Purchase order ${po.po_number} is ${String(po.status).toLowerCase()}. Mark it Sent before receiving goods.`);
    supplierId = po.supplier_id;
  }
  const supplier = await supplierOf(org, it, supplierId);
  const raw = Array.isArray(input.lines) ? (input.lines as Row[]).filter((l) => num(l.quantity) > 0) : [];
  if (!raw.length) throw bad('Enter the received quantity for at least one product.');
  const products = new Map((await industryProducts(org, it)).map((p) => [String(p.id), p]));
  const poLines = new Map(((po?.lines ?? []) as Row[]).map((l) => [String(l.product_id), l]));
  const seen = new Set<string>();
  const lines = raw.map((l) => {
    const pid = String(l.product_id ?? '');
    const p = products.get(pid);
    if (!p) throw bad('A received product is not part of this industry.', 'INVALID_REFERENCE');
    if (seen.has(pid)) throw bad(`${p.product_name} is listed twice.`);
    seen.add(pid);
    const qty = num(l.quantity);
    let rate = num(l.rate); let gst = num(p.tax_percent);
    if (po) {
      const pl = poLines.get(pid);
      if (!pl) throw bad(`${p.product_name} is not on purchase order ${po.po_number}.`);
      const left = num(pl.quantity) - num(pl.received_quantity);
      if (qty > left + 1e-9) throw bad(`${p.product_name}: only ${left} unit(s) are still pending on ${po.po_number}.`);
      if (l.rate === undefined || l.rate === '') rate = num(pl.rate);
      gst = num(pl.gst_percent);
    }
    if (rate < 0) throw bad(`Rate is not valid for ${p.product_name}.`);
    return { product_id: pid, product_name: p.product_name, product_code: p.product_code, quantity: qty, rate, gst_percent: gst, amount: lineAmount({ quantity: qty, rate, gst_percent: gst }) };
  });
  const date = str(input.received_date) || today();
  const grn = await insertNumbered('school_grns', 'grn_number', org, `GRN-${financialYear(date)}-`, {
    industry_type_id: it, po_id: po?.id ?? null, supplier_id: supplier.id, received_date: date, supplier_invoice_no: str(input.supplier_invoice_no) || null,
    lines, total_amount: totalsOf(lines).total_amount, status: 'Posted', notes: str(input.notes) || null, created_by: actor,
  });
  // Put the stock on the shelf; if any line fails, take back what was added and remove the GRN.
  const added: Row[] = [];
  try {
    for (const l of lines) { await changeProductStock(org, String(l.product_id), num(l.quantity), true); added.push(l); }
    if (po) await applyPoReceipt(org, String(po.id), new Map(lines.map((l) => [String(l.product_id), num(l.quantity)])));
  } catch (e) {
    for (const l of added) await changeProductStock(org, String(l.product_id), -num(l.quantity), true).catch(() => undefined);
    await supabaseAdmin.from('school_grns').delete().eq('organization_id', org).eq('id', grn.id);
    throw e;
  }
  return grn;
}

export async function cancelGrn(org: string, it: string, id: string): Promise<Row> {
  const { data } = await supabaseAdmin.from('school_grns').select('*').eq('organization_id', org).eq('industry_type_id', it).eq('id', id).maybeSingle();
  const grn = data as Row | null;
  if (!grn) throw notFound('Goods receipt');
  if (grn.status === 'Cancelled') throw bad('This goods receipt is already cancelled.');
  const { count } = await supabaseAdmin.from('school_supplier_payments').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('grn_id', id);
  if ((count ?? 0) > 0) throw bad('A supplier payment is linked to this goods receipt. Delete that payment first.');
  // Claim the cancellation first so a double click can never take the stock back twice.
  const { data: claimed } = await supabaseAdmin.from('school_grns').update({ status: 'Cancelled' }).eq('organization_id', org).eq('id', id).eq('status', 'Posted').select('id');
  if (!claimed?.length) throw new AppError(409, 'GRN_CHANGED', 'This goods receipt was just changed by someone else. Refresh and try again.');
  const taken: Row[] = [];
  try {
    for (const l of (grn.lines ?? []) as Row[]) { await changeProductStock(org, String(l.product_id), -num(l.quantity), false); taken.push(l); } // fails if the goods were already sold
    if (grn.po_id) await applyPoReceipt(org, String(grn.po_id), new Map(((grn.lines ?? []) as Row[]).map((l) => [String(l.product_id), -num(l.quantity)])));
  } catch (e) {
    for (const l of taken) await changeProductStock(org, String(l.product_id), num(l.quantity), true).catch(() => undefined);
    await supabaseAdmin.from('school_grns').update({ status: 'Posted' }).eq('organization_id', org).eq('id', id);
    throw e instanceof AppError && e.code === 'INSUFFICIENT_STOCK' ? bad('Part of this stock has already been sold, so the receipt cannot be cancelled. Record a purchase return with the supplier instead.', 'STOCK_ALREADY_SOLD') : e;
  }
  return { ...grn, status: 'Cancelled' };
}

// ------------------------------------------------------------------ supplier payments + payables
export async function createSupplierPayment(org: string, it: string, input: Row, actor: string | null): Promise<Row> {
  const supplier = await supplierOf(org, it, input.supplier_id);
  const amount = r2(num(input.amount));
  if (!(amount > 0)) throw bad('Enter an amount greater than zero.');
  if (input.grn_id) {
    const { data: g } = await supabaseAdmin.from('school_grns').select('id, supplier_id, status').eq('organization_id', org).eq('industry_type_id', it).eq('id', String(input.grn_id)).maybeSingle();
    if (!g || (g as Row).supplier_id !== supplier.id || (g as Row).status !== 'Posted') throw bad('Select a posted goods receipt of the same supplier.', 'INVALID_REFERENCE');
  }
  const date = str(input.payment_date) || today();
  return insertNumbered('school_supplier_payments', 'payment_number', org, `SPAY-${financialYear(date)}-`, {
    industry_type_id: it, supplier_id: supplier.id, grn_id: input.grn_id || null, amount, payment_date: date, mode: str(input.mode) || null, reference_no: str(input.reference_no) || null, notes: str(input.notes) || null, created_by: actor,
  });
}

/** Payable per supplier = posted goods receipts (GST included) - payments made. */
export async function supplierOutstanding(org: string, it: string): Promise<Row[]> {
  const [suppliers, grns, pays] = await Promise.all([
    all(() => supabaseAdmin.from('school_suppliers').select('id, supplier_code, supplier_name, payment_terms_days').eq('organization_id', org).eq('industry_type_id', it)),
    all(() => supabaseAdmin.from('school_grns').select('supplier_id, total_amount, received_date').eq('organization_id', org).eq('industry_type_id', it).eq('status', 'Posted')),
    all(() => supabaseAdmin.from('school_supplier_payments').select('supplier_id, amount').eq('organization_id', org).eq('industry_type_id', it)),
  ]);
  return suppliers.map((s) => {
    const bought = r2(grns.filter((g) => g.supplier_id === s.id).reduce((t, g) => t + num(g.total_amount), 0));
    const paid = r2(pays.filter((p) => p.supplier_id === s.id).reduce((t, p) => t + num(p.amount), 0));
    return { supplier_id: s.id, supplier_code: s.supplier_code, supplier_name: s.supplier_name, purchased: bought, paid, payable: r2(Math.max(0, bought - paid)), advance_paid: r2(Math.max(0, paid - bought)) };
  }).filter((r) => r.purchased > 0 || r.paid > 0).sort((a, b) => b.payable - a.payable);
}
