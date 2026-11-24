// FMCG delivery trips endpoints (logic lives in lib/fmcg-trips.ts). Dispatch and delivery go through the normal shipment rules.
import { Router, type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { isFmcgIndustry } from '../lib/fmcg-market.js';
import { addShipmentsToTrip, availableShipments, cancelTrip, createTrip, deliverStop, dispatchTrip, getTrip, listTrips, removeShipmentFromTrip, settleTrip, updateTrip } from '../lib/fmcg-trips.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';

export const fmcgTripsRouter = Router();
const staff = requireRoles('super_admin', 'admin', 'sales_manager');
type Req = Parameters<RequestHandler>[0];

const org = (req: Req) => {
  const v = req.header('x-organization-id');
  if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return v;
};
const param = (req: Req, name: string) => {
  const v = Array.isArray(req.params[name]) ? req.params[name][0] : req.params[name];
  if (!v) throw new AppError(400, 'INVALID_ID', 'A record id is required.');
  return v;
};
const fmcgId = async (req: Req): Promise<string> => {
  const id = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!id || !(await isFmcgIndustry(org(req), id))) throw new AppError(422, 'NOT_FMCG', 'Delivery trips are only available in the FMCG industry.');
  return id;
};
const user = (req: Req) => req.auth!.sub as string;

fmcgTripsRouter.get('/fmcg/trips', authenticate, staff, async (req, res) => { res.json({ data: await listTrips(org(req), await fmcgId(req)) }); });
fmcgTripsRouter.get('/fmcg/trips/available-shipments', authenticate, staff, async (req, res) => { res.json({ data: await availableShipments(org(req), await fmcgId(req)) }); });
fmcgTripsRouter.get('/fmcg/trips/:id', authenticate, staff, async (req, res) => { res.json({ data: await getTrip(org(req), await fmcgId(req), param(req, 'id')) }); });
fmcgTripsRouter.post('/fmcg/trips', authenticate, staff, async (req, res) => { res.status(201).json({ data: await createTrip(org(req), await fmcgId(req), user(req), req.body ?? {}) }); });
fmcgTripsRouter.patch('/fmcg/trips/:id', authenticate, staff, async (req, res) => { res.json({ data: await updateTrip(org(req), await fmcgId(req), param(req, 'id'), req.body ?? {}) }); });
fmcgTripsRouter.post('/fmcg/trips/:id/cancel', authenticate, staff, async (req, res) => { res.json({ data: await cancelTrip(org(req), await fmcgId(req), param(req, 'id')) }); });
fmcgTripsRouter.post('/fmcg/trips/:id/stops', authenticate, staff, async (req, res) => {
  const ids = Array.isArray(req.body?.shipment_ids) ? (req.body.shipment_ids as unknown[]).map(String) : [];
  res.json({ data: await addShipmentsToTrip(org(req), await fmcgId(req), param(req, 'id'), ids) });
});
fmcgTripsRouter.delete('/fmcg/trips/:id/stops/:shipmentId', authenticate, staff, async (req, res) => {
  res.json({ data: await removeShipmentFromTrip(org(req), await fmcgId(req), param(req, 'id'), param(req, 'shipmentId')) });
});
fmcgTripsRouter.post('/fmcg/trips/:id/dispatch', authenticate, staff, async (req, res) => {
  res.json({ data: await dispatchTrip(org(req), req.industryScope!, await fmcgId(req), user(req), param(req, 'id')) });
});
fmcgTripsRouter.post('/fmcg/trips/:id/stops/:shipmentId/deliver', authenticate, staff, async (req, res) => {
  res.json({ data: await deliverStop(org(req), req.industryScope!, await fmcgId(req), user(req), param(req, 'id'), param(req, 'shipmentId'), req.body ?? {}) });
});
fmcgTripsRouter.post('/fmcg/trips/:id/settle', authenticate, staff, async (req, res) => { res.json({ data: await settleTrip(org(req), await fmcgId(req), param(req, 'id'), req.body ?? {}) }); });