import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { createRequirement } from './requirements.repository.js';
import { createFromRequirement } from './quotations.repository.js';
import { listProducts } from './products.repository.js';
import { getFollowUpConfig, getSalesConfig } from '../lib/settings.js';
import { findRateToInr } from '../lib/fmcg-market.js';

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
type LeadForFollowUp = { id: string; company_name: string; representative_id: string | null; next_action_due_at: string | null; priority: string | null; notes: string | null };
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

async function logLeadNote(organizationId: string, leadId: string, actorId: string | null | undefined, note: string) {
  await supabaseAdmin.from('lead_activities').insert({
    organization_id: organizationId,
    lead_id: leadId,
    activity_type: 'note_added',
    note,
    actor_id: actorId ?? null,
  });
}

// Picks the catalog product a lead is interested in. The lead form's field is
// "Interested product / category", so after the exact / partial name match this
// also tries the product code and the category (e.g. "Biscuits" -> first active
// biscuit product) instead of silently giving up and leaving no quotation.
function matchInterestedProduct(products: any[], interested: string | undefined) {
  const wanted = interested?.trim().toLowerCase();
  if (!wanted) return undefined;
  const list = products ?? [];
  const name = (p: any) => String(p.product_name ?? '').toLowerCase();
  return (
    list.find((p) => name(p) === wanted) ??
    list.find((p) => name(p) && (name(p).includes(wanted) || wanted.includes(name(p)))) ??
    list.find((p) => String(p.product_code ?? '').toLowerCase() === wanted) ??
    list.find((p) => String(p.category ?? '').toLowerCase() === wanted) ??
    list.find((p) => String(p.category ?? '').toLowerCase() && wanted.includes(String(p.category).toLowerCase()))
  );
}

export type LeadChainResult = {
  clientId?: string;
  requirementId?: string;
  quotationNumber?: string;
  /** Why the chain stopped early (shown to the user); undefined when it ran to the end. */
  stoppedReason?: string;
};

/**
 * Fires the moment a lead's status becomes "qualified" — called from
 * changeLeadStatus below, no matter which caller (admin web, mobile rep
 * app, IVR, a future integration) triggered the status change.
 *
 * Chain: Client -> Requirement -> (best-effort) Quotation. It is the same
 * for every industry (Trading, FMCG, Pharma, ...). Every step is
 * best-effort and logged to lead_activities on failure; a failure at any
 * step never throws back to the caller and never blocks the status
 * change itself. The Requirement/Quotation part lives in continueLeadChain,
 * which is safe to run again, so a lead that stopped half-way (for example
 * because no representative was assigned yet) is finished automatically
 * as soon as the missing piece is fixed.
 */
async function autoConvertQualifiedLead(organizationId: string, lead: Record<string, any>, actorId: string): Promise<LeadChainResult> {
  const meta = parseLeadMeta(lead.notes);
  const clientCode = `CLI-${String(lead.lead_code).replace(/^LD-/, '')}`;

  try {
    await convertLeadToClient(organizationId, lead.id, actorId, {
      clientCode,
      clientType: meta.customerType || 'retailer',
      address: [lead.street_address, lead.city, lead.state].filter(Boolean).join(', ') || null,
    });
  } catch (err) {
    const reason = `Auto-convert to client failed: ${err instanceof Error ? err.message : 'unknown error'}`;
    await logLeadNote(organizationId, lead.id, actorId, reason);
    return { stoppedReason: reason };
  }
  return continueLeadChain(organizationId, lead.id, actorId);
}

/**
 * Requirement + Quotation part of the Lead pipeline for a lead that already
 * has its client. Idempotent: an auto-created requirement / quotation is
 * found and reused, never duplicated, so this can be called again whenever
 * something that stopped the chain has been fixed (rep assigned, product
 * added, ...).
 */
export async function continueLeadChain(organizationId: string, leadId: string, actorId?: string | null): Promise<LeadChainResult> {
  const { data: lead, error: leadError } = await supabaseAdmin.from('leads').select('*').eq('id', leadId).eq('organization_id', organizationId).maybeSingle();
  if (leadError) fail(leadError);
  if (!lead || !lead.converted_client_id) return {};
  const clientId = lead.converted_client_id as string;
  const result: LeadChainResult = { clientId };
  const stop = async (reason: string): Promise<LeadChainResult> => {
    await logLeadNote(organizationId, leadId, actorId, reason);
    return { ...result, stoppedReason: reason };
  };

  // Every requirement / quotation needs an owner. Use the lead's rep; if the lead has none
  // (the Rep field is optional on the lead form), fall back to a rep assigned to this lead's
  // industry so the chain does not stall right after the client is created.
  let representativeId: string | null = lead.representative_id ?? null;
  if (!representativeId && lead.industry_type_id) {
    const suggestion = await suggestRepresentativeForIndustry(organizationId, lead.industry_type_id);
    if (suggestion) {
      representativeId = suggestion.id;
      const { error: assignError } = await supabaseAdmin.from('leads').update({ representative_id: representativeId }).eq('id', leadId).eq('organization_id', organizationId);
      if (assignError) return stop(`Could not assign a representative automatically: ${assignError.message}`);
      const salesConfig = await getSalesConfig(organizationId, lead.industry_type_id);
      if (salesConfig.autoAssignCustomers) await syncClientAssignmentWithLeadRep(organizationId, clientId, representativeId, null);
      await supabaseAdmin.from('lead_activities').insert({ organization_id: organizationId, lead_id: leadId, activity_type: 'assigned', note: 'Representative assigned automatically to continue Requirement and Quotation.', actor_id: actorId ?? null });
    }
  }
  if (!representativeId) {
    return stop('Requirement and Quotation were not created: no sales representative is assigned to this lead or to its industry. Assign a representative (Sales Representatives -> industries) and the Requirement and Quotation will be created automatically.');
  }

  const meta = parseLeadMeta(lead.notes);
  const interested = meta.interestedProduct?.trim();
  let matchedProduct: { id: string; selling_price: number } | undefined;
  if (interested) {
    try {
      const products = await listProducts(organizationId, undefined, 'active', lead.industry_type_id ?? undefined);
      matchedProduct = matchInterestedProduct(products ?? [], interested);
    } catch (err) {
      await logLeadNote(organizationId, leadId, actorId, `Product lookup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
  let expectedValue = Number(meta.expectedOrderValue) || 0;
  // An international FMCG lead states its expected value in the client's currency; product prices are rupees,
  // so convert to INR before working out the quantity. No rate yet -> quantity 1 and a note in the lead's activity.
  const leadCurrency = String(lead.currency_code ?? '').toUpperCase();
  if (expectedValue > 0 && leadCurrency && leadCurrency !== 'INR') {
    const rate = await findRateToInr(organizationId, lead.industry_type_id, leadCurrency);
    if (rate) expectedValue *= rate;
    else {
      expectedValue = 0;
      await logLeadNote(organizationId, leadId, actorId, `Expected order value is in ${leadCurrency} but there is no ${leadCurrency} to INR rate in FMCG Currency Rates yet, so the quantity was set to 1. Add the rate and adjust the quantity on the Requirement.`);
    }
  }
   const quantity = matchedProduct && matchedProduct.selling_price > 0 ? Math.max(1, Math.round(expectedValue / matchedProduct.selling_price)) : 1;
  const marker = `Auto-created when lead ${lead.lead_code} was qualified.`;
  let requirement: { id: string; status: string } | null = null;
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('requirements')
    .select('id, status')
    .eq('organization_id', organizationId)
    .eq('client_id', clientId)
    .eq('description', marker)
    .order('created_at', { ascending: false })
    .limit(1);
  if (existingError) return stop(`Could not check for an existing requirement: ${existingError.message}`);
  if (existing && existing.length > 0) requirement = existing[0] as { id: string; status: string };

  if (!requirement) {
    try {
      // The follow-up field is a datetime-local string; the requirement's target date is a date.
      const targetDate = (meta.nextFollowUp || '').slice(0, 10) || null;
      const created = await createRequirement(organizationId, representativeId, {
        clientId,
        title: `Requirement — ${interested || lead.company_name}`,
        description: marker,
        urgency: lead.priority === 'critical' || lead.priority === 'high' ? 'high' : 'normal',
        targetDate,
        items: [
          matchedProduct
            ? { productId: matchedProduct.id, quantity, notes: `Auto-matched from lead's "${interested}"` }
            : { freeTextItem: interested || 'General requirement', quantity: 1, notes: 'No catalog product matched automatically — pick the exact product to enable quoting.' },
        ],
      });
      requirement = { id: created.id, status: created.status };
    } catch (err) {
      return stop(`Auto-create requirement failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
  result.requirementId = requirement.id;

  if (requirement.status === 'open') {
    if (!matchedProduct) {
      result.stoppedReason = 'Quotation not generated: the interested product did not match an active product of this industry.';
      return result;
    }
    try {
      const quotation = await createFromRequirement(organizationId, representativeId, requirement.id, {
        items: [{ productId: matchedProduct.id, quantity, discountPercent: 0 }],
        notes: 'Auto-generated when lead was qualified.',
      });
      result.quotationNumber = (quotation as { quotation_number?: string }).quotation_number;
    } catch (err) {
      return stop(`Auto-create quotation failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
  return result;
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
  nextActionType?: string | null;
};

const columnMap: Record<string, string> = {
  leadCode: 'lead_code',
  industryTypeId: 'industry_type_id',
  representativeId: 'representative_id',
  companyName: 'company_name',
  contactName: 'contact_name',
  streetAddress: 'street_address',
  countryCode: 'country_code',
  currencyCode: 'currency_code',
  nextAction: 'next_action',
  nextActionDueAt: 'next_action_due_at',
  nextActionType: 'next_action_type',
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
  const autoCode = !input.leadCode;
  let data: any = null;
  let error: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const leadCode = input.leadCode ?? (await generateLeadCode(organizationId, input.industryTypeId));
    ({ data, error } = await supabaseAdmin
      .from('leads')
      .insert({ ...toColumns({ ...input, leadCode }), organization_id: organizationId, created_by: createdBy })
      .select()
      .single());
    if (error && autoCode && (error as { code?: string }).code === '23505') continue;
    break;
  }
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
  await syncLeadFollowUp(organizationId, data.id);

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
  await syncLeadFollowUp(organizationId, id);
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
  if (status === 'unqualified' && !(data as LeadForFollowUp).next_action_due_at) {
    // The "Follow-up" stage always needs a date. Use the default window from Settings -> Follow-up Configuration
    // and write it to the LEAD, so the Leads page and the Follow-ups page always show the same date.
    const followUpConfig = await getFollowUpConfig(organizationId, (data as { industry_type_id?: string | null }).industry_type_id ?? null);
    const defaultDueAt = new Date(Date.now() + followUpConfig.defaultDurationDays * 24 * 60 * 60 * 1000).toISOString();
    const { error: defaultDateError } = await supabaseAdmin.from('leads').update({ next_action_due_at: defaultDueAt }).eq('id', id).eq('organization_id', organizationId);
    if (defaultDateError) fail(defaultDateError);
  }
  // new / contacted keep their follow-up, a lost lead's follow-up is cancelled, a re-opened lead gets it back
  await syncLeadFollowUp(organizationId, id);

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
  await syncLeadFollowUp(organizationId, id); // the open follow-up moves to the new rep

  return getLead(organizationId, id);
}

/**
 * Keeps a converted lead's client in step with the lead's representative.
 * Moves the client from the previous rep to the new one: only the previous
 * lead-owner's assignment is switched off, so any extra reps a manager added
 * by hand are left alone. Passing newRepId = null just removes the old one.
 */
export async function syncClientAssignmentWithLeadRep(organizationId: string, clientId: string, newRepId: string | null, previousRepId: string | null) {
  if (previousRepId && previousRepId !== newRepId) {
    const { error } = await supabaseAdmin
      .from('sales_representative_client_assignments')
      .update({ status: 'inactive' })
      .eq('organization_id', organizationId)
      .eq('sales_representative_id', previousRepId)
      .eq('client_id', clientId)
      .eq('status', 'active');
    if (error) fail(error);
  }
  if (newRepId) {
    const { error } = await supabaseAdmin
      .from('sales_representative_client_assignments')
      .upsert(
        { organization_id: organizationId, sales_representative_id: newRepId, client_id: clientId, status: 'active' },
        { onConflict: 'organization_id,sales_representative_id,client_id' },
      );
    if (error) fail(error);
  }
}

export async function setLeadNextAction(organizationId: string, id: string, actorId: string, nextAction: string | null, nextActionDueAt: string | null, nextActionType?: string | null) {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .update({ next_action: nextAction, next_action_due_at: nextActionDueAt, ...(nextActionType !== undefined ? { next_action_type: nextActionType } : {}) })
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found in this organization.');
  await syncLeadFollowUp(organizationId, id);

  await supabaseAdmin.from('lead_activities').insert({
    organization_id: organizationId,
    lead_id: id,
    activity_type: 'next_action_set',
    note: nextAction,
    actor_id: actorId,
  });

  return getLead(organizationId, id);
}

/**
 * Keeps ONE open follow-up in step with a lead, like the "next step" task in other CRMs:
 *  - a new / contacted / unqualified lead WITH a next-follow-up date  -> exactly one open follow-up
 *    (created if missing, otherwise refreshed with the lead's date, rep and priority)
 *  - a lost lead -> its open follow-up is cancelled
 *  - a converted lead -> untouched (conversion carries the follow-up over to the client)
 * Best-effort: a problem here is logged but never blocks saving the lead itself.
 */
async function syncLeadFollowUp(organizationId: string, leadId: string) {
  const { data: lead, error: leadError } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (leadError) { console.error('[lead-follow-up] could not read lead', leadError); return; }
  if (!lead) return;

  const { data: openRows, error: openError } = await supabaseAdmin
    .from('follow_ups')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('lead_id', leadId)
    .in('status', ['pending', 'in_progress'])
    .order('due_at');
  if (openError) { console.error('[lead-follow-up] could not read follow-ups', openError); return; }
  const open = openRows ?? [];

  if (lead.status === 'lost') {
    if (open.length > 0) {
      const { error } = await supabaseAdmin.from('follow_ups').update({ status: 'cancelled' }).eq('organization_id', organizationId).in('id', open.map((row) => row.id));
      if (error) console.error('[lead-follow-up] could not cancel follow-up for lost lead', error);
    }
    return;
  }
  if (!['new', 'contacted', 'unqualified'].includes(lead.status) || !lead.next_action_due_at) return;

  // Fields the lead owns. `follow_up_type` only comes from the lead when one was chosen on it, so a type
  // changed on the follow-up itself is not silently reset on every lead edit.
  const leadOwned: Record<string, unknown> = {
    representative_id: lead.representative_id,
    title: `Follow up: ${lead.company_name}`,
    due_at: lead.next_action_due_at,
    priority: ['low', 'normal', 'high', 'critical'].includes(lead.priority ?? '') ? lead.priority : 'normal',
  };
  const leadType = (lead as { next_action_type?: string | null }).next_action_type;
  if (leadType) leadOwned.follow_up_type = leadType;
  // Notes are only seeded when the follow-up is first created. After that they belong to the rep working it,
  // and a lead edit must not overwrite what they wrote.
  const { error } = open.length > 0
    ? await supabaseAdmin.from('follow_ups').update(leadOwned).eq('id', open[0].id).eq('organization_id', organizationId)
    : await supabaseAdmin.from('follow_ups').insert({ organization_id: organizationId, lead_id: leadId, follow_up_type: leadType ?? 'other', ...leadOwned, notes: leadNotesText(lead.notes) });
  if (error) console.error('[lead-follow-up] could not sync follow-up', error);
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

  // The lead's "Customer type" (Retailer / Distributor / Wholesaler / Institution) becomes the
  // client's "Outlet type", so nobody has to enter it a second time on the client page.
  const OUTLET_TYPE_VALUES = ['wholesaler', 'retailer', 'distributor', 'super_stockist', 'institution', 'manufacturer', 'other'];
  const leadCustomerType = String(parseLeadMeta(lead.notes).customerType ?? '').toLowerCase();
  const outletType = OUTLET_TYPE_VALUES.includes(leadCustomerType) ? leadCustomerType : null;

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .insert({
      organization_id: organizationId,
      client_code: input.clientCode,
      client_name: lead.company_name,
        client_type: input.clientType,
      outlet_type: outletType,
      industry_type_id: lead.industry_type_id,
      phone: lead.phone,
      email: lead.email,
      address: input.address ?? null,
      city: lead.city,
      state: lead.state,
      ...(lead.country_code ? { country_code: lead.country_code, currency_code: lead.currency_code ?? null } : {}),
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
  // Settings -> Sales -> "Auto-assign customers to reps": when ON (default),
  // the new client is handed to the lead's representative automatically.
  // When OFF, the manager assigns it later from Sales Representatives.
  const salesConfig = await getSalesConfig(organizationId, lead.industry_type_id ?? null);
  if (lead.representative_id && salesConfig.autoAssignCustomers) {
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
    // If the lead already has an open follow-up, move it to the client instead of creating a duplicate.
    const { data: openLeadFollowUp } = await supabaseAdmin
      .from('follow_ups')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('lead_id', id)
      .in('status', ['pending', 'in_progress'])
      .limit(1)
      .maybeSingle();

    const { error: followUpError } = openLeadFollowUp
      ? await supabaseAdmin.from('follow_ups').update({ client_id: client.id }).eq('id', openLeadFollowUp.id).eq('organization_id', organizationId)
      : await supabaseAdmin.from('follow_ups').insert({
          organization_id: organizationId,
          representative_id: lead.representative_id,
          client_id: client.id,
          title: lead.next_action || `Follow up with ${lead.company_name}`,
          due_at: lead.next_action_due_at,
          priority: lead.priority ?? 'normal',
          notes: leadNotesText(lead.notes),
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

/** Returns the human-authored lead note, without its packed FMCG metadata. */
function leadNotesText(notes?: string | null): string | null {
  if (notes == null) return null;
  const markerIndex = notes.indexOf(LEAD_META_MARKER);
  return markerIndex === -1 ? notes : notes.slice(0, markerIndex).trimEnd();
}
/**
 * Lead codes are numbered separately for every industry:
 *   LD-<INDUSTRY>-YYMM-#####   e.g. LD-TRADING-2610-00001, LD-FMCG-2610-00001
 */
export async function generateLeadCode(organizationId: string, industryTypeId: string) {
  const { data: industry, error: industryError } = await supabaseAdmin
    .from('industry_types')
    .select('code')
    .eq('id', industryTypeId)
    .maybeSingle();
  if (industryError) fail(industryError);
  const industryCode = String(industry?.code ?? 'GEN').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'GEN';
  const now = new Date();
  const prefix = `LD-${industryCode}-${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('lead_code')
    .eq('organization_id', organizationId)
    .eq('industry_type_id', industryTypeId)
    .like('lead_code', `${prefix}%`)
    .order('lead_code', { ascending: false })
    .limit(1);
  if (error) fail(error);
  const last = Number(String(data?.[0]?.lead_code ?? '').slice(prefix.length));
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(5, '0')}`;
}

/** Preview only: the code the next new lead of this industry will get. */
export async function previewNextLeadCode(organizationId: string, industryTypeId: string) {
  return generateLeadCode(organizationId, industryTypeId);
}