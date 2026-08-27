import { Router } from 'express';
import { users } from '../controllers/user-management.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const userManagementRouter = Router();
userManagementRouter.use('/users', authenticate, requireRoles('super_admin', 'admin'));
userManagementRouter.get('/users', users.list);
userManagementRouter.get('/users/roles', users.roles);
userManagementRouter.post('/users', users.create);
userManagementRouter.put('/users/membership', users.saveMembership);
