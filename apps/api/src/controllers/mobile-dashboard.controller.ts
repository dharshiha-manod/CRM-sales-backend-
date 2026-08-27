import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { uuid } from '../validation/master-data.schemas.js';
import { getRepresentativeDashboard } from '../services/mobile-dashboard.service.js';
export const representativeDashboard: RequestHandler = async (req, res) => {
  const organizationId = req.header('x-organization-id');
  if (!organizationId) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  res.json({ data: await getRepresentativeDashboard(uuid.parse(organizationId), req.auth!.sub!) });
};
