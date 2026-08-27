import { Router } from 'express';
import { representativeDashboard } from '../controllers/mobile-dashboard.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
export const mobileRouter = Router();
mobileRouter.use(authenticate, requireRoles('sales_representative'));
mobileRouter.get('/dashboard', representativeDashboard);
