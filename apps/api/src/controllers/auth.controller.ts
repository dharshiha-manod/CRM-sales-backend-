import type { RequestHandler } from 'express';
import { getCurrentUser } from '../services/user.service.js';
export const me: RequestHandler = async (req, res) => { res.json({ data: await getCurrentUser(req.auth!.sub!) }); };
