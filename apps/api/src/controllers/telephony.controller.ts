// NEW
import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { listCalls, getCallById, addCallNote, linkCallToLead } from '../repositories/telephony.repository.js';
import { getTelephonySettings, upsertTelephonySettings } from '../repositories/telephony-settings.repository.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { telephonyService } from '../services/telephony.service.js';
import { initiateCallSchema, addCallNoteSchema, linkCallToLeadSchema, telephonySettingsSchema } from '../validation/telephony.schemas.js';

const organizationId = (req: Parameters<RequestHandler>[0]) => {
  const id = req.header('x-organization-id');
  if (!id) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return id;
};

// Same convention already used in leads.controller.ts, applied to the new
// :id-based routes below.
const id = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) throw new AppError(400, 'VALIDATION_ERROR', 'A call id is required.');
  return raw;
};

export const telephony: Record<string, RequestHandler> = {
  list: async (req, res) => {
    const requested = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, requested);
    res.json({ data: await listCalls(organizationId(req), industryTypeId) });
  },

  // --- everything below is NEW ---

  get: async (req, res) => {
    const call = await getCallById(organizationId(req), id(req.params.id));
    if (!call) throw new AppError(404, 'CALL_NOT_FOUND', 'Call was not found.');
    res.json({ data: call });
  },

  addNote: async (req, res) => {
    const input = addCallNoteSchema.parse(req.body);
    const call = await addCallNote(organizationId(req), id(req.params.id), input.notes, input.outcome);
    if (!call) throw new AppError(404, 'CALL_NOT_FOUND', 'Call was not found.');
    res.json({ data: call });
  },

  linkLead: async (req, res) => {
    const input = linkCallToLeadSchema.parse(req.body);
    const call = await linkCallToLead(organizationId(req), id(req.params.id), input.leadId);
    if (!call) throw new AppError(404, 'CALL_NOT_FOUND', 'Call was not found.');
    res.json({ data: call });
  },

  initiateCall: async (req, res) => {
    const input = initiateCallSchema.parse(req.body);
    const call = await telephonyService.initiateCall(organizationId(req), { toNumber: input.toNumber, representativeId: input.representativeId });
    res.status(201).json({ data: call });
  },

  getSettings: async (req, res) => {
    const settings = await getTelephonySettings(organizationId(req));
    res.json({ data: settings, isConfigured: telephonyService.isConfigured() });
  },

  updateSettings: async (req, res) => {
    const input = telephonySettingsSchema.parse(req.body);
    const settings = await upsertTelephonySettings(organizationId(req), {
      is_enabled: input.isEnabled,
      default_industry_type_id: input.defaultIndustryTypeId,
      default_representative_id: input.defaultRepresentativeId,
      ivr_menu_industry_map: input.ivrMenuIndustryMap,
      auto_create_lead: input.autoCreateLead,
    });
    res.json({ data: settings });
  },
};
