import { z } from 'zod';

export const TARGET_TYPES = [
  'sales_amount', 'order_value', 'order_count', 'collection_amount', 'visit_count', 'new_customers',
  'product_quantity', 'doctor_visits', 'pharmacy_visits',
  'order_quantity', 'meter_quantity', 'client_visits',
  'quantity_sold',
  'admission_target', 'fee_collection', 'institution_visits', 'student_enrollment', 'followups',
] as const;



const targetBaseSchema = z.object({
  representativeId: z.string().uuid(),
  industryTypeId: z.string().uuid(),
  targetType: z.enum(TARGET_TYPES),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  periodLabel: z.string().trim().min(1).max(120),
  targetValue: z.number().finite().nonnegative(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  clientId: z.string().uuid().optional().nullable(),
  productId: z.string().uuid().optional().nullable(),
  remarks: z.string().trim().max(2000).optional().nullable(),
});
export const targetCreateSchema = targetBaseSchema.refine((v) => v.periodStart <= v.periodEnd, { message: 'periodStart must be before periodEnd', path: ['periodEnd'] });
export const targetUpdateSchema = targetBaseSchema.partial();

export const targetLifecycleSchema = z.object({ lifecycle: z.enum(['active', 'paused', 'completed']) });

export const targetAdjustSchema = z.object({
  newValue: z.number().finite().nonnegative(),
  reason: z.string().trim().min(1).max(500),
});