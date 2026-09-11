import { AppError } from '../errors/app-error.js';

export const GLOBAL_ROLES = ['super_admin', 'admin'] as const;

export interface IndustryScope {
  role: string;
  lockedIndustryTypeId: string | null;
}

export function isGlobalRole(role: string | undefined | null): boolean {
  return !!role && (GLOBAL_ROLES as readonly string[]).includes(role);
}

/**
 * Resolves the industry_type_id a request is actually allowed to use for a
 * LIST-style query.
 *  - Global roles may pass any industryTypeId (their active-industry
 *    selector), or none, which means "no filter, show every industry".
 *  - Every other role is locked server-side to their membership's
 *    industry_type_id. A client-supplied value is only honoured when it
 *    matches the lock; a mismatched value is rejected outright rather than
 *    silently ignored, so a manipulated request fails loudly instead of
 *    quietly returning the "safe" answer.
 */
export function resolveIndustryTypeId(scope: IndustryScope, requested?: string | null): string | null {
  if (isGlobalRole(scope.role)) return requested ?? null;
  if (requested && requested !== scope.lockedIndustryTypeId) {
    throw new AppError(403, 'INDUSTRY_NOT_ASSIGNED', 'You are not assigned to this industry.');
  }
  return scope.lockedIndustryTypeId;
}

/**
 * Guards direct-by-id access (get/update/delete). Throws 404 — not 403 —
 * for an out-of-scope record so a locked user can't use the error response
 * itself to confirm that a record in another industry exists.
 */
export function assertRecordInScope(scope: IndustryScope, recordIndustryTypeId: string | null | undefined, notFoundError: AppError) {
  if (isGlobalRole(scope.role)) return;
  if (!recordIndustryTypeId || recordIndustryTypeId !== scope.lockedIndustryTypeId) {
    throw notFoundError;
  }
}

/** True if a set of industry ids is entirely within what this scope may touch (used for many-to-many tags, e.g. products). */
export function assertIndustryIdsInScope(scope: IndustryScope, industryTypeIds: string[] | undefined) {
  if (isGlobalRole(scope.role) || !industryTypeIds || industryTypeIds.length === 0) return;
  const foreign = industryTypeIds.filter((industryTypeId) => industryTypeId !== scope.lockedIndustryTypeId);
  if (foreign.length > 0) {
    throw new AppError(403, 'INDUSTRY_NOT_ASSIGNED', 'You can only manage records for your own assigned industry.');
  }
}