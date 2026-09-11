import * as repository from '../repositories/orders.repository.js';
export const orderService = { createFromVisit: repository.createOrderFromVisit, list: repository.listOrders };