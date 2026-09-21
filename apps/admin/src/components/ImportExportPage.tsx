// FILE: admin/src/components/ImportExportPage.tsx
// Rewritten for automation. The shipment lookup previously copied nothing,
// so selecting a shipment left the user retyping origin, destination,
// ports, mode and dates that already existed on that record. Now the
// transaction is built from whichever upstream record it came from —
// order, deal or shipment — and currency conversion comes from Currency
// Management instead of being done in the user's head.
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { LinkedRecords } from './LinkedRecords';
import { TRADING_HASH } from '../lib/recordFocus';
import { applyCurrencyConversion } from '../lib/currencyLookup';

const TRANSACTION_TYPES = ['Import', 'Export'];
const SHIPPING_MODES = ['Road', 'Air', 'Sea', 'Rail', 'Courier', 'Multimodal'];
const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const STATUSES = [
  'Draft', 'Documentation Pending', 'Ready for Shipment', 'Shipped', 'In Transit',
  'Customs Pending', 'Customs Clearance', 'Cleared', 'Delivered', 'Completed', 'Cancelled',
];

// Documents an import/export transaction is normally expected to carry.
// Selected from the Trade Documents already raised against this deal or
// shipment — not typed, and not a second copy of the document itself.
const convertValue = (
  _v: string,
  _f: Record<string, string>,
  setForm: (u: (prev: Record<string, string>) => Record<string, string>) => void,
) => { void applyCurrencyConversion(setForm, {
  amount: 'total_value', currency: 'currency',
  rate: 'exchange_rate', baseCurrency: 'base_currency', baseValue: 'base_value',
  onDateField: 'expected_shipment_date',
}); };

/** Import = goods coming in from a supplier; Export = goods going out to a
 *  customer. Setting the type tells us which party matters, so the form
 *  stops asking for the one that doesn't apply. */
const isImport = (f: Record<string, string>) => f.transaction_type === 'Import';
const isExport = (f: Record<string, string>) => f.transaction_type === 'Export';

const config: TradingModuleConfig = {
  resource: '/trading/import-export',
  eyebrowModule: 'IMPORT / EXPORT MANAGEMENT',
  title: 'Import / export management',
  description: 'International transactions built from an existing order, deal or shipment — parties, products, value, route and milestones, feeding straight into Customs.',
  icon: '⇄',
  emptyIcon: '⇄',
  codeField: 'transaction_number',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['transaction_number', 'deal_number', 'order_number', 'customer_name', 'supplier_name', 'product_name', 'invoice_number', 'shipment_number'],
  fields: [
    { key: 'transaction_number', label: 'Trade transaction number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'TXN' },
    { key: 'transaction_type', label: 'Transaction type', type: 'select', options: TRANSACTION_TYPES, required: true, listColumn: true },

    // Source records. Pick whichever the transaction actually originates
    // from — each fills the commercial side from the existing record.
    {
      key: 'shipment_number', label: 'Shipment', type: 'lookup', listColumn: true,
      lookupResource: '/trading/shipments', lookupLabelKey: 'product_name',
      autoFillMap: {
        deal_number: 'deal_number',
        customer_name: 'customer_name',
        supplier_name: 'supplier_name',
        product_name: 'product_name',
        quantity: 'quantity',
        unit: 'unit',
        origin: 'port_of_loading',
        destination: 'port_of_discharge',
        shipping_mode: 'shipping_mode',
        expected_delivery_date: 'expected_arrival_date',
        actual_delivery_date: 'actual_arrival_date',
        shipment_date: 'expected_shipment_date',
      },
      onValueChangeAsync: convertValue,
      group: 'Source records',
    },
    {
      key: 'order_number', label: 'Sales order', type: 'lookup',
      lookupResource: '/trading/sales-orders', lookupLabelKey: 'product_name',
      autoFillMap: {
        deal_number: 'deal_number',
        customer_name: 'customer_name',
        product_name: 'product_name',
        quantity: 'quantity',
        unit: 'unit',
        currency: 'currency',
        total_amount: 'total_value',
        expected_delivery_date: 'expected_arrival_date',
      },
      onValueChangeAsync: convertValue,
      group: 'Source records',
      visibleIf: (f) => !isImport(f),
    },
    {
      key: 'purchase_enquiry', label: 'Purchase enquiry', type: 'lookup',
      lookupResource: '/trading/purchase-enquiries', lookupValueKey: 'enquiry_number', lookupLabelKey: 'product_name',
      autoFillMap: {
        deal_number: 'deal_number',
        supplier_name: 'supplier_name',
        product_name: 'product_name',
        quantity: 'quantity',
        unit: 'unit',
        currency: 'currency',
      },
      onValueChangeAsync: convertValue,
      group: 'Source records',
      visibleIf: (f) => !isExport(f),
    },
    {
      key: 'deal_number', label: 'Deal', type: 'lookup',
      lookupResource: '/trading/deals', lookupLabelKey: 'deal_name',
      autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name', quantity: 'quantity', unit: 'unit', currency: 'currency' },
      onValueChangeAsync: convertValue,
      group: 'Source records',
    },

    // Parties come from the records above. Customer is a Core-module client
    // lookup, supplier a Trading supplier lookup — never a new record here.
    { key: 'customer_name', label: 'Customer', type: 'lookup', lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_code', group: 'Parties', visibleIf: (f) => !isImport(f) },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Parties', visibleIf: (f) => !isExport(f) },
    { key: 'product_name', label: 'Product', type: 'text', listColumn: true, group: 'Parties' },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Parties' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Parties' },

    { key: 'country_of_origin', label: 'Country of origin', type: 'text', listColumn: true, group: 'Route' },
    { key: 'destination_country', label: 'Destination country', type: 'text', listColumn: true, group: 'Route' },
    { key: 'port_of_loading', label: 'Port of loading', type: 'text', group: 'Route' },
    { key: 'port_of_discharge', label: 'Port of discharge', type: 'text', group: 'Route' },
    { key: 'shipping_mode', label: 'Shipping mode', type: 'select', options: SHIPPING_MODES, group: 'Route' },
    { key: 'incoterm', label: 'Incoterm', type: 'select', options: INCOTERMS, group: 'Route' },

    { key: 'invoice_number', label: 'Invoice number', type: 'text', group: 'Value' },
    {
      key: 'currency', label: 'Currency', type: 'lookup', group: 'Value',
      lookupResource: '/trading/currency-rates', lookupValueKey: 'currency_code', lookupLabelKey: 'currency_name',
      onValueChangeAsync: convertValue,
    },
    { key: 'total_value', label: 'Total value', type: 'number', listColumn: true, group: 'Value', onValueChangeAsync: convertValue },
    { key: 'exchange_rate', label: 'Exchange rate applied', type: 'number', readOnly: true, group: 'Value' },
    { key: 'base_currency', label: 'Company currency', type: 'text', readOnly: true, group: 'Value' },
    { key: 'base_value', label: 'Value in company currency', type: 'number', readOnly: true, listColumn: true, group: 'Value' },

    // Documents already raised against this deal/shipment in Trade
    // Documents. Referenced by number — the document itself stays in Trade
    // Documents, which remains its single source of truth.
    {
      key: 'required_documents', label: 'Linked trade documents', type: 'multi-lookup',
      lookupResource: '/trading/documents', lookupValueKey: 'document_number', lookupLabelKey: 'document_type',
      group: 'Documents & milestones',
    },
    { key: 'expected_shipment_date', label: 'Expected shipment date', type: 'date', group: 'Documents & milestones', onValueChangeAsync: convertValue },
    { key: 'expected_arrival_date', label: 'Expected arrival date', type: 'date', group: 'Documents & milestones' },
    { key: 'actual_arrival_date', label: 'Actual arrival date', type: 'date', group: 'Documents & milestones' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Documents & milestones' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Documents & milestones' },
  ],
  kpis: [
    { icon: '⇄', iconClass: 'kpi-icon-ink', label: 'Import transactions', value: (r) => String(r.filter((x) => x.transaction_type === 'Import').length) },
    { icon: '⇄', iconClass: 'kpi-icon-ink', label: 'Export transactions', value: (r) => String(r.filter((x) => x.transaction_type === 'Export').length) },
    {
      icon: '₹', iconClass: 'kpi-icon-school', label: 'Import value (company currency)',
      value: (r) => r.filter((x) => x.transaction_type === 'Import').reduce((s, x) => s + (Number(x.base_value) || 0), 0).toLocaleString(),
    },
    {
      icon: '₹', iconClass: 'kpi-icon-school', label: 'Export value (company currency)',
      value: (r) => r.filter((x) => x.transaction_type === 'Export').reduce((s, x) => s + (Number(x.base_value) || 0), 0).toLocaleString(),
    },
    { icon: '⚖', iconClass: 'kpi-icon-amber', label: 'Customs pending', value: (r) => String(r.filter((x) => x.status === 'Customs Pending' || x.status === 'Customs Clearance').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Completed', value: (r) => String(r.filter((x) => x.status === 'Completed').length) },
  ],
  detailExtra: (r) => (
    <LinkedRecords
      heading={`Chain for ${String(r.transaction_number ?? '')}`}
      links={[
        { title: 'Shipment', resource: '/trading/shipments', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.shipment, codeField: 'shipment_number', subField: 'status' },
        { title: 'Logistics', resource: '/trading/logistics', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.logistics, codeField: 'logistics_number', subField: 'status' },
        { title: 'Customs', resource: '/trading/customs', matchField: 'transaction_number', matchValue: String(r.transaction_number ?? ''), hash: TRADING_HASH.customs, codeField: 'customs_reference', subField: 'clearance_status' },
        { title: 'Trade documents', resource: '/trading/documents', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.tradeDocuments, codeField: 'document_number', subField: 'document_type' },
        { title: 'Deal', resource: '/trading/deals', matchField: 'deal_number', matchValue: String(r.deal_number ?? ''), hash: TRADING_HASH.deal, codeField: 'deal_number', subField: 'deal_name' },
        { title: 'Claims', resource: '/trading/claims', matchField: 'transaction_number', matchValue: String(r.transaction_number ?? ''), hash: TRADING_HASH.claims, codeField: 'claim_number', subField: 'status' },
      ]}
    />
  ),
  
};

export function ImportExportPage() {
  return <TradingMasterPage config={config} />;
}