// Pharma sale rules checked on orders: stock must be tracked, scheduled drugs need a licensed buyer, and the selling price can never exceed MRP.
// Every function returns immediately for non-Pharma customers / batches, so other industries are never affected.
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';
import { industryCodeOf } from './fmcg-market.js';
import { num, r2, str, type Row } from './pharma-db.js';
import type { Allocation } from './stock.js';

const SCHEDULES = ['H', 'H1', 'X', 'Narcotic (NDPS)'];

/** Order create: untracked products and scheduled drugs. */
export async function assertPharmaOrderRules(org: string, clientId: string | null | undefined, lines: { product_id: string | null }[], opts: { skipCreditHold?: boolean } = {}): Promise<void> {
  if (!clientId) return;
  const { data: c, error } = await supabaseAdmin.from('clients').select('client_name, industry_type_id, industry_details').eq('organization_id', org).eq('id', clientId).maybeSingle();
  if (error) throw error;
  const cl = c as Row | null;
  if (!cl || (await industryCodeOf(org, cl.industry_type_id)) !== 'pharma') return;
  if (!opts.skipCreditHold) { // customers with an invoice overdue beyond the limit set in Automation settings cannot place new orders (an edit of an existing order is not a new order)
    const { getSettings, invoiceDues } = await import('../services/pharma-automation.service.js');
    const st = await getSettings(org, String(cl.industry_type_id));
    if (st.credit_hold_days > 0) {
      const late = (await invoiceDues(org, String(cl.industry_type_id))).filter((d) => d.client_id === clientId && d.open > 0.005 && d.days_overdue >= st.credit_hold_days);
      if (late.length) throw new AppError(422, 'CUSTOMER_ON_HOLD', `${cl.client_name}: ${late.length} invoice(s) are ${st.credit_hold_days}+ days overdue (${late.map((d) => d.invoice_number).join(', ')}, ₹${late.reduce((s, d) => s + d.open, 0).toLocaleString('en-IN')}). New orders are on hold until the payment is received.`);
    }
  }
  const ids = [...new Set(lines.map((l) => l.product_id).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const { data: prods, error: pe } = await supabaseAdmin.from('products').select('id, product_name, product_code, stock_quantity').eq('organization_id', org).in('id', ids);
  if (pe) throw pe;
  const list = (prods ?? []) as Row[];
  const untracked = list.filter((p) => p.stock_quantity === null || p.stock_quantity === undefined);
  if (untracked.length) throw new AppError(422, 'PRODUCT_NOT_TRACKED', `${untracked.map((p) => p.product_name).join(', ')} ${untracked.length > 1 ? 'are' : 'is'} not stock-tracked, so stock, batch and expiry cannot be controlled. Set the stock quantity in Products (0 is fine) and receive stock through GRN.`);
  const codes = list.map((p) => str(p.product_code)).filter(Boolean);
  if (!codes.length) return;
  if (String(process.env.PHARMA_REQUIRE_BATCH ?? '').toLowerCase() !== 'off') {
    // Every strip sold must carry a batch + expiry (invoice, schedule register, recall tracing). Stock that sits on the product without any
    // batch would be sold with none, so it is refused until it is received through GRN / Batch & Expiry.
    const { data: haveBatch, error: be } = await supabaseAdmin.from('pharma_batches').select('product_code').eq('organization_id', org).in('product_code', codes);
    if (be) { if ((be as { code?: string }).code !== '42P01') throw be; }
    else {
      const withBatch = new Set(((haveBatch ?? []) as Row[]).map((b) => str(b.product_code)));
      const loose = list.filter((p) => str(p.product_code) && !withBatch.has(str(p.product_code)) && num(p.stock_quantity) > 0);
      if (loose.length) throw new AppError(422, 'PRODUCT_NO_BATCH', `${loose.map((p) => p.product_name).join(', ')} ${loose.length > 1 ? 'have' : 'has'} stock but no batch / expiry on record, so ${loose.length > 1 ? 'they' : 'it'} cannot be sold. Receive the stock through GRN (or add the batch in Batch & Expiry) first.`);
    }
  }
  const { data: sch, error: se } = await supabaseAdmin.from('pharma_drug_schedules').select('product_code, schedule').eq('organization_id', org).eq('industry_type_id', cl.industry_type_id).neq('status', 'Inactive').in('product_code', codes);
  if (se) { if ((se as { code?: string }).code === '42P01') return; throw se; }
  const scheduled = ((sch ?? []) as Row[]).filter((s) => SCHEDULES.includes(str(s.schedule)));
  if (!scheduled.length) return;
  const d = (cl.industry_details && typeof cl.industry_details === 'object' ? cl.industry_details : {}) as Row;
  if (!str(d.drugLicenseNumber) || !str(d.licenseValidTill)) {
    const names = scheduled.map((s) => `${list.find((p) => p.product_code === s.product_code)?.product_name ?? s.product_code} (Schedule ${s.schedule})`).join(', ');
    throw new AppError(422, 'SCHEDULE_DRUG_LICENSE_REQUIRED', `${names} can only be sold to a licensed buyer. Add the drug licence number and its valid-till date on ${cl.client_name ?? 'the customer'} first.`);
  }
}

/** Stock pick: selling rate + GST must not exceed the MRP printed on the batch it is taken from. */
export async function assertPharmaMrp(org: string, lines: { quantity: unknown; subtotal?: unknown; product_id?: unknown }[], plan: Map<string, Allocation[]>): Promise<void> {
  if (String(process.env.PHARMA_MRP_CHECK ?? '').toLowerCase() === 'off') return;
  const batchIds = new Set<string>();
  for (const allocs of plan.values()) for (const a of allocs) for (const b of a.batches) if (b.src === 'pharma') batchIds.add(b.batchId);
  if (!batchIds.size) return;
  const { data: bs, error } = await supabaseAdmin.from('pharma_batches').select('id, batch_number, mrp, gst_percent').eq('organization_id', org).in('id', [...batchIds]);
  if (error) { if ((error as { code?: string }).code === '42P01') return; throw error; }
  const batch = new Map(((bs ?? []) as Row[]).map((b) => [String(b.id), b]));
  const productIds = [...new Set([...plan.values()].flat().map((a) => a.productId))];
  const { data: ps } = await supabaseAdmin.from('products').select('id, product_name, tax_percent').eq('organization_id', org).in('id', productIds);
  const prod = new Map(((ps ?? []) as Row[]).map((p) => [String(p.id), p]));
  for (const [index, allocs] of plan) {
    const line = lines[Number(index)]; if (!line || line.subtotal === null || line.subtotal === undefined) continue;
    const qty = num(line.quantity); if (qty <= 0) continue;
    const rate = num(line.subtotal) / qty; // net rate per paid unit, after discount
    for (const a of allocs) {
      const p = prod.get(a.productId);
      for (const part of a.batches) {
        if (part.src !== 'pharma') continue;
        const b = batch.get(part.batchId); const mrp = num(b?.mrp); if (!(mrp > 0)) continue; // MRP not recorded: cannot be judged
        const gst = p?.tax_percent === null || p?.tax_percent === undefined ? num(b?.gst_percent) : num(p.tax_percent);
        const withTax = r2(rate * (1 + gst / 100));
        if (withTax > mrp + 0.01) throw new AppError(422, 'PRICE_ABOVE_MRP', `${p?.product_name ?? 'This product'}: selling rate ₹${r2(rate)} + ${gst}% GST = ₹${withTax} is above the MRP ₹${mrp} printed on batch ${b?.batch_number}. Reduce the price or add a discount: selling above MRP is not allowed.`);
      }
    }
  }
}

/** Pharma: goods that have left the warehouse, or an order already carrying a GST invoice amount, cannot be edited / cancelled behind the stock's back.
 *  Other industries return immediately. */
export async function assertPharmaOrderMovable(org: string, industryTypeId: string | null | undefined, dispatchStatus: unknown, action: 'edited' | 'cancelled', taxAmount: unknown = 0): Promise<void> {
  if ((await industryCodeOf(org, industryTypeId)) !== 'pharma') return;
  if (['dispatched', 'delivered'].includes(String(dispatchStatus ?? ''))) throw new AppError(422, 'ORDER_DISPATCHED', `The goods on this order have already left the warehouse, so it cannot be ${action}. Record a sales return (Sales Returns) instead.`);
  if (action === 'edited' && num(taxAmount) > 0) throw new AppError(422, 'ORDER_HAS_TAX', 'This order includes tax from its quotation, so its items cannot be edited here. Cancel it and create a new quotation instead. Notes can still be edited.');
}