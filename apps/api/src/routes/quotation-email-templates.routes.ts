import { Router } from 'express';
import { quotationEmailTemplates } from '../controllers/quotation-email-templates.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const quotationEmailTemplatesRouter = Router();
quotationEmailTemplatesRouter.get('/settings/quotation-email-template', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), quotationEmailTemplates.get);
quotationEmailTemplatesRouter.put('/settings/quotation-email-template', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), quotationEmailTemplates.save);
