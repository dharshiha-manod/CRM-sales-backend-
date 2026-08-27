import { Router } from 'express';
import { telephony } from '../controllers/telephony.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const telephonyRouter = Router();
telephonyRouter.get('/telephony/calls', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), telephony.list);
