import { Router } from 'express';
import { quotations } from '../controllers/quotations.controller.js';

export const publicQuotationsRouter = Router();

publicQuotationsRouter.get('/quotations/:token', quotations.publicGet);
publicQuotationsRouter.post('/quotations/:token/decision', quotations.publicDecision);
