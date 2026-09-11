import { Router } from 'express';
import { trading } from '../controllers/trading.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { TRADING_RESOURCES } from '../lib/trading-resources.js';

export const tradingRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');

for (const resource of TRADING_RESOURCES) {
  const base = `/trading/${resource.path}`;
  tradingRouter.get(base, authenticate, manager, trading.list(resource));
  tradingRouter.post(base, authenticate, manager, trading.create(resource));
  tradingRouter.get(`${base}/:id`, authenticate, manager, trading.get(resource));
  tradingRouter.patch(`${base}/:id`, authenticate, manager, trading.update(resource));
  tradingRouter.delete(`${base}/:id`, authenticate, manager, trading.remove(resource));
}
