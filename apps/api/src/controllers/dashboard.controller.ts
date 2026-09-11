import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';

const todayStart = () => { const date = new Date(); date.setHours(0, 0, 0, 0); return date.toISOString(); };
const total = (result: { count: number | null }) => result.count ?? 0;

export const dashboard: RequestHandler = async (req, res) => {
  const organizationId = req.header('x-organization-id');
  if (!organizationId) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  const requested = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
  const industryTypeId = resolveIndustryTypeId(req.industryScope!, requested);
  const start = todayStart();

  let clientsQuery = supabaseAdmin.from('clients').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId);
  if (industryTypeId) clientsQuery = clientsQuery.eq('industry_type_id', industryTypeId);

  let repsQuery = supabaseAdmin.from('sales_representatives').select(industryTypeId ? '*, sales_representative_industry_types!inner(industry_type_id)' : '*', { count: 'exact', head: true }).eq('organization_id', organizationId);
  if (industryTypeId) repsQuery = repsQuery.eq('sales_representative_industry_types.industry_type_id', industryTypeId);

  let activeRepsQuery = supabaseAdmin.from('sales_representatives').select(industryTypeId ? '*, sales_representative_industry_types!inner(industry_type_id)' : '*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'active');
  if (industryTypeId) activeRepsQuery = activeRepsQuery.eq('sales_representative_industry_types.industry_type_id', industryTypeId);

  let visitsQuery = supabaseAdmin.from('field_visits').select(industryTypeId ? '*, clients!inner(industry_type_id)' : '*', { count: 'exact', head: true }).eq('organization_id', organizationId).gte('check_in_time', start);
  if (industryTypeId) visitsQuery = visitsQuery.eq('clients.industry_type_id', industryTypeId);

  let completedVisitsQuery = supabaseAdmin.from('field_visits').select(industryTypeId ? '*, clients!inner(industry_type_id)' : '*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'checked_out').gte('check_in_time', start);
  if (industryTypeId) completedVisitsQuery = completedVisitsQuery.eq('clients.industry_type_id', industryTypeId);

  let ordersQuery = supabaseAdmin.from('sale_orders').select(industryTypeId ? 'id, total_amount, clients!inner(industry_type_id)' : 'id, total_amount').eq('organization_id', organizationId).gte('created_at', start);
  if (industryTypeId) ordersQuery = ordersQuery.eq('clients.industry_type_id', industryTypeId);

  let collectionsQuery = supabaseAdmin.from('sales_collections').select(industryTypeId ? 'id, amount, clients!inner(industry_type_id)' : 'id, amount').eq('organization_id', organizationId).gte('collected_at', start);
  if (industryTypeId) collectionsQuery = collectionsQuery.eq('clients.industry_type_id', industryTypeId);

  let recentVisitsQuery = supabaseAdmin.from('field_visits').select(industryTypeId ? 'id, status, check_in_time, outcome, clients!inner(client_name, industry_type_id), sales_representatives(employee_code, user_profiles(display_name))' : 'id, status, check_in_time, outcome, clients(client_name), sales_representatives(employee_code, user_profiles(display_name))').eq('organization_id', organizationId).order('check_in_time', { ascending: false }).limit(8);
  if (industryTypeId) recentVisitsQuery = recentVisitsQuery.eq('clients.industry_type_id', industryTypeId);

  const [clients, reps, activeReps, visits, completedVisits, orders, collections, recentVisits] = await Promise.all([
    clientsQuery, repsQuery, activeRepsQuery, visitsQuery, completedVisitsQuery, ordersQuery, collectionsQuery, recentVisitsQuery
  ]);
  for (const result of [clients, reps, activeReps, visits, completedVisits, orders, collections, recentVisits]) if (result.error) throw result.error;
  const salesToday = (orders.data ?? []).reduce((sum, order) => sum + Number(order.total_amount), 0);
  const collectionsToday = (collections.data ?? []).reduce((sum, collection) => sum + Number(collection.amount), 0);
  res.json({ data: { totalClients: total(clients), totalRepresentatives: total(reps), activeRepresentatives: total(activeReps), visitsToday: total(visits), completedVisitsToday: total(completedVisits), activeVisits: total(visits) - total(completedVisits), ordersToday: orders.data?.length ?? 0, salesToday, collectionsToday, recentVisits: recentVisits.data ?? [] } });
};