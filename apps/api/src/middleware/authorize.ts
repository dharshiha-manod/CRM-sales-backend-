import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const requireRoles = (...roles: string[]): RequestHandler => async (req, _res, next) => {
  try {
    const userId = req.auth?.sub;
    const organizationId = req.header('x-organization-id');
    if (!userId || !organizationId) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
    const { data, error } = await supabaseAdmin
      .from('organization_memberships')
      .select('status, role_id, industry_type_id, roles(code)')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.status !== 'active') throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this organization');
    const roleCode = (data.roles as unknown as { code?: string } | null)?.code;
    if (!roleCode || !roles.includes(roleCode)) throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this organization');
    req.organizationRole = roleCode;
    const scope: IndustryScope = { role: roleCode, lockedIndustryTypeId: (data.industry_type_id as string | null) ?? null };
    req.industryScope = scope;
    next();
  } catch (error) { next(error); }
};