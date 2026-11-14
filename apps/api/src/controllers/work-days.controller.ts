import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { addWorkDayPings, endWorkDay, getActiveWorkDay, getWorkDayRoute, listWorkDayOverview, startWorkDay } from '../repositories/work-days.repository.js';
import { workDayEndSchema, workDayPingsSchema, workDayStartSchema } from '../validation/work-days.schemas.js';

async function context(req: Parameters<RequestHandler>[0]) {
  const organizationId = req.header('x-organization-id');
  if (!organizationId) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  const representative = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!);
  return { organizationId, representativeId: representative.id as string };
}

function organizationOnly(req: Parameters<RequestHandler>[0]) {
  const organizationId = req.header('x-organization-id');
  if (!organizationId) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return organizationId;
}

export const workDays: Record<string, RequestHandler> = {
  // Admin / manager: every rep's work day for one date (default today).
  overview: async (req, res) => {
    const organizationId = organizationOnly(req);
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(req.query.date);
    res.json({ data: await listWorkDayOverview(organizationId, date) });
  },
  // Admin / manager: the full route (GPS points + visits) of one work day.
  route: async (req, res) => {
    const organizationId = organizationOnly(req);
    const workDayId = z.string().uuid().parse(req.params.id);
    res.json({ data: await getWorkDayRoute(organizationId, workDayId) });
  },
  today: async (req, res) => {
    const { organizationId, representativeId } = await context(req);
    res.json({ data: { active: await getActiveWorkDay(organizationId, representativeId) } });
  },
  start: async (req, res) => {
    const { organizationId, representativeId } = await context(req);
    const { location } = workDayStartSchema.parse(req.body);
    res.status(201).json({ data: await startWorkDay(organizationId, representativeId, location) });
  },
  end: async (req, res) => {
    const { organizationId, representativeId } = await context(req);
    const { location } = workDayEndSchema.parse(req.body ?? {});
    res.json({ data: await endWorkDay(organizationId, representativeId, location) });
  },
  pings: async (req, res) => {
    const { organizationId, representativeId } = await context(req);
    const workDayId = z.string().uuid().parse(req.params.id);
    const { points } = workDayPingsSchema.parse(req.body);
    res.status(201).json({ data: await addWorkDayPings(organizationId, representativeId, workDayId, points) });
  },
};