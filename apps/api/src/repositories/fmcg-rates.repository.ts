import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

export async function listFmcgRates(org: string, industryTypeId: string | null) {
  let q = supabaseAdmin.from('fmcg_currency_rates').select('*').eq('organization_id', org).order('effective_from', { ascending: false }).order('created_at', { ascending: false });
  if (industryTypeId) q = q.eq('industry_type_id', industryTypeId);
  const { data, error } = await q;
  if (error) throw new AppError(500, 'FMCG_RATES_LIST_FAILED', error.message, error);
  return data ?? [];
}

export async function createFmcgRate(org: string, userId: string, industryTypeId: string | null, input: { currencyCode?: unknown; rateToInr?: unknown; effectiveFrom?: unknown }) {
  const currency = String(input.currencyCode ?? '').trim().toUpperCase();
  const rate = Number(input.rateToInr);
  if (!/^[A-Z]{3}$/.test(currency) || currency === 'INR') throw new AppError(422, 'INVALID_CURRENCY', 'Enter a 3-letter currency code other than INR.');
  if (!Number.isFinite(rate) || rate <= 0) throw new AppError(422, 'INVALID_RATE', 'Rate must be a positive number (1 unit of the currency in INR).');
  if (!industryTypeId) throw new AppError(422, 'INDUSTRY_REQUIRED', 'Select the FMCG industry first.');
  const { data, error } = await supabaseAdmin.from('fmcg_currency_rates').insert({
    organization_id: org, industry_type_id: industryTypeId, currency_code: currency, rate_to_inr: rate,
    effective_from: typeof input.effectiveFrom === 'string' && input.effectiveFrom ? input.effectiveFrom : new Date().toISOString().slice(0, 10), created_by: userId,
  }).select().single();
  if (error) throw new AppError(500, 'FMCG_RATE_SAVE_FAILED', error.message, error);
  return data;
}
export async function deleteFmcgRate(org: string, id: string, industryTypeId: string | null) {
  if (!industryTypeId) throw new AppError(422, 'INDUSTRY_REQUIRED', 'Select the FMCG industry first.');
  // Quotations and orders keep their own copy of the rate they used, so removing a rate row never changes them.
  const { data, error } = await supabaseAdmin.from('fmcg_currency_rates').delete().eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).select('id');
  if (error) throw new AppError(500, 'FMCG_RATE_DELETE_FAILED', error.message, error);
  if (!data || data.length === 0) throw new AppError(404, 'RATE_NOT_FOUND', 'Rate not found.');
}