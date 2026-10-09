import { z } from 'zod';
export const productCreateSchema = z.object({
  productCode: z.string().trim().min(1).max(80),
  productName: z.string().trim().min(1).max(240),
  category: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  sellingPrice: z.number().nonnegative(),
  costPrice: z.number().nonnegative().optional().nullable(),
  stockQuantity: z.number().nonnegative().optional().nullable(),
  status: z.enum(['active', 'inactive']).default('active'),
  unit: z.string().trim().max(40).optional().nullable(),
  taxPercent: z.number().min(0).max(100).optional().nullable(),
  hsnCode: z.string().trim().max(20).optional().nullable(),
  specification: z.string().trim().max(500).optional().nullable(),
  originCountry: z.string().trim().max(80).optional().nullable(),
  supplierName: z.string().trim().max(240).optional().nullable(),
  currency: z.string().trim().max(10).optional().nullable(),
  mrp: z.number().nonnegative().optional().nullable(),
  discountPercent: z.number().min(0).max(100).optional().nullable(),
  /** Days from manufacture to expiry. Lets Batch & Expiry work out an expiry date by itself. */
  shelfLifeDays: z.number().int().positive().max(36500).optional().nullable(),
  industryTypeIds: z.array(z.string().uuid()).max(50).optional(),
});
export const productUpdateSchema = productCreateSchema.partial();
// Stock is changed by an amount (+ added / - removed), never by sending a final total, so two people
// changing stock at the same time cannot overwrite each other.
export const productStockChangeSchema = z.object({
  delta: z.number().finite().refine((n) => n !== 0, 'Quantity change cannot be zero.'),
  allowNegative: z.boolean().optional().default(false),
});