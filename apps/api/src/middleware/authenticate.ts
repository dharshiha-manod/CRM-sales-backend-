import type { RequestHandler } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
const jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_JWT_ISSUER}/.well-known/jwks.json`));
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'A bearer access token is required');
    const { payload } = await jwtVerify(token, jwks, { issuer: env.SUPABASE_JWT_ISSUER, audience: env.SUPABASE_JWT_AUDIENCE });
    req.auth = payload;
    next();
  } catch (error) { next(error instanceof AppError ? error : new AppError(401, 'INVALID_TOKEN', 'The access token is invalid or expired')); }
};
