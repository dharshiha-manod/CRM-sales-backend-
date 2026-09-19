import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';
const fail = (error: unknown): never => { throw error; };
const OVERDUE_DAYS = 3;
type LeadFollowUpInput = { leadId: string; representativeId: string | null; companyName: string; dueAt: string; priority: string; notes?: string | null };

/** Creates, or refreshes, the one open follow-up associated with a lead. */
export async function createOrUpdateForLead(organizationId: string, input: LeadFollowUpInput) {
  const { data: existing, error: existingError } = await supabaseAdmin.from('follow_ups').select('id').eq('organization_id', organizationId).eq('lead_id', input.leadId).in('status', ['pending', 'in_progress']).maybeSingle();
  if (existingError) fail(existingError);
  const values = { representative_id: input.representativeId, title: `Follow up: ${input.companyName}`, due_at: input.dueAt, priority: input.priority, notes: input.notes ?? null };
  if (existing) {
    const { data, error } = await supabaseAdmin.from('follow_ups').update(values).eq('id', existing.id).eq('organization_id', organizationId).select().single();
    return error ? fail(error) : data;
  }
  const { data, error } = await supabaseAdmin.from('follow_ups').insert({ organization_id: organizationId, lead_id: input.leadId, ...values }).select().single();
  return error ? fail(error) : data;
}
export async function createFromVisit(organizationId: string, representativeId: string, visitId: string, input: { title: string; dueAt: string; priority: string; notes?: string | null }) {
  const { data: visit, error: visitError } = await supabaseAdmin.from('field_visits').select('id, client_id, status').eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).maybeSingle();
  if (visitError) fail(visitError); if (!visit?.client_id) throw new AppError(422, 'FOLLOW_UP_REQUIRES_CLIENT', 'A follow-up requires a visit linked to a client.');
  if (visit.status !== 'checked_out') throw new AppError(422, 'FOLLOW_UP_REQUIRES_COMPLETED_VISIT', 'Check out of the visit before scheduling a follow-up.');
  const { data, error } = await supabaseAdmin.from('follow_ups').insert({ organization_id: organizationId, representative_id: representativeId, client_id: visit.client_id, visit_id: visit.id, title: input.title, due_at: input.dueAt, priority: input.priority, notes: input.notes }).select().single();
  return error ? fail(error) : data;
}
// Manual follow-up created directly from the admin UI — no field visit
// required. Used for reminders an admin/manager wants to schedule that
// don't originate from a rep's visit (e.g. "call this client next week").
export async function createManual(organizationId: string, input: { clientId: string; representativeId: string; title: string; dueAt: string; priority: string; notes?: string | null }) {
  const { data: client, error: clientError } = await supabaseAdmin.from('clients').select('id').eq('id', input.clientId).eq('organization_id', organizationId).maybeSingle();
  if (clientError) fail(clientError);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found in this organization.');

  const { data, error } = await supabaseAdmin.from('follow_ups').insert({ organization_id: organizationId, representative_id: input.representativeId, client_id: input.clientId, title: input.title, due_at: input.dueAt, priority: input.priority, notes: input.notes }).select('*, clients(client_code, client_name), sales_representatives(employee_code, user_profiles(display_name))').single();
  return error ? fail(error) : data;
}
// Scans confirmed sale_orders older than OVERDUE_DAYS with an outstanding
// balance, and creates one follow-up per order that doesn't already have
// one. Called opportunistically whenever the follow-ups list is fetched —
// this codebase has no background job runner, so "automatic" means it
// runs on read instead of on a schedule.
async function syncOverdueCollectionFollowUps(organizationId: string) {
  const cutoff = new Date(Date.now() - OVERDUE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: candidateOrders, error: ordersError } = await supabaseAdmin.from('sale_orders').select('id, order_number, client_id, representative_id, total_amount, created_at').eq('organization_id', organizationId).eq('status', 'confirmed').lte('created_at', cutoff);
  if (ordersError) { console.error('Overdue collection scan failed', ordersError); return; }
  for (const order of candidateOrders ?? []) {
    const { data: collections, error: collectionsError } = await supabaseAdmin.from('sales_collections').select('amount').eq('organization_id', organizationId).eq('sale_order_id', order.id);
    if (collectionsError) { console.error('Overdue collection sum failed for order', order.id, collectionsError); continue; }
    const collected = (collections ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
    const outstanding = Number(order.total_amount) - collected;
    if (outstanding <= 0.00001) continue;
    const { data: existingFollowUp } = await supabaseAdmin.from('follow_ups').select('id').eq('sale_order_id', order.id).eq('organization_id', organizationId).in('status', ['pending', 'in_progress']).maybeSingle();
    if (existingFollowUp) continue;
    const daysOverdue = Math.floor((Date.now() - new Date(order.created_at).getTime()) / (24 * 60 * 60 * 1000));
    const { error: insertError } = await supabaseAdmin.from('follow_ups').insert({ organization_id: organizationId, representative_id: order.representative_id, client_id: order.client_id, sale_order_id: order.id, title: `Payment overdue: ${order.order_number}`, due_at: new Date().toISOString(), priority: 'high', notes: `Outstanding balance ₹${outstanding.toFixed(2)} on order ${order.order_number}, confirmed ${daysOverdue} day(s) ago.` });
    if (insertError) console.error('Auto follow-up creation failed for order', order.id, insertError);
  }
}
export async function listFollowUps(organizationId: string, representativeId?: string, industryTypeId?: string | null) {
  await syncOverdueCollectionFollowUps(organizationId);

  // Lead information is loaded separately. This deliberately keeps the
  // existing list endpoint compatible while the lead_id migration is rolled
  // out: PostgREST rejects an embedded relationship before that FK exists.
  // Do not use an inner client join for industry-scoped lists: lead-originated
  // follow-ups intentionally have no client_id. They are filtered below using
  // their linked lead's industry instead.
  const select = '*, clients(client_code, client_name, industry_type_id, industry_types(code)), sales_representatives(employee_code, user_profiles(display_name))';
  let query = supabaseAdmin.from('follow_ups').select(select).eq('organization_id', organizationId).order('due_at').limit(100);
  if (representativeId) query = query.eq('representative_id', representativeId);
  const { data, error } = await query;
  if (error) fail(error);
  const rows = data ?? [];
  const leadIds = rows.map((row) => (row as { lead_id?: string | null }).lead_id).filter((value): value is string => Boolean(value));
  const leadById = new Map<string, { id: string; lead_code: string | null; company_name: string | null; industry_type_id: string | null }>();
  if (leadIds.length > 0) {
    const { data: leads, error: leadsError } = await supabaseAdmin.from('leads').select('id, lead_code, company_name, industry_type_id').eq('organization_id', organizationId).in('id', leadIds);
    if (leadsError) fail(leadsError);
    for (const lead of leads ?? []) leadById.set(lead.id, lead);
  }
  const enriched = rows.map((row) => {
    const leadId = (row as { lead_id?: string | null }).lead_id;
    return leadId ? { ...row, leads: leadById.get(leadId) ?? null } : row;
  });
  if (!industryTypeId) return enriched;
  return enriched.filter((row) => {
    const clientIndustryTypeId = (row.clients as { industry_type_id?: string | null } | null)?.industry_type_id;
    const leadIndustryTypeId = (row.leads as { industry_type_id?: string | null } | null)?.industry_type_id;
    return (clientIndustryTypeId ?? leadIndustryTypeId) === industryTypeId;
  });
}
export async function updateFollowUp(organizationId: string, id: string, input: { status: string; notes?: string | null }, scope?: IndustryScope) {
  if (scope) {
    const { data: existing, error: existingError } = await supabaseAdmin.from('follow_ups').select('id, lead_id, clients(industry_type_id)').eq('id', id).eq('organization_id', organizationId).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.');
    const clientIndustryTypeId = (existing.clients as { industry_type_id?: string | null } | null)?.industry_type_id;
    let industryTypeId = clientIndustryTypeId;
    if (!industryTypeId && existing.lead_id) {
      const { data: lead, error: leadError } = await supabaseAdmin.from('leads').select('industry_type_id').eq('id', existing.lead_id).eq('organization_id', organizationId).maybeSingle();
      if (leadError) throw leadError;
      industryTypeId = lead?.industry_type_id ?? null;
    }
    assertRecordInScope(scope, industryTypeId, new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.'));
  }
  const update: Record<string, unknown> = { status: input.status };
  if (input.notes !== undefined) update.notes = input.notes;
  update.completed_at = input.status === 'completed' ? new Date().toISOString() : null;
  const { data, error } = await supabaseAdmin.from('follow_ups').update(update).eq('id', id).eq('organization_id', organizationId).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.');
  return data;
}
