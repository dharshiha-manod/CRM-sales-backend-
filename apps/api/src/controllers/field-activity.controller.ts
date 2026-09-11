import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { checkInSchema, checkOutSchema, nearbyClientSchema, pingSchema, visitActivityCreateSchema } from '../validation/field-activity.schemas.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';

const organization = (req: Parameters<RequestHandler>[0]) => {
  const value = req.header('x-organization-id');
  if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return value;
};
const param = (value: string | string[] | undefined) => {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result) throw new AppError(400, 'INVALID_ID', 'A resource id is required');
  return result;
};

export const fieldActivity: Record<string, RequestHandler> = {
  myClients: async (req, res) => {
    const org = organization(req);
    const rep = await fieldActivityService.currentRepresentative(org, req.auth!.sub!);
    res.json({ data: await fieldActivityService.assignedClients(org, rep.id) });
  },
  nearby: async (req, res) => {
    const org = organization(req);
    const rep = await fieldActivityService.currentRepresentative(org, req.auth!.sub!);
    const query = nearbyClientSchema.parse(req.query);
    res.json({ data: await fieldActivityService.nearbyAssignedClients(org, rep.id, query.latitude, query.longitude, query.radiusMeters) });
  },
  checkIn: async (req, res) => {
    const org = organization(req);
    const rep = await fieldActivityService.currentRepresentative(org, req.auth!.sub!);
    res.status(201).json({ data: await fieldActivityService.checkIn(org, rep.id, checkInSchema.parse(req.body)) });
  },
  ping: async (req, res) => {
    const org = organization(req);
    const rep = await fieldActivityService.currentRepresentative(org, req.auth!.sub!);
    res.status(201).json({ data: await fieldActivityService.addPing(org, rep.id, param(req.params.id), pingSchema.parse(req.body)) });
  },
  checkOut: async (req, res) => {
    const org = organization(req);
    const rep = await fieldActivityService.currentRepresentative(org, req.auth!.sub!);
    res.json({ data: await fieldActivityService.checkOut(org, rep.id, param(req.params.id), checkOutSchema.parse(req.body)) });
  },
  activities: async (req, res) => {
    const org = organization(req);
    const rep = await fieldActivityService.currentRepresentative(org, req.auth!.sub!);
    res.json({ data: await fieldActivityService.listVisitActivities(org, param(req.params.id), rep.id) });
  },
  addActivity: async (req, res) => {
    const org = organization(req);
    const rep = await fieldActivityService.currentRepresentative(org, req.auth!.sub!);
    res.status(201).json({ data: await fieldActivityService.createVisitActivity(org, rep.id, param(req.params.id), visitActivityCreateSchema.parse(req.body)) });
  },
  allActivities: async (req, res) => res.json({ data: await fieldActivityService.listVisitActivities(organization(req), param(req.params.id), undefined, req.industryScope!) }),
  mine: async (req, res) => {
    const org = organization(req);
    const rep = await fieldActivityService.currentRepresentative(org, req.auth!.sub!);
    res.json({ data: await fieldActivityService.listVisits(org, rep.id) });
  },
  all: async (req, res) => {
    const requested = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, requested);
    res.json({ data: await fieldActivityService.listVisits(organization(req), undefined, industryTypeId) });
  },
  live: async (req, res) => {
    const requested = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, requested);
    res.json({ data: await fieldActivityService.liveVisits(organization(req), industryTypeId) });
  }
};