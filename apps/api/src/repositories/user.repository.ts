import { supabaseAdmin } from '../lib/supabase.js';
export async function findProfileWithMemberships(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('id, display_name, phone, organization_memberships(organization_id, status, industry_type_id, roles(code, name), organizations(name, slug, status), industry_types(id, code, name))')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}