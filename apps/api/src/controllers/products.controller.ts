import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { productService } from '../services/products.service.js';
import { productCreateSchema, productUpdateSchema } from '../validation/products.schemas.js';
const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return value; };
const id = (value: string | string[] | undefined) => { const result = Array.isArray(value) ? value[0] : value; if (!result) throw new AppError(400, 'INVALID_ID', 'A resource id is required'); return result; };
const scope = (req: Parameters<RequestHandler>[0]) => { if (!req.industryScope) throw new AppError(500, 'INDUSTRY_SCOPE_MISSING', 'Industry scope was not resolved for this request.'); return req.industryScope; };
export const products: Record<string, RequestHandler> = {
  list: async (req, res) => res.json({ data: await productService.list(org(req), req.query.search as string | undefined, req.query.status as string | undefined, req.query.industryTypeId as string | undefined, scope(req)) }),
  create: async (req, res) => res.status(201).json({ data: await productService.create(org(req), productCreateSchema.parse(req.body), scope(req)) }),
  update: async (req, res) => res.json({ data: await productService.update(org(req), id(req.params.id), productUpdateSchema.parse(req.body), scope(req)) }),
  remove: async (req, res) => { await productService.remove(org(req), id(req.params.id), scope(req)); res.status(204).end(); }
};