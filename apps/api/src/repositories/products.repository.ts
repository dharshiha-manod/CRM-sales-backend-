import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { setProductIndustryTypes } from './industry-types.repository.js';
const fail = (error: unknown): never => { throw error; };
const map = { productCode: 'product_code', productName: 'product_name', sellingPrice: 'selling_price', costPrice: 'cost_price', stockQuantity: 'stock_quantity', taxPercent: 'tax_percent', hsnCode: 'hsn_code', originCountry: 'origin_country', supplierName: 'supplier_name', discountPercent: 'discount_percent', shelfLifeDays: 'shelf_life_days', minStockLevel: 'min_stock_level', textileDetails: 'textile_details', pharmaDetails: 'pharma_details' } as Record<string, string>;
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
// Adds (+) or removes (-) stock. It re-reads the current stock and only saves if nobody else changed it in
// between ("compare and swap"); if someone did, it retries with the fresh number. So no stock change is lost.
export async function changeProductStock(org: string, id: string, delta: number, allowNegative: boolean) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: current, error } = await supabaseAdmin.from('products').select('id, stock_quantity').eq('organization_id', org).eq('id', id).maybeSingle();
    if (error) fail(error);
    if (!current) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
    const before = Number(current.stock_quantity ?? 0);
    const after = before + delta;
    if (after < 0 && !allowNegative) throw new AppError(422, 'INSUFFICIENT_STOCK', `Stock cannot go below zero (current stock is ${before}).`);
    let query = supabaseAdmin.from('products').update({ stock_quantity: after }).eq('organization_id', org).eq('id', id);
    query = current.stock_quantity == null ? query.is('stock_quantity', null) : query.eq('stock_quantity', current.stock_quantity);
    const { data: updated, error: updateError } = await query.select().maybeSingle();
    if (updateError) fail(updateError);
    if (updated) return updated;
  }
  throw new AppError(409, 'STOCK_CHANGED', 'Stock was changed by someone else at the same moment. Please try again.');
}
// Tables whose rows are business history: a product used in any of them must never be hard-deleted (deactivate it instead).
const HISTORY_TABLES = ['sale_order_items', 'quotation_items', 'requirement_items', 'sales_returns', 'fmcg_shipment_items', 'stock_requests', 'inventory_movements', 'fmcg_secondary_sales', 'product_batches'];
async function assertProductNeverUsed(org: string, id: string, productCode: string | null) {
  const inUse = () => new AppError(409, 'PRODUCT_IN_USE', 'This product is already used in orders, quotations, returns, stock or other records, so it cannot be deleted. Deactivate it instead — history stays complete and it can no longer be sold.');
  for (const table of HISTORY_TABLES) {
    const { data, error } = await supabaseAdmin.from(table).select('product_id').eq('product_id', id).limit(1);
    if (!error && (data ?? []).length > 0) throw inUse(); // a table / column that does not exist yet is skipped
  }
  if (productCode) { // Pharma batches are linked by product code: batches already used by samples, returns or recalls keep the product alive
    const { data: batches } = await supabaseAdmin.from('pharma_batches').select('batch_number').eq('organization_id', org).eq('product_code', productCode);
    const numbers = (batches ?? []).map((b) => b.batch_number as string);
    if (numbers.length > 0) {
      for (const table of ['pharma_samples', 'pharma_medicine_returns', 'pharma_recalls']) {
        const { data, error } = await supabaseAdmin.from(table).select('id').eq('organization_id', org).in('batch_number', numbers).limit(1);
        if (!error && (data ?? []).length > 0) throw inUse();
      }
    }
  }
}
export async function deleteProduct(org: string, id: string) {
  // Remember this product's pharma batches before the product goes (they are linked by product code, not by a database key).
  const { data: found } = await supabaseAdmin.from('products').select('product_code').eq('organization_id', org).eq('id', id).maybeSingle();
  await assertProductNeverUsed(org, id, (found?.product_code as string | null) ?? null);
  const { data: batches } = found?.product_code
    ? await supabaseAdmin.from('pharma_batches').select('id').eq('organization_id', org).eq('product_code', found.product_code as string)
    : { data: [] as { id: string }[] };

  const { data, error } = await supabaseAdmin.from('products').delete().eq('organization_id', org).eq('id', id).select().maybeSingle();
  if (error) {
    // 23503 = another table (quotation, order, requirement ...) still points at this product.
    if ((error as { code?: string }).code === '23503') throw new AppError(409, 'PRODUCT_IN_USE', 'This product is already used in quotations, orders or requirements, so it cannot be deleted. Deactivate it instead.');
    fail(error);
  }
  if (!data) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');

  // The product is really gone, so its Batch & Expiry records go with it (best effort: the product delete above already succeeded).
  const batchIds = (batches ?? []).map((b) => b.id as string);
  if (batchIds.length > 0) {
    await supabaseAdmin.from('pharma_stock_movements').delete().eq('organization_id', org).in('batch_id', batchIds);
    await supabaseAdmin.from('pharma_batches').delete().eq('organization_id', org).in('id', batchIds);
  }
  return data;
}