// FILE: admin/src/lib/priceListLookup.ts
// Step 3 of the Trading connectivity plan: look up the real, date-bound
// rate from the Price List module (/trading/price-lists) instead of the
// flat Products table price. Shared by Deal Management and Purchase
// Enquiry — one function, not duplicated per page, same pattern this
// codebase already uses for the generic TradingMasterPage engine.
import { api } from './api';

/** Same "is this rate in force today" rule as the Price List page itself. */
/** Today as YYYY-MM-DD in the viewer's own time zone (price-list dates have no time part). */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isRateActive(r: Record<string, unknown>): boolean {
  const today = localToday();
  const from = r.effective_from ? String(r.effective_from).slice(0, 10) : null;
  const to = r.effective_to ? String(r.effective_to).slice(0, 10) : null;
  // Plain date-string compare: the rate stays valid through the whole last day, in any time zone.
  if (to && to < today) return false;
  if (from && from > today) return false;
  return true;
}

// Same split the API enforces when a row is saved (validatePriceList): these two rate types carry a
// purchase rate, every other type carries a selling rate. Older rows saved before that rule can still
// hold a leftover value in the other column (e.g. a customer-specific row with a purchase rate), so the
// lookups below decide by rate type instead of trusting whichever column happens to be filled.
const PURCHASE_SIDE_TYPES = ['Purchase Rate', 'Supplier-specific Rate'];
const isPurchaseSideRow = (r: Record<string, unknown>) => PURCHASE_SIDE_TYPES.includes(String(r.rate_type ?? ''));
// Same minimum quantity -> plain Selling/Purchase rate beats Wholesale, which beats Retail.
const RATE_TYPE_PRIORITY = ['Selling Rate', 'Purchase Rate', 'Wholesale Rate', 'Retail Rate'];

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
  const typeRank = (r: Record<string, unknown>) => {
    const i = RATE_TYPE_PRIORITY.indexOf(String(r.rate_type ?? ''));
    return i === -1 ? RATE_TYPE_PRIORITY.length : i;
  };
  const byTierThenType = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    Number(b.min_quantity ?? 0) - Number(a.min_quantity ?? 0) || typeRank(a) - typeRank(b);
  // A blank minimum quantity and 0 both mean "no minimum" (the base tier).
  const baseTier = () => rows.filter((r) => Number(r.min_quantity ?? 0) === 0).sort(byTierThenType)[0];
  if (!quantity) return baseTier();
  const qualifying = rows.filter((r) => Number(r.min_quantity ?? 0) <= quantity).sort(byTierThenType);
  return qualifying[0] ?? baseTier();
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
  target: { selling?: string; purchase?: string; currency?: string; discount?: string; tax?: string; purchaseDiscount?: string },
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
      const sellingRows = rows.filter((r) => !isPurchaseSideRow(r) && r.selling_rate != null);
      const purchaseRows = rows.filter((r) => isPurchaseSideRow(r) && r.purchase_rate != null);
      const generalSelling = sellingRows.filter((r) => !r.customer_name);
      const generalPurchase = purchaseRows.filter((r) => !r.supplier_name);
      // A rate for THIS customer / supplier wins, and it honours its own minimum quantity too.
      const customerSelling = sellingRows.filter((r) => r.customer_name && r.customer_name === prev.customer_name);
      // Purchase Enquiry can hold several suppliers as "A,B". Only a single chosen supplier has "its own" rate.
      const chosenSuppliers = String(prev.supplier_name ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const chosenSupplier = chosenSuppliers.length === 1 ? chosenSuppliers[0] : '';
      const supplierPurchase = purchaseRows.filter((r) => r.supplier_name && chosenSupplier && String(r.supplier_name).trim() === chosenSupplier);
      const sellingMatch = pickTieredRate(customerSelling, sellingQty) ?? pickTieredRate(generalSelling, sellingQty);
      const purchaseMatch = pickTieredRate(supplierPurchase, purchaseQty) ?? pickTieredRate(generalPurchase, purchaseQty);
           if (!sellingMatch && !purchaseMatch) {
        // Rows exist for this product but none fits this quantity (e.g. a bulk-only offer on a small order).
        // Clear the discount that was filled for a different quantity. Rates and tax stay as they are.
        if (!target.discount) return prev;
        return { ...prev, [target.discount]: '' };
      }
      const next = { ...prev };
      if (target.selling && sellingMatch?.selling_rate != null) next[target.selling] = String(sellingMatch.selling_rate);
      if (target.purchase && purchaseMatch?.purchase_rate != null) next[target.purchase] = String(purchaseMatch.purchase_rate);
      // The supplier's own discount (from the Purchase / Supplier-specific row) is kept apart from the customer discount above.
      if (target.purchaseDiscount && purchaseMatch) next[target.purchaseDiscount] = purchaseMatch.discount != null ? String(purchaseMatch.discount) : '';
      // Selling-side pages (Deal) take currency, discount and tax from the selling row.
      // Purchase-only pages (Purchase Enquiry) take them from the purchase row only.
      const offerRow = target.selling ? (sellingMatch ?? purchaseMatch) : purchaseMatch;
      const currency = offerRow?.currency;
      if (target.currency && currency) next[target.currency] = String(currency);
      const discount = offerRow?.discount;
      if (target.discount) next[target.discount] = discount != null ? String(discount) : '';
      const tax = offerRow?.tax;
      if (target.tax && tax != null) next[target.tax] = String(tax);
      return next;
    });
  } catch {
    // Price List lookup is a convenience — leave the Products-table
    // fallback in place if this fails (e.g. offline, request error).
  }
}