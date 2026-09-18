import { z } from 'zod';

export const uuid = z.string().uuid();

const optionalText = z.string().trim().min(1).max(500).optional().nullable();
const phone = z
  .string()
  .trim()
  .regex(/^[+()0-9.\-\s]{5,32}$/, 'Invalid phone number')
  .optional()
  .nullable();
const email = z.string().trim().email().max(254).optional().nullable();

export const leadSourceValues = ['referral', 'cold_call', 'walk_in', 'website', 'exhibition', 'social_media', 'ivr', 'other'] as const;
export const leadStatusValues = ['new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost'] as const;
export const leadPriorityValues = ['low', 'normal', 'high', 'critical'] as const;

const leadFieldsSchema = z.object({
  // Optional: if omitted the DB auto-generates a sequential Lead ID (LD-YYMM-00001).
  leadCode: z.string().trim().min(1).max(80).optional(),
  industryTypeId: uuid,
  representativeId: uuid.optional().nullable(),
  companyName: z.string().trim().min(1).max(240),
  contactName: optionalText,
  phone,
  email,
  streetAddress: optionalText,
  city: z.string().trim().max(120).optional().nullable(),
  state: z.string().trim().max(120).optional().nullable(),
  source: z.enum(leadSourceValues).default('other'),
  priority: z.enum(leadPriorityValues).default('normal'),
  notes: z.string().trim().max(10000).optional().nullable(),
  // Lets the lead form set/update the same due-date column the dedicated
  // next-action endpoint writes to, so a date entered here actually shows
  // up as "Next follow-up" in the leads table instead of only living inside
  // the packed notes metadata the frontend keeps for its own bookkeeping.
  nextActionDueAt: z.string().datetime().optional().nullable(),
});

export const leadCreateSchema = leadFieldsSchema.refine((value) => Boolean(value.phone) || Boolean(value.email), {
  message: 'A lead needs a phone number or an email address',
  path: ['phone'],
});

export const leadUpdateSchema = leadFieldsSchema.omit({ leadCode: true }).partial();

export const leadNextActionSchema = z.object({
  nextAction: z.string().trim().min(1).max(500).optional().nullable(),
  nextActionDueAt: z.string().datetime().optional().nullable(),
});

export const leadStatusChangeSchema = z.object({
  status: z.enum(leadStatusValues),
  note: z.string().trim().max(2000).optional().nullable(),
});

export const leadAssignSchema = z.object({
  representativeId: uuid,
});

export const leadNoteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

export const leadConvertSchema = z.object({
  clientCode: z.string().trim().min(1).max(80),
  clientType: z.string().trim().min(1).max(80),
  address: optionalText,
  gpsRadiusMeters: z.number().int().min(10).max(10000).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

export const leadDuplicateCheckSchema = z.object({
  phone: phone,
  email: email,
  companyName: z.string().trim().min(1).max(240).optional(),
});

export const repIndustryAssignSchema = z.object({
  industryTypeId: uuid,
});
