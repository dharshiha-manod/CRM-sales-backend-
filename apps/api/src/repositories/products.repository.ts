import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { setProductIndustryTypes } from './industry-types.repository.js';
const fail = (error: unknown): never => { throw error; };
const map = { productCode: 'product_code', productName: 'product_name', sellingPrice: 'selling_price', costPrice: 'cost_price', stockQuantity: 'stock_quantity', taxPercent: 'tax_percent' } as Record<string, string>;
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
  if (error) fail(error);
  const products = data ?? [];
  if (products.length === 0) return products;
  // The `products` table itself has no industry_type_id column — the real
  // link lives in the product_industry_types join table (many-to-many).
  // Every Core Module (Clients/Requirements/ProductsPage itself) scopes
  // records by a single `industry_type_id` field on the row though, so
  // without this, every product looks unscoped and gets hidden in every
  // industry, everywhere, unconditionally. Attach it here once so every
  // caller of /products gets a real, filterable value for free.
  const { data: tags, error: tagsError } = await supabaseAdmin
    .from('product_industry_types')
    .select('product_id, industry_type_id')
    .eq('organization_id', org)
    .in('product_id', products.map((product) => product.id));
  if (tagsError) fail(tagsError);
  const tagsByProduct = new Map<string, string[]>();
  for (const row of tags ?? []) {
    const list = tagsByProduct.get(row.product_id as string) ?? [];
    list.push(row.industry_type_id as string);
    tagsByProduct.set(row.product_id as string, list);
  }
  return products.map((product) => {
    const ids = tagsByProduct.get(product.id) ?? [];
    return { ...product, industry_type_id: ids[0] ?? null, industry_type_ids: ids };
  });
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
export async function deleteProduct(org: string, id: string) {
  const { data, error } = await supabaseAdmin.from('products').delete().eq('organization_id', org).eq('id', id).select().maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
  return data;
}