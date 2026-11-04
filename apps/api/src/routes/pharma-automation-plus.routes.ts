/* eslint-disable @typescript-eslint/no-explicit-any */
// Pharma automation part 2 API: send a PO to its supplier, test the daily summary, run everything now.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { bad } from '../lib/pharma-db.js';
import { getSettings, runAutomationForScope } from '../services/pharma-automation.service.js';
import { acceptPurchaseReturn, dispatchPurchaseReturn, sendInvoice, runDigest, runPlusForScope, sendPurchaseOrder, sendPurchaseReturn } from '../services/pharma-automation-plus.service.js';
import { checkPoRepliesNow } from '../services/pharma-po-reply-poller.service.js';

export const pharmaAutomationPlusRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
type Req = Parameters<RequestHandler>[0];
const org = (req: Req) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };
const it = (req: Req) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : typeof body.industryTypeId === 'string' ? body.industryTypeId : undefined;
  const v = resolveIndustryTypeId(req.industryScope!, raw); if (!v) throw bad('industryTypeId is required.'); return v;
};
const idOf = (req: Req) => { const v = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id; if (!v) throw bad('A record id is required.', 'INVALID_ID'); return v; };

pharmaAutomationPlusRouter.post('/pharma/automation/po/:id/send', authenticate, manager, async (req, res) => {
  res.json({ data: await sendPurchaseOrder(org(req), it(req), idOf(req)) });
});
pharmaAutomationPlusRouter.post('/pharma/automation/purchase-return/:id/send', authenticate, manager, async (req, res) => {
  res.json({ data: await sendPurchaseReturn(org(req), it(req), idOf(req)) });
});
pharmaAutomationPlusRouter.post('/pharma/automation/invoice/:id/send', authenticate, manager, async (req, res) => {
  res.json({ data: await sendInvoice(org(req), it(req), idOf(req)) });
});
pharmaAutomationPlusRouter.post('/pharma/automation/purchase-return/:id/dispatch', authenticate, manager, async (req, res) => {
  res.json({ data: await dispatchPurchaseReturn(org(req), it(req), idOf(req), (req.body ?? {}) as any) });
});
pharmaAutomationPlusRouter.post('/pharma/automation/purchase-return/:id/accept', authenticate, manager, async (req, res) => {
  res.json({ data: await acceptPurchaseReturn(org(req), it(req), idOf(req), (req.body ?? {}) as any) });
});
// Reads the mailbox now for supplier replies to purchase orders (same job that also runs every few minutes).
pharmaAutomationPlusRouter.post('/pharma/automation/po/check-replies', authenticate, manager, async (_req, res) => {
  res.json({ data: await checkPoRepliesNow() });
});
pharmaAutomationPlusRouter.post('/pharma/automation/digest/send', authenticate, manager, async (req, res) => {
  const o = org(req); const i = it(req);
  res.json({ data: await runDigest(o, i, await getSettings(o, i), true) });
});
pharmaAutomationPlusRouter.post('/pharma/automation/run-all', authenticate, manager, async (req, res) => {
  const o = org(req); const i = it(req);
  const base = await runAutomationForScope(o, i); const plus = await runPlusForScope(o, i);
  res.json({ data: { ...base, ...plus } });
});