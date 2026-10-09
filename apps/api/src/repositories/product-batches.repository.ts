// FMCG batch & expiry. Batches are slices of a product's stock (sum of batches <= product stock).
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope, isGlobalRole, type IndustryScope } from '../lib/industry-scope.js';
import { changeProductStock } from './products.repository.js';
import { changeBatch } from '../lib/stock.js';
import { getFmcgExpiryRules } from '../lib/settings.js';

const fail = (error: unknown): never => { throw error; };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.').nullable().optional();
export const batchSchema = z.object({
  productId: z.string().uuid(),
  /** Leave empty and the system numbers the batch itself. */
  batchNo: z.string().trim().max(60).optional(),
  mfgDate: date, expiryDate: date,
  quantity: z.number().finite().min(0).max(1e8),
  /** true = these units are new and get added to the product's stock; false = they are already counted in stock. */
  isNewStock: z.boolean().optional(),
  /** Used to work out the expiry date; saved on the product the first time so it is never typed again. */
  shelfLifeDays: z.number().int().positive().max(36500).optional(),
}).superRefine((v, ctx) => { if (v.mfgDate && v.expiryDate && v.expiryDate < v.mfgDate) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry cannot be before the manufacturing date.' }); });
export type BatchInput = z.infer<typeof batchSchema>;

/** yyyy-mm-dd plus N days (UTC, so it never shifts with the server's time zone). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** <product code>-<yymmdd of manufacture>-<running no.>, e.g. BEV-DAIR-761-261008-01. Skips numbers already used by that product. */
export function autoBatchNo(productCode: string, mfgDate: string | null | undefined, existing: string[], today = new Date().toISOString().slice(0, 10)): string {
  const day = (mfgDate || today).replace(/-/g, '').slice(2);
  const prefix = `${productCode}-${day}`;
  const used = new Set(existing.map((n) => n.toLowerCase()));
  for (let n = 1; n < 1000; n += 1) {
    const candidate = `${prefix}-${String(n).padStart(2, '0')}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${prefix}-${Date.now()}`;
}

async function productInScope(org: string, scope: IndustryScope, productId: string, requiredIndustryTypeId?: string | null) {
  const notFound = new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
  const { data: product, error } = await supabaseAdmin.from('products').select('id, product_name, product_code, stock_quantity, shelf_life_days').eq('organization_id', org).eq('id', productId).maybeSingle();
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
  return product as { id: string; product_name: string; product_code: string; stock_quantity: number | null; shelf_life_days: number | null };
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
    if (input.quantity > room + 1e-9) throw new AppError(422, 'BATCH_EXCEEDS_STOCK', `${product.product_name} only has ${Math.max(0, room)} unit(s) of stock not yet in a batch. Choose "New stock received" if these units are being added now.`);
  }

  // Expiry: typed date wins; otherwise manufacturing date + the product's shelf life.
  const shelfLife = input.shelfLifeDays ?? product.shelf_life_days ?? null;
  const mfgDate = input.mfgDate || null;
  const expiryDate = input.expiryDate || (mfgDate && shelfLife ? addDays(mfgDate, shelfLife) : null);
  if (industryTypeId && !expiryDate && (await getFmcgExpiryRules(org)).expiryMandatory) {
    throw new AppError(422, 'EXPIRY_REQUIRED', 'Expiry is required. Enter the expiry date, or the manufacturing date and the product\'s shelf life.');
  }
  if (mfgDate && expiryDate && expiryDate < mfgDate) throw new AppError(422, 'INVALID_DATES', 'Expiry cannot be before the manufacturing date.');

  // Batch number: typed one wins; otherwise numbered automatically.
  let batchNo = (input.batchNo ?? '').trim();
  if (!batchNo) {
    const { data: used, error: usedError } = await supabaseAdmin.from('product_batches').select('batch_no').eq('organization_id', org).eq('product_id', input.productId);
    if (usedError) fail(usedError);
    batchNo = autoBatchNo(product.product_code, mfgDate, (used ?? []).map((b) => String(b.batch_no)));
  }

  // First time a shelf life is entered, keep it on the product.
  if (input.shelfLifeDays && !product.shelf_life_days) {
    const { error: shelfError } = await supabaseAdmin.from('products').update({ shelf_life_days: input.shelfLifeDays }).eq('organization_id', org).eq('id', input.productId);
    if (shelfError) fail(shelfError);
  }

  if (newStock && input.quantity > 0) await changeProductStock(org, input.productId, input.quantity, false);
  const { data, error } = await supabaseAdmin.from('product_batches').insert({ organization_id: org, product_id: input.productId, batch_no: batchNo, mfg_date: mfgDate, expiry_date: expiryDate, quantity: input.quantity }).select().single();
  if (error) {
    if (newStock && input.quantity > 0) await changeProductStock(org, input.productId, -input.quantity, true).catch(() => undefined);
    if ((error as { code?: string }).code === '23505') throw new AppError(409, 'BATCH_EXISTS', `Batch ${batchNo} already exists for this product.`);
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
  const { data: batch, error } = await supabaseAdmin.from('product_batches').select('id, product_id, batch_no, quantity').eq('id', id).eq('organization_id', org).maybeSingle();
  if (error) fail(error);
  const notFound = new AppError(404, 'BATCH_NOT_FOUND', 'Batch not found.');
  if (!batch) throw notFound;
  await productInScope(org, scope, batch.product_id as string).catch(() => { throw notFound; });
  // Removing a batch that still holds units would leave those units counted in the product's stock with no batch/expiry.
  if (Number(batch.quantity ?? 0) > 0) throw new AppError(422, 'BATCH_HAS_STOCK', `Batch ${batch.batch_no} still has ${batch.quantity} unit(s). Use "Write off" to remove them from stock first.`);
  const { error: deleteError } = await supabaseAdmin.from('product_batches').delete().eq('id', id).eq('organization_id', org);
  if (deleteError) fail(deleteError);
}

export const writeOffSchema = z.object({
  /** Units to write off; leave out to write off everything left in the batch. */
  quantity: z.number().finite().positive().max(1e8).optional(),
  reason: z.enum(['expired', 'damaged', 'other']),
  remarks: z.string().trim().max(300).optional(),
});
export type WriteOffInput = z.infer<typeof writeOffSchema>;
const WRITE_OFF_REASON = { expired: 'Expired stock written off', damaged: 'Damaged stock written off', other: 'Stock written off' } as const;

/** Takes units out of ONE batch and out of the product's stock together, and records an inventory movement (type adjustment, with the batch and reason) so the loss is traceable. */
export async function writeOffBatch(org: string, userId: string, scope: IndustryScope, id: string, input: WriteOffInput, industryTypeId?: string | null) {
  const { data: batch, error } = await supabaseAdmin.from('product_batches').select('*').eq('id', id).eq('organization_id', org).maybeSingle();
  if (error) fail(error);
  if (!batch) throw new AppError(404, 'BATCH_NOT_FOUND', 'Batch not found.');
  await productInScope(org, scope, batch.product_id as string, industryTypeId);
  const have = Number(batch.quantity ?? 0);
  const qty = input.quantity ?? have;
  if (have <= 0) throw new AppError(422, 'NOTHING_TO_WRITE_OFF', `Batch ${batch.batch_no} has no units left.`);
  if (qty > have + 1e-9) throw new AppError(422, 'WRITE_OFF_TOO_MUCH', `Batch ${batch.batch_no} only has ${have} unit(s).`);

  await changeBatch(org, id, -qty);
  try { await changeProductStock(org, batch.product_id as string, -qty, false); } catch (stockError) {
    await changeBatch(org, id, qty).catch(() => undefined);
    throw stockError;
  }
  const undo = async () => {
    await changeProductStock(org, batch.product_id as string, qty, true).catch(() => undefined);
    await changeBatch(org, id, qty).catch(() => undefined);
  };
  const { data: profile } = await supabaseAdmin.from('user_profiles').select('display_name').eq('id', userId).maybeSingle();
  const { data: movement, error: movementError } = await supabaseAdmin.from('inventory_movements').insert({
    organization_id: org, product_id: batch.product_id, representative_id: null, movement_type: 'adjustment', quantity: -qty,
    batch: batch.batch_no, mfg_date: batch.mfg_date ?? null, expiry_date: batch.expiry_date ?? null,
    reference: `WO-${batch.batch_no}`, reason: WRITE_OFF_REASON[input.reason], remarks: input.remarks || null,
    created_by: userId, created_by_name: profile?.display_name ?? null,
  }).select().single();
  if (movementError) { await undo(); fail(movementError); }
  const { data: updated } = await supabaseAdmin.from('product_batches').select('*').eq('id', id).eq('organization_id', org).maybeSingle();
  return { batch: updated, movement, writtenOff: qty };
}

export { assertRecordInScope };
