import { Router } from 'express';
import { organizationSettings } from '../controllers/organization-settings.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const organizationSettingsRouter = Router();
organizationSettingsRouter.get('/organization-settings', authenticate, requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative'), organizationSettings.get);
organizationSettingsRouter.put('/organization-settings', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), organizationSettings.save);
