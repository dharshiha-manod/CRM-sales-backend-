// FILE: admin/src/components/TradingShipmentPage.tsx
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import { ShipmentDocumentsChecklist } from './ShipmentDocumentsChecklist';
import { buildDraftFromShipment } from '../lib/tradeDocumentHandoff';
import { LinkedRecords } from './LinkedRecords';
import { TRADING_HASH } from '../lib/recordFocus';

const SHIPPING_MODES = ['Road', 'Air', 'Sea', 'Rail', 'Courier'];
const STATUSES = ['Planned', 'Ready to Ship', 'Dispatched', 'In Transit', 'At Destination', 'Delivered', 'Delayed', 'Cancelled'];
const SHIPMENT_DOC_TYPES = ['Packing List', 'Commercial Invoice', 'Delivery Note', 'Bill of Lading', 'Airway Bill', 'Certificate of Origin', 'Insurance Certificate', 'Inspection Certificate', 'Shipping Instructions', 'Transport Document', 'Other'];

const AUTO_MANAGED_STATUSES = new Set(['', 'Planned', 'Ready to Ship', 'Dispatched', 'In Transit', 'At Destination', 'Delayed']);

function deriveShipmentStatus(form: Record<string, string>): Record<string, string> | void {
  if (!AUTO_MANAGED_STATUSES.has(form.status ?? '')) return;
  if (!form.shipment_date) return;
  if (form.expected_delivery_date && new Date() > new Date(form.expected_delivery_date)) return { status: 'Delayed' };
  return { status: 'In Transit' };
}

function deriveActualDeliveryDate(form: Record<string, string>): Record<string, string> | void {
  if (form.status !== 'Delivered' || form.actual_delivery_date) return;
  return { actual_delivery_date: new Date().toISOString().slice(0, 10) };
}
const config: TradingModuleConfig = {
  resource: '/trading/shipments',
  eyebrowModule: 'SHIPMENT MANAGEMENT',
  title: 'Shipment management',
  description: 'Track goods movement from supplier to customer against a confirmed deal — dispatch, transit, and delivery.',
  icon: '🚚',
  emptyIcon: '🚚',
  codeField: 'shipment_number',
  nameField: 'product_name',
  statusOptions: STATUSES,
  inlineStatus: true,
  inlineStatusExtra: (record, next) => (next === 'Delivered' && !record.actual_delivery_date ? { actual_delivery_date: new Date().toISOString().slice(0, 10) } : undefined),
  searchableKeys: ['shipment_number', 'deal_number', 'customer_name', 'supplier_name', 'product_name', 'tracking_number'],
  fields: [
    { key: 'shipment_number', label: 'Shipment number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'SHP' },
  { key: 'deal_number', label: 'Deal', type: 'lookup', lookupResource: '/trading/deals', lookupLabelKey: 'deal_name', autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name', quantity: 'quantity', unit: 'unit', currency: 'currency' }, listColumn: true },
    { key: 'order_number', label: 'Sales order', type: 'text', readOnly: true, listColumn: true, group: 'Goods' },
    { key: 'customer_name', label: 'Customer', type: 'lookup', lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_code', listColumn: true, group: 'Goods' },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Goods' },
    { key: 'product_name', label: 'Product', type: 'text', group: 'Goods' },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Goods' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Goods' },
    { key: 'batch_serial', label: 'Batch / serial information', type: 'text', group: 'Goods' },
    { key: 'shipment_date', label: 'Shipment date', type: 'date', group: 'Schedule', onValueChange: (_v, f) => deriveShipmentStatus(f) },
    { key: 'expected_delivery_date', label: 'Expected delivery date', type: 'date', listColumn: true, group: 'Schedule', onValueChange: (_v, f) => deriveShipmentStatus(f) },
      { key: 'actual_delivery_date', label: 'Actual delivery date', type: 'date', listColumn: true, group: 'Schedule' },
    { key: 'origin', label: 'Origin', type: 'text', group: 'Route' },
    { key: 'destination', label: 'Destination', type: 'text', group: 'Route' },
    { key: 'transporter', label: 'Transporter / logistics provider', type: 'text', group: 'Route' },
    { key: 'tracking_number', label: 'Tracking number', type: 'text', group: 'Route' },
    { key: 'vehicle_container_number', label: 'Vehicle / container number', type: 'text', group: 'Route' },
    { key: 'shipping_mode', label: 'Shipping mode', type: 'select', options: SHIPPING_MODES, listColumn: true, group: 'Route' },
    { key: 'freight_cost', label: 'Freight cost', type: 'number', group: 'Route' },
 { key: 'status', label: 'Shipment status', type: 'select', options: STATUSES, listColumn: true, group: 'Route', onValueChange: (_v, f) => deriveActualDeliveryDate(f) },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Route' },
  ],
  kpis: [
    { icon: '🚚', iconClass: 'kpi-icon-ink', label: 'Total shipments', value: (r) => String(r.length) },
    { icon: '↗', iconClass: 'kpi-icon-amber', label: 'In transit', value: (r) => String(r.filter((x) => x.status === 'In Transit' || x.status === 'Dispatched').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Delivered', value: (r) => String(r.filter((x) => x.status === 'Delivered').length) },
    { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Delayed', value: (r) => String(r.filter((x) => x.status === 'Delayed').length) },
    {
      icon: '⏱',
      iconClass: 'kpi-icon-school',
      label: 'On-time delivery rate',
      value: (r) => {
        const delivered = r.filter((x) => x.status === 'Delivered' && x.actual_delivery_date && x.expected_delivery_date);
        if (!delivered.length) return '—';
        const onTime = delivered.filter((x) => new Date(x.actual_delivery_date as string) <= new Date(x.expected_delivery_date as string));
        return `${Math.round((onTime.length / delivered.length) * 100)}%`;
      },
    },
  ],
  rowActions: (r) => (
    <GenerateDocumentButton docTypes={SHIPMENT_DOC_TYPES} buildDraft={(documentType) => buildDraftFromShipment(r, documentType)} />
  ),
  // Documents remain a manual action. They become available on the detail
  // view once delivery is confirmed; no document is generated automatically.
  detailActions: (r) => r.status === 'Delivered' ? (
    <GenerateDocumentButton label="Generate delivery document" docTypes={SHIPMENT_DOC_TYPES} buildDraft={(documentType) => buildDraftFromShipment(r, documentType)} />
  ) : null,
  // The documents checklist stays as-is; the chain panel below it is new —
  // a shipment is the hub of the Trading flow, so its logistics, trade
  // transaction, customs clearance and any claims should be reachable from
  // here rather than by searching each module in turn.
  detailExtra: (r) => (
    <>
      <ShipmentDocumentsChecklist shipment={r} />
      <LinkedRecords
        heading={`Chain for ${String(r.shipment_number ?? '')}`}
        links={[
          { title: 'Deal', resource: '/trading/deals', matchField: 'deal_number', matchValue: String(r.deal_number ?? ''), hash: TRADING_HASH.deal, codeField: 'deal_number', subField: 'deal_name' },
          { title: 'Logistics', resource: '/trading/logistics', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.logistics, codeField: 'logistics_number', subField: 'status', emptyLabel: 'No logistics movement recorded for this shipment yet.' },
          { title: 'Import / export', resource: '/trading/import-export', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.importExport, codeField: 'transaction_number', subField: 'status', emptyLabel: 'No import/export transaction for this shipment yet.' },
          { title: 'Customs', resource: '/trading/customs', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.customs, codeField: 'customs_reference', subField: 'clearance_status', emptyLabel: 'No customs declaration for this shipment yet.' },
          { title: 'Claims', resource: '/trading/claims', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.claims, codeField: 'claim_number', subField: 'status', emptyLabel: 'No claims raised against this shipment.' },
        ]}
      />
    </>
  ),
};

export function TradingShipmentPage() {
  return <TradingMasterPage config={config} />;
}
