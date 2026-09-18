import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { createRequirement } from './requirements.repository.js';
import { createFromRequirement } from './quotations.repository.js';
import { listProducts } from './products.repository.js';

const fail = (error: unknown): never => {
  throw error;
};

// Mirrors admin/src/components/leadpage.tsx's FMCG_META_MARKER exactly —
// the "extra" lead fields (customer type, interested product, expected
// value, next follow-up) are packed as JSON behind this marker inside the
// `notes` column instead of living in real columns. See that file's
// comment for why. Server-side auto-conversion needs to read the same
// packed data, so this constant and parser must stay identical to the
// frontend's.
const LEAD_META_MARKER = '<<<FMCG_META>>>';
type LeadMeta = {
  areaRoute?: string;
  shopType?: string;
  customerType?: string;
  interestedProduct?: string;
  expectedOrderValue?: string;
  nextFollowUp?: string;
};
function parseLeadMeta(notes?: string | null): LeadMeta {
  if (!notes) return {};
  const idx = notes.indexOf(LEAD_META_MARKER);
  if (idx === -1) return {};
  try {
    return JSON.parse(notes.slice(idx + LEAD_META_MARKER.length)) as LeadMeta;
  } catch {
    return {};
  }
}

/**
 * Fires the moment a lead's status becomes "qualified" — called from
 * changeLeadStatus below, no matter which caller (admin web, mobile rep
 * app, IVR, a future integration) triggered the status change. This is
 * the server-side replacement for the automation that used to live only
 * in the admin frontend's changeStatus() handler.
 *
 * Chain: Client -> Requirement -> (best-effort) Quotation. Every step is
 * best-effort and logged to lead_activities on failure; a failure at any
 * step never throws back to the caller and never blocks the status
 * change itself — the lead simply stays "qualified" with whatever prefix
 * of the chain succeeded, and the rest can be finished manually from the
 * existing "Convert to client" / Requirements / Quotations screens.
 */
async function autoConvertQualifiedLead(organizationId: string, lead: Record<string, any>, actorId: string) {
  const meta = parseLeadMeta(lead.notes);
  const clientCode = `CLI-${String(lead.lead_code).replace(/^LD-/, '')}`;

  let clientId: string | undefined;
  try {
    const converted = await convertLeadToClient(organizationId, lead.id, actorId, {
      clientCode,
      clientType: meta.customerType || 'retailer',
      address: [lead.street_address, lead.city, lead.state].filter(Boolean).join(', ') || null,
    });
    clientId = (converted as any).converted_client_id ?? (converted as any).clients?.id;
  } catch (err) {
    await supabaseAdmin.from('lead_activities').insert({
      organization_id: organizationId,
      lead_id: lead.id,
      activity_type: 'note_added',
      note: `Auto-convert to client failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      actor_id: actorId,
    });
    return;
  }
  // No representative assigned — leave it converted to a client only;
  // requirement/quotation need a rep to own them.
  if (!clientId || !lead.representative_id) return;

  const interested = meta.interestedProduct?.trim();
  let matchedProduct: { id: string; selling_price: number } | undefined;
  if (interested) {
    const products = await listProducts(organizationId, undefined, 'active', lead.industry_type_id ?? undefined);
    matchedProduct = (products ?? []).find(
      (p: any) =>
        p.product_name.toLowerCase().includes(interested.toLowerCase()) ||
        interested.toLowerCase().includes(p.product_name.toLowerCase()),
    );
  }
  const expectedValue = Number(meta.expectedOrderValue) || 0;
  const quantity = matchedProduct && matchedProduct.selling_price > 0 ? Math.max(1, Math.round(expectedValue / matchedProduct.selling_price)) : 1;

  let requirement;
  try {
    requirement = await createRequirement(organizationId, lead.representative_id, {
      clientId,
      title: `Requirement — ${interested || lead.company_name}`,
      description: `Auto-created when lead ${lead.lead_code} was qualified.`,
      urgency: lead.priority === 'critical' || lead.priority === 'high' ? 'high' : 'normal',
      targetDate: meta.nextFollowUp || null,
      items: [
        matchedProduct
          ? { productId: matchedProduct.id, quantity, notes: `Auto-matched from lead's "${interested}"` }
          : { freeTextItem: interested || 'General requirement', quantity: 1, notes: 'No catalog product matched automatically — pick the exact product to enable quoting.' },
      ],
    });
  } catch (err) {
    await supabaseAdmin.from('lead_activities').insert({
      organization_id: organizationId,
      lead_id: lead.id,
      activity_type: 'note_added',
      note: `Auto-create requirement failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      actor_id: actorId,
    });
    return;
  }

  if (matchedProduct) {
    try {
      await createFromRequirement(organizationId, lead.representative_id, requirement.id, {
        items: [{ productId: matchedProduct.id, quantity, discountPercent: 0 }],
        notes: 'Auto-generated when lead was qualified.',
      });
    } catch (err) {
      await supabaseAdmin.from('lead_activities').insert({
        organization_id: organizationId,
        lead_id: lead.id,
        activity_type: 'note_added',
        note: `Auto-create quotation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        actor_id: actorId,
      });
    }
  }
}

const SELECT_WITH_RELATIONS =
  '*, industry_types(id, code, name), sales_representatives(id, employee_code, user_profiles(display_name)), clients(id, client_code, client_name)';

type LeadInput = {
  leadCode?: string;
  industryTypeId?: string;
  representativeId?: string | null;
  companyName?: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  source?: string;
  priority?: string;
  score?: number;
  notes?: string | null;
  nextAction?: string | null;
  nextActionDueAt?: string | null;
};

const columnMap: Record<string, string> = {
  leadCode: 'lead_code',
  industryTypeId: 'industry_type_id',
  representativeId: 'representative_id',
  companyName: 'company_name',
  contactName: 'contact_name',
  streetAddress: 'street_address',
  nextAction: 'next_action',
  nextActionDueAt: 'next_action_due_at',
};  
// Postgres text columns reject the null byte (\u0000) — code 22P05. Strip it
// from any string value before it reaches the DB, since it can silently ride
// along from copy-paste, browser autofill, or IME input and there's no valid
// reason a lead field would ever need it.
function stripNullBytes<T>(value: T): T {
  return typeof value === 'string' ? (value.replace(/\u0000/g, '') as unknown as T) : value;
}
function toColumns(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [columnMap[key] ?? key, stripNullBytes(value)]));
}

/**
 * Returns the industry_type_ids a representative is allowed to see. An
 * explicit empty array means the representative has no industry
 * assignments and therefore cannot see any leads -- callers must not treat
 * an empty array as "unrestricted".
 */
export async function representativeIndustryTypeIds(organizationId: string, representativeId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('sales_representative_industry_types')
    .select('industry_type_id')
    .eq('organization_id', organizationId)
    .eq('sales_representative_id', representativeId);
  return error ? fail(error) : (data ?? []).map((row) => row.industry_type_id as string);
}

/**
 * Auto-assignment helper: among representatives assigned to this industry
 * type, picks whichever currently has the fewest open (not converted/lost)
 * leads. Returns null if no representative is assigned to the industry.
 */
export async function suggestRepresentativeForIndustry(organizationId: string, industryTypeId: string): Promise<{ id: string } | null> {
  const { data: assignments, error: assignmentsError } = await supabaseAdmin
    .from('sales_representative_industry_types')
    .select('sales_representative_id')
    .eq('organization_id', organizationId)
    .eq('industry_type_id', industryTypeId);
  if (assignmentsError) fail(assignmentsError);

  const representativeIds = [...new Set((assignments ?? []).map((row) => row.sales_representative_id as string))];
  if (representativeIds.length === 0) return null;
  if (representativeIds.length === 1) return { id: representativeIds[0] };

  const { data: openLeads, error: leadsError } = await supabaseAdmin
    .from('leads')
    .select('representative_id')
    .eq('organization_id', organizationId)
    .in('representative_id', representativeIds)
    .not('status', 'in', '(converted,lost)');
  if (leadsError) fail(leadsError);

  const loadByRep = new Map<string, number>(representativeIds.map((id) => [id, 0]));
  for (const row of openLeads ?? []) {
    const repId = row.representative_id as string | null;
    if (repId && loadByRep.has(repId)) loadByRep.set(repId, (loadByRep.get(repId) ?? 0) + 1);
  }

  const [leastLoadedId] = [...loadByRep.entries()].sort((a, b) => a[1] - b[1])[0];
  return { id: leastLoadedId };
}

export async function listRepresentativeIndustryTypes(organizationId: string, representativeId: string) {
  const { data, error } = await supabaseAdmin
    .from('sales_representative_industry_types')
    .select('id, industry_type_id, industry_types(id, code, name, status)')
    .eq('organization_id', organizationId)
    .eq('sales_representative_id', representativeId);
  return error ? fail(error) : (data ?? []);
}

export async function assignRepresentativeIndustryType(organizationId: string, representativeId: string, industryTypeId: string) {
  const { data, error } = await supabaseAdmin
    .from('sales_representative_industry_types')
    .upsert(
      { organization_id: organizationId, sales_representative_id: representativeId, industry_type_id: industryTypeId },
      { onConflict: 'organization_id,sales_representative_id,industry_type_id' },
    )
    .select()
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23503') throw new AppError(400, 'INVALID_INDUSTRY_TYPE', 'Representative or industry type was not found for this organization.');
    fail(error);
  }
  return data;
}

export async function unassignRepresentativeIndustryType(organizationId: string, representativeId: string, industryTypeId: string) {
  const { data, error } = await supabaseAdmin
    .from('sales_representative_industry_types')
    .delete()
    .eq('organization_id', organizationId)
    .eq('sales_representative_id', representativeId)
    .eq('industry_type_id', industryTypeId)
    .select('id')
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Representative is not assigned to this industry type.');
}

export async function findDuplicateLeads(organizationId: string, input: { phone?: string | null; email?: string | null; companyName?: string | null }) {
  const filters: string[] = [];
  if (input.phone) filters.push(`phone.eq.${input.phone}`);
  if (input.email) filters.push(`email.ilike.${input.email}`);
  if (filters.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, lead_code, company_name, phone, email, status, created_at')
    .eq('organization_id', organizationId)
    .or(filters.join(','))
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) fail(error);
  const companyNormalized = input.companyName?.trim().toLowerCase();
  const rows = data ?? [];
  if (companyNormalized) {
    const nameMatches = rows.filter((row) => row.company_name?.trim().toLowerCase() === companyNormalized);
    const others = rows.filter((row) => !nameMatches.includes(row));
    return [...nameMatches, ...others];
  }
  return rows;
}

export async function createLead(
  organizationId: string,
  createdBy: string,
  // leadCode is intentionally optional here -- the DB trigger auto-generates
  // it when omitted (Automatic Lead ID).
  input: LeadInput & Required<Pick<LeadInput, 'industryTypeId' | 'companyName' | 'source' | 'priority'>>,
) {
    
  const duplicates = await findDuplicateLeads(organizationId, { phone: input.phone, email: input.email, companyName: input.companyName });
  const exactDuplicate = duplicates.find(
    (row) => (input.phone && row.phone === input.phone) || (input.email && row.email?.toLowerCase() === input.email?.toLowerCase()),
  );
  if (exactDuplicate) {
    throw new AppError(409, 'DUPLICATE_LEAD', 'A lead with this phone number or email already exists.', {
      duplicateLeadId: exactDuplicate.id,
      duplicateLeadCode: exactDuplicate.lead_code,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert({ ...toColumns(input), organization_id: organizationId, created_by: createdBy })
    .select()
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new AppError(409, 'LEAD_CODE_TAKEN', 'A lead with this code already exists.');
    fail(error);
  }

  await supabaseAdmin.from('lead_activities').insert({
    organization_id: organizationId,
    lead_id: data.id,
    activity_type: 'created',
    new_status: data.status,
    actor_id: createdBy,
  });

  return getLead(organizationId, data.id);
}

export async function getLead(organizationId: string, id: string) {
  const { data, error } = await supabaseAdmin.from('leads').select(SELECT_WITH_RELATIONS).eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found in this organization.');
  return data;
}

export async function listLeads(
  organizationId: string,
  filters: { status?: string; industryTypeId?: string; representativeId?: string; search?: string; industryTypeIds?: string[] } = {},
) {
  let query = supabaseAdmin.from('leads').select(SELECT_WITH_RELATIONS).eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(200);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.industryTypeId) query = query.eq('industry_type_id', filters.industryTypeId);
  if (filters.representativeId) query = query.eq('representative_id', filters.representativeId);
  if (filters.industryTypeIds) query = query.in('industry_type_id', filters.industryTypeIds);
  if (filters.search) query = query.or(`company_name.ilike.%${filters.search}%,lead_code.ilike.%${filters.search}%,contact_name.ilike.%${filters.search}%`);
  const { data, error } = await query;
  return error ? fail(error) : data;
}

export async function updateLead(organizationId: string, id: string, input: LeadInput) {
  const { data, error } = await supabaseAdmin.from('leads').update(toColumns(input)).eq('id', id).eq('organization_id', organizationId).select().maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new AppError(409, 'LEAD_CODE_TAKEN', 'A lead with this code already exists.');
    fail(error);
  }
  if (!data) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found in this organization.');
  return getLead(organizationId, id);
}

export async function deleteLead(organizationId: string, id: string) {
  const { data: current, error: currentError } = await supabaseAdmin
    .from('leads')
    .select('status')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (currentError) fail(currentError);
  if (!current) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found in this organization.');
  if (current.status === 'converted') {
    throw new AppError(422, 'LEAD_ALREADY_CONVERTED', 'A converted lead cannot be deleted — it is now a client record.');
  }

  const { data, error } = await supabaseAdmin.from('leads').delete().eq('id', id).eq('organization_id', organizationId).select('id').maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found in this organization.');
} 
export async function changeLeadStatus(organizationId: string, id: string, actorId: string, status: string, note?: string | null) {
  const { data: current, error: currentError } = await supabaseAdmin.from('leads').select('status').eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (currentError) fail(currentError);
  if (!current) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found in this organization.');
  if (current.status === 'converted') throw new AppError(422, 'LEAD_ALREADY_CONVERTED', 'A converted lead cannot change status directly.');
  if (status === 'converted') throw new AppError(422, 'USE_CONVERT_ENDPOINT', 'Use the convert endpoint to move a lead to converted.');

  const { data, error } = await supabaseAdmin.from('leads').update({ status }).eq('id', id).eq('organization_id', organizationId).select().maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found in this organization.');

  await supabaseAdmin.from('lead_activities').insert({
    organization_id: organizationId,
    lead_id: id,
    activity_type: 'status_changed',
    previous_status: current.status,
    new_status: status,
    note: note ?? null,
    actor_id: actorId,
  });

  // Lead -> Client -> Requirement -> Quotation, automatically, server-side,
  // regardless of which client (admin, mobile, IVR) fired this status
  // change. Replaces the old browser-only orchestration.
  if (status === 'qualified' && !data.converted_client_id) {
    await autoConvertQualifiedLead(organizationId, data, actorId);
  }

  return getLead(organizationId, id);
}

export async function assignLeadRepresentative(organizationId: string, id: string, actorId: string, representativeId: string) {
  const { data, error } = await supabaseAdmin.from('leads').update({ representative_id: representativeId }).eq('id', id).eq('organization_id', organizationId).select().maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === '23503') throw new AppError(400, 'INVALID_REPRESENTATIVE', 'Representative was not found for this organization.');
    fail(error);
  }
  if (!data) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found in this organization.');

  await supabaseAdmin.from('lead_activities').insert({
    organization_id: organizationId,
    lead_id: id,
    activity_type: 'assigned',
    actor_id: actorId,
  });

  return getLead(organizationId, id);
}

export async function setLeadNextAction(organizationId: string, id: string, actorId: string, nextAction: string | null, nextActionDueAt: string | null) {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .update({ next_action: nextAction, next_action_due_at: nextActionDueAt })
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found in this organization.');

  await supabaseAdmin.from('lead_activities').insert({
    organization_id: organizationId,
    lead_id: id,
    activity_type: 'next_action_set',
    note: nextAction,
    actor_id: actorId,
  });

  return getLead(organizationId, id);
}

export async function addLeadNote(organizationId: string, id: string, actorId: string, note: string) {
  const { data: lead, error: leadError } = await supabaseAdmin.from('leads').select('id').eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (leadError) fail(leadError);
  if (!lead) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found in this organization.');

  const { data, error } = await supabaseAdmin
    .from('lead_activities')
    .insert({ organization_id: organizationId, lead_id: id, activity_type: 'note_added', note, actor_id: actorId })
    .select()
    .single();
  return error ? fail(error) : data;
}

export async function listLeadActivities(organizationId: string, leadId: string) {
  await getLead(organizationId, leadId);
  const { data, error } = await supabaseAdmin
    .from('lead_activities')
    .select('*, user_profiles(display_name)')
    .eq('organization_id', organizationId)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false });
  return error ? fail(error) : data;
}

export async function convertLeadToClient(
  organizationId: string,
  id: string,
  actorId: string,
  input: { clientCode: string; clientType: string; address?: string | null; gpsRadiusMeters?: number | null; latitude?: number | null; longitude?: number | null },
) {
  const lead = await getLead(organizationId, id);
  if (lead.status === 'converted') throw new AppError(422, 'LEAD_ALREADY_CONVERTED', 'This lead has already been converted.');
  if (lead.status === 'lost' || lead.status === 'unqualified') {
    throw new AppError(422, 'LEAD_NOT_CONVERTIBLE', 'A lost or unqualified lead cannot be converted. Reopen it first.');
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .insert({
      organization_id: organizationId,
      client_code: input.clientCode,
      client_name: lead.company_name,
      client_type: input.clientType,
      industry_type_id: lead.industry_type_id,
      phone: lead.phone,
      email: lead.email,
      address: input.address ?? null,
      city: lead.city,
      state: lead.state,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      gps_radius_meters: input.gpsRadiusMeters ?? null,
      status: 'active',
    })
    .select()
    .single();
  if (clientError) {
    if ((clientError as { code?: string }).code === '23505') throw new AppError(409, 'CLIENT_CODE_TAKEN', 'A client with this code already exists.');
    fail(clientError);
  }
  if (lead.representative_id) {
    const { error: assignError } = await supabaseAdmin
      .from('sales_representative_client_assignments')
      .upsert(
        { organization_id: organizationId, sales_representative_id: lead.representative_id, client_id: client.id, status: 'active' },
        { onConflict: 'organization_id,sales_representative_id,client_id' },
      );
    if (assignError) fail(assignError);
  }

  // Carry the lead's contact person over as the client's primary contact —
  // the Clients UI reads email/phone from client_contacts, not from
  // clients.phone/clients.email, so without this row it shows "No email"/"—"
  // even though the lead had contact details.
  if (lead.contact_name || lead.phone || lead.email) {
    const { error: contactError } = await supabaseAdmin.from('client_contacts').insert({
      organization_id: organizationId,
      client_id: client.id,
      name: lead.contact_name || lead.company_name,
      is_primary: true,
      email: lead.email ?? null,
      phone: lead.phone ?? null,
    });
    if (contactError) fail(contactError);
  }

  // Carry the lead's scheduled follow-up over to the new client — the
  // Clients page's "Follow-up" column and the client's Follow-ups tab both
  // read from the `follow_ups` table, which conversion never touched, so a
  // lead's next-follow-up date used to just disappear once it converted.
  if (lead.next_action_due_at && lead.representative_id) {
    const { error: followUpError } = await supabaseAdmin.from('follow_ups').insert({
      organization_id: organizationId,
      representative_id: lead.representative_id,
      client_id: client.id,
      title: lead.next_action || `Follow up with ${lead.company_name}`,
      due_at: lead.next_action_due_at,
      priority: lead.priority ?? 'normal',
      notes: lead.notes ?? null,
    });
    if (followUpError) {
      await supabaseAdmin.from('lead_activities').insert({
        organization_id: organizationId,
        lead_id: id,
        activity_type: 'note_added',
        note: `Follow-up carryover to client failed: ${followUpError.message}`,
        actor_id: actorId,
      });
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from('leads')
    .update({ status: 'converted', converted_client_id: client.id, converted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', organizationId);
  if (updateError) fail(updateError);

  await supabaseAdmin.from('lead_activities').insert({
    organization_id: organizationId,
    lead_id: id,
    activity_type: 'converted',
    previous_status: lead.status,
    new_status: 'converted',
    actor_id: actorId,
  });

  return getLead(organizationId, id);
}
