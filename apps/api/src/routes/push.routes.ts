import { Router } from 'express';
import { push } from '../controllers/push.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const pushRouter = Router();
pushRouter.post('/push/send', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), push.send);