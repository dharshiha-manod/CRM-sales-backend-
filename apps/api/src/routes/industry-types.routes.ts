import { Router } from 'express';
import { industryTypes, productIndustryTags } from '../controllers/industry-types.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

const manager = requireRoles('super_admin', 'admin', 'sales_manager');
const readAny = requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative');

export const industryTypesRouter = Router();
// Scope authorization to industry-type and product-tag URLs only; this router
// is mounted at the API root alongside unrelated modules.
industryTypesRouter.get('/industry-types', authenticate, readAny, industryTypes.list);
industryTypesRouter.post('/industry-types', authenticate, manager, industryTypes.create);
industryTypesRouter.get('/industry-types/:id', authenticate, readAny, industryTypes.get);
industryTypesRouter.patch('/industry-types/:id', authenticate, manager, industryTypes.update);
industryTypesRouter.patch('/industry-types/:id/status', authenticate, manager, industryTypes.status);

industryTypesRouter.get('/products/:productId/industry-types', authenticate, readAny, productIndustryTags.list);
industryTypesRouter.put('/products/:productId/industry-types', authenticate, manager, productIndustryTags.set);