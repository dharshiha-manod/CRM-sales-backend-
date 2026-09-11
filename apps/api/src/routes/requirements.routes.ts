import { Router } from 'express';
import { requirements } from '../controllers/requirements.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const requirementsRouter = Router();

requirementsRouter.post('/requirements', authenticate, requireRoles('sales_representative', 'admin', 'super_admin'), requirements.create);
requirementsRouter.get('/requirements/mine', authenticate, requireRoles('sales_representative'), requirements.mine);
requirementsRouter.get(
  '/requirements',
  authenticate,
  requireRoles('super_admin', 'admin', 'sales_manager'),
  requirements.all,
);
requirementsRouter.get(
  '/requirements/:id',
  authenticate,
  requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative'),
  requirements.get,
);
requirementsRouter.patch(
  '/requirements/:id',
  authenticate,
  requireRoles('super_admin', 'admin', 'sales_manager'),
  requirements.update,
);