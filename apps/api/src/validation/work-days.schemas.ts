import { z } from 'zod';

const gps = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().min(0).optional().nullable(),
});

export const workDayStartSchema = z.object({ location: gps });
export const workDayEndSchema = z.object({ location: gps.optional().nullable() });
export const workDayPingsSchema = z.object({
  points: z.array(gps.extend({
    capturedAt: z.string().datetime(),
    mocked: z.boolean().optional(),
    visitId: z.string().uuid().optional().nullable(),
  })).min(1).max(200),
});