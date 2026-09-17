import { Router } from 'express';
import { telephony } from '../controllers/telephony.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const telephonyRouter = Router();
const staffRoles = requireRoles('super_admin', 'admin', 'sales_manager');

telephonyRouter.get('/telephony/calls', authenticate, staffRoles, telephony.list);
telephonyRouter.post('/telephony/calls', authenticate, staffRoles, telephony.initiateCall);
telephonyRouter.get('/telephony/calls/:id', authenticate, staffRoles, telephony.get);
telephonyRouter.post('/telephony/calls/:id/notes', authenticate, staffRoles, telephony.addNote);
telephonyRouter.post('/telephony/calls/:id/link-lead', authenticate, staffRoles, telephony.linkLead);

telephonyRouter.get('/telephony/settings', authenticate, staffRoles, telephony.getSettings);
telephonyRouter.put('/telephony/settings', authenticate, staffRoles, telephony.updateSettings);
