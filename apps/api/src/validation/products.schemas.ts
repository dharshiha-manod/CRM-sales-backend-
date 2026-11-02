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
  /** Reorder level: at or below this many units the product shows up in FMCG low-stock alerts. */   // <-- NEW
  minStockLevel: z.number().nonnegative().optional().nullable(),                                       // <-- NEW
  /** Textile only: fabric type, width, GSM, length per roll and the colour list. Stored as one JSON column. */
  textileDetails: z.object({
    fabricType: z.string().trim().max(80).optional().nullable(),
    composition: z.string().trim().max(160).optional().nullable(),
    width: z.number().nonnegative().max(100000).optional().nullable(),
    widthUnit: z.enum(['in', 'cm']).optional().nullable(),
    gsm: z.number().nonnegative().max(100000).optional().nullable(),
    lengthPerRoll: z.number().nonnegative().max(1000000).optional().nullable(),
    lengthUnit: z.enum(['m', 'yd']).optional().nullable(),
    pattern: z.string().trim().max(120).optional().nullable(),
    designCode: z.string().trim().max(80).optional().nullable(),
    sizes: z.array(z.string().trim().min(1).max(30)).max(30).optional(),
    imageUrl: z.string().trim().url().max(600).optional().nullable(),
    colors: z.array(z.object({
      name: z.string().trim().min(1).max(80),
      code: z.string().trim().max(40).optional().nullable(),
      quantity: z.number().nonnegative().max(100000000).optional().nullable(),
    })).max(100).optional(),
  }).optional().nullable(),
  /** Pharma only: medicine fields (generic name, composition, schedule...). Stored as one JSON column. */
  pharmaDetails: z.object({
    genericName: z.string().trim().max(160).optional().nullable(),
    composition: z.string().trim().max(300).optional().nullable(),
    strength: z.string().trim().max(60).optional().nullable(),
    dosageForm: z.string().trim().max(60).optional().nullable(),
    manufacturer: z.string().trim().max(160).optional().nullable(),
    drugCategory: z.enum(['OTC', 'Prescription', 'Narcotic / Psychotropic']).optional().nullable(),
    drugSchedule: z.string().trim().max(30).optional().nullable(),
    storageCondition: z.string().trim().max(120).optional().nullable(),
    coldChain: z.boolean().optional().nullable(),
  }).optional().nullable(),
  industryTypeIds: z.array(z.string().uuid()).max(50).optional(),
});
export const productUpdateSchema = productCreateSchema.partial();
// Stock is changed by an amount (+ added / - removed), never by sending a final total, so two people
// changing stock at the same time cannot overwrite each other.
export const productStockChangeSchema = z.object({
  delta: z.number().finite().refine((n) => n !== 0, 'Quantity change cannot be zero.'),
  allowNegative: z.boolean().optional().default(false),
});
// Textile product picture, sent as a small data URL (the admin shrinks it first) and stored in Supabase Storage.
export const productImageSchema = z.object({ dataUrl: z.string().max(1_400_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Upload a JPG, PNG or WebP image.') });
