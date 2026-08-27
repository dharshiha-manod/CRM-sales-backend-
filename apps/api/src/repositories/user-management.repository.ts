import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

const fail = (error: unknown): never => { throw error; };

export async function listOrganizationUsers(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('organization_memberships')
    .select('id, user_id, status, created_at, updated_at, user_profiles(id, display_name, phone), roles(id, code, name)')
    .eq('organization_id', organizationId)
    .order('created_at');
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

export async function saveMembership(organizationId: string, input: { userId: string; roleCode: string; status: string }) {
  const { data: profile, error: profileError } = await supabaseAdmin.from('user_profiles').select('id').eq('id', input.userId).maybeSingle();
  if (profileError) fail(profileError);
  if (!profile) throw new AppError(404, 'USER_PROFILE_NOT_FOUND', 'This user ID does not belong to an existing Supabase Auth user. Create the user first, then copy its user profile ID here.');

  const { data: role, error: roleError } = await supabaseAdmin.from('roles').select('id, code, name').eq('code', input.roleCode).maybeSingle();
  if (roleError) fail(roleError);
  if (!role) throw new AppError(422, 'ROLE_NOT_FOUND', 'The selected role does not exist.');

  const { data, error } = await supabaseAdmin
    .from('organization_memberships')
    .upsert({ organization_id: organizationId, user_id: input.userId, role_id: role.id, status: input.status }, { onConflict: 'organization_id,user_id' })
    .select('id, user_id, status, created_at, updated_at, user_profiles(id, display_name, phone), roles(id, code, name)')
    .single();
  return error ? fail(error) : data;
}

export async function createOrganizationUser(organizationId: string, input: { displayName: string; email: string; phone?: string | null; password: string; roleCode: string; status: string }) {
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName }
  });
  if (createError) fail(createError);
  if (!created.user) throw new AppError(500, 'USER_CREATION_FAILED', 'Supabase did not return the new user.');
  try {
    const { error: profileError } = await supabaseAdmin.from('user_profiles').upsert({ id: created.user.id, display_name: input.displayName, phone: input.phone ?? null });
    if (profileError) fail(profileError);
    return await saveMembership(organizationId, { userId: created.user.id, roleCode: input.roleCode, status: input.status });
  } catch (error) {
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    throw error;
  }
}
