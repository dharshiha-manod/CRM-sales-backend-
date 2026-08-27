import { z } from 'zod';

export const orderCreateSchema = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().finite().positive(), discountPercent: z.number().finite().min(0).max(100).default(0) })).min(1),
  notes: z.string().trim().max(10000).optional().nullable()
});
