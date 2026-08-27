import { Router } from 'express';
import { me } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
export const authRouter = Router();
authRouter.get('/me', authenticate, me);
