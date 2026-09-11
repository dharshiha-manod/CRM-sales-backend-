// NEW
import { z } from 'zod';

const phone = z.string().trim().regex(/^[+()0-9.\-\s]{5,32}$/, 'Invalid phone number');

export const initiateCallSchema = z.object({
  toNumber: phone,
  representativeId: z.string().uuid().optional().nullable(),
  leadId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
});

export const addCallNoteSchema = z.object({
  notes: z.string().trim().min(1).max(2000),
  outcome: z.string().trim().max(120).optional(),
});

export const linkCallToLeadSchema = z.object({
  leadId: z.string().uuid(),
});

export const telephonySettingsSchema = z.object({
  isEnabled: z.boolean().optional(),
  defaultIndustryTypeId: z.string().uuid().optional().nullable(),
  defaultRepresentativeId: z.string().uuid().optional().nullable(),
  ivrMenuIndustryMap: z.record(z.string(), z.string().uuid()).optional(),
  autoCreateLead: z.boolean().optional(),
});
