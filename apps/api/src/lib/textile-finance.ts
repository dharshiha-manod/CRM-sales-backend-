/* eslint-disable @typescript-eslint/no-explicit-any */
// FILE: api/src/lib/textile-finance.ts
// Textile money side: (1) supplier bills + ageing (a Posted GRN is the bill), (2) GST credit notes for customer returns.
import { supabaseAdmin } from './supabase.js';
import { financialYear } from './ist-date.js';
import { logger } from './logger.js';
import { addDays, all, diffDays, insertNumbered, num, r2, str, today, type Row } from './pharma-db.js';

// ------------------------------------------------------------------ supplier bills
/** Every Posted GRN with what is paid, what is left, the due date (received date + supplier's payment terms) and days overdue.
 *  A payment with no bill picked is applied to that supplier's oldest open bills first. */
export async function supplierBills(orgId: string, it: string): Promise<{ bills: Row[]; advance: Map<string, number> }> {
  const [grns, sups, pays, dns, refs] = await Promise.all([
    all(() => supabaseAdmin.from('textile_grns').select('id, grn_number, received_date, supplier_id, total_amount, supplier_invoice_no, status').eq('organization_id', orgId).eq('industry_type_id', it).order('received_date', { ascending: true }).order('grn_number', { ascending: true })),
    all(() => supabaseAdmin.from('textile_suppliers').select('id, supplier_code, supplier_name, payment_terms_days').eq('organization_id', orgId).eq('industry_type_id', it)),
    all(() => supabaseAdmin.from('textile_supplier_payments').select('supplier_id, grn_id, amount').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled')),
    // Debit notes (goods returned to the mill) lower the bill; refunds received back use up the supplier credit. Tables missing (migration not run) = none.
    all(() => supabaseAdmin.from('textile_debit_notes').select('grn_id, supplier_id, total_amount').eq('organization_id', orgId).eq('industry_type_id', it).eq('status', 'Issued')).catch(() => [] as Row[]),
    all(() => supabaseAdmin.from('textile_supplier_refunds').select('supplier_id, amount').eq('organization_id', orgId).eq('industry_type_id', it).eq('status', 'Received')).catch(() => [] as Row[]),
  ]);
  const supById = new Map(sups.map((s) => [s.id as string, s]));
  const posted = grns.filter((g) => g.status === 'Posted');
  const postedIds = new Set(posted.map((g) => g.id as string));
  const direct = new Map<string, number>(); const pool = new Map<string, number>(); const dnByGrn = new Map<string, number>();
  for (const d of dns) {
    if (d.grn_id && postedIds.has(d.grn_id as string)) dnByGrn.set(d.grn_id, r2((dnByGrn.get(d.grn_id) ?? 0) + num(d.total_amount)));
    else pool.set(d.supplier_id, r2((pool.get(d.supplier_id) ?? 0) + num(d.total_amount))); // debit note whose bill is gone: plain credit with the supplier
  }
  for (const p of pays) {
    if (p.grn_id && postedIds.has(p.grn_id as string)) direct.set(p.grn_id, r2((direct.get(p.grn_id) ?? 0) + num(p.amount)));
    else pool.set(p.supplier_id, r2((pool.get(p.supplier_id) ?? 0) + num(p.amount))); // no bill picked (or its GRN was cancelled)
  }
  // Paid more than the bill is now worth (goods went back after payment): the extra becomes credit with that supplier.
  const netOf = new Map<string, number>();
  for (const g of posted) {
    const net = Math.max(0, r2(num(g.total_amount) - (dnByGrn.get(g.id as string) ?? 0)));
    netOf.set(g.id as string, net);
    const paidDirect = direct.get(g.id as string) ?? 0;
    if (paidDirect > net + 0.004) { pool.set(g.supplier_id, r2((pool.get(g.supplier_id) ?? 0) + paidDirect - net)); direct.set(g.id as string, net); }
  }
  for (const r of refs) pool.set(r.supplier_id, Math.max(0, r2((pool.get(r.supplier_id) ?? 0) - num(r.amount)))); // money already received back
  const day = today();
  const bills: Row[] = [];
  for (const g of posted) {
    const s = supById.get(g.supplier_id as string);
    const total = netOf.get(g.id as string) ?? 0; const paidDirect = direct.get(g.id as string) ?? 0;
    let paid = Math.min(total, paidDirect); let balance = r2(total - paid);
    const left = pool.get(g.supplier_id as string) ?? 0;
    if (balance > 0 && left > 0) { const use = Math.min(balance, left); paid = r2(paid + use); balance = r2(balance - use); pool.set(g.supplier_id as string, r2(left - use)); }
    const due = addDays(String(g.received_date), num(s?.payment_terms_days));
    const overdue = balance > 0.004 ? Math.max(0, diffDays(day, due)) : 0;
    bills.push({
      id: g.id, grn_number: g.grn_number, supplier_id: g.supplier_id, supplier_name: s?.supplier_name ?? null, supplier_code: s?.supplier_code ?? null,
      supplier_invoice_no: g.supplier_invoice_no ?? null, received_date: g.received_date, due_date: due, total, original_total: r2(num(g.total_amount)), debit_noted: dnByGrn.get(g.id as string) ?? 0,
      paid, balance, days_overdue: overdue, status: balance <= 0.004 ? 'Paid' : overdue > 0 ? 'Overdue' : paid > 0 ? 'Partly paid' : 'Open',
    });
  }
  return { bills, advance: new Map([...pool].filter(([, v]) => v > 0.004)) };
}

export async function supplierOutstanding(orgId: string, it: string): Promise<Row[]> {
  const [{ bills, advance }, sups] = await Promise.all([
    supplierBills(orgId, it),
    all(() => supabaseAdmin.from('textile_suppliers').select('id, supplier_code, supplier_name, payment_terms_days').eq('organization_id', orgId).eq('industry_type_id', it).order('supplier_name')),
  ]);
  return sups.map((s) => {
    const mine = bills.filter((b) => b.supplier_id === s.id);
    const open = mine.filter((b) => b.balance > 0.004);
    const sumOf = (rows: Row[]) => r2(rows.reduce((t, b) => t + num(b.balance), 0));
    return {
      supplier_id: s.id, supplier_code: s.supplier_code, supplier_name: s.supplier_name, payment_terms_days: s.payment_terms_days,
      billed: r2(mine.reduce((t, b) => t + num(b.total), 0)), paid: r2(mine.reduce((t, b) => t + num(b.paid), 0)), outstanding: sumOf(open),
      not_due: sumOf(open.filter((b) => b.days_overdue === 0)), overdue_1_30: sumOf(open.filter((b) => b.days_overdue >= 1 && b.days_overdue <= 30)),
      overdue_31_60: sumOf(open.filter((b) => b.days_overdue >= 31 && b.days_overdue <= 60)), overdue_60_plus: sumOf(open.filter((b) => b.days_overdue > 60)),
      advance: r2(advance.get(s.id) ?? 0),
    };
  });
}

// ------------------------------------------------------------------ GST credit notes for customer returns
export type CreditNoteResult = { ok: boolean; reason?: string };

/** One GST credit note for one approved return. Makes the customer credit GST-inclusive, like the invoice. Never throws. */
export async function issueCreditNoteForReturn(orgId: string, it: string, ret: Row, actor: string | null): Promise<CreditNoteResult> {
  try {
    const { data: dup } = await supabaseAdmin.from('textile_credit_notes').select('id').eq('organization_id', orgId).eq('sales_return_id', ret.id).maybeSingle();
    if (dup) return { ok: true };
    const { data: inv } = await supabaseAdmin.from('textile_invoices').select('id, invoice_number, client_id, supply_type, lines')
      .eq('organization_id', orgId).eq('industry_type_id', it).eq('order_id', ret.order_id).neq('status', 'Cancelled').order('created_at', { ascending: false }).limit(1).maybeSingle();
    const invoice = inv as Row | null;
    if (!invoice) return { ok: false, reason: 'No GST invoice exists for this order yet. The credit note is issued once the order is invoiced.' };
    const [{ data: prod }, { data: ord }] = await Promise.all([
      supabaseAdmin.from('products').select('product_name, product_code, hsn_code').eq('organization_id', orgId).eq('id', ret.product_id).maybeSingle(),
      supabaseAdmin.from('sale_orders').select('tax_amount').eq('organization_id', orgId).eq('id', ret.order_id).maybeSingle(),
    ]);
    const p = prod as Row | null;
    const line = ((invoice.lines ?? []) as Row[]).find((l) => str(l.product_code) === str(p?.product_code));
    if (!line) return { ok: false, reason: `Product ${str(p?.product_code)} is not on invoice ${str(invoice.invoice_number)}.` };
    const gst = num(line.gst_percent); const credit = r2(num(ret.credit_amount));
    const inclusive = num((ord as Row | null)?.tax_amount) > 0; // order came from a taxed quotation: the credit already holds the tax
    const taxable = inclusive ? r2(credit / (1 + gst / 100)) : credit;
    const tax = inclusive ? r2(credit - taxable) : r2((taxable * gst) / 100);
    const total = inclusive ? credit : r2(taxable + tax);
    const intra = String(invoice.supply_type ?? '').startsWith('Intra');
    const cgst = intra ? r2(tax / 2) : 0; const sgst = intra ? r2(tax - cgst) : 0; const igst = intra ? 0 : tax;
    await insertNumbered('textile_credit_notes', 'note_number', orgId, `TCN-${financialYear(today())}-`, {
      industry_type_id: it, note_date: today(), invoice_id: invoice.id, invoice_number: invoice.invoice_number, order_id: ret.order_id, client_id: invoice.client_id,
      sales_return_id: ret.id, reason: str(ret.reason) || 'Textile return', supply_type: invoice.supply_type,
      lines: [{ product_name: p?.product_name ?? null, product_code: p?.product_code ?? null, hsn_code: line.hsn_code ?? p?.hsn_code ?? null, quantity: num(ret.quantity), taxable_value: taxable, gst_percent: gst, cgst, sgst, igst }],
      taxable_amount: taxable, cgst_amount: cgst, sgst_amount: sgst, igst_amount: igst, total_amount: total, status: 'Issued', created_by: actor,
    });
    if (!inclusive) {
      const rate = num(ret.exchange_rate) > 0 ? num(ret.exchange_rate) : 1;
      await supabaseAdmin.from('sales_returns').update({ credit_amount: total, base_credit: r2(total * rate) }).eq('organization_id', orgId).eq('id', ret.id);
    }
    return { ok: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Unknown error';
    logger.warn({ err: e, salesReturnId: ret.id }, 'textile: credit note failed');
    return { ok: false, reason };
  }
}

const RET_COLS = 'id, order_id, product_id, quantity, credit_amount, exchange_rate, reason';

/** Called right after a roll return: raises the credit note for every approved, credited return on that order that has none. */
export async function issueCreditNotesForOrder(orgId: string, orderId: string, actor: string | null): Promise<CreditNoteResult[]> {
  try {
    const { data: o } = await supabaseAdmin.from('sale_orders').select('clients(industry_type_id)').eq('organization_id', orgId).eq('id', orderId).maybeSingle();
    const c = (o as Row | null)?.clients; const it = (Array.isArray(c) ? c[0] : c)?.industry_type_id as string | undefined;
    if (!it) return [];
    const { data: rets } = await supabaseAdmin.from('sales_returns').select(RET_COLS).eq('organization_id', orgId).eq('order_id', orderId).eq('status', 'approved').gt('credit_amount', 0);
    const out: CreditNoteResult[] = [];
    for (const r of (rets ?? []) as Row[]) out.push(await issueCreditNoteForReturn(orgId, it, r, actor));
    return out;
  } catch (e) { logger.warn({ err: e, orderId }, 'textile: credit notes for order failed'); return []; }
}

/** Approved, credited returns on invoiced Textile orders that still have no credit note. */
export async function pendingCreditReturns(orgId: string, it: string): Promise<Row[]> {
  const invs = await all(() => supabaseAdmin.from('textile_invoices').select('order_id').eq('organization_id', orgId).eq('industry_type_id', it).neq('status', 'Cancelled'));
  const orderIds = [...new Set(invs.map((i) => i.order_id as string))];
  const rets: Row[] = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('sales_returns').select(RET_COLS).eq('organization_id', orgId).eq('status', 'approved').gt('credit_amount', 0).in('order_id', orderIds.slice(i, i + 100));
    if (error) throw error;
    rets.push(...((data ?? []) as Row[]));
  }
  if (!rets.length) return [];
  const have = new Set<string>();
  for (let i = 0; i < rets.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('textile_credit_notes').select('sales_return_id').eq('organization_id', orgId).in('sales_return_id', rets.slice(i, i + 100).map((r) => String(r.id)));
    if (error) throw error;
    for (const n of (data ?? []) as Row[]) have.add(String(n.sales_return_id));
  }
  return rets.filter((r) => !have.has(String(r.id)));
}

export async function issueMissingCreditNotes(orgId: string, it: string, actor: string | null): Promise<{ issued: number; failed: string[] }> {
  let issued = 0; const failed: string[] = [];
  for (const r of await pendingCreditReturns(orgId, it)) {
    const res = await issueCreditNoteForReturn(orgId, it, r, actor);
    if (res.ok) issued += 1; else failed.push(res.reason ?? 'Unknown error');
  }
  return { issued, failed: [...new Set(failed)] };
}