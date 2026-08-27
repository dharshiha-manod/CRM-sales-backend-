import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return value; };
const total = (result: { count: number | null }) => result.count ?? 0;

export const reports: Record<string, RequestHandler> = {
  summary: async (req, res) => {
    const organizationId = org(req);
    const since = new Date(); since.setDate(since.getDate() - 30);
    const [visits, orders, collections, reps] = await Promise.all([
      supabaseAdmin.from('field_visits').select('id, representative_id, status, check_in_time, clients(client_name), sales_representatives(employee_code, user_profiles(display_name))').eq('organization_id', organizationId).gte('check_in_time', since.toISOString()).order('check_in_time', { ascending: false }).limit(500),
      supabaseAdmin.from('sale_orders').select('id, representative_id, client_id, total_amount, created_at, clients(client_name), sales_representatives(employee_code, user_profiles(display_name))').eq('organization_id', organizationId).gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(500),
      supabaseAdmin.from('sales_collections').select('id, representative_id, amount, collected_at, clients(client_name), sales_representatives(employee_code, user_profiles(display_name))').eq('organization_id', organizationId).gte('collected_at', since.toISOString()).order('collected_at', { ascending: false }).limit(500),
      supabaseAdmin.from('sales_representatives').select('id, employee_code, user_profiles(display_name)').eq('organization_id', organizationId).eq('status', 'active'),
    ]);
    for (const result of [visits, orders, collections, reps]) if (result.error) throw result.error;
    const nameOf = (row: { sales_representatives?: { employee_code?: string | null; user_profiles?: { display_name?: string | null } | null } | null }) => row.sales_representatives?.user_profiles?.display_name ?? row.sales_representatives?.employee_code ?? 'Unassigned';
    const byRep = new Map<string, { representativeId: string; representative: string; visits: number; orders: number; sales: number; collections: number }>();
    for (const rep of reps.data ?? []) byRep.set(rep.id, { representativeId: rep.id, representative: rep.user_profiles?.display_name ?? rep.employee_code, visits: 0, orders: 0, sales: 0, collections: 0 });
    for (const visit of visits.data ?? []) { const current = byRep.get(visit.representative_id) ?? { representativeId: visit.representative_id, representative: nameOf(visit), visits: 0, orders: 0, sales: 0, collections: 0 }; current.visits += 1; byRep.set(visit.representative_id, current); }
    for (const order of orders.data ?? []) { const current = byRep.get(order.representative_id) ?? { representativeId: order.representative_id, representative: nameOf(order), visits: 0, orders: 0, sales: 0, collections: 0 }; current.orders += 1; current.sales += Number(order.total_amount); byRep.set(order.representative_id, current); }
    for (const collection of collections.data ?? []) { const current = byRep.get(collection.representative_id) ?? { representativeId: collection.representative_id, representative: nameOf(collection), visits: 0, orders: 0, sales: 0, collections: 0 }; current.collections += Number(collection.amount); byRep.set(collection.representative_id, current); }
    res.json({ data: { period: { from: since.toISOString(), to: new Date().toISOString(), label: 'Last 30 days' }, totals: { visits: visits.data?.length ?? 0, orders: orders.data?.length ?? 0, sales: (orders.data ?? []).reduce((sum, row) => sum + Number(row.total_amount), 0), collections: (collections.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0) }, byRepresentative: [...byRep.values()].sort((a, b) => b.sales - a.sales || b.visits - a.visits), recentVisits: visits.data ?? [], recentOrders: orders.data ?? [], recentCollections: collections.data ?? [] } });
  },
};
