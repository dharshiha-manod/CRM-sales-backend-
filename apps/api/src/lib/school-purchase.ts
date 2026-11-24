/* eslint-disable @typescript-eslint/no-explicit-any */
// School purchase side: purchase orders, goods receipt (GRN, which puts stock on the shelf) and supplier payments.
import { AppError } from '../errors/app-error.js';
import { financialYear } from './ist-date.js';
import { supabaseAdmin } from './supabase.js';
import { addDays, all, bad, diffDays, industryProducts, insertNumbered, num, r2, str, today, type Row } from './pharma-db.js';
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
/**
 * Re-counts what has been received on a PO from its Posted goods receipts (the source of truth), so two receipts saved at the same moment can never
 * lose each other's quantities. Returns the name of a product that is now received above the ordered quantity (a race), or null.
 */
async function syncPoReceipts(org: string, poId: string): Promise<string | null> {
  const { data: po } = await supabaseAdmin.from('school_purchase_orders').select('id, status, lines').eq('organization_id', org).eq('id', poId).maybeSingle();
  if (!po) return null;
  const grns = await all(() => supabaseAdmin.from('school_grns').select('lines').eq('organization_id', org).eq('po_id', poId).eq('status', 'Posted'));
  const got = new Map<string, number>();
  for (const g of grns) for (const l of (g.lines ?? []) as Row[]) got.set(String(l.product_id), (got.get(String(l.product_id)) ?? 0) + num(l.quantity));
  const lines = ((po as Row).lines as Row[]).map((l): Row => ({ ...l, received_quantity: r2(got.get(String(l.product_id)) ?? 0) }));
  const over = lines.find((l) => num(l.received_quantity) > num(l.quantity) + 1e-9);
  const allIn = lines.every((l) => num(l.received_quantity) >= num(l.quantity));
  const any = lines.some((l) => num(l.received_quantity) > 0);
  const status = allIn ? 'Received' : any ? 'Partially received' : 'Sent';
  await supabaseAdmin.from('school_purchase_orders').update({ lines, status }).eq('organization_id', org).eq('id', poId);
  return over ? String(over.product_name) : null;
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
    received_by: str(input.received_by) || null, source: ['manual', 'po-quick', 'shipment'].includes(str(input.source)) ? str(input.source) : 'manual',
  });
  // Put the stock on the shelf; if any line fails, take back what was added and remove the GRN.
  const added: Row[] = [];
  try {
    for (const l of lines) { await changeProductStock(org, String(l.product_id), num(l.quantity), true); added.push(l); }
    if (po) {
      const over = await syncPoReceipts(org, String(po.id));
      if (over) throw bad(`${over} was just received on this order by someone else too, so this receipt would be more than ordered. Refresh and try again.`, 'PO_OVER_RECEIVED');
    }
  } catch (e) {
    for (const l of added) await changeProductStock(org, String(l.product_id), -num(l.quantity), true).catch(() => undefined);
    await supabaseAdmin.from('school_grns').delete().eq('organization_id', org).eq('id', grn.id);
    if (po) await syncPoReceipts(org, String(po.id)).catch(() => undefined); // put the PO's received quantities back
    throw e;
  }
  return grn;
}

export async function cancelGrn(org: string, it: string, id: string): Promise<Row> {
  const { data } = await supabaseAdmin.from('school_grns').select('*').eq('organization_id', org).eq('industry_type_id', it).eq('id', id).maybeSingle();
  const grn = data as Row | null;
  if (!grn) throw notFound('Goods receipt');
  if (grn.status === 'Cancelled') throw bad('This goods receipt is already cancelled.');
  const { count: retCount } = await supabaseAdmin.from('school_purchase_returns').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('grn_id', id).eq('status', 'Posted');
  if ((retCount ?? 0) > 0) throw bad('Goods were already returned against this receipt. Cancel that purchase return first.');
  const { count } = await supabaseAdmin.from('school_supplier_payments').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('grn_id', id);
  if ((count ?? 0) > 0) throw bad('A supplier payment is linked to this goods receipt. Delete that payment first.');
  // Claim the cancellation first so a double click can never take the stock back twice.
  const { data: claimed } = await supabaseAdmin.from('school_grns').update({ status: 'Cancelled' }).eq('organization_id', org).eq('id', id).eq('status', 'Posted').select('id');
  if (!claimed?.length) throw new AppError(409, 'GRN_CHANGED', 'This goods receipt was just changed by someone else. Refresh and try again.');
  const taken: Row[] = [];
  try {
    for (const l of (grn.lines ?? []) as Row[]) { await changeProductStock(org, String(l.product_id), -num(l.quantity), false); taken.push(l); } // fails if the goods were already sold
    if (grn.po_id) await syncPoReceipts(org, String(grn.po_id)); // this receipt is already Cancelled, so it drops out of the count
  } catch (e) {
    for (const l of taken) await changeProductStock(org, String(l.product_id), num(l.quantity), true).catch(() => undefined);
    await supabaseAdmin.from('school_grns').update({ status: 'Posted' }).eq('organization_id', org).eq('id', id);
    if (grn.po_id) await syncPoReceipts(org, String(grn.po_id)).catch(() => undefined);
    throw e instanceof AppError && e.code === 'INSUFFICIENT_STOCK' ? bad('Part of this stock has already been sold, so the receipt cannot be cancelled. Record a purchase return with the supplier instead.', 'STOCK_ALREADY_SOLD') : e;
  }
  return { ...grn, status: 'Cancelled' };
}

// ------------------------------------------------------------------ receiving desk
/** One-tap goods receipt against a PO. Without `lines` everything still pending is received; with `lines` only those quantities. */
export async function receiveAgainstPo(org: string, it: string, poId: string, input: Row, actor: string | null): Promise<Row> {
  const { data } = await supabaseAdmin.from('school_purchase_orders').select('*').eq('organization_id', org).eq('industry_type_id', it).eq('id', poId).maybeSingle();
  const po = data as Row | null;
  if (!po) throw notFound('Purchase order');
  const custom = Array.isArray(input.lines);
  const wanted = new Map<string, number>(((input.lines ?? []) as Row[]).map((l) => [String(l.product_id), num(l.quantity)]));
  const lines = ((po.lines ?? []) as Row[]).map((l) => {
    const pending = r2(num(l.quantity) - num(l.received_quantity));
    return { product_id: l.product_id, quantity: custom ? (wanted.get(String(l.product_id)) ?? 0) : pending, rate: l.rate };
  }).filter((l) => l.quantity > 0);
  if (!lines.length) throw bad('Nothing to receive: enter a received quantity for at least one product.');
  return createGrn(org, it, {
    po_id: poId, lines, received_date: input.received_date, received_by: input.received_by, notes: input.notes,
    supplier_invoice_no: str(input.supplier_invoice_no) || str(po.shipment_invoice_no) || null, source: str(input.source) || 'po-quick',
  }, actor);
}

/** Open purchase orders that still have goods to come, with the date we expect them (supplier's shipment ETA > promised date > PO date). */
export async function arrivals(org: string, it: string): Promise<Row[]> {
  const pos = await all(() => supabaseAdmin.from('school_purchase_orders')
    .select('id, po_number, status, expected_date, order_date, lines, total_amount, supplier_response, supplier_delivery_date, shipped_at, shipment_invoice_no, shipment_vehicle_no, shipment_eta, shipment_note, school_suppliers(supplier_name, supplier_code)')
    .eq('organization_id', org).eq('industry_type_id', it).in('status', ['Sent', 'Partially received']));
  const t = today();
  return pos.map((po) => {
    const lines = ((po.lines ?? []) as Row[]).map((l) => {
      const pending = r2(num(l.quantity) - num(l.received_quantity));
      return { product_id: l.product_id, product_code: l.product_code, product_name: l.product_name, ordered: num(l.quantity), received: num(l.received_quantity), pending, rate: num(l.rate), gst_percent: num(l.gst_percent) };
    }).filter((l) => l.pending > 0);
    const due: string | null = str(po.shipment_eta) || str(po.supplier_delivery_date) || str(po.expected_date) || null;
    const late = due ? diffDays(t, due) : null;
    const bucket = late === null ? 'No date' : late > 0 ? 'Overdue' : late === 0 ? 'Today' : late >= -7 ? 'This week' : 'Later';
    const supplier = (Array.isArray(po.school_suppliers) ? po.school_suppliers[0] : po.school_suppliers) as Row | null;
    return {
      po_id: po.id, po_number: po.po_number, status: po.status, supplier_name: supplier?.supplier_name ?? '', supplier_code: supplier?.supplier_code ?? '',
      order_date: po.order_date, due_date: due, days_late: late, bucket, supplier_response: po.supplier_response ?? null,
      shipped_at: po.shipped_at ?? null, shipment_invoice_no: po.shipment_invoice_no ?? null, shipment_vehicle_no: po.shipment_vehicle_no ?? null, shipment_note: po.shipment_note ?? null,
      pending_qty: r2(lines.reduce((s, l) => s + l.pending, 0)), pending_value: r2(lines.reduce((s, l) => s + l.pending * l.rate * (1 + l.gst_percent / 100), 0)), lines,
    };
  }).filter((r) => r.lines.length > 0).sort((a, b) => String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')));
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

/**
 * What we owe each supplier, bill by bill. A bill is a posted goods receipt (GST included), due `credit days` after it was received.
 * Payments that name a receipt settle that receipt first; everything else settles the oldest bill first (FIFO).
 */
export async function supplierOutstanding(org: string, it: string): Promise<Row[]> {
  const [suppliers, grns, pays, rets] = await Promise.all([
    all(() => supabaseAdmin.from('school_suppliers').select('id, supplier_code, supplier_name, payment_terms_days').eq('organization_id', org).eq('industry_type_id', it)),
    all(() => supabaseAdmin.from('school_grns').select('id, grn_number, supplier_id, supplier_invoice_no, total_amount, received_date').eq('organization_id', org).eq('industry_type_id', it).eq('status', 'Posted')),
    all(() => supabaseAdmin.from('school_supplier_payments').select('supplier_id, amount, grn_id').eq('organization_id', org).eq('industry_type_id', it)),
    all(() => supabaseAdmin.from('school_purchase_returns').select('supplier_id, grn_id, total_amount').eq('organization_id', org).eq('industry_type_id', it).eq('status', 'Posted')),
  ]);
  const t = today();
  return suppliers.map((s) => {
    const bills = grns.filter((g) => g.supplier_id === s.id).sort((a, b) => String(a.received_date).localeCompare(String(b.received_date)) || String(a.grn_number).localeCompare(String(b.grn_number)));
    const settled = new Map<string, number>();
    for (const r of rets.filter((x) => x.supplier_id === s.id && x.grn_id)) { const bill = bills.find((b) => b.id === r.grn_id); if (bill) settled.set(String(bill.id), Math.min(num(bill.total_amount), (settled.get(String(bill.id)) ?? 0) + num(r.total_amount))); } // goods sent back reduce that bill
    let pool = 0; let paid = 0;
    for (const p of pays.filter((x) => x.supplier_id === s.id)) {
      const amt = num(p.amount); paid += amt;
      const bill = p.grn_id ? bills.find((b) => b.id === p.grn_id) : undefined;
      const used = bill ? Math.min(amt, num(bill.total_amount) - (settled.get(String(bill.id)) ?? 0)) : 0;
      if (bill && used > 0) settled.set(String(bill.id), (settled.get(String(bill.id)) ?? 0) + used);
      pool += amt - used;
    }
    for (const b of bills) { const take = Math.min(pool, num(b.total_amount) - (settled.get(String(b.id)) ?? 0)); if (take > 0) { settled.set(String(b.id), (settled.get(String(b.id)) ?? 0) + take); pool -= take; } }
    const terms = num(s.payment_terms_days);
    const open = bills.map((b) => {
      const outstanding = r2(num(b.total_amount) - (settled.get(String(b.id)) ?? 0));
      const due = addDays(String(b.received_date).slice(0, 10), terms);
      return { grn_id: b.id, grn_number: b.grn_number, received_date: b.received_date, supplier_invoice_no: b.supplier_invoice_no, amount: num(b.total_amount), outstanding, due_date: due, overdue_days: diffDays(t, due) };
    }).filter((b) => b.outstanding > 0.009);
    const purchased = r2(bills.reduce((x, b) => x + num(b.total_amount), 0));
    return {
      supplier_id: s.id, supplier_code: s.supplier_code, supplier_name: s.supplier_name, credit_days: terms, purchased, returned: r2(rets.filter((x) => x.supplier_id === s.id).reduce((x, r) => x + num(r.total_amount), 0)), paid: r2(paid),
      payable: r2(open.reduce((x, b) => x + b.outstanding, 0)), advance_paid: r2(Math.max(0, pool)),
      overdue_amount: r2(open.filter((b) => b.overdue_days > 0).reduce((x, b) => x + b.outstanding, 0)),
      due_soon_amount: r2(open.filter((b) => b.overdue_days <= 0 && b.overdue_days >= -7).reduce((x, b) => x + b.outstanding, 0)),
      bills: open,
    };
  }).filter((r) => r.purchased > 0 || r.paid > 0).sort((a, b) => b.overdue_amount - a.overdue_amount || b.payable - a.payable);
}
// ------------------------------------------------------------------ purchase returns (goods sent back to the supplier)
/** Sends goods back against one posted goods receipt: stock goes down now, and what we owe that supplier goes down by the same GST-inclusive value. */
export async function createPurchaseReturn(org: string, it: string, input: Row, actor: string | null): Promise<Row> {
  const { data: g } = await supabaseAdmin.from('school_grns').select('*').eq('organization_id', org).eq('industry_type_id', it).eq('id', String(input.grn_id ?? '')).maybeSingle();
  const grn = g as Row | null;
  if (!grn) throw bad('Select the goods receipt these goods came in on.', 'INVALID_REFERENCE');
  if (grn.status !== 'Posted') throw bad('That goods receipt is cancelled, so nothing can be returned against it.');
  const reason = str(input.reason);
  if (!reason) throw bad('Enter the reason for the return (damaged, wrong item, excess ...).');
  const raw = Array.isArray(input.lines) ? (input.lines as Row[]).filter((l) => num(l.quantity) > 0) : [];
  if (!raw.length) throw bad('Enter the return quantity for at least one product.');
  const { data: prior } = await supabaseAdmin.from('school_purchase_returns').select('lines').eq('organization_id', org).eq('grn_id', grn.id).eq('status', 'Posted');
  const returned = new Map<string, number>();
  for (const r of (prior ?? []) as Row[]) for (const l of (r.lines ?? []) as Row[]) returned.set(String(l.product_id), (returned.get(String(l.product_id)) ?? 0) + num(l.quantity));
  const grnLines = new Map(((grn.lines ?? []) as Row[]).map((l) => [String(l.product_id), l]));
  const seen = new Set<string>();
  const lines = raw.map((l) => {
    const pid = String(l.product_id ?? '');
    const gl = grnLines.get(pid);
    if (!gl) throw bad('A product to return is not on that goods receipt.', 'INVALID_REFERENCE');
    if (seen.has(pid)) throw bad(`${gl.product_name} is listed twice.`);
    seen.add(pid);
    const qty = num(l.quantity); const left = r2(num(gl.quantity) - (returned.get(pid) ?? 0));
    if (qty > left + 1e-9) throw bad(`${gl.product_name}: only ${left} unit(s) can still be returned on ${grn.grn_number}.`);
    const rate = num(gl.rate); const gst = num(gl.gst_percent);
    return { product_id: pid, product_name: gl.product_name, product_code: gl.product_code, quantity: qty, rate, gst_percent: gst, amount: lineAmount({ quantity: qty, rate, gst_percent: gst }) };
  });
  const date = str(input.return_date) || today();
  const ret = await insertNumbered('school_purchase_returns', 'return_number', org, `PRT-${financialYear(date)}-`, {
    industry_type_id: it, supplier_id: grn.supplier_id, grn_id: grn.id, return_date: date, lines, total_amount: totalsOf(lines).total_amount,
    reason, notes: str(input.notes) || null, status: 'Posted', created_by: actor,
  });
  const taken: Row[] = [];
  try { for (const l of lines) { await changeProductStock(org, String(l.product_id), -num(l.quantity), false); taken.push(l); } } // fails when the goods were already sold
  catch (e) {
    for (const l of taken) await changeProductStock(org, String(l.product_id), num(l.quantity), true).catch(() => undefined);
    await supabaseAdmin.from('school_purchase_returns').delete().eq('organization_id', org).eq('id', ret.id);
    throw e instanceof AppError && e.code === 'INSUFFICIENT_STOCK' ? bad('Part of this stock has already been sold, so that quantity cannot go back to the supplier.', 'STOCK_ALREADY_SOLD') : e;
  }
  return ret;
}

export async function cancelPurchaseReturn(org: string, it: string, id: string): Promise<Row> {
  const { data } = await supabaseAdmin.from('school_purchase_returns').select('*').eq('organization_id', org).eq('industry_type_id', it).eq('id', id).maybeSingle();
  const ret = data as Row | null;
  if (!ret) throw notFound('Purchase return');
  if (ret.status === 'Cancelled') throw bad('This purchase return is already cancelled.');
  const { data: claimed } = await supabaseAdmin.from('school_purchase_returns').update({ status: 'Cancelled' }).eq('organization_id', org).eq('id', id).eq('status', 'Posted').select('id');
  if (!claimed?.length) throw new AppError(409, 'RETURN_CHANGED', 'This purchase return was just changed by someone else. Refresh and try again.');
  const back: Row[] = [];
  try { for (const l of (ret.lines ?? []) as Row[]) { await changeProductStock(org, String(l.product_id), num(l.quantity), true); back.push(l); } }
  catch (e) {
    for (const l of back) await changeProductStock(org, String(l.product_id), -num(l.quantity), true).catch(() => undefined);
    await supabaseAdmin.from('school_purchase_returns').update({ status: 'Posted' }).eq('organization_id', org).eq('id', id);
    throw e;
  }
  return { ...ret, status: 'Cancelled' };
}
// ------------------------------------------------------------------ automatic draft purchase orders
/**
 * One click: works out what to buy (live School orders not yet dispatched + minimum stock - shelf - goods already on order, Draft orders included
 * so a second click never doubles up), picks each product's supplier and rate from the last goods receipt or purchase order it appeared on, and
 * saves one Draft purchase order per supplier. Products that were never bought before come back as `unassigned` for a person to place.
 */
export async function createDraftPosFromSuggestions(org: string, it: string, actor: string | null): Promise<{ created: Row[]; unassigned: Row[]; failed: Row[] }> {
  const SKIP = '("cancelled","rejected","draft","pending_approval")';
  const [products, orders, openPos, grns, allPos, suppliers] = await Promise.all([
    industryProducts(org, it),
    all(() => supabaseAdmin.from('sale_orders').select('id, status, dispatch_status, clients!inner(industry_type_id), sale_order_items(product_id, quantity, free_quantity)').eq('organization_id', org).eq('clients.industry_type_id', it).not('status', 'in', SKIP)),
    all(() => supabaseAdmin.from('school_purchase_orders').select('lines').eq('organization_id', org).eq('industry_type_id', it).in('status', ['Draft', 'Sent', 'Partially received'])),
    all(() => supabaseAdmin.from('school_grns').select('supplier_id, received_date, lines').eq('organization_id', org).eq('industry_type_id', it).eq('status', 'Posted')),
    all(() => supabaseAdmin.from('school_purchase_orders').select('supplier_id, order_date, lines').eq('organization_id', org).eq('industry_type_id', it).neq('status', 'Cancelled')),
    all(() => supabaseAdmin.from('school_suppliers').select('id, supplier_name, status').eq('organization_id', org).eq('industry_type_id', it)),
  ]);
  const demand = new Map<string, number>();
  for (const ord of orders) {
    if (['dispatched', 'delivered'].includes(String(ord.dispatch_status ?? 'pending'))) continue;
    for (const item of (ord.sale_order_items ?? []) as Row[]) demand.set(String(item.product_id), (demand.get(String(item.product_id)) ?? 0) + num(item.quantity) + num(item.free_quantity));
  }
  const incoming = new Map<string, number>();
  for (const po of openPos) for (const l of (po.lines ?? []) as Row[]) incoming.set(String(l.product_id), (incoming.get(String(l.product_id)) ?? 0) + Math.max(0, num(l.quantity) - num(l.received_quantity)));
  // Last supplier + rate per product: the most recent goods receipt or purchase order line wins.
  const last = new Map<string, { date: string; supplier_id: string; rate: number; gst: number }>();
  const note = (date: unknown, supplierId: unknown, lines: unknown) => {
    for (const l of (lines ?? []) as Row[]) {
      const pid = String(l.product_id); const d = String(date ?? '').slice(0, 10);
      const cur = last.get(pid);
      if (!cur || d > cur.date) last.set(pid, { date: d, supplier_id: String(supplierId), rate: num(l.rate), gst: num(l.gst_percent) });
    }
  };
  for (const g of grns) note(g.received_date, g.supplier_id, g.lines);
  for (const p of allPos) note(p.order_date, p.supplier_id, p.lines);
  const active = new Map(suppliers.filter((s) => s.status === 'Active').map((s) => [String(s.id), String(s.supplier_name)]));

  const bySupplier = new Map<string, Row[]>(); const unassigned: Row[] = [];
  for (const p of products) {
    const stock = p.stock_quantity === null || p.stock_quantity === undefined ? null : num(p.stock_quantity);
    const min = p.min_stock_level === null || p.min_stock_level === undefined ? null : num(p.min_stock_level);
    const need = demand.get(String(p.id)) ?? 0;
    const suggested = Math.ceil(Math.max(need + (min ?? 0) - (stock ?? 0) - (incoming.get(String(p.id)) ?? 0), 0));
    if (suggested <= 0 || (stock === null && need === 0)) continue;
    const h = last.get(String(p.id));
    if (!h || !active.has(h.supplier_id)) { unassigned.push({ product_id: p.id, product_code: p.product_code, product_name: p.product_name, suggested }); continue; }
    bySupplier.set(h.supplier_id, [...(bySupplier.get(h.supplier_id) ?? []), { product_id: p.id, quantity: suggested, rate: h.rate, gst_percent: h.gst }]);
  }
  const created: Row[] = []; const failed: Row[] = [];
  for (const [supplierId, lines] of bySupplier) {
    try {
      const po = await createPurchaseOrder(org, it, { supplier_id: supplierId, lines, notes: 'Auto-drafted from pending orders and low stock. Check quantities and rates, then mark Sent.' }, actor);
      created.push({ po_number: po.po_number, supplier_name: active.get(supplierId), lines: lines.length, total_amount: po.total_amount });
    } catch (e) { failed.push({ supplier_name: active.get(supplierId), reason: e instanceof Error ? e.message : 'Unable to create the order.' }); }
  }
  return { created, unassigned, failed };
}