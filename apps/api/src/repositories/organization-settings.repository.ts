import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { isGlobalRole, type IndustryScope } from '../lib/industry-scope.js';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export async function getOrganizationSettings(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('organization_settings')
    .select('settings, updated_at')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveOrganizationSettings(organizationId: string, userId: string, settings: Record<string, unknown>, industryKey?: string, scope?: IndustryScope) {
  const organizationName = typeof settings.organization === 'object' && settings.organization !== null
    ? (settings.organization as Record<string, unknown>).name
    : undefined;
  if (typeof organizationName !== 'string' || organizationName.trim().length < 2 || organizationName.trim().length > 160) {
    throw new AppError(422, 'INVALID_ORGANIZATION_NAME', 'Organization name must contain 2 to 160 characters.');
  }

  // Per-industry overrides live under settings.byIndustry[<industry code>]. The client may only
  // change the entry for the industry it is saving for; every other industry's stored overrides
  // are carried over from the database, never taken from the request. That keeps industries
  // separate (and keeps one admin's save from wiping another industry's settings).
  const existing = await getOrganizationSettings(organizationId);
  const storedSettings = isRecord(existing?.settings) ? existing.settings : {};
  const nextByIndustry: Record<string, unknown> = isRecord(storedSettings.byIndustry) ? { ...storedSettings.byIndustry } : {};
  if (industryKey) {
    const { data: industryTypes, error: industryError } = await supabaseAdmin.from('industry_types').select('id, code').eq('organization_id', organizationId);
    if (industryError) throw new AppError(500, 'INDUSTRY_LOOKUP_FAILED', `Could not verify the industry: ${industryError.message}`, industryError);
    const industry = (industryTypes ?? []).find((row) => String(row.code).toLowerCase() === industryKey);
    if (!industry) throw new AppError(422, 'INVALID_INDUSTRY', 'That industry does not exist for this organization.');
    // Admins / super admins may change any industry's settings; everyone else only their own.
    if (!scope || (!isGlobalRole(scope.role) && industry.id !== scope.lockedIndustryTypeId)) {
      throw new AppError(403, 'INDUSTRY_NOT_ASSIGNED', 'You can only change settings for your own assigned industry.');
    }
    const incomingByIndustry = isRecord(settings.byIndustry) ? settings.byIndustry : {};
    if (isRecord(incomingByIndustry[industryKey])) nextByIndustry[industryKey] = incomingByIndustry[industryKey];
  }
  settings = { ...settings, byIndustry: nextByIndustry };

  const { error: organizationError } = await supabaseAdmin
    .from('organizations')
    .update({ name: organizationName.trim() })
    .eq('id', organizationId);
  if (organizationError) throw new AppError(500, 'ORGANIZATION_UPDATE_FAILED', `Could not update organization: ${organizationError.message}`, organizationError);

  const { data, error } = await supabaseAdmin
    .from('organization_settings')
    .upsert({ organization_id: organizationId, settings, updated_by: userId }, { onConflict: 'organization_id' })
    .select('settings, updated_at')
    .single();
  if (error) throw new AppError(500, 'ORGANIZATION_SETTINGS_SAVE_FAILED', `Could not save settings: ${error.message}`, error);
  return data;
}
