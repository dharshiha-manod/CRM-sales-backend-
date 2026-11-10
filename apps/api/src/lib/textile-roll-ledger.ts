// Textile roll ledger: every change of a roll's metres goes through the database functions in
// sql/01_textile_roll_engine.sql, which lock the roll row, refuse negative stock and write the ledger row.
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0) || 0;

const STATUS_BY_CODE: Record<string, number> = {
  ROLL_NOT_FOUND: 404,
  INSUFFICIENT_LENGTH: 422,
  ROLL_NOT_AVAILABLE: 409,
  INVALID_MOVEMENT: 422,
};

/** Turns a database "CODE: message" exception into a clean API error. */
function toAppError(error: { message?: string }): AppError {
  const msg = error.message ?? 'Roll movement failed.';
  const m = /^([A-Z_]+):\s*(.*)$/s.exec(msg);
  if (m && STATUS_BY_CODE[m[1]]) return new AppError(STATUS_BY_CODE[m[1]], m[1], m[2]);
  return new AppError(500, 'ROLL_MOVEMENT_FAILED', msg);
}

export type RollMoveType = 'receipt' | 'damage' | 'adjustment' | 'return';

export interface RollMoveOptions {
  type: RollMoveType;
  /** size of the event in metres (positive) */
  quantity: number;
  /** signed change of the available metres */
  delta: number;
  damaged?: number;
  orderId?: string | null;
  orderNumber?: string | null;
  clientId?: string | null;
  note?: string | null;
}

/** Atomic roll movement (damage, stock correction...). Throws 422 INSUFFICIENT_LENGTH instead of going negative. */
export async function moveRoll(orgId: string, userId: string | null, rollId: string, o: RollMoveOptions): Promise<Row> {
  const { data, error } = await supabaseAdmin.rpc('textile_roll_move', {
    p_org: orgId, p_roll: rollId, p_type: o.type, p_qty: o.quantity, p_delta: o.delta,
    p_damaged: o.damaged ?? 0, p_order: o.orderId ?? null, p_order_number: o.orderNumber ?? null,
    p_client: o.clientId ?? null, p_note: o.note ?? null, p_user: userId,
  });
  if (error) throw toAppError(error);
  return (data ?? {}) as Row;
}

/** Writes the first ledger row of a brand-new roll. Best effort: the roll itself is already saved. */
export async function logRollReceipt(orgId: string, userId: string | null, roll: Row) {
  try {
    const length = num(roll.length_meters);
    await supabaseAdmin.from('textile_roll_transactions').insert({
      organization_id: orgId, industry_type_id: roll.industry_type_id ?? null, roll_id: roll.id, roll_number: roll.roll_number,
      txn_type: 'receipt', quantity_m: length, available_delta: length, balance_after: length,
      note: roll.supplier_name ? `Received from ${String(roll.supplier_name)}` : 'Roll created', created_by: userId,
    });
  } catch { /* the ledger must never block roll creation */ }
}

export async function cutReserve(orgId: string, userId: string | null, a: {
  rollId: string; orderId: string; orderNumber: string; clientId: string | null; productCode: string; metres: number;
}): Promise<Row> {
  const { data, error } = await supabaseAdmin.rpc('textile_roll_cut_reserve', {
    p_org: orgId, p_roll: a.rollId, p_order: a.orderId, p_order_number: a.orderNumber, p_client: a.clientId,
    p_product: a.productCode, p_metres: a.metres, p_user: userId,
  });
  if (error) throw toAppError(error);
  return (data ?? {}) as Row;
}

export async function cutRelease(orgId: string, userId: string | null, allocationId: string, note?: string): Promise<Row | null> {
  const { data, error } = await supabaseAdmin.rpc('textile_roll_cut_release', { p_org: orgId, p_alloc: allocationId, p_user: userId, p_note: note ?? null });
  if (error) throw toAppError(error);
  return (data as Row | null) ?? null;
}

export async function cutSell(orgId: string, userId: string | null, allocationId: string): Promise<Row | null> {
  const { data, error } = await supabaseAdmin.rpc('textile_roll_cut_sell', { p_org: orgId, p_alloc: allocationId, p_user: userId });
  if (error) throw toAppError(error);
  return (data as Row | null) ?? null;
}

/** Metres of one product that cuts already cover on an order (Reserved + Sold cuts). */
export async function cutMetresForOrder(orgId: string, orderId: string, productCode: string): Promise<number> {
  const { data } = await supabaseAdmin.from('textile_roll_allocations').select('metres')
    .eq('organization_id', orgId).eq('order_id', orderId).eq('product_code', productCode).in('status', ['Reserved', 'Sold']);
  return ((data ?? []) as { metres: number | null }[]).reduce((s, r) => s + num(r.metres), 0);
}