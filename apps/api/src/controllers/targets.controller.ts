import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { targetsService } from '../services/targets.service.js';
import { targetAdjustSchema, targetCreateSchema, targetLifecycleSchema, targetUpdateSchema } from '../validation/targets.schemas.js';

const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return value; };
const id = (value: string | string[] | undefined) => { const result = Array.isArray(value) ? value[0] : value; if (!result) throw new AppError(400, 'INVALID_ID', 'A resource id is required'); return result; };
const scope = (req: Parameters<RequestHandler>[0]) => { if (!req.industryScope) throw new AppError(500, 'INDUSTRY_SCOPE_MISSING', 'Industry scope was not resolved for this request.'); return req.industryScope; };
const qs = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

export const targets: Record<string, RequestHandler> = {
  list: async (req, res) => {
    const filters = {
      industryTypeId: qs(req.query.industryTypeId),
      representativeId: qs(req.query.representativeId),
      targetType: qs(req.query.targetType),
      periodStart: qs(req.query.periodStart),
      periodEnd: qs(req.query.periodEnd),
      includeArchived: req.query.includeArchived === 'true',
    };
    res.json({ data: await targetsService.list(org(req), filters, scope(req)) });
  },
  get: async (req, res) => res.json({ data: await targetsService.get(org(req), id(req.params.id), scope(req)) }),
  create: async (req, res) => res.status(201).json({ data: await targetsService.create(org(req), req.auth!.sub!, targetCreateSchema.parse(req.body)) }),
  update: async (req, res) => res.json({ data: await targetsService.update(org(req), id(req.params.id), scope(req), targetUpdateSchema.parse(req.body)) }),
  setLifecycle: async (req, res) => res.json({ data: await targetsService.setLifecycle(org(req), id(req.params.id), scope(req), targetLifecycleSchema.parse(req.body).lifecycle) }),
  adjust: async (req, res) => res.json({ data: await targetsService.adjust(org(req), id(req.params.id), scope(req), req.auth!.sub!, targetAdjustSchema.parse(req.body)) }),
  remove: async (req, res) => { await targetsService.remove(org(req), id(req.params.id), scope(req)); res.status(204).send(); },
};