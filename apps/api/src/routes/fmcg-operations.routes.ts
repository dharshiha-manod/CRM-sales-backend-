import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { isFmcgIndustry } from '../lib/fmcg-market.js';
import { representativeForUser } from '../repositories/stock-requests.repository.js';
import { batchSchema, createBatch, deleteBatch, listBatches, updateBatch } from '../repositories/product-batches.repository.js';
import { createReturn, decideReturn, deleteReturn, listReturns, returnSchema } from '../repositories/sales-returns.repository.js';
import { beatSchema, createBeat, deleteBeat, listBeats, updateBeat } from '../repositories/route-beats.repository.js';

type Req = Parameters<RequestHandler>[0];
const org = (req: Req) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };
const fmcgId = async (req: Req): Promise<string> => {
  const id = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!id || !(await isFmcgIndustry(org(req), id))) throw new AppError(422, 'NOT_FMCG', 'This is only available in the FMCG industry.');
  return id;
};
const paramId = (req: Req) => z.string().uuid().parse(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
const staff = requireRoles('super_admin', 'admin', 'sales_manager');
const approvers = requireRoles('super_admin', 'admin', 'sales_manager');

export const fmcgOperationsRouter = Router();

// ---------- Batch & expiry ----------
fmcgOperationsRouter.get('/fmcg/batches', authenticate, staff, async (req, res) => res.json({ data: await listBatches(org(req), await fmcgId(req)) }));
fmcgOperationsRouter.post('/fmcg/batches', authenticate, staff,async (req, res) => { const industryTypeId = await fmcgId(req); res.status(201).json({ data: await createBatch(org(req), req.industryScope!, batchSchema.parse(req.body ?? {}), industryTypeId) }); });
fmcgOperationsRouter.patch('/fmcg/batches/:id', authenticate, staff, async (req, res) => {
  const industryTypeId = await fmcgId(req);
  const body = z.object({ batchNo: z.string().trim().min(1).max(60).optional(), mfgDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), quantity: z.number().finite().min(0).max(1e8).optional() }).parse(req.body ?? {});
res.json({ data: await updateBatch(org(req), req.industryScope!, paramId(req), body, industryTypeId) });});
fmcgOperationsRouter.delete('/fmcg/batches/:id', authenticate, staff, async (req, res) => { await fmcgId(req); await deleteBatch(org(req), req.industryScope!, paramId(req)); res.status(204).send(); });

// ---------- Returns & damage ----------
fmcgOperationsRouter.get('/fmcg/returns', authenticate, requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative'), async (req, res) => {
  const organizationId = org(req);
  if (req.organizationRole === 'sales_representative') {
    const rep = await representativeForUser(organizationId, req.auth!.sub as string);
    res.json({ data: await listReturns(organizationId, { representativeId: rep.id }) });
    return;
  }
  res.json({ data: await listReturns(organizationId, { industryTypeId: await fmcgId(req) }) });
});
fmcgOperationsRouter.post('/fmcg/returns', authenticate, requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative'), async (req, res) => {
  const organizationId = org(req);
  const rep = req.organizationRole === 'sales_representative' ? await representativeForUser(organizationId, req.auth!.sub as string) : null;
  res.status(201).json({ data: await createReturn(organizationId, req.auth!.sub as string, req.industryScope!, returnSchema.parse(req.body ?? {}), rep?.id) });
});
fmcgOperationsRouter.post('/fmcg/returns/:id/decision', authenticate, approvers, async (req, res) => {
  const { status } = z.object({ status: z.enum(['approved', 'rejected']) }).parse(req.body ?? {});
  res.json({ data: await decideReturn(org(req), req.auth!.sub as string, req.industryScope!, paramId(req), status) });
});
fmcgOperationsRouter.delete('/fmcg/returns/:id', authenticate, approvers, async (req, res) => { await deleteReturn(org(req), req.industryScope!, paramId(req)); res.status(204).send(); });

// ---------- Route / beat plans ----------
fmcgOperationsRouter.get('/fmcg/beats', authenticate, requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative'), async (req, res) => {
  const organizationId = org(req);
  const rep = req.organizationRole === 'sales_representative' ? await representativeForUser(organizationId, req.auth!.sub as string) : null;
  res.json({ data: await listBeats(organizationId, await fmcgId(req), rep?.id) });
});
fmcgOperationsRouter.post('/fmcg/beats', authenticate, staff, async (req, res) => res.status(201).json({ data: await createBeat(org(req), req.auth!.sub as string, await fmcgId(req), beatSchema.parse(req.body ?? {})) }));
fmcgOperationsRouter.put('/fmcg/beats/:id', authenticate, staff, async (req, res) => res.json({ data: await updateBeat(org(req), await fmcgId(req), paramId(req), beatSchema.parse(req.body ?? {})) }));
fmcgOperationsRouter.delete('/fmcg/beats/:id', authenticate, staff, async (req, res) => { await deleteBeat(org(req), await fmcgId(req), paramId(req)); res.status(204).send(); });
