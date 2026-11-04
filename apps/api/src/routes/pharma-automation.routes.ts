/* eslint-disable @typescript-eslint/no-explicit-any */
// Pharma Distributor automation API (/pharma/automation/*). Managers and admins only.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { assertRecordInScope, resolveIndustryTypeId } from '../lib/industry-scope.js';
import { all, bad, gstTotals, insertNumbered, num, r2, str, today, type Row } from '../lib/pharma-db.js';
import { changeBatchQty, syncProductStock } from './pharma.routes.js';
import * as auto from '../services/pharma-automation.service.js';

export const pharmaAutomationRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
type Req = Parameters<RequestHandler>[0];
const org = (req: Req) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };
const it = (req: Req) => { const v = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : typeof (req.body ?? {}).industryTypeId === 'string' ? (req.body ?? {}).industryTypeId : null); if (!v) throw bad('industryTypeId is required.'); return v; };
const actor = (req: Req) => ((req as unknown as { auth?: { sub?: string } }).auth?.sub as string | undefined) ?? null;
const idOf = (req: Req) => { const v = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id; if (!v) throw bad('A record id is required.', 'INVALID_ID'); return v; };
const P = '/pharma/automation';

pharmaAutomationRouter.get(`${P}/today`, authenticate, manager, async (req, res) => { res.json({ data: await auto.todaySummary(org(req), it(req)) }); });
pharmaAutomationRouter.get(`${P}/settings`, authenticate, manager, async (req, res) => { res.json({ data: await auto.getSettings(org(req), it(req)) }); });
pharmaAutomationRouter.put(`${P}/settings`, authenticate, manager, async (req, res) => { res.json({ data: await auto.saveSettings(org(req), it(req), (req.body ?? {}) as Row) }); });

// ---- auto-reorder
pharmaAutomationRouter.get(`${P}/reorder-plan`, authenticate, manager, async (req, res) => { res.json({ data: await auto.reorderPlan(org(req), it(req)) }); });
pharmaAutomationRouter.post(`${P}/reorder/run`, authenticate, manager, async (req, res) => { res.json({ data: await auto.createReorderDrafts(org(req), it(req), actor(req)) }); });
pharmaAutomationRouter.get(`${P}/reorder-rules`, authenticate, manager, async (req, res) => {
  res.json({ data: await all(() => supabaseAdmin.from('pharma_reorder_rules').select('*, pharma_suppliers(supplier_name)').eq('organization_id', org(req)).eq('industry_type_id', it(req)).order('product_code')) });
});
pharmaAutomationRouter.put(`${P}/reorder-rules`, authenticate, manager, async (req, res) => {
  const b = (req.body ?? {}) as Row; const orgId = org(req); const iType = it(req);
  const code = str(b.product_code); if (!code) throw bad('Pick a product.');
  const qty = b.reorder_qty === '' || b.reorder_qty == null ? null : Number(b.reorder_qty);
  if (qty !== null && !(qty > 0)) throw bad('Reorder quantity must be more than zero.');
  let supplierId: string | null = null;
  if (str(b.preferred_supplier_id)) {
    const { data } = await supabaseAdmin.from('pharma_suppliers').select('id, industry_type_id').eq('organization_id', orgId).eq('id', String(b.preferred_supplier_id)).maybeSingle();
    if (!data || (data as Row).industry_type_id !== iType) throw bad('That supplier does not exist in this industry.', 'INVALID_REFERENCE');
    supplierId = String(b.preferred_supplier_id);
  }
  const { data, error } = await supabaseAdmin.from('pharma_reorder_rules').upsert({ organization_id: orgId, industry_type_id: iType, product_code: code, preferred_supplier_id: supplierId, reorder_qty: qty }, { onConflict: 'organization_id,industry_type_id,product_code' }).select('*').single();
  if (error) throw error;
  res.json({ data });
});
pharmaAutomationRouter.delete(`${P}/reorder-rules/:id`, authenticate, manager, async (req, res) => {
  const { error } = await supabaseAdmin.from('pharma_reorder_rules').delete().eq('organization_id', org(req)).eq('industry_type_id', it(req)).eq('id', idOf(req));
  if (error) throw error;
  res.json({ data: { id: idOf(req) } });
});

// ---- supplier bills (due dates) and customer invoice dues
pharmaAutomationRouter.get(`${P}/supplier-bills`, authenticate, manager, async (req, res) => { res.json({ data: await auto.supplierBills(org(req), it(req)) }); });
pharmaAutomationRouter.get(`${P}/invoice-dues`, authenticate, manager, async (req, res) => {
  const orgId = org(req); const iType = it(req); const co = await auto.companyName(orgId, iType);
  const rows = (await auto.invoiceDues(orgId, iType)).map((d) => {
    const text = d.days_overdue > 0 ? `Dear ${d.client_name}, invoice ${d.invoice_number} for Rs ${d.open.toLocaleString('en-IN')} was due on ${d.due_date}. Kindly arrange payment. Thank you - ${co}` : `Dear ${d.client_name}, invoice ${d.invoice_number} for Rs ${d.open.toLocaleString('en-IN')} is due on ${d.due_date}. Thank you - ${co}`;
    return { ...d, whatsapp: auto.waLink(d.phone, text) };
  });
  res.json({ data: rows });
});
pharmaAutomationRouter.post(`${P}/reminders/run`, authenticate, manager, async (req, res) => { res.json({ data: await auto.runReminders(org(req), it(req), actor(req)) }); });

// ---- auto-invoice
pharmaAutomationRouter.get(`${P}/invoices-to-issue`, authenticate, manager, async (req, res) => {
  const st = await auto.getSettings(org(req), it(req));
  res.json({ data: await auto.ordersToInvoice(org(req), it(req), 'all-dispatched', st.auto_invoice === 'off' ? new Date(Date.now() - 30 * 86_400_000).toISOString() : st.auto_invoice_since) });
});
pharmaAutomationRouter.post(`${P}/invoices/run`, authenticate, manager, async (req, res) => {
  const st = await auto.getSettings(org(req), it(req));
  if (st.auto_invoice === 'off') throw bad('Auto-invoice is switched off. Turn it on in Automation settings first.');
  res.json({ data: await auto.runAutoInvoices(org(req), it(req), actor(req)) });
});

// ---- near-expiry, supplier returns, recall
pharmaAutomationRouter.get(`${P}/expiry-actions`, authenticate, manager, async (req, res) => { res.json({ data: await auto.expiryActions(org(req), it(req)) }); });

/** Posts a purchase return for a batch (default: all remaining units) back to the supplier it came from, linked to its cause. */
export async function returnBatchToSupplier(orgId: string, iType: string, who: string | null, input: { batch_number: string; quantity?: unknown; reason?: string; source_type: string; source_ref: string }) {
  const { data: b } = await supabaseAdmin.from('pharma_batches').select('*').eq('organization_id', orgId).eq('industry_type_id', iType).eq('batch_number', input.batch_number).maybeSingle();
  const batch = b as Row | null; if (!batch) throw bad(`Batch ${input.batch_number} does not exist in this industry.`, 'INVALID_REFERENCE');
  const { data: s } = await supabaseAdmin.from('pharma_suppliers').select('*').eq('organization_id', orgId).eq('industry_type_id', iType).ilike('supplier_name', String(batch.supplier ?? '')).limit(1).maybeSingle();
  const sup = s as Row | null; if (!sup) throw bad(`The supplier of batch ${input.batch_number} ("${batch.supplier ?? 'none recorded'}") is not in Supplier Management. Add it first.`);
  const qty = input.quantity === undefined || input.quantity === '' || input.quantity === null ? num(batch.quantity) : Number(input.quantity);
  if (!(qty > 0)) throw bad('There is no stock left in this batch to return.');
  if (qty > num(batch.quantity)) throw bad(`Batch ${input.batch_number} has only ${num(batch.quantity)} unit(s) in stock.`);
  const lines = [{ product_code: batch.product_code, product_name: batch.product_name, batch_number: batch.batch_number, quantity: qty, rate: r2(num(batch.purchase_rate)), gst_percent: num(batch.gst_percent) }];
  const ret = await insertNumbered('pharma_purchase_returns', 'return_number', orgId, `PRT-${new Date().getFullYear()}-`, { industry_type_id: iType, supplier_id: sup.id, return_date: today(), reason: input.reason ?? null, status: 'Posted', lines, ...gstTotals(lines), created_by: who, source_type: input.source_type, source_ref: input.source_ref });
  try { await changeBatchQty(orgId, batch.id, -qty, `Purchase return ${ret.return_number}`, who); }
  catch (e) { await supabaseAdmin.from('pharma_purchase_returns').delete().eq('organization_id', orgId).eq('id', ret.id); throw e; }
  await syncProductStock(orgId, iType, batch.product_code);
  return ret;
}
pharmaAutomationRouter.post(`${P}/supplier-return`, authenticate, manager, async (req, res) => {
  const b = (req.body ?? {}) as Row; const bn = str(b.batch_number); if (!bn) throw bad('Select a batch.');
  const type = ['expiry', 'recall', 'grn'].includes(String(b.source_type)) ? String(b.source_type) : 'expiry';
  res.status(201).json({ data: await returnBatchToSupplier(org(req), it(req), actor(req), { batch_number: bn, quantity: b.quantity, reason: str(b.reason) || (type === 'expiry' ? 'Near-expiry / expired stock returned to supplier' : undefined), source_type: type, source_ref: str(b.source_ref) || bn }) });
});
async function recallOf(req: Req): Promise<Row> {
  const { data } = await supabaseAdmin.from('pharma_recalls').select('*').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
  if (!data) throw new AppError(404, 'RECORD_NOT_FOUND', 'Recall was not found.');
  assertRecordInScope(req.industryScope!, (data as Row).industry_type_id, new AppError(404, 'RECORD_NOT_FOUND', 'Recall was not found.'));
  return data as Row;
}
pharmaAutomationRouter.get(`${P}/recall/:id/customers`, authenticate, manager, async (req, res) => { const r = await recallOf(req); res.json({ data: await auto.recallCustomers(org(req), r.industry_type_id, String(r.batch_number)) }); });
pharmaAutomationRouter.post(`${P}/recall/:id/notify`, authenticate, manager, async (req, res) => { const r = await recallOf(req); res.json({ data: await auto.notifyRecallCustomers(org(req), r.industry_type_id, String(r.batch_number), String(r.recall_code)) }); });
pharmaAutomationRouter.post(`${P}/recall/:id/supplier-return`, authenticate, manager, async (req, res) => {
  const r = await recallOf(req);
  res.status(201).json({ data: await returnBatchToSupplier(org(req), r.industry_type_id, actor(req), { batch_number: String(r.batch_number), reason: `Recall ${r.recall_code}: ${str(r.reason) || 'batch recalled'}`, source_type: 'recall', source_ref: String(r.recall_code) }) });
});

// ---- run everything now (what the background job does)
pharmaAutomationRouter.post(`${P}/run`, authenticate, manager, async (req, res) => { res.json({ data: await auto.runAutomationForScope(org(req), it(req)) }); });
