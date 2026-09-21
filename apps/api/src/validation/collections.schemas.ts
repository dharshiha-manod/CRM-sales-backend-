import { z } from 'zod';

export const collectionCreateSchema = z.object({
  amount: z.number().finite().positive(),
  mode: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'other']),
  referenceNo: z.string().trim().max(160).optional().nullable(),
  saleOrderId: z.string().uuid(),
  notes: z.string().trim().max(10000).optional().nullable(),
});

// Payments entered from the Sales Orders / Collections screens are attached
// directly to an existing order, so they do not require an active field visit.
export const orderCollectionCreateSchema = z.object({
  orderId: z.string().uuid(),
  amount: z.number().finite().positive(),
  mode: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'other']),
  referenceNo: z.string().trim().max(160).optional().nullable(),
  notes: z.string().trim().max(10000).optional().nullable(),
});
