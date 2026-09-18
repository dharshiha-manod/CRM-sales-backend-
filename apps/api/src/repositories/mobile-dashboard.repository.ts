import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

export async function getMobileDashboard(organizationId: string, userId: string) {
  const { data: representative, error: representativeError } = await supabaseAdmin.from('sales_representatives').select('id, employee_code, designation, user_profiles(display_name)').eq('organization_id', organizationId).eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (representativeError) throw representativeError;
  if (!representative) throw new AppError(403, 'REPRESENTATIVE_PROFILE_REQUIRED', 'An active sales representative profile is required');
  const { data: assignments, error: assignmentsError } = await supabaseAdmin.from('sales_representative_client_assignments').select('id, assigned_at, clients(id, client_code, client_name, client_type, phone, city, status, priority, latitude, longitude)').eq('organization_id', organizationId).eq('sales_representative_id', representative.id).eq('status', 'active').order('assigned_at', { ascending: false });
  if (assignmentsError) throw assignmentsError;
  const clients = (assignments ?? []).map((assignment) => assignment.clients).filter(Boolean);
  return { representative, summary: { assignedClients: clients.length, scheduledVisits: 0, pendingCollections: 0, upcomingFollowUps: 0 }, clients };
}
