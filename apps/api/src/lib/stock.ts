// FMCG stock engine: first-expiry-first-out batch picking, and one place that moves stock for an order.
// Products whose stock_quantity is empty (null) are "not tracked": orders for them never take or block stock.
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';
import { changeProductStock } from '../repositories/products.repository.js';

export type BatchPart = { batchId: string; batchNo: string; quantity: number; restocked?: number };
export type Allocation = { productId: string; total: number; batches: BatchPart[] };
export type StockLine = { id?: string; product_id: string | null; quantity: unknown; free_quantity?: unknown };

const num = (v: unknown) => Number(v ?? 0) || 0;
const fail = (error: unknown): never => { throw error; };

/** Adds (+) or removes (-) units from one batch using compare-and-swap, so two orders never overwrite each other. */
export async function changeBatch(org: string, batchId: string, delta: number) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: row, error } = await supabaseAdmin.from('product_batches').select('id, batch_no, quantity').eq('organization_id', org).eq('id', batchId).maybeSingle();
    if (error) fail(error);
    if (!row) return; // batch was deleted; the product total is still corrected by the caller
    const before = num(row.quantity);
    const after = before + delta;
    if (after < 0) throw new AppError(409, 'BATCH_STOCK_CHANGED', `Batch ${row.batch_no} no longer has enough stock. Please try again.`);
    const { data: updated, error: updateError } = await supabaseAdmin.from('product_batches').update({ quantity: after }).eq('organization_id', org).eq('id', batchId).eq('quantity', row.quantity).select('id').maybeSingle();
    if (updateError) fail(updateError);
    if (updated) return;
  }
  throw new AppError(409, 'STOCK_CHANGED', 'Stock was changed by someone else at the same moment. Please try again.');
}

/** Works out which batches each product line will be picked from (earliest expiry first, expired batches never). Does not change anything. */
export async function planAllocations(org: string, lines: StockLine[]): Promise<Map<string, Allocation[]>> {
  const need = new Map<string, number>();
  for (const line of lines) if (line.product_id) need.set(line.product_id, (need.get(line.product_id) ?? 0) + num(line.quantity) + num(line.free_quantity));
  const productIds = [...need.keys()];
  const plan = new Map<string, Allocation[]>(); // keyed by line index ("0","1",...) so duplicate products stay separate
  if (productIds.length === 0) return plan;

  const { data: products, error } = await supabaseAdmin.from('products').select('id, product_name, stock_quantity').eq('organization_id', org).in('id', productIds);
  if (error) fail(error);
  const tracked = new Map((products ?? []).filter((p) => p.stock_quantity != null).map((p) => [p.id as string, p]));

  const today = new Date().toISOString().slice(0, 10);
  const { data: batchRows, error: batchError } = await supabaseAdmin.from('product_batches').select('id, product_id, batch_no, expiry_date, quantity').eq('organization_id', org).in('product_id', productIds).gt('quantity', 0).order('expiry_date', { ascending: true, nullsFirst: false });
  if (batchError) fail(batchError);
  const pool = new Map<string, { id: string; batch_no: string; left: number }[]>();
  const expiredUnits = new Map<string, number>();
  for (const b of batchRows ?? []) {
    if (b.expiry_date && String(b.expiry_date) < today) { expiredUnits.set(b.product_id as string, (expiredUnits.get(b.product_id as string) ?? 0) + num(b.quantity)); continue; }
    const list = pool.get(b.product_id as string) ?? [];
    list.push({ id: b.id as string, batch_no: b.batch_no as string, left: num(b.quantity) });
    pool.set(b.product_id as string, list);
  }

  for (const [productId, qty] of need) {
      const product = tracked.get(productId);
    const expired = expiredUnits.get(productId) ?? 0;
    if (product && expired > 0 && qty > num(product.stock_quantity) - expired + 1e-9 && qty <= num(product.stock_quantity) + 1e-9) {
      throw new AppError(422, 'INSUFFICIENT_STOCK', `Not enough in-date stock for ${product.product_name}: ${Math.max(0, num(product.stock_quantity) - expired)} usable, ${expired} expired, ${qty} needed.`);
    }
    if (product && qty > num(product.stock_quantity) + 1e-9) {
      throw new AppError(422, 'INSUFFICIENT_STOCK', `Not enough stock for ${product.product_name}: ${Math.max(0, num(product.stock_quantity))} available, ${qty} needed.`);
    }
  }

  lines.forEach((line, index) => {
    if (!line.product_id || !tracked.has(line.product_id)) return;
    let remaining = num(line.quantity) + num(line.free_quantity);
    const total = remaining;
    const batches: BatchPart[] = [];
    for (const b of pool.get(line.product_id) ?? []) {
      if (remaining <= 0) break;
      const take = Math.min(b.left, remaining);
      if (take <= 0) continue;
      b.left -= take; remaining -= take;
      batches.push({ batchId: b.id, batchNo: b.batch_no, quantity: take });
    }
    plan.set(String(index), [{ productId: line.product_id, total, batches }]);
  });
  return plan;
}

/** Moves stock for a list of allocations. direction 'take' removes, 'give' puts back. Undoes itself if any step fails. */
export async function applyAllocations(org: string, allocations: Allocation[], direction: 'take' | 'give') {
  const sign = direction === 'take' ? -1 : 1;
  const done: { kind: 'product' | 'batch'; id: string; delta: number }[] = [];
  try {
    for (const a of allocations) {
      for (const part of a.batches) { await changeBatch(org, part.batchId, sign * part.quantity); done.push({ kind: 'batch', id: part.batchId, delta: sign * part.quantity }); }
      await changeProductStock(org, a.productId, sign * a.total, direction === 'give');
      done.push({ kind: 'product', id: a.productId, delta: sign * a.total });
    }
  } catch (error) {
    for (const step of done.reverse()) {
      if (step.kind === 'batch') await changeBatch(org, step.id, -step.delta).catch(() => undefined);
      else await changeProductStock(org, step.id, -step.delta, true).catch(() => undefined);
    }
    throw error;
  }
}

const readAllocation = (raw: unknown): Allocation | null => {
  const a = raw as Allocation | null;
  return a && typeof a === 'object' && a.productId && Array.isArray(a.batches) ? a : null;
};

/** Takes stock for every line of an order and remembers exactly what each line took. Throws INSUFFICIENT_STOCK (nothing changed) when short. */
export async function takeStockForOrder(org: string, orderId: string) {
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, stock_deducted').eq('organization_id', org).eq('id', orderId).maybeSingle();
  if (error) fail(error);
  if (!order || order.stock_deducted) return;
  const { data: lines, error: lineError } = await supabaseAdmin.from('sale_order_items').select('id, product_id, quantity, free_quantity').eq('order_id', orderId);
  if (lineError) fail(lineError);
  const rows = (lines ?? []) as StockLine[];
  const plan = await planAllocations(org, rows);
  const all = [...plan.values()].flat();
  await applyAllocations(org, all, 'take');
  try {
    for (const [index, allocs] of plan) {
      const { error: saveError } = await supabaseAdmin.from('sale_order_items').update({ batch_allocations: allocs[0] }).eq('id', rows[Number(index)].id as string);
      if (saveError) fail(saveError);
    }
    const { error: flagError } = await supabaseAdmin.from('sale_orders').update({ stock_deducted: true }).eq('organization_id', org).eq('id', orderId);
    if (flagError) fail(flagError);
  } catch (e) {
    await applyAllocations(org, all, 'give').catch(() => undefined);
    throw e;
  }
}

/** Gives back exactly what the order took (same batches, same quantities). Safe to call twice. */
export async function releaseStockForOrder(org: string, orderId: string) {
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, stock_deducted').eq('organization_id', org).eq('id', orderId).maybeSingle();
  if (error) fail(error);
  if (!order?.stock_deducted) return;
  const { data: lines, error: lineError } = await supabaseAdmin.from('sale_order_items').select('id, batch_allocations').eq('order_id', orderId);
  if (lineError) fail(lineError);
  const allocs = (lines ?? []).map((l) => readAllocation(l.batch_allocations)).filter((a): a is Allocation => a !== null);
  await applyAllocations(org, allocs, 'give');
  const { error: flagError } = await supabaseAdmin.from('sale_orders').update({ stock_deducted: false }).eq('organization_id', org).eq('id', orderId);
  if (flagError) fail(flagError);
}

/** Puts `quantity` units of one product from an order back on the shelf, into the batches they came from. */
/** Puts `quantity` units of one product from an order back on the shelf, into the batches they came from.
 *  Each batch part remembers how much was already restocked, so repeated returns never put back more than that batch gave. */
export async function restockFromOrder(org: string, orderId: string, productId: string, quantity: number): Promise<boolean> {
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, stock_deducted').eq('organization_id', org).eq('id', orderId).maybeSingle();
  if (error) fail(error);
  if (!order?.stock_deducted) return false;
  const { data: lines, error: lineError } = await supabaseAdmin.from('sale_order_items').select('id, batch_allocations').eq('order_id', orderId).eq('product_id', productId);
  if (lineError) fail(lineError);
  const tracked = (lines ?? []).map((l) => ({ id: l.id as string, alloc: readAllocation(l.batch_allocations) })).filter((l): l is { id: string; alloc: Allocation } => l.alloc !== null);
  if (tracked.length === 0) return false; // product was not tracked when the order was saved
  let left = quantity;
  const back: Allocation = { productId, total: quantity, batches: [] };
  const marked: { id: string; alloc: Allocation }[] = [];
  for (const line of tracked) {
    const copy: Allocation = { ...line.alloc, batches: line.alloc.batches.map((p) => ({ ...p })) };
    for (const part of copy.batches) {
      if (left <= 0) break;
      const give = Math.min(num(part.quantity) - num(part.restocked), left);
      if (give <= 0) continue;
      left -= give; part.restocked = num(part.restocked) + give; back.batches.push({ batchId: part.batchId, batchNo: part.batchNo, quantity: give });
    }
    marked.push({ id: line.id, alloc: copy });
  }
  await applyAllocations(org, [back], 'give');
  for (const m of marked) {
    const { error: saveError } = await supabaseAdmin.from('sale_order_items').update({ batch_allocations: m.alloc }).eq('id', m.id);
    if (saveError) { await applyAllocations(org, [back], 'take').catch(() => undefined); fail(saveError); }
  }
  return true;
}   

export { readAllocation };