import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { updateExportDetails } from '../repositories/fmcg-export.repository.js';
import { createShipment, getShipments, listAllShipments, updatePaymentType, updateShipment } from '../repositories/fmcg-shipment.repository.js';

const org = (req: Parameters<RequestHandler>[0]) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };
const pid = (req: Parameters<RequestHandler>[0]) => (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
const staff = requireRoles('super_admin', 'admin', 'sales_manager');

export const fmcgExportRouter = Router();
fmcgExportRouter.patch('/orders/:id/export-details', authenticate, staff, async (req, res) => {
  res.json({ data: await updateExportDetails(org(req), req.industryScope!, pid(req), req.body ?? {}) });
});
// Shipments: many per order (partial deliveries, several vehicles / containers).
fmcgExportRouter.get('/orders/:id/shipments', authenticate, staff, async (req, res) => {
  res.json({ data: await getShipments(org(req), req.industryScope!, pid(req)) });
});
fmcgExportRouter.post('/orders/:id/shipments', authenticate, staff, async (req, res) => {
  res.status(201).json({ data: await createShipment(org(req), req.industryScope!, req.auth!.sub as string, pid(req), req.body ?? {}) });
});
fmcgExportRouter.get('/fmcg/shipments', authenticate, staff, async (req, res) => {
  res.json({ data: await listAllShipments(org(req), req.industryScope!) });
});
fmcgExportRouter.patch('/fmcg/shipments/:id', authenticate, staff, async (req, res) => {
  res.json({ data: await updateShipment(org(req), req.industryScope!, pid(req), req.body ?? {}) });
});
fmcgExportRouter.patch('/orders/:id/payment-type', authenticate, staff, async (req, res) => {
  res.json({ data: await updatePaymentType(org(req), req.industryScope!, pid(req), (req.body ?? {}).paymentType) });
});