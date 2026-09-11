// NEW
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import type { TradingResource } from '../lib/trading-resources.js';
import { resolveIndustryTypeId, assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';

const fail = (error: unknown): never => { throw error; };

function sanitizePayload(resource: TradingResource, input: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set([...resource.columns, 'status']);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key)) out[key] = value === '' ? null : value;
  }
  return out;
}

export async function listTradingRecords(resource: TradingResource, org: string, scope: IndustryScope, requestedIndustryTypeId?: string) {
  const industryTypeId = resolveIndustryTypeId(scope, requestedIndustryTypeId);
  let query = supabaseAdmin.from(resource.table).select('*').eq('organization_id', org).order('created_at', { ascending: false });
  if (industryTypeId) query = query.eq('industry_type_id', industryTypeId);
  const { data, error } = await query;
  return error ? fail(error) : data;
}

export async function getTradingRecord(resource: TradingResource, org: string, id: string, scope: IndustryScope) {
  const { data, error } = await supabaseAdmin.from(resource.table).select('*').eq('organization_id', org).eq('id', id).maybeSingle();
  if (error) fail(error);
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', `${resource.path} record was not found.`);
  if (!data) throw notFound;
  assertRecordInScope(scope, (data as { industry_type_id?: string | null }).industry_type_id, notFound);
  return data;
}

export async function createTradingRecord(resource: TradingResource, org: string, input: Record<string, unknown>, scope: IndustryScope) {
  const payload = sanitizePayload(resource, input);
  if (!scope || !('role' in scope)) throw new AppError(400, 'VALIDATION_ERROR', 'Industry scope is required.');
  const industryTypeId = resolveIndustryTypeId(scope, typeof payload.industry_type_id === 'string' ? payload.industry_type_id : undefined);
  if (!industryTypeId) throw new AppError(400, 'VALIDATION_ERROR', 'industry_type_id is required.');
  const { data, error } = await supabaseAdmin.from(resource.table).insert({ ...payload, industry_type_id: industryTypeId, organization_id: org }).select().single();
  if (error) {
    if (error.code === '23505') throw new AppError(409, 'DUPLICATE_RECORD', `A ${resource.path} record with that value already exists.`);
    fail(error);
  }
  return data;
}

export async function updateTradingRecord(resource: TradingResource, org: string, id: string, input: Record<string, unknown>, scope: IndustryScope) {
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', `${resource.path} record was not found.`);
  const { data: existing, error: existingError } = await supabaseAdmin.from(resource.table).select('industry_type_id').eq('organization_id', org).eq('id', id).maybeSingle();
  if (existingError) fail(existingError);
  if (!existing) throw notFound;
  assertRecordInScope(scope, (existing as { industry_type_id?: string | null }).industry_type_id, notFound);
  const payload = sanitizePayload(resource, input);
  delete payload.industry_type_id; // never allow moving a record across industries via update
  const { data, error } = await supabaseAdmin.from(resource.table).update(payload).eq('organization_id', org).eq('id', id).select().maybeSingle();
  if (error) {
    if (error.code === '23505') throw new AppError(409, 'DUPLICATE_RECORD', `A ${resource.path} record with that value already exists.`);
    fail(error);
  }
  if (!data) throw notFound;
  return data;
}

export async function deleteTradingRecord(resource: TradingResource, org: string, id: string, scope: IndustryScope) {
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', `${resource.path} record was not found.`);
  const { data: existing, error: existingError } = await supabaseAdmin.from(resource.table).select('industry_type_id').eq('organization_id', org).eq('id', id).maybeSingle();
  if (existingError) fail(existingError);
  if (!existing) throw notFound;
  assertRecordInScope(scope, (existing as { industry_type_id?: string | null }).industry_type_id, notFound);
  const { data, error } = await supabaseAdmin.from(resource.table).delete().eq('organization_id', org).eq('id', id).select().maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound;
  return data;
}