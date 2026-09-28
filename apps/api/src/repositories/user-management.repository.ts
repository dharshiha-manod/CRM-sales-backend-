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
  // Copy the user's phone and email so the Sales representatives page shows them.
  const { data: profile } = await supabaseAdmin.from('user_profiles').select('phone').eq('id', userId).maybeSingle();
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const { data, error } = await supabaseAdmin
    .from('sales_representatives')
    .insert({ organization_id: organizationId, user_id: userId, employee_code: employeeCode, phone: profile?.phone ?? null, email: authUser?.user?.email ?? null, status: 'active' })   .select('id')
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

// Only these four roles exist in the product (they match the validation schema).
// Any other row in the roles table (e.g. leftover industry-specific roles) is
// hidden here so it can never be offered in the dropdown or fail on save.
const ASSIGNABLE_ROLE_ORDER = ['super_admin', 'admin', 'sales_manager', 'sales_representative'];

export async function listRoles() {
  const { data, error } = await supabaseAdmin.from('roles').select('id, code, name').in('code', ASSIGNABLE_ROLE_ORDER);
  if (error) return fail(error);
  return (data ?? []).sort((a, b) => ASSIGNABLE_ROLE_ORDER.indexOf(a.code) - ASSIGNABLE_ROLE_ORDER.indexOf(b.code));
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

// ---------------------------------------------------------------------------
// Edit / deactivate / delete / reset password
// ---------------------------------------------------------------------------

type Actor = { userId: string; role: string };

/** Loads one membership inside this organization, or throws a clean 404. */
async function getMembership(organizationId: string, membershipId: string) {
  const { data, error } = await supabaseAdmin
    .from('organization_memberships')
    .select('id, user_id, status, role_id, roles(code)')
    .eq('organization_id', organizationId)
    .eq('id', membershipId)
    .maybeSingle();
  if (error) throw new AppError(500, 'MEMBERSHIP_LOOKUP_FAILED', error.message);
  if (!data) throw new AppError(404, 'USER_NOT_FOUND', 'This user no longer exists in your organization.');
  const roleCode = (data.roles as unknown as { code?: string } | null)?.code ?? '';
  return { id: data.id as string, userId: data.user_id as string, status: data.status as string, roleCode };
}

/** Never let the organization end up with zero active Super Admins. */
async function assertNotLastSuperAdmin(organizationId: string, target: { id: string; roleCode: string; status: string }) {
  if (target.roleCode !== 'super_admin' || target.status !== 'active') return;
  const { data: role } = await supabaseAdmin.from('roles').select('id').eq('code', 'super_admin').maybeSingle();
  if (!role) return;
  const { count, error } = await supabaseAdmin
    .from('organization_memberships')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('role_id', role.id)
    .eq('status', 'active')
    .neq('id', target.id);
  if (error) throw new AppError(500, 'MEMBERSHIP_LOOKUP_FAILED', error.message);
  if (!count) throw new AppError(409, 'LAST_SUPER_ADMIN', 'This is the only active Super Admin. Make someone else a Super Admin first.');
}

/** Only a Super Admin may touch a Super Admin account. */
function assertCanManage(actor: Actor, target: { roleCode: string }) {
  if (target.roleCode === 'super_admin' && actor.role !== 'super_admin') {
    throw new AppError(403, 'SUPER_ADMIN_REQUIRED', 'Only a Super Admin can change another Super Admin.');
  }
}

export async function updateOrganizationUser(
  organizationId: string,
  membershipId: string,
  actor: Actor,
  input: { displayName: string; phone?: string | null; roleCode: string; status: string; industryTypeId?: string | null },
) {
  const target = await getMembership(organizationId, membershipId);
  assertCanManage(actor, target);
  if (input.roleCode === 'super_admin' && actor.role !== 'super_admin') {
    throw new AppError(403, 'SUPER_ADMIN_REQUIRED', 'Only a Super Admin can make someone a Super Admin.');
  }
  const isSelf = target.userId === actor.userId;
  if (isSelf && (input.roleCode !== target.roleCode || input.status !== 'active')) {
    throw new AppError(409, 'CANNOT_CHANGE_SELF', 'You cannot change your own role or deactivate your own account.');
  }
  if (target.roleCode === 'super_admin' && (input.roleCode !== 'super_admin' || input.status !== 'active')) {
    await assertNotLastSuperAdmin(organizationId, target);
  }

  const { error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .upsert({ id: target.userId, display_name: input.displayName, phone: input.phone || null });
  if (profileError) throw new AppError(500, 'USER_PROFILE_SAVE_FAILED', profileError.message);

  // saveMembership re-validates the role/industry rules in one place.
  return saveMembership(organizationId, { userId: target.userId, roleCode: input.roleCode, status: input.status, industryTypeId: input.industryTypeId });
}

export async function setOrganizationUserStatus(organizationId: string, membershipId: string, actor: Actor, status: 'active' | 'disabled') {
  const target = await getMembership(organizationId, membershipId);
  assertCanManage(actor, target);
  if (status === 'disabled') {
    if (target.userId === actor.userId) throw new AppError(409, 'CANNOT_CHANGE_SELF', 'You cannot deactivate your own account.');
    await assertNotLastSuperAdmin(organizationId, target);
  }
  const { data, error } = await supabaseAdmin
    .from('organization_memberships')
    .update({ status })
    .eq('organization_id', organizationId)
    .eq('id', membershipId)
    .select(membershipSelect)
    .single();
  if (error) throw new AppError(500, 'MEMBERSHIP_SAVE_FAILED', error.message);
  return data;
}

export async function resetOrganizationUserPassword(organizationId: string, membershipId: string, actor: Actor, password: string) {
  const target = await getMembership(organizationId, membershipId);
  assertCanManage(actor, target);
  const { error } = await supabaseAdmin.auth.admin.updateUserById(target.userId, { password });
  if (error) throw new AppError(500, 'PASSWORD_RESET_FAILED', error.message);
  // Sign the user out everywhere so the old password stops working at once.
  try { await supabaseAdmin.auth.admin.signOut(target.userId, 'global'); } catch (signOutError) {
    logger.warn({ err: signOutError, userId: target.userId }, 'Password reset succeeded but global sign-out failed');
  }
  return { ok: true };
}

/**
 * Removes the user's access to this organization. The login account itself is
 * only deleted when the person belongs to no other organization AND has no
 * linked history that blocks deletion -- otherwise the account is simply left
 * without access (the safe outcome). Prefer "Deactivate" for anyone with data.
 */
export async function deleteOrganizationUser(organizationId: string, membershipId: string, actor: Actor) {
  const target = await getMembership(organizationId, membershipId);
  assertCanManage(actor, target);
  if (target.userId === actor.userId) throw new AppError(409, 'CANNOT_CHANGE_SELF', 'You cannot delete your own account.');
  await assertNotLastSuperAdmin(organizationId, target);

  const { error } = await supabaseAdmin.from('organization_memberships').delete().eq('organization_id', organizationId).eq('id', membershipId);
  if (error) {
    throw new AppError(409, 'USER_HAS_LINKED_DATA', 'This user has linked records and cannot be deleted. Deactivate the user instead.');
  }

  const { count } = await supabaseAdmin.from('organization_memberships').select('id', { count: 'exact', head: true }).eq('user_id', target.userId);
  if (!count) {
    try { await supabaseAdmin.auth.admin.deleteUser(target.userId); } catch (deleteError) {
      logger.warn({ err: deleteError, userId: target.userId }, 'Membership removed but auth account could not be deleted');
    }
  }
  return { ok: true };
}
