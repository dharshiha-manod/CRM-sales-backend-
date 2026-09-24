import { AppError } from '../errors/app-error.js';
import { getSalesConfig } from '../lib/settings.js';

import { assertRecordInScope, isGlobalRole, resolveIndustryTypeId, type IndustryScope } from '../lib/industry-scope.js';
import * as repository from '../repositories/leads.repository.js';

const leadNotFound = () => new AppError(404, 'LEAD_NOT_FOUND', 'Lead was not found');

async function assertRepresentativeCanAccessIndustry(organizationId: string, representativeId: string, industryTypeId: string) {
  const allowed = await repository.representativeIndustryTypeIds(organizationId, representativeId);
  if (!allowed.includes(industryTypeId)) {
    throw new AppError(403, 'INDUSTRY_NOT_ASSIGNED', 'You are not assigned to this industry.');
  }
}

async function listForRepresentative(organizationId: string, representativeId: string, filters: { status?: string; industryTypeId?: string; search?: string }) {
  const allowedIndustryTypeIds = await repository.representativeIndustryTypeIds(organizationId, representativeId);
  if (allowedIndustryTypeIds.length === 0) return [];
  if (filters.industryTypeId && !allowedIndustryTypeIds.includes(filters.industryTypeId)) {
    throw new AppError(403, 'INDUSTRY_NOT_ASSIGNED', 'You are not assigned to this industry.');
  }
  return repository.listLeads(organizationId, {
    ...filters,
    representativeId,
    industryTypeIds: filters.industryTypeId ? [filters.industryTypeId] : allowedIndustryTypeIds,
  });
}

/**
 * Managers/Admins/Super Admins share this path. Admin/Super Admin are
 * global and may filter by any industry (or none, to see everything). A
 * Sales Manager is locked server-side to their own membership's
 * industry_type_id -- resolveIndustryTypeId throws if they try to request
 * a different one, instead of silently widening or narrowing the results.
 */
async function listForManager(organizationId: string, filters: { status?: string; industryTypeId?: string; representativeId?: string; search?: string }, scope: IndustryScope) {
  const effectiveIndustryTypeId = resolveIndustryTypeId(scope, filters.industryTypeId);
  return repository.listLeads(organizationId, { ...filters, industryTypeId: effectiveIndustryTypeId ?? undefined });
}

async function getScoped(organizationId: string, id: string, scope: IndustryScope, representativeId?: string) {
  const lead = await repository.getLead(organizationId, id);
  if (representativeId) {
    await assertRepresentativeCanAccessIndustry(organizationId, representativeId, lead.industry_type_id);
    if (lead.representative_id && lead.representative_id !== representativeId) {
      throw new AppError(403, 'FORBIDDEN', 'This lead is assigned to a different representative.');
    }
  } else {
    assertRecordInScope(scope, lead.industry_type_id, leadNotFound());
  }
  return lead;
}

function computeLeadScore(input: { phone?: string | null; email?: string | null; contactName?: string | null; source?: string; representativeId?: string | null }): number {
  let score = 20;
  if (input.phone) score += 20;
  if (input.email) score += 15;
  if (input.contactName) score += 10;
  const sourceWeights: Record<string, number> = { referral: 20, website: 15, ivr: 10, exhibition: 10, walk_in: 10, cold_call: 5, social_media: 8, other: 0 };
  score += sourceWeights[input.source ?? 'other'] ?? 0;
  if (input.representativeId) score += 10;
  return Math.max(0, Math.min(100, score));
}

async function create(organizationId: string, createdBy: string, input: Parameters<typeof repository.createLead>[2], scope: IndustryScope, representativeId?: string) {
  const salesConfig = await getSalesConfig(organizationId); // ← NEW

  if (representativeId) {
    await assertRepresentativeCanAccessIndustry(organizationId, representativeId, input.industryTypeId!);
    input = { ...input, representativeId: input.representativeId ?? representativeId };
  } else {
    input = { ...input, industryTypeId: resolveIndustryTypeId(scope, input.industryTypeId) ?? input.industryTypeId };
    // ↓ CHANGED: only auto-suggest a rep if the setting is turned on
    if (!input.representativeId && salesConfig.autoAssignReps) {
      const suggestion = await repository.suggestRepresentativeForIndustry(organizationId, input.industryTypeId!);
      if (suggestion) input = { ...input, representativeId: suggestion.id };
    }
  }
  input = { ...input, score: computeLeadScore(input) };
  return repository.createLead(organizationId, createdBy, input);
}

async function update(organizationId: string, id: string, input: Parameters<typeof repository.updateLead>[2], scope: IndustryScope, representativeId?: string) {
  const current = await getScoped(organizationId, id, scope, representativeId);
  if (representativeId && input.industryTypeId) {
    await assertRepresentativeCanAccessIndustry(organizationId, representativeId, input.industryTypeId);
  } else if (!representativeId && input.industryTypeId) {
    resolveIndustryTypeId(scope, input.industryTypeId);
  }
  const scoreRelevant = input.phone !== undefined || input.email !== undefined || input.contactName !== undefined || input.source !== undefined || input.representativeId !== undefined;
  const merged = scoreRelevant
    ? { ...input, score: computeLeadScore({ phone: input.phone ?? current.phone, email: input.email ?? current.email, contactName: input.contactName ?? current.contact_name, source: input.source ?? current.source, representativeId: input.representativeId !== undefined ? input.representativeId : current.representative_id }) }
    : input;
  return repository.updateLead(organizationId, id, merged);
}

async function deleteLead(organizationId: string, id: string, scope: IndustryScope) {
  const lead = await repository.getLead(organizationId, id);
  assertRecordInScope(scope, lead.industry_type_id, leadNotFound());
  return repository.deleteLead(organizationId, id);
}

async function setNextAction(organizationId: string, id: string, actorId: string, nextAction: string | null, nextActionDueAt: string | null, scope: IndustryScope, representativeId?: string) {
  await getScoped(organizationId, id, scope, representativeId);
  return repository.setLeadNextAction(organizationId, id, actorId, nextAction, nextActionDueAt);
}

async function listFollowUps(organizationId: string, representativeId: string | undefined, overdueOnly: boolean) {
  return repository.listFollowUps(organizationId, { representativeId, overdueOnly });
}

async function suggestRepresentative(organizationId: string, industryTypeId: string, scope: IndustryScope) {
  resolveIndustryTypeId(scope, industryTypeId);
  return repository.suggestRepresentativeForIndustry(organizationId, industryTypeId);
}

async function changeStatus(organizationId: string, id: string, actorId: string, status: string, note: string | null | undefined, scope: IndustryScope, representativeId?: string) {
  await getScoped(organizationId, id, scope, representativeId);
  return repository.changeLeadStatus(organizationId, id, actorId, status, note);
}

async function assign(organizationId: string, id: string, actorId: string, newRepresentativeId: string, scope: IndustryScope) {
  const lead = await repository.getLead(organizationId, id);
  assertRecordInScope(scope, lead.industry_type_id, leadNotFound());
  await assertRepresentativeCanAccessIndustry(organizationId, newRepresentativeId, lead.industry_type_id);
  return repository.assignLeadRepresentative(organizationId, id, actorId, newRepresentativeId);
}

async function addNote(organizationId: string, id: string, actorId: string, note: string, scope: IndustryScope, representativeId?: string) {
  await getScoped(organizationId, id, scope, representativeId);
  return repository.addLeadNote(organizationId, id, actorId, note);
}

async function activities(organizationId: string, id: string, scope: IndustryScope, representativeId?: string) {
  await getScoped(organizationId, id, scope, representativeId);
  return repository.listLeadActivities(organizationId, id);
}

async function convert(organizationId: string, id: string, actorId: string, input: Parameters<typeof repository.convertLeadToClient>[3], scope: IndustryScope, representativeId?: string) {
  await getScoped(organizationId, id, scope, representativeId);
  return repository.convertLeadToClient(organizationId, id, actorId, input);
}

async function checkDuplicates(organizationId: string, input: { phone?: string | null; email?: string | null; companyName?: string | null }) {
  return repository.findDuplicateLeads(organizationId, input);
}

function assertAssignmentInScope(scope: IndustryScope, industryTypeId: string) {
  if (isGlobalRole(scope.role)) return;
  resolveIndustryTypeId(scope, industryTypeId);
}

export const leadService = {
  listForRepresentative,
  listForManager,
  get: getScoped,
  create,
  update,
  delete: deleteLead,
  changeStatus,
  assign,
  addNote,
  activities,
  convert,
  checkDuplicates,
  setNextAction,
  listFollowUps,
  suggestRepresentative,
  industryAssignments: {
    list: repository.listRepresentativeIndustryTypes,
    assign: (organizationId: string, representativeId: string, industryTypeId: string, scope: IndustryScope) => {
      assertAssignmentInScope(scope, industryTypeId);
      return repository.assignRepresentativeIndustryType(organizationId, representativeId, industryTypeId);
    },
    unassign: (organizationId: string, representativeId: string, industryTypeId: string, scope: IndustryScope) => {
      assertAssignmentInScope(scope, industryTypeId);
      return repository.unassignRepresentativeIndustryType(organizationId, representativeId, industryTypeId);
    },
  },
};