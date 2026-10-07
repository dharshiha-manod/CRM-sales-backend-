import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { createMovement, inventoryOverview, repStock } from '../repositories/inventory.repository.js';
import { createStockRequest, decideStockRequest, listStockRequests, representativeForUser } from '../repositories/stock-requests.repository.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const inventoryRouter = Router();
const org = (req: Parameters<RequestHandler>[0]) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };
const scope = (req: Parameters<RequestHandler>[0]) => { if (!req.industryScope) throw new AppError(500, 'INDUSTRY_SCOPE_MISSING', 'Industry scope was not resolved for this request.'); return req.industryScope; };

const text = z.string().trim().max(240).optional().nullable();
const movementSchema = z.object({
  type: z.enum(['stock_in', 'adjustment', 'transfer', 'assign', 'return']),
  productId: z.string().uuid(),
  quantity: z.number().finite(),
  representativeId: z.string().uuid().optional().nullable(),
  fromLocation: text, toLocation: text, batch: text, reference: text, reason: text,
  mfgDate: z.string().trim().max(10).optional().nullable(),
  expiryDate: z.string().trim().max(10).optional().nullable(),
  remarks: z.string().trim().max(1000).optional().nullable(),
  allowNegative: z.boolean().optional(),
  requestId: z.string().uuid().optional().nullable(),
}).superRefine((v, ctx) => {
  if (v.mfgDate && v.expiryDate && v.expiryDate < v.mfgDate) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry cannot be before the manufacturing date.' });
  if (v.type === 'adjustment' ? v.quantity === 0 : v.quantity <= 0) ctx.addIssue({ code: 'custom', path: ['quantity'], message: v.type === 'adjustment' ? 'Quantity change cannot be zero.' : 'Quantity must be greater than zero.' });
});

inventoryRouter.get('/inventory/overview', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), async (req, res, next) => {
  try { res.json({ data: await inventoryOverview(org(req), resolveIndustryTypeId(scope(req), req.query.industryTypeId as string | undefined)) }); } catch (e) { next(e); }
});
inventoryRouter.post('/inventory/movements', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), async (req, res, next) => {
  try { res.status(201).json({ data: await createMovement(org(req), req.auth!.sub as string, scope(req), movementSchema.parse(req.body)) }); } catch (e) { next(e); }
});

// ---------- Stock requests (rep asks, manager/admin approves then assigns) ----------
const requestSchema = z.object({
  productId: z.string().uuid(), quantity: z.number().finite().positive().max(1000000),
  reason: z.string().trim().max(500).optional().nullable(), requiredDate: z.string().trim().max(10).optional().nullable(),
  remarks: z.string().trim().max(1000).optional().nullable(), requestedTo: z.string().trim().max(120).optional().nullable(),
});
const decisionSchema = z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional().nullable() });

inventoryRouter.post('/inventory/requests', authenticate, requireRoles('sales_representative'), async (req, res, next) => {
  try { res.status(201).json({ data: await createStockRequest(org(req), req.auth!.sub as string, requestSchema.parse(req.body)) }); } catch (e) { next(e); }
});
inventoryRouter.get('/inventory/requests', authenticate, requireRoles('super_admin', 'admin', 'sales_manager', 'sales_representative'), async (req, res, next) => {
  try {
    const organizationId = org(req);
    if (req.organizationRole === 'sales_representative') {
      const rep = await representativeForUser(organizationId, req.auth!.sub as string);
      res.json({ data: await listStockRequests(organizationId, { representativeId: rep.id }) });
      return;
    }
    res.json({ data: await listStockRequests(organizationId, { industryTypeId: resolveIndustryTypeId(scope(req), req.query.industryTypeId as string | undefined) }) });
  } catch (e) { next(e); }
});
inventoryRouter.post('/inventory/requests/:id/decision', authenticate, requireRoles('super_admin', 'admin', 'sales_manager'), async (req, res, next) => {
  try {
    const body = decisionSchema.parse(req.body);
    res.json({ data: await decideStockRequest(org(req), req.auth!.sub as string, z.string().uuid().parse(req.params.id), body.status, body.note) });
  } catch (e) { next(e); }
});

// ---------- Mobile: what the rep carries, and the products they can ask for ----------
inventoryRouter.get('/inventory/my-stock', authenticate, requireRoles('sales_representative'), async (req, res, next) => {
  try {
    const rep = await representativeForUser(org(req), req.auth!.sub as string);
    res.json({ data: await repStock(org(req), rep.id) });
  } catch (e) { next(e); }
});
inventoryRouter.get('/inventory/request-products', authenticate, requireRoles('sales_representative'), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('products').select('id, product_name, product_code').eq('organization_id', org(req)).eq('status', 'active').order('product_name');
    if (error) throw error;
    res.json({ data: data ?? [] });
  } catch (e) { next(e); }
});