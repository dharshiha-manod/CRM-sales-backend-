// Pharma industry CRUD + automation (Batch & Expiry, Sample, Promotion, Hospital Engagement, Medicine Return, Recall).
// Own tables, own routes: nothing here touches Trading / FMCG / School / Textile / Vehicle.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { assertRecordInScope, resolveIndustryTypeId } from '../lib/industry-scope.js';
import { PHARMA_RESOURCES, type PharmaResource } from '../lib/pharma-resources.js';
import { daysLeft, expiryStatus, isBatchBlocked as isBlocked, isSellable, statusMoveProblem, licenseDaysLeft, LICENSE_WARN_DAYS, PHARMA_BLOCK_SALE_DAYS } from '../lib/pharma-rules.js';
import { getPharmaExpiryRules } from '../lib/settings.js';
import { applyAllocations, readAllocation, releaseStockForOrder, takeStockForOrder, type Allocation } from '../lib/stock.js';
export { expiryStatus };
import { createManual as createFollowUp } from '../repositories/follow-ups.repository.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { createReturn, decideReturn } from '../repositories/sales-returns.repository.js';
import { createRefund, listRefunds, refundSchema } from '../repositories/fmcg-refunds.repository.js';
import { industryCodeOf } from '../lib/fmcg-market.js';
export const pharmaRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
const writerRep = requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative');
const reader = writerRep;

type Req = Parameters<RequestHandler>[0];
type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (typeof v === 'string' && v ? v : '');
const today = () => new Date().toISOString().slice(0, 10);
const actorOf = (req: Req) => ((req as unknown as { auth?: { sub?: string } }).auth?.sub as string | undefined) ?? null;

const org = (req: Req) => {
  const v = req.header('x-organization-id');
  if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return v;
};
const idOf = (req: Req) => {
  const v = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!v) throw new AppError(400, 'INVALID_ID', 'A resource id is required');
  return v;
};
const bad = (msg: string, code = 'VALIDATION_ERROR') => new AppError(400, code, msg);

function clean(r: PharmaResource, body: unknown): Row {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('A JSON object body is required.');
  const allowed = new Set([...r.columns, 'status']);
  const out: Row = {};
  for (const [k, v] of Object.entries(body as Row)) if (allowed.has(k)) out[k] = v === '' ? null : v;
  return out;
}
function validateValues(r: PharmaResource, p: Row, partial: boolean) {
  if (p.status !== undefined && p.status !== null && !r.statuses.includes(String(p.status))) throw bad(`status must be one of: ${r.statuses.join(', ')}.`);
  for (const k of r.nonNegative) {
    const v = p[k]; if (v === undefined || v === null) continue;
    const n = Number(v);
    if (Number.isNaN(n)) throw bad(`${k} must be a number.`);
    if (n < 0) throw bad(`${k} cannot be negative.`);
  }
  if (partial) {
    const blank = r.requiredFields.filter((k) => k in p && (p[k] === null || p[k] === ''));
    if (blank.length) throw bad(`${blank.join(', ')} cannot be empty.`);
  }
}

// ---- shared helpers ------------------------------------------------------------

async function getBatch(orgId: string, industryTypeId: string, batchNumber: unknown): Promise<Row> {
  const { data, error } = await supabaseAdmin.from('pharma_batches').select('*')
    .eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('batch_number', str(batchNumber)).maybeSingle();
  if (error) throw error;
  if (!data) throw bad(`Batch ${str(batchNumber)} does not exist. Add it in Batch & Expiry first.`, 'INVALID_REFERENCE');
  return data as Row;
}
/** Audit log of every batch quantity change (who, how much, why). Best effort: never blocks the real change. */
async function logMovement(orgId: string, batchId: string, batchNumber: unknown, delta: number, source: string, actor?: string | null, note?: string | null) {
  try { await supabaseAdmin.from('pharma_stock_movements').insert({ organization_id: orgId, batch_id: batchId, batch_number: str(batchNumber), delta, source, actor: actor ?? null, note: note ?? null }); } catch { /* audit is best effort */ }
}
/** Adds (+) / removes (-) units on one batch with compare-and-swap so two users never overwrite each other. */
async function changeBatchQty(orgId: string, batchId: string, delta: number, source = 'System', actor?: string | null) {
  if (!delta) return;
  for (let i = 0; i < 6; i += 1) {
    const { data: row, error } = await supabaseAdmin.from('pharma_batches').select('id, batch_number, quantity').eq('organization_id', orgId).eq('id', batchId).maybeSingle();
    if (error) throw error;
    if (!row) return;
    const after = num(row.quantity) + delta;
    if (after < 0) throw new AppError(409, 'BATCH_STOCK_CHANGED', `Batch ${row.batch_number} no longer has enough stock. Please try again.`);
    const { data: ok, error: e2 } = await supabaseAdmin.from('pharma_batches').update({ quantity: after }).eq('organization_id', orgId).eq('id', batchId).eq('quantity', row.quantity).select('id').maybeSingle();
    if (e2) throw e2;
    if (ok) { await logMovement(orgId, batchId, row.batch_number, delta, source, actor); return; }
  }
  throw new AppError(409, 'STOCK_CHANGED', 'Stock was changed by someone else at the same moment. Please try again.');
}
async function findProduct(orgId: string, industryTypeId: string, col: 'product_code' | 'product_name', value: unknown): Promise<{ id: string; product_name: string; product_code: string | null } | null> {
  if (!str(value)) return null;
  const { data } = await supabaseAdmin.from('products').select('id, product_name, product_code').eq('organization_id', orgId).eq(col, str(value)).limit(5);
  for (const p of (data ?? []) as { id: string; product_name: string; product_code: string | null }[]) {
    const { data: tag } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', orgId).eq('product_id', p.id).eq('industry_type_id', industryTypeId).maybeSingle();
    if (tag) return p;
  }
  return null;
}
/** Product stock = sum of its SELLABLE pharma batches: not expired / recalled / quarantined, and not inside the "block sale within N days of expiry" window. Best effort. */
async function syncProductStock(orgId: string, industryTypeId: string, productCode: unknown) {
  if (!str(productCode)) return;
  try {
    const product = await findProduct(orgId, industryTypeId, 'product_code', productCode);
    if (!product) return;
    const minDays = Math.max(PHARMA_BLOCK_SALE_DAYS, (await getPharmaExpiryRules(orgId)).blockSaleWithinDaysOfExpiry);
    const { data } = await supabaseAdmin.from('pharma_batches').select('quantity, status, expiry_date').eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('product_code', str(productCode));
    const total = ((data ?? []) as Row[]).filter((b) => isSellable(b, today(), minDays)).reduce((s, b) => s + num(b.quantity), 0);
    await supabaseAdmin.from('products').update({ stock_quantity: total }).eq('organization_id', orgId).eq('id', product.id);
  } catch { /* the pharma record is already saved */ }
}
async function countWhere(table: string, orgId: string, column: string, value: unknown, extra?: (q: any) => any): Promise<number> {
  if (!str(value)) return 0;
  let q: any = supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq(column, str(value));
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}
/** Keeps every batch's status in line with today's date (and open recalls). Best effort. */
export async function refreshBatchStatuses(orgId: string, industryTypeId: string | null) {
  try {
    let q = supabaseAdmin.from('pharma_batches').select('id, status, batch_number, expiry_date, product_code, industry_type_id').eq('organization_id', orgId).not('status', 'in', '("Quarantined","Recalled")');
    if (industryTypeId) q = q.eq('industry_type_id', industryTypeId);
    const { data } = await q;
    const touched = new Set<string>();
    const newlyExpired: string[] = [];
    for (const b of (data ?? []) as Row[]) {
      const want = expiryStatus(b.expiry_date);
      if (want !== b.status) {
        await supabaseAdmin.from('pharma_batches').update({ status: want }).eq('organization_id', orgId).eq('id', b.id as string);
        touched.add(`${b.industry_type_id}|${b.product_code ?? ''}`);
        if (want === 'Expired') newlyExpired.push(str(b.batch_number));
      }
    }
    // A batch that just expired must not leave with an order that is confirmed but not delivered yet: re-pick it from valid batches.
    for (const n of newlyExpired) if (n) await repickOrdersForBatch(orgId, n);
    for (const t of touched) { const [it, pc] = t.split('|'); await syncProductStock(orgId, it, pc); }
  } catch { /* never block the list */ }
}
/** Recall <-> Batch: an open recall marks the batch Recalled (blocks samples / sale). Closing it leaves the batch Quarantined, never auto-saleable. */
async function reconcileBatchAfterRecall(orgId: string, industryTypeId: string, batchNumber: unknown, mode: 'saved' | 'deleted') {
  try {
    const { data } = await supabaseAdmin.from('pharma_batches').select('id, status, expiry_date, product_code').eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('batch_number', str(batchNumber)).maybeSingle();
    if (!data) return;
    const b = data as Row;
    const open = await countWhere('pharma_recalls', orgId, 'batch_number', batchNumber, (q) => q.eq('industry_type_id', industryTypeId).neq('status', 'Closed'));
    let next: string | null = null;
    if (open > 0) next = 'Recalled';
    else if (b.status === 'Recalled') next = mode === 'saved' ? 'Quarantined' : expiryStatus(b.expiry_date);
    if (next && next !== b.status) await supabaseAdmin.from('pharma_batches').update({ status: next }).eq('organization_id', orgId).eq('id', b.id as string);
    await syncProductStock(orgId, industryTypeId, b.product_code);
  } catch { /* best effort */ }
}

/** Units that came back (customer return / rep sample return) for a recalled batch count toward the open recall's "collected back". */
async function addRecallCollected(orgId: string, batchNumber: unknown, qty: number): Promise<boolean> {
  if (qty <= 0 || !str(batchNumber)) return false;
  try {
    const { data: rc } = await supabaseAdmin.from('pharma_recalls').select('id, collected_quantity, supplied_quantity').eq('organization_id', orgId).eq('batch_number', str(batchNumber)).neq('status', 'Closed').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!rc) return false;
    const next = Math.min(num(rc.supplied_quantity), num(rc.collected_quantity) + qty);
    await supabaseAdmin.from('pharma_recalls').update({ collected_quantity: next }).eq('organization_id', orgId).eq('id', rc.id as string);
    return true;
  } catch { return false; }
}
/** Orders that hold units of this batch but are not delivered yet: they must be stopped / re-picked. */
async function pendingOrdersForBatch(orgId: string, batchNumber: string): Promise<string[]> {
  try {
    const { data: items } = await supabaseAdmin.from('sale_order_items').select('order_id').contains('batch_allocations', { batches: [{ batchNo: batchNumber, src: 'pharma' }] });
    const ids = [...new Set(((items ?? []) as Row[]).map((i) => i.order_id as string))];
    if (!ids.length) return [];
    const { data: orders } = await supabaseAdmin.from('sale_orders').select('order_number, status, dispatch_status').eq('organization_id', orgId).eq('stock_deducted', true).in('id', ids);
    return ((orders ?? []) as Row[]).filter((o) => !['cancelled', 'delivered', 'completed'].includes(String(o.status)) && !['dispatched', 'delivered'].includes(String(o.dispatch_status ?? ''))).map((o) => str(o.order_number)).filter(Boolean);
  } catch { return []; }
}
/** A recalled / quarantined batch must not leave the building. Every confirmed, undelivered order holding units of it gets its stock given back and picked again from valid batches.
 *  An order that cannot be re-picked (no other valid stock, or part of it was already returned) keeps its old pick and is named in `stuck` so a manager stops it by hand. */
async function repickOrdersForBatch(orgId: string, batchNumber: string): Promise<{ repicked: string[]; stuck: string[]; units: number }> {
  const out = { repicked: [] as string[], stuck: [] as string[], units: 0 };
  try {
    const { data: items } = await supabaseAdmin.from('sale_order_items').select('order_id').contains('batch_allocations', { batches: [{ batchNo: batchNumber, src: 'pharma' }] });
    const ids = [...new Set(((items ?? []) as Row[]).map((i) => i.order_id as string))];
    if (!ids.length) return out;
    const { data: orders } = await supabaseAdmin.from('sale_orders').select('id, order_number, status, dispatch_status').eq('organization_id', orgId).eq('stock_deducted', true).in('id', ids);
    const open = ((orders ?? []) as Row[]).filter((o) => !['cancelled', 'delivered', 'completed'].includes(String(o.status)) && !['dispatched', 'delivered'].includes(String(o.dispatch_status ?? '')));
    for (const o of open) {
      const orderId = o.id as string; const number = str(o.order_number);
      const { data: lines } = await supabaseAdmin.from('sale_order_items').select('batch_allocations').eq('order_id', orderId);
      const old = ((lines ?? []) as Row[]).map((l) => readAllocation(l.batch_allocations)).filter((a): a is Allocation => a !== null);
      const parts = old.flatMap((a) => a.batches);
      if (parts.some((p) => num(p.restocked) > 0)) { out.stuck.push(number); continue; } // part of this order already came back: do not re-pick automatically
      const units = parts.filter((p) => p.src === 'pharma' && p.batchNo === batchNumber).reduce((sum, p) => sum + num(p.quantity), 0);
      try {
        await releaseStockForOrder(orgId, orderId);
        try { await takeStockForOrder(orgId, orderId); }
        catch (e) { // could not pick again: put the order back exactly as it was
          await applyAllocations(orgId, old, 'take', `Recall re-pick of ${number} rolled back`);
          await supabaseAdmin.from('sale_orders').update({ stock_deducted: true }).eq('organization_id', orgId).eq('id', orderId);
          throw e;
        }
        out.repicked.push(number); out.units += units;
      } catch { out.stuck.push(number); }
    }
  } catch { /* best effort: the recall itself is already saved */ }
  return out;
}
/** A sales rep sees and edits only his own records (sales_rep = his employee code). Managers / admins see everything. */
const REP_SCOPED = new Set(['pharma_samples', 'pharma_hospital_engagements', 'pharma_medicine_returns']);
async function repCodeFor(req: Req, table: string): Promise<string | null> {
  if (!REP_SCOPED.has(table) || req.industryScope!.role !== 'sales_representative') return null;
  const rep = await fieldActivityService.currentRepresentative(org(req), (req as unknown as { auth: { sub: string } }).auth.sub) as { employee_code?: string | null };
  return str(rep.employee_code) || '__none__';
}

/** Campaign status follows the calendar: Planned -> Active on the start date, -> Completed after the end date. Cancelled / Completed are never touched. */
export async function refreshPromotionStatuses(orgId: string, industryTypeId: string | null) {
  try {
    let q = supabaseAdmin.from('pharma_promotions').select('id, status, start_date, end_date, product_name, product_code, hospital_name, samples_provided').eq('organization_id', orgId).not('status', 'in', '("Completed","Cancelled")');
    if (industryTypeId) q = q.eq('industry_type_id', industryTypeId);
    const { data } = await q;
    const t = today();
    for (const p of (data ?? []) as Row[]) {
      const start = str(p.start_date); const end = str(p.end_date);
      let next: string | null = null;
      if (end && end < t) next = 'Completed';
      else if (start && start <= t && ['Planned', 'Products selected', 'HCPs assigned'].includes(String(p.status))) next = 'Active';
      if (next && next !== p.status) await supabaseAdmin.from('pharma_promotions').update({ status: next }).eq('organization_id', orgId).eq('id', p.id as string);
      // Samples provided = units issued in Sample Management for this product (matched by product CODE when known) inside the campaign window.
      // Recalculated every time, so it follows Sample Management and never goes stale.
      if ((str(p.product_code) || str(p.product_name)) && start) {
        let sq = supabaseAdmin.from('pharma_samples').select('quantity_issued').eq('organization_id', orgId).eq(str(p.product_code) ? 'product_code' : 'product_name', str(p.product_code) || str(p.product_name)).gte('issue_date', start);
        if (end) sq = sq.lte('issue_date', end);
        if (str(p.hospital_name)) sq = sq.eq('hospital_name', str(p.hospital_name));
        const { data: given } = await sq;
        const total = ((given ?? []) as Row[]).reduce((sum, x) => sum + num(x.quantity_issued), 0);
        if (total > 0 && total !== num(p.samples_provided)) await supabaseAdmin.from('pharma_promotions').update({ samples_provided: total }).eq('organization_id', orgId).eq('id', p.id as string);
      }
    }
  } catch { /* never block the list */ }
}
/** A sample marked Distributed / Acknowledged to a hospital logs a "Sample distribution" visit in Hospital Engagement (once per sample). */
async function logSampleEngagement(orgId: string, industryTypeId: string, sample: Row) {
  try {
    if (!['Distributed', 'Acknowledged'].includes(String(sample.status)) || !str(sample.hospital_name)) return;
    const code = `HE-${str(sample.sample_code)}`;
    const { data: found } = await supabaseAdmin.from('pharma_hospital_engagements').select('id').eq('organization_id', orgId).eq('engagement_code', code).maybeSingle();
    if (found) return;
    await supabaseAdmin.from('pharma_hospital_engagements').insert({
      organization_id: orgId, industry_type_id: industryTypeId, engagement_code: code, hospital_name: sample.hospital_name,
      doctor_name: sample.doctor_name ?? null, sales_rep: sample.sales_rep ?? null, location: sample.location ?? null,
      engagement_type: 'Sample distribution', purpose: `Sample ${str(sample.sample_code)} — ${str(sample.product_name)}`,
      visit_date: today(), status: 'Visit completed',
    });
    if (!str(sample.visit_reference)) await supabaseAdmin.from('pharma_samples').update({ visit_reference: code }).eq('organization_id', orgId).eq('id', sample.id as string);
  } catch { /* best effort */ }
}

// ---- per-module rules ----------------------------------------------------------
/** New codes come from the form (list length + 1), so after a delete the next code can already exist. Take the next free number instead of failing. */
async function nextFreeCode(table: string, field: string, orgId: string, code: unknown): Promise<unknown> {
  const m = /^(.*-)(\d+)$/.exec(str(code));
  if (!m) return code;
  const { data } = await supabaseAdmin.from(table).select(field).eq('organization_id', orgId).like(field, `${m[1]}%`);
  const used = ((data ?? []) as unknown as Row[]).map((x) => String(x[field] ?? ''));
  if (!used.includes(String(code))) return code;
  const top = Math.max(...used.map((u) => Number(/(\d+)$/.exec(u)?.[1] ?? 0)));
  return `${m[1]}${String(top + 1).padStart(m[2].length, '0')}`;
}
interface Ctx { orgId: string; industryTypeId: string; payload: Row; existing: Row | null; actor?: string | null }
type Prepare = (c: Ctx) => Promise<void>;
type After = (c: Ctx & { saved: Row }) => Promise<void>;

const prepareBatch: Prepare = async ({ orgId, industryTypeId, payload, existing }) => {
  if (payload.product_code) {
    const p = await findProduct(orgId, industryTypeId, 'product_code', payload.product_code);
    if (!p) throw bad(`Product ${str(payload.product_code)} does not exist in this industry. Add it in Products first.`, 'INVALID_REFERENCE');
    payload.product_name = p.product_name; // product master wins
    if (!existing) { // a new lot of a known product inherits supplier / unit / warehouse / rep from its previous lot
      const { data: last } = await supabaseAdmin.from('pharma_batches').select('supplier, unit, warehouse_location, sales_rep').eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('product_code', str(payload.product_code)).order('created_at', { ascending: false }).limit(1).maybeSingle();
      for (const k of ['supplier', 'unit', 'warehouse_location', 'sales_rep']) if (!str(payload[k]) && last && str((last as Row)[k])) payload[k] = (last as Row)[k];
    }
    if (!existing) { // double-save guard: same product + same dates created in the last 30 seconds is a duplicate click, not a new lot
      const since = new Date(Date.now() - 30_000).toISOString();
      let recent = supabaseAdmin.from('pharma_batches').select('batch_number').eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('product_code', str(payload.product_code)).gte('created_at', since).limit(1);
      recent = payload.manufacture_date ? recent.eq('manufacture_date', str(payload.manufacture_date)) : recent.is('manufacture_date', null);
      recent = payload.expiry_date ? recent.eq('expiry_date', str(payload.expiry_date)) : recent.is('expiry_date', null);
      const { data: justSaved } = await recent;
      if (justSaved && justSaved.length > 0) throw new AppError(409, 'DUPLICATE_RECORD', `Batch ${str((justSaved[0] as Row).batch_number)} was just saved for this product with the same dates. Edit that batch instead of adding another.`);
    }
  }
  const m = { ...(existing ?? {}), ...payload };
  if (m.manufacture_date && m.expiry_date && String(m.expiry_date) < String(m.manufacture_date)) throw bad('Expiry cannot be before the manufacture date.');
  const open = existing ? await countWhere('pharma_recalls', orgId, 'batch_number', existing.batch_number, (q) => q.neq('status', 'Closed')) : 0;
  if (open > 0) payload.status = 'Recalled';
  else if (payload.status === 'Quarantined' || payload.status === 'Recalled') { /* manual hold */ }
  else payload.status = expiryStatus(m.expiry_date); // Valid / Expiring / Critical / Expired are always automatic
};
const afterBatch: After = async ({ orgId, industryTypeId, saved, existing, actor }) => {
  // a hand-edited quantity is written to the stock audit log (who, how much, when)
  if (!existing) { if (num(saved.quantity) > 0) await logMovement(orgId, saved.id as string, saved.batch_number, num(saved.quantity), 'Batch created', actor); }
  else if (num(saved.quantity) !== num(existing.quantity)) await logMovement(orgId, saved.id as string, saved.batch_number, num(saved.quantity) - num(existing.quantity), 'Manual quantity edit', actor);
  if (existing && saved.status === 'Quarantined' && existing.status !== 'Quarantined') await repickOrdersForBatch(orgId, str(saved.batch_number));
  await syncProductStock(orgId, industryTypeId, saved.product_code);
  if (existing && existing.product_code !== saved.product_code) await syncProductStock(orgId, industryTypeId, existing.product_code);
};

const createdAsReturned = new WeakMap<object, number>(); // units still unused when a sample is created straight as Returned
const prepareSample: Prepare = async ({ orgId, industryTypeId, payload, existing }) => {
  if (existing) delete payload.batch_number; // a sample never moves to another batch: delete and re-issue instead
  const batch = await getBatch(orgId, industryTypeId, existing ? existing.batch_number : payload.batch_number);
  const issued = payload.quantity_issued !== undefined ? num(payload.quantity_issued) : num(existing?.quantity_issued);
  const oldIssued = num(existing?.quantity_issued);
  const delta = issued - oldIssued;
  if (!existing && issued <= 0) throw bad('Quantity issued must be greater than zero.');
  if (delta > 0) {
    if (isBlocked(batch)) throw bad(`Batch ${str(batch.batch_number)} is ${expiryStatus(batch.expiry_date) === 'Expired' ? 'expired' : String(batch.status).toLowerCase()} and cannot be issued.`, 'BATCH_NOT_ISSUABLE');
    if (delta > num(batch.quantity)) throw new AppError(409, 'INSUFFICIENT_STOCK', `Batch ${str(batch.batch_number)} has only ${num(batch.quantity)} available.`);
  }
  payload.product_name = batch.product_name; payload.product_code = batch.product_code ?? null; payload.expiry_date = batch.expiry_date;
  if (!existing) { if (payload.quantity_remaining == null) payload.quantity_remaining = issued; if (!payload.issue_date) payload.issue_date = today(); if (!payload.status) payload.status = 'Assigned'; }
  else if (delta !== 0 && payload.quantity_remaining === undefined) payload.quantity_remaining = Math.max(0, num(existing.quantity_remaining) + delta);
  const remaining = payload.quantity_remaining !== undefined ? num(payload.quantity_remaining) : num(existing?.quantity_remaining);
  if (remaining > issued) throw bad('Quantity remaining cannot be more than quantity issued.');
  const m = { ...(existing ?? {}), ...payload };
  if (['Distributed', 'Acknowledged'].includes(String(m.status)) && !str(m.doctor_name) && !str(m.hospital_name)) throw bad('Enter the doctor or hospital before marking a sample Distributed.');
   if (existing?.status === 'Returned' && m.status !== 'Returned') throw bad('A returned sample is closed and cannot be re-opened. Create a new sample instead.');
  if (existing?.status === 'Returned' && m.status === 'Returned' && delta !== 0) throw bad('The quantity of a returned sample cannot be changed.');
  if (m.status === 'Returned') {
    if (!existing) createdAsReturned.set(payload, num(m.quantity_remaining)); // creation case: restored in afterSample
    payload.quantity_remaining = 0; // a returned sample never keeps units
  }
};
const afterSample: After = async ({ orgId, industryTypeId, saved, actor, existing, payload }) => {
  const batch = await getBatch(orgId, industryTypeId, saved.batch_number);
  const batchId = batch.id as string;
  if (!existing) {
    await changeBatchQty(orgId, batchId, -num(saved.quantity_issued), `Sample ${str(saved.sample_code)} issued`, actor);
    const back = createdAsReturned.get(payload) ?? 0;
    if (back > 0) await changeBatchQty(orgId, batchId, back, `Sample ${str(saved.sample_code)} returned`, actor); // created straight as Returned: unused units go back to stock
  }
  else {
    await changeBatchQty(orgId, batchId, -(num(saved.quantity_issued) - num(existing.quantity_issued)), `Sample ${str(saved.sample_code)} changed`, actor);
    if (saved.status === 'Returned' && existing.status !== 'Returned') await changeBatchQty(orgId, batchId, num(existing.quantity_remaining), `Sample ${str(saved.sample_code)} returned`, actor); // unused units back to stock
  }
  await syncProductStock(orgId, industryTypeId, batch.product_code);
  if (existing && saved.status === 'Returned' && existing.status !== 'Returned') await addRecallCollected(orgId, saved.batch_number, num(existing.quantity_remaining));
  await logSampleEngagement(orgId, industryTypeId, saved);
};

const preparePromotion: Prepare = async ({ orgId, industryTypeId, payload, existing }) => {
  const m = { ...(existing ?? {}), ...payload };
  if (payload.product_code || payload.product_name) {
    const prod = payload.product_code ? await findProduct(orgId, industryTypeId, 'product_code', payload.product_code) : await findProduct(orgId, industryTypeId, 'product_name', payload.product_name);
    if (!prod) throw bad(`Product ${str(payload.product_code) || str(payload.product_name)} does not exist in this industry. Add it in Products first.`, 'INVALID_REFERENCE');
    payload.product_name = prod.product_name; payload.product_code = prod.product_code; // code is the key, name follows the product master
  }
  if (m.start_date && m.end_date && String(m.end_date) < String(m.start_date)) throw bad('Campaign end date cannot be before the start date.');
  if (!existing && !payload.status) payload.status = 'Planned';
  const hasFeedback = !!str(m.feedback) || (!!str(m.doctor_response) && m.doctor_response !== 'No response yet');
  if (m.status === 'Active' && hasFeedback) payload.status = 'Feedback captured';
};

const prepareEngagement: Prepare = async ({ payload, existing }) => {
  if (!existing && !payload.visit_date) payload.visit_date = today();
  const m = { ...(existing ?? {}), ...payload };
  if (m.visit_date && m.next_follow_up_date && String(m.next_follow_up_date) < String(m.visit_date)) throw bad('Next follow-up date cannot be before the visit date.');
  let status = String(m.status || 'Visit scheduled');
  if (status === 'Visit completed' && (str(m.outcome) || str(m.discussion_notes))) status = 'Interaction recorded';
  if (['Visit completed', 'Interaction recorded'].includes(status) && str(m.next_follow_up_date)) status = 'Follow-up created';
  payload.status = status;
};

/** A next follow-up date on an engagement becomes a real Follow-up (client + rep resolved from the picked hospital / rep). Skipped when either cannot be matched, or an open one already exists. */
const afterEngagement: After = async ({ orgId, industryTypeId, saved }) => {
  try {
    const due = str(saved.next_follow_up_date);
    if (!due || due < today() || !str(saved.hospital_name) || !str(saved.sales_rep)) return;
    const [{ data: client }, { data: rep }] = await Promise.all([
      supabaseAdmin.from('clients').select('id').eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('client_name', str(saved.hospital_name)).limit(1).maybeSingle(),
      supabaseAdmin.from('sales_representatives').select('id').eq('organization_id', orgId).eq('employee_code', str(saved.sales_rep)).maybeSingle(),
    ]);
    if (!client || !rep) return;
    const title = `Follow up: ${str(saved.hospital_name)} (${str(saved.engagement_code)})`;
    const { data: open } = await supabaseAdmin.from('follow_ups').select('id').eq('organization_id', orgId).eq('client_id', client.id).eq('title', title).in('status', ['pending', 'in_progress']).limit(1).maybeSingle();
    if (open) return;
    const dueAt = new Date(Math.max(Date.parse(`${due}T09:00:00+05:30`), Date.now() + 5 * 60000)).toISOString();
    await createFollowUp(orgId, { clientId: client.id as string, representativeId: rep.id as string, title, dueAt, priority: 'normal', followUpType: 'visit', notes: str(saved.outcome) || str(saved.discussion_notes) || null });
  } catch { /* the engagement is already saved; the follow-up stays manual */ }
};

/** Order selected as the return's Invoice / order reference: must be a real Sales Order of this industry, for the same customer, and must have sold this product / batch. */
type OrderLine = { quantity: unknown; free_quantity: unknown; batch_allocations: unknown; products: { product_code: string | null; product_name: string | null } | null };
const sameText = (a: unknown, b: unknown) => str(a).trim().toLowerCase() === str(b).trim().toLowerCase();
async function validateReturnOrder(orgId: string, industryTypeId: string, m: Row, payload: Row, existing: Row | null) {
  const ref = str(m.invoice_reference).trim();
  if (!ref) return;
  const changed = !existing || !sameText(existing.invoice_reference, ref) || ('quantity' in payload && num(existing.quantity) !== num(m.quantity)) || ('batch_number' in payload && str(existing.batch_number) !== str(m.batch_number));
  if (!changed) return; // old records keep working until someone edits the order / product / quantity
  const { data: order, error } = await supabaseAdmin.from('sale_orders')
    .select('id, order_number, status, clients!inner(client_name, industry_type_id), sales_representatives(employee_code), sale_order_items(quantity, free_quantity, batch_allocations, products(product_code, product_name))')
    .eq('organization_id', orgId).eq('order_number', ref).maybeSingle();
  if (error) throw error;
  const o = order as unknown as { id: string; status: string; clients: { client_name: string; industry_type_id: string | null }; sales_representatives: { employee_code: string | null } | null; sale_order_items: OrderLine[] } | null;
  if (!o || o.clients?.industry_type_id !== industryTypeId) throw bad(`Order ${ref} does not exist in this industry. Pick it from the Sales Orders list.`, 'INVALID_REFERENCE');
  if (o.status === 'cancelled') throw bad(`Order ${ref} was cancelled — a return cannot be raised against it.`);
  // Customer must match the order's customer (filled in from the order when left empty).
  if (str(m.customer_hospital) && !sameText(m.customer_hospital, o.clients.client_name)) throw bad(`Order ${ref} belongs to ${o.clients.client_name}, not ${str(m.customer_hospital)}.`);
  if (!str(m.customer_hospital)) payload.customer_hospital = o.clients.client_name;
  if (!str(m.sales_rep) && o.sales_representatives?.employee_code) payload.sales_rep = o.sales_representatives.employee_code;
  // The returned product must be on the order.
  const lines = o.sale_order_items ?? [];
  const pname = str(payload.product_name ?? m.product_name);
  const mine = lines.filter((l) => sameText(l.products?.product_name, pname));
  if (!mine.length) throw bad(`${pname || 'This product'} is not on order ${ref}.`);
  // The returned batch must be one that this order actually took stock from (only checked when the order recorded its batches).
  const bn = str(m.batch_number);
  if (bn) {
    const parts = mine.flatMap((l) => ((l.batch_allocations as { batches?: { batchNo?: string }[] } | null)?.batches ?? []));
    if (parts.length && !parts.some((p) => sameText(p.batchNo, bn))) throw bad(`Batch ${bn} was not supplied on order ${ref}.`);
  }
  // Quantity: cannot return more than was sold minus what earlier (non-rejected) returns already took back.
  const sold = mine.reduce((sum, l) => sum + num(l.quantity) + num(l.free_quantity), 0);
  let q = supabaseAdmin.from('pharma_medicine_returns').select('quantity, product_name').eq('organization_id', orgId).eq('invoice_reference', ref).neq('status', 'Rejected');
  if (existing?.id) q = q.neq('id', existing.id as string);
  const { data: prior, error: e2 } = await q;
  if (e2) throw e2;
  const already = ((prior ?? []) as Row[]).filter((r) => sameText(r.product_name, pname)).reduce((sum, r) => sum + num(r.quantity), 0);
  if (num(m.quantity) > sold - already) throw bad(`Only ${Math.max(sold - already, 0)} unit(s) of ${pname} can still be returned on order ${ref} (sold ${sold}, already returned ${already}).`);
}

const NOT_SALEABLE_REASONS = ['Expired', 'Near expiry', 'Damaged', 'Recall', 'Quality issue'];
const prepareReturn: Prepare = async ({ orgId, industryTypeId, payload, existing }) => {
  if (existing?.stock_applied) throw new AppError(409, 'RECORD_LOCKED', 'This return has already been restocked and can no longer be edited.');
  const m: Row = { ...(existing ?? {}), ...payload };
  if (!existing && num(m.quantity) <= 0) throw bad('Returned quantity must be greater than zero.');
  if (str(m.batch_number)) {
    const b = await getBatch(orgId, industryTypeId, m.batch_number);
    payload.product_name = b.product_name;
  }
  if (existing?.sales_return_id) {
    // Credit was already given to the customer for this return: the money-related parts can no longer change.
    const changedKey = ['invoice_reference', 'product_name', 'quantity', 'batch_number', 'fault_side'].some((k) => k in payload && String(payload[k] ?? '') !== String(existing[k] ?? ''));
    if (changedKey || payload.status === 'Rejected') throw new AppError(409, 'RECORD_LOCKED', 'Credit was already given to the customer for this return, so the order, product, quantity and credit setting can no longer be changed.');
  }
  if (!existing && !str(m.invoice_reference)) throw bad('Pick the customer and the Sales Order this return is against.');
  await validateReturnOrder(orgId, industryTypeId, m, payload, existing ?? null);
  if (!existing) { if (!payload.status) payload.status = 'Requested'; if (!payload.inspection_status) payload.inspection_status = 'Pending'; if (!payload.return_date) payload.return_date = today(); }
  const status = String(payload.status ?? existing?.status ?? 'Requested');
  if (m.disposition === 'Saleable' && NOT_SALEABLE_REASONS.includes(String(m.reason))) throw bad(`Medicine returned as "${String(m.reason)}" can never be Saleable. Choose Quarantine, Damaged, Expired or Disposal.`);
  if (['Approved', 'Closed'].includes(status) && !['Approved', 'Closed'].includes(String(existing?.status ?? ''))) {
    if (!str(m.fault_side)) throw bad('Choose whose mistake it was (Our side / Customer side) before approving this return.');
    if (m.fault_side === 'Our side' && !str(m.invoice_reference)) throw bad('Pick the Sales Order so the customer can get credit for our mistake.');
  }
  if (['Approved', 'Closed'].includes(status)) {
    if (!str(m.disposition)) throw bad('Choose a disposition before approving or closing a return.');
    if (String(m.inspection_status ?? 'Pending') === 'Pending') throw bad('Inspect the returned medicine before approving it.');
    if (m.disposition === 'Saleable') {
      if (m.inspection_status !== 'Passed') throw bad('Only medicine that Passed inspection can be restocked as Saleable.');
      if (!str(m.batch_number)) throw bad('A batch number is required to restock saleable medicine.');
      const b = await getBatch(orgId, industryTypeId, m.batch_number);
      if (isBlocked(b)) throw bad(`Batch ${str(b.batch_number)} is expired / recalled / quarantined — returned stock cannot be Saleable.`);
    }
  }
};
/** Approved return -> approved credit note in the shared sales_returns table (same engine FMCG uses), so the customer's outstanding drops. Runs once per return. */
async function creditCustomerForReturn(orgId: string, saved: Row, existing: Row | null, actor: string | null) {
  if (saved.sales_return_id || !['Approved', 'Closed'].includes(String(saved.status))) return;
  if (['Approved', 'Closed'].includes(String(existing?.status ?? ''))) return; // only when the return becomes approved now
  if (str(saved.fault_side) !== 'Our side' || !str(saved.invoice_reference) || num(saved.quantity) <= 0 || !actor) return;
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, sale_order_items(products(id, product_name))').eq('organization_id', orgId).eq('order_number', str(saved.invoice_reference)).maybeSingle();
  if (error) throw error;
  const lines = ((order as unknown as { id: string; sale_order_items: { products: { id: string; product_name: string | null } | null }[] } | null)?.sale_order_items ?? []);
  const product = lines.map((l) => l.products).find((p) => sameText(p?.product_name, saved.product_name));
  if (!order || !product) return;
  const scope = { role: 'admin', lockedIndustryTypeId: null }; // the order / industry were already checked in prepareReturn
  const entry = await createReturn(orgId, actor, scope, { orderId: (order as { id: string }).id, productId: product.id, quantity: num(saved.quantity), kind: 'return', reason: `Pharma return ${str(saved.return_code)}${str(saved.reason) ? ` — ${str(saved.reason)}` : ''}`, restock: false, creditClient: true }) as { id: string };
  try { await decideReturn(orgId, actor, scope, entry.id, 'approved'); }
  catch (e) { await supabaseAdmin.from('sales_returns').delete().eq('organization_id', orgId).eq('id', entry.id); throw e; } // no half-made credit note
  await supabaseAdmin.from('pharma_medicine_returns').update({ sales_return_id: entry.id }).eq('organization_id', orgId).eq('id', saved.id as string);
}
const afterReturn: After = async ({ orgId, industryTypeId, saved, existing, actor }) => {
  await creditCustomerForReturn(orgId, saved, existing ?? null, actor ?? null);
  if (!saved.recall_applied && ['Approved', 'Closed'].includes(String(saved.status)) && saved.reason === 'Recall' && await addRecallCollected(orgId, saved.batch_number, num(saved.quantity))) {
    await supabaseAdmin.from('pharma_medicine_returns').update({ recall_applied: true }).eq('organization_id', orgId).eq('id', saved.id as string);
  }
  if (saved.stock_applied || !['Approved', 'Closed'].includes(String(saved.status)) || saved.disposition !== 'Saleable') return;
  const b = await getBatch(orgId, industryTypeId, saved.batch_number);
  await changeBatchQty(orgId, b.id as string, num(saved.quantity), `Medicine return ${str(saved.return_code)} restocked`, actor);
  await supabaseAdmin.from('pharma_medicine_returns').update({ stock_applied: true }).eq('organization_id', orgId).eq('id', saved.id as string);
  await syncProductStock(orgId, industryTypeId, b.product_code);
};

/** Customers whose orders took stock from this pharma batch (read from the batch allocations saved on each order line). */
async function orderCustomersForBatch(orgId: string, batchNumber: string): Promise<string[]> {
  try {
    const { data: items } = await supabaseAdmin.from('sale_order_items').select('order_id').contains('batch_allocations', { batches: [{ batchNo: batchNumber, src: 'pharma' }] });
    const ids = [...new Set(((items ?? []) as Row[]).map((i) => i.order_id as string))];
    if (!ids.length) return [];
    const { data: orders } = await supabaseAdmin.from('sale_orders').select('id, clients(client_name)').eq('organization_id', orgId).in('id', ids);
    return [...new Set(((orders ?? []) as unknown as { clients: { client_name?: string } | { client_name?: string }[] | null }[]).map((o) => (Array.isArray(o.clients) ? o.clients[0] : o.clients)?.client_name ?? '').filter(Boolean))];
  } catch { return []; }
}
/** Units of this batch that went out to customers (orders) and reps / doctors (samples) and have not come back. */
async function suppliedQtyForBatch(orgId: string, batchNumber: string): Promise<number> {
  try {
    let total = 0;
    const { data: items } = await supabaseAdmin.from('sale_order_items').select('order_id, batch_allocations').contains('batch_allocations', { batches: [{ batchNo: batchNumber, src: 'pharma' }] });
    const rows = (items ?? []) as Row[];
    const ids = [...new Set(rows.map((i) => i.order_id as string))];
    if (ids.length) {
      const { data: orders } = await supabaseAdmin.from('sale_orders').select('id').eq('organization_id', orgId).eq('stock_deducted', true).in('id', ids);
      const live = new Set(((orders ?? []) as Row[]).map((o) => o.id as string));
      for (const i of rows) {
        if (!live.has(i.order_id as string)) continue;
        const parts = ((i.batch_allocations as { batches?: Row[] } | null)?.batches ?? []);
        for (const p of parts) if (p.batchNo === batchNumber && p.src === 'pharma') total += num(p.quantity) - num(p.restocked);
      }
    }
    const { data: back } = await supabaseAdmin.from('pharma_medicine_returns').select('quantity').eq('organization_id', orgId).eq('batch_number', batchNumber).in('status', ['Approved', 'Closed']);
    total -= ((back ?? []) as Row[]).reduce((s, r) => s + num(r.quantity), 0); // already came back from customers
    total = Math.max(total, 0);
    const { data: smp } = await supabaseAdmin.from('pharma_samples').select('quantity_remaining').eq('organization_id', orgId).eq('batch_number', batchNumber).neq('status', 'Returned');
    total += ((smp ?? []) as Row[]).reduce((s, r) => s + num(r.quantity_remaining), 0); // sample units still with reps / doctors
    return total;
  } catch { return 0; }
}
const prepareRecall: Prepare = async ({ orgId, industryTypeId, payload, existing }) => {
  if (existing) { delete payload.batch_number; delete payload.stock_quantity; delete payload.supplied_quantity; delete payload.affected_quantity; }
  const b = await getBatch(orgId, industryTypeId, existing ? existing.batch_number : payload.batch_number);
  payload.product_name = b.product_name;
  if (!existing && (await countWhere('pharma_recalls', orgId, 'batch_number', b.batch_number, (q) => q.eq('industry_type_id', industryTypeId).neq('status', 'Closed'))) > 0) throw bad(`Batch ${str(b.batch_number)} already has an open recall. Update that recall instead of creating another.`, 'DUPLICATE_RECORD');
  if (!existing && !str(payload.notes)) { const held = await pendingOrdersForBatch(orgId, str(b.batch_number)); if (held.length) payload.notes = `Orders still holding this batch (stop / re-pick before dispatch): ${held.join(', ')}`; }
  if (!existing) { // our own stock = written off as waste; what customers already hold = collected back
    payload.stock_quantity = num(b.quantity);
    payload.supplied_quantity = await suppliedQtyForBatch(orgId, str(b.batch_number));
    payload.affected_quantity = num(payload.stock_quantity) + num(payload.supplied_quantity);
    payload.collected_quantity = 0;
  }
  const m = { ...(existing ?? {}), ...payload };
  if (num(m.collected_quantity) > num(m.supplied_quantity)) throw bad(`Collected quantity cannot be more than the ${num(m.supplied_quantity)} unit(s) supplied to customers.`);
  if (m.status === 'Closed' && num(m.collected_quantity) + 1e-9 < num(m.supplied_quantity)) throw bad(`Collect back all ${num(m.supplied_quantity)} unit(s) from customers before closing (collected ${num(m.collected_quantity)}).`);
  if (!existing) {
    if (!payload.recall_date) payload.recall_date = today();
    if (!payload.status) payload.status = 'Batch identified';
    if (!str(payload.affected_customers)) { // who actually received this batch: sample recipients AND customers who bought it on an order
      const { data } = await supabaseAdmin.from('pharma_samples').select('hospital_name, doctor_name').eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('batch_number', str(b.batch_number));
      const names = new Set(((data ?? []) as Row[]).map((s) => str(s.hospital_name) || str(s.doctor_name)).filter(Boolean));
      for (const n of await orderCustomersForBatch(orgId, str(b.batch_number))) names.add(n);
      if (names.size) payload.affected_customers = [...names].join('\n');
    }
  }
  if (!existing) { // sensible starting point so the recall needs no typing
    if (!str(payload.severity)) payload.severity = 'Medium';
    if (!str(payload.action_required)) payload.action_required = ['Critical', 'High'].includes(String(payload.severity)) ? 'Stop all sale and sample issue of this batch immediately. Collect remaining stock from the field and distributors and quarantine it.' : 'Hold this batch, inform affected accounts and collect remaining stock for review.';
    if (!str(payload.assigned_team) && str(b.sales_rep)) payload.assigned_team = b.sales_rep;
    if (payload.status === 'Batch identified' && (num(payload.affected_quantity) > 0 || str(payload.affected_customers))) payload.status = 'Stock identified';
  }
  if (m.status === 'Closed' && !m.completion_date) payload.completion_date = today();
};
const afterRecall: After = async ({ orgId, industryTypeId, saved, existing, actor }) => {
  await reconcileBatchAfterRecall(orgId, industryTypeId, saved.batch_number, 'saved');
  if (!existing && saved.status !== 'Closed') { // new recall: orders that are not delivered yet must not ship this batch
    const moved = await repickOrdersForBatch(orgId, str(saved.batch_number));
    if (moved.repicked.length || moved.stuck.length) {
      const lines = [
        moved.repicked.length ? `Re-picked from valid batches: ${moved.repicked.join(', ')}.` : '',
        moved.stuck.length ? `STOP before dispatch (could not be re-picked): ${moved.stuck.join(', ')}.` : '',
      ].filter(Boolean).join('\n');
      const current = str(saved.notes);
      const notes = !current || current.startsWith('Orders still holding this batch') ? lines : `${current}\n${lines}`;
      // units given back to the batch are now our own stock, not stock at customers
      const patch: Row = { notes };
      if (moved.units > 0) { patch.stock_quantity = num(saved.stock_quantity) + moved.units; patch.supplied_quantity = Math.max(0, num(saved.supplied_quantity) - moved.units); }
      await supabaseAdmin.from('pharma_recalls').update(patch).eq('organization_id', orgId).eq('id', saved.id as string);
      await syncProductStock(orgId, industryTypeId, (await getBatch(orgId, industryTypeId, saved.batch_number)).product_code);
    }
  }
  if (saved.status !== 'Closed' || saved.stock_written_off) return; // closed recall: everything left in the batch goes to waste (once)
  const b = await getBatch(orgId, industryTypeId, saved.batch_number);
  const waste = num(b.quantity);
  if (waste > 0) await changeBatchQty(orgId, b.id as string, -waste, `Recall ${str(saved.recall_code)} - written off as waste`, actor);
  await supabaseAdmin.from('pharma_recalls').update({ stock_written_off: true }).eq('organization_id', orgId).eq('id', saved.id as string);
  await syncProductStock(orgId, industryTypeId, b.product_code);
};

const PREPARE: Record<string, Prepare | undefined> = {
  pharma_batches: prepareBatch, pharma_samples: prepareSample, pharma_promotions: preparePromotion,
  pharma_hospital_engagements: prepareEngagement, pharma_medicine_returns: prepareReturn, pharma_recalls: prepareRecall,
};
const AFTER: Record<string, After | undefined> = {
  pharma_batches: afterBatch, pharma_samples: afterSample, pharma_hospital_engagements: afterEngagement, pharma_medicine_returns: afterReturn, pharma_recalls: afterRecall,
};

async function assertCanDelete(r: PharmaResource, orgId: string, row: Row) {
  if (r.table === 'pharma_batches') {
    const n = row.batch_number;
    const [s, rt, rc] = await Promise.all([countWhere('pharma_samples', orgId, 'batch_number', n), countWhere('pharma_medicine_returns', orgId, 'batch_number', n), countWhere('pharma_recalls', orgId, 'batch_number', n)]);
    if (s || rt || rc) throw new AppError(409, 'RECORD_IN_USE', `This batch is used by ${s} sample(s), ${rt} return(s) and ${rc} recall(s). Remove them first.`);
  }
  if (r.table === 'pharma_medicine_returns' && row.sales_return_id) throw new AppError(409, 'RECORD_IN_USE', 'Credit was already given to the customer for this return, so it cannot be deleted.');
  if (r.table === 'pharma_medicine_returns' && row.stock_applied) throw new AppError(409, 'RECORD_IN_USE', 'This return was already restocked into its batch and cannot be deleted.');
}

// ---- dashboard summary, alerts and scheduled upkeep (registered BEFORE the generic CRUD) ----
/** Re-adds every product's stock from its saleable batches (fixes drift after returns into a recalled batch, etc.). */
export async function reconcilePharmaProductStock(orgId: string) {
  try {
    const { data } = await supabaseAdmin.from('pharma_batches').select('industry_type_id, product_code').eq('organization_id', orgId).not('product_code', 'is', null);
    const seen = new Set<string>();
    for (const b of (data ?? []) as Row[]) { const k = `${b.industry_type_id}|${b.product_code}`; if (seen.has(k)) continue; seen.add(k); await syncProductStock(orgId, b.industry_type_id as string, b.product_code); }
  } catch { /* best effort */ }
}
/** Everything the background job does for one organization. */
export async function runPharmaUpkeep(orgId: string) {
  await refreshBatchStatuses(orgId, null);
  await refreshPromotionStatuses(orgId, null);
  await reconcilePharmaProductStock(orgId);
}
export async function pharmaSummary(orgId: string, industryTypeId: string | null, listLimit = 15) {
  const scoped = (table: string, cols: string) => { let q = supabaseAdmin.from(table).select(cols).eq('organization_id', orgId); if (industryTypeId) q = q.eq('industry_type_id', industryTypeId); return q; };
  const [b, r, s, p, m, e] = await Promise.all([
    scoped('pharma_batches', 'batch_number, product_name, expiry_date, quantity, status'),
    scoped('pharma_recalls', 'recall_code, product_name, batch_number, severity, status'),
    scoped('pharma_samples', 'quantity_issued, quantity_remaining, status'),
    scoped('pharma_promotions', 'status, end_date'),
    scoped('pharma_medicine_returns', 'status, inspection_status'),
    scoped('pharma_hospital_engagements', 'hospital_name, next_follow_up_date, status'),
  ]);
  for (const x of [b, r, s, p, m, e]) if (x.error) throw x.error;
  const batches = (b.data ?? []) as unknown as Row[]; const recalls = (r.data ?? []) as unknown as Row[]; const samples = (s.data ?? []) as unknown as Row[];
  const promos = (p.data ?? []) as unknown as Row[]; const returns = (m.data ?? []) as unknown as Row[]; const eng = (e.data ?? []) as unknown as Row[];
  const t = today();
  const live = batches.filter((x) => num(x.quantity) > 0);
  const withDays = live.map((x) => ({ batch_number: x.batch_number, product_name: x.product_name, quantity: num(x.quantity), expiry_date: x.expiry_date, days_left: daysLeft(x.expiry_date), status: x.status }));
  const expiring = withDays.filter((x) => x.days_left !== null && x.days_left <= 90 && !['Recalled', 'Quarantined'].includes(String(x.status))).sort((a, c) => (a.days_left ?? 0) - (c.days_left ?? 0));
  return {
    batches: { total: batches.length, expired: expiring.filter((x) => (x.days_left ?? 0) < 0).length, critical: expiring.filter((x) => (x.days_left ?? 0) >= 0 && (x.days_left ?? 0) <= 30).length, expiringSoon: expiring.filter((x) => (x.days_left ?? 0) > 30).length, unitsAtRisk: expiring.reduce((sum, x) => sum + x.quantity, 0), list: expiring.slice(0, listLimit) },
    recalls: { open: recalls.filter((x) => x.status !== 'Closed').length, critical: recalls.filter((x) => x.status !== 'Closed' && ['Critical', 'High'].includes(String(x.severity))).length, list: recalls.filter((x) => x.status !== 'Closed').slice(0, Math.max(10, listLimit)) },
    samples: { unitsIssued: samples.reduce((sum, x) => sum + num(x.quantity_issued), 0), unitsRemaining: samples.reduce((sum, x) => sum + num(x.quantity_remaining), 0), distributed: samples.filter((x) => ['Distributed', 'Acknowledged'].includes(String(x.status))).length },
    promotions: { active: promos.filter((x) => ['Active', 'Feedback captured'].includes(String(x.status))).length, total: promos.length },
    returns: { awaitingInspection: returns.filter((x) => !['Approved', 'Rejected', 'Closed'].includes(String(x.status)) && String(x.inspection_status ?? 'Pending') === 'Pending').length, total: returns.length },
    engagements: { followUpsDue: eng.filter((x) => x.next_follow_up_date && String(x.next_follow_up_date) <= t && x.status !== 'Follow-up completed').length, total: eng.length },
  };
}
pharmaRouter.get('/pharma/summary', authenticate, reader, async (req, res) => {
  const industryTypeId = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  await refreshBatchStatuses(org(req), industryTypeId);
  res.json({ data: await pharmaSummary(org(req), industryTypeId) });
});
/** Flat alert list (same idea as /fmcg/alerts) for the Notifications page and the mobile app. */
pharmaRouter.get('/pharma/alerts', authenticate, reader, async (req, res) => {
  const industryTypeId = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  const sum = await pharmaSummary(org(req), industryTypeId, 200);
  const t = today();
  // Returns to inspect and hospital follow-ups due: a rep sees only his own (same rule as the lists).
  const scoped = async (table: string, cols: string) => {
    let q = supabaseAdmin.from(table).select(cols).eq('organization_id', org(req));
    if (industryTypeId) q = q.eq('industry_type_id', industryTypeId);
    const own = await repCodeFor(req, table);
    if (own) q = q.eq('sales_rep', own);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as Row[];
  };
  const [returns, engagements] = await Promise.all([
    scoped('pharma_medicine_returns', 'return_code, product_name, batch_number, quantity, status, inspection_status'),
    scoped('pharma_hospital_engagements', 'engagement_code, hospital_name, next_follow_up_date, status'),]);
  const extra: Row[] = [];
  if (industryTypeId) {
    const { data: cl } = await supabaseAdmin.from('clients').select('id, client_name, client_code, industry_details').eq('organization_id', org(req)).eq('industry_type_id', industryTypeId);
    for (const c of (cl ?? []) as Row[]) {
      const d = licenseDaysLeft(c.industry_details); if (d === null || d > LICENSE_WARN_DAYS) continue;
      extra.push({ id: `license:${str(c.client_code) || str(c.id)}`, type: 'license', level: d < 0 ? 'expired' : d <= 7 ? 'critical' : 'warning', title: `Drug licence · ${str(c.client_name)}`, message: d < 0 ? `Drug licence expired ${Math.abs(d)} day(s) ago — sales to this customer are blocked until it is renewed.` : `Drug licence expires in ${d} day(s) — renew before sales are blocked.` });
    }
    for (const x of sum.batches.list.filter((b) => (b.days_left ?? 0) < 0).slice(0, 25)) {
      const held = await pendingOrdersForBatch(org(req), str(x.batch_number));
      if (held.length) extra.push({ id: `heldorders:${str(x.batch_number)}`, type: 'expiry', level: 'critical', title: `Expired batch ${str(x.batch_number)} is on open orders`, message: `Orders ${held.join(', ')} still hold this expired batch — stop them before dispatch.`, batchNumber: x.batch_number });
    }
  }
  const alerts = [
    ...extra,
    // ids are stable (record codes), so a dismissed / read alert stays dismissed / read
    ...sum.batches.list.map((x) => { const d = x.days_left ?? 0; return { id: `expiry:${x.batch_number}`, type: 'expiry', level: d < 0 ? 'expired' : d <= 30 ? 'critical' : 'warning', title: `${x.product_name} · batch ${x.batch_number}`, message: d < 0 ? `Expired ${Math.abs(d)} day(s) ago — ${x.quantity} units on hand` : `Expires in ${d} day(s) — ${x.quantity} units on hand`, batchNumber: x.batch_number, daysLeft: d, quantity: x.quantity, expiryDate: x.expiry_date }; }),
    ...sum.recalls.list.map((x) => ({ id: `recall:${x.recall_code}`, type: 'recall', level: 'critical', title: `Recall ${x.recall_code}`, message: `${x.product_name} · batch ${x.batch_number} — ${x.status}`, batchNumber: x.batch_number })),
    ...returns.filter((x) => !['Approved', 'Rejected', 'Closed'].includes(String(x.status)) && String(x.inspection_status ?? 'Pending') === 'Pending')
      .map((x) => ({ id: `return:${str(x.return_code)}`, type: 'return', level: 'warning', title: `Return ${str(x.return_code)} awaits inspection`, message: `${str(x.product_name)}${str(x.batch_number) ? ` · batch ${str(x.batch_number)}` : ''} — ${num(x.quantity)} unit(s) to inspect`, batchNumber: str(x.batch_number) || undefined })),
    ...engagements.filter((x) => x.next_follow_up_date && String(x.next_follow_up_date).slice(0, 10) <= t && x.status !== 'Follow-up completed')
      .map((x) => ({ id: `followup:${str(x.engagement_code)}`, type: 'followup', level: 'warning', title: `Follow up ${str(x.hospital_name)}`, message: `Follow-up was due ${String(x.next_follow_up_date).slice(0, 10)} (${str(x.engagement_code)})` })),
  ];
  res.json({ data: { alerts, followUpsDue: sum.engagements.followUpsDue, returnsAwaitingInspection: sum.returns.awaitingInspection } });
});

/** Sales Orders offered in Medicine Return's picker (same industry; reps see only their own orders), with what each product sold / already came back / can still be returned. */
pharmaRouter.get('/pharma/order-lookup', authenticate, reader, async (req, res) => {
  const industryTypeId = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  let q = supabaseAdmin.from('sale_orders')
    .select('id, order_number, status, created_at, clients!inner(client_name, client_code, industry_type_id), sales_representatives(employee_code), sale_order_items(quantity, free_quantity, batch_allocations, products(product_name))')
    .eq('organization_id', org(req)).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(300);
  if (industryTypeId) q = q.eq('clients.industry_type_id', industryTypeId);
  if (req.industryScope!.role === 'sales_representative') {
    const rep = await fieldActivityService.currentRepresentative(org(req), (req as unknown as { auth: { sub: string } }).auth.sub);
    q = q.eq('representative_id', rep.id);
  }
  const { data, error } = await q;
  if (error) throw error;
  const orders = (data ?? []) as unknown as Array<Row & { clients: Row; sales_representatives: Row | null; sale_order_items: OrderLine[] }>;
  const numbers = orders.map((o) => String(o.order_number));
  const back = new Map<string, number>(); // "order|product" -> units already returned (rejected returns do not count)
  for (let i = 0; i < numbers.length; i += 100) {
    const { data: rets, error: e2 } = await supabaseAdmin.from('pharma_medicine_returns').select('invoice_reference, product_name, quantity').eq('organization_id', org(req)).in('invoice_reference', numbers.slice(i, i + 100)).neq('status', 'Rejected');
    if (e2) throw e2;
    for (const r of (rets ?? []) as Row[]) { const k = `${str(r.invoice_reference)}|${str(r.product_name).toLowerCase()}`; back.set(k, (back.get(k) ?? 0) + num(r.quantity)); }
  }
  res.json({ data: orders.map((o) => {
    const sold = new Map<string, { name: string; qty: number; batches: Set<string> }>();
    for (const l of o.sale_order_items ?? []) {
      const name = str(l.products?.product_name); if (!name) continue;
      const e = sold.get(name.toLowerCase()) ?? { name, qty: 0, batches: new Set<string>() };
      e.qty += num(l.quantity) + num(l.free_quantity);
      for (const b of ((l.batch_allocations as { batches?: { batchNo?: string }[] } | null)?.batches ?? [])) if (b.batchNo) e.batches.add(b.batchNo);
      sold.set(name.toLowerCase(), e);
    }
    const lines = [...sold.entries()].map(([k, e]) => { const returned = back.get(`${String(o.order_number)}|${k}`) ?? 0; return { product_name: e.name, sold: e.qty, returned, can_return: Math.max(e.qty - returned, 0), batches: [...e.batches] }; });
    return { id: o.id, order_number: o.order_number, status: o.status, order_date: String(o.created_at ?? '').slice(0, 10), client_name: o.clients?.client_name, client_code: o.clients?.client_code, rep_code: o.sales_representatives?.employee_code ?? null, lines };
  }) });
});

/** Orders where the customer paid MORE than the order is worth after return credit and has not been paid back yet: the "refund due" worklist. */
pharmaRouter.get('/pharma/refunds/pending', authenticate, manager, async (req, res) => {
  const industryTypeId = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!industryTypeId) { res.json({ data: [] }); return; }
  const { data: orders, error } = await supabaseAdmin.from('sale_orders')
    .select('id, order_number, total_amount, clients!inner(client_name, client_code, industry_type_id)')
    .eq('organization_id', org(req)).neq('status', 'cancelled').eq('clients.industry_type_id', industryTypeId).order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  const list = (orders ?? []) as unknown as Array<{ id: string; order_number: string; total_amount: number; clients: { client_name: string; client_code: string } }>;
  const paid = new Map<string, number>(), credit = new Map<string, number>(), back = new Map<string, number>();
  const add = (m: Map<string, number>, k: unknown, v: unknown) => m.set(String(k), (m.get(String(k)) ?? 0) + num(v));
  for (let i = 0; i < list.length; i += 100) {
    const ids = list.slice(i, i + 100).map((o) => o.id);
    const [c, r, f] = await Promise.all([
      supabaseAdmin.from('sales_collections').select('sale_order_id, amount').eq('organization_id', org(req)).in('sale_order_id', ids),
      supabaseAdmin.from('sales_returns').select('order_id, credit_amount').eq('organization_id', org(req)).eq('status', 'approved').in('order_id', ids),
      supabaseAdmin.from('sales_refunds').select('order_id, amount').eq('organization_id', org(req)).in('order_id', ids),
    ]);
    if (c.error) throw c.error;
    if (r.error) throw r.error;
    if (f.error && !/sales_refunds/.test(f.error.message)) throw f.error; // table missing = nothing refunded yet
    for (const x of (c.data ?? []) as Row[]) add(paid, x.sale_order_id, x.amount);
    for (const x of (r.data ?? []) as Row[]) add(credit, x.order_id, x.credit_amount);
    for (const x of (f.data ?? []) as Row[]) add(back, x.order_id, x.amount);
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  res.json({ data: list.map((o) => {
    const collected = paid.get(o.id) ?? 0, credited = credit.get(o.id) ?? 0, refunded = back.get(o.id) ?? 0;
    return { order_id: o.id, order_number: o.order_number, client_name: o.clients.client_name, client_code: o.clients.client_code, order_total: r2(num(o.total_amount)), collected: r2(collected), credited: r2(credited), refunded: r2(refunded), due: r2(collected - refunded + credited - num(o.total_amount)) };
  }).filter((o) => o.due > 0.005) });
});
/** Every refund paid back to a Pharma customer (newest first), with who recorded it. */
pharmaRouter.get('/pharma/refunds', authenticate, manager, async (req, res) => {
  const industryTypeId = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!industryTypeId) { res.json({ data: [] }); return; }
  const rows = (await listRefunds(org(req), industryTypeId)) as Row[];
  const ids = [...new Set(rows.map((r) => str(r.created_by)).filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await supabaseAdmin.from('user_profiles').select('id, display_name').in('id', ids); // names are a nicety: a failed lookup just leaves them blank
    for (const p of (data ?? []) as Row[]) names.set(str(p.id), str(p.display_name));
  }
  res.json({ data: rows.map((r) => ({ ...r, recorded_by: names.get(str(r.created_by)) ?? '' })) });
});
/** Refund: after an approved return credit a customer may have paid MORE than the order is now worth; this records paying the extra back. */
pharmaRouter.get('/pharma/orders/:id/refunds', authenticate, manager, async (req, res) => {
  const orderId = String(req.params.id);
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, total_amount, status, clients!inner(industry_type_id)').eq('id', orderId).eq('organization_id', org(req)).maybeSingle();
  if (error) throw error;
  const indId = (order?.clients as unknown as { industry_type_id?: string | null } | null)?.industry_type_id ?? null;
  if (!order || (await industryCodeOf(org(req), indId)) !== 'pharma') throw new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  const [paid, credits, refunds] = await Promise.all([
    supabaseAdmin.from('sales_collections').select('amount').eq('organization_id', org(req)).eq('sale_order_id', orderId),
    supabaseAdmin.from('sales_returns').select('credit_amount').eq('organization_id', org(req)).eq('order_id', orderId).eq('status', 'approved'),
    supabaseAdmin.from('sales_refunds').select('*').eq('organization_id', org(req)).eq('order_id', orderId).order('created_at', { ascending: false }),
  ]);
  if (paid.error) throw paid.error;
  if (credits.error) throw credits.error;
  if (refunds.error && !/sales_refunds/.test(refunds.error.message)) throw refunds.error; // table missing = nothing refunded
  const rows = refunds.error ? [] : (refunds.data ?? []);
  const sum = (list: Row[] | null, key: string) => (list ?? []).reduce((t, r) => t + num(r[key]), 0);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const collected = sum(paid.data as Row[] | null, 'amount'), credited = sum(credits.data as Row[] | null, 'credit_amount'), refunded = sum(rows as Row[], 'amount');
  const due = r2(collected - refunded + credited - num(order.total_amount));
  res.json({ data: { refunds: rows, due: due > 0.005 ? due : 0, orderTotal: r2(num(order.total_amount)), collected: r2(collected), credited: r2(credited), refunded: r2(refunded), orderStatus: order.status } });
});
pharmaRouter.post('/pharma/refunds', authenticate, manager, async (req, res) => {
  const input = refundSchema.parse(req.body ?? {});
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, clients!inner(industry_type_id)').eq('id', input.orderId).eq('organization_id', org(req)).maybeSingle();
  if (error) throw error;
  const indId = (order?.clients as unknown as { industry_type_id?: string | null } | null)?.industry_type_id ?? null;
  if (!order || (await industryCodeOf(org(req), indId)) !== 'pharma') throw new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  res.status(201).json({ data: await createRefund(org(req), actorOf(req) as string, req.industryScope!, input) });
});

/** Expired / quarantined stock still sitting in a batch is written off as waste (logged in the stock audit). */
pharmaRouter.post('/pharma/batches/:id/write-off', authenticate, manager, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('pharma_batches').select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
  if (error) throw error;
  const nf = new AppError(404, 'RECORD_NOT_FOUND', 'Batch was not found.');
  if (!data) throw nf;
  const b = data as Row;
  assertRecordInScope(req.industryScope!, b.industry_type_id as string | null, nf);
  if (expiryStatus(b.expiry_date) !== 'Expired' && !['Expired', 'Quarantined'].includes(String(b.status))) throw bad('Only expired or quarantined stock can be written off.');
  const qty = num(b.quantity);
  if (qty <= 0) throw bad('This batch has no stock left to write off.');
  const why = typeof req.body?.reason === 'string' && req.body.reason ? ` (${req.body.reason})` : '';
  await changeBatchQty(org(req), b.id as string, -qty, `Written off as waste${why}`, actorOf(req));
  await syncProductStock(org(req), b.industry_type_id as string, b.product_code);
  res.json({ data: { batch_number: b.batch_number, written_off: qty } });
});

// ---- generic CRUD --------------------------------------------------------------
for (const r of PHARMA_RESOURCES) {  const base = `/pharma/${r.path}`;
  const notFound = () => new AppError(404, 'RECORD_NOT_FOUND', `${r.path} record was not found.`);
  const writer = r.write === 'rep' ? writerRep : manager;
  const prepare = PREPARE[r.table]; const after = AFTER[r.table];
  const dup = (e: { details?: string | null }) => new AppError(409, 'DUPLICATE_RECORD', `A ${r.path} record with that value already exists${/Key \(([^)]+)\)/.exec(e.details ?? '')?.[1] ? ` (same: ${/Key \(([^)]+)\)/.exec(e.details ?? '')![1]})` : ''}.`);

  pharmaRouter.get(base, authenticate, reader, async (req, res) => {
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
    if (r.table === 'pharma_batches') await refreshBatchStatuses(org(req), industryTypeId);
    if (r.table === 'pharma_promotions') await refreshPromotionStatuses(org(req), industryTypeId);
    let q = supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).order(r.table === 'pharma_batches' ? 'expiry_date' : 'created_at', { ascending: r.table === 'pharma_batches' }); // FEFO order for batches
    if (industryTypeId) q = q.eq('industry_type_id', industryTypeId);
    const own = await repCodeFor(req, r.table);
    if (own) q = q.eq('sales_rep', own);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ data });
  });

  pharmaRouter.get(`${base}/:id`, authenticate, reader, async (req, res) => {
    const { data, error } = await supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    assertRecordInScope(req.industryScope!, (data as { industry_type_id?: string | null }).industry_type_id, notFound());
    const own = await repCodeFor(req, r.table);
    if (own && (data as Row).sales_rep !== own) throw notFound();
    res.json({ data });
  });

  pharmaRouter.post(base, authenticate, writer, async (req, res) => {
    const payload = clean(r, req.body);
    validateValues(r, payload, false);
    const own = await repCodeFor(req, r.table);
    if (own && own !== '__none__') payload.sales_rep = own; // a rep's record is always his own
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, typeof payload.industry_type_id === 'string' ? payload.industry_type_id : undefined);
    if (!industryTypeId) throw bad('industry_type_id is required.');
    const missing = r.requiredFields.filter((k) => payload[k] === undefined || payload[k] === null || payload[k] === '');
    if (missing.length && !(prepare && missing.every((k) => ['product_name'].includes(k)))) throw bad(`${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required.`);
    const ctx: Ctx = { orgId: org(req), industryTypeId, payload, existing: null, actor: actorOf(req) };
    if (prepare) await prepare(ctx);
    if (r.table !== 'pharma_batches' && payload[r.codeField]) payload[r.codeField] = await nextFreeCode(r.table, r.codeField, org(req), payload[r.codeField]);
    const { data, error } = await supabaseAdmin.from(r.table).insert({ ...payload, industry_type_id: industryTypeId, organization_id: org(req) }).select().single();  
    if (error) { if (error.code === '23505') throw dup(error); throw error; }
    if (after) {
      try { await after({ ...ctx, saved: data as Row }); }
      catch (e) { await supabaseAdmin.from(r.table).delete().eq('organization_id', org(req)).eq('id', (data as Row).id as string); throw e; } // nothing half-saved
    }
    res.status(201).json({ data });
  });

  pharmaRouter.patch(`${base}/:id`, authenticate, writer, async (req, res) => {
    const payload = clean(r, req.body);
    delete payload.industry_type_id; // a record never moves between industries
    validateValues(r, payload, true);
    const { data: existing, error: e1 } = await supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
    if (e1) throw e1;
    if (!existing) throw notFound();
    const ex = existing as Row;
    assertRecordInScope(req.industryScope!, ex.industry_type_id as string | null, notFound());
    const own = await repCodeFor(req, r.table);
    if (own) { if (ex.sales_rep !== own) throw notFound(); delete payload.sales_rep; }
    const locked = statusMoveProblem(r.table, ex.status, payload.status);
    if (locked) throw new AppError(409, 'STATUS_LOCKED', locked);
    const ctx: Ctx = { orgId: org(req), industryTypeId: ex.industry_type_id as string, payload, existing: ex, actor: actorOf(req) };
    if (prepare) await prepare(ctx);
    const { data, error } = await supabaseAdmin.from(r.table).update(payload).eq('organization_id', org(req)).eq('id', idOf(req)).select().maybeSingle();
    if (error) { if (error.code === '23505') throw dup(error); throw error; }
    if (!data) throw notFound();
    if (after) await after({ ...ctx, saved: data as Row });
    res.json({ data });
  });

  pharmaRouter.delete(`${base}/:id`, authenticate, manager, async (req, res) => {
    const { data: existing, error: e1 } = await supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
    if (e1) throw e1;
    if (!existing) throw notFound();
    const ex = existing as Row;
    assertRecordInScope(req.industryScope!, ex.industry_type_id as string | null, notFound());
    await assertCanDelete(r, org(req), ex);
    const it = ex.industry_type_id as string;
    if (r.table === 'pharma_samples' && ex.status !== 'Returned') { // unused sample units go back to the batch
      const b = await getBatch(org(req), it, ex.batch_number).catch(() => null);
      if (b) await changeBatchQty(org(req), b.id as string, num(ex.quantity_remaining), `Sample ${str(ex.sample_code)} deleted`, actorOf(req));
    }
    const { data, error } = await supabaseAdmin.from(r.table).delete().eq('organization_id', org(req)).eq('id', idOf(req)).select().maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    if (r.table === 'pharma_recalls') await reconcileBatchAfterRecall(org(req), it, ex.batch_number, 'deleted');
    if (r.table === 'pharma_batches') await syncProductStock(org(req), it, ex.product_code);
    if (r.table === 'pharma_samples') { const b = await getBatch(org(req), it, ex.batch_number).catch(() => null); if (b) await syncProductStock(org(req), it, b.product_code); }
    res.json({ data });
  });
}