import { z } from 'zod';

// The settings object is versioned by the client.  It is stored as JSONB, but
// must still be a plain object so malformed payloads cannot replace it.
export const organizationSettingsSaveSchema = z.object({
  settings: z.record(z.string(), z.unknown()).refine((value) => Object.getPrototypeOf(value) === Object.prototype, {
    message: 'settings must be an object',
  }),
});
