// NEW
import { Router } from 'express';
import { trading } from '../controllers/trading.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { TRADING_RESOURCES } from '../lib/trading-resources.js';

export const tradingRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');

for (const resource of TRADING_RESOURCES) {
  const base = `/trading/${resource.path}`;
  tradingRouter.get(base, authenticate, manager, trading.list(resource));
  tradingRouter.post(base, authenticate, manager, trading.create(resource));
  tradingRouter.get(`${base}/:id`, authenticate, manager, trading.get(resource));
  tradingRouter.patch(`${base}/:id`, authenticate, manager, trading.update(resource));
  tradingRouter.delete(`${base}/:id`, authenticate, manager, trading.remove(resource));
}

// Real "Send to supplier" for Purchase Enquiry (actually emails the
// supplier) — a specific route alongside the generic CRUD ones above.
tradingRouter.post('/trading/purchase-enquiries/:id/send', authenticate, manager, trading.sendPurchaseEnquiry);

// Submit / approve / reject a trade document (the only way to change its verification state).
tradingRouter.post('/trading/documents/:id/review', authenticate, manager, trading.reviewDocument);

// "Send documents": emails the shipment's Verified documents to the customer (or the address typed).
tradingRouter.post('/trading/shipments/:id/send-documents', authenticate, manager, trading.sendShipmentDocuments);

// "Send invoice": emails the customer invoice to the customer (or the address typed).
tradingRouter.post('/trading/customer-invoices/:id/send', authenticate, manager, trading.sendCustomerInvoice);