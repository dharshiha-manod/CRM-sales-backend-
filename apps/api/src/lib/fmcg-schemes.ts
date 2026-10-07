// FMCG schemes (percentage / flat amount / buy-X-get-Y / quantity slab / slab free goods / value slab / special price / pack deal)
// and how they price an order or quotation line.
// Rules (one place, so Quotations and Orders always agree):
//  - A discount typed on the line, or one that comes from the price list, always wins. A scheme only applies to a line
//    that has no discount of its own (schemes never stack on top of another discount).
//  - If several live schemes cover the same product, the one that is worth the most on that line is used.
//  - Flat amount is "INR off per unit", converted to the document currency at the line's exchange rate.
//  - Buy X get Y: free units are EXTRA units shipped at no charge (floor(qty / X) * Y). They do not change the price.
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';

export type SchemeType = 'percentage' | 'flat_amount' | 'buy_x_get_y' | 'slab' | 'slab_free' | 'value_slab' | 'special_price' | 'pack_off';
// One slab row. slab: minQuantity + discountPercent. slab_free: minQuantity + freeQuantity. value_slab: minValue (INR) + discountPercent.
export type SchemeSlab = { minQuantity?: number; minValue?: number; discountPercent?: number; freeQuantity?: number };
export type LiveScheme = {
  id: string; name: string; scheme_type: SchemeType;
  discount_percent: number | null; discount_amount: number | null; buy_quantity: number | null; free_quantity: number | null;
  slabs: SchemeSlab[]; product_ids: string[];
};
export type AppliedScheme = { schemeId: string; schemeName: string; discountAmount: number; discountPercent: number; freeQuantity: number };

const round2 = (n: number) => Math.round(n * 100) / 100;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** What one scheme gives on one line. `unitPrice` is in the document currency; `rate` = INR per 1 unit of that currency. */
export function evaluateScheme(scheme: LiveScheme, quantity: number, unitPrice: number, rate = 1): { discountAmount: number; freeQuantity: number } {
  const gross = unitPrice * quantity;
  if (!(gross > 0) || !(quantity > 0)) return { discountAmount: 0, freeQuantity: 0 };
  switch (scheme.scheme_type) {
    case 'percentage':
      return { discountAmount: round2(gross * Math.min(100, n(scheme.discount_percent)) / 100), freeQuantity: 0 };
    case 'flat_amount': {
      const offPerUnit = n(scheme.discount_amount) / (rate > 0 ? rate : 1);
      return { discountAmount: round2(Math.min(gross, offPerUnit * quantity)), freeQuantity: 0 };
    }
    case 'buy_x_get_y': {
      const buy = n(scheme.buy_quantity); const free = n(scheme.free_quantity);
      return { discountAmount: 0, freeQuantity: buy > 0 && free > 0 ? Math.floor(quantity / buy) * free : 0 };
    }
    case 'slab': {
      const slab = (scheme.slabs ?? []).filter((s) => n(s.minQuantity) > 0 && quantity >= n(s.minQuantity)).sort((a, b) => n(b.minQuantity) - n(a.minQuantity))[0];
      return { discountAmount: slab ? round2(gross * Math.min(100, n(slab.discountPercent)) / 100) : 0, freeQuantity: 0 };
    }
    case 'slab_free': {
      // More free units as the quantity grows: the highest slab reached decides how many free units ship.
      const slab = (scheme.slabs ?? []).filter((s) => n(s.minQuantity) > 0 && quantity >= n(s.minQuantity)).sort((a, b) => n(b.minQuantity) - n(a.minQuantity))[0];
      return { discountAmount: 0, freeQuantity: slab ? Math.floor(n(slab.freeQuantity)) : 0 };
    }
    case 'value_slab': {
      // Slab thresholds are rupee line values; the line value is converted to INR at the document's rate first.
      const valueInr = gross * (rate > 0 ? rate : 1);
      const slab = (scheme.slabs ?? []).filter((s) => n(s.minValue) > 0 && valueInr >= n(s.minValue)).sort((a, b) => n(b.minValue) - n(a.minValue))[0];
      return { discountAmount: slab ? round2(gross * Math.min(100, n(slab.discountPercent)) / 100) : 0, freeQuantity: 0 };
    }
    case 'special_price': {
      // discount_amount holds the special net rate per unit in INR. It only ever lowers the price.
      const netPerUnit = n(scheme.discount_amount) / (rate > 0 ? rate : 1);
      const off = (unitPrice - netPerUnit) * quantity;
      return { discountAmount: off > 0 ? round2(Math.min(gross, off)) : 0, freeQuantity: 0 };
    }
    case 'pack_off': {
      // For every FULL pack of buy_quantity units, discount_amount (INR) comes off.
      const pack = n(scheme.buy_quantity);
      const offPerPack = n(scheme.discount_amount) / (rate > 0 ? rate : 1);
      const packs = pack > 0 ? Math.floor(quantity / pack) : 0;
      return { discountAmount: round2(Math.min(gross, packs * offPerPack)), freeQuantity: 0 };
    }
    default:
      return { discountAmount: 0, freeQuantity: 0 };
  }
}

/** The most valuable live scheme for this product and quantity, or null. Free units are valued at the unit price. */
export function bestSchemeFor(schemes: LiveScheme[], productId: string, quantity: number, unitPrice: number, rate = 1): AppliedScheme | null {
  let best: (AppliedScheme & { value: number }) | null = null;
  for (const scheme of schemes) {
    if (!scheme.product_ids.includes(productId)) continue;
    const { discountAmount, freeQuantity } = evaluateScheme(scheme, quantity, unitPrice, rate);
    const value = discountAmount + freeQuantity * unitPrice;
    if (value <= 0 || (best && value <= best.value)) continue;
    const gross = unitPrice * quantity;
    best = { schemeId: scheme.id, schemeName: scheme.name, discountAmount, discountPercent: gross > 0 ? round2((discountAmount / gross) * 100) : 0, freeQuantity, value };
  }
  if (!best) return null;
  const { value: _value, ...applied } = best;
  return applied;
}

/** Schemes in force today for one industry that cover at least one of the given products. */
export async function loadLiveSchemes(org: string, industryTypeId: string | null | undefined, productIds: string[]): Promise<LiveScheme[]> {
  if (!industryTypeId || productIds.length === 0) return [];
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin.from('fmcg_schemes')
    .select('id, name, scheme_type, discount_percent, discount_amount, buy_quantity, free_quantity, slabs, fmcg_scheme_products(product_id)')
    .eq('organization_id', org).eq('industry_type_id', industryTypeId).eq('status', 'active')
    .or('start_date.is.null,start_date.lte.' + today).or('end_date.is.null,end_date.gte.' + today);
  if (error) {
    // Schemes tables not created yet: pricing carries on without schemes instead of blocking every order.
    if (['42P01', 'PGRST205', 'PGRST200'].includes((error as { code?: string }).code ?? '')) return [];
    throw new AppError(500, 'SCHEMES_LOAD_FAILED', error.message, error);
  }
  return (data ?? []).map((row) => {
    const r = row as unknown as Omit<LiveScheme, 'product_ids' | 'slabs'> & { slabs: SchemeSlab[] | null; fmcg_scheme_products: { product_id: string }[] | null };
    return { ...r, slabs: r.slabs ?? [], product_ids: (r.fmcg_scheme_products ?? []).map((p) => p.product_id) };
  }).filter((s) => s.product_ids.some((id) => productIds.includes(id)));
}