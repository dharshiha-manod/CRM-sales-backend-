import { Router } from 'express';
import { targets } from '../controllers/targets.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

const manager = requireRoles('super_admin', 'admin', 'sales_manager');

export const targetsRouter = Router();
targetsRouter.get('/targets', authenticate, manager, targets.list);
targetsRouter.get('/targets/:id', authenticate, manager, targets.get);
targetsRouter.post('/targets', authenticate, manager, targets.create);
targetsRouter.patch('/targets/:id', authenticate, manager, targets.update);
targetsRouter.patch('/targets/:id/lifecycle', authenticate, manager, targets.setLifecycle);
targetsRouter.post('/targets/:id/adjust', authenticate, manager, targets.adjust);
targetsRouter.delete('/targets/:id', authenticate, manager, targets.remove);