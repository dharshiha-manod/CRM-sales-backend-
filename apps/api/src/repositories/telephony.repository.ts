import { supabaseAdmin } from '../lib/supabase.js';

export async function listCalls(organizationId: string) {
  const { data, error } = await supabaseAdmin.from('telephony_calls').select('*, clients(client_name), sales_representatives(employee_code, user_profiles(display_name))').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data;
}
