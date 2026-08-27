import { z } from 'zod';

export const collectionCreateSchema = z.object({
  amount: z.number().finite().positive(),
  mode: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'other']),
  referenceNo: z.string().trim().max(160).optional().nullable(),
  saleOrderId: z.string().uuid(),
  notes: z.string().trim().max(10000).optional().nullable(),
});
