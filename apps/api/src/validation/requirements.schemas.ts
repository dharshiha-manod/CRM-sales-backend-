import { z } from 'zod';

const requirementItemSchema = z
  .object({
    productId: z.string().uuid().optional().nullable(),
    freeTextItem: z.string().trim().min(1).max(300).optional().nullable(),
    quantity: z.number().positive().default(1),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((item) => Boolean(item.productId) || Boolean(item.freeTextItem), {
    message: 'Each requirement item needs a productId or a freeTextItem',
  });

export const requirementCreateSchema = z.object({
  clientId: z.string().uuid(),
  visitId: z.string().uuid().optional().nullable(),
  representativeId: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(300),
  description: z.string().trim().max(10000).optional().nullable(),
  urgency: z.enum(['low', 'normal', 'high']).default('normal'),
  targetDate: z.string().date().optional().nullable(),
  items: z.array(requirementItemSchema).min(1).max(100),
});

export const requirementUpdateSchema = z.object({
  status: z.enum(['open', 'quoted', 'converted', 'dropped']),
  description: z.string().trim().max(10000).optional().nullable(),
});