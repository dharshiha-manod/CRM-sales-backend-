import { supabaseAdmin } from '../lib/supabase.js';
export async function findProfileWithMemberships(userId: string) {
  const { data, error } = await supabaseAdmin.from('user_profiles').select('id, display_name, phone, organization_memberships(organization_id, status, roles(code, name), organizations(name, slug, status))').eq('id', userId).single();
  if (error) throw error;
  return data;
}
