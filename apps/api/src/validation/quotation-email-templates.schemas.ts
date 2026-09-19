import { z } from 'zod';

export const quotationEmailTemplateSchema = z.object({
  industryTypeId: z.string().uuid(),
  logoUrl: z.string().url().nullable().optional(),
  subject: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(30_000),
  footer: z.string().trim().max(10_000).nullable().optional(),
});
