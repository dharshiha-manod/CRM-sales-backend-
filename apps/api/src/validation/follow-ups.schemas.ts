import { z } from 'zod';
export const followUpCreateSchema = z.object({ title: z.string().trim().min(2).max(300), dueAt: z.string().datetime(), priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'), notes: z.string().trim().max(10000).optional().nullable() });
export const followUpUpdateSchema = z.object({ status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']), notes: z.string().trim().max(10000).optional().nullable() });
