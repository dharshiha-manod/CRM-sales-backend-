/* eslint-disable @typescript-eslint/no-explicit-any */
// GST credit note for an approved customer return. Also makes the credit GST-inclusive, so Customer Outstanding,
// Collections and reminders all agree with the invoice. Never blocks the return.
import { supabaseAdmin } from './supabase.js';
import { financialYear } from './ist-date.js';
import { insertNumbered, num, r2, str, today, type Row } from './pharma-db.js';

export type CreditNoteResult = { ok: boolean; reason?: string };
export async function issueCreditNoteForReturn(orgId: string, it: string, salesReturnId: string, returnCode: string, actor: string | null): Promise<CreditNoteResult> {
  try {
    const { data: dup } = await supabaseAdmin.from('pharma_credit_notes').select('id').eq('organization_id', orgId).eq('sales_return_id', salesReturnId).maybeSingle();
    if (dup) return { ok: true };
    const { data: sr } = await supabaseAdmin.from('sales_returns').select('id, order_id, product_id, quantity, credit_amount, exchange_rate, reason').eq('organization_id', orgId).eq('id', salesReturnId).maybeSingle();
    const ret = sr as Row | null; if (!ret) return { ok: false, reason: 'Sales return not found.' };
    const { data: inv } = await supabaseAdmin.from('pharma_invoices').select('id, invoice_number, client_id, supply_type, lines').eq('organization_id', orgId).eq('order_id', ret.order_id).neq('status', 'Cancelled').order('created_at', { ascending: false }).limit(1).maybeSingle();
    const invoice = inv as Row | null; if (!invoice) return { ok: false, reason: 'No GST invoice exists for this order yet. The credit note is issued once the order is invoiced.' };
    const [{ data: prod }, { data: ord }] = await Promise.all([
      supabaseAdmin.from('products').select('product_name, product_code, hsn_code').eq('organization_id', orgId).eq('id', ret.product_id).maybeSingle(),
      supabaseAdmin.from('sale_orders').select('tax_amount').eq('organization_id', orgId).eq('id', ret.order_id).maybeSingle(),
    ]);
    const p = prod as Row | null;
    const line = ((invoice.lines ?? []) as Row[]).find((l) => str(l.product_code) === str(p?.product_code));
    if (!line) return { ok: false, reason: `Product ${str(p?.product_code)} is not on invoice ${str(invoice.invoice_number)}.` };
    const gst = num(line.gst_percent);
    const credit = r2(num(ret.credit_amount));
    const alreadyInclusive = num((ord as Row | null)?.tax_amount) > 0; // order came from a taxed quotation: credit already has tax
    const taxable = alreadyInclusive ? r2(credit / (1 + gst / 100)) : credit;
    const tax = alreadyInclusive ? r2(credit - taxable) : r2((taxable * gst) / 100);
    const total = alreadyInclusive ? credit : r2(taxable + tax);
    const intra = String(invoice.supply_type ?? '').startsWith('Intra');
    const cgst = intra ? r2(tax / 2) : 0; const sgst = intra ? r2(tax - cgst) : 0; const igst = intra ? 0 : tax;
    await insertNumbered('pharma_credit_notes', 'note_number', orgId, `CN-${financialYear(today())}-`, {
      industry_type_id: it, note_date: today(), invoice_id: invoice.id, invoice_number: invoice.invoice_number, order_id: ret.order_id, client_id: invoice.client_id,
      sales_return_id: salesReturnId, reason: str(ret.reason) || `Pharma return ${returnCode}`, supply_type: invoice.supply_type,
      lines: [{ product_name: p?.product_name ?? null, product_code: p?.product_code ?? null, hsn_code: p?.hsn_code ?? null, quantity: num(ret.quantity), taxable_value: taxable, gst_percent: gst, cgst, sgst, igst }],
      taxable_amount: taxable, cgst_amount: cgst, sgst_amount: sgst, igst_amount: igst, total_amount: total, status: 'Issued', created_by: actor,
    });
    if (!alreadyInclusive) {
      const rate = num(ret.exchange_rate) > 0 ? num(ret.exchange_rate) : 1;
      await supabaseAdmin.from('sales_returns').update({ credit_amount: total, base_credit: r2(total * rate) }).eq('organization_id', orgId).eq('id', salesReturnId);
    }
    return { ok: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Unknown error';
    console.error(`[pharma] credit note for return ${returnCode} failed: ${reason}`); // return stays approved; use reissueCreditNotes() to retry
    return { ok: false, reason };
  }
}

/** Approved pharma returns that already gave the customer credit but have no GST credit note yet. */
export async function pendingCreditNotes(orgId: string, it: string): Promise<{ return_code: string; sales_return_id: string }[]> {
  const { data, error } = await supabaseAdmin.from('pharma_medicine_returns').select('return_code, sales_return_id').eq('organization_id', orgId).eq('industry_type_id', it).not('sales_return_id', 'is', null);
  if (error) throw error;
  const rets = (data ?? []) as Row[]; const have = new Set<string>();
  for (let i = 0; i < rets.length; i += 100) {
    const { data: cns, error: e2 } = await supabaseAdmin.from('pharma_credit_notes').select('sales_return_id').eq('organization_id', orgId).in('sales_return_id', rets.slice(i, i + 100).map((r) => String(r.sales_return_id)));
    if (e2) throw e2;
    for (const c of (cns ?? []) as Row[]) have.add(String(c.sales_return_id));
  }
  return rets.filter((r) => !have.has(String(r.sales_return_id))).map((r) => ({ return_code: String(r.return_code), sales_return_id: String(r.sales_return_id) }));
}

/** Retries every missing credit note. Safe to run any time (a return that already has one is skipped). */
export async function reissueCreditNotes(orgId: string, it: string, actor: string | null): Promise<{ return_code: string; ok: boolean; reason?: string }[]> {
  const out: { return_code: string; ok: boolean; reason?: string }[] = [];
  for (const m of await pendingCreditNotes(orgId, it)) out.push({ return_code: m.return_code, ...(await issueCreditNoteForReturn(orgId, it, m.sales_return_id, m.return_code, actor)) });
  return out;
}