// FMCG credit control + cheque tracker endpoints (logic lives in lib/fmcg-credit.ts).
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { isFmcgIndustry } from '../lib/fmcg-market.js';
import { actOnCheque, creditOverview, listCheques, updateClientCredit, type ChequeAction } from '../lib/fmcg-credit.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const fmcgCreditRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
type Req = Parameters<RequestHandler>[0];

const org = (req: Req) => {
  const v = req.header('x-organization-id');
  if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return v;
};
const idOf = (req: Req) => {
  const v = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!v) throw new AppError(400, 'INVALID_ID', 'A record id is required.');
  return v;
};
const fmcgId = async (req: Req): Promise<string> => {
  const id = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!id || !(await isFmcgIndustry(org(req), id))) throw new AppError(422, 'NOT_FMCG', 'Credit control is only available in the FMCG industry.');
  return id;
};

fmcgCreditRouter.get('/fmcg/credit/overview', authenticate, manager, async (req, res) => {
  res.json({ data: await creditOverview(org(req), await fmcgId(req)) });
});
fmcgCreditRouter.patch('/fmcg/credit/clients/:id', authenticate, manager, async (req, res) => {
  res.json({ data: await updateClientCredit(org(req), await fmcgId(req), idOf(req), req.body ?? {}) });
});
fmcgCreditRouter.get('/fmcg/cheques', authenticate, manager, async (req, res) => {
  res.json({ data: await listCheques(org(req), await fmcgId(req)) });
});
fmcgCreditRouter.patch('/fmcg/cheques/:id', authenticate, manager, async (req, res) => {
  res.json({ data: await actOnCheque(org(req), await fmcgId(req), idOf(req), (req.body ?? {}) as ChequeAction) });
});