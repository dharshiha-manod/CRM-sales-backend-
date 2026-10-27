import { z } from 'zod';

export const quotationCreateSchema = z.object({
  representativeId: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().finite().positive(),
        discountPercent: z.number().finite().min(0).max(100).default(0),
        colour: z.string().trim().max(80).optional().nullable(), // Textile only
      }),
    )
    .min(1),
  validUntil: z.string().date().optional().nullable(),
  notes: z.string().trim().max(10000).optional().nullable(),
});

export const quotationUpdateSchema = z.object({
  status: z.literal('rejected'),
  notes: z.string().trim().max(10000).optional().nullable(),
});

export const publicQuotationDecisionSchema = z.object({
  decision: z.enum(['accepted', 'rejected']),
  reason: z.string().trim().max(2_000).optional(),
  // Optional: quantities the client changed on the public page (accept only). Omitted = no change, same as before.
  items: z.array(z.object({ id: z.string().uuid(), quantity: z.number().int().min(1).max(1_000_000) })).max(200).optional(),
});

export const quotationDenySchema = z.object({
  reason: z.string().trim().min(1).max(2_000),
});

// Textile only: pick the colour of one line of a draft quotation.
export const quotationItemColourSchema = z.object({ colour: z.string().trim().min(1).max(80) });