import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { isGlobalRole, type IndustryScope } from '../lib/industry-scope.js';
import { changeProductStock, listProducts } from './products.repository.js';
import { changeBatch } from '../lib/stock.js';
import { assertApprovedRequest, markRequestFulfilled } from './stock-requests.repository.js';

const fail = (error: unknown): never => { throw error; };
export type MovementType = 'stock_in' | 'adjustment' | 'transfer' | 'assign' | 'return';
type MovementRow = { id: string; product_id: string; representative_id: string | null; movement_type: MovementType; quantity: number; created_at: string; [k: string]: unknown };
type OrderRow = { created_at: string; status: string; representative_id: string | null; sale_order_items?: { product_id: string | null; quantity: number; free_quantity?: number | null }[] };
export type Holding = { product_id: string; representative_id: string; assigned: number; returned: number; sold: number; balance: number };

// Orders in these statuses are not real sales.
const NOT_SOLD = new Set(['cancelled', 'rejected', 'pending_approval']);

/**
 * One place that works out what every rep holds, so the screen and the validation can never disagree.
 *  assigned = total ever assigned, returned = total handed back,
 *  sold     = quantity on this rep's real orders placed AFTER the first assignment of that product to that rep
 *             (an older order never "auto-sells" newly assigned stock), capped at what the rep still had,
 *  balance  = assigned - returned - sold  (what the rep still carries).
 */
export function computeHoldings(movements: MovementRow[], orders: OrderRow[]): Holding[] {
  const map = new Map<string, Holding & { firstAssignedAt: string }>();
  for (const m of [...movements].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    if ((m.movement_type !== 'assign' && m.movement_type !== 'return') || !m.representative_id) continue;
    const key = `${m.representative_id}|${m.product_id}`;
    const h = map.get(key) ?? { product_id: m.product_id, representative_id: m.representative_id, assigned: 0, returned: 0, sold: 0, balance: 0, firstAssignedAt: m.created_at };
    if (m.movement_type === 'assign') h.assigned += Number(m.quantity); else h.returned += Number(m.quantity);
    map.set(key, h);
  }
  const ordered = new Map<string, number>();
  for (const order of orders) {
    if (NOT_SOLD.has(order.status) || !order.representative_id) continue;
    for (const line of order.sale_order_items ?? []) {
      if (!line.product_id) continue;
      const key = `${order.representative_id}|${line.product_id}`;
      const h = map.get(key);
      if (!h || order.created_at < h.firstAssignedAt) continue;
      // Free units leave the rep's bag too (the order takes quantity + free_quantity from stock), so they count as sold.
      ordered.set(key, (ordered.get(key) ?? 0) + Number(line.quantity || 0) + Number(line.free_quantity || 0));
    }
  }
  return Array.from(map.entries()).map(([key, h]) => {
    const sold = Math.min(ordered.get(key) ?? 0, Math.max(0, h.assigned - h.returned));
    return { product_id: h.product_id, representative_id: h.representative_id, assigned: h.assigned, returned: h.returned, sold, balance: h.assigned - h.returned - sold };
  });
}

async function loadOrders(org: string, repIds: string[], since: string | null): Promise<OrderRow[]> {
  if (repIds.length === 0 || !since) return [];
  const { data, error } = await supabaseAdmin.from('sale_orders').select('created_at, status, representative_id, sale_order_items(product_id, quantity, free_quantity)').eq('organization_id', org).in('representative_id', repIds).gte('created_at', since);
  if (error) fail(error);
  return (data ?? []) as unknown as OrderRow[];
}

async function movementsFor(org: string, productIds: string[]): Promise<MovementRow[]> {
  if (productIds.length === 0) return [];
  const { data, error } = await supabaseAdmin.from('inventory_movements').select('*').eq('organization_id', org).in('product_id', productIds).order('created_at', { ascending: false });
  if (error) fail(error);
  return (data ?? []) as MovementRow[];
}

async function holdingsFor(org: string, movements: MovementRow[]) {
  const assigns = movements.filter((m) => m.movement_type === 'assign' && m.representative_id);
  const since = assigns.reduce<string | null>((min, m) => (!min || m.created_at < min ? m.created_at : min), null);
  const repIds = Array.from(new Set(assigns.map((m) => m.representative_id as string)));
  return computeHoldings(movements, await loadOrders(org, repIds, since));
}

export async function inventoryOverview(org: string, industryTypeId: string | null) {
  const products = await listProducts(org, undefined, undefined, industryTypeId ?? undefined);
  const movements = await movementsFor(org, products.map((p) => p.id as string));
  return { movements, holdings: await holdingsFor(org, movements) };
}

async function assertProduct(org: string, productId: string, scope: IndustryScope) {
  const { data: product, error } = await supabaseAdmin.from('products').select('id, product_name, stock_quantity').eq('organization_id', org).eq('id', productId).maybeSingle();
  if (error) fail(error);
  const notFound = new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
  if (!product) throw notFound;
  if (!isGlobalRole(scope.role)) {
    const { data: tag } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', org).eq('product_id', productId).eq('industry_type_id', scope.lockedIndustryTypeId ?? '').maybeSingle();
    if (!tag) throw notFound;
  }
  return product as { id: string; product_name: string; stock_quantity: number | null };
}

export type MovementInput = {
  type: MovementType; productId: string; quantity: number; representativeId?: string | null;
  fromLocation?: string | null; toLocation?: string | null; batch?: string | null; mfgDate?: string | null; expiryDate?: string | null;
  reference?: string | null; reason?: string | null; remarks?: string | null; allowNegative?: boolean; requestId?: string | null;
};

/** Puts newly received units into their batch (creating the batch if it is new), so batch & expiry pages, first-expiry-first-out picking and the expired-stock block all see them. Returns an undo function. */
async function addToBatch(org: string, productId: string, input: MovementInput): Promise<(() => Promise<void>) | null> {
  const batchNo = (input.batch ?? '').trim();
  if (!batchNo) return null;
  const mfg = input.mfgDate || null;
  const exp = input.expiryDate || null;
  const { data: existing, error } = await supabaseAdmin.from('product_batches').select('id, quantity, mfg_date, expiry_date').eq('organization_id', org).eq('product_id', productId).eq('batch_no', batchNo).maybeSingle();
  if (error) fail(error);
  if (existing) {
    if (exp && existing.expiry_date && String(existing.expiry_date) !== exp) throw new AppError(422, 'BATCH_EXPIRY_MISMATCH', `Batch ${batchNo} already exists with expiry ${existing.expiry_date}. Use the same expiry date or a new batch number.`);
    const patch: Record<string, unknown> = {};
    if (!existing.expiry_date && exp) patch.expiry_date = exp;
    if (!existing.mfg_date && mfg) patch.mfg_date = mfg;
    if (Object.keys(patch).length) { const { error: patchError } = await supabaseAdmin.from('product_batches').update(patch).eq('organization_id', org).eq('id', existing.id); if (patchError) fail(patchError); }
    await changeBatch(org, existing.id as string, input.quantity);
    return async () => { await changeBatch(org, existing.id as string, -input.quantity); };
  }
  const { data: created, error: insertError } = await supabaseAdmin.from('product_batches').insert({ organization_id: org, product_id: productId, batch_no: batchNo, mfg_date: mfg, expiry_date: exp, quantity: input.quantity }).select('id').single();
  if (insertError) fail(insertError);
  return async () => { await supabaseAdmin.from('product_batches').delete().eq('organization_id', org).eq('id', created.id); };
}

/** After stock is written down, batches must never hold more units than the product has: trim the excess, earliest expiry (expired first) first. */
async function trimBatchesToStock(org: string, productId: string) {
  const { data: product } = await supabaseAdmin.from('products').select('stock_quantity').eq('organization_id', org).eq('id', productId).maybeSingle();
  if (!product || product.stock_quantity == null) return;
  const { data: batches } = await supabaseAdmin.from('product_batches').select('id, quantity').eq('organization_id', org).eq('product_id', productId).gt('quantity', 0).order('expiry_date', { ascending: true, nullsFirst: false });
  let excess = (batches ?? []).reduce((s, b) => s + Number(b.quantity ?? 0), 0) - Number(product.stock_quantity);
  for (const b of batches ?? []) {
    if (excess <= 1e-9) break;
    const take = Math.min(Number(b.quantity), excess);
    await changeBatch(org, b.id as string, -take).catch(() => undefined);
    excess -= take;
  }
}

export async function createMovement(org: string, userId: string, scope: IndustryScope, input: MovementInput) {
  const product = await assertProduct(org, input.productId, scope);
  const stock = Number(product.stock_quantity ?? 0);
  const productMovements = await movementsFor(org, [input.productId]);
  const holdings = (await holdingsFor(org, productMovements)).filter((h) => h.product_id === input.productId);
  // Stock a rep still carries (assigned - returned - sold). Sold units have already left total stock when the order was saved.
  const withReps = holdings.reduce((s, h) => s + h.balance, 0);
  const available = stock - withReps;
  const qty = input.quantity;

  if (input.type === 'assign' || input.type === 'return') {
    if (!input.representativeId) throw new AppError(422, 'REP_REQUIRED', 'Select a sales representative.');
    const { data: rep, error } = await supabaseAdmin.from('sales_representatives').select('id').eq('organization_id', org).eq('id', input.representativeId).eq('status', 'active').maybeSingle();
    if (error) fail(error);
    if (!rep) throw new AppError(422, 'INVALID_REP', 'That sales representative is not active.');
  }
  if (input.requestId) {
    if (input.type !== 'assign' || !input.representativeId) throw new AppError(422, 'REQUEST_ONLY_FOR_ASSIGN', 'A stock request can only be fulfilled by assigning stock to the rep.');
    await assertApprovedRequest(org, input.requestId, input.representativeId, input.productId);
  }
  if (input.type === 'assign' && qty > available) throw new AppError(422, 'INSUFFICIENT_STOCK', `Only ${Math.max(0, available)} available to assign.`);
  if (input.type === 'transfer') {
    if (qty > available) throw new AppError(422, 'INSUFFICIENT_STOCK', `Only ${Math.max(0, available)} available to transfer (stock held by reps cannot be transferred).`);
    if ((input.fromLocation ?? '').trim().toLowerCase() === (input.toLocation ?? '').trim().toLowerCase()) throw new AppError(422, 'SAME_LOCATION', 'From and To location are the same.');
  }
  if (input.type === 'return') {
    const balance = holdings.find((h) => h.representative_id === input.representativeId)?.balance ?? 0;
    if (qty > balance) throw new AppError(422, 'RETURN_TOO_MUCH', `This rep only holds ${Math.max(0, balance)} of this product, so ${qty} cannot be returned.`);
  }

  // Writing stock down below what reps are carrying would leave a negative warehouse balance.
  if (input.type === 'adjustment' && qty < 0 && !input.allowNegative && stock + qty < withReps) {
    throw new AppError(422, 'BELOW_REP_STOCK', `${Math.max(0, available)} unit(s) are in the warehouse and ${withReps} are with sales reps. Take stock back from the reps first, or reduce this adjustment.`);
  }

  const { data: profile } = await supabaseAdmin.from('user_profiles').select('display_name').eq('id', userId).maybeSingle();
  const stockDelta = input.type === 'stock_in' ? qty : input.type === 'adjustment' ? qty : 0;
  if (stockDelta !== 0) await changeProductStock(org, input.productId, stockDelta, Boolean(input.allowNegative));
  let undoBatch: (() => Promise<void>) | null = null;
  if (input.type === 'stock_in') {
    try { undoBatch = await addToBatch(org, input.productId, input); } catch (batchError) {
      await changeProductStock(org, input.productId, -stockDelta, true).catch(() => undefined);
      throw batchError;
    }
  }

  const { data, error } = await supabaseAdmin.from('inventory_movements').insert({
    organization_id: org, product_id: input.productId, representative_id: input.representativeId ?? null, movement_type: input.type, quantity: qty,
    from_location: input.fromLocation ?? null, to_location: input.toLocation ?? null, batch: input.batch || null, mfg_date: input.mfgDate || null, expiry_date: input.expiryDate || null,
    reference: input.reference ?? null, reason: input.reason ?? null, remarks: input.remarks ?? null, created_by: userId, created_by_name: profile?.display_name ?? null,
  }).select().single();
  if (error) {
    if (undoBatch) await undoBatch().catch(() => undefined);
    if (stockDelta !== 0) await changeProductStock(org, input.productId, -stockDelta, true).catch(() => undefined); // undo the stock change so nothing is half-saved
    fail(error);
  }
  if (input.type === 'adjustment' && qty < 0) await trimBatchesToStock(org, input.productId).catch(() => undefined);
  if (input.requestId) await markRequestFulfilled(org, input.requestId, data.id as string);
  return data;
}

// What one rep is carrying right now (used by the mobile app).
export async function repStock(org: string, representativeId: string) {
  const { data: rows, error } = await supabaseAdmin.from('inventory_movements').select('product_id').eq('organization_id', org).eq('representative_id', representativeId).in('movement_type', ['assign', 'return']);
  if (error) fail(error);
  const productIds = Array.from(new Set((rows ?? []).map((r) => r.product_id as string)));
  if (productIds.length === 0) return [];
  const movements = await movementsFor(org, productIds);
  const holdings = (await holdingsFor(org, movements)).filter((h) => h.representative_id === representativeId);
  const { data: products, error: productError } = await supabaseAdmin.from('products').select('id, product_name, product_code').eq('organization_id', org).in('id', productIds);
  if (productError) fail(productError);
  const byId = new Map((products ?? []).map((p) => [p.id as string, p]));
  return holdings.map((h) => ({ ...h, product_name: byId.get(h.product_id)?.product_name ?? 'Product', product_code: byId.get(h.product_id)?.product_code ?? '' }));
}