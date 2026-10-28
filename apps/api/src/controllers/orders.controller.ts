import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { orderService } from '../services/orders.service.js';
import { orderCreateSchema, orderManualCreateSchema, orderCancelSchema, orderUpdateSchema } from '../validation/orders.schemas.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';

const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return value; };
const id = (value: string | string[] | undefined) => { const result = Array.isArray(value) ? value[0] : value; if (!result) throw new AppError(400, 'INVALID_ID', 'A resource id is required'); return result; };
export const orders: Record<string, RequestHandler> = {
  createFromVisit: async (req, res) => { const organizationId = org(req); const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!); res.status(201).json({ data: await orderService.createFromVisit(organizationId, rep.id, id(req.params.id), orderCreateSchema.parse(req.body)) }); },
  createManual: async (req, res) => { res.status(201).json({ data: await orderService.createManual(org(req), req.industryScope!, orderManualCreateSchema.parse(req.body)) }); },
  mine: async (req, res) => { const organizationId = org(req); const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!); res.json({ data: await orderService.list(organizationId, rep.id) }); },
  all: async (req, res) => {
    const requested = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, requested);
    res.json({ data: await orderService.list(org(req), undefined, industryTypeId) });
  },
  cancel: async (req, res) => { const { reason } = orderCancelSchema.parse(req.body); res.json({ data: await orderService.cancel(org(req), req.industryScope!, id(req.params.id), reason) }); },
  approve: async (req, res) => { res.json({ data: await orderService.approve(org(req), req.industryScope!, id(req.params.id)) }); },
  update: async (req, res) => { res.json({ data: await orderService.update(org(req), req.industryScope!, id(req.params.id), orderUpdateSchema.parse(req.body)) }); }
};