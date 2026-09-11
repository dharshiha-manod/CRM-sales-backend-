import { z } from 'zod';

const industryTypeIdField = z.string().uuid().nullable().optional();

export const userMembershipSchema = z.object({
  userId: z.string().uuid(),
  roleCode: z.enum(['super_admin', 'admin', 'sales_manager', 'sales_representative']),
  status: z.enum(['active', 'invited', 'disabled']).default('active'),
  industryTypeId: industryTypeIdField,
});

export const userCreateSchema = z.object({
  displayName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(32).optional().nullable(),
  password: z.string().min(12, 'Password must be at least 12 characters').max(72).regex(/[a-z]/, 'Password must include a lowercase letter').regex(/[A-Z]/, 'Password must include an uppercase letter').regex(/[0-9]/, 'Password must include a number'),
  roleCode: z.enum(['super_admin', 'admin', 'sales_manager', 'sales_representative']),
  status: z.enum(['active', 'invited', 'disabled']).default('active'),
  industryTypeId: industryTypeIdField,
});