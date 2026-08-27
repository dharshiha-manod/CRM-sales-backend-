import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
export const requireRoles = (...roles: string[]): RequestHandler => async (req, _res, next) => {
  try {
    const userId = req.auth?.sub;
    const organizationId = req.header('x-organization-id');
    if (!userId || !organizationId) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
    const { data, error } = await supabaseAdmin
      .from('organization_memberships')
      .select('status, role_id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.status !== 'active') throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this organization');
    const { data: role, error: roleError } = await supabaseAdmin.from('roles').select('code').eq('id', data.role_id).maybeSingle();
    if (roleError) throw roleError;
    if (!role?.code || !roles.includes(role.code)) throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this organization');
    req.organizationRole = role.code;
    next();
  } catch (error) { next(error); }
};
