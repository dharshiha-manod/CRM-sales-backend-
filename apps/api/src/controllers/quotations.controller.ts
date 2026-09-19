import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { quotationService } from '../services/quotations.service.js';
import { publicQuotationDecisionSchema, quotationCreateSchema, quotationDenySchema, quotationUpdateSchema } from '../validation/quotations.schemas.js';
import { env } from '../config/env.js';
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
    const data = await quotationService.update(organizationId, representativeId, req.auth!.sub!, id(req.params.id), quotationUpdateSchema.parse(req.body), req.industryScope!);
    res.json({ data });
  },
  send: async (req, res) => {
    // Never derive a customer-facing URL from CORS origins or the current
    // browser. This URL is part of the email and must be publicly reachable.
    if (!env.PUBLIC_APP_URL) throw new AppError(503, 'PUBLIC_APP_URL_REQUIRED', 'PUBLIC_APP_URL must be configured before a quotation can be sent to a client.');
    const publicAppUrl = env.PUBLIC_APP_URL.replace(/\/$/, '');
    const data = await quotationService.send(org(req), req.organizationRole === 'sales_representative'
      ? (await fieldActivityService.currentRepresentative(org(req), req.auth!.sub!)).id : null, id(req.params.id), publicAppUrl, req.industryScope!);
    res.json({ data, publicLink: `${publicAppUrl}/quote/${data.public_token}` });
  },
  publicGet: async (req, res) => res.json({ data: await quotationService.publicGet(id(req.params.token)) }),
  publicDecision: async (req, res) => {
    const data = await quotationService.publicDecision(id(req.params.token), publicQuotationDecisionSchema.parse(req.body));
    res.json({ data });
  },
  approve: async (req, res) => {
    const data = await quotationService.approve(org(req), req.auth!.sub!, id(req.params.id), req.industryScope!);
    res.status(201).json({ data });
  },
  deny: async (req, res) => {
    const data = await quotationService.deny(org(req), req.auth!.sub!, id(req.params.id), quotationDenySchema.parse(req.body).reason, req.industryScope!);
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
