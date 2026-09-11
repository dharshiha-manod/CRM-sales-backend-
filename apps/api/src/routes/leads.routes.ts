import { Router } from 'express';
import { leadIndustryAssignments, leads } from '../controllers/leads.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

const manager = requireRoles('super_admin', 'admin', 'sales_manager');
const managerOrRep = requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative');

export const leadsRouter = Router();

// Lead CRUD + pipeline. Reps and managers share these routes; visibility is
// scoped server-side in leadService based on role and industry assignment.
leadsRouter.post('/leads', authenticate, managerOrRep, leads.create);
leadsRouter.get('/leads/duplicates', authenticate, managerOrRep, leads.checkDuplicates);
leadsRouter.get('/leads/follow-ups', authenticate, managerOrRep, leads.followUps);
leadsRouter.get('/leads/suggest-representative', authenticate, managerOrRep, leads.suggestRepresentative);
leadsRouter.get('/leads', authenticate, managerOrRep, leads.list);
leadsRouter.get('/leads/:id', authenticate, managerOrRep, leads.get);
leadsRouter.patch('/leads/:id', authenticate, managerOrRep, leads.update);
leadsRouter.delete('/leads/:id', authenticate, manager, leads.delete);
leadsRouter.patch('/leads/:id/status', authenticate, managerOrRep, leads.changeStatus);
leadsRouter.patch('/leads/:id/next-action', authenticate, managerOrRep, leads.setNextAction);
leadsRouter.post('/leads/:id/assign', authenticate, manager, leads.assign);
leadsRouter.post('/leads/:id/notes', authenticate, managerOrRep, leads.addNote);
leadsRouter.get('/leads/:id/activities', authenticate, managerOrRep, leads.activities);
leadsRouter.post('/leads/:id/convert', authenticate, managerOrRep, leads.convert);

// Representative <-> industry visibility assignment (manager-only).
leadsRouter.get('/sales-representatives/:id/industries', authenticate, manager, leadIndustryAssignments.list);
leadsRouter.post('/sales-representatives/:id/industries', authenticate, manager, leadIndustryAssignments.assign);
leadsRouter.delete('/sales-representatives/:id/industries/:industryTypeId', authenticate, manager, leadIndustryAssignments.unassign);