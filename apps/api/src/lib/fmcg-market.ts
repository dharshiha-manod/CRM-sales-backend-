// FMCG sells locally and internationally. Home market = India / INR.
// Local vs International is DERIVED from the client's country, never typed.
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';

export const HOME_COUNTRY = 'IN';
export const HOME_CURRENCY = 'INR';
export type MarketScope = 'local' | 'international';

/** No country saved = local (every pre-existing client keeps behaving as before). */
export function marketScopeOf(countryCode?: string | null): MarketScope {
  const code = (countryCode ?? '').trim().toUpperCase();
  return code && code !== HOME_COUNTRY ? 'international' : 'local';
}

export async function isFmcgIndustry(org: string, industryTypeId?: string | null): Promise<boolean> {
  if (!industryTypeId) return false;
  const { data } = await supabaseAdmin.from('industry_types').select('code').eq('organization_id', org).eq('id', industryTypeId).maybeSingle();
  return String((data as { code?: string } | null)?.code ?? '').toLowerCase() === 'fmcg';
}

export type DocumentCurrency = { currency_code: string; exchange_rate: number };

/** Currency + rate a new quotation/order must carry. Non-FMCG clients return null (columns keep INR @ 1). */
export async function documentCurrencyForClient(org: string, client: { country_code?: string | null; currency_code?: string | null; industry_type_id?: string | null } | null): Promise<DocumentCurrency | null> {
  if (!client || !(await isFmcgIndustry(org, client.industry_type_id))) return null;
  const scope = marketScopeOf(client.country_code);
  const currency = (client.currency_code ?? '').trim().toUpperCase() || (scope === 'local' ? HOME_CURRENCY : '');
  if (!currency) throw new AppError(422, 'CLIENT_CURRENCY_REQUIRED', 'This is an international client. Set the client\'s currency before creating a quotation.');
  if (currency === HOME_CURRENCY) return { currency_code: HOME_CURRENCY, exchange_rate: 1 };
  const { data, error } = await supabaseAdmin.from('fmcg_currency_rates').select('rate_to_inr')
    .eq('organization_id', org).eq('industry_type_id', client.industry_type_id as string).eq('currency_code', currency)
    .lte('effective_from', new Date().toISOString().slice(0, 10)).order('effective_from', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new AppError(500, 'FX_LOOKUP_FAILED', error.message, error);
  const rate = Number((data as { rate_to_inr?: number } | null)?.rate_to_inr);
  if (!Number.isFinite(rate) || rate <= 0) throw new AppError(422, 'NO_EXCHANGE_RATE', `No active ${currency} to INR rate in FMCG Currency Rates. Add one, then try again.`);
  return { currency_code: currency, exchange_rate: rate };
}

export const toBase = (amount: number, rate: number) => Math.round(amount * rate * 100) / 100;

/** INR value of an order row (foreign-currency orders carry base_total; everything else is already INR). */
export const orderBase = (o: unknown): number => { const r = o as { total_amount?: unknown; base_total?: unknown }; return Number(r.base_total ?? r.total_amount ?? 0); };
/** INR value of a payment row: amount in the order's currency x that order's exchange rate (1 when absent). */
export const collectionBase = (c: unknown): number => { const r = c as { amount?: unknown; sale_orders?: { exchange_rate?: unknown } | null }; return Number(r.amount ?? 0) * (Number(r.sale_orders?.exchange_rate ?? 1) || 1); };
/** Newest FMCG rate in force today (1 unit of `currency` = X INR), or null when none. Never throws on a missing rate. */
export async function findRateToInr(org: string, industryTypeId: string | null | undefined, currency: string): Promise<number | null> {
  const code = currency.trim().toUpperCase();
  if (!code || code === HOME_CURRENCY) return 1;
  if (!industryTypeId) return null;
  const { data } = await supabaseAdmin.from('fmcg_currency_rates').select('rate_to_inr')
    .eq('organization_id', org).eq('industry_type_id', industryTypeId).eq('currency_code', code)
    .lte('effective_from', new Date().toISOString().slice(0, 10)).order('effective_from', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const rate = Number((data as { rate_to_inr?: number } | null)?.rate_to_inr);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}