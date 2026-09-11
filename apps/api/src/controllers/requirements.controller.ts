import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { requirementService } from '../services/requirements.service.js';
import { requirementCreateSchema, requirementUpdateSchema } from '../validation/requirements.schemas.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';

const org = (req: Parameters<RequestHandler>[0]) => {
  const value = req.header('x-organization-id');
  if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return value;
};
const id = (value: string | string[] | undefined) => {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result) throw new AppError(400, 'INVALID_ID', 'A resource id is required');
  return result;
};
export const requirements: Record<string, RequestHandler> = {
  create: async (req, res) => {
    const organizationId = org(req);
    const bodyRepresentativeId = typeof req.body?.representativeId === 'string' ? req.body.representativeId : undefined;
    const representativeId = bodyRepresentativeId ?? (await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!)).id;
    const data = await requirementService.create(organizationId, representativeId, requirementCreateSchema.parse(req.body));
    res.status(201).json({ data });
  },
  mine: async (req, res) => {
    const organizationId = org(req);
    const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json({ data: await requirementService.list(organizationId, { representativeId: rep.id, status }) });
  },
  all: async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
    const requested = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, requested);
    res.json({ data: await requirementService.list(org(req), { status, clientId, industryTypeId: industryTypeId ?? undefined }) });
  },
  get: async (req, res) => res.json({ data: await requirementService.get(org(req), id(req.params.id), req.industryScope!) }),
  update: async (req, res) =>
    res.json({ data: await requirementService.update(org(req), id(req.params.id), requirementUpdateSchema.parse(req.body), req.industryScope!) }),
};