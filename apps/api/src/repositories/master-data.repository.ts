import { supabaseAdmin } from '../lib/supabase.js';
import { AppError } from '../errors/app-error.js';
const fail = (error: unknown): never => { throw error; };
export async function listRepresentatives(org: string, search?: string, status?: string, industryTypeId?: string) { let q = supabaseAdmin.from('sales_representatives').select(industryTypeId ? '*, user_profiles(display_name), sales_representative_industry_types!inner(industry_type_id)' : '*, user_profiles(display_name)').eq('organization_id', org).order('employee_code'); if (status) q = q.eq('status', status); if (industryTypeId) q = q.eq('sales_representative_industry_types.industry_type_id', industryTypeId); if (search) q = q.or(`employee_code.ilike.%${search}%,email.ilike.%${search}%,designation.ilike.%${search}%`); const { data, error } = await q; return error ? fail(error) : data; }
export async function getRepresentative(org: string, id: string) { const { data, error } = await supabaseAdmin.from('sales_representatives').select('*, user_profiles(display_name)').eq('organization_id', org).eq('id', id).maybeSingle(); if (error) fail(error); if (!data) throw new AppError(404, 'REPRESENTATIVE_NOT_FOUND', 'Sales representative was not found'); return data; }
export async function createRepresentative(org: string, input: Record<string, unknown>) { const { data, error } = await supabaseAdmin.from('sales_representatives').insert({ organization_id: org, user_id: input.userId, employee_code: input.employeeCode, phone: input.phone, email: input.email, designation: input.designation, joining_date: input.joiningDate, status: input.status }).select().single(); return error ? fail(error) : data; }
export async function updateRepresentative(org: string, id: string, input: Record<string, unknown>) { const map = { employeeCode: 'employee_code', joiningDate: 'joining_date' } as Record<string, string>; const payload = Object.fromEntries(Object.entries(input).map(([key, value]) => [map[key] ?? key, value])); const { data, error } = await supabaseAdmin.from('sales_representatives').update(payload).eq('organization_id', org).eq('id', id).select().maybeSingle(); if (error) fail(error); if (!data) throw new AppError(404, 'REPRESENTATIVE_NOT_FOUND', 'Sales representative was not found'); return data; }
export async function assertRepresentativeUserMembership(org: string, userId: string) { const { data, error } = await supabaseAdmin.from('organization_memberships').select('roles!inner(code)').eq('organization_id', org).eq('user_id', userId).eq('status', 'active').maybeSingle(); if (error) fail(error); if ((data?.roles as unknown as { code?: string } | null)?.code !== 'sales_representative') throw new AppError(422, 'REPRESENTATIVE_MEMBERSHIP_REQUIRED', 'User must have an active sales representative membership in this organization'); }

export async function listClients(org: string, search?: string, type?: string, status?: string, industryTypeId?: string) { let q = supabaseAdmin.from('clients').select('*, industry_types(id, code, name), client_contacts(*), sales_representative_client_assignments(id, status, sales_representative_id)').eq('organization_id', org).order('client_name'); if (type) q = q.eq('client_type', type); if (status) q = q.eq('status', status); if (industryTypeId) q = q.eq('industry_type_id', industryTypeId); if (search) q = q.or(`client_code.ilike.%${search}%,client_name.ilike.%${search}%`); const { data, error } = await q; return error ? fail(error) : data; }
export async function getClient(org: string, id: string) { const { data, error } = await supabaseAdmin.from('clients').select('*, industry_types(id, code, name), client_contacts(*), sales_representative_client_assignments(id,status,notes,assigned_at,sales_representatives(id,employee_code,designation,user_profiles(display_name)))').eq('organization_id', org).eq('id', id).maybeSingle(); if (error) fail(error); if (!data) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client was not found'); return data; }
const clientColumnMap = { clientCode: 'client_code', clientName: 'client_name', clientType: 'client_type', postalCode: 'postal_code', gpsRadiusMeters: 'gps_radius_meters', industryTypeId: 'industry_type_id', outletType: 'outlet_type', creditLimit: 'credit_limit', creditDays: 'credit_days', industryDetails: 'industry_details', currentStage: 'current_stage' } as Record<string, string>;
// NEW — distinguish which column actually collided, and wrap non-unique-
// violation errors as AppErrors so their real message reaches the UI
// instead of a generic "unexpected error occurred".
function clientConflictError(error: { code?: string; message?: string; details?: string }): AppError {
  if (error.code === '23505') {
    const detail = error.details ?? error.message ?? '';
    if (detail.includes('gstin')) return new AppError(409, 'GSTIN_TAKEN', 'A client with this GSTIN already exists.');
    if (detail.includes('pan')) return new AppError(409, 'PAN_TAKEN', 'A client with this PAN already exists.');
    return new AppError(409, 'CLIENT_CODE_TAKEN', 'A client with this code already exists.');
  }
  return new AppError(500, 'CLIENT_SAVE_FAILED', error.message ?? 'Unable to save client.');
}
export async function createClient(org: string, input: Record<string, unknown>) { const payload = Object.fromEntries(Object.entries(input).map(([key, value]) => [clientColumnMap[key] ?? key, value])); const { data, error } = await supabaseAdmin.from('clients').insert({ ...payload, organization_id: org }).select().single(); if (error) throw clientConflictError(error as { code?: string; message?: string; details?: string }); return data; }
export async function updateClient(org: string, id: string, input: Record<string, unknown>) { const payload = Object.fromEntries(Object.entries(input).map(([key, value]) => [clientColumnMap[key] ?? key, value])); const { data, error } = await supabaseAdmin.from('clients').update(payload).eq('organization_id', org).eq('id', id).select().maybeSingle(); if (error) throw clientConflictError(error as { code?: string; message?: string; details?: string }); if (!data) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client was not found'); return data; }
export async function syncClientAddressFromLead(org: string, clientId: string) {
  // A client links back to its source through leads.converted_client_id.
  // Select the original conversion if historical data contains multiple links.
  const { data: lead, error: leadError } = await supabaseAdmin
    .from('leads')
    .select('street_address, city, state')
    .eq('organization_id', org)
    .eq('converted_client_id', clientId)
    .order('converted_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (leadError) fail(leadError);
  if (!lead) throw new AppError(404, 'SOURCE_LEAD_NOT_FOUND', 'This client is not linked to a converted lead.');

  return updateClient(org, clientId, {
    address: [lead.street_address, lead.city, lead.state].filter(Boolean).join(', ') || null,
    city: lead.city,
    state: lead.state,
  });
}
export async function clientAddressSyncStatus(
  org: string,
  clientId: string,
  client: { address?: string | null; city?: string | null; state?: string | null },
) {
  const { data: lead, error } = await supabaseAdmin
    .from('leads')
    .select('street_address, city, state')
    .eq('organization_id', org)
    .eq('converted_client_id', clientId)
    .order('converted_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) fail(error);
  if (!lead) return { linked: false, differs: false };

  const normalize = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const sourceAddress = [lead.street_address, lead.city, lead.state].filter(Boolean).join(', ');
  return {
    linked: true,
    differs: normalize(client.address) !== normalize(sourceAddress)
      || normalize(client.city) !== normalize(lead.city)
      || normalize(client.state) !== normalize(lead.state),
  };
}
export async function listContacts(org: string, clientId: string) { await getClient(org, clientId); const { data, error } = await supabaseAdmin.from('client_contacts').select('*').eq('organization_id', org).eq('client_id', clientId).order('is_primary', { ascending: false }).order('name'); return error ? fail(error) : data; }
export async function createContact(org: string, clientId: string, input: Record<string, unknown>) { const { data, error } = await supabaseAdmin.from('client_contacts').insert({ organization_id: org, client_id: clientId, name: input.name, designation: input.designation, department: input.department, phone: input.phone, alternate_phone: input.alternatePhone, email: input.email, is_primary: input.isPrimary, notes: input.notes }).select().single(); return error ? fail(error) : data; }
export async function updateContact(org: string, clientId: string, contactId: string, input: Record<string, unknown>) { const map = { alternatePhone: 'alternate_phone', isPrimary: 'is_primary' } as Record<string, string>; const payload = Object.fromEntries(Object.entries(input).map(([key, value]) => [map[key] ?? key, value])); const { data, error } = await supabaseAdmin.from('client_contacts').update(payload).eq('organization_id', org).eq('client_id', clientId).eq('id', contactId).select().maybeSingle(); if (error) fail(error); if (!data) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Client contact was not found'); return data; }
export async function deleteContact(org: string, clientId: string, contactId: string) { const { data, error } = await supabaseAdmin.from('client_contacts').delete().eq('organization_id', org).eq('client_id', clientId).eq('id', contactId).select('id').maybeSingle(); if (error) fail(error); if (!data) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Client contact was not found'); }
export async function listAssignedClients(org: string, repId: string) { await getRepresentative(org, repId); const { data, error } = await supabaseAdmin.from('sales_representative_client_assignments').select('*, clients(*)').eq('organization_id', org).eq('sales_representative_id', repId).eq('status', 'active').order('assigned_at', { ascending: false }); return error ? fail(error) : data; }
export async function assignClient(org: string, repId: string, clientId: string, notes?: string | null) { await Promise.all([getRepresentative(org, repId), getClient(org, clientId)]); const { data, error } = await supabaseAdmin.from('sales_representative_client_assignments').upsert({ organization_id: org, sales_representative_id: repId, client_id: clientId, status: 'active', notes }, { onConflict: 'organization_id,sales_representative_id,client_id' }).select().single(); return error ? fail(error) : data; }
export async function unassignClient(org: string, repId: string, clientId: string) { const { data, error } = await supabaseAdmin.from('sales_representative_client_assignments').update({ status: 'inactive' }).eq('organization_id', org).eq('sales_representative_id', repId).eq('client_id', clientId).eq('status', 'active').select('id').maybeSingle(); if (error) fail(error); if (!data) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Active assignment was not found'); }
