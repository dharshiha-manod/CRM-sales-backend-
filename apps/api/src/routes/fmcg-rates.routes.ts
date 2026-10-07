import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { isFmcgIndustry } from '../lib/fmcg-market.js';
import { createFmcgRate, deleteFmcgRate, listFmcgRates } from '../repositories/fmcg-rates.repository.js';

const org = (req: Parameters<RequestHandler>[0]) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };
const fmcgId = async (req: Parameters<RequestHandler>[0]) => {
  const id = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!(await isFmcgIndustry(org(req), id))) throw new AppError(422, 'NOT_FMCG', 'Currency rates are only available in the FMCG industry.');
  return id;
};

export const fmcgRatesRouter = Router();
fmcgRatesRouter.get('/fmcg/currency-rates', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), async (req, res) => res.json({ data: await listFmcgRates(org(req), await fmcgId(req)) }));
fmcgRatesRouter.post('/fmcg/currency-rates', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), async (req, res) => res.status(201).json({ data: await createFmcgRate(org(req), req.auth!.sub!, await fmcgId(req), req.body ?? {}) }));
fmcgRatesRouter.delete('/fmcg/currency-rates/:id', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  await deleteFmcgRate(org(req), id, await fmcgId(req));
  res.status(204).send();
});