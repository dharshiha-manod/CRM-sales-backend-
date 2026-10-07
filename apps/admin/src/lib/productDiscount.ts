// MRP and Discount % are now saved on the product in the database (products.mrp / products.discount_percent),
// so every device can see them. Older products that were created before that may only have them in this
// browser's localStorage, so we fall back to that. Quotations/orders store the already-discounted price
// with 0 discount; this helper only changes what is SHOWN ("price 99, discount 0" -> "MRP 100, discount 1%").
// Totals are identical and nothing is saved.
const FMCG_META_PREFIX = 'fs-fmcg-product-meta:';

export type LineDiscountView = { unitPrice: number; discountAmount: number; discountPercent: number };
type DbProduct = { mrp?: number | string | null; discount_percent?: number | string | null } | null;

export function lineDiscountView(
  productId: string | null | undefined,
  quantity: number,
  unitPrice: number,
  discountAmount: number,
  discountPercent = 0,
  dbProduct?: DbProduct,
): LineDiscountView {
  const unchanged = { unitPrice, discountAmount, discountPercent };
  // A discount that was really applied on this line (typed or from a price list) always wins.
  if (Number(discountAmount) > 0) return unchanged;
  try {
    let mrp = Number(dbProduct?.mrp);
    let percent = Number(dbProduct?.discount_percent);
    // Fallback for older products whose MRP/discount only exist in this browser.
    if (!(mrp > 0) && productId) {
      const raw = window.localStorage.getItem(`${FMCG_META_PREFIX}${productId}`);
      if (raw) {
        const meta = JSON.parse(raw) as { mrp?: string; discountPercent?: string };
        mrp = Number(meta.mrp);
        percent = Number(meta.discountPercent);
      }
    }
    if (!(mrp > 0) || !(percent > 0)) return unchanged;
    // Safety check: only use it if the saved price really is MRP minus that discount.
    if (Math.abs(mrp - (mrp * percent) / 100 - Number(unitPrice)) > 0.01) return unchanged;
    return { unitPrice: mrp, discountAmount: Math.round(mrp * quantity * percent) / 100, discountPercent: percent };
  } catch {
    return unchanged;
  }
}