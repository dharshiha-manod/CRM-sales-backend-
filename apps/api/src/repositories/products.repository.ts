import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { setProductIndustryTypes } from './industry-types.repository.js';
const fail = (error: unknown): never => { throw error; };
const map = { productCode: 'product_code', productName: 'product_name', sellingPrice: 'selling_price', costPrice: 'cost_price', stockQuantity: 'stock_quantity' } as Record<string, string>;
const payload = (input: Record<string, unknown>) => { const { industryTypeIds, ...rest } = input; return Object.fromEntries(Object.entries(rest).map(([key, value]) => [map[key] ?? key, value])); };
export async function listProducts(org: string, search?: string, status?: string, industryTypeId?: string) {
  let query = supabaseAdmin.from('products').select('*').eq('organization_id', org).order('product_name');
  if (status) query = query.eq('status', status);
  if (search) query = query.or(`product_code.ilike.%${search}%,product_name.ilike.%${search}%`);
  if (industryTypeId) {
    const { data: tagRows, error: tagError } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', org).eq('industry_type_id', industryTypeId);
    if (tagError) fail(tagError);
    const ids = (tagRows ?? []).map((row) => row.product_id as string);
    if (ids.length === 0) return [];
    query = query.in('id', ids);
  }
  const { data, error } = await query;
  return error ? fail(error) : data;
}
export async function createProduct(org: string, input: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.from('products').insert({ ...payload(input), organization_id: org }).select().single();
  if (error) fail(error);
  const industryTypeIds = input.industryTypeIds as string[] | undefined;
  if (industryTypeIds) await setProductIndustryTypes(org, data.id, industryTypeIds);
  return data;
}
export async function updateProduct(org: string, id: string, input: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.from('products').update(payload(input)).eq('organization_id', org).eq('id', id).select().maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
  const industryTypeIds = input.industryTypeIds as string[] | undefined;
  if (industryTypeIds) await setProductIndustryTypes(org, id, industryTypeIds);
  return data;
}