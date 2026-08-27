import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
const fail = (error: unknown): never => { throw error; };
export async function createFromVisit(organizationId: string, representativeId: string, visitId: string, input: { title: string; dueAt: string; priority: string; notes?: string | null }) {
  const { data: visit, error: visitError } = await supabaseAdmin.from('field_visits').select('id, client_id, status').eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).maybeSingle();
  if (visitError) fail(visitError); if (!visit?.client_id) throw new AppError(422, 'FOLLOW_UP_REQUIRES_CLIENT', 'A follow-up requires a visit linked to a client.');
  if (visit.status !== 'checked_out') throw new AppError(422, 'FOLLOW_UP_REQUIRES_COMPLETED_VISIT', 'Check out of the visit before scheduling a follow-up.');
  const { data, error } = await supabaseAdmin.from('follow_ups').insert({ organization_id: organizationId, representative_id: representativeId, client_id: visit.client_id, visit_id: visit.id, title: input.title, due_at: input.dueAt, priority: input.priority, notes: input.notes }).select().single();
  return error ? fail(error) : data;
}
export async function listFollowUps(organizationId: string, representativeId?: string) { let query = supabaseAdmin.from('follow_ups').select('*, clients(client_name), sales_representatives(employee_code, user_profiles(display_name))').eq('organization_id', organizationId).order('due_at').limit(100); if (representativeId) query = query.eq('representative_id', representativeId); const { data, error } = await query; return error ? fail(error) : data; }
export async function updateFollowUp(organizationId: string, id: string, input: { status: string; notes?: string | null }) {
  const update: Record<string, unknown> = { status: input.status };
  if (input.notes !== undefined) update.notes = input.notes;
  update.completed_at = input.status === 'completed' ? new Date().toISOString() : null;
  const { data, error } = await supabaseAdmin.from('follow_ups').update(update).eq('id', id).eq('organization_id', organizationId).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.');
  return data;
}
