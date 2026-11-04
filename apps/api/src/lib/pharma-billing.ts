// Pharma: what a customer was actually invoiced (GST included) per sales order. Used by Collections and Customer Outstanding.
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';

export async function pharmaInvoicedByOrder(org: string, orderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    for (let i = 0; i < orderIds.length; i += 100) {
      const { data, error } = await supabaseAdmin.from('pharma_invoices').select('order_id, total_amount').eq('organization_id', org).neq('status', 'Cancelled').in('order_id', orderIds.slice(i, i + 100));
      if (error) return out; // table missing / not pharma: behave exactly as before
      for (const r of (data ?? []) as { order_id: string; total_amount: unknown }[]) out.set(r.order_id, (out.get(r.order_id) ?? 0) + (Number(r.total_amount) || 0));
    }
  } catch { /* best effort */ }
  return out;
}

/** Pharma: an order that already has a live GST invoice cannot be cancelled / re-priced. Cancel the invoice first (or issue a credit note). Orders of other industries have no pharma invoice, so nothing happens. */
export async function assertNoLivePharmaInvoice(org: string, orderId: string, action: 'edited' | 'cancelled'): Promise<void> {
  let live: { invoice_number?: string }[] | null = null;
  try {
    const { data, error } = await supabaseAdmin.from('pharma_invoices').select('invoice_number').eq('organization_id', org).eq('order_id', orderId).neq('status', 'Cancelled').limit(1);
    if (error) return; // table missing / not pharma: behave exactly as before
    live = data as { invoice_number?: string }[] | null;
  } catch { return; }
  if (live && live.length) throw new AppError(422, 'ORDER_HAS_INVOICE', `This order already has GST invoice ${live[0].invoice_number}, so it cannot be ${action}. Cancel the invoice first in GST Sales Invoices.`);
}