import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

export async function getOrganizationSettings(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('organization_settings')
    .select('settings, updated_at')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveOrganizationSettings(organizationId: string, userId: string, settings: Record<string, unknown>) {
  const organizationName = typeof settings.organization === 'object' && settings.organization !== null
    ? (settings.organization as Record<string, unknown>).name
    : undefined;
  if (typeof organizationName !== 'string' || organizationName.trim().length < 2 || organizationName.trim().length > 160) {
    throw new AppError(422, 'INVALID_ORGANIZATION_NAME', 'Organization name must contain 2 to 160 characters.');
  }

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
