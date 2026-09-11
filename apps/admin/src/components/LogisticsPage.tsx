import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

// Extends Shipment Management — same resource/table, not a duplicate
// shipment system. This is the operational (pickup → delivery) view with
// a fuller status list; TradingShipmentPage stays the commercial view.
const SHIPPING_MODES = ['Road', 'Air', 'Sea', 'Rail', 'Courier'];
const STATUSES = ['Planned', 'Pickup Scheduled', 'Picked Up', 'Dispatched', 'In Transit', 'At Destination', 'Out for Delivery', 'Delivered', 'Delayed', 'Cancelled'];

const config: TradingModuleConfig = {
  resource: '/trading/shipments',
  eyebrowModule: 'LOGISTICS',
  title: 'Logistics',
  description: 'Movement of goods from pickup to delivery, on the same shipment record as Shipment Management — pickup scheduling, transporter, tracking and current location.',
  icon: '▥',
  emptyIcon: '▥',
  codeField: 'shipment_number',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['shipment_number', 'deal_number', 'customer_name', 'supplier_name', 'transporter', 'tracking_number', 'vehicle_container_number'],
  fields: [
    { key: 'shipment_number', label: 'Shipment number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'SHP' },
    { key: 'deal_number', label: 'Deal', type: 'lookup', lookupResource: '/trading/deals', lookupLabelKey: 'deal_name', group: 'Route' },
    { key: 'customer_name', label: 'Customer', type: 'text', group: 'Route' },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Route' },
    { key: 'origin', label: 'Origin', type: 'text', listColumn: true, group: 'Route' },
    { key: 'destination', label: 'Destination', type: 'text', listColumn: true, group: 'Route' },
    { key: 'transporter', label: 'Transporter / logistics provider', type: 'text', group: 'Route' },
    { key: 'shipping_mode', label: 'Shipping mode', type: 'select', options: SHIPPING_MODES, listColumn: true, group: 'Route' },
    { key: 'tracking_number', label: 'Tracking number', type: 'text', group: 'Route' },
    { key: 'vehicle_container_number', label: 'Vehicle / container number', type: 'text', group: 'Route' },
    { key: 'driver_contact', label: 'Driver / contact', type: 'text', group: 'Pickup & delivery' },
    { key: 'pickup_date', label: 'Pickup date', type: 'date', group: 'Pickup & delivery' },
    { key: 'expected_delivery_date', label: 'Expected delivery date', type: 'date', listColumn: true, group: 'Pickup & delivery' },
    { key: 'actual_delivery_date', label: 'Actual delivery date', type: 'date', group: 'Pickup & delivery' },
    { key: 'distance', label: 'Distance', type: 'text', group: 'Pickup & delivery', placeholder: 'e.g. 1,240 km' },
    { key: 'current_location', label: 'Current location', type: 'text', group: 'Pickup & delivery' },
    { key: 'freight_cost', label: 'Freight cost', type: 'number', group: 'Pickup & delivery' },
    { key: 'status', label: 'Delivery status', type: 'select', options: STATUSES, listColumn: true, group: 'Pickup & delivery' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Pickup & delivery' },
  ],
  kpis: [
    { icon: '▥', iconClass: 'kpi-icon-ink', label: 'Active shipments', value: (r) => String(r.filter((x) => !['Delivered', 'Cancelled'].includes(String(x.status))).length) },
    { icon: '↗', iconClass: 'kpi-icon-amber', label: 'In transit', value: (r) => String(r.filter((x) => x.status === 'In Transit' || x.status === 'Out for Delivery').length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pickup pending', value: (r) => String(r.filter((x) => x.status === 'Planned' || x.status === 'Pickup Scheduled').length) },
    { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Delayed', value: (r) => String(r.filter((x) => x.status === 'Delayed').length) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Logistics cost', value: (r) => `₹${r.reduce((sum, x) => sum + (Number(x.freight_cost) || 0), 0).toLocaleString()}` },
  ],
  sampleRecords: [
    { id: 'demo-logistics-1', shipment_number: 'SHP-0001', deal_number: 'DEAL-0001', customer_name: 'Al Habib Foods', supplier_name: 'Orient Traders', origin: 'Chennai Port', destination: 'Jebel Ali Port', transporter: 'Maersk Line', shipping_mode: 'Sea', tracking_number: 'MSKU4471203', pickup_date: '2026-08-28', expected_delivery_date: '2026-09-20', current_location: 'Arabian Sea, en route', freight_cost: 185000, status: 'In Transit' },
    { id: 'demo-logistics-2', shipment_number: 'SHP-0002', deal_number: 'DEAL-0002', customer_name: 'Coastal Garments', supplier_name: 'Global Commodities Co', origin: 'Coimbatore', destination: 'Tiruppur', transporter: 'VRL Logistics', shipping_mode: 'Road', tracking_number: 'VRL889021', pickup_date: '2026-09-08', expected_delivery_date: '2026-09-10', actual_delivery_date: '2026-09-09', freight_cost: 12500, status: 'Delivered' },
  ],
};

export function LogisticsPage() {
  return <TradingMasterPage config={config} />;
}