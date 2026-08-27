import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { industryTypeService } from '../services/industry-types.service.js';
import { industryTypeCreateSchema, industryTypeStatusSchema, industryTypeUpdateSchema, uuid } from '../validation/industry-types.schemas.js';

const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return uuid.parse(value); };
const id = (value: string | string[] | undefined) => uuid.parse(Array.isArray(value) ? value[0] : value);
const productTagsSchema = z.object({ industryTypeIds: z.array(uuid).max(50) });

export const industryTypes: Record<string, RequestHandler> = {
  list: async (req, res) => res.json({ data: await industryTypeService.list(org(req), req.query.search as string | undefined, req.query.status as string | undefined) }),
  get: async (req, res) => res.json({ data: await industryTypeService.get(org(req), id(req.params.id)) }),
  create: async (req, res) => res.status(201).json({ data: await industryTypeService.create(org(req), industryTypeCreateSchema.parse(req.body)) }),
  update: async (req, res) => res.json({ data: await industryTypeService.update(org(req), id(req.params.id), industryTypeUpdateSchema.parse(req.body)) }),
  status: async (req, res) => res.json({ data: await industryTypeService.update(org(req), id(req.params.id), industryTypeStatusSchema.parse(req.body)) })
};

export const productIndustryTags: Record<string, RequestHandler> = {
  list: async (req, res) => res.json({ data: await industryTypeService.productTags.list(org(req), id(req.params.productId)) }),
  set: async (req, res) => res.json({ data: await industryTypeService.productTags.set(org(req), id(req.params.productId), productTagsSchema.parse(req.body).industryTypeIds) })
};