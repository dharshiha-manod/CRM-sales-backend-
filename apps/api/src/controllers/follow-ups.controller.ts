import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { followUpService } from '../services/follow-ups.service.js';
import { followUpCreateSchema } from '../validation/follow-ups.schemas.js';
import { followUpUpdateSchema } from '../validation/follow-ups.schemas.js';
import { followUpManualCreateSchema } from '../validation/follow-ups.schemas.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return value; }; const id = (value: string | string[] | undefined) => { const result = Array.isArray(value) ? value[0] : value; if (!result) throw new AppError(400, 'INVALID_ID', 'A resource id is required'); return result; };
export const followUps: Record<string, RequestHandler> = {
  createFromVisit: async (req, res) => { const organizationId = org(req); const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!); res.status(201).json({ data: await followUpService.createFromVisit(organizationId, rep.id, id(req.params.id), followUpCreateSchema.parse(req.body)) }); },
  createManual: async (req, res) => { const organizationId = org(req); res.status(201).json({ data: await followUpService.createManual(organizationId, followUpManualCreateSchema.parse(req.body)) }); },
  mine: async (req, res) => { const organizationId = org(req); const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!); res.json({ data: await followUpService.list(organizationId, rep.id) }); },
  all: async (req, res) => {
    const requested = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, requested);
    res.json({ data: await followUpService.list(org(req), undefined, industryTypeId) });
  },
  update: async (req, res) => res.json({ data: await followUpService.update(org(req), id(req.params.id), followUpUpdateSchema.parse(req.body), req.industryScope!) })
};