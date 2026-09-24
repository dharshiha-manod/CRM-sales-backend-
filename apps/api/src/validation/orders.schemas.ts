import { z } from 'zod';

const orderItems = z.array(z.object({ productId: z.string().uuid(), quantity: z.number().finite().positive(), discountPercent: z.number().finite().min(0).max(100).default(0) })).min(1);

export const orderCreateSchema = z.object({
  items: orderItems,
  notes: z.string().trim().max(10000).optional().nullable()
});

// Manager/admin-created order (no field visit). Matches the body OrdersPage posts.
export const orderManualCreateSchema = z.object({
  clientId: z.string().uuid().optional().nullable(),
  clientName: z.string().trim().max(240).optional().nullable(),
  representativeId: z.string().uuid(),
  items: orderItems,
  notes: z.string().trim().max(10000).optional().nullable()
});

export const orderCancelSchema = z.object({ reason: z.string().trim().max(500).optional().nullable() });
export const orderUpdateSchema = z.object({
  items: orderItems.optional(),
  notes: z.string().trim().max(10000).optional().nullable()
}).refine((data) => data.items !== undefined || data.notes !== undefined, { message: 'Provide items and/or notes to update.' });