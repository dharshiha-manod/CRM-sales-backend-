import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { collectionsService } from '../services/collections.service.js';
import { fieldActivityService } from '../services/field-activity.service.js';
import { collectionCreateSchema, orderCollectionCreateSchema } from '../validation/collections.schemas.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return value; };
const id = (value: string | string[] | undefined) => { const result = Array.isArray(value) ? value[0] : value; if (!result) throw new AppError(400, 'INVALID_ID', 'A resource id is required'); return result; };
export const collections: Record<string, RequestHandler> = {
  createFromVisit: async (req, res) => { const organizationId = org(req); const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!); res.status(201).json({ data: await collectionsService.createFromVisit(organizationId, rep.id, id(req.params.id), collectionCreateSchema.parse(req.body)) }); },
  createForOrder: async (req, res) => {
    const organizationId = org(req);
    res.status(201).json({ data: await collectionsService.createForOrder(organizationId, orderCollectionCreateSchema.parse(req.body), req.industryScope!) });
  },
  createMine: async (req, res) => {
    const organizationId = org(req);
    const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!);
    const input = orderCollectionCreateSchema.parse(req.body);
    const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id').eq('id', input.orderId).eq('organization_id', organizationId).eq('representative_id', rep.id).maybeSingle();
    if (error) throw error;
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'This order was not found for you.');
    res.status(201).json({ data: await collectionsService.createForOrder(organizationId, input, req.industryScope!) });
  },
  mine: async (req, res) => { const organizationId = org(req); const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!); res.json({ data: await collectionsService.list(organizationId, rep.id) }); },
  all: async (req, res) => {
    const requested = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    const industryTypeId = resolveIndustryTypeId(req.industryScope!, requested);
    res.json({ data: await collectionsService.list(org(req), undefined, industryTypeId) });
  },
};
