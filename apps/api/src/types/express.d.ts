import type { JWTPayload } from 'jose';
import type { IndustryScope } from '../lib/industry-scope.js';
declare global { namespace Express { interface Request { auth?: JWTPayload; organizationRole?: string; industryScope?: IndustryScope; } } }
export {};