// FMCG Automation Center API (/fmcg/automation/*). Managers and admins only.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { isFmcgIndustry } from '../lib/fmcg-market.js';
import { createReorderDrafts, reorderPlan } from './fmcg-purchase.routes.js';
import * as auto from '../services/fmcg-automation.service.js';

export const fmcgAutomationRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
type Req = Parameters<RequestHandler>[0];
const org = (req: Req) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };
const fmcgId = async (req: Req): Promise<string> => {
  const id = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : typeof (req.body ?? {}).industryTypeId === 'string' ? (req.body ?? {}).industryTypeId : null);
  if (!id || !(await isFmcgIndustry(org(req), id))) throw new AppError(422, 'NOT_FMCG', 'The Automation Center is only available in the FMCG industry.');
  return id;
};
const actor = (req: Req) => ((req as unknown as { auth?: { sub?: string } }).auth?.sub as string | undefined) ?? null;
const P = '/fmcg/automation';

fmcgAutomationRouter.get(`${P}/today`, authenticate, manager, async (req, res) => { res.json({ data: await auto.todaySummary(org(req), await fmcgId(req)) }); });
fmcgAutomationRouter.get(`${P}/schemes`, authenticate, manager, async (req, res) => { res.json({ data: await auto.schemeHealth(org(req), await fmcgId(req)) }); });
fmcgAutomationRouter.post(`${P}/schemes/expire`, authenticate, manager, async (req, res) => { res.json({ data: await auto.expireSchemes(org(req), await fmcgId(req)) }); });
fmcgAutomationRouter.get(`${P}/reorder-plan`, authenticate, manager, async (req, res) => { res.json({ data: await reorderPlan(org(req), await fmcgId(req)) }); });
fmcgAutomationRouter.post(`${P}/reorder/run`, authenticate, manager, async (req, res) => { res.json({ data: await createReorderDrafts(org(req), await fmcgId(req), actor(req), 'Auto-drafted by Automation Center (low stock)') }); });
fmcgAutomationRouter.get(`${P}/late-pos`, authenticate, manager, async (req, res) => { res.json({ data: await auto.latePurchaseOrders(org(req), await fmcgId(req)) }); });
fmcgAutomationRouter.post(`${P}/run`, authenticate, manager, async (req, res) => { res.json({ data: await auto.runAutomationForScope(org(req), await fmcgId(req), actor(req)) }); });