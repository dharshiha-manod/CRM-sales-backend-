// Textile: what a customer was actually invoiced (GST included) per sales order, and the "invoiced orders are locked" rule.
// Same idea as pharma-billing.ts. Orders of other industries have no textile invoice, so nothing changes for them.
import { AppError } from '../errors/app-error.js';
import { logger } from './logger.js';
import { supabaseAdmin } from './supabase.js';

export async function textileInvoicedByOrder(org: string, orderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    for (let i = 0; i < orderIds.length; i += 100) {
      const { data, error } = await supabaseAdmin.from('textile_invoices').select('order_id, total_amount').eq('organization_id', org).neq('status', 'Cancelled').in('order_id', orderIds.slice(i, i + 100));
      if (error) return out; // table missing (migration not run yet): behave exactly as before
      for (const r of (data ?? []) as { order_id: string; total_amount: unknown }[]) out.set(r.order_id, (out.get(r.order_id) ?? 0) + (Number(r.total_amount) || 0));
    }
  } catch (e) { logger.warn({ err: e }, 'textile: invoiced-by-order lookup failed'); }
  return out;
}

export async function assertNoLiveTextileInvoice(org: string, orderId: string, action: 'edited' | 'cancelled'): Promise<void> {
  let live: { invoice_number?: string }[] | null = null;
  try {
    const { data, error } = await supabaseAdmin.from('textile_invoices').select('invoice_number').eq('organization_id', org).eq('order_id', orderId).neq('status', 'Cancelled').limit(1);
    if (error) return; // table missing / not textile
    live = data as { invoice_number?: string }[] | null;
  } catch { return; }
  if (live && live.length) throw new AppError(422, 'ORDER_HAS_INVOICE', `This order already has GST invoice ${live[0].invoice_number}, so it cannot be ${action}. Cancel the invoice first in GST Sales Invoices.`);
}
