import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { tradingService } from '../services/trading.service.js';
import type { TradingResource } from '../lib/trading-resources.js';

const org = (req: Parameters<RequestHandler>[0]) => {
  const value = req.header('x-organization-id');
  if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return value;
};

const idParam = (value: string | string[] | undefined) => {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result) throw new AppError(400, 'INVALID_ID', 'A resource id is required');
  return result;
};

function assertRequiredFields(resource: TradingResource, body: Record<string, unknown>) {
  const missing = resource.requiredFields.filter((key) => body[key] === undefined || body[key] === null || body[key] === '');
  if (missing.length > 0) throw new AppError(400, 'VALIDATION_ERROR', `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required.`);
}

function asBody(req: Parameters<RequestHandler>[0]): Record<string, unknown> {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'VALIDATION_ERROR', 'A JSON object body is required.');
  return body as Record<string, unknown>;
}


export const trading = {
  list: (resource: TradingResource): RequestHandler => async (req, res) => {
    const requested = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    res.json({ data: await tradingService.list(resource, org(req), req.industryScope!, requested) });
  },
  get: (resource: TradingResource): RequestHandler => async (req, res) => {
    res.json({ data: await tradingService.get(resource, org(req), idParam(req.params.id), req.industryScope!) });
  },
  create: (resource: TradingResource): RequestHandler => async (req, res) => {
    const body = asBody(req);
    assertRequiredFields(resource, body);
    res.status(201).json({ data: await tradingService.create(resource, org(req), body, req.industryScope!) });
  },
  update: (resource: TradingResource): RequestHandler => async (req, res) => {
    const body = asBody(req);
    res.json({ data: await tradingService.update(resource, org(req), idParam(req.params.id), body, req.industryScope!) });
  },
  remove: (resource: TradingResource): RequestHandler => async (req, res) => {
    res.json({ data: await tradingService.remove(resource, org(req), idParam(req.params.id), req.industryScope!) });
  },
};
