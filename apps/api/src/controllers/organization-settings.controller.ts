import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { organizationSettingsService } from '../services/organization-settings.service.js';
import { organizationSettingsSaveSchema } from '../validation/organization-settings.schemas.js';

const organizationId = (req: Parameters<RequestHandler>[0]) => {
  const value = req.header('x-organization-id');
  if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return value;
};

export const organizationSettings: Record<string, RequestHandler> = {
  get: async (req, res) => res.json({ data: await organizationSettingsService.get(organizationId(req)) }),
  save: async (req, res) => {
    const input = organizationSettingsSaveSchema.parse(req.body);
    res.json({ data: await organizationSettingsService.save(organizationId(req), req.auth!.sub!, input.settings) });
  },
};
