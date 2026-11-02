// Stock engine: first-expiry-first-out batch picking for FMCG (product_batches) and Pharma (pharma_batches),
// and one place that moves stock for an order.
// Products whose stock_quantity is empty (null) are "not tracked": orders for them never take or block stock.
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';
import { changeProductStock } from '../repositories/products.repository.js';
import { getFmcgExpiryRules, getPharmaExpiryRules } from './settings.js';
import { BATCH_BLOCKED, PHARMA_BLOCK_SALE_DAYS, daysLeft } from './pharma-rules.js';

export type BatchPart = { batchId: string; batchNo: string; quantity: number; restocked?: number; src?: 'pharma' };
export type Allocation = { productId: string; total: number; batches: BatchPart[] };
export type StockLine = { id?: string; product_id: string | null; quantity: unknown; free_quantity?: unknown };

const num = (v: unknown) => Number(v ?? 0) || 0;
const fail = (error: unknown): never => { throw error; };

/** Adds (+) or removes (-) units from one batch using compare-and-swap, so two orders never overwrite each other.
 *  src 'pharma' = the Pharma > Batch & Expiry table, otherwise the FMCG product_batches table. */
export async function changeBatch(org: string, batchId: string, delta: number, src?: 'pharma', source = 'Order stock') {
  const table = src === 'pharma' ? 'pharma_batches' : 'product_batches';
  const noCol = src === 'pharma' ? 'batch_number' : 'batch_no';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: row, error } = await supabaseAdmin.from(table).select(`id, ${noCol}, quantity`).eq('organization_id', org).eq('id', batchId).maybeSingle();
    if (error) fail(error);
    if (!row) return; // batch was deleted; the product total is still corrected by the caller
    const before = num(row.quantity);
    const after = before + delta;
    if (after < 0) throw new AppError(409, 'BATCH_STOCK_CHANGED', `Batch ${(row as unknown as Record<string, unknown>)[noCol]} no longer has enough stock. Please try again.`);
    const { data: updated, error: updateError } = await supabaseAdmin.from(table).update({ quantity: after }).eq('organization_id', org).eq('id', batchId).eq('quantity', row.quantity).select('id').maybeSingle();
    if (updateError) fail(updateError);
    if (updated) {
      // Pharma: every order take / give-back lands in the same stock audit log as manual changes (best effort, never blocks the sale).
      if (src === 'pharma' && delta !== 0) {
        try { await supabaseAdmin.from('pharma_stock_movements').insert({ organization_id: org, batch_id: batchId, batch_number: String((row as unknown as Record<string, unknown>)[noCol] ?? ''), delta, source, actor: null, note: null }); } catch { /* audit is best effort */ }
      }
      return;
    }
  }
  throw new AppError(409, 'STOCK_CHANGED', 'Stock was changed by someone else at the same moment. Please try again.');
}

/** Whole days from today until a batch's expiry date (negative = already expired). Both sides are UTC dates. */
export const daysUntilExpiry = (expiryDate: string, today: string) => Math.round((Date.parse(expiryDate.slice(0, 10)) - Date.parse(today)) / 86_400_000);

/** Works out which batches each product line will be picked from (earliest expiry first).
 *  FMCG: a batch is skipped when it is expired, or within the FMCG "Block sale within (days) of expiry" Setting.
 *  Pharma: products that have Pharma batches sell only from valid Pharma batches (never Expired / Recalled / Quarantined). Does not change anything. */
export async function planAllocations(org: string, lines: StockLine[]): Promise<Map<string, Allocation[]>> {
  const need = new Map<string, number>();
  for (const line of lines) if (line.product_id) need.set(line.product_id, (need.get(line.product_id) ?? 0) + num(line.quantity) + num(line.free_quantity));
  const productIds = [...need.keys()];
  const plan = new Map<string, Allocation[]>(); // keyed by line index ("0","1",...) so duplicate products stay separate
  if (productIds.length === 0) return plan;

  const { data: products, error } = await supabaseAdmin.from('products').select('id, product_name, product_code, stock_quantity').eq('organization_id', org).in('id', productIds);
  if (error) fail(error);
  const tracked = new Map((products ?? []).filter((p) => p.stock_quantity != null).map((p) => [p.id as string, p]));

  const today = new Date().toISOString().slice(0, 10);
  const blockDays = (await getFmcgExpiryRules(org)).blockSaleWithinDaysOfExpiry;
  const pharmaBlockDays = Math.max(PHARMA_BLOCK_SALE_DAYS, (await getPharmaExpiryRules(org)).blockSaleWithinDaysOfExpiry);
  const { data: batchRows, error: batchError } = await supabaseAdmin.from('product_batches').select('id, product_id, batch_no, expiry_date, quantity').eq('organization_id', org).in('product_id', productIds).gt('quantity', 0).order('expiry_date', { ascending: true, nullsFirst: false });
  if (batchError) fail(batchError);
  const pool = new Map<string, { id: string; batch_no: string; left: number; src?: 'pharma' }[]>();

  // Pharma: products that have Pharma batches sell from Pharma > Batch & Expiry (soonest expiry first).
  const codeToId = new Map((products ?? []).filter((p) => p.product_code).map((p) => [String(p.product_code), p.id as string]));
  const pharmaSellable = new Map<string, number>();
  const pharmaProducts = new Set<string>();
  if (codeToId.size > 0) {
    const { data: ph, error: phError } = await supabaseAdmin.from('pharma_batches').select('id, product_code, batch_number, expiry_date, quantity, status').eq('organization_id', org).in('product_code', [...codeToId.keys()]).order('expiry_date', { ascending: true });
    if (phError && (phError as { code?: string }).code !== '42P01') fail(phError);
    for (const b of ph ?? []) {
      const pid = codeToId.get(String(b.product_code)); if (!pid) continue;
      pharmaProducts.add(pid);
      const d = daysLeft(b.expiry_date, today);
      const blocked = BATCH_BLOCKED.includes(String(b.status)) || (d !== null && (d < 0 || d <= pharmaBlockDays));
      if (blocked || num(b.quantity) <= 0) continue;
      const list = pool.get(pid) ?? [];
      list.push({ id: b.id as string, batch_no: String(b.batch_number), left: num(b.quantity), src: 'pharma' });
      pool.set(pid, list);
      pharmaSellable.set(pid, (pharmaSellable.get(pid) ?? 0) + num(b.quantity));
    }
  }

  const expiredUnits = new Map<string, number>();
  const closeUnits = new Map<string, number>();
  for (const b of batchRows ?? []) {
    const pid = b.product_id as string;
    if (pharmaProducts.has(pid)) continue; // Pharma batches rule for this product
    const days = b.expiry_date ? daysUntilExpiry(String(b.expiry_date), today) : null;
    if (days !== null && days < 0) { expiredUnits.set(pid, (expiredUnits.get(pid) ?? 0) + num(b.quantity)); continue; }
    if (days !== null && blockDays > 0 && days <= blockDays) { closeUnits.set(pid, (closeUnits.get(pid) ?? 0) + num(b.quantity)); continue; }
    const list = pool.get(pid) ?? [];
    list.push({ id: b.id as string, batch_no: b.batch_no as string, left: num(b.quantity) });
    pool.set(pid, list);
  }

  for (const [productId, qty] of need) {
    const product = tracked.get(productId);
    if (!product) continue;
    if (pharmaProducts.has(productId)) {
      const sellable = pharmaSellable.get(productId) ?? 0;
      if (qty > sellable + 1e-9) throw new AppError(422, 'INSUFFICIENT_STOCK', `Not enough sellable stock for ${product.product_name}: ${sellable} in valid batches (expired, recalled and quarantined batches cannot be sold), ${qty} needed.`);
      continue;
    }
    const stock = num(product.stock_quantity);
    const expired = expiredUnits.get(productId) ?? 0;
    const close = closeUnits.get(productId) ?? 0;
    const locked = expired + close;
    if (locked > 0 && qty > stock - locked + 1e-9 && qty <= stock + 1e-9) {
      const parts = [expired > 0 ? `${expired} expired` : '', close > 0 ? `${close} within ${blockDays} day(s) of expiry` : ''].filter(Boolean).join(', ');
      throw new AppError(422, 'INSUFFICIENT_STOCK', `Not enough sellable stock for ${product.product_name}: ${Math.max(0, stock - locked)} sellable, ${parts}, ${qty} needed.`);
    }
    if (qty > stock + 1e-9) {
      throw new AppError(422, 'INSUFFICIENT_STOCK', `Not enough stock for ${product.product_name}: ${Math.max(0, stock)} available, ${qty} needed.`);
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
      batches.push({ batchId: b.id, batchNo: b.batch_no, quantity: take, ...(b.src ? { src: b.src } : {}) });
    }
    plan.set(String(index), [{ productId: line.product_id, total, batches }]);
  });
  return plan;
}

/** Moves stock for a list of allocations. direction 'take' removes, 'give' puts back. Undoes itself if any step fails. */
export async function applyAllocations(org: string, allocations: Allocation[], direction: 'take' | 'give', source = 'Order stock') {
  const sign = direction === 'take' ? -1 : 1;
  const done: { kind: 'product' | 'batch'; id: string; delta: number; src?: 'pharma' }[] = [];
  try {
    for (const a of allocations) {
      for (const part of a.batches) { await changeBatch(org, part.batchId, sign * part.quantity, part.src, source); done.push({ kind: 'batch', id: part.batchId, delta: sign * part.quantity, src: part.src }); }
      await changeProductStock(org, a.productId, sign * a.total, direction === 'give');
      done.push({ kind: 'product', id: a.productId, delta: sign * a.total });
    }
  } catch (error) {
    for (const step of done.reverse()) {
      if (step.kind === 'batch') await changeBatch(org, step.id, -step.delta, step.src, `${source} (rolled back)`).catch(() => undefined);
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
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, order_number, stock_deducted').eq('organization_id', org).eq('id', orderId).maybeSingle();
  if (error) fail(error);
  if (!order || order.stock_deducted) return;
  const { data: lines, error: lineError } = await supabaseAdmin.from('sale_order_items').select('id, product_id, quantity, free_quantity').eq('order_id', orderId);
  if (lineError) fail(lineError);
  const rows = (lines ?? []) as StockLine[];
  const plan = await planAllocations(org, rows);
  const all = [...plan.values()].flat();
  await applyAllocations(org, all, 'take', `Order ${String((order as { order_number?: string }).order_number ?? orderId)} confirmed`);
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
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, order_number, stock_deducted').eq('organization_id', org).eq('id', orderId).maybeSingle();
  if (error) fail(error);
  if (!order?.stock_deducted) return;
  const { data: lines, error: lineError } = await supabaseAdmin.from('sale_order_items').select('id, batch_allocations').eq('order_id', orderId);
  if (lineError) fail(lineError);
  const allocs = (lines ?? []).map((l) => readAllocation(l.batch_allocations)).filter((a): a is Allocation => a !== null);
  await applyAllocations(org, allocs, 'give', `Order ${String((order as { order_number?: string }).order_number ?? orderId)} released`);
  const { error: flagError } = await supabaseAdmin.from('sale_orders').update({ stock_deducted: false }).eq('organization_id', org).eq('id', orderId);
  if (flagError) fail(flagError);
}

/** Puts `quantity` units of one product from an order back on the shelf, into the batches they came from.
 *  Each batch part remembers how much was already restocked, so repeated returns never put back more than that batch gave. */
export async function restockFromOrder(org: string, orderId: string, productId: string, quantity: number): Promise<boolean> {
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, order_number, stock_deducted').eq('organization_id', org).eq('id', orderId).maybeSingle();
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
      left -= give; part.restocked = num(part.restocked) + give; back.batches.push({ batchId: part.batchId, batchNo: part.batchNo, quantity: give, ...(part.src ? { src: part.src } : {}) });
    }
    marked.push({ id: line.id, alloc: copy });
  }
  await applyAllocations(org, [back], 'give', `Order ${String((order as { order_number?: string }).order_number ?? orderId)} return restocked`);
  for (const m of marked) {
    const { error: saveError } = await supabaseAdmin.from('sale_order_items').update({ batch_allocations: m.alloc }).eq('id', m.id);
    if (saveError) { await applyAllocations(org, [back], 'take').catch(() => undefined); fail(saveError); }
  }
  return true;
}

export { readAllocation };

/** Which industries move stock on an order: FMCG (product batches) and Pharma (pharma batches). */
export async function tracksOrderStock(org: string, industryTypeId?: string | null): Promise<boolean> {
  if (!industryTypeId) return false;
  const { data } = await supabaseAdmin.from('industry_types').select('code').eq('organization_id', org).eq('id', industryTypeId).maybeSingle();
  return ['fmcg', 'pharma'].includes(String((data as { code?: string } | null)?.code ?? '').toLowerCase());
}