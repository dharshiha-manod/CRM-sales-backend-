import { z } from 'zod';

export const uuid = z.string().uuid();

export const industryTypeCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(['active', 'inactive']).default('active')
});

export const industryTypeUpdateSchema = industryTypeCreateSchema.partial();

export const industryTypeStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });