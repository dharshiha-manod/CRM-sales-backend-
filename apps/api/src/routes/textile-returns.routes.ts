/* eslint-disable @typescript-eslint/no-explicit-any */
// FILE: api/src/routes/textile-returns.routes.ts
// Textile returns & refunds (same rules as the Pharma purchase return / debit note / refund flow, but roll-based):
//   Supplier side : supplier return SENT to the mill (metres leave the roll, no debit note yet)
//                   -> supplier ACCEPTS (full / partial: debit note for the accepted metres only, the rest goes back on the roll)
//                   -> or REJECTS (all metres go back on the roll, no debit note)
//                   -> refund received from the supplier
//   Customer side : return of part of a cut (whole rolls are returned from the order's Rolls tab) -> GST credit note -> refund paid to the customer
// Every metre change goes through lib/textile-roll-ledger.ts (atomic, never negative, always in the roll ledger).
// Status: Sent | Accepted | Rejected | Cancelled   ('Posted' = old returns made before this flow, already have a debit note)
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { assertRecordInScope, resolveIndustryTypeId } from '../lib/industry-scope.js';
import { financialYear } from '../lib/ist-date.js';
import { logger } from '../lib/logger.js';
import { industryCodeOf, toBase } from '../lib/fmcg-market.js';
import { all, bad, insertNumbered, num, r2, str, today, type Row } from '../lib/pharma-db.js';
import { serialized } from '../lib/serialize.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { createRefund, listRefunds, refundSchema } from '../repositories/fmcg-refunds.repository.js';
import { issueCreditNotesForOrder, supplierBills, supplierOutstanding } from '../lib/textile-finance.js';
import { isIntraState, splitGst } from '../lib/textile-invoice-math.js';
import { moveRoll } from '../lib/textile-roll-ledger.js';
import { pendingCustomerRefunds, returnableRolls } from '../lib/textile-returns.js';
import { syncProductStockFromRolls } from '../lib/textile-rolls.js';

export const textileReturnsRouter = Router();
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
const one = (v: any) => (Array.isArray(v) ? v[0] : v);
const MODES = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Other'];
const NO_ID = '00000000-0000-0000-0000-000000000000';

type Undo = () => Promise<unknown>;
async function runUndo(undo: Undo[]) { for (const u of [...undo].reverse()) { try { await u(); } catch (e) { logger.error({ err: e }, 'textile returns: undo step failed'); } } }

async function loadReturn(req: Req, orgId: string): Promise<Row> {
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', 'Supplier return was not found.');
  const { data: ex } = await supabaseAdmin.from('textile_supplier_returns').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound;
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound);
  return ex as Row;
}

// =============================================================== Supplier returns (goods back to the mill)
/** Rolls that can still go back to the mill (damaged / rejected ones come first). */
textileReturnsRouter.get('/textile/supplier-returns/options', authenticate, manager, async (req, res) => {
  res.json({ data: await returnableRolls(org(req), qIt(req), str(req.query.supplierId) || null) });
});

textileReturnsRouter.get('/textile/supplier-returns', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('textile_supplier_returns').select('*, textile_suppliers(supplier_name, supplier_code, gstin)')
    .eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('created_at', { ascending: false }));
  res.json({ data });
});

textileReturnsRouter.post('/textile/supplier-returns', authenticate, manager, (req, res, next) => {
  // two returns for the same supplier run one after the other, so both cannot count the same metres
  serialized(`tsr:${str((req.body ?? {}).supplier_id)}`, () => supplierReturnPost(req, res)).catch(next);
});

/** STEP 1: send the rolls back to the mill. Metres leave the roll (in transit). No debit note yet, the supplier bill does not change. */
async function supplierReturnPost(req: Req, res: any) {
  const b = (req.body ?? {}) as Row; const it = bIt(req); const orgId = org(req); const actor = actorOf(req);
  const { data: sup } = await supabaseAdmin.from('textile_suppliers').select('*').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', str(b.supplier_id)).maybeSingle();
  if (!sup) throw bad('Pick the supplier / mill the fabric goes back to.', 'INVALID_REFERENCE');
  const supplier = sup as Row;
  const reason = str(b.reason); if (reason.length < 3) throw bad('Enter the reason for returning the fabric (damaged, wrong shade, short length...).');
  const retDate = str(b.return_date) || today(); if (!isDate(retDate)) throw bad('Return date is not valid.');
  const { data: grnRow } = await supabaseAdmin.from('textile_grns').select('*').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', str(b.grn_id)).maybeSingle();
  const grn = grnRow as Row | null;
  if (!grn || grn.supplier_id !== supplier.id) throw bad('Pick a goods receipt (GRN) that belongs to this supplier.', 'INVALID_REFERENCE');
  if (grn.status !== 'Posted') throw bad(`Goods receipt ${grn.grn_number} is ${grn.status}, so nothing can be returned against it.`);
  const raw = (Array.isArray(b.lines) ? b.lines : []) as Row[];
  if (!raw.length) throw bad('Pick at least one roll to return.');

  const { data: co } = await supabaseAdmin.from('textile_company_profile').select('*').eq('organization_id', orgId).eq('industry_type_id', it).maybeSingle();
  const intra = isIntraState((co ?? {}) as Row, supplier);
  if (intra === null) throw bad(`Cannot decide CGST/SGST or IGST: add the state or GSTIN for ${supplier.supplier_name} (and your own state in Company & GST).`, 'GST_STATE_REQUIRED');

  const grnLines = (grn.lines ?? []) as Row[];
  const seen = new Set<string>(); const lines: Row[] = []; const rollOf = new Map<string, Row>();
  for (const [i, l] of raw.entries()) {
    const n = i + 1; const rollId = str(l.roll_id);
    if (!rollId) throw bad(`Item ${n}: pick a roll.`);
    if (seen.has(rollId)) throw bad(`Item ${n}: the same roll is listed twice.`);
    seen.add(rollId);
    const { data: rr } = await supabaseAdmin.from('textile_fabric_rolls').select('*').eq('organization_id', orgId).eq('id', rollId).maybeSingle();
    const roll = rr as Row | null;
    if (!roll) throw bad(`Item ${n}: roll not found.`, 'INVALID_REFERENCE');
    assertRecordInScope(req.industryScope!, roll.industry_type_id, new AppError(404, 'ROLL_NOT_FOUND', 'Fabric roll not found.'));
    const gl = grnLines.find((x) => str(x.roll_number) === str(roll.roll_number));
    if (!gl) throw bad(`Item ${n}: roll ${roll.roll_number} was not received on ${grn.grn_number}.`);
    if (roll.order_id) throw bad(`Item ${n}: roll ${roll.roll_number} is allocated to order ${roll.order_number ?? ''}. Release it first.`, 'ROLL_NOT_AVAILABLE');
    if (!['In stock', 'Quarantine', 'Damaged'].includes(str(roll.status))) throw bad(`Item ${n}: roll ${roll.roll_number} is ${roll.status} and cannot go back to the supplier.`, 'ROLL_NOT_AVAILABLE');
    const metres = r2(Number(l.metres));
    if (!(metres > 0)) throw bad(`Item ${n}: metres must be more than zero.`);
    if (metres > num(roll.length_meters) + 1e-9) throw bad(`Item ${n}: roll ${roll.roll_number} has only ${num(roll.length_meters)} m on the shelf (you asked for ${metres} m).`, 'INSUFFICIENT_LENGTH');
    const rate = num(gl.rate); const gst = num(gl.gst_percent);
    const taxable = r2(metres * rate); const g = splitGst(taxable, gst, intra);
    rollOf.set(rollId, roll);
    lines.push({ roll_id: roll.id, roll_number: roll.roll_number, product_code: roll.product_code, product_name: gl.product_name ?? null, colour: roll.colour ?? null, hsn_code: gl.hsn_code ?? null, metres, rate, gst_percent: gst, taxable_value: taxable, cgst: g.cgst, sgst: g.sgst, igst: g.igst, amount: r2(taxable + g.tax) });
  }
  const sum = (k: string) => r2(lines.reduce((t, x) => t + num(x[k]), 0));
  const totals = { taxable_amount: sum('taxable_value'), cgst_amount: sum('cgst'), sgst_amount: sum('sgst'), igst_amount: sum('igst'), total_amount: sum('amount') };

  // A return can never be worth more than the bill itself (issued debit notes and returns still waiting for the supplier both count).
  const prior = await all(() => supabaseAdmin.from('textile_debit_notes').select('total_amount').eq('organization_id', orgId).eq('grn_id', grn.id).eq('status', 'Issued'));
  const waiting = await all(() => supabaseAdmin.from('textile_supplier_returns').select('total_amount').eq('organization_id', orgId).eq('grn_id', grn.id).eq('status', 'Sent'));
  const already = r2(prior.reduce((t, x) => t + num(x.total_amount), 0) + waiting.reduce((t, x) => t + num(x.total_amount), 0));
  if (already + totals.total_amount > num(grn.total_amount) + 0.01) throw bad(`${grn.grn_number} is worth ${r2(num(grn.total_amount))} and ${already} was already debited or is waiting for the supplier, so only ${r2(Math.max(0, num(grn.total_amount) - already))} can still go back.`, 'RETURN_EXCEEDS_BILL');

  const undo: Undo[] = []; const codes = new Set<string>();
  try {
    const ret = await insertNumbered('textile_supplier_returns', 'return_number', orgId, `TSR-${financialYear(today())}-`, {
      industry_type_id: it, supplier_id: supplier.id, grn_id: grn.id, grn_number: grn.grn_number, return_date: retDate, reason, lines, ...totals, status: 'Sent', created_by: actor,
    });
    undo.push(async () => { await supabaseAdmin.from('textile_supplier_returns').delete().eq('organization_id', orgId).eq('id', ret.id); });
    for (const l of lines) {
      await moveRoll(orgId, actor, l.roll_id, { type: 'adjustment', quantity: l.metres, delta: -l.metres, note: `Sent to ${supplier.supplier_name} (${ret.return_number}), waiting for acceptance: ${reason}` });
      undo.push(async () => { await moveRoll(orgId, actor, l.roll_id, { type: 'adjustment', quantity: l.metres, delta: l.metres, note: `${ret.return_number} reversed` }); });
      if (l.product_code) codes.add(String(l.product_code));
    }
    for (const c of codes) await syncProductStockFromRolls(orgId, c);
    res.status(201).json({ data: ret });
  } catch (e) { await runUndo(undo); for (const c of codes) await syncProductStockFromRolls(orgId, c); throw e; }
}

/** STEP 2a: the supplier accepted (all or part). Debit note for the accepted metres only; the rest goes back on the roll.
 *  Body: { lines: [{ roll_id, accepted_metres }], accepted_date? }. No "lines" = everything accepted. */
textileReturnsRouter.post('/textile/supplier-returns/:id/accept', authenticate, manager, async (req, res) => {
  const orgId = org(req); const actor = actorOf(req); const b = (req.body ?? {}) as Row;
  await serialized(`tsr-act:${idOf(req)}`, async () => {
    const ret = await loadReturn(req, orgId);
    if (ret.status !== 'Sent') throw bad(`This return is ${ret.status}. Only a return that is Sent to the supplier can be accepted.`);
    const it = String(ret.industry_type_id);
    const acceptedDate = str(b.accepted_date) || today(); if (!isDate(acceptedDate)) throw bad('Accepted date is not valid.');
    const { data: sup } = await supabaseAdmin.from('textile_suppliers').select('*').eq('organization_id', orgId).eq('id', ret.supplier_id).maybeSingle();
    if (!sup) throw bad('The supplier of this return was not found.', 'INVALID_REFERENCE');
    const supplier = sup as Row;
    const { data: co } = await supabaseAdmin.from('textile_company_profile').select('*').eq('organization_id', orgId).eq('industry_type_id', it).maybeSingle();
    const intra = isIntraState((co ?? {}) as Row, supplier);
    if (intra === null) throw bad(`Cannot decide CGST/SGST or IGST: add the state or GSTIN for ${supplier.supplier_name} (and your own state in Company & GST).`, 'GST_STATE_REQUIRED');

    const acceptAll = !Array.isArray(b.lines);
    const given = new Map<string, number>();
    if (!acceptAll) for (const x of b.lines as Row[]) given.set(str(x.roll_id), r2(Number(x.accepted_metres)));

    const sentLines = (ret.lines ?? []) as Row[];
    const retLines: Row[] = []; const dnLines: Row[] = [];
    for (const [i, l] of sentLines.entries()) {
      const sent = num(l.metres);
      const acc = acceptAll ? sent : (given.get(str(l.roll_id)) ?? 0);
      if (!Number.isFinite(acc) || acc < 0) throw bad(`Item ${i + 1}: accepted metres must be 0 or more.`);
      if (acc > sent + 1e-9) throw bad(`Item ${i + 1}: roll ${l.roll_number} was sent for ${sent} m, so ${acc} m cannot be accepted.`);
      retLines.push({ ...l, accepted_metres: acc });
      if (acc > 0) {
        const taxable = r2(acc * num(l.rate)); const g = splitGst(taxable, num(l.gst_percent), intra);
        dnLines.push({ ...l, metres: acc, taxable_value: taxable, cgst: g.cgst, sgst: g.sgst, igst: g.igst, amount: r2(taxable + g.tax) });
      }
    }
    if (!dnLines.length) throw bad('Nothing was accepted. Use Reject if the supplier took none of the fabric.', 'NOTHING_ACCEPTED');
    const sum = (k: string) => r2(dnLines.reduce((t, x) => t + num(x[k]), 0));
    const totals = { taxable_amount: sum('taxable_value'), cgst_amount: sum('cgst'), sgst_amount: sum('sgst'), igst_amount: sum('igst'), total_amount: sum('amount') };

    const prior = await all(() => supabaseAdmin.from('textile_debit_notes').select('total_amount').eq('organization_id', orgId).eq('grn_id', ret.grn_id).eq('status', 'Issued'));
    const already = r2(prior.reduce((t, x) => t + num(x.total_amount), 0));
    const { data: grnRow } = await supabaseAdmin.from('textile_grns').select('grn_number, total_amount').eq('organization_id', orgId).eq('id', ret.grn_id).maybeSingle();
    const grn = (grnRow ?? {}) as Row;
    if (already + totals.total_amount > num(grn.total_amount) + 0.01) throw bad(`${String(grn.grn_number ?? ret.grn_number)} is worth ${r2(num(grn.total_amount))} and ${already} was already debited, so only ${r2(Math.max(0, num(grn.total_amount) - already))} can be accepted.`, 'RETURN_EXCEEDS_BILL');

    // claim the return (only if it is still Sent)
    const { data: claimed, error: ce } = await supabaseAdmin.from('textile_supplier_returns')
      .update({ status: 'Accepted', decided_at: new Date().toISOString(), accepted_amount: totals.total_amount, lines: retLines })
      .eq('organization_id', orgId).eq('id', ret.id).eq('status', 'Sent').select('id');
    if (ce) throw ce;
    if (!claimed || !claimed.length) throw new AppError(409, 'RECORD_CHANGED', 'This return was just changed by someone else. Refresh and try again.');
    const undo: Undo[] = [async () => { await supabaseAdmin.from('textile_supplier_returns').update({ status: 'Sent', decided_at: null, accepted_amount: null, lines: sentLines }).eq('organization_id', orgId).eq('id', ret.id); }];
    const codes = new Set<string>();
    try {
      // the metres the supplier did NOT take come back on the roll
      for (const l of retLines) {
        const back = r2(num(l.metres) - num(l.accepted_metres));
        if (back > 0.004) {
          await moveRoll(orgId, actor, String(l.roll_id), { type: 'adjustment', quantity: back, delta: back, note: `${String(ret.return_number)}: supplier accepted ${num(l.accepted_metres)} m, ${back} m came back` });
          undo.push(async () => { await moveRoll(orgId, actor, String(l.roll_id), { type: 'adjustment', quantity: back, delta: -back, note: `${String(ret.return_number)} accept undone` }); });
        }
        if (l.product_code) codes.add(String(l.product_code));
      }
      const note = await insertNumbered('textile_debit_notes', 'note_number', orgId, `TDN-${financialYear(today())}-`, {
        industry_type_id: it, note_date: acceptedDate, supplier_id: ret.supplier_id, grn_id: ret.grn_id, grn_number: ret.grn_number, supplier_return_id: ret.id, return_number: ret.return_number,
        reason: ret.reason, supply_type: intra ? 'Intra-state' : 'Inter-state', lines: dnLines, ...totals, status: 'Issued', created_by: actor,
      });
      undo.push(async () => { await supabaseAdmin.from('textile_debit_notes').delete().eq('organization_id', orgId).eq('id', note.id); });
      const { data: upd, error: ue } = await supabaseAdmin.from('textile_supplier_returns').update({ debit_note_id: note.id, debit_note_number: note.note_number }).eq('organization_id', orgId).eq('id', ret.id).select().single();
      if (ue) throw ue;
      for (const c of codes) await syncProductStockFromRolls(orgId, c);
      res.json({ data: { ...upd, debit_note: note } });
    } catch (e) { await runUndo(undo); for (const c of codes) await syncProductStockFromRolls(orgId, c); throw e; }
  });
});

/** STEP 2b: the supplier rejected the return. All metres go back on the rolls. No debit note, the supplier bill does not change. */
textileReturnsRouter.post('/textile/supplier-returns/:id/reject', authenticate, manager, async (req, res) => {
  const orgId = org(req); const actor = actorOf(req); const reason = str((req.body ?? {}).reason);
  if (reason.length < 3) throw bad('Enter the reason the supplier gave for rejecting this return.');
  await serialized(`tsr-act:${idOf(req)}`, async () => {
    const ret = await loadReturn(req, orgId);
    if (ret.status !== 'Sent') throw bad(`This return is ${ret.status}. Only a return that is Sent to the supplier can be rejected.`);
    const { data: claimed, error: ce } = await supabaseAdmin.from('textile_supplier_returns')
      .update({ status: 'Rejected', decision_note: reason, decided_at: new Date().toISOString() })
      .eq('organization_id', orgId).eq('id', ret.id).eq('status', 'Sent').select('id');
    if (ce) throw ce;
    if (!claimed || !claimed.length) throw new AppError(409, 'RECORD_CHANGED', 'This return was just changed by someone else. Refresh and try again.');
    const done: Row[] = []; const codes = new Set<string>();
    try {
      for (const l of (ret.lines ?? []) as Row[]) {
        const { data: roll } = await supabaseAdmin.from('textile_fabric_rolls').select('id').eq('organization_id', orgId).eq('id', l.roll_id).maybeSingle();
        if (!roll) continue; // roll was deleted since: nothing to put back
        await moveRoll(orgId, actor, String(l.roll_id), { type: 'adjustment', quantity: num(l.metres), delta: num(l.metres), note: `${String(ret.return_number)} rejected by supplier: ${reason}` });
        done.push(l); if (l.product_code) codes.add(String(l.product_code));
      }
    } catch (e) {
      for (const l of done) { try { await moveRoll(orgId, actor, String(l.roll_id), { type: 'adjustment', quantity: num(l.metres), delta: -num(l.metres), note: `${String(ret.return_number)} reject undone` }); } catch { /* best effort */ } }
      await supabaseAdmin.from('textile_supplier_returns').update({ status: 'Sent', decision_note: null, decided_at: null }).eq('organization_id', orgId).eq('id', ret.id);
      throw e;
    }
    for (const c of codes) await syncProductStockFromRolls(orgId, c);
    res.json({ data: { id: ret.id, status: 'Rejected' } });
  });
});

/** Cancel a wrong return: the metres go back on the rolls and the debit note (if one was issued) is cancelled. Blocked once the mill has refunded money against it. */
textileReturnsRouter.post('/textile/supplier-returns/:id/cancel', authenticate, manager, async (req, res) => {
  const orgId = org(req); const actor = actorOf(req); const reason = str((req.body ?? {}).reason);
  if (reason.length < 3) throw bad('Enter a reason for cancelling this return.');
  const ret = await loadReturn(req, orgId);
  if (!['Sent', 'Accepted', 'Posted'].includes(String(ret.status))) throw bad(`This return is already ${ret.status}.`);
  const prevStatus = String(ret.status);
  if (ret.debit_note_id) {
    const { data: refunds } = await supabaseAdmin.from('textile_supplier_refunds').select('refund_number').eq('organization_id', orgId).eq('debit_note_id', ret.debit_note_id).eq('status', 'Received').limit(1);
    if ((refunds ?? []).length) throw new AppError(409, 'RETURN_REFUNDED', `Refund ${(refunds as Row[])[0].refund_number} was already received against this return. Cancel that refund first.`);
  }
  const { data: claimed, error: ce } = await supabaseAdmin.from('textile_supplier_returns').update({ status: 'Cancelled', cancel_reason: reason, cancelled_at: new Date().toISOString() })
    .eq('organization_id', orgId).eq('id', ret.id).eq('status', prevStatus).select('id');
  if (ce) throw ce;
  if (!claimed || !claimed.length) throw new AppError(409, 'RECORD_CHANGED', 'This return was just changed by someone else. Refresh and try again.');
  const done: Array<{ l: Row; back: number }> = []; const codes = new Set<string>();
  try {
    for (const l of (ret.lines ?? []) as Row[]) {
      // Accepted: only the accepted metres are still away (the rest already came back). Sent / old Posted: everything is away.
      const back = prevStatus === 'Accepted' ? num(l.accepted_metres) : num(l.metres);
      if (back <= 0.004) continue;
      const { data: roll } = await supabaseAdmin.from('textile_fabric_rolls').select('id').eq('organization_id', orgId).eq('id', l.roll_id).maybeSingle();
      if (!roll) continue; // roll was deleted since: nothing to put back
      await moveRoll(orgId, actor, String(l.roll_id), { type: 'adjustment', quantity: back, delta: back, note: `${String(ret.return_number)} cancelled: ${reason}` });
      done.push({ l, back }); if (l.product_code) codes.add(String(l.product_code));
    }
    if (ret.debit_note_id) await supabaseAdmin.from('textile_debit_notes').update({ status: 'Cancelled' }).eq('organization_id', orgId).eq('id', ret.debit_note_id ?? NO_ID);
  } catch (e) {
    for (const d of done) { try { await moveRoll(orgId, actor, String(d.l.roll_id), { type: 'adjustment', quantity: d.back, delta: -d.back, note: `${String(ret.return_number)} cancel undone` }); } catch { /* best effort */ } }
    await supabaseAdmin.from('textile_supplier_returns').update({ status: prevStatus, cancel_reason: null, cancelled_at: null }).eq('organization_id', orgId).eq('id', ret.id);
    throw e;
  }
  for (const c of codes) await syncProductStockFromRolls(orgId, c);
  res.json({ data: { id: ret.id, status: 'Cancelled' } });
});

// =============================================================== Debit notes
textileReturnsRouter.get('/textile/debit-notes', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('textile_debit_notes').select('*, textile_suppliers(supplier_name, supplier_code, gstin)')
    .eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('created_at', { ascending: false }));
  res.json({ data });
});

// =============================================================== Refunds received from suppliers
/** What each mill owes back: credit left after the debit notes were set against open bills (paid bills + returns). */
textileReturnsRouter.get('/textile/supplier-credit', authenticate, manager, async (req, res) => {
  const rows = (await supplierOutstanding(org(req), qIt(req))).filter((s) => num(s.advance) > 0.004)
    .map((s) => ({ supplier_id: s.supplier_id, supplier_code: s.supplier_code, supplier_name: s.supplier_name, credit: s.advance }));
  res.json({ data: rows });
});

textileReturnsRouter.get('/textile/supplier-refunds', authenticate, manager, async (req, res) => {
  const data = await all(() => supabaseAdmin.from('textile_supplier_refunds').select('*, textile_suppliers(supplier_name, supplier_code), textile_debit_notes(note_number)')
    .eq('organization_id', org(req)).eq('industry_type_id', qIt(req)).order('created_at', { ascending: false }));
  res.json({ data });
});

textileReturnsRouter.post('/textile/supplier-refunds', authenticate, manager, (req, res, next) => {
  serialized(`tsp:${str((req.body ?? {}).supplier_id)}`, () => supplierRefundPost(req, res)).catch(next); // same lock as supplier payments
});
async function supplierRefundPost(req: Req, res: any) {
  const b = (req.body ?? {}) as Row; const it = bIt(req); const orgId = org(req);
  const { data: sup } = await supabaseAdmin.from('textile_suppliers').select('id, supplier_name').eq('organization_id', orgId).eq('industry_type_id', it).eq('id', str(b.supplier_id)).maybeSingle();
  if (!sup) throw bad('Pick the supplier / mill that paid the money back.', 'INVALID_REFERENCE');
  const amount = r2(Number(b.amount)); if (!(amount > 0)) throw bad('Refund amount must be more than zero.');
  const mode = str(b.mode); if (!MODES.includes(mode)) throw bad(`Refund mode must be one of: ${MODES.join(', ')}.`);
  const date = str(b.refund_date) || today(); if (!isDate(date)) throw bad('Refund date is not valid.');
  const credit = r2(num((await supplierBills(orgId, it)).advance.get((sup as Row).id as string)));
  if (credit <= 0.004) throw new AppError(422, 'NOTHING_TO_REFUND', `${(sup as Row).supplier_name} does not owe any money back (credit left after open bills is 0).`);
  if (amount > credit + 0.005) throw bad(`${(sup as Row).supplier_name} owes only ${credit} back. Enter ${credit} or less.`, 'REFUND_EXCEEDS_CREDIT');
  let debitNoteId: string | null = null;
  if (str(b.debit_note_id)) {
    const { data: dn } = await supabaseAdmin.from('textile_debit_notes').select('id, supplier_id, status').eq('organization_id', orgId).eq('id', str(b.debit_note_id)).maybeSingle();
    if (!dn || (dn as Row).supplier_id !== (sup as Row).id || (dn as Row).status !== 'Issued') throw bad('Pick an issued debit note of this supplier.', 'INVALID_REFERENCE');
    debitNoteId = (dn as Row).id;
  }
  const ref = str(b.reference_no);
  if (ref) {
    const { data: dup } = await supabaseAdmin.from('textile_supplier_refunds').select('refund_number').eq('organization_id', orgId).eq('supplier_id', (sup as Row).id).eq('reference_no', ref).eq('status', 'Received').limit(1);
    if ((dup ?? []).length) throw new AppError(409, 'DUPLICATE_REFUND', `Reference ${ref} is already recorded on ${(dup as Row[])[0].refund_number}.`);
  }
  const data = await insertNumbered('textile_supplier_refunds', 'refund_number', orgId, `TSF-${financialYear(today())}-`, {
    industry_type_id: it, supplier_id: (sup as Row).id, debit_note_id: debitNoteId, amount, mode, refund_date: date, reference_no: ref || null, notes: str(b.notes) || null, status: 'Received', created_by: actorOf(req),
  });
  res.status(201).json({ data });
}
textileReturnsRouter.post('/textile/supplier-refunds/:id/cancel', authenticate, manager, async (req, res) => {
  const orgId = org(req); const reason = str((req.body ?? {}).reason);
  if (reason.length < 3) throw bad('Enter a reason for cancelling this refund.');
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', 'Refund was not found.');
  const { data: ex } = await supabaseAdmin.from('textile_supplier_refunds').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound;
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound);
  if ((ex as Row).status !== 'Received') throw bad('This refund is already cancelled.');
  const { data, error } = await supabaseAdmin.from('textile_supplier_refunds').update({ status: 'Cancelled', cancel_reason: reason, cancelled_at: new Date().toISOString() })
    .eq('organization_id', orgId).eq('id', idOf(req)).eq('status', 'Received').select().maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(409, 'RECORD_CHANGED', 'This refund was just changed. Refresh and try again.');
  res.json({ data });
});

// =============================================================== Refunds paid to customers (same rules as Pharma / FMCG)
textileReturnsRouter.get('/textile/customer-refunds/pending', authenticate, manager, async (req, res) => {
  res.json({ data: await pendingCustomerRefunds(org(req), qIt(req)) });
});
textileReturnsRouter.get('/textile/customer-refunds', authenticate, manager, async (req, res) => {
  const rows = (await listRefunds(org(req), qIt(req))) as Row[];
  res.json({ data: rows });
});
textileReturnsRouter.post('/textile/customer-refunds', authenticate, manager, async (req, res) => {
  const input = refundSchema.parse(req.body ?? {});
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, clients!inner(industry_type_id)').eq('id', input.orderId).eq('organization_id', org(req)).maybeSingle();
  if (error) throw error;
  const indId = (order?.clients as unknown as { industry_type_id?: string | null } | null)?.industry_type_id ?? null;
  if (!order || (await industryCodeOf(org(req), indId)) !== 'textile') throw new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  res.status(201).json({ data: await createRefund(org(req), actorOf(req) as string, req.industryScope!, input) });
});

// =============================================================== Customer returns part of a cut
const cutReturnSchema = z.object({
  allocationId: z.string().uuid(),
  metres: z.coerce.number().positive().max(100000),
  condition: z.enum(['good', 'damaged']),
  reason: z.string().trim().max(500).optional().nullable(),
  creditClient: z.boolean().optional(),
});

/** Sold cuts of an order that can still come back (metres not yet returned). */
textileReturnsRouter.get('/textile/orders/:id/returnable-cuts', authenticate, manager, async (req, res) => {
  const order = await loadTextileOrder(req, 'id');
  const { data, error } = await supabaseAdmin.from('textile_roll_allocations').select('id, roll_id, roll_number, product_code, metres, returned_metres, status, sold_at')
    .eq('organization_id', org(req)).eq('order_id', order.id as string).eq('status', 'Sold').order('created_at', { ascending: true });
  if (error) throw error;
  res.json({ data: ((data ?? []) as Row[]).map((a) => ({ ...a, returnable: r2(num(a.metres) - num(a.returned_metres)) })).filter((a) => a.returnable > 0.004) });
});

textileReturnsRouter.post('/textile/orders/:id/return-cut', authenticate, manager, async (req, res) => {
  const orgId = org(req); const actor = actorOf(req);
  const input = cutReturnSchema.parse(req.body ?? {});
  const metres = r2(input.metres);
  const order = await loadTextileOrder(req, 'id, order_number, status, client_id, currency_code, exchange_rate');
  if (!['confirmed', 'completed'].includes(String(order.status))) throw new AppError(422, 'ORDER_NOT_RETURNABLE', 'Only a confirmed or completed order can have a return.');
  await serialized(`trc:${order.id}`, async () => {
    const { data: al } = await supabaseAdmin.from('textile_roll_allocations').select('*').eq('organization_id', orgId).eq('id', input.allocationId).eq('order_id', order.id as string).maybeSingle();
    const a = al as Row | null;
    if (!a) throw new AppError(404, 'CUT_NOT_FOUND', 'That cut is not on this order.');
    if (a.status !== 'Sold') throw new AppError(422, 'CUT_NOT_SOLD', 'Only a dispatched (Sold) cut can be returned. Remove a reserved cut from the order instead.');
    const back = r2(num(a.metres) - num(a.returned_metres));
    if (metres > back + 1e-9) throw new AppError(422, 'RETURN_EXCEEDS_CUT', `Only ${back} m of this cut can still be returned (${num(a.returned_metres)} m already came back).`);

    const { data: lines, error: le } = await supabaseAdmin.from('sale_order_items').select('quantity, subtotal, tax_amount, products!inner(id, product_code)').eq('order_id', order.id as string);
    if (le) throw le;
    const mine: Row[] = ((lines ?? []) as unknown as Row[]).map((l): Row => ({ ...l, p: one(l.products) })).filter((l) => l.p?.product_code === a.product_code);
    if (!mine.length) throw new AppError(422, 'PRODUCT_NOT_ON_ORDER', "This cut's product is not on the order.");
    const productId = mine[0].p.id as string;
    const paidQty = mine.reduce((s, l) => s + num(l.quantity), 0);
    const paidTotal = mine.reduce((s, l) => s + num(l.subtotal) + num(l.tax_amount), 0);
    const { data: prior } = await supabaseAdmin.from('sales_returns').select('credit_amount').eq('organization_id', orgId).eq('order_id', order.id as string).eq('product_id', productId).in('status', ['pending', 'approved']);
    const alreadyCredited = ((prior ?? []) as Row[]).reduce((s, r) => s + num(r.credit_amount), 0);
    const creditClient = input.condition === 'damaged' ? input.creditClient !== false : true;
    const credit = creditClient && paidQty > 0 ? r2(Math.max(0, Math.min((paidTotal / paidQty) * metres, paidTotal - alreadyCredited))) : 0;
    const rate = num(order.exchange_rate) || 1;

    // 1. claim the metres on the cut (optimistic: only if nobody changed it meanwhile)
    const { data: claimed, error: ce } = await supabaseAdmin.from('textile_roll_allocations').update({ returned_metres: r2(num(a.returned_metres) + metres) }).eq('organization_id', orgId).eq('id', a.id).eq('returned_metres', num(a.returned_metres)).select('id');
    if (ce) throw ce;
    if (!claimed || !claimed.length) throw new AppError(409, 'RECORD_CHANGED', 'This cut was just changed by someone else. Refresh and try again.');
    const undo: Undo[] = [async () => { await supabaseAdmin.from('textile_roll_allocations').update({ returned_metres: num(a.returned_metres) }).eq('organization_id', orgId).eq('id', a.id); }];
    try {
      // 2. metres back on the roll (a damaged piece is booked as damaged length straight away)
      const note = `Customer return, order ${String(order.order_number)}${input.reason ? `: ${input.reason}` : ''}`;
      await moveRoll(orgId, actor, String(a.roll_id), { type: 'return', quantity: metres, delta: metres, orderId: order.id as string, orderNumber: String(order.order_number ?? ''), clientId: (order.client_id as string | null) ?? null, note });
      undo.push(async () => { await moveRoll(orgId, actor, String(a.roll_id), { type: 'adjustment', quantity: metres, delta: -metres, note: 'Customer return undone' }); });
      if (input.condition === 'damaged') {
        await moveRoll(orgId, actor, String(a.roll_id), { type: 'damage', quantity: metres, delta: -metres, damaged: metres, orderId: order.id as string, orderNumber: String(order.order_number ?? ''), note: `Returned damaged, order ${String(order.order_number)}` });
      }
      // 3. approved return entry (credit for the customer; the credit note and refund flows pick it up from here)
      const { error: ie } = await supabaseAdmin.from('sales_returns').insert({
        organization_id: orgId, order_id: order.id, client_id: order.client_id, product_id: productId, quantity: metres, kind: input.condition === 'damaged' ? 'damage' : 'return',
        reason: [`Cut ${String(a.roll_number)}`, input.reason?.trim()].filter(Boolean).join(' - '), restock: false, credit_client: creditClient, status: 'approved',
        currency_code: String(order.currency_code ?? 'INR'), exchange_rate: rate, credit_amount: credit, base_credit: toBase(credit, rate), created_by: actor, decided_by: actor, decided_at: new Date().toISOString(),
      });
      if (ie) throw ie;
    } catch (e) { await runUndo(undo); throw e; }
    await syncProductStockFromRolls(orgId, a.product_code);
    await issueCreditNotesForOrder(orgId, order.id as string, actor); // GST credit note, never blocks the return
    res.status(201).json({ data: { credit, metres, remaining_returnable: r2(back - metres) } });
  });
});

async function loadTextileOrder(req: Req, select: string): Promise<Row> {
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  const { data, error } = await supabaseAdmin.from('sale_orders').select(`${select}, clients!inner(industry_type_id)`).eq('id', idOf(req)).eq('organization_id', org(req)).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound;
  const order = data as unknown as Row;
  const industryTypeId = one(order.clients)?.industry_type_id ?? null;
  assertRecordInScope(req.industryScope!, industryTypeId, notFound);
  if ((await industryCodeOf(org(req), industryTypeId)) !== 'textile') throw new AppError(422, 'TEXTILE_ONLY', 'This is available for Textile orders only.');
  return order;
}