import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';

const fail = (error: unknown): never => {
  throw error;
};
type RequirementItemInput = {
  productId?: string | null;
  freeTextItem?: string | null;
  quantity: number;
  notes?: string | null;
};

type RequirementCreateInput = {
  clientId: string;
  visitId?: string | null;
  title: string;
  description?: string | null;
  urgency: string;
  targetDate?: string | null;
  items: RequirementItemInput[];
};
const SELECT_WITH_RELATIONS =
  '*, clients(client_name, client_code, industry_type_id), sales_representatives(employee_code, user_profiles(display_name)), requirement_items(*, products(product_name, product_code))';
export async function createRequirement(organizationId: string, representativeId: string, input: RequirementCreateInput) {
  const { data: requirement, error } = await supabaseAdmin
    .from('requirements')
    .insert({
      organization_id: organizationId,
      representative_id: representativeId,
      client_id: input.clientId,
      visit_id: input.visitId ?? null,
      title: input.title,
      description: input.description ?? null,
      urgency: input.urgency,
      target_date: input.targetDate ?? null,
    })
    .select()
    .single();
  if (error) fail(error);

  const itemRows = input.items.map((item) => ({
    requirement_id: requirement.id,
    product_id: item.productId ?? null,
    free_text_item: item.freeTextItem ?? null,
    quantity: item.quantity,
    notes: item.notes ?? null,
  }));
  const { error: itemsError } = await supabaseAdmin.from('requirement_items').insert(itemRows);
  if (itemsError) {
    // Roll back the parent row so a failed item batch never leaves an item-less requirement behind.
    await supabaseAdmin.from('requirements').delete().eq('id', requirement.id);
    fail(itemsError);
  }

  return getRequirement(organizationId, requirement.id);
}

export async function getRequirement(organizationId: string, id: string, scope?: IndustryScope) {
  const { data, error } = await supabaseAdmin
    .from('requirements')
    .select(SELECT_WITH_RELATIONS)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'REQUIREMENT_NOT_FOUND', 'Requirement not found in this organization.');
  if (scope) {
    const clientIndustryTypeId = (data.clients as { industry_type_id?: string | null } | null)?.industry_type_id;
    assertRecordInScope(scope, clientIndustryTypeId, new AppError(404, 'REQUIREMENT_NOT_FOUND', 'Requirement not found in this organization.'));
  }
  return data;
}
export async function listRequirements(
  organizationId: string,
  filters: { representativeId?: string; status?: string; clientId?: string; industryTypeId?: string } = {},
) {
  const select = filters.industryTypeId
    ? '*, clients!inner(client_name, client_code, industry_type_id), sales_representatives(employee_code, user_profiles(display_name)), requirement_items(*, products(product_name, product_code))'
    : SELECT_WITH_RELATIONS;
  let query = supabaseAdmin
    .from('requirements')
    .select(select)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (filters.representativeId) query = query.eq('representative_id', filters.representativeId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.clientId) query = query.eq('client_id', filters.clientId);
  if (filters.industryTypeId) query = query.eq('clients.industry_type_id', filters.industryTypeId);
  const { data, error } = await query;
  return error ? fail(error) : data;
}

export async function updateRequirement(
  organizationId: string,
  id: string,
  input: { status: string; description?: string | null },
  scope?: IndustryScope,
) {
  if (scope) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('requirements')
      .select('id, clients(industry_type_id)')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (existingError) fail(existingError);
    if (!existing) throw new AppError(404, 'REQUIREMENT_NOT_FOUND', 'Requirement not found in this organization.');
    const clientIndustryTypeId = (existing.clients as { industry_type_id?: string | null } | null)?.industry_type_id;
    assertRecordInScope(scope, clientIndustryTypeId, new AppError(404, 'REQUIREMENT_NOT_FOUND', 'Requirement not found in this organization.'));
  }
  const update: Record<string, unknown> = { status: input.status };
  if (input.description !== undefined) update.description = input.description;
  const { data, error } = await supabaseAdmin
    .from('requirements')
    .update(update)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'REQUIREMENT_NOT_FOUND', 'Requirement not found in this organization.');
  return data;
}