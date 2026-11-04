/* eslint-disable @typescript-eslint/no-explicit-any */
// Small shared DB helpers for the Pharma distributor modules (extracted so routes, invoicing and automation share them).
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';
import { todayLocal } from './ist-date.js';

export type Row = Record<string, any>;
export const num = (v: unknown) => Number(v ?? 0) || 0;
export const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const today = () => todayLocal();
export const addDays = (iso: string, days: number) => new Date(Date.parse(iso.slice(0, 10)) + days * 86_400_000).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string) => Math.round((Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86_400_000);
export const bad = (msg: string, code = 'VALIDATION_ERROR') => new AppError(400, code, msg);

/** Loads every row of a query (Supabase returns at most 1000 per request). */
export async function all(build: () => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
export async function nextNo(table: string, field: string, orgId: string, prefix: string) {
  const { data, error } = await supabaseAdmin.from(table).select(field).eq('organization_id', orgId).like(field, `${prefix}%`);
  if (error) throw error;
  const top = Math.max(0, ...((data ?? []) as unknown as Row[]).map((x) => Number(/(\d+)$/.exec(String(x[field] ?? ''))?.[1] ?? 0)));
  return `${prefix}${String(top + 1).padStart(4, '0')}`;
}
export async function insertNumbered(table: string, field: string, orgId: string, prefix: string, row: Row): Promise<Row> {
  for (let i = 0; i < 4; i += 1) {
    const no = await nextNo(table, field, orgId, prefix);
    const { data, error } = await supabaseAdmin.from(table).insert({ ...row, [field]: no, organization_id: orgId }).select().single();
    if (!error) return data as Row;
    if (error.code !== '23505') throw error;
  }
  throw new AppError(409, 'DUPLICATE_RECORD', 'Could not allocate a new number. Please try again.');
}
export const gstTotals = (lines: Row[]) => {
  const subtotal = r2(lines.reduce((s, l) => s + num(l.quantity) * num(l.rate), 0));
  const tax = r2(lines.reduce((s, l) => s + (num(l.quantity) * num(l.rate) * num(l.gst_percent)) / 100, 0));
  return { subtotal, tax_amount: tax, total_amount: r2(subtotal + tax) };
};
export const PRODUCT_COLS = 'id, product_code, product_name, unit, cost_price, selling_price, tax_percent, hsn_code, min_stock_level, stock_quantity';
export async function industryProducts(orgId: string, it: string): Promise<Row[]> {
  const tags = await all(() => supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', orgId).eq('industry_type_id', it));
  const ids = tags.map((t) => t.product_id as string);
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('products').select(PRODUCT_COLS).eq('organization_id', orgId).in('id', ids.slice(i, i + 100));
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Row[]));
  }
  return out;
}
/** Idempotency log: returns true the FIRST time a key is claimed (so a reminder / auto-invoice is never repeated). */
export async function claim(orgId: string, it: string | null, key: string, kind: string, detail: Row = {}): Promise<boolean> {
  const { error } = await supabaseAdmin.from('pharma_automation_log').insert({ organization_id: orgId, industry_type_id: it, log_key: key, kind, detail });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}
/** Records an outcome (e.g. "invoice skipped: no GSTIN") without blocking retries: one row per key per hour. */
export async function note(orgId: string, it: string | null, kind: string, key: string, detail: Row) {
  try { await supabaseAdmin.from('pharma_automation_log').insert({ organization_id: orgId, industry_type_id: it, log_key: `${key}@${new Date().toISOString().slice(0, 13)}`, kind, detail }); } catch { /* best effort */ }
}