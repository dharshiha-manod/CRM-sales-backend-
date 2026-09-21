// FILE: admin/src/components/TradingSalesOrderPage.tsx
// Step 7 of the Trading connectivity plan: Sales Orders, created
// automatically when a Deal's status is set to "Confirmed" (see
// convertDealToSalesOrder in TradingDealPage.tsx). This module didn't
// exist anywhere in the codebase before — there was no prior Trading
// Sales Order table, page, or route to restore, so this is a new module
// built to match the existing generic Trading pattern (same shape as
// TradingShipmentPage.tsx), not a recovered one.
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import { buildDraftFromDeal } from '../lib/tradeDocumentHandoff';
import { api } from '../lib/api';

const STATUSES = ['Confirmed', 'In Production', 'Ready to Ship', 'Shipped', 'Completed', 'Cancelled'];
const ORDER_DOC_TYPES = ['Sales Order', 'Proforma Invoice', 'Commercial Invoice', 'Packing List', 'Other'];
const convertingOrderIds = new Set<string>();

// NEW — Step 8 of the Trading connectivity plan. Mirrors the Deal -> Sales
// Order conversion: confirming an order creates one matching shipment and
// records the generated shipment number back on the order. The in-flight
// guard also prevents two quick saves from creating duplicate shipments.
async function convertSalesOrderToShipment(order: Record<string, unknown>, reload: () => Promise<void>) {
  const orderId = String(order.id ?? '');
  if (!orderId || convertingOrderIds.has(orderId)) return;
  convertingOrderIds.add(orderId);
  try {
    const shipmentsRes = await api<{ data: Array<Record<string, unknown>> }>('/trading/shipments');
    const existingShipment = shipmentsRes.data?.find((shipment) => shipment.order_number === order.order_number);
    if (existingShipment?.shipment_number) {
      await api(`/trading/sales-orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ shipment_number: existingShipment.shipment_number }) });
      await reload();
      return;
    }
    const year = new Date().getFullYear();
    const seq = String((shipmentsRes.data?.length ?? 0) + 1).padStart(4, '0');
    const shipmentNumber = `SHP-${year}-${seq}`;
    await api('/trading/shipments', {
      method: 'POST',
      body: JSON.stringify({
        shipment_number: shipmentNumber,
        order_number: order.order_number ?? '',
        deal_number: order.deal_number ?? '',
        customer_name: order.customer_name ?? '',
        product_name: order.product_name ?? '',
        quantity: order.quantity,
        unit: order.unit ?? '',
        shipment_date: new Date().toISOString().slice(0, 10),
        status: 'Ready to Ship',
      }),
    });
    // Link back: this Sales Order now shows which Shipment it became.
    await api(`/trading/sales-orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ shipment_number: shipmentNumber }) });
    await reload();
  } catch {
    // Best-effort automation — the order itself already saved fine; the
    // user can retry (edit status again) if this part fails.
  } finally {
    convertingOrderIds.delete(orderId);
  }
}

function handleAfterSave(saved: Record<string, unknown>, reload: () => Promise<void>) {
  // Only fire when a Confirmed order has no linked shipment, so later saves
  // cannot create a second Shipment for the same Sales Order.
  if (saved.status === 'Confirmed' && !saved.shipment_number) {
    void convertSalesOrderToShipment(saved, reload);
  }
}

function orderValue(r: Record<string, unknown>) {
  return (Number(r.selling_rate) || 0) * (Number(r.quantity) || 0);
}

const config: TradingModuleConfig = {
  resource: '/trading/sales-orders',
  eyebrowModule: 'SALES ORDER MANAGEMENT',
  title: 'Sales order management',
  description: 'Sales orders created from a confirmed Deal — the commercial record used to plan shipment and billing.',
  icon: '🧾',
  emptyIcon: '🧾',
  codeField: 'order_number',
  nameField: 'product_name',
  statusOptions: STATUSES,
  inlineStatus: true,
  searchableKeys: ['order_number', 'deal_number', 'customer_name', 'product_name'],
  fields: [
    { key: 'order_number', label: 'Order number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'SO' },
    {
      key: 'deal_number',
      label: 'Deal',
      type: 'lookup',
      lookupResource: '/trading/deals',
      lookupLabelKey: 'deal_name',
      listColumn: true,
      // Same convenience the Shipment page already gives when it links
      // back to a Deal — pick the Deal and the rest of the order fills in.
      autoFillMap: { customer_name: 'customer_name', product_name: 'product_name', quantity: 'quantity', unit: 'unit', currency: 'currency', selling_rate: 'selling_rate', payment_terms: 'payment_terms', delivery_terms: 'delivery_terms', expected_delivery_date: 'expected_delivery_date' },
    },
    { key: 'customer_name', label: 'Customer', type: 'lookup', lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_code', listColumn: true, group: 'Order details' },
    { key: 'product_name', label: 'Product', type: 'text', group: 'Order details' },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Order details' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Order details' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Order details' },
    { key: 'selling_rate', label: 'Selling rate', type: 'number', group: 'Order details' },
    {
      key: 'total_amount',
      label: 'Total amount',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => `₹${orderValue(r).toLocaleString()}`,
      group: 'Order details',
    },
    { key: 'order_date', label: 'Order date', type: 'date', listColumn: true, group: 'Schedule & terms' },
    { key: 'expected_delivery_date', label: 'Expected delivery date', type: 'date', group: 'Schedule & terms' },
    { key: 'payment_terms', label: 'Payment terms', type: 'text', group: 'Schedule & terms' },
    { key: 'delivery_terms', label: 'Delivery terms', type: 'text', group: 'Schedule & terms' },
    { key: 'status', label: 'Order status', type: 'select', options: STATUSES, listColumn: true, group: 'Schedule & terms' },
    { key: 'shipment_number', label: 'Shipment (once confirmed)', type: 'text', readOnly: true, listColumn: true, placeholder: 'Fills in automatically when status is set to "Confirmed"', group: 'Schedule & terms' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Schedule & terms' },
  ],
  afterSave: handleAfterSave,
  kpis: [
    { icon: '🧾', iconClass: 'kpi-icon-ink', label: 'Total sales orders', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Open orders', value: (r) => String(r.filter((x) => !['Completed', 'Cancelled'].includes(String(x.status))).length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Completed', value: (r) => String(r.filter((x) => x.status === 'Completed').length) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Order value', value: (r) => `₹${r.reduce((sum, x) => sum + orderValue(x), 0).toLocaleString()}` },
  ],
  rowActions: (r) => (
    <GenerateDocumentButton docTypes={ORDER_DOC_TYPES} buildDraft={(documentType) => buildDraftFromDeal(r, documentType)} />
  ),
  detailActions: (r) => (
    <GenerateDocumentButton docTypes={ORDER_DOC_TYPES} buildDraft={(documentType) => buildDraftFromDeal(r, documentType)} />
  ),
};

export function TradingSalesOrderPage() {
  return <TradingMasterPage config={config} />;
}
