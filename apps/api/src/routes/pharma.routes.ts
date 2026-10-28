// Pharma industry CRUD + automation (Batch & Expiry, Sample, Promotion, Hospital Engagement, Medicine Return, Recall).
// Own tables, own routes: nothing here touches Trading / FMCG / School / Textile / Vehicle.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { assertRecordInScope, resolveIndustryTypeId } from '../lib/industry-scope.js';
import { BATCH_BLOCKED, PHARMA_RESOURCES, type PharmaResource } from '../lib/pharma-resources.js';
import { daysLeft, expiryStatus, isBatchBlocked as isBlocked } from '../lib/pharma-rules.js';
export { expiryStatus };
import { createManual as createFollowUp } from '../repositories/follow-ups.repository.js';

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
/** Product stock = sum of its saleable (not expired / recalled / quarantined) pharma batches. Best effort. */
async function syncProductStock(orgId: string, industryTypeId: string, productCode: unknown) {
  if (!str(productCode)) return;
  try {
    const product = await findProduct(orgId, industryTypeId, 'product_code', productCode);
    if (!product) return;
    const { data } = await supabaseAdmin.from('pharma_batches').select('quantity, status').eq('organization_id', orgId).eq('industry_type_id', industryTypeId).eq('product_code', str(productCode));
    const total = ((data ?? []) as Row[]).filter((b) => !BATCH_BLOCKED.includes(String(b.status))).reduce((s, b) => s + num(b.quantity), 0);
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
    let q = supabaseAdmin.from('pharma_batches').select('id, status, expiry_date, product_code, industry_type_id').eq('organization_id', orgId).not('status', 'in', '("Quarantined","Recalled")');
    if (industryTypeId) q = q.eq('industry_type_id', industryTypeId);
    const { data } = await q;
    const touched = new Set<string>();
    for (const b of (data ?? []) as Row[]) {
      const want = expiryStatus(b.expiry_date);
      if (want !== b.status) {
        await supabaseAdmin.from('pharma_batches').update({ status: want }).eq('organization_id', orgId).eq('id', b.id as string);
        touched.add(`${b.industry_type_id}|${b.product_code ?? ''}`);
      }
    }
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
      // Samples provided = units actually issued for this product (matched by product CODE when known) inside the campaign window, unless typed in by hand.
      if (!num(p.samples_provided) && (str(p.product_code) || str(p.product_name)) && start) {
        let sq = supabaseAdmin.from('pharma_samples').select('quantity_issued').eq('organization_id', orgId).eq(str(p.product_code) ? 'product_code' : 'product_name', str(p.product_code) || str(p.product_name)).gte('issue_date', start);
        if (end) sq = sq.lte('issue_date', end);
        if (str(p.hospital_name)) sq = sq.eq('hospital_name', str(p.hospital_name));
        const { data: given } = await sq;
        const total = ((given ?? []) as Row[]).reduce((sum, x) => sum + num(x.quantity_issued), 0);
        if (total > 0) await supabaseAdmin.from('pharma_promotions').update({ samples_provided: total }).eq('organization_id', orgId).eq('id', p.id as string);
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
  await syncProductStock(orgId, industryTypeId, saved.product_code);
  if (existing && existing.product_code !== saved.product_code) await syncProductStock(orgId, industryTypeId, existing.product_code);
};

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
  if (m.status === 'Returned' && existing?.status !== 'Returned') payload.quantity_remaining = 0; // remaining units go back to the batch in afterSample
};
const afterSample: After = async ({ orgId, industryTypeId, saved, actor, existing }) => {
  const batch = await getBatch(orgId, industryTypeId, saved.batch_number);
  const batchId = batch.id as string;
  if (!existing) { await changeBatchQty(orgId, batchId, -num(saved.quantity_issued), `Sample ${str(saved.sample_code)} issued`, actor); }
  else {
    await changeBatchQty(orgId, batchId, -(num(saved.quantity_issued) - num(existing.quantity_issued)), `Sample ${str(saved.sample_code)} changed`, actor);
    if (saved.status === 'Returned' && existing.status !== 'Returned') await changeBatchQty(orgId, batchId, num(existing.quantity_remaining), `Sample ${str(saved.sample_code)} returned`, actor); // unused units back to stock
  }
  await syncProductStock(orgId, industryTypeId, batch.product_code);
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

const NOT_SALEABLE_REASONS = ['Expired', 'Near expiry', 'Damaged', 'Recall', 'Quality issue'];
const prepareReturn: Prepare = async ({ orgId, industryTypeId, payload, existing }) => {
  if (existing?.stock_applied) throw new AppError(409, 'RECORD_LOCKED', 'This return has already been restocked and can no longer be edited.');
  const m: Row = { ...(existing ?? {}), ...payload };
  if (!existing && num(m.quantity) <= 0) throw bad('Returned quantity must be greater than zero.');
  if (str(m.batch_number)) {
    const b = await getBatch(orgId, industryTypeId, m.batch_number);
    payload.product_name = b.product_name;
  }
  if (!existing) { if (!payload.status) payload.status = 'Requested'; if (!payload.inspection_status) payload.inspection_status = 'Pending'; if (!payload.return_date) payload.return_date = today(); }
  const status = String(payload.status ?? existing?.status ?? 'Requested');
  if (m.disposition === 'Saleable' && NOT_SALEABLE_REASONS.includes(String(m.reason))) throw bad(`Medicine returned as "${String(m.reason)}" can never be Saleable. Choose Quarantine, Damaged, Expired or Disposal.`);
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
const afterReturn: After = async ({ orgId, industryTypeId, saved, actor }) => {
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
const prepareRecall: Prepare = async ({ orgId, industryTypeId, payload, existing }) => {
  if (existing) delete payload.batch_number;
  const b = await getBatch(orgId, industryTypeId, existing ? existing.batch_number : payload.batch_number);
  payload.product_name = b.product_name;
  const m = { ...(existing ?? {}), ...payload };
  if (!existing) {
    if (!payload.recall_date) payload.recall_date = today();
    if (payload.affected_quantity == null) payload.affected_quantity = num(b.quantity);
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
const afterRecall: After = async ({ orgId, industryTypeId, saved }) => reconcileBatchAfterRecall(orgId, industryTypeId, saved.batch_number, 'saved');

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
export async function pharmaSummary(orgId: string, industryTypeId: string | null) {
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
    batches: { total: batches.length, expired: expiring.filter((x) => (x.days_left ?? 0) < 0).length, critical: expiring.filter((x) => (x.days_left ?? 0) >= 0 && (x.days_left ?? 0) <= 30).length, expiringSoon: expiring.filter((x) => (x.days_left ?? 0) > 30).length, unitsAtRisk: expiring.reduce((sum, x) => sum + x.quantity, 0), list: expiring.slice(0, 15) },
    recalls: { open: recalls.filter((x) => x.status !== 'Closed').length, critical: recalls.filter((x) => x.status !== 'Closed' && ['Critical', 'High'].includes(String(x.severity))).length, list: recalls.filter((x) => x.status !== 'Closed').slice(0, 10) },
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
  const sum = await pharmaSummary(org(req), industryTypeId);
  const alerts = [
    ...sum.batches.list.map((x) => ({ type: 'expiry', level: (x.days_left ?? 0) < 0 ? 'expired' : (x.days_left ?? 0) <= 30 ? 'critical' : 'warning', title: `${x.product_name} · batch ${x.batch_number}`, message: (x.days_left ?? 0) < 0 ? `Expired ${Math.abs(x.days_left ?? 0)} day(s) ago — ${x.quantity} units on hand` : `Expires in ${x.days_left} day(s) — ${x.quantity} units on hand` })),
    ...sum.recalls.list.map((x) => ({ type: 'recall', level: 'critical', title: `Recall ${x.recall_code}`, message: `${x.product_name} · batch ${x.batch_number} — ${x.status}` })),
  ];
  res.json({ data: { alerts, followUpsDue: sum.engagements.followUpsDue, returnsAwaitingInspection: sum.returns.awaitingInspection } });
});

// ---- generic CRUD --------------------------------------------------------------
for (const r of PHARMA_RESOURCES) {
  const base = `/pharma/${r.path}`;
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
    const { data, error } = await q;
    if (error) throw error;
    res.json({ data });
  });

  pharmaRouter.get(`${base}/:id`, authenticate, reader, async (req, res) => {
    const { data, error } = await supabaseAdmin.from(r.table).select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    assertRecordInScope(req.industryScope!, (data as { industry_type_id?: string | null }).industry_type_id, notFound());
    res.json({ data });
  });

  pharmaRouter.post(base, authenticate, writer, async (req, res) => {
    const payload = clean(r, req.body);
    validateValues(r, payload, false);
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, typeof payload.industry_type_id === 'string' ? payload.industry_type_id : undefined);
    if (!industryTypeId) throw bad('industry_type_id is required.');
    const missing = r.requiredFields.filter((k) => payload[k] === undefined || payload[k] === null || payload[k] === '');
    if (missing.length && !(prepare && missing.every((k) => ['product_name'].includes(k)))) throw bad(`${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required.`);
    const ctx: Ctx = { orgId: org(req), industryTypeId, payload, existing: null, actor: actorOf(req) };
    if (prepare) await prepare(ctx);
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