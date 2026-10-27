// School industry helpers. Everything here is School-only: each entry point first checks that the client /
// industry really is School and otherwise returns null / an unchanged value, so Trading, FMCG, Textile,
// Pharma and Vehicle never run any of this logic.
import { supabaseAdmin } from './supabase.js';
import { industryCodeOf } from './fmcg-market.js';
import { completeOrderIfSettled } from './order-completion.js';

export async function isSchoolIndustry(org: string, industryTypeId?: string | null): Promise<boolean> {
  return (await industryCodeOf(org, industryTypeId)) === 'school';
}

export type SchoolRule = {
  id: string;
  /** Who the rule is for: one school (default), every school of one type, or every school. */
  apply_to?: 'school' | 'school_type' | 'all';
  /** null = all products (percentage rules only). */
  product_id: string | null;
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
    const { data: schoolRow } = await supabaseAdmin.from('clients').select('industry_details').eq('id', client.id).eq('organization_id', org).maybeSingle();
    const rawType = String(((schoolRow as { industry_details?: { schoolType?: unknown } | null } | null)?.industry_details?.schoolType) ?? '');
    const schoolType = /^[a-z_]{1,30}$/.test(rawType) ? rawType : '';
    const who = `apply_to.eq.all,client_id.eq.${client.id}${schoolType ? `,and(apply_to.eq.school_type,school_type.eq.${schoolType})` : ''}`;
    const { data, error } = await supabaseAdmin.from('school_pricing_rules')
      .select('id, apply_to, product_id, discount_type, discount_percent, fixed_price, min_quantity')
      .eq('organization_id', org).eq('industry_type_id', industryTypeId).eq('status', 'active')
      .or(who)
      .or(`product_id.in.(${productIds.join(',')}),product_id.is.null`)
      .or(`start_date.is.null,start_date.lte.${date}`).or(`end_date.is.null,end_date.gte.${date}`);
    if (error && !tableMissing(error)) throw error;
    rules = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), apply_to: (r.apply_to as SchoolRule['apply_to']) ?? 'school', product_id: r.product_id == null ? null : String(r.product_id), discount_type: r.discount_type as SchoolRule['discount_type'],
      discount_percent: r.discount_percent == null ? null : Number(r.discount_percent),
      fixed_price: r.fixed_price == null ? null : Number(r.fixed_price),
      min_quantity: Number(r.min_quantity ?? 0),
    }));
  }
  return { industryTypeId, rules, period: await currentSchoolPeriod(org, industryTypeId, date) };
}

/**
 * The best rule for one product + quantity. A more specific rule wins: one school > one school type > all schools, then
 * one product > all products; then the highest minimum quantity reached, then the cheapest outcome.
 */
export function schoolRuleFor(ctx: SchoolContext | null, productId: string, quantity: number, listPrice: number): SchoolRule | null {
  if (!ctx) return null;
  const fits = ctx.rules.filter((r) => (r.product_id === productId || r.product_id === null) && r.min_quantity <= quantity);
  if (fits.length === 0) return null;
  const netPrice = (r: SchoolRule) => (r.discount_type === 'fixed_price' ? Number(r.fixed_price) : listPrice * (1 - Number(r.discount_percent ?? 0) / 100));
  const scopeRank = (r: SchoolRule) => (r.apply_to === 'all' ? 1 : r.apply_to === 'school_type' ? 2 : 3);
  const productRank = (r: SchoolRule) => (r.product_id ? 1 : 0);
  return fits.sort((a, b) => scopeRank(b) - scopeRank(a) || productRank(b) - productRank(a) || b.min_quantity - a.min_quantity || netPrice(a) - netPrice(b))[0];
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

/**
 * School only: a school that paid an advance (client.industry_details.advanceAmount) has it used up against its next
 * order. The amount is first CLAIMED on the client (so two orders at once cannot both use it), then recorded as a
 * normal collection on the order. Never throws - a problem here must not stop the order from being created.
 */
export async function applySchoolAdvance(org: string, ctx: SchoolContext | null, order: { id?: unknown; client_id?: unknown; representative_id?: unknown; total_amount?: unknown; status?: unknown }): Promise<void> {
  if (!ctx || !order.id || !order.client_id || !order.representative_id) return;
  if (['cancelled', 'rejected', 'pending_approval'].includes(String(order.status ?? ''))) return;
  try {
    const { data: client } = await supabaseAdmin.from('clients').select('industry_details').eq('id', String(order.client_id)).eq('organization_id', org).eq('industry_type_id', ctx.industryTypeId).maybeSingle();
    const details = ((client as { industry_details?: Record<string, unknown> | null } | null)?.industry_details ?? {}) as Record<string, unknown>;
    const advance = Number(details.advanceAmount ?? 0);
    const total = Number(order.total_amount ?? 0);
    if (!(advance > 0) || !(total > 0)) return;
    const used = Math.round(Math.min(advance, total) * 100) / 100;
    const remaining = Math.round((advance - used) * 100) / 100;
    const { data: claimed, error: claimError } = await supabaseAdmin.from('clients').update({ industry_details: { ...details, advanceAmount: remaining } })
      .eq('id', String(order.client_id)).eq('organization_id', org).filter('industry_details->>advanceAmount', 'eq', String(details.advanceAmount)).select('id');
    if (claimError || !claimed || claimed.length === 0) return;
    const { error: payError } = await supabaseAdmin.from('sales_collections').insert({
      organization_id: org, client_id: String(order.client_id), representative_id: String(order.representative_id), sale_order_id: String(order.id),
      amount: used, mode: 'other', reference_no: null, notes: 'Advance adjusted automatically',
    });
    if (payError) { await supabaseAdmin.from('clients').update({ industry_details: details }).eq('id', String(order.client_id)).eq('organization_id', org); return; }
    await completeOrderIfSettled(org, String(order.id));
  } catch { /* advance stays on the client; the order itself is unaffected */ }
}

/**
 * School only: a cancelled order gives back the advance it had used up. The automatic "Advance adjusted" collection(s)
 * on that order are reversed and the amount goes back onto the school's advance. Real payments are left untouched.
 * Never throws - the cancellation itself must not fail because of this follow-up.
 */
export async function restoreSchoolAdvance(org: string, orderId: string, clientId: string, industryTypeId: string | null): Promise<void> {
  try {
    if (!clientId || !(await isSchoolIndustry(org, industryTypeId))) return;
    const { data: used, error: usedError } = await supabaseAdmin.from('sales_collections').select('id, amount')
      .eq('organization_id', org).eq('sale_order_id', orderId).eq('notes', 'Advance adjusted automatically');
    if (usedError || !used || used.length === 0) return;
    const amount = Math.round(used.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) * 100) / 100;
    if (!(amount > 0)) return;
    const { data: client } = await supabaseAdmin.from('clients').select('industry_details').eq('id', clientId).eq('organization_id', org).maybeSingle();
    const details = ((client as { industry_details?: Record<string, unknown> | null } | null)?.industry_details ?? {}) as Record<string, unknown>;
    const current = Number(details.advanceAmount ?? 0) || 0;
    let update = supabaseAdmin.from('clients').update({ industry_details: { ...details, advanceAmount: Math.round((current + amount) * 100) / 100 } }).eq('id', clientId).eq('organization_id', org);
    if (details.advanceAmount != null) update = update.filter('industry_details->>advanceAmount', 'eq', String(details.advanceAmount)); // someone else changed it meanwhile -> do nothing
    const { data: claimed, error: claimError } = await update.select('id');
    if (claimError || !claimed || claimed.length === 0) return;
    const { error: deleteError } = await supabaseAdmin.from('sales_collections').delete().in('id', used.map((row) => row.id as string)).eq('organization_id', org);
    if (deleteError) await supabaseAdmin.from('clients').update({ industry_details: details }).eq('id', clientId).eq('organization_id', org);
  } catch { /* the order is already cancelled; the advance stays as it was */ }
}