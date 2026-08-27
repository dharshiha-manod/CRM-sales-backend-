import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_ISSUER: z.string().url(),
  SUPABASE_JWT_AUDIENCE: z.string().min(1).default('authenticated')
});
export const env = schema.parse(process.env);
