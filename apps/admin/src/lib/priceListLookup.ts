// FILE: admin/src/lib/priceListLookup.ts
// Step 3 of the Trading connectivity plan: look up the real, date-bound
// rate from the Price List module (/trading/price-lists) instead of the
// flat Products table price. Shared by Deal Management and Purchase
// Enquiry — one function, not duplicated per page, same pattern this
// codebase already uses for the generic TradingMasterPage engine.
import { api } from './api';

/** Same "is this rate in force today" rule as the Price List page itself. */
export function isRateActive(r: Record<string, unknown>): boolean {
  const now = new Date();
  const from = r.effective_from ? new Date(r.effective_from as string) : null;
  const to = r.effective_to ? new Date(r.effective_to as string) : null;
  if (to && to < now) return false;
  if (from && from > now) return false;
  return true;
}

/**
 * Among "general" rate rows for a product (no customer/supplier tied to
 * them — e.g. the plain Selling Rate, Wholesale Rate and Retail Rate rows),
 * picks the one whose Minimum quantity best fits the quantity being
 * transacted: the highest min_quantity that the quantity still qualifies
 * for, so a bulk order picks up the Wholesale-tier rate instead of the base
 * Selling rate. Rows with no min_quantity are the base tier. Falls back to
 * a min_quantity-less row (or the first row) when quantity is unknown —
 * this preserves the previous first-match behaviour for callers/pages that
 * don't have a quantity yet.
 */
function pickTieredRate(
  rows: Array<Record<string, unknown>>,
  quantity: number,
): Record<string, unknown> | undefined {
  if (!rows.length) return undefined;
  if (!quantity) return rows.find((r) => r.min_quantity == null) ?? rows[0];
  const qualifying = rows
    .filter((r) => Number(r.min_quantity ?? 0) <= quantity)
    .sort((a, b) => Number(b.min_quantity ?? 0) - Number(a.min_quantity ?? 0));
  return qualifying[0] ?? rows.find((r) => r.min_quantity == null) ?? rows[0];
}

/**
 * Fetches active price-list rows for `productName`, then fills the caller's
 * chosen fields with the best match:
 *   1. A rate specific to the currently-selected customer/supplier, if one
 *      is active today (a "Customer-specific Rate" / "Supplier-specific
 *      Rate" row).
 *   2. Otherwise, a general active rate for the product.
 * If neither exists, nothing is overwritten — whatever the Products-table
 * autoFillMap already filled in (the existing fallback) is left as-is.
 *
 * `target` lets each page decide which of its own field keys receives the
 * result, since Deal has separate purchase/selling rate fields while
 * Purchase Enquiry has a single `requested_rate` field.
 */
export async function applyPriceListRates(
  productName: string,
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
  target: { selling?: string; purchase?: string; currency?: string; discount?: string; tax?: string },
) {
  if (!productName) return;
  try {
    const res = await api<{ data: Array<Record<string, unknown>> }>('/trading/price-lists');
    const rows = (res.data ?? []).filter((r) => r.product_name === productName && isRateActive(r));
    if (!rows.length) return;
    setForm((prev) => {
      // Selling-side quantity is what THIS customer is taking (falls back to
      // the overall purchased quantity if that's not split out); purchase
      // side is always the quantity bought from the supplier.
      const sellingQty = Number(prev.customer_quantity || prev.quantity || 0);
      const purchaseQty = Number(prev.quantity || 0);
      const generalSelling = rows.filter((r) => !r.customer_name && r.selling_rate != null);
      const generalPurchase = rows.filter((r) => !r.supplier_name && r.purchase_rate != null);
      const sellingMatch =
        rows.find((r) => r.customer_name && r.customer_name === prev.customer_name && r.selling_rate != null) ??
        pickTieredRate(generalSelling, sellingQty);
      const purchaseMatch =
        rows.find((r) => r.supplier_name && r.supplier_name === prev.supplier_name && r.purchase_rate != null) ??
        pickTieredRate(generalPurchase, purchaseQty);
      if (!sellingMatch && !purchaseMatch) return prev;
      const next = { ...prev };
      if (target.selling && sellingMatch?.selling_rate != null) next[target.selling] = String(sellingMatch.selling_rate);
      if (target.purchase && purchaseMatch?.purchase_rate != null) next[target.purchase] = String(purchaseMatch.purchase_rate);
      const currency = sellingMatch?.currency ?? purchaseMatch?.currency;
      if (target.currency && currency) next[target.currency] = String(currency);
      // Discount/tax are the "offer" attached to whichever Price List row
      // priced this deal — this is the fix for the gap where the rate
      // auto-filled but its discount/tax were silently dropped.
      const discount = sellingMatch?.discount ?? purchaseMatch?.discount;
      if (target.discount && discount != null) next[target.discount] = String(discount);
      const tax = sellingMatch?.tax ?? purchaseMatch?.tax;
      if (target.tax && tax != null) next[target.tax] = String(tax);
      return next;
    });
  } catch {
    // Price List lookup is a convenience — leave the Products-table
    // fallback in place if this fails (e.g. offline, request error).
  }
}