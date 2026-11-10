// Pure helpers for the Textile purchase side (kept free of database calls so they can be unit-tested).
import { AppError } from '../errors/app-error.js';

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0) || 0;

/** Purchase-order status from the received metres of its lines (tolerance % lets a line count as complete when slightly short). */
export function poStatusFromReceipts(lines: Row[], tolerancePercent: number): 'Ordered' | 'Partially Received' | 'Received' {
  const any = lines.some((l) => num(l.received_quantity) > 0);
  if (!any) return 'Ordered';
  const done = lines.every((l) => num(l.received_quantity) + 1e-9 >= num(l.quantity) * (1 - tolerancePercent / 100));
  return done ? 'Received' : 'Partially Received';
}

/** Returns the lines that would be over-received by `added` (line index -> metres). Empty array = fine. */
export function overReceivedLines(lines: Row[], added: Map<number, number>, tolerancePercent: number): number[] {
  const out: number[] = [];
  for (const [idx, add] of added) {
    const l = lines[idx];
    if (!l) { out.push(idx); continue; }
    if (num(l.received_quantity) + add > num(l.quantity) * (1 + tolerancePercent / 100) + 1e-9) out.push(idx);
  }
  return out;
}

const RPC_STATUS: Record<string, number> = {
  PO_NOT_FOUND: 404, ROLL_NOT_FOUND: 404, PO_NOT_RECEIVABLE: 400, PO_LINE_MISSING: 400, INVALID_GRN: 400, OVER_RECEIPT: 400, ROLL_NOT_SOLD: 422,
};

/** Turns a database "CODE: message" exception (or a unique-key violation) into a clean API error. */
export function rpcError(error: { code?: string; message?: string; details?: string | null }): AppError {
  if (error.code === '23505') return new AppError(409, 'DUPLICATE_RECORD', 'One of the numbers (roll or receipt) already exists. Please try again.');
  const msg = error.message ?? 'The operation failed.';
  const m = /^([A-Z_]+):\s*(.*)$/s.exec(msg);
  if (m && RPC_STATUS[m[1]]) return new AppError(RPC_STATUS[m[1]], m[1], m[2]);
  return new AppError(500, 'TEXTILE_DB_ERROR', msg);
}