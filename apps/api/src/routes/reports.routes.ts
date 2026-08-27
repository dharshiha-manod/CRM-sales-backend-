import { Router } from 'express';
import { reports } from '../controllers/reports.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
export const reportsRouter = Router();
reportsRouter.get('/reports/summary', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), reports.summary);
