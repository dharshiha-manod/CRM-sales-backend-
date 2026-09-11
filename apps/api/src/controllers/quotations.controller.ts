import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { quotationService } from '../services/quotations.service.js';
import { quotationCreateSchema, quotationUpdateSchema } from '../validation/quotations.schemas.js';
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

export const quotations: Record<string, RequestHandler> = {
  createFromRequirement: async (req, res) => {
    const organizationId = org(req);
    const input = quotationCreateSchema.parse(req.body);
    const representativeId =
      input.representativeId ?? (await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!)).id;
    const data = await quotationService.createFromRequirement(organizationId, representativeId, id(req.params.id), input);
    res.status(201).json({ data });
  },
  mine: async (req, res) => {
    const organizationId = org(req);
    const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json({ data: await quotationService.list(organizationId, { representativeId: rep.id, status }) });
  },
  all: async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
    const requested = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, requested);
    res.json({ data: await quotationService.list(org(req), { status, clientId, industryTypeId: industryTypeId ?? undefined }) });
  },
  get: async (req, res) => res.json({ data: await quotationService.get(org(req), id(req.params.id), req.industryScope!) }),
    update: async (req, res) => {
    const organizationId = org(req);
    const representativeId = req.organizationRole === 'sales_representative'
      ? (await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!)).id
      : null;
    const data = await quotationService.update(organizationId, representativeId, id(req.params.id), quotationUpdateSchema.parse(req.body), req.industryScope!);
    res.json({ data });
  },
  convertToOrder: async (req, res) => {
    const organizationId = org(req);
    const representativeId = req.organizationRole === 'sales_representative'
      ? (await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!)).id
      : null;
    const data = await quotationService.convertToOrder(organizationId, representativeId, id(req.params.id), req.industryScope!);
    res.status(201).json({ data });
  },
};