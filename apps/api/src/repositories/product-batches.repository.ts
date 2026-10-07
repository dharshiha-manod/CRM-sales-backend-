// FMCG batch & expiry. Batches are slices of a product's stock (sum of batches <= product stock).
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope, isGlobalRole, type IndustryScope } from '../lib/industry-scope.js';
import { changeProductStock } from './products.repository.js';

const fail = (error: unknown): never => { throw error; };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.').nullable().optional();
export const batchSchema = z.object({
  productId: z.string().uuid(),
  batchNo: z.string().trim().min(1, 'Enter the batch number.').max(60),
  mfgDate: date, expiryDate: date,
  quantity: z.number().finite().min(0).max(1e8),
  /** true = these units are new and get added to the product's stock; false = they are already counted in stock. */
  isNewStock: z.boolean().optional(),
}).superRefine((v, ctx) => { if (v.mfgDate && v.expiryDate && v.expiryDate < v.mfgDate) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry cannot be before the manufacturing date.' }); });
export type BatchInput = z.infer<typeof batchSchema>;

async function productInScope(org: string, scope: IndustryScope, productId: string, requiredIndustryTypeId?: string | null) {
  const notFound = new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
  const { data: product, error } = await supabaseAdmin.from('products').select('id, product_name, stock_quantity').eq('organization_id', org).eq('id', productId).maybeSingle();
  if (error) fail(error);
  if (!product) throw notFound;
  if (!isGlobalRole(scope.role)) {
    const { data: tag } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', org).eq('product_id', productId).eq('industry_type_id', scope.lockedIndustryTypeId ?? '').maybeSingle();
    if (!tag) throw notFound;
  }
  if (requiredIndustryTypeId) {
    const { data: tag } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', org).eq('product_id', productId).eq('industry_type_id', requiredIndustryTypeId).maybeSingle();
    if (!tag) throw new AppError(422, 'PRODUCT_NOT_FMCG', 'This product is not part of the FMCG industry.');
  }
  return product as { id: string; product_name: string; stock_quantity: number | null };
}

export async function listBatches(org: string, industryTypeId: string | null) {
  let query = supabaseAdmin.from('product_batches').select('*').eq('organization_id', org).order('expiry_date', { ascending: true, nullsFirst: false }).limit(2000);
  if (industryTypeId) {
    const { data: tags, error } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', org).eq('industry_type_id', industryTypeId);
    if (error) fail(error);
    const ids = (tags ?? []).map((t) => t.product_id as string);
    if (ids.length === 0) return [];
    query = query.in('product_id', ids);
  }
  const { data, error } = await query;
  if (error) fail(error);
  return data ?? [];
}

async function batchedUnits(org: string, productId: string, exceptBatchId?: string) {
  const { data, error } = await supabaseAdmin.from('product_batches').select('id, quantity').eq('organization_id', org).eq('product_id', productId);
  if (error) fail(error);
  return (data ?? []).filter((b) => b.id !== exceptBatchId).reduce((s, b) => s + Number(b.quantity ?? 0), 0);
}

export async function createBatch(org: string, scope: IndustryScope, input: BatchInput, industryTypeId?: string | null) {
  const product = await productInScope(org, scope, input.productId, industryTypeId);
  const newStock = Boolean(input.isNewStock);
  if (!newStock) {
    const room = Number(product.stock_quantity ?? 0) - (await batchedUnits(org, input.productId));
    if (input.quantity > room + 1e-9) throw new AppError(422, 'BATCH_EXCEEDS_STOCK', `${product.product_name} only has ${Math.max(0, room)} unit(s) of stock not yet in a batch. Tick "This is new stock" if these units are being added now.`);
  }
  if (newStock && input.quantity > 0) await changeProductStock(org, input.productId, input.quantity, false);
  const { data, error } = await supabaseAdmin.from('product_batches').insert({ organization_id: org, product_id: input.productId, batch_no: input.batchNo, mfg_date: input.mfgDate || null, expiry_date: input.expiryDate || null, quantity: input.quantity }).select().single();
  if (error) {
    if (newStock && input.quantity > 0) await changeProductStock(org, input.productId, -input.quantity, true).catch(() => undefined);
    if ((error as { code?: string }).code === '23505') throw new AppError(409, 'BATCH_EXISTS', `Batch ${input.batchNo} already exists for this product.`);
    fail(error);
  }
  return data;
}

export async function updateBatch(org: string, scope: IndustryScope, id: string, input: { batchNo?: string; mfgDate?: string | null; expiryDate?: string | null; quantity?: number }, industryTypeId?: string | null) {
  const notFound = new AppError(404, 'BATCH_NOT_FOUND', 'Batch not found.');
  const { data: batch, error } = await supabaseAdmin.from('product_batches').select('*').eq('id', id).eq('organization_id', org).maybeSingle();
  if (error) fail(error);
  if (!batch) throw notFound;
  const product = await productInScope(org, scope, batch.product_id as string, industryTypeId);
  const patch: Record<string, unknown> = {};
  if (input.batchNo !== undefined) patch.batch_no = input.batchNo.trim();
  if (input.mfgDate !== undefined) patch.mfg_date = input.mfgDate || null;
  if (input.expiryDate !== undefined) patch.expiry_date = input.expiryDate || null;
  const mfg = (patch.mfg_date ?? batch.mfg_date) as string | null; const exp = (patch.expiry_date ?? batch.expiry_date) as string | null;
  if (mfg && exp && exp < mfg) throw new AppError(422, 'INVALID_DATES', 'Expiry cannot be before the manufacturing date.');
  if (input.quantity !== undefined) {
    const room = Number(product.stock_quantity ?? 0) - (await batchedUnits(org, batch.product_id as string, id));
    if (input.quantity > room + 1e-9) throw new AppError(422, 'BATCH_EXCEEDS_STOCK', `Only ${Math.max(0, room)} unit(s) of ${product.product_name} stock are free to put in this batch. Add stock in Inventory first.`);
    patch.quantity = input.quantity;
  }
  const { data, error: updateError } = await supabaseAdmin.from('product_batches').update(patch).eq('id', id).eq('organization_id', org).select().single();
  if (updateError) { if ((updateError as { code?: string }).code === '23505') throw new AppError(409, 'BATCH_EXISTS', 'That batch number already exists for this product.'); fail(updateError); }
  return data;
}

export async function deleteBatch(org: string, scope: IndustryScope, id: string) {
  const { data: batch, error } = await supabaseAdmin.from('product_batches').select('id, product_id').eq('id', id).eq('organization_id', org).maybeSingle();
  if (error) fail(error);
  const notFound = new AppError(404, 'BATCH_NOT_FOUND', 'Batch not found.');
  if (!batch) throw notFound;
  await productInScope(org, scope, batch.product_id as string).catch(() => { throw notFound; });
  // Deleting only removes the batch label; the units stay in the product's stock.
  const { error: deleteError } = await supabaseAdmin.from('product_batches').delete().eq('id', id).eq('organization_id', org);
  if (deleteError) fail(deleteError);
}

export { assertRecordInScope };
