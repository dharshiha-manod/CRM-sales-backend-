import { Router } from 'express';
import { orders } from '../controllers/orders.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const ordersRouter = Router();
ordersRouter.post('/field-visits/:id/orders', authenticate, requireRoles('sales_representative'), orders.createFromVisit);
ordersRouter.get('/orders/mine', authenticate, requireRoles('sales_representative'), orders.mine);
ordersRouter.get('/orders', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), orders.all);
ordersRouter.post('/orders', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), orders.createManual);
ordersRouter.post('/orders/:id/cancel', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), orders.cancel);
ordersRouter.post('/orders/:id/approve', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), orders.approve);
ordersRouter.patch('/orders/:id', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), orders.update);
