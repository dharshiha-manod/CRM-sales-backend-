import { AppError } from '../errors/app-error.js';
import { isGlobalRole } from '../lib/industry-scope.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
export async function ensureSalesRepresentative(organizationId: string, userId: string, employeeCode: string) {
  const { data: existing, error: findError } = await supabaseAdmin
    .from('sales_representatives')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;
  const { data, error } = await supabaseAdmin
    .from('sales_representatives')
    .insert({ organization_id: organizationId, user_id: userId, employee_code: employeeCode, status: 'active' })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

const fail = (error: unknown): never => { throw error; };

const membershipSelect = 'id, user_id, status, industry_type_id, created_at, updated_at, user_profiles(id, display_name, phone), roles(id, code, name), industry_types(id, code, name)';

export async function listOrganizationUsers(organizationId: string, industryTypeId?: string) {
  let query = supabaseAdmin.from('organization_memberships').select(membershipSelect).eq('organization_id', organizationId).order('created_at');
  if (industryTypeId) {
    // Global admins are identified by their ROLE, never by a null column —
    // a null industry_type_id on a non-global membership is bad data, not a
    // signal that the user should be visible everywhere.
    const { data: globalRoles, error: rolesError } = await supabaseAdmin.from('roles').select('id').in('code', ['super_admin', 'admin']);
    if (rolesError) fail(rolesError);
    const globalRoleIds = (globalRoles ?? []).map((r) => r.id);
    const roleFilter = globalRoleIds.length ? `,role_id.in.(${globalRoleIds.join(',')})` : '';
    query = query.or(`industry_type_id.eq.${industryTypeId}${roleFilter}`);
  }
  const { data, error } = await query; 
  if (error) fail(error);
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authError) fail(authError);
  const emails = new Map(authData.users.map((user) => [user.id, user.email ?? null]));
  return (data ?? []).map((membership) => ({ ...membership, email: emails.get(membership.user_id) ?? null }));
}

export async function listRoles() {
  const { data, error } = await supabaseAdmin.from('roles').select('id, code, name').order('name');
  return error ? fail(error) : data;
}

/**
 * Global roles (super_admin/admin) must never carry a single-industry lock —
 * every other role must carry exactly one, and it must belong to this
 * organization. This is the one place that decides that.
 */
async function normalizeIndustryAssignment(organizationId: string, roleCode: string, industryTypeId: string | null | undefined) {
  if (isGlobalRole(roleCode)) {
    if (industryTypeId) throw new AppError(422, 'INDUSTRY_NOT_ALLOWED', `${roleCode.replace('_', ' ')} is a global role and cannot be locked to a single industry.`);
    return null;
  }
  // Industry Type is no longer collected on the Users page — non-global
  // users are created unscoped now, so nothing is required here.
  if (!industryTypeId) return null;
  const { data: industry, error } = await supabaseAdmin.from('industry_types').select('id').eq('organization_id', organizationId).eq('id', industryTypeId).maybeSingle();
  if (error) fail(error);
  if (!industry) throw new AppError(422, 'INDUSTRY_TYPE_NOT_FOUND', 'The selected industry type does not exist for this organization.');
  return industryTypeId;
}
export async function saveMembership(organizationId: string, input: { userId: string; roleCode: string; status: string; industryTypeId?: string | null }) {
  const { data: profile, error: profileError } = await supabaseAdmin.from('user_profiles').select('id').eq('id', input.userId).maybeSingle();
  if (profileError) throw new AppError(500, 'PROFILE_LOOKUP_FAILED', profileError.message);
  if (!profile) throw new AppError(404, 'USER_PROFILE_NOT_FOUND', 'This user ID does not belong to an existing Supabase Auth user. Create the user first, then copy its user profile ID here.');

  const { data: role, error: roleError } = await supabaseAdmin.from('roles').select('id, code, name').eq('code', input.roleCode).maybeSingle();
  if (roleError) throw new AppError(500, 'ROLE_LOOKUP_FAILED', roleError.message);
  if (!role) throw new AppError(422, 'ROLE_NOT_FOUND', 'The selected role does not exist.');

  const industryTypeId = await normalizeIndustryAssignment(organizationId, role.code, input.industryTypeId);

 const { data, error } = await supabaseAdmin
    .from('organization_memberships')
    .upsert({ organization_id: organizationId, user_id: input.userId, role_id: role.id, status: input.status, industry_type_id: industryTypeId }, { onConflict: 'organization_id,user_id' })
    .select(membershipSelect)
    .single();
  if (error) throw new AppError(500, 'MEMBERSHIP_SAVE_FAILED', error.message);
  if (role.code === 'sales_representative') {
    await ensureSalesRepresentative(organizationId, input.userId, input.userId.slice(0, 8));
  }
  return data;
}

export async function createOrganizationUser(organizationId: string, input: { displayName: string; email: string; phone?: string | null; password: string; roleCode: string; status: string; industryTypeId?: string | null }) {
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName }
  });
  if (createError) {
    // Surface a real reason instead of a generic 500 — this is what a
    // leftover auth user from a previously-failed create looks like.
    const msg = createError.message?.toLowerCase() ?? '';
    if (msg.includes('already been registered') || msg.includes('already registered') || createError.code === 'email_exists') {
      throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'A user with this email already exists in Supabase Auth. Use a different email, or delete the existing auth user first.');
    }
    throw new AppError(500, 'USER_CREATION_FAILED', createError.message ?? 'Could not create the auth user.');
  }
  if (!created.user) throw new AppError(500, 'USER_CREATION_FAILED', 'Supabase did not return the new user.');
  try {
    const { error: profileError } = await supabaseAdmin.from('user_profiles').upsert({ id: created.user.id, display_name: input.displayName, phone: input.phone ?? null });
    if (profileError) throw new AppError(500, 'USER_PROFILE_SAVE_FAILED', profileError.message);
     const membership = await saveMembership(organizationId, { userId: created.user.id, roleCode: input.roleCode, status: input.status, industryTypeId: input.industryTypeId });
    if (input.roleCode === 'sales_representative') {
      await ensureSalesRepresentative(organizationId, created.user.id, input.email.split('@')[0]);
    }
    return membership;
  } catch (error) {
    // Roll back the orphaned auth user, but never let a cleanup failure mask
    // the real error that got us here — that masking is what turned earlier
    // failures into unrecoverable "email already registered" retries.
    try {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    } catch (cleanupError) {
      logger.error({ err: cleanupError, userId: created.user.id }, 'Failed to roll back orphaned auth user after user creation failure');
    }
    throw error;
  }
}