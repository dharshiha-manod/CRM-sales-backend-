import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { isFmcgIndustry } from '../lib/fmcg-market.js';
import { createScheme, deleteScheme, listSchemes, schemeSchema, setSchemeProducts, updateScheme } from '../repositories/fmcg-schemes.repository.js';

const org = (req: Parameters<RequestHandler>[0]) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };
const fmcgId = async (req: Parameters<RequestHandler>[0]): Promise<string> => {
  const id = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!id || !(await isFmcgIndustry(org(req), id))) throw new AppError(422, 'NOT_FMCG', 'Schemes are only available in the FMCG industry.');
  return id;
};
const paramId = (req: Parameters<RequestHandler>[0]) => z.string().uuid().parse(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
const roles = requireRoles('super_admin', 'admin', 'sales_manager');

export const fmcgSchemesRouter = Router();
fmcgSchemesRouter.get('/fmcg/schemes', authenticate, roles, async (req, res) => res.json({ data: await listSchemes(org(req), await fmcgId(req)) }));
fmcgSchemesRouter.post('/fmcg/schemes', authenticate, roles, async (req, res) => res.status(201).json({ data: await createScheme(org(req), req.auth!.sub!, await fmcgId(req), schemeSchema.parse(req.body ?? {})) }));
fmcgSchemesRouter.patch('/fmcg/schemes/:id', authenticate, roles, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const input = Object.keys(body).length === 1 && 'status' in body ? z.object({ status: z.enum(['active', 'inactive']) }).parse(body) : schemeSchema.parse(body);
  res.json({ data: await updateScheme(org(req), await fmcgId(req), paramId(req), input) });
});
fmcgSchemesRouter.put('/fmcg/schemes/:id/products', authenticate, roles, async (req, res) => {
  const { productIds } = z.object({ productIds: z.array(z.string().uuid()).max(2000) }).parse(req.body ?? {});
  res.json({ data: await setSchemeProducts(org(req), await fmcgId(req), paramId(req), productIds) });
});
fmcgSchemesRouter.delete('/fmcg/schemes/:id', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => { await deleteScheme(org(req), await fmcgId(req), paramId(req)); res.status(204).send(); });