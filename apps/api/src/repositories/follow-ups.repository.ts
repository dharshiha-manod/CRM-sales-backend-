import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import { loadSettingsSnapshot } from '../lib/settings.js';
import type { IndustryScope } from '../lib/industry-scope.js';
const fail = (error: unknown): never => { throw error; };
// OVERDUE_DAYS removed — this used to disagree with the Collections page's
// own overdue threshold (Step 4). Now both read the same Settings value.
const OUTCOME_LABELS: Record<string, string> = { connected: 'Connected', no_answer: 'No answer', promised_payment: 'Promised payment', visit_needed: 'Visit needed', not_interested: 'Not interested', other: 'Other' };
const TYPE_LABELS: Record<string, string> = { call: 'Call', visit: 'Visit', whatsapp: 'WhatsApp', email: 'Email', meeting: 'Meeting', other: 'Other' };
const istLabel = (value: string) => new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Writes a line on the lead's timeline. Best-effort: the follow-up action itself must never fail because of it. */
async function logLeadActivity(organizationId: string, leadId: string, actorId: string | null | undefined, note: string, statusChange?: { from: string; to: string }) {
  const { error } = await supabaseAdmin.from('lead_activities').insert({
    organization_id: organizationId,
    lead_id: leadId,
    activity_type: statusChange ? 'status_changed' : 'note_added',
    previous_status: statusChange?.from ?? null,
    new_status: statusChange?.to ?? null,
    note,
    actor_id: actorId ?? null,
  });
  if (error) console.error('[follow-up] could not write lead timeline entry', error);
}

export async function createFromVisit(organizationId: string, representativeId: string, visitId: string, input: { title: string; dueAt: string; priority: string; followUpType?: string; notes?: string | null }) {
  const { data: visit, error: visitError } = await supabaseAdmin.from('field_visits').select('id, client_id, status').eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).maybeSingle();
  if (visitError) fail(visitError); if (!visit?.client_id) throw new AppError(422, 'FOLLOW_UP_REQUIRES_CLIENT', 'A follow-up requires a visit linked to a client.');
  if (visit.status !== 'checked_out') throw new AppError(422, 'FOLLOW_UP_REQUIRES_COMPLETED_VISIT', 'Check out of the visit before scheduling a follow-up.');
  const { data, error } = await supabaseAdmin.from('follow_ups').insert({ organization_id: organizationId, representative_id: representativeId, client_id: visit.client_id, visit_id: visit.id, title: input.title, due_at: input.dueAt, priority: input.priority, follow_up_type: input.followUpType ?? 'visit', notes: input.notes }).select().single();
  return error ? fail(error) : data;
}
// Manual follow-up created directly from the admin UI — no field visit
// required. Used for reminders an admin/manager wants to schedule that
// don't originate from a rep's visit (e.g. "call this client next week").
export async function createManual(organizationId: string, input: { clientId: string; representativeId: string; title: string; dueAt: string; priority: string; followUpType?: string; notes?: string | null }) {
  const { data: client, error: clientError } = await supabaseAdmin.from('clients').select('id').eq('id', input.clientId).eq('organization_id', organizationId).maybeSingle();
  if (clientError) fail(clientError);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found in this organization.');
  // The representative must belong to this organization too.
  const { data: rep, error: repError } = await supabaseAdmin.from('sales_representatives').select('id').eq('id', input.representativeId).eq('organization_id', organizationId).maybeSingle();
  if (repError) fail(repError);
  if (!rep) throw new AppError(404, 'REPRESENTATIVE_NOT_FOUND', 'Representative not found in this organization.');
  if (new Date(input.dueAt).getTime() < Date.now() - 60000) throw new AppError(422, 'FOLLOW_UP_DATE_IN_PAST', 'The due date cannot be in the past.');

  const { data, error } = await supabaseAdmin.from('follow_ups').insert({ organization_id: organizationId, representative_id: input.representativeId, client_id: input.clientId, title: input.title, due_at: input.dueAt, priority: input.priority, follow_up_type: input.followUpType ?? 'call', notes: input.notes }).select('*, clients(client_code, client_name), sales_representatives(employee_code, user_profiles(display_name))').single();
  return error ? fail(error) : data;
}
// Follow-up raised from the Collections page against an overdue sales order.
// Reuses the order's own client and representative. If the order already has an
// open follow-up (the automatic "Payment overdue" one), that one is returned
// instead of creating a duplicate.
export async function createForOrder(organizationId: string, orderId: string, input: { title: string; dueAt: string; priority: string; followUpType?: string; notes?: string | null }, scope?: IndustryScope) {
  const { data: order, error: orderError } = await supabaseAdmin.from('sale_orders').select('id, client_id, representative_id, clients(industry_type_id)').eq('id', orderId).eq('organization_id', organizationId).maybeSingle();
  if (orderError) fail(orderError);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found in this organization.');
  if (scope) {
    const clientRow = order.clients as unknown as { industry_type_id?: string | null } | { industry_type_id?: string | null }[] | null;
    const orderIndustryTypeId = Array.isArray(clientRow) ? clientRow[0]?.industry_type_id : clientRow?.industry_type_id;
    assertRecordInScope(scope, orderIndustryTypeId, new AppError(404, 'ORDER_NOT_FOUND', 'Order not found in this organization.'));
  }
  const select = '*, clients(client_code, client_name), sales_representatives(employee_code, user_profiles(display_name))';
  const { data: existing, error: existingError } = await supabaseAdmin.from('follow_ups').select(select).eq('organization_id', organizationId).eq('sale_order_id', order.id).in('status', ['pending', 'in_progress']).limit(1).maybeSingle();
  if (existingError) fail(existingError);
  if (existing) return existing;
  const { data, error } = await supabaseAdmin.from('follow_ups').insert({ organization_id: organizationId, representative_id: order.representative_id, client_id: order.client_id, sale_order_id: order.id, title: input.title, due_at: input.dueAt, priority: input.priority, follow_up_type: input.followUpType ?? 'call', notes: input.notes ?? null }).select(select).single();
  return error ? fail(error) : data;
}
// Raises ONE automatic "Payment overdue" follow-up per confirmed sale order that is
// past the Collections overdue threshold and still has an outstanding balance.
// Rules:
//  - Once an order has ANY follow-up (open, completed or cancelled) it is never
//    auto-raised again, so completing the reminder actually closes it. If payment
//    still does not arrive, the rep reschedules it or raises another one manually
//    from the Collections page.
//  - Everything is read in batches (no per-order queries) so the follow-ups list
//    stays fast as orders grow.
// This codebase has no background job runner, so "automatic" means it runs when
// the follow-ups list is fetched.
async function syncOverdueCollectionFollowUps(organizationId: string) {
  // "Overdue alerts" (Follow-up Configuration) and the overdue threshold
  // (Collection Configuration) are PER-INDUSTRY settings, so every order is
  // judged by the rules of its own client's industry. One definition of
  // "overdue" per industry, shared with the Collections page.
  const dayMs = 24 * 60 * 60 * 1000;
  const snapshot = await loadSettingsSnapshot(organizationId);
  const rulesFor = (industryTypeId: string | null) => ({
    enabled: snapshot.followUp(industryTypeId).overdueAlerts,
    days: snapshot.collection(industryTypeId).overdueThresholdDays,
  });
  const activeRules = [null, ...snapshot.industryTypeIds].map(rulesFor).filter((rule) => rule.enabled);
  if (activeRules.length === 0) return; // Settings switched this feature off for every industry

  // Fetch from the shortest threshold in use, then re-check each order against its own industry's.
  const cutoff = new Date(Date.now() - Math.min(...activeRules.map((rule) => rule.days)) * dayMs).toISOString();
  const { data: candidateOrders, error: ordersError } = await supabaseAdmin.from('sale_orders').select('id, order_number, client_id, representative_id, total_amount, created_at, clients(industry_type_id)').eq('organization_id', organizationId).eq('status', 'confirmed').lte('created_at', cutoff);
  if (ordersError) { console.error('Overdue collection scan failed', ordersError); return; }
  const orders = (candidateOrders ?? []).filter((order) => {
    const related = (order as unknown as { clients?: unknown }).clients;
    const client = (Array.isArray(related) ? related[0] : related) as { industry_type_id?: string | null } | null | undefined;
    const rule = rulesFor(client?.industry_type_id ?? null);
    return rule.enabled && new Date(order.created_at).getTime() <= Date.now() - rule.days * dayMs;
  });
  if (orders.length === 0) return;

  const collectedByOrder = new Map<string, number>();
  const alreadyRaised = new Set<string>();
  const CHUNK = 100; // keeps the .in(...) URL short
  for (let i = 0; i < orders.length; i += CHUNK) {
    const ids = orders.slice(i, i + CHUNK).map((order) => order.id);
    const [collectionsRes, priorRes] = await Promise.all([
      supabaseAdmin.from('sales_collections').select('sale_order_id, amount').eq('organization_id', organizationId).in('sale_order_id', ids),
      supabaseAdmin.from('follow_ups').select('sale_order_id').eq('organization_id', organizationId).in('sale_order_id', ids),
    ]);
    if (collectionsRes.error || priorRes.error) { console.error('Overdue collection scan failed', collectionsRes.error ?? priorRes.error); return; }
    for (const row of collectionsRes.data ?? []) collectedByOrder.set(row.sale_order_id, (collectedByOrder.get(row.sale_order_id) ?? 0) + Number(row.amount));
    for (const row of priorRes.data ?? []) if (row.sale_order_id) alreadyRaised.add(row.sale_order_id);
  }

  const rows: Record<string, unknown>[] = [];
  for (const order of orders) {
    if (alreadyRaised.has(order.id)) continue;
    const outstanding = Number(order.total_amount) - (collectedByOrder.get(order.id) ?? 0);
    if (outstanding <= 0.00001) continue;
    const daysOverdue = Math.floor((Date.now() - new Date(order.created_at).getTime()) / (24 * 60 * 60 * 1000));
    rows.push({ organization_id: organizationId, representative_id: order.representative_id, client_id: order.client_id, sale_order_id: order.id, title: `Payment overdue: ${order.order_number}`, due_at: new Date().toISOString(), priority: 'high', follow_up_type: 'call', notes: `Outstanding balance ₹${outstanding.toFixed(2)} on order ${order.order_number}, confirmed ${daysOverdue} day(s) ago.` });
  }
  if (rows.length === 0) return;
  const { error: insertError } = await supabaseAdmin.from('follow_ups').insert(rows);
  if (insertError) console.error('Auto follow-up creation failed', insertError);
}
export async function listFollowUps(organizationId: string, representativeId?: string, industryTypeId?: string | null) {
  await syncOverdueCollectionFollowUps(organizationId);

  // Lead information is loaded separately. This deliberately keeps the
  // existing list endpoint compatible while the lead_id migration is rolled
  // out: PostgREST rejects an embedded relationship before that FK exists.
  // Do not use an inner client join for industry-scoped lists: lead-originated
  // follow-ups intentionally have no client_id. They are filtered below using
  // their linked lead's industry instead.
  // Open follow-ups are always loaded in full (up to 500) so old completed ones can never
  // push upcoming work off the list; only the most recent finished ones are included.
  const select = '*, clients(client_code, client_name, industry_type_id, industry_types(code)), sales_representatives(employee_code, user_profiles(display_name))';
  let openQuery = supabaseAdmin.from('follow_ups').select(select).eq('organization_id', organizationId).in('status', ['pending', 'in_progress']).order('due_at').limit(500);
  let closedQuery = supabaseAdmin.from('follow_ups').select(select).eq('organization_id', organizationId).in('status', ['completed', 'cancelled']).order('due_at', { ascending: false }).limit(150);
  if (representativeId) { openQuery = openQuery.eq('representative_id', representativeId); closedQuery = closedQuery.eq('representative_id', representativeId); }
  const [openRes, closedRes] = await Promise.all([openQuery, closedQuery]);
  if (openRes.error) fail(openRes.error);
  if (closedRes.error) fail(closedRes.error);
  const rows = [...(openRes.data ?? []), ...(closedRes.data ?? [])];
  const leadIds = rows.map((row) => (row as { lead_id?: string | null }).lead_id).filter((value): value is string => Boolean(value));
  const leadById = new Map<string, { id: string; lead_code: string | null; company_name: string | null; industry_type_id: string | null; notes: string | null }>();
  if (leadIds.length > 0) {
    const { data: leads, error: leadsError } = await supabaseAdmin.from('leads').select('id, lead_code, company_name, industry_type_id, notes').eq('organization_id', organizationId).in('id', leadIds);
    if (leadsError) fail(leadsError);
    // The lead's own note, without the packed FMCG metadata, so the follow-up can show it live (no copy to go stale).
    const stripMeta = (value: string | null) => { if (value == null) return null; const i = value.indexOf('<<<FMCG_META>>>'); return (i === -1 ? value : value.slice(0, i)).trim() || null; };
    for (const lead of leads ?? []) leadById.set(lead.id, { ...lead, notes: stripMeta(lead.notes) });
  }
  // How many times each follow-up's date was changed (history is in follow_up_reschedules).
  const rescheduleCount = new Map<string, number>();
  const rowIds = rows.map((row) => (row as { id: string }).id);
  for (let i = 0; i < rowIds.length; i += 100) {
    const { data: changes, error: changesError } = await supabaseAdmin.from('follow_up_reschedules').select('follow_up_id').eq('organization_id', organizationId).in('follow_up_id', rowIds.slice(i, i + 100));
    if (changesError) { console.error('Reschedule counts could not be loaded', changesError); break; }
    for (const change of changes ?? []) rescheduleCount.set(change.follow_up_id, (rescheduleCount.get(change.follow_up_id) ?? 0) + 1);
  }
  const enriched = rows.map((row) => {
    const leadId = (row as { lead_id?: string | null }).lead_id;
    const base = { ...row, reschedule_count: rescheduleCount.get((row as { id: string }).id) ?? 0 };
    return leadId ? { ...base, leads: leadById.get(leadId) ?? null } : base;
  });
  if (!industryTypeId) return enriched;
  return enriched.filter((row) => {
    const clientIndustryTypeId = (row.clients as { industry_type_id?: string | null } | null)?.industry_type_id;
    const leadIndustryTypeId = (row.leads as { industry_type_id?: string | null } | null)?.industry_type_id;
    return (clientIndustryTypeId ?? leadIndustryTypeId) === industryTypeId;
  });
}
export type FollowUpUpdateInput = { status: string; notes?: string | null; outcome?: string | null; completionNote?: string | null; nextDueAt?: string | null; nextType?: string | null };

/**
 * Moves a follow-up between statuses.
 *  - Completing requires an outcome; the outcome and an optional note are stored on
 *    the row (outcome / completion_note) and the original notes are left untouched.
 *  - Completing may also schedule the next follow-up (nextDueAt) for the same
 *    client / lead / order, so a rep never has to re-enter anything.
 */
export async function updateFollowUp(organizationId: string, id: string, input: FollowUpUpdateInput, scope?: IndustryScope, actorId?: string | null) {
  const { data: existing, error: existingError } = await supabaseAdmin.from('follow_ups').select('id, lead_id, client_id, representative_id, sale_order_id, title, priority, status, follow_up_type, clients(industry_type_id)').eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.');
  if (scope) {
    const clientIndustryTypeId = (existing.clients as unknown as { industry_type_id?: string | null } | null)?.industry_type_id;
    let industryTypeId = clientIndustryTypeId;
    if (!industryTypeId && existing.lead_id) {
      const { data: lead, error: leadError } = await supabaseAdmin.from('leads').select('industry_type_id').eq('id', existing.lead_id).eq('organization_id', organizationId).maybeSingle();
      if (leadError) throw leadError;
      industryTypeId = lead?.industry_type_id ?? null;
    }
    assertRecordInScope(scope, industryTypeId, new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.'));
  }

  const completing = input.status === 'completed';
  if (completing && !input.outcome) throw new AppError(422, 'FOLLOW_UP_OUTCOME_REQUIRED', 'Choose an outcome before completing this follow-up.');
  if (input.nextDueAt) {
    if (!completing) throw new AppError(422, 'NEXT_FOLLOW_UP_REQUIRES_COMPLETION', 'A next follow-up can only be scheduled while completing this one.');
    if (new Date(input.nextDueAt).getTime() <= Date.now()) throw new AppError(422, 'NEXT_FOLLOW_UP_IN_PAST', 'Pick a next follow-up date in the future.');
  }

  const update: Record<string, unknown> = { status: input.status };
  if (input.notes !== undefined) update.notes = input.notes;
  update.completed_at = completing ? new Date().toISOString() : null;
  update.outcome = completing ? input.outcome : null;
  update.completion_note = completing ? (input.completionNote?.trim() || null) : null;
  const { data, error } = await supabaseAdmin.from('follow_ups').update(update).eq('id', id).eq('organization_id', organizationId).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.');

  // A lead's follow-up and the lead's own "next follow-up" date are the same thing: once the rep has
  // done it (or cancelled it) the lead's date becomes the NEXT one, or empty. This also stops the
  // old date from re-creating the follow-up the next time the lead is edited.
  if ((completing || input.status === 'cancelled') && existing.lead_id && existing.status !== input.status) {
    const { error: leadDateError } = await supabaseAdmin.from('leads').update({ next_action_due_at: completing ? (input.nextDueAt ?? null) : null }).eq('id', existing.lead_id).eq('organization_id', organizationId).neq('status', 'converted');
    if (leadDateError) console.error('Lead next-follow-up date could not be updated', leadDateError);
  }

  // Lead timeline + pipeline: what happened on the follow-up must be visible on the lead, and a real
  // conversation ("connected") moves a brand-new lead to Contacted. Cancelling / completing on its own
  // never changes the lead's status otherwise — that stays a deliberate user decision.
  if (existing.lead_id && existing.status !== input.status && (completing || input.status === 'cancelled')) {
    const kind = TYPE_LABELS[existing.follow_up_type ?? 'call'] ?? 'Follow-up';
    if (completing) {
      const parts = [`${kind} follow-up completed — ${OUTCOME_LABELS[input.outcome ?? ''] ?? input.outcome}`];
      if (input.completionNote?.trim()) parts.push(input.completionNote.trim());
      if (input.nextDueAt) parts.push(`Next follow-up: ${istLabel(input.nextDueAt)}`);
      await logLeadActivity(organizationId, existing.lead_id, actorId, parts.join('. '));
      if (input.outcome === 'connected') {
        const { data: moved, error: moveError } = await supabaseAdmin.from('leads').update({ status: 'contacted' }).eq('id', existing.lead_id).eq('organization_id', organizationId).eq('status', 'new').select('id').maybeSingle();
        if (moveError) console.error('[follow-up] could not move lead to contacted', moveError);
        else if (moved) await logLeadActivity(organizationId, existing.lead_id, actorId, 'Moved to Contacted automatically after a connected follow-up.', { from: 'new', to: 'contacted' });
      }
    } else {
      await logLeadActivity(organizationId, existing.lead_id, actorId, `${kind} follow-up cancelled.`);
    }
  }

  // Only when this call actually closes it (a repeated "complete" must not create another one).
  if (completing && input.nextDueAt && existing.status !== 'completed') {
    const { error: nextError } = await supabaseAdmin.from('follow_ups').insert({ organization_id: organizationId, representative_id: existing.representative_id, client_id: existing.client_id, lead_id: existing.lead_id, sale_order_id: existing.sale_order_id, title: existing.title, due_at: input.nextDueAt, priority: existing.priority, follow_up_type: input.nextType ?? existing.follow_up_type ?? 'call', previous_follow_up_id: existing.id });
    if (nextError) { console.error('Next follow-up could not be created', nextError); throw new AppError(500, 'NEXT_FOLLOW_UP_FAILED', 'The follow-up was completed, but the next one could not be created. Please add it manually.'); }
  }
  return data;
}
async function assertFollowUpInScope(organizationId: string, id: string, scope?: IndustryScope) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('follow_ups')
    .select('id, lead_id, status, due_at, clients(industry_type_id)')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.');
  if (scope) {
    const clientIndustryTypeId = (existing.clients as { industry_type_id?: string | null } | null)?.industry_type_id;
    let industryTypeId = clientIndustryTypeId;
    if (!industryTypeId && existing.lead_id) {
      const { data: lead, error: leadError } = await supabaseAdmin.from('leads').select('industry_type_id').eq('id', existing.lead_id).eq('organization_id', organizationId).maybeSingle();
      if (leadError) throw leadError;
      industryTypeId = lead?.industry_type_id ?? null;
    }
    assertRecordInScope(scope, industryTypeId, new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.'));
  }
  return existing as unknown as { id: string; lead_id: string | null; status: string; due_at: string };
}

/** Changes the due date of an open follow-up and records who/when/why in follow_up_reschedules. */
export async function rescheduleFollowUp(
  organizationId: string,
  id: string,
  input: { dueAt: string; reason: string },
  actorId: string | null,
  scope?: IndustryScope,
) {
  const existing = await assertFollowUpInScope(organizationId, id, scope);
  if (['completed', 'cancelled'].includes(existing.status)) {
    throw new AppError(409, 'FOLLOW_UP_CLOSED', 'A completed or cancelled follow-up cannot be rescheduled.');
  }
  if (new Date(input.dueAt).getTime() === new Date(existing.due_at).getTime()) {
    throw new AppError(400, 'FOLLOW_UP_DATE_UNCHANGED', 'The new date is the same as the current due date.');
  }
  const { data, error } = await supabaseAdmin.from('follow_ups').update({ due_at: input.dueAt }).eq('id', id).eq('organization_id', organizationId).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found in this organization.');

  // History is an audit trail: a failure here is logged but never blocks the reschedule itself.
  const { error: historyError } = await supabaseAdmin.from('follow_up_reschedules').insert({
    organization_id: organizationId,
    follow_up_id: id,
    old_due_at: existing.due_at,
    new_due_at: input.dueAt,
    reason: input.reason.trim(),
    changed_by: actorId,
  });
  if (historyError) console.error('Follow-up reschedule history could not be saved', historyError);

  if (existing.lead_id) await logLeadActivity(organizationId, existing.lead_id, actorId, `Follow-up rescheduled from ${istLabel(existing.due_at)} to ${istLabel(input.dueAt)}. Reason: ${input.reason.trim()}`);

  // Keep the originating lead's own date in step (open leads only; a converted lead is finished).
  if (existing.lead_id) {
    const { error: leadError } = await supabaseAdmin.from('leads').update({ next_action_due_at: input.dueAt }).eq('id', existing.lead_id).eq('organization_id', organizationId).neq('status', 'converted');
    if (leadError) console.error('Lead next-action date could not be synced', leadError);
  }
  return data;
}

export async function listFollowUpReschedules(organizationId: string, id: string, scope?: IndustryScope) {
  await assertFollowUpInScope(organizationId, id, scope);
  const { data, error } = await supabaseAdmin
    .from('follow_up_reschedules')
    .select('id, old_due_at, new_due_at, reason, created_at, changed_by')
    .eq('organization_id', organizationId)
    .eq('follow_up_id', id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ── Rep-side actions: a representative may only act on follow-ups assigned to them ──
async function assertOwnFollowUp(organizationId: string, representativeId: string, id: string) {
  const { data, error } = await supabaseAdmin.from('follow_ups').select('id').eq('id', id).eq('organization_id', organizationId).eq('representative_id', representativeId).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found.');
}
export async function updateOwnFollowUp(organizationId: string, representativeId: string, id: string, input: FollowUpUpdateInput, actorId?: string | null) {
  await assertOwnFollowUp(organizationId, representativeId, id);
  return updateFollowUp(organizationId, id, input, undefined, actorId);
}
export async function rescheduleOwnFollowUp(organizationId: string, representativeId: string, id: string, input: { dueAt: string; reason: string }, actorId: string | null) {
  await assertOwnFollowUp(organizationId, representativeId, id);
  return rescheduleFollowUp(organizationId, id, input, actorId);
}