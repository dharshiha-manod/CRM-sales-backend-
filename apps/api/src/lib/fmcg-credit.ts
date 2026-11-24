/* eslint-disable @typescript-eslint/no-explicit-any */
// FMCG credit control + cheque tracker.
//  - Credit overview: one row per active client (limit, unpaid, overdue, available credit, cheques in hand, bounced cheques).
//    The numbers come from getClientCredit(), the same function that blocks orders, so the screen and the blocking never disagree.
//  - Cheque register: every cheque collection gets a lifecycle (received -> deposited -> cleared, or bounced).
//    A bounced cheque reverses its collection, so unpaid / credit / invoice figures everywhere go back up by themselves.
import { AppError } from '../errors/app-error.js';
import { createForOrder } from '../repositories/follow-ups.repository.js';
import { syncInvoicePaymentsForSaleOrder } from '../repositories/trading.repository.js';
import { getClientCredit } from './credit.js';
import { todayLocal } from './ist-date.js';
import { logger } from './logger.js';
import { supabaseAdmin } from './supabase.js';

type Row = Record<string, any>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const bad = (msg: string) => new AppError(400, 'VALIDATION_ERROR', msg);

async function pageAll(build: () => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const chunks = <T,>(list: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

export type CreditRisk = 'blocked' | 'over_limit' | 'near_limit' | 'ok' | 'no_limit';
/** blocked = overdue past credit days (new orders are refused), over_limit = unpaid above the limit, near_limit = 80% or more used. */
export function creditRisk(limit: number | null, outstanding: number, overdue: number): CreditRisk {
  if (overdue > 0.005) return 'blocked';
  if (limit == null) return 'no_limit';
  if (outstanding > limit + 0.005) return 'over_limit';
  if (limit > 0 && outstanding >= limit * 0.8) return 'near_limit';
  return 'ok';
}

async function fmcgClients(org: string, it: string): Promise<Row[]> {
  return pageAll(() => supabaseAdmin.from('clients').select('id, client_code, client_name, status, city, credit_limit, credit_days').eq('organization_id', org).eq('industry_type_id', it).order('id'));
}

// ---------------------------------------------------------------- cheque register
/** Adds a register row for every cheque collection that has none yet. Safe to run any time (idempotent). */
export async function syncChequeRegister(org: string, it: string): Promise<number> {
  const clients = await fmcgClients(org, it);
  if (!clients.length) return 0;
  const existing = new Set((await pageAll(() => supabaseAdmin.from('fmcg_cheques').select('collection_id').eq('organization_id', org).eq('industry_type_id', it).not('collection_id', 'is', null).order('id'))).map((r) => String(r.collection_id)));
  const missing: Row[] = [];
  for (const ids of chunks(clients.map((c) => String(c.id)), 100)) {
    const cols = await pageAll(() => supabaseAdmin.from('sales_collections').select('*').eq('organization_id', org).eq('mode', 'cheque').in('client_id', ids).order('id'));
    for (const c of cols) {
      if (existing.has(String(c.id))) continue;
      const when = String(c.collected_at ?? c.created_at ?? todayLocal()).slice(0, 10);
      missing.push({ organization_id: org, industry_type_id: it, collection_id: c.id, client_id: c.client_id, sale_order_id: c.sale_order_id ?? null, representative_id: c.representative_id ?? null, cheque_no: str(c.reference_no) || null, cheque_date: isDate(when) ? when : todayLocal(), amount: num(c.amount), status: 'received' });
    }
  }
  for (const part of chunks(missing, 200)) {
    const { error } = await supabaseAdmin.from('fmcg_cheques').upsert(part, { onConflict: 'organization_id,collection_id', ignoreDuplicates: true });
    if (error) throw error;
  }
  return missing.length;
}

export async function listCheques(org: string, it: string) {
  await syncChequeRegister(org, it);
  const rows = await pageAll(() => supabaseAdmin.from('fmcg_cheques').select('*').eq('organization_id', org).eq('industry_type_id', it).order('created_at', { ascending: false }).order('id'));
  const clientIds = [...new Set(rows.map((r) => String(r.client_id)))]; const orderIds = [...new Set(rows.map((r) => r.sale_order_id).filter(Boolean).map(String))];
  const clientName = new Map<string, Row>(); const orderNo = new Map<string, string>();
  for (const ids of chunks(clientIds, 100)) { const { data, error } = await supabaseAdmin.from('clients').select('id, client_code, client_name').eq('organization_id', org).in('id', ids); if (error) throw error; for (const c of (data ?? []) as Row[]) clientName.set(String(c.id), c); }
  for (const ids of chunks(orderIds, 100)) { const { data, error } = await supabaseAdmin.from('sale_orders').select('id, order_number').eq('organization_id', org).in('id', ids); if (error) throw error; for (const o of (data ?? []) as Row[]) orderNo.set(String(o.id), String(o.order_number)); }
  return rows.map((r) => ({ ...r, client_name: clientName.get(String(r.client_id))?.client_name ?? '—', client_code: clientName.get(String(r.client_id))?.client_code ?? null, order_number: r.sale_order_id ? orderNo.get(String(r.sale_order_id)) ?? null : null }));
}

export type ChequeAction = { action: 'details' | 'deposit' | 'clear' | 'bounce'; date?: string; bank_name?: string; cheque_date?: string; notes?: string; reason?: string; bounce_charge?: number };

export async function actOnCheque(org: string, it: string, id: string, body: ChequeAction) {
  const { data: found, error: findErr } = await supabaseAdmin.from('fmcg_cheques').select('*').eq('organization_id', org).eq('industry_type_id', it).eq('id', id).maybeSingle();
  if (findErr) throw findErr;
  if (!found) throw new AppError(404, 'RECORD_NOT_FOUND', 'Cheque was not found.');
  const ch = found as Row; const today = todayLocal();
  const date = str(body.date) || today;
  if (body.action !== 'details') {
    if (!isDate(date)) throw bad('Date is not valid.');
    if (date > today) throw bad('Date cannot be in the future.');
  }
  const guarded = async (patch: Row, from: string[], msg: string) => {
    const { data, error } = await supabaseAdmin.from('fmcg_cheques').update({ ...patch, updated_at: new Date().toISOString() }).eq('organization_id', org).eq('id', ch.id).in('status', from).select().maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError(409, 'INVALID_STATE', msg);
    return data as Row;
  };
  if (body.action === 'details') {
    const patch: Row = {};
    if (body.bank_name !== undefined) patch.bank_name = str(body.bank_name) || null;
    if (body.notes !== undefined) patch.notes = str(body.notes) || null;
    if (body.cheque_date !== undefined) { if (!isDate(body.cheque_date)) throw bad('Cheque date is not valid.'); patch.cheque_date = body.cheque_date; }
    if (!Object.keys(patch).length) throw bad('Nothing to change.');
    return guarded(patch, ['received', 'deposited', 'cleared', 'bounced'], 'Cheque could not be updated.');
  }
  if (body.action === 'deposit') {
    if (date < String(ch.cheque_date).slice(0, 10)) throw bad(`A post-dated cheque cannot be deposited before its cheque date (${String(ch.cheque_date).slice(0, 10)}).`);
    return guarded({ status: 'deposited', deposited_on: date }, ['received'], 'Only a cheque that is still in hand can be deposited.');
  }
  if (body.action === 'clear') {
    if (ch.deposited_on && date < String(ch.deposited_on).slice(0, 10)) throw bad('Cleared date cannot be before the deposit date.');
    return guarded({ status: 'cleared', cleared_on: date }, ['received', 'deposited'], 'Only a cheque in hand or deposited can be marked cleared.');
  }
  if (body.action !== 'bounce') throw bad('Unknown action.');
  const reason = str(body.reason);
  if (reason.length < 3) throw bad('Enter the bounce reason (for example "Insufficient funds").');
  const charge = body.bounce_charge === undefined || body.bounce_charge === null ? 0 : Number(body.bounce_charge);
  if (Number.isNaN(charge) || charge < 0) throw bad('Bounce charge cannot be negative.');
  // 1) mark bounced first (guarded, so a double click cannot reverse twice), 2) reverse the collection, 3) tidy up the order.
  const bounced = await guarded({ status: 'bounced', bounced_on: date, bounce_reason: reason, bounce_charge: r2(charge) }, ['received', 'deposited'], 'Only a cheque in hand or deposited can be marked bounced. A cleared cheque needs a manual adjustment.');
  if (ch.collection_id) {
    const { error } = await supabaseAdmin.from('sales_collections').delete().eq('organization_id', org).eq('id', ch.collection_id);
    if (error) {
      await supabaseAdmin.from('fmcg_cheques').update({ status: ch.status, bounced_on: null, bounce_reason: null, bounce_charge: 0 }).eq('organization_id', org).eq('id', ch.id);
      throw error;
    }
  }
  if (ch.sale_order_id) {
    const orderId = String(ch.sale_order_id);
    try { await syncInvoicePaymentsForSaleOrder(org, orderId); } catch (err) { logger.error({ err, orderId }, 'Cheque bounce: invoice payment resync failed'); }
    const { error: reopenErr } = await supabaseAdmin.from('sale_orders').update({ status: 'confirmed' }).eq('organization_id', org).eq('id', orderId).eq('status', 'completed');
    if (reopenErr) logger.error({ err: reopenErr, orderId }, 'Cheque bounce: could not reopen the order');
    try {
      await createForOrder(org, orderId, { title: `Cheque ${ch.cheque_no ?? ''} bounced - collect ₹${Math.round(num(ch.amount)).toLocaleString('en-IN')} again`.replace('  ', ' '), dueAt: new Date().toISOString(), priority: 'high', followUpType: 'call', notes: reason });
    } catch (err) { logger.error({ err, orderId }, 'Cheque bounce: follow-up could not be created'); }
  }
  return bounced;
}

// ---------------------------------------------------------------- credit overview
export async function creditOverview(org: string, it: string) {
  const clients = (await fmcgClients(org, it)).filter((c) => c.status === 'active');
  const cheques = await pageAll(() => supabaseAdmin.from('fmcg_cheques').select('client_id, status, amount').eq('organization_id', org).eq('industry_type_id', it).in('status', ['received', 'deposited', 'bounced']).order('id'));
  const byClient = new Map<string, { hand: number; handValue: number; bounced: number; bouncedValue: number }>();
  for (const c of cheques) {
    const k = String(c.client_id); const e = byClient.get(k) ?? { hand: 0, handValue: 0, bounced: 0, bouncedValue: 0 };
    if (c.status === 'bounced') { e.bounced += 1; e.bouncedValue += num(c.amount); } else { e.hand += 1; e.handValue += num(c.amount); }
    byClient.set(k, e);
  }
  const rows: Row[] = new Array(clients.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next; next += 1;
      if (i >= clients.length) return;
      const c = clients[i];
      const credit = await getClientCredit(org, String(c.id)).catch((err) => { logger.error({ err, client: c.id }, 'Credit overview: client skipped'); return null; });
      const ch = byClient.get(String(c.id)) ?? { hand: 0, handValue: 0, bounced: 0, bouncedValue: 0 };
      const limit = credit ? credit.creditLimit : (c.credit_limit == null ? null : num(c.credit_limit));
      const outstanding = credit?.outstanding ?? 0; const overdue = credit?.overdue ?? 0;
      rows[i] = {
        id: c.id, client_code: c.client_code, client_name: c.client_name, city: c.city ?? null, credit_limit: limit, credit_days: credit ? credit.creditDays : (c.credit_days == null ? null : num(c.credit_days)),
        outstanding: r2(outstanding), overdue: r2(overdue), available: limit == null ? null : r2(Math.max(0, limit - outstanding)),
        utilization: limit && limit > 0 ? Math.round((outstanding / limit) * 100) : null, risk: creditRisk(limit, outstanding, overdue),
        cheques_in_hand: ch.hand, cheques_in_hand_value: r2(ch.handValue), cheques_bounced: ch.bounced, cheques_bounced_value: r2(ch.bouncedValue),
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, clients.length) }, () => worker()));
  const list = rows.filter(Boolean);
  const count = (r: CreditRisk) => list.filter((x) => x.risk === r).length;
  return {
    rows: list,
    totals: { outstanding: r2(list.reduce((s, x) => s + x.outstanding, 0)), overdue: r2(list.reduce((s, x) => s + x.overdue, 0)), blocked: count('blocked'), over_limit: count('over_limit'), near_limit: count('near_limit'), no_limit: count('no_limit'), cheques_in_hand_value: r2(list.reduce((s, x) => s + x.cheques_in_hand_value, 0)) },
  };
}

export async function updateClientCredit(org: string, it: string, clientId: string, body: { credit_limit?: unknown; credit_days?: unknown }) {
  const patch: Row = {};
  const read = (v: unknown, label: string, integer: boolean) => {
    if (v === null || v === '' || v === undefined) return null;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0) throw bad(`${label} must be zero or more (leave empty for no limit).`);
    return integer ? Math.round(n) : r2(n);
  };
  if ('credit_limit' in body) patch.credit_limit = read(body.credit_limit, 'Credit limit', false);
  if ('credit_days' in body) patch.credit_days = read(body.credit_days, 'Credit days', true);
  if (!Object.keys(patch).length) throw bad('Nothing to change.');
  const { data, error } = await supabaseAdmin.from('clients').update(patch).eq('organization_id', org).eq('industry_type_id', it).eq('id', clientId).select('id, client_name, credit_limit, credit_days').maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(404, 'RECORD_NOT_FOUND', 'Client was not found in this industry.');
  return data;
}