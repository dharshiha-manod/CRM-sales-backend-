import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { isFmcgIndustry } from '../lib/fmcg-market.js';
import { addEntry, deleteEntry, entrySchema, getDistributor, listDistributors, profileSchema, saveProfile } from '../repositories/fmcg-distributors.repository.js';

type Req = Parameters<RequestHandler>[0];
const org = (req: Req) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };
const fmcgId = async (req: Req): Promise<string> => {
  const id = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!id || !(await isFmcgIndustry(org(req), id))) throw new AppError(422, 'NOT_FMCG', 'Distributor management is only available in the FMCG industry.');
  return id;
};
const pid = (req: Req, key = 'id') => z.string().uuid().parse(Array.isArray(req.params[key]) ? req.params[key][0] : req.params[key]);
const staff = requireRoles('super_admin', 'admin', 'sales_manager');

export const fmcgDistributorsRouter = Router();
fmcgDistributorsRouter.get('/fmcg/distributors', authenticate, staff, async (req, res) => res.json({ data: await listDistributors(org(req), await fmcgId(req)) }));
fmcgDistributorsRouter.get('/fmcg/distributors/:clientId', authenticate, staff, async (req, res) => res.json({ data: await getDistributor(org(req), await fmcgId(req), pid(req, 'clientId')) }));
fmcgDistributorsRouter.put('/fmcg/distributors/:clientId/profile', authenticate, staff, async (req, res) => res.json({ data: await saveProfile(org(req), await fmcgId(req), pid(req, 'clientId'), profileSchema.parse(req.body ?? {})) }));
fmcgDistributorsRouter.post('/fmcg/distributors/:clientId/entries', authenticate, staff, async (req, res) => res.status(201).json({ data: await addEntry(org(req), req.auth!.sub as string, await fmcgId(req), pid(req, 'clientId'), entrySchema.parse(req.body ?? {})) }));
fmcgDistributorsRouter.delete('/fmcg/distributor-entries/:id', authenticate, staff, async (req, res) => { await deleteEntry(org(req), await fmcgId(req), pid(req)); res.status(204).send(); });