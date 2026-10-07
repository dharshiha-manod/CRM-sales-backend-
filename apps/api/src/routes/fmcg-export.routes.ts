import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { updateExportDetails } from '../repositories/fmcg-export.repository.js';

const org = (req: Parameters<RequestHandler>[0]) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };

export const fmcgExportRouter = Router();
fmcgExportRouter.patch('/orders/:id/export-details', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  res.json({ data: await updateExportDetails(org(req), req.industryScope!, id, req.body ?? {}) });
});