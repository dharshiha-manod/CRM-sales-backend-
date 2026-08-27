import { Router } from 'express';
import { fieldActivity } from '../controllers/field-activity.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const fieldActivityRouter = Router();
fieldActivityRouter.get('/field-visits', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), fieldActivity.all);
fieldActivityRouter.get('/field-visits/live', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), fieldActivity.live);
fieldActivityRouter.get('/field-visits/my-clients', authenticate, requireRoles('sales_representative'), fieldActivity.myClients);
fieldActivityRouter.get('/field-visits/nearby', authenticate, requireRoles('sales_representative'), fieldActivity.nearby);
fieldActivityRouter.get('/field-visits/mine', authenticate, requireRoles('sales_representative'), fieldActivity.mine);
fieldActivityRouter.get('/field-visits/:id/activities', authenticate, requireRoles('sales_representative'), fieldActivity.activities);
fieldActivityRouter.get('/field-visits/:id/activities/all', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), fieldActivity.allActivities);
fieldActivityRouter.post('/field-visits/:id/activities', authenticate, requireRoles('sales_representative'), fieldActivity.addActivity);
fieldActivityRouter.post('/field-visits/check-in', authenticate, requireRoles('sales_representative'), fieldActivity.checkIn);
fieldActivityRouter.post('/field-visits/:id/pings', authenticate, requireRoles('sales_representative'), fieldActivity.ping);
fieldActivityRouter.patch('/field-visits/:id/check-out', authenticate, requireRoles('sales_representative'), fieldActivity.checkOut);
