import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

const fail = (error: unknown): never => { throw error; };

export async function listIndustryTypes(org: string, search?: string, status?: string) {
  let query = supabaseAdmin.from('industry_types').select('*').eq('organization_id', org).order('name');
  if (status) query = query.eq('status', status);
  if (search) query = query.or(`code.ilike.%${search}%,name.ilike.%${search}%`);
  const { data, error } = await query;
  return error ? fail(error) : data;
}

export async function getIndustryType(org: string, id: string) {
  const { data, error } = await supabaseAdmin.from('industry_types').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'INDUSTRY_TYPE_NOT_FOUND', 'Industry type was not found.');
  return data;
}

export async function createIndustryType(org: string, input: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.from('industry_types').insert({ ...input, organization_id: org }).select().single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new AppError(409, 'INDUSTRY_TYPE_CODE_TAKEN', 'An industry type with this code already exists.');
    fail(error);
  }
  return data;
}

export async function updateIndustryType(org: string, id: string, input: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.from('industry_types').update(input).eq('organization_id', org).eq('id', id).select().maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'INDUSTRY_TYPE_NOT_FOUND', 'Industry type was not found.');
  return data;
}

// Product <-> industry tagging (many-to-many).
export async function listProductIndustryTypes(org: string, productId: string) {
  const { data, error } = await supabaseAdmin.from('product_industry_types').select('industry_type_id, industry_types(id, code, name, status)').eq('organization_id', org).eq('product_id', productId);
  return error ? fail(error) : (data ?? []).map((row: any) => row.industry_types);
}

export async function setProductIndustryTypes(org: string, productId: string, industryTypeIds: string[]) {
  const { error: deleteError } = await supabaseAdmin.from('product_industry_types').delete().eq('organization_id', org).eq('product_id', productId);
  if (deleteError) fail(deleteError);
  if (industryTypeIds.length === 0) return [];
  const rows = industryTypeIds.map((industryTypeId) => ({ organization_id: org, product_id: productId, industry_type_id: industryTypeId }));
  const { data, error } = await supabaseAdmin.from('product_industry_types').insert(rows).select('industry_type_id, industry_types(id, code, name, status)');
  if (error) {
    if ((error as { code?: string }).code === '23503') throw new AppError(400, 'INVALID_INDUSTRY_TYPE', 'One or more industry types were not found for this organization.');
    fail(error);
  }
  return (data ?? []).map((row: any) => row.industry_types);
}

// Returns product ids tagged to a given industry type, for filtering the products list.
export async function productIdsForIndustryType(org: string, industryTypeId: string) {
  const { data, error } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', org).eq('industry_type_id', industryTypeId);
  return error ? fail(error) : (data ?? []).map((row) => row.product_id as string);
}