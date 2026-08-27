import { Router } from 'express';
import { products } from '../controllers/products.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
export const productsRouter = Router();
productsRouter.get('/products', authenticate, requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative'), products.list);
productsRouter.post('/products', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), products.create);
productsRouter.patch('/products/:id', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), products.update);
