import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';
export const notFound: RequestHandler = (req, _res, next) => next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.flatten() }, requestId: req.id });
    return;
  }
  const known = error instanceof AppError;
  if (!known) logger.error({ err: error, requestId: req.id }, 'Unhandled request error');
  const status = known ? error.statusCode : 500;
  res.status(status).json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'An unexpected error occurred', ...(known && error.details ? { details: error.details } : {}) }, requestId: req.id });
};
