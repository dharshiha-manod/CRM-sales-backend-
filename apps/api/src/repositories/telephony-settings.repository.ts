// NEW
import { supabaseAdmin } from '../lib/supabase.js';

export type TelephonySettingsRow = {
  organization_id: string;
  provider: string;
  is_enabled: boolean;
  default_industry_type_id: string | null;
  default_representative_id: string | null;
  ivr_menu_industry_map: Record<string, string>;
  auto_create_lead: boolean;
};

function fail(error: unknown): never {
  throw error;
}

export async function getTelephonySettings(organizationId: string): Promise<TelephonySettingsRow | null> {
  const { data, error } = await supabaseAdmin.from('telephony_settings').select('*').eq('organization_id', organizationId).maybeSingle();
  if (error) fail(error);
  return (data as TelephonySettingsRow) ?? null;
}

export async function upsertTelephonySettings(organizationId: string, input: Partial<Omit<TelephonySettingsRow, 'organization_id'>>): Promise<TelephonySettingsRow> {
  const { data, error } = await supabaseAdmin
    .from('telephony_settings')
    .upsert({ organization_id: organizationId, ...input, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    .select()
    .single();
  if (error) fail(error);
  return data as TelephonySettingsRow;
}

// Resolves which industry_type_id a new auto-created lead should use, given
// which IVR digits the caller pressed (e.g. "1"). Falls back to the
// organization's default_industry_type_id. Returns null if neither is set —
// the caller (telephony.service.ts) treats that as "leave unmatched" rather
// than guessing, exactly like the earlier plan described.
export function resolveIndustryForIvrPath(settings: TelephonySettingsRow, ivrDigits: string | undefined): string | null {
  if (ivrDigits && settings.ivr_menu_industry_map[ivrDigits]) return settings.ivr_menu_industry_map[ivrDigits];
  return settings.default_industry_type_id;
}
