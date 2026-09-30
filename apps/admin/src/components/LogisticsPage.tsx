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

/** Freight + other charges, in the transaction currency (e.g. USD 5,500). */
function totalLogisticsCost(r: Record<string, unknown>): number {
  return (Number(r.freight_cost) || 0) + (Number(r.other_charges) || 0);
}

/** Freight + other charges, in the COMPANY currency (e.g. INR 5,30,750), using the rate stored on the record.
 *  Other charges are converted with the same rate as freight, so nothing is left out. */
function totalInCompanyCurrency(r: Record<string, unknown>): number {
  const rate = Number(r.exchange_rate) || 0;
  if (rate <= 0) return totalLogisticsCost(r);          // no conversion stored: treated as already in company currency
  const freightBase = Number(r.base_value) || (Number(r.freight_cost) || 0) * rate;
  return freightBase + (Number(r.other_charges) || 0) * rate;
}

/** Delivery status follows the dates the user actually recorded, so nobody
 *  has to remember to move the dropdown as well as enter the date. Manual
 *  terminal states (Cancelled, Customs Hold, Delayed) are never overwritten. */
const AUTO_MANAGED = new Set(['', 'Planned', 'Pickup Scheduled', 'Picked Up', 'Dispatched', 'In Transit', 'At Destination', 'Out for Delivery']);

/** True when the date is later than tomorrow (one day of slack for time zones). The API refuses it too. */
const isFutureDate = (d: string | undefined): boolean => Boolean(d) && String(d).slice(0, 10) > new Date(Date.now() + 864e5).toISOString().slice(0, 10);

function deriveStatus(form: Record<string, string>): Record<string, string> | void {
  if (!AUTO_MANAGED.has(form.status ?? '')) return;
  // A delivery date in the future has not happened yet: it must not mark the movement Delivered.
  if (form.actual_delivery_date && !isFutureDate(form.actual_delivery_date)) return { status: 'Delivered' };
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
  description: 'Transport plan for each shipment — carrier, route, tracking, milestone dates and freight. A plan is created automatically with every shipment; complete it here before the shipment is dispatched.',
  icon: '▥',
  emptyIcon: '▥',
  codeField: 'logistics_number',
  nameField: 'shipment_number',
  statusOptions: STATUSES,
  fitToScreen: true,
  searchableKeys: ['logistics_number', 'shipment_number', 'deal_number', 'customer_name', 'supplier_name', 'carrier', 'tracking_number', 'vehicle_container_number', 'current_location'],
  fields: [
    {
      key: 'logistics_number', label: 'Logistics reference', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'LOG',
      render: (_v, r) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <strong style={{ fontWeight: 600 }}>{String(r.logistics_number ?? '—')}</strong>
          <span style={{ color: '#64748b', fontSize: '.74rem' }}>{r.shipment_number ? String(r.shipment_number) : 'No shipment'}</span>
        </span>
      ),
    },
    // The single point of entry. Everything commercial below is filled from
    // the shipment record rather than retyped, per the automation rule.
    {
      key: 'shipment_number',
      label: 'Shipment',
      type: 'lookup',
      required: true,
      helpText: 'Every shipment already has a plan. Open and edit its existing plan instead of adding a new one.',
      lookupResource: '/trading/shipments',
      lookupLabelKey: 'product_name',
      // Only the facts that belong to the SHIPMENT are copied in (who, what, how much). Route, carrier, dates, freight
      // and currency belong to Logistics now, so picking a shipment must never overwrite what was typed for them.
      autoFillMap: {
        deal_number: 'deal_number',
        customer_name: 'customer_name',
        supplier_name: 'supplier_name',
        product_name: 'product_name',
        quantity: 'quantity',
        unit: 'unit',
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

    {
      key: 'origin', label: 'Route / carrier', type: 'text', listColumn: true, group: 'Route & carrier (needed before dispatch)',
      render: (_v, r) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <span>{r.origin || r.destination ? `${String(r.origin || '—')} → ${String(r.destination || '—')}` : '—'}</span>
          <span style={{ color: '#64748b', fontSize: '.74rem' }}>{r.carrier ? String(r.carrier) : 'No carrier'}</span>
        </span>
      ),
    },
    { key: 'destination', label: 'Destination', type: 'text', group: 'Route & carrier (needed before dispatch)' },
    { key: 'carrier', label: 'Carrier / transport provider', type: 'text', group: 'Route & carrier (needed before dispatch)' },
    { key: 'shipping_mode', label: 'Transport mode', type: 'select', options: SHIPPING_MODES, group: 'Route & carrier (needed before dispatch)' },
    { key: 'tracking_number', label: 'Tracking number', type: 'text', group: 'Route & carrier (needed before dispatch)' },
    { key: 'vehicle_container_number', label: 'Vehicle / container number', type: 'text', group: 'Route & carrier (needed before dispatch)' },
    { key: 'driver_contact', label: 'Driver / carrier contact', type: 'text', group: 'Route & carrier (needed before dispatch)' },
    { key: 'distance', label: 'Distance', type: 'text', group: 'Route & carrier (needed before dispatch)', placeholder: 'e.g. 1,240 km' },
    { key: 'current_location', label: 'Current location', type: 'text', group: 'Route & carrier (needed before dispatch)' },

    { key: 'pickup_date', label: 'Pickup date', type: 'date', group: 'Movement', helpText: 'A pickup date or an estimated departure is needed before dispatch.', onValueChange: (_v, f) => deriveStatus(f) },
    { key: 'estimated_departure_date', label: 'Estimated departure', type: 'date', group: 'Movement' },
    { key: 'actual_departure_date', label: 'Actual departure', type: 'date', group: 'Movement', onValueChange: (_v, f) => deriveStatus(f) },
    { key: 'estimated_arrival_date', label: 'Estimated arrival', type: 'date', listColumn: true, group: 'Movement', onValueChange: (_v, f) => deriveStatus(f) },
    { key: 'actual_delivery_date', label: 'Actual delivery', type: 'date', group: 'Movement', helpText: 'The date the goods were really delivered - it cannot be in the future.', onValueChange: (_v, f) => deriveStatus(f) },
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
      render: (_v, r) => {
        const own = `${r.currency ? `${r.currency} ` : ''}${totalLogisticsCost(r).toLocaleString()}`;
        const converted = r.currency && r.base_currency && r.currency !== r.base_currency && Number(r.exchange_rate) > 0;
        return (
          <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <strong style={{ fontWeight: 600 }}>{own}</strong>
            {converted && <span style={{ color: '#64748b', fontSize: '.74rem' }}>{`${String(r.base_currency)} ${totalInCompanyCurrency(r).toLocaleString()}`}</span>}
          </span>
        );
      },
      format: (_v, r) => {
        const own = `${r.currency ? `${r.currency} ` : ''}${totalLogisticsCost(r).toLocaleString()}`;
        const converted = r.currency && r.base_currency && r.currency !== r.base_currency && Number(r.exchange_rate) > 0;
        return converted ? `${own}  (${r.base_currency} ${totalInCompanyCurrency(r).toLocaleString()})` : own;
      },
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
      icon: '₹', iconClass: 'kpi-icon-school', label: 'Total logistics cost (company currency)',
      value: (r) => {
        const total = r.reduce((sum, x) => sum + totalInCompanyCurrency(x), 0);
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