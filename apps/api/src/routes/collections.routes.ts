import { Router } from 'express';
import { collections } from '../controllers/collections.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
export const collectionsRouter = Router();
collectionsRouter.post('/field-visits/:id/collections', authenticate, requireRoles('sales_representative'), collections.createFromVisit);
collectionsRouter.get('/collections/mine', authenticate, requireRoles('sales_representative'), collections.mine);
collectionsRouter.get('/collections', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), collections.all);
