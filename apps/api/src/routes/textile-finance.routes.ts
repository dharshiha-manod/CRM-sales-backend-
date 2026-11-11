/* eslint-disable @typescript-eslint/no-explicit-any */
// FILE: api/src/routes/textile-finance.routes.ts
// Textile supplier bills / payments and GST credit notes. Textile only; every query is limited to the active Industry Type.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { assertRecordInScope, resolveIndustryTypeId } from '../lib/industry-scope.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { serialized } from '../lib/serialize.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { all, bad, insertNumbered, num, r2, str, today, type Row } from '../lib/pharma-db.js';
import { issueMissingCreditNotes, pendingCreditReturns, supplierBills, supplierOutstanding } from '../lib/textile-finance.js';

export const textileFinanceRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
type Req = Parameters<RequestHandler>[0];

const org = (req: Req) => {
  const v = req.header('x-organization-id');
  if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return v;
};
const idOf = (req: Req) => {
  const v = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!v) throw bad('A record id is required.', 'INVALID_ID');
  return v;
};
const actorOf = (req: Req) => ((req as unknown as { auth?: { sub?: string } }).auth?.sub as string | undefined) ?? null;
const scopeIt = (req: Req, v: unknown) => {
  const it = resolveIndustryTypeId(req.industryScope!, typeof v === 'string' && v ? v : null);
  if (!it) throw bad('industryTypeId is required.');
  return it;
};
const qIt = (req: Req) => scopeIt(req, req.query.industryTypeId);
const bIt = (req: Req) => scopeIt(req, (req.body ?? {}).industryTypeId);
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// =============================================================== Supplier bills and payments
textileFinanceRouter.get('/textile/supplier-bills', authenticate, manager, async (req, res) => {
  res.json({ data: (await supplierBills(org(req), qIt(req))).bills });
});
textileFinanceRouter.get('/textile/supplier-outstanding', authenticate, manager, async (req, res) => {
  res.json({ data: await supplierOutstanding(org(req), qIt(req)) });
});
textileFinanceRouter.get('/textile/supplier-payments', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('textile_supplier_payments').select('*, textile_suppliers(supplier_name, supplier_code), textile_grns(grn_number)')
    .eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('created_at', { ascending: false }));
  res.json({ data });
});

const PAY_MODES = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Other'];
textileFinanceRouter.post('/textile/supplier-payments', authenticate, manager, (req, res, next) => {
  serialized(`tsp:${str((req.body ?? {}).supplier_id)}`, () => paymentPost(req, res)).catch(next); // balance check + insert must not interleave
});
async function paymentPost(req: Req, res: any) {
  const b = (req.body ?? {}) as Row; const it = bIt(req); const orgId = org(req);
  const { data: sup } = await supabaseAdmin.from('textile_suppliers').select('id, supplier_name').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', str(b.supplier_id)).maybeSingle();
  if (!sup) throw bad('Pick the supplier / mill you are paying.', 'INVALID_REFERENCE');
  const amount = Number(b.amount); if (!(amount > 0)) throw bad('Payment amount must be more than zero.');
  const mode = str(b.mode); if (!PAY_MODES.includes(mode)) throw bad(`Payment mode must be one of: ${PAY_MODES.join(', ')}.`);
  const date = str(b.payment_date) || today(); if (!isDate(date)) throw bad('Payment date is not valid.');
  const row = (await supplierOutstanding(orgId, it)).find((x) => x.supplier_id === (sup as Row).id);
  if (amount > num(row?.outstanding) + 0.005) throw bad(`Payment ${r2(amount)} is more than the ${r2(num(row?.outstanding))} still owed to ${(sup as Row).supplier_name}.`);
  let grnId: string | null = null;
  if (str(b.grn_id)) {
    const bill = (await supplierBills(orgId, it)).bills.find((x) => x.id === str(b.grn_id));
    if (!bill || bill.supplier_id !== (sup as Row).id) throw bad('Pick a bill (GRN) that belongs to this supplier.', 'INVALID_REFERENCE');
    const { data: direct } = await supabaseAdmin.from('textile_supplier_payments').select('amount').eq('organization_id', orgId).eq('grn_id', bill.id).neq('status', 'Cancelled');
    const left = r2(num(bill.total) - ((direct ?? []) as Row[]).reduce((t, x) => t + num(x.amount), 0));
    if (amount > left + 0.005) throw bad(`Payment ${r2(amount)} is more than the ${left} still open on ${bill.grn_number}.`);
    grnId = bill.id as string;
  }
  const data = await insertNumbered('textile_supplier_payments', 'payment_number', orgId, `TSP-${new Date().getFullYear()}-`, {
    industry_type_id: it, supplier_id: (sup as Row).id, grn_id: grnId, amount: r2(amount), mode, payment_date: date, reference_no: str(b.reference_no) || null, created_by: actorOf(req),
  });
  res.status(201).json({ data });
}
// A wrong payment is cancelled (kept for audit, no longer counted): the bill and the supplier balance go back up.
textileFinanceRouter.post('/textile/supplier-payments/:id/cancel', authenticate, manager, async (req, res) => {
  const orgId = org(req); const reason = str((req.body ?? {}).reason);
  if (reason.length < 3) throw bad('Enter a reason for cancelling this payment.');
  const { data: ex } = await supabaseAdmin.from('textile_supplier_payments').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', 'Payment was not found.');
  if (!ex) throw notFound;
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound);
  if ((ex as Row).status === 'Cancelled') throw bad('This payment is already cancelled.');
  const { data, error } = await supabaseAdmin.from('textile_supplier_payments').update({ status: 'Cancelled', cancel_reason: reason, cancelled_at: new Date().toISOString() })
    .eq('organization_id', orgId).eq('id', idOf(req)).eq('status', 'Paid').select().maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(409, 'RECORD_CHANGED', 'This payment was just changed. Refresh and try again.');
  res.json({ data });
});

// =============================================================== GST credit notes
textileFinanceRouter.get('/textile/credit-notes', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = qIt(req);
  const [data, pending] = await Promise.all([
    all(() => supabaseAdmin.from('textile_credit_notes').select('*, clients(client_name, client_code), sale_orders(order_number)').eq('organization_id', orgId).eq('industry_type_id', it).order('created_at', { ascending: false })),
    pendingCreditReturns(orgId, it),
  ]);
  res.json({ data, pending: pending.length });
});
textileFinanceRouter.post('/textile/credit-notes/issue-missing', authenticate, manager, async (req, res) => {
  res.json({ data: await issueMissingCreditNotes(org(req), bIt(req), actorOf(req)) });
});