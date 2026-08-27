import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { collectionsService } from '../services/collections.service.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { collectionCreateSchema } from '../validation/collections.schemas.js';
const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return value; };
const id = (value: string | string[] | undefined) => { const result = Array.isArray(value) ? value[0] : value; if (!result) throw new AppError(400, 'INVALID_ID', 'A resource id is required'); return result; };
export const collections: Record<string, RequestHandler> = {
  createFromVisit: async (req, res) => { const organizationId = org(req); const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!); res.status(201).json({ data: await collectionsService.createFromVisit(organizationId, rep.id, id(req.params.id), collectionCreateSchema.parse(req.body)) }); },
  mine: async (req, res) => { const organizationId = org(req); const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!); res.json({ data: await collectionsService.list(organizationId, rep.id) }); },
  all: async (req, res) => res.json({ data: await collectionsService.list(org(req)) }),
};
