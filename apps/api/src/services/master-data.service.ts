import { AppError } from '../errors/app-error.js';
import { assertRecordInScope, isGlobalRole, resolveIndustryTypeId, type IndustryScope } from '../lib/industry-scope.js';
import { validateIndustryDetails } from '../lib/industry-profile.js';
import { getIndustryType } from '../repositories/industry-types.repository.js';
import * as repo from '../repositories/master-data.repository.js';

const clientNotFound = () => new AppError(404, 'CLIENT_NOT_FOUND', 'Client was not found');

async function resolveIndustryCode(org: string, industryTypeId?: string | null): Promise<string | null> {
  if (!industryTypeId) return null;
  const type = await getIndustryType(org, industryTypeId);
  return (type as { code: string }).code;
}

function cleanIndustryDetails(code: string | null, details: unknown) {
  try {
    return validateIndustryDetails(code, details as Record<string, unknown> | undefined);
  } catch (error) {
    throw new AppError(422, 'INVALID_INDUSTRY_DETAILS', (error as Error).message);
  }
}

export const representativeService = { list: repo.listRepresentatives, get: repo.getRepresentative, async create(org: string, input: Record<string, unknown>) { await repo.assertRepresentativeUserMembership(org, input.userId as string); return repo.createRepresentative(org, input); }, update: repo.updateRepresentative };

export const clientService = {
  list(org: string, search: string | undefined, type: string | undefined, status: string | undefined, industryTypeId: string | undefined, scope: IndustryScope) {
    const effective = resolveIndustryTypeId(scope, industryTypeId);
    return repo.listClients(org, search, type, status, effective ?? undefined);
  },
  async get(org: string, id: string, scope: IndustryScope) {
    const client = await repo.getClient(org, id);
    assertRecordInScope(scope, (client as { industry_type_id?: string | null }).industry_type_id, clientNotFound());
    return client;
  },
  async create(org: string, input: Record<string, unknown>, scope: IndustryScope) {
    const industryTypeId = resolveIndustryTypeId(scope, input.industryTypeId as string | null | undefined);
    const code = await resolveIndustryCode(org, industryTypeId);
    return repo.createClient(org, { ...input, industryTypeId, industryDetails: cleanIndustryDetails(code, input.industryDetails) });
  },
  async update(org: string, id: string, input: Record<string, unknown>, scope: IndustryScope) {
    const existing = await repo.getClient(org, id);
    assertRecordInScope(scope, (existing as { industry_type_id?: string | null }).industry_type_id, clientNotFound());
    if ('industryTypeId' in input && !isGlobalRole(scope.role)) {
      throw new AppError(403, 'INDUSTRY_NOT_ASSIGNED', 'You are not assigned to this industry.');
    }
    const touchesIndustry = 'industryTypeId' in input || 'industryDetails' in input;
    if (!touchesIndustry) return repo.updateClient(org, id, input);
    const industryTypeId = ('industryTypeId' in input ? input.industryTypeId : (existing as { industry_type_id?: string | null }).industry_type_id) as string | null | undefined;
    const code = await resolveIndustryCode(org, industryTypeId);
    return repo.updateClient(org, id, { ...input, industryDetails: cleanIndustryDetails(code, input.industryDetails) });
  },
  contacts: { list: repo.listContacts, create: repo.createContact, update: repo.updateContact, remove: repo.deleteContact },
  assignments: { list: repo.listAssignedClients, assign: repo.assignClient, remove: repo.unassignClient }
};