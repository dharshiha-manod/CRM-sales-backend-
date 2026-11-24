import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { registerPushToken, sendPushToRep } from '../services/push.service.js';

const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return value; };
const tokenSchema = z.object({ token: z.string().min(10).max(300), platform: z.string().max(20).optional().nullable() });
const sendSchema = z.object({ representativeId: z.string().uuid(), title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500) });

export const push: Record<string, RequestHandler> = {
  register: async (req, res) => {
    const organizationId = org(req);
    const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!);
    const { token, platform } = tokenSchema.parse(req.body);
    await registerPushToken(organizationId, rep.id as string, token, platform);
    res.status(201).json({ data: { registered: true } });
  },
  send: async (req, res) => {
    const { representativeId, title, body } = sendSchema.parse(req.body);
    const sent = await sendPushToRep(org(req), representativeId, title, body);
    res.json({ data: { sent } });
  },
};