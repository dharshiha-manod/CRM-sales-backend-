import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  // Public URL of the client-facing CRM app, for links sent outside the
  // organisation (for example https://crm.yourcompany.com). This must be a
  // publicly reachable HTTPS domain in production — never an internal or
  // localhost address.
  PUBLIC_APP_URL: z.string().url().optional(),
  // SMTP is optional so local development does not accidentally send mail.
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  MAIL_FROM: z.string().trim().email().optional(),
  COMPANY_LOGO_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_ISSUER: z.string().url(),
  SUPABASE_JWT_AUDIENCE: z.string().min(1).default('authenticated'),
  // NEW — Telephony/IVR. All optional: if TELEPHONY_PROVIDER is unset, the
  // Calls & IVR page keeps working in "not configured" mode (existing
  // behaviour is fully preserved).
  TELEPHONY_PROVIDER: z.enum(['twilio', 'exotel']).optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  EXOTEL_SID: z.string().optional(),
  EXOTEL_API_KEY: z.string().optional(),
  EXOTEL_API_TOKEN: z.string().optional(),
  EXOTEL_SUBDOMAIN: z.string().optional(),
  EXOTEL_PHONE_NUMBER: z.string().optional(),
  // Public base URL of THIS api (e.g. https://api.yourcompany.com/api) used
  // to build the webhook URLs the telephony provider needs to call back into.
  TELEPHONY_PUBLIC_BASE_URL: z.string().url().optional(),
  TWILIO_VOICE_ANSWER_URL: z.string().url().optional()
});
export const env = schema.parse(process.env);
