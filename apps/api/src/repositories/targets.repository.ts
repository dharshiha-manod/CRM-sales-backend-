import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { assertRecordInScope, resolveIndustryTypeId } from '../lib/industry-scope.js';

const fail = (error: unknown): never => { throw error; };

const SELECT = `
  id, organization_id, representative_id, industry_type_id, target_type,
  period_start, period_end, period_label, target_value, priority, lifecycle,
  client_id, product_id, remarks, adjustments, created_by, created_at, updated_at,
  sales_representatives(id, employee_code, designation, user_profiles(display_name)),
  industry_types(id, code, name),
  clients(id, client_code, client_name),
  products(id, product_name)
`;

export interface TargetFilters {
  industryTypeId?: string | null;
  representativeId?: string;
  targetType?: string;
  periodStart?: string;
  periodEnd?: string;
  includeArchived?: boolean;
}

function notFound(): AppError {
  return new AppError(404, 'TARGET_NOT_FOUND', 'Sales target was not found');
}

export async function listTargets(organizationId: string, filters: TargetFilters, scope: IndustryScope) {
  const industryTypeId = resolveIndustryTypeId(scope, filters.industryTypeId);
  let query = supabaseAdmin.from('sales_targets').select(SELECT).eq('organization_id', organizationId).order('period_start', { ascending: false });
  if (industryTypeId) query = query.eq('industry_type_id', industryTypeId);
  if (filters.representativeId) query = query.eq('representative_id', filters.representativeId);
  if (filters.targetType) query = query.eq('target_type', filters.targetType);
  // Any target whose period overlaps the requested window, not just ones that start inside it —
  // otherwise a mid-month target created before "This Month" was clicked would vanish.
  if (filters.periodStart) query = query.gte('period_end', filters.periodStart);
  if (filters.periodEnd) query = query.lte('period_start', filters.periodEnd);
  if (!filters.includeArchived) query = query.in('lifecycle', ['active', 'paused']);
  const { data, error } = await query;
  if (error) fail(error);
  return withAchievement(organizationId, data ?? []);
}

export async function getTarget(organizationId: string, id: string, scope: IndustryScope) {
  const { data, error } = await supabaseAdmin.from('sales_targets').select(SELECT).eq('organization_id', organizationId).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound();
  assertRecordInScope(scope, data.industry_type_id as string, notFound());
  const [withAch] = await withAchievement(organizationId, [data]);
  return withAch;
}

export async function createTarget(organizationId: string, userId: string, input: Record<string, unknown>) {
const { data, error } = await supabaseAdmin.from('sales_targets').insert([{
    organization_id: organizationId,
    representative_id: input.representativeId,
    industry_type_id: input.industryTypeId,
    target_type: input.targetType,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    period_label: input.periodLabel,
    target_value: input.targetValue,
    priority: input.priority ?? 'normal',
    client_id: input.clientId ?? null,
    product_id: input.productId ?? null,
    remarks: input.remarks ?? null,
    created_by: userId,
  }]).select(SELECT).single();
  if (error) fail(error);
  const [withAch] = await withAchievement(organizationId, [data]);
  return withAch;
}

export async function updateTarget(organizationId: string, id: string, scope: IndustryScope, input: Record<string, unknown>) {
  const existing = await getTarget(organizationId, id, scope);
  const map: Record<string, string> = {
    representativeId: 'representative_id', industryTypeId: 'industry_type_id', targetType: 'target_type',
    periodStart: 'period_start', periodEnd: 'period_end', periodLabel: 'period_label', targetValue: 'target_value',
    clientId: 'client_id', productId: 'product_id',
  };
  const payload = Object.fromEntries(Object.entries(input).map(([key, value]) => [map[key] ?? key, value]));
  const { data, error } = await supabaseAdmin.from('sales_targets').update({ ...payload, updated_at: new Date().toISOString() }).eq('organization_id', organizationId).eq('id', existing.id).select(SELECT).maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound();
  const [withAch] = await withAchievement(organizationId, [data]);
  return withAch;
}

export async function setLifecycle(organizationId: string, id: string, scope: IndustryScope, lifecycle: string) {
  await getTarget(organizationId, id, scope);
  const { data, error } = await supabaseAdmin.from('sales_targets').update({ lifecycle, updated_at: new Date().toISOString() }).eq('organization_id', organizationId).eq('id', id).select(SELECT).maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound();
  const [withAch] = await withAchievement(organizationId, [data]);
  return withAch;
}

export async function adjustTarget(organizationId: string, id: string, scope: IndustryScope, userId: string, input: { newValue: number; reason: string }) {
  const existing = await getTarget(organizationId, id, scope);
  const adjustments = Array.isArray(existing.adjustments) ? existing.adjustments : [];
  const entry = { id: crypto.randomUUID(), previousValue: Number(existing.target_value), newValue: input.newValue, reason: input.reason, date: new Date().toISOString(), updatedBy: userId };
  const { data, error } = await supabaseAdmin.from('sales_targets').update({ target_value: input.newValue, adjustments: [...adjustments, entry], updated_at: new Date().toISOString() }).eq('organization_id', organizationId).eq('id', id).select(SELECT).maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound();
  const [withAch] = await withAchievement(organizationId, [data]);
  return withAch;
}

export async function deleteTarget(organizationId: string, id: string, scope: IndustryScope) {
  await getTarget(organizationId, id, scope);
  const { error } = await supabaseAdmin.from('sales_targets').delete().eq('organization_id', organizationId).eq('id', id);
  if (error) fail(error);
}

/* ─────────────────────────── Live achievement ───────────────────────────
   A target's "achieved" figure is never stored — it's computed here, on
   read, from the real sale_orders / sale_order_items / sales_collections /
   field_visits / sales_representative_client_assignments rows for that
   rep's industry in that target's exact period. This is what makes the
   Targets page reflect real field activity instead of a hardcoded number.
   Targets sharing the same rep + period + industry are batched into one
   round trip per source table instead of one query per row. */
async function withAchievement<T extends {
  id: string; representative_id: string; industry_type_id: string; target_type: string;
  period_start: string; period_end: string; target_value: number;
}>(organizationId: string, rows: T[]) {
  if (rows.length === 0) return [] as (T & { achieved_value: number; activity: { orders: number; collections: number; visits: number; newCustomers: number } })[];

  const bucketKey = (r: T) => `${r.representative_id}|${r.industry_type_id}|${r.period_start}|${r.period_end}`;
  const buckets = new Map<string, { representativeId: string; industryTypeId: string; start: string; end: string }>();
  for (const r of rows) {
    const key = bucketKey(r);
    if (!buckets.has(key)) buckets.set(key, { representativeId: r.representative_id, industryTypeId: r.industry_type_id, start: r.period_start, end: r.period_end });
  }

  type Agg = { ordersAmount: number; ordersCount: number; itemQty: number; collections: number; visits: number; newCustomers: number };
  const agg = new Map<string, Agg>();

  await Promise.all([...buckets.entries()].map(async ([key, b]) => {
    const startTs = `${b.start}T00:00:00`;
    const endTs = `${b.end}T23:59:59.999`;

    const ordersQuery = supabaseAdmin.from('sale_orders')
      .select('id, total_amount, clients!inner(industry_type_id)')
      .eq('organization_id', organizationId).eq('representative_id', b.representativeId)
      .eq('clients.industry_type_id', b.industryTypeId)
      .gte('created_at', startTs).lte('created_at', endTs).neq('status', 'cancelled');

    const collectionsQuery = supabaseAdmin.from('sales_collections')
      .select('amount, clients!inner(industry_type_id)')
      .eq('organization_id', organizationId).eq('representative_id', b.representativeId)
      .eq('clients.industry_type_id', b.industryTypeId)
      .gte('collected_at', startTs).lte('collected_at', endTs);

    const visitsQuery = supabaseAdmin.from('field_visits')
      .select('id, clients!inner(industry_type_id)', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('representative_id', b.representativeId)
      .eq('clients.industry_type_id', b.industryTypeId)
      .gte('check_in_time', startTs).lte('check_in_time', endTs);

    const newCustomersQuery = supabaseAdmin.from('sales_representative_client_assignments')
      .select('id, clients!inner(industry_type_id)', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('sales_representative_id', b.representativeId)
      .eq('clients.industry_type_id', b.industryTypeId).eq('status', 'active')
      .gte('assigned_at', startTs).lte('assigned_at', endTs);

    const [orders, collections, visits, newCustomers] = await Promise.all([ordersQuery, collectionsQuery, visitsQuery, newCustomersQuery]);
    for (const r of [orders, collections, visits, newCustomers]) if (r.error) fail(r.error);

    const orderIds = (orders.data ?? []).map((o) => o.id);
    let itemQty = 0;
    if (orderIds.length > 0) {
      const { data: items, error: itemsError } = await supabaseAdmin.from('sale_order_items').select('quantity').in('order_id', orderIds);
      if (itemsError) fail(itemsError);
      itemQty = (items ?? []).reduce((sum, i) => sum + Number(i.quantity), 0);
    }

    agg.set(key, {
      ordersAmount: (orders.data ?? []).reduce((sum, o) => sum + Number(o.total_amount), 0),
      ordersCount: (orders.data ?? []).length,
      itemQty,
      collections: (collections.data ?? []).reduce((sum, c) => sum + Number(c.amount), 0),
      visits: visits.count ?? 0,
      newCustomers: newCustomers.count ?? 0,
    });
  }));

  const QUANTITY_TYPES = new Set(['order_quantity', 'meter_quantity', 'quantity_sold', 'product_quantity']);
  const VISIT_TYPES = new Set(['visit_count', 'client_visits', 'institution_visits', 'doctor_visits', 'pharmacy_visits']);
  const CUSTOMER_TYPES = new Set(['new_customers', 'admission_target', 'student_enrollment']);
  const COLLECTION_TYPES = new Set(['collection_amount', 'fee_collection']);

  return rows.map((r) => {
    const a = agg.get(bucketKey(r))!;
    let achieved = 0;
    if (r.target_type === 'sales_amount' || r.target_type === 'order_value') achieved = a.ordersAmount;
    else if (r.target_type === 'order_count') achieved = a.ordersCount;
    else if (QUANTITY_TYPES.has(r.target_type)) achieved = a.itemQty;
    else if (COLLECTION_TYPES.has(r.target_type)) achieved = a.collections;
    else if (VISIT_TYPES.has(r.target_type)) achieved = a.visits;
    else if (CUSTOMER_TYPES.has(r.target_type)) achieved = a.newCustomers;
    else if (r.target_type === 'followups') achieved = a.visits;
    return { ...r, achieved_value: achieved, activity: { orders: a.ordersCount, collections: a.collections, visits: a.visits, newCustomers: a.newCustomers } };
  });
}