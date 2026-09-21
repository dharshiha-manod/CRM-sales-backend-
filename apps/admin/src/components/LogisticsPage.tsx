// FILE: admin/src/components/LogisticsPage.tsx
// Rewritten: this used to point at '/trading/shipments' — the same table
// Shipment Management writes to. That wasn't reuse, it was a collision:
// the two pages declared different status vocabularies for one `status`
// column, and current_location / pickup_date / driver_contact / distance
// were never columns on trading_shipments at all, so the API's
// sanitizePayload silently dropped them and the save still reported
// success. Logistics now has its own record (trading_logistics) keyed to
// an existing shipment_number.
//
// Shipment Management stays the single source of truth for WHAT is being
// shipped (customer, supplier, product, quantity). Logistics owns HOW it
// moves (carrier, tracking, legs, dates, freight). Nothing is re-entered:
// picking the shipment fills the commercial side automatically.
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { LinkedRecords } from './LinkedRecords';
import { TRADING_HASH } from '../lib/recordFocus';
import { applyCurrencyConversion, formatConverted } from '../lib/currencyLookup';

const SHIPPING_MODES = ['Road', 'Air', 'Sea', 'Rail', 'Courier', 'Multimodal'];
const STATUSES = [
  'Planned', 'Pickup Scheduled', 'Picked Up', 'Dispatched', 'In Transit',
  'At Destination', 'Customs Hold', 'Out for Delivery', 'Delivered', 'Delayed', 'Cancelled',
];

const IN_MOTION = ['Picked Up', 'Dispatched', 'In Transit', 'At Destination', 'Out for Delivery'];

/** Freight + other charges, in the transaction currency. */
function totalLogisticsCost(r: Record<string, unknown>): number {
  return (Number(r.freight_cost) || 0) + (Number(r.other_charges) || 0);
}

/** Delivery status follows the dates the user actually recorded, so nobody
 *  has to remember to move the dropdown as well as enter the date. Manual
 *  terminal states (Cancelled, Customs Hold, Delayed) are never overwritten. */
const AUTO_MANAGED = new Set(['', 'Planned', 'Pickup Scheduled', 'Picked Up', 'Dispatched', 'In Transit', 'At Destination', 'Out for Delivery']);

function deriveStatus(form: Record<string, string>): Record<string, string> | void {
  if (!AUTO_MANAGED.has(form.status ?? '')) return;
  if (form.actual_delivery_date) return { status: 'Delivered' };
  if (form.actual_departure_date) {
    if (form.estimated_arrival_date && new Date() > new Date(form.estimated_arrival_date)) return { status: 'Delayed' };
    return { status: 'In Transit' };
  }
  if (form.pickup_date) return { status: 'Picked Up' };
  return;
}

const convertFreight = (
  _v: string,
  _f: Record<string, string>,
  setForm: (u: (prev: Record<string, string>) => Record<string, string>) => void,
) => { void applyCurrencyConversion(setForm, {
  amount: 'freight_cost', currency: 'currency',
  rate: 'exchange_rate', baseCurrency: 'base_currency', baseValue: 'base_value',
  onDateField: 'pickup_date',
}); };

const config: TradingModuleConfig = {
  resource: '/trading/logistics',
  eyebrowModule: 'LOGISTICS',
  title: 'Logistics',
  description: 'Movement of goods against an existing shipment — carrier, route, tracking, milestone dates and freight cost. Commercial details come from the linked Shipment; nothing is re-entered here.',
  icon: '▥',
  emptyIcon: '▥',
  codeField: 'logistics_number',
  nameField: 'shipment_number',
  statusOptions: STATUSES,
  searchableKeys: ['logistics_number', 'shipment_number', 'deal_number', 'customer_name', 'supplier_name', 'carrier', 'tracking_number', 'vehicle_container_number', 'current_location'],
  fields: [
    { key: 'logistics_number', label: 'Logistics reference', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'LOG' },
    // The single point of entry. Everything commercial below is filled from
    // the shipment record rather than retyped, per the automation rule.
    {
      key: 'shipment_number',
      label: 'Shipment',
      type: 'lookup',
      required: true,
      listColumn: true,
      lookupResource: '/trading/shipments',
      lookupLabelKey: 'product_name',
      autoFillMap: {
        deal_number: 'deal_number',
        customer_name: 'customer_name',
        supplier_name: 'supplier_name',
        product_name: 'product_name',
        quantity: 'quantity',
        unit: 'unit',
        origin: 'origin',
        destination: 'destination',
        transporter: 'carrier',
        shipping_mode: 'shipping_mode',
        tracking_number: 'tracking_number',
        vehicle_container_number: 'vehicle_container_number',
        expected_delivery_date: 'estimated_arrival_date',
        actual_delivery_date: 'actual_delivery_date',
        freight_cost: 'freight_cost',
        currency: 'currency',
      },
      onValueChangeAsync: convertFreight,
    },
    // Read-only: these belong to the Shipment record. Shown for context and
    // traceability, edited there, never duplicated here.
    { key: 'deal_number', label: 'Deal', type: 'text', readOnly: true, group: 'From shipment' },
    { key: 'customer_name', label: 'Customer', type: 'text', readOnly: true, listColumn: true, group: 'From shipment' },
    { key: 'supplier_name', label: 'Supplier', type: 'text', readOnly: true, group: 'From shipment' },
    { key: 'product_name', label: 'Product', type: 'text', readOnly: true, group: 'From shipment' },
    { key: 'quantity', label: 'Quantity', type: 'number', readOnly: true, group: 'From shipment' },
    { key: 'unit', label: 'Unit', type: 'text', readOnly: true, group: 'From shipment' },

    { key: 'origin', label: 'Origin', type: 'text', listColumn: true, group: 'Route & carrier' },
    { key: 'destination', label: 'Destination', type: 'text', listColumn: true, group: 'Route & carrier' },
    { key: 'carrier', label: 'Carrier / transport provider', type: 'text', listColumn: true, group: 'Route & carrier' },
    { key: 'shipping_mode', label: 'Transport mode', type: 'select', options: SHIPPING_MODES, group: 'Route & carrier' },
    { key: 'tracking_number', label: 'Tracking number', type: 'text', group: 'Route & carrier' },
    { key: 'vehicle_container_number', label: 'Vehicle / container number', type: 'text', group: 'Route & carrier' },
    { key: 'driver_contact', label: 'Driver / carrier contact', type: 'text', group: 'Route & carrier' },
    { key: 'distance', label: 'Distance', type: 'text', group: 'Route & carrier', placeholder: 'e.g. 1,240 km' },
    { key: 'current_location', label: 'Current location', type: 'text', group: 'Route & carrier' },

    { key: 'pickup_date', label: 'Pickup date', type: 'date', group: 'Movement', onValueChange: (_v, f) => deriveStatus(f) },
    { key: 'estimated_departure_date', label: 'Estimated departure', type: 'date', group: 'Movement' },
    { key: 'actual_departure_date', label: 'Actual departure', type: 'date', group: 'Movement', onValueChange: (_v, f) => deriveStatus(f) },
    { key: 'estimated_arrival_date', label: 'Estimated arrival', type: 'date', listColumn: true, group: 'Movement', onValueChange: (_v, f) => deriveStatus(f) },
    { key: 'actual_delivery_date', label: 'Actual delivery', type: 'date', group: 'Movement', onValueChange: (_v, f) => deriveStatus(f) },
    { key: 'status', label: 'Delivery status', type: 'select', options: STATUSES, listColumn: true, group: 'Movement' },

    { key: 'freight_cost', label: 'Freight charges', type: 'number', group: 'Charges', onValueChangeAsync: convertFreight },
    { key: 'other_charges', label: 'Other transport charges', type: 'number', group: 'Charges' },
    {
      key: 'currency', label: 'Currency', type: 'lookup', group: 'Charges',
      lookupResource: '/trading/currency-rates', lookupValueKey: 'currency_code', lookupLabelKey: 'currency_name',
      onValueChangeAsync: convertFreight,
    },
    // Stored, not recomputed on render: a past shipment keeps the rate it
    // was actually costed at instead of silently re-pricing itself.
    { key: 'exchange_rate', label: 'Exchange rate applied', type: 'number', readOnly: true, group: 'Charges' },
    { key: 'base_currency', label: 'Company currency', type: 'text', readOnly: true, group: 'Charges' },
    { key: 'base_value', label: 'Freight in company currency', type: 'number', readOnly: true, group: 'Charges' },
    {
      key: 'total_cost', label: 'Total logistics cost', type: 'text', readOnly: true, listColumn: true,
      format: (_v, r) => `${r.currency ? `${r.currency} ` : ''}${totalLogisticsCost(r).toLocaleString()}`,
      group: 'Charges',
    },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Charges' },
  ],
  kpis: [
    { icon: '▥', iconClass: 'kpi-icon-ink', label: 'Active movements', value: (r) => String(r.filter((x) => !['Delivered', 'Cancelled'].includes(String(x.status))).length) },
    { icon: '↗', iconClass: 'kpi-icon-amber', label: 'In transit', value: (r) => String(r.filter((x) => IN_MOTION.includes(String(x.status))).length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pickup pending', value: (r) => String(r.filter((x) => ['Planned', 'Pickup Scheduled'].includes(String(x.status))).length) },
    { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Delayed', value: (r) => String(r.filter((x) => x.status === 'Delayed').length) },
    {
      icon: '⏱', iconClass: 'kpi-icon-school', label: 'On-time delivery',
      value: (r) => {
        const done = r.filter((x) => x.actual_delivery_date && x.estimated_arrival_date);
        if (!done.length) return '—';
        const onTime = done.filter((x) => new Date(x.actual_delivery_date as string) <= new Date(x.estimated_arrival_date as string));
        return `${Math.round((onTime.length / done.length) * 100)}%`;
      },
    },
    {
      icon: '₹', iconClass: 'kpi-icon-school', label: 'Freight cost (company currency)',
      value: (r) => {
        const total = r.reduce((sum, x) => sum + (Number(x.base_value) || Number(x.freight_cost) || 0), 0);
        const base = r.find((x) => x.base_currency)?.base_currency;
        return `${base ?? '₹'}${base ? ' ' : ''}${total.toLocaleString()}`;
      },
    },
  ],
  // Reverse traceability: from a movement, reach every neighbouring record
  // in the chain without hunting through other modules.
  detailExtra: (r) => (
    <LinkedRecords
      heading={`Chain for ${String(r.shipment_number ?? '')}`}
      links={[
        { title: 'Shipment', resource: '/trading/shipments', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.shipment, codeField: 'shipment_number', subField: 'status' },
        { title: 'Deal', resource: '/trading/deals', matchField: 'deal_number', matchValue: String(r.deal_number ?? ''), hash: TRADING_HASH.deal, codeField: 'deal_number', subField: 'deal_name' },
        { title: 'Import / export', resource: '/trading/import-export', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.importExport, codeField: 'transaction_number', subField: 'status' },
        { title: 'Customs', resource: '/trading/customs', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.customs, codeField: 'customs_reference', subField: 'clearance_status' },
        { title: 'Trade documents', resource: '/trading/documents', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.tradeDocuments, codeField: 'document_number', subField: 'document_type' },
        { title: 'Claims', resource: '/trading/claims', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.claims, codeField: 'claim_number', subField: 'status' },
      ]}
    />
  ),
 
};

export function LogisticsPage() {
  return <TradingMasterPage config={config} />;
}