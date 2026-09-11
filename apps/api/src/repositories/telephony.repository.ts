// NEW
import { supabaseAdmin } from '../lib/supabase.js';

export async function listCalls(organizationId: string, industryTypeId?: string | null) {
  const select = industryTypeId
    ? '*, clients!inner(client_name, industry_type_id), sales_representatives(employee_code, user_profiles(display_name))'
    : '*, clients(client_name), sales_representatives(employee_code, user_profiles(display_name))';
  let query = supabaseAdmin.from('telephony_calls').select(select).eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100);
  if (industryTypeId) query = query.eq('clients.industry_type_id', industryTypeId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// --- everything below this line is NEW, added for the real-time Call & IVR upgrade ---

export async function getCallById(organizationId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from('telephony_calls')
    .select('*, clients(client_code, client_name), leads(id, lead_code, company_name), sales_representatives(employee_code, user_profiles(display_name))')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// One row per provider_call_id: the first webhook (e.g. "ringing") inserts
// the row, every later webhook for the SAME call (e.g. "completed") updates
// that same row instead of creating a second one.
export async function upsertCallByProviderId(
  organizationId: string,
  input: {
    provider: string;
    providerCallId: string;
    direction: 'inbound' | 'outbound';
    status: string;
    phoneNumber: string;
    fromNumber: string;
    toNumber: string;
    durationSeconds?: number;
    recordingUrl?: string;
    ivrMenuPath?: string;
    startedAt?: string;
    clientId?: string | null;
    leadId?: string | null;
    representativeId?: string | null;
    rawEvent: Record<string, unknown>;
  },
) {
  const existing = await supabaseAdmin
    .from('telephony_calls')
    .select('id, raw_events')
    .eq('organization_id', organizationId)
    .eq('provider', input.provider)
    .eq('provider_call_id', input.providerCallId)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const rawEvents = Array.isArray(existing.data?.raw_events) ? existing.data!.raw_events : [];
  const payload = {
    organization_id: organizationId,
    provider: input.provider,
    provider_call_id: input.providerCallId,
    direction: input.direction,
    status: input.status,
    phone_number: input.phoneNumber,
    from_number: input.fromNumber,
    to_number: input.toNumber,
    ...(input.durationSeconds !== undefined ? { duration_seconds: input.durationSeconds } : {}),
    ...(input.recordingUrl ? { recording_url: input.recordingUrl } : {}),
    ...(input.ivrMenuPath ? { ivr_menu_path: input.ivrMenuPath } : {}),
    ...(input.startedAt ? { started_at: input.startedAt } : {}),
    ...(input.clientId !== undefined ? { client_id: input.clientId } : {}),
    ...(input.leadId !== undefined ? { lead_id: input.leadId } : {}),
    ...(input.representativeId !== undefined ? { representative_id: input.representativeId } : {}),
    raw_events: [...rawEvents, { at: new Date().toISOString(), ...input.rawEvent }],
  };

  if (existing.data) {
    const { data, error } = await supabaseAdmin.from('telephony_calls').update(payload).eq('id', existing.data.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabaseAdmin.from('telephony_calls').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function addCallNote(organizationId: string, id: string, notes: string, outcome?: string) {
  const { data, error } = await supabaseAdmin
    .from('telephony_calls')
    .update({ notes, ...(outcome ? { outcome } : {}) })
    .eq('organization_id', organizationId)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function linkCallToLead(organizationId: string, id: string, leadId: string) {
  const { data, error } = await supabaseAdmin.from('telephony_calls').update({ lead_id: leadId }).eq('organization_id', organizationId).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data;
}

// Phone matching: look for an existing Client first (they're already a
// customer), then an existing Lead. Both reads are read-only — this never
// writes to clients/leads directly; only telephony.service.ts decides
// whether to create a new lead, and it does that through the real
// leads.repository.createLead() function so all existing dedupe/scoring
// logic is reused untouched.
export async function findClientByPhone(organizationId: string, phone: string) {
  const { data, error } = await supabaseAdmin.from('clients').select('id, client_code, client_name, industry_type_id').eq('organization_id', organizationId).eq('phone', phone).maybeSingle();
  if (error) throw error;
  return data;
}

export async function findLeadByPhone(organizationId: string, phone: string) {
  const { data, error } = await supabaseAdmin.from('leads').select('id, lead_code, company_name, industry_type_id, representative_id').eq('organization_id', organizationId).eq('phone', phone).maybeSingle();
  if (error) throw error;
  return data;
}
