import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

const todayStart = () => { const date = new Date(); date.setHours(0, 0, 0, 0); return date.toISOString(); };
const total = (result: { count: number | null }) => result.count ?? 0;

export const dashboard: RequestHandler = async (req, res) => {
  const organizationId = req.header('x-organization-id');
  if (!organizationId) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  const start = todayStart();
  const [clients, reps, activeReps, visits, completedVisits, orders, collections, recentVisits] = await Promise.all([
    supabaseAdmin.from('clients').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    supabaseAdmin.from('sales_representatives').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    supabaseAdmin.from('sales_representatives').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'active'),
    supabaseAdmin.from('field_visits').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).gte('check_in_time', start),
    supabaseAdmin.from('field_visits').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'checked_out').gte('check_in_time', start),
    supabaseAdmin.from('sale_orders').select('id, total_amount').eq('organization_id', organizationId).gte('created_at', start),
    supabaseAdmin.from('sales_collections').select('id, amount').eq('organization_id', organizationId).gte('collected_at', start),
    supabaseAdmin.from('field_visits').select('id, status, check_in_time, outcome, clients(client_name), sales_representatives(employee_code, user_profiles(display_name))').eq('organization_id', organizationId).order('check_in_time', { ascending: false }).limit(8)
  ]);
  for (const result of [clients, reps, activeReps, visits, completedVisits, orders, collections, recentVisits]) if (result.error) throw result.error;
  const salesToday = (orders.data ?? []).reduce((sum, order) => sum + Number(order.total_amount), 0);
  const collectionsToday = (collections.data ?? []).reduce((sum, collection) => sum + Number(collection.amount), 0);
  res.json({ data: { totalClients: total(clients), totalRepresentatives: total(reps), activeRepresentatives: total(activeReps), visitsToday: total(visits), completedVisitsToday: total(completedVisits), activeVisits: total(visits) - total(completedVisits), ordersToday: orders.data?.length ?? 0, salesToday, collectionsToday, recentVisits: recentVisits.data ?? [] } });
};
