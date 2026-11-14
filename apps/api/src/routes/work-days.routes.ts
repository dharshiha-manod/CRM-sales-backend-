import { Router } from 'express';
import { workDays } from '../controllers/work-days.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const workDaysRouter = Router();
workDaysRouter.get('/work-days/today', authenticate, requireRoles('sales_representative'), workDays.today);
workDaysRouter.post('/work-days/start', authenticate, requireRoles('sales_representative'), workDays.start);
workDaysRouter.post('/work-days/end', authenticate, requireRoles('sales_representative'), workDays.end);
workDaysRouter.post('/work-days/:id/pings', authenticate, requireRoles('sales_representative'), workDays.pings);
workDaysRouter.get('/work-days/overview', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), workDays.overview);
workDaysRouter.get('/work-days/:id/route', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), workDays.route);