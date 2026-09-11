import { Router } from 'express'; import { followUps } from '../controllers/follow-ups.controller.js'; import { authenticate } from '../middleware/authenticate.js'; import { requireRoles } from '../middleware/authorize.js';
export const followUpsRouter = Router();
followUpsRouter.post('/field-visits/:id/follow-ups', authenticate, requireRoles('sales_representative'), followUps.createFromVisit);
followUpsRouter.get('/follow-ups/mine', authenticate, requireRoles('sales_representative'), followUps.mine);
followUpsRouter.get('/follow-ups', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), followUps.all);
followUpsRouter.post('/follow-ups', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), followUps.createManual);
followUpsRouter.patch('/follow-ups/:id', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), followUps.update);
