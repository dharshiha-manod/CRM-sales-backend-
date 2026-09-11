import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';
const fail = (error: unknown): never => { throw error; };
const OVERDUE_DAYS = 3;
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

  const select = industryTypeId
    ? '*, clients!inner(client_code, client_name, industry_type_id), sales_representatives(employee_code, user_profiles(display_name))'
    : '*, clients(client_code, client_name), sales_representatives(employee_code, user_profiles(display_name))';
  let query = supabaseAdmin.from('follow_ups').select(select).eq('organization_id', organizationId).order('due_at').limit(100);
  if (representativeId) query = query.eq('representative_id', representativeId);
  if (industryTypeId) query = query.eq('clients.industry_type_id', industryTypeId);
  const { data, error } = await query;
  return error ? fail(error) : data;
}
export async function updateFollowUp(organizationId: string, id: string, input: { status: string; notes?: string | null }, scope?: IndustryScope) {
  if (scope) {
    const { data: existing, error: existingError } = await supabaseAdmin.from('follow_ups').select('id, clients(industry_type_id)').eq('id', id).eq('organization_id', organizationId).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.');
    const clientIndustryTypeId = (existing.clients as { industry_type_id?: string | null } | null)?.industry_type_id;
    assertRecordInScope(scope, clientIndustryTypeId, new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.'));
  }
  const update: Record<string, unknown> = { status: input.status };
  if (input.notes !== undefined) update.notes = input.notes;
  update.completed_at = input.status === 'completed' ? new Date().toISOString() : null;
  const { data, error } = await supabaseAdmin.from('follow_ups').update(update).eq('id', id).eq('organization_id', organizationId).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.');
  return data;
}
