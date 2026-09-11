import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { leadService } from '../services/leads.service.js';
import { leadAssignSchema, leadConvertSchema, leadCreateSchema, leadNextActionSchema, leadNoteSchema, leadStatusChangeSchema, leadUpdateSchema, repIndustryAssignSchema, uuid } from '../validation/leads.schemas.js';

const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return value; };
const id = (value: string | string[] | undefined) => uuid.parse(Array.isArray(value) ? value[0] : value);
const scope = (req: Parameters<RequestHandler>[0]) => { if (!req.industryScope) throw new AppError(500, 'INDUSTRY_SCOPE_MISSING', 'Industry scope was not resolved for this request.'); return req.industryScope; };

async function representativeIdIfRep(req: Parameters<RequestHandler>[0], organizationId: string): Promise<string | undefined> {
  if (req.organizationRole !== 'sales_representative') return undefined;
  return (await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!)).id;
}

export const leads: Record<string, RequestHandler> = {
  create: async (req, res) => {
    const organizationId = org(req);
    const repId = await representativeIdIfRep(req, organizationId);
    const data = await leadService.create(organizationId, req.auth!.sub!, leadCreateSchema.parse(req.body), scope(req), repId);
    res.status(201).json({ data });
  },
  list: async (req, res) => {
    const organizationId = org(req);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const industryTypeId = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const repId = await representativeIdIfRep(req, organizationId);
    const data = repId
      ? await leadService.listForRepresentative(organizationId, repId, { status, industryTypeId, search })
      : await leadService.listForManager(organizationId, { status, industryTypeId, search, representativeId: typeof req.query.representativeId === 'string' ? req.query.representativeId : undefined }, scope(req));
    res.json({ data });
  },
  get: async (req, res) => {
    const organizationId = org(req);
    const repId = await representativeIdIfRep(req, organizationId);
    res.json({ data: await leadService.get(organizationId, id(req.params.id), scope(req), repId) });
  },
  update: async (req, res) => {
    const organizationId = org(req);
    const repId = await representativeIdIfRep(req, organizationId);
    res.json({ data: await leadService.update(organizationId, id(req.params.id), leadUpdateSchema.parse(req.body), scope(req), repId) });
  },
  delete: async (req, res) => {
    const organizationId = org(req);
    await leadService.delete(organizationId, id(req.params.id), scope(req));
    res.status(204).send();
  },
  changeStatus: async (req, res) => {
    const organizationId = org(req);
    const repId = await representativeIdIfRep(req, organizationId);
    const body = leadStatusChangeSchema.parse(req.body);
    res.json({ data: await leadService.changeStatus(organizationId, id(req.params.id), req.auth!.sub!, body.status, body.note, scope(req), repId) });
  },
  assign: async (req, res) => {
    const organizationId = org(req);
    const body = leadAssignSchema.parse(req.body);
    res.json({ data: await leadService.assign(organizationId, id(req.params.id), req.auth!.sub!, body.representativeId, scope(req)) });
  },
  addNote: async (req, res) => {
    const organizationId = org(req);
    const repId = await representativeIdIfRep(req, organizationId);
    const body = leadNoteSchema.parse(req.body);
    res.status(201).json({ data: await leadService.addNote(organizationId, id(req.params.id), req.auth!.sub!, body.note, scope(req), repId) });
  },
  activities: async (req, res) => {
    const organizationId = org(req);
    const repId = await representativeIdIfRep(req, organizationId);
    res.json({ data: await leadService.activities(organizationId, id(req.params.id), scope(req), repId) });
  },
  convert: async (req, res) => {
    const organizationId = org(req);
    const repId = await representativeIdIfRep(req, organizationId);
    const data = await leadService.convert(organizationId, id(req.params.id), req.auth!.sub!, leadConvertSchema.parse(req.body), scope(req), repId);
    res.status(201).json({ data });
  },
  checkDuplicates: async (req, res) => {
    const organizationId = org(req);
    const phone = typeof req.query.phone === 'string' ? req.query.phone : undefined;
    const email = typeof req.query.email === 'string' ? req.query.email : undefined;
    const companyName = typeof req.query.companyName === 'string' ? req.query.companyName : undefined;
    res.json({ data: await leadService.checkDuplicates(organizationId, { phone, email, companyName }) });
  },
  setNextAction: async (req, res) => {
    const organizationId = org(req);
    const repId = await representativeIdIfRep(req, organizationId);
    const body = leadNextActionSchema.parse(req.body);
    res.json({ data: await leadService.setNextAction(organizationId, id(req.params.id), req.auth!.sub!, body.nextAction ?? null, body.nextActionDueAt ?? null, scope(req), repId) });
  },
  followUps: async (req, res) => {
    const organizationId = org(req);
    const repId = await representativeIdIfRep(req, organizationId);
    const overdueOnly = req.query.overdueOnly === 'true';
    const representativeId = repId ?? (typeof req.query.representativeId === 'string' ? req.query.representativeId : undefined);
    res.json({ data: await leadService.listFollowUps(organizationId, representativeId, overdueOnly) });
  },
  suggestRepresentative: async (req, res) => {
    const organizationId = org(req);
    const industryTypeId = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    if (!industryTypeId) throw new AppError(400, 'INDUSTRY_TYPE_REQUIRED', 'industryTypeId query parameter is required');
    res.json({ data: await leadService.suggestRepresentative(organizationId, industryTypeId, scope(req)) });
  },
};

export const leadIndustryAssignments: Record<string, RequestHandler> = {
  list: async (req, res) => res.json({ data: await leadService.industryAssignments.list(org(req), id(req.params.id)) }),
  assign: async (req, res) => {
    const body = repIndustryAssignSchema.parse(req.body);
    res.status(201).json({ data: await leadService.industryAssignments.assign(org(req), id(req.params.id), body.industryTypeId, scope(req)) });
  },
  unassign: async (req, res) => {
    await leadService.industryAssignments.unassign(org(req), id(req.params.id), id(req.params.industryTypeId), scope(req));
    res.status(204).send();
  },
};