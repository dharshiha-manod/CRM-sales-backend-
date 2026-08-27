import { Router } from 'express';
import { clients, representatives } from '../controllers/master-data.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
export const masterDataRouter = Router();
// Scope manager authorization to master-data URLs. This router is mounted at
// the API root, so unscoped middleware would also run for unrelated modules.
masterDataRouter.use('/sales-representatives', authenticate, manager);
masterDataRouter.use('/clients', authenticate, manager);
masterDataRouter.get('/sales-representatives', representatives.list);
masterDataRouter.post('/sales-representatives', representatives.create);
masterDataRouter.get('/sales-representatives/:id', representatives.get);
masterDataRouter.patch('/sales-representatives/:id', representatives.update);
masterDataRouter.patch('/sales-representatives/:id/status', representatives.status);
masterDataRouter.get('/sales-representatives/:id/clients', representatives.assignedClients);
masterDataRouter.post('/sales-representatives/:id/clients/:clientId', representatives.assignClient);
masterDataRouter.delete('/sales-representatives/:id/clients/:clientId', representatives.unassignClient);
masterDataRouter.get('/clients', clients.list);
masterDataRouter.post('/clients', clients.create);
masterDataRouter.get('/clients/:id', clients.get);
masterDataRouter.patch('/clients/:id', clients.update);
masterDataRouter.patch('/clients/:id/status', clients.status);
masterDataRouter.get('/clients/:clientId/contacts', clients.contacts);
masterDataRouter.post('/clients/:clientId/contacts', clients.createContact);
masterDataRouter.patch('/clients/:clientId/contacts/:contactId', clients.updateContact);
masterDataRouter.delete('/clients/:clientId/contacts/:contactId', clients.deleteContact);
