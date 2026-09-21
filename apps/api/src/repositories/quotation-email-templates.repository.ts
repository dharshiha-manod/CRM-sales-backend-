import { AppError } from '../errors/app-error.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { supabaseAdmin } from '../lib/supabase.js';

const fail = (error: unknown): never => { throw error; };
export type TemplateInput = { industryTypeId: string; logoUrl?: string | null; subject: string; body: string; footer?: string | null };

function isMissingTemplateTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // Email templates are optional: quotations must still be sendable with the
  // built-in template while an older database is awaiting this migration.
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || (/quotation_email_templates/i.test(error.message ?? '') && /(not find|does not exist|schema cache)/i.test(error.message ?? ''));
}

export async function getQuotationEmailTemplate(organizationId: string, industryTypeId: string, scope?: IndustryScope) {
  if (scope) assertRecordInScope(scope, industryTypeId, new AppError(404, 'QUOTATION_EMAIL_TEMPLATE_NOT_FOUND', 'Quotation email template not found.'));
  const { data, error } = await supabaseAdmin.from('quotation_email_templates').select('*').eq('organization_id', organizationId).eq('industry_type_id', industryTypeId).maybeSingle();
  if (isMissingTemplateTable(error)) return null;
  return error ? fail(error) : data;
}

export async function saveQuotationEmailTemplate(organizationId: string, input: TemplateInput, scope: IndustryScope) {
  assertRecordInScope(scope, input.industryTypeId, new AppError(404, 'QUOTATION_EMAIL_TEMPLATE_NOT_FOUND', 'Quotation email template not found.'));
  const { data: industry, error: industryError } = await supabaseAdmin.from('industry_types').select('id').eq('organization_id', organizationId).eq('id', input.industryTypeId).maybeSingle();
  if (industryError) fail(industryError); if (!industry) throw new AppError(404, 'INDUSTRY_TYPE_NOT_FOUND', 'Industry type was not found.');
  const { data, error } = await supabaseAdmin.from('quotation_email_templates').upsert({ organization_id: organizationId, industry_type_id: input.industryTypeId, logo_url: input.logoUrl ?? null, subject: input.subject, body: input.body, footer: input.footer ?? null }, { onConflict: 'organization_id,industry_type_id' }).select().single();
  return error ? fail(error) : data;
}
