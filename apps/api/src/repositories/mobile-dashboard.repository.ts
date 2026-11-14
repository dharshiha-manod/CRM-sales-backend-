import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { localNow } from '../services/beat-automation.service.js';

const CHUNK = 200;

// Today's beat plan for this rep (planned + already visited). 0 if beat_visits is not set up.
async function countScheduledVisitsToday(organizationId: string, representativeId: string): Promise<number> {
  try {
    const { count, error } = await supabaseAdmin
      .from('beat_visits')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('representative_id', representativeId)
      .eq('visit_date', localNow().date)
      .in('status', ['planned', 'visited']);
    if (error) throw error;
    return count ?? 0;
  } catch (error) {
    console.error('Mobile dashboard: scheduled visits count failed', error);
    return 0;
  }
}

// Open follow-ups that are overdue or due within the next 7 days.
async function countUpcomingFollowUps(organizationId: string, representativeId: string): Promise<number> {
  try {
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabaseAdmin
      .from('follow_ups')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('representative_id', representativeId)
      .in('status', ['pending', 'in_progress'])
      .lte('due_at', until);
    if (error) throw error;
    return count ?? 0;
  } catch (error) {
    console.error('Mobile dashboard: follow-ups count failed', error);
    return 0;
  }
}

// Confirmed orders of this rep where the money collected is still below the order total.
async function countPendingCollections(organizationId: string, representativeId: string): Promise<number> {
  try {
    const { data: orders, error } = await supabaseAdmin
      .from('sale_orders')
      .select('id, total_amount')
      .eq('organization_id', organizationId)
      .eq('representative_id', representativeId)
      .eq('status', 'confirmed')
      .limit(1000);
    if (error) throw error;
    if (!orders?.length) return 0;

    const collected = new Map<string, number>();
    for (let i = 0; i < orders.length; i += CHUNK) {
      const ids = orders.slice(i, i + CHUNK).map((order) => order.id as string);
      const { data: rows, error: collectionError } = await supabaseAdmin
        .from('sales_collections')
        .select('sale_order_id, amount')
        .eq('organization_id', organizationId)
        .in('sale_order_id', ids);
      if (collectionError) throw collectionError;
      for (const row of rows ?? []) {
        const key = row.sale_order_id as string;
        collected.set(key, (collected.get(key) ?? 0) + Number(row.amount));
      }
    }
    return orders.filter((order) => (collected.get(order.id as string) ?? 0) + 0.00001 < Number(order.total_amount)).length;
  } catch (error) {
    console.error('Mobile dashboard: pending collections count failed', error);
    return 0;
  }
}

export async function getMobileDashboard(organizationId: string, userId: string) {
  const { data: representative, error: representativeError } = await supabaseAdmin.from('sales_representatives').select('id, employee_code, designation, user_profiles(display_name)').eq('organization_id', organizationId).eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (representativeError) throw representativeError;
  if (!representative) throw new AppError(403, 'REPRESENTATIVE_PROFILE_REQUIRED', 'An active sales representative profile is required');
  const { data: assignments, error: assignmentsError } = await supabaseAdmin.from('sales_representative_client_assignments').select('id, assigned_at, clients(id, client_code, client_name, client_type, phone, city, status, priority, latitude, longitude)').eq('organization_id', organizationId).eq('sales_representative_id', representative.id).eq('status', 'active').order('assigned_at', { ascending: false });
  if (assignmentsError) throw assignmentsError;
  const clients = (assignments ?? []).map((assignment) => assignment.clients).filter(Boolean);

  const [scheduledVisits, pendingCollections, upcomingFollowUps] = await Promise.all([
    countScheduledVisitsToday(organizationId, representative.id as string),
    countPendingCollections(organizationId, representative.id as string),
    countUpcomingFollowUps(organizationId, representative.id as string),
  ]);

  return { representative, summary: { assignedClients: clients.length, scheduledVisits, pendingCollections, upcomingFollowUps }, clients };
}