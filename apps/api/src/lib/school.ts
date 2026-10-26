// School industry helpers. Everything here is School-only: each entry point first checks that the client /
// industry really is School and otherwise returns null / an unchanged value, so Trading, FMCG, Textile,
// Pharma and Vehicle never run any of this logic.
import { supabaseAdmin } from './supabase.js';
import { industryCodeOf } from './fmcg-market.js';

export async function isSchoolIndustry(org: string, industryTypeId?: string | null): Promise<boolean> {
  return (await industryCodeOf(org, industryTypeId)) === 'school';
}

export type SchoolRule = {
  id: string;
  product_id: string;
  discount_type: 'percentage' | 'fixed_price';
  discount_percent: number | null;
  fixed_price: number | null;
  min_quantity: number;
};
export type SchoolPeriod = { academic_year_id: string; term_id: string | null };
export type SchoolContext = { industryTypeId: string; rules: SchoolRule[]; period: SchoolPeriod | null };

// Tables not created yet (migration not run): School keeps working with plain catalog prices and no stamping.
const MISSING_TABLE = ['42P01', 'PGRST205', 'PGRST200', '42703'];
const tableMissing = (error: { code?: string } | null) => !!error && MISSING_TABLE.includes(error.code ?? '');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** The academic year (and its term) that is running today, or null when none is set up. */
export async function currentSchoolPeriod(org: string, industryTypeId: string, onDate: string = today()): Promise<SchoolPeriod | null> {
  const { data: years, error } = await supabaseAdmin.from('school_academic_years').select('id')
    .eq('organization_id', org).eq('industry_type_id', industryTypeId).eq('status', 'active')
    .lte('start_date', onDate).gte('end_date', onDate).order('start_date', { ascending: false }).limit(1);
  if (error) { if (tableMissing(error)) return null; throw error; }
  const year = (years ?? [])[0] as { id: string } | undefined;
  if (!year) return null;
  const { data: terms, error: termError } = await supabaseAdmin.from('school_terms').select('id')
    .eq('organization_id', org).eq('academic_year_id', year.id).lte('start_date', onDate).gte('end_date', onDate).order('start_date').limit(1);
  if (termError && !tableMissing(termError)) throw termError;
  return { academic_year_id: year.id, term_id: ((terms ?? [])[0] as { id: string } | undefined)?.id ?? null };
}

/**
 * Everything a School quotation / order needs: this school's live pricing rules for the given products and the
 * current academic year + term. Returns null for any client that is not a School client.
 */
export async function loadSchoolContext(org: string, client: { id?: string | null; industry_type_id?: string | null } | null, productIds: string[]): Promise<SchoolContext | null> {
  const industryTypeId = client?.industry_type_id ?? null;
  if (!industryTypeId || !client?.id || !(await isSchoolIndustry(org, industryTypeId))) return null;
  const date = today();
  let rules: SchoolRule[] = [];
  if (productIds.length > 0) {
    const { data, error } = await supabaseAdmin.from('school_pricing_rules')
      .select('id, product_id, discount_type, discount_percent, fixed_price, min_quantity')
      .eq('organization_id', org).eq('industry_type_id', industryTypeId).eq('client_id', client.id).eq('status', 'active')
      .in('product_id', productIds)
      .or(`start_date.is.null,start_date.lte.${date}`).or(`end_date.is.null,end_date.gte.${date}`);
    if (error && !tableMissing(error)) throw error;
    rules = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), product_id: String(r.product_id), discount_type: r.discount_type as SchoolRule['discount_type'],
      discount_percent: r.discount_percent == null ? null : Number(r.discount_percent),
      fixed_price: r.fixed_price == null ? null : Number(r.fixed_price),
      min_quantity: Number(r.min_quantity ?? 0),
    }));
  }
  return { industryTypeId, rules, period: await currentSchoolPeriod(org, industryTypeId, date) };
}

/** The best rule for one product + quantity: highest minimum quantity reached, then the cheapest outcome. */
export function schoolRuleFor(ctx: SchoolContext | null, productId: string, quantity: number, listPrice: number): SchoolRule | null {
  if (!ctx) return null;
  const fits = ctx.rules.filter((r) => r.product_id === productId && r.min_quantity <= quantity);
  if (fits.length === 0) return null;
  const netPrice = (r: SchoolRule) => (r.discount_type === 'fixed_price' ? Number(r.fixed_price) : listPrice * (1 - Number(r.discount_percent ?? 0) / 100));
  return fits.sort((a, b) => b.min_quantity - a.min_quantity || netPrice(a) - netPrice(b))[0];
}

/** Columns to stamp on a School quotation / order. Empty for everyone else. */
export function schoolStamp(ctx: SchoolContext | null): Record<string, string | null> {
  return ctx?.period ? { academic_year_id: ctx.period.academic_year_id, term_id: ctx.period.term_id } : {};
}

type OrderItem = { productId: string; quantity: number; discountPercent: number; freeQuantity?: number };
/**
 * Order paths (rep visit order, manual order, order edit) price lines from the catalog. For a School client this
 * applies the school's negotiated rule first: a percentage rule becomes the line's discount (a discount typed on
 * the line still wins), a fixed-price rule replaces the catalog price. Non-school clients get the SAME objects back.
 */
export function applySchoolPricingToOrder<P extends { id: string; selling_price: unknown }>(ctx: SchoolContext | null, items: OrderItem[], productById: Map<string, P>): { items: OrderItem[]; productById: Map<string, P> } {
  if (!ctx || ctx.rules.length === 0) return { items, productById };
  const prices = new Map(productById);
  const next = items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) return item;
    const rule = schoolRuleFor(ctx, item.productId, item.quantity, Number(product.selling_price));
    if (!rule) return item;
    if (rule.discount_type === 'fixed_price') {
      prices.set(item.productId, { ...product, selling_price: rule.fixed_price });
      return item;
    }
    return item.discountPercent ? item : { ...item, discountPercent: Number(rule.discount_percent ?? 0) };
  });
  return { items: next, productById: prices };
}
