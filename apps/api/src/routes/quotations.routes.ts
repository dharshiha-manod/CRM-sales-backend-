import { Router } from 'express';
import { quotations } from '../controllers/quotations.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const quotationsRouter = Router();

quotationsRouter.post(
  '/requirements/:id/quotations',
  authenticate,
  requireRoles('sales_representative', 'admin', 'super_admin'),
  quotations.createFromRequirement,
);
quotationsRouter.get('/quotations/mine', authenticate, requireRoles('sales_representative'), quotations.mine);
quotationsRouter.get(
  '/quotations',
  authenticate,
  requireRoles('super_admin', 'admin', 'sales_manager'),
  quotations.all,
);
quotationsRouter.get(
  '/quotations/:id',
  authenticate,
  requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative'),
  quotations.get,
);
quotationsRouter.patch('/quotations/:id', authenticate, requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative'), quotations.update);
quotationsRouter.post(
  '/quotations/:id/convert',
  authenticate,
  requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative'),
  quotations.convertToOrder,
);