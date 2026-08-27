import type { JWTPayload } from 'jose';
declare global { namespace Express { interface Request { auth?: JWTPayload; organizationRole?: string; } } }
export {};
