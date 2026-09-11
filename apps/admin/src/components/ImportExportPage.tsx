import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const TRANSACTION_TYPES = ['Import', 'Export'];
const SHIPPING_MODES = ['Road', 'Air', 'Sea', 'Rail', 'Courier'];
const STATUSES = ['Draft', 'Documentation Pending', 'Ready for Shipment', 'Shipped', 'In Transit', 'Customs Pending', 'Customs Clearance', 'Cleared', 'Delivered', 'Completed', 'Cancelled'];

const config: TradingModuleConfig = {
  resource: '/trading/import-export',
  eyebrowModule: 'IMPORT / EXPORT MANAGEMENT',
  title: 'Import / export management',
  description: 'International transactions — import from a supplier or export to a customer — tying together the deal, shipment, ports and customs status.',
  icon: '⇄',
  emptyIcon: '⇄',
  codeField: 'transaction_number',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['transaction_number', 'deal_number', 'customer_name', 'supplier_name', 'product_name', 'invoice_number', 'shipment_number'],
  fields: [
    { key: 'transaction_number', label: 'Trade transaction number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'TXN' },
    { key: 'transaction_type', label: 'Transaction type', type: 'select', options: TRANSACTION_TYPES, required: true, listColumn: true },
{ key: 'deal_number', label: 'Deal', type: 'lookup', lookupResource: '/trading/deals', lookupLabelKey: 'deal_name', autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name', quantity: 'quantity', unit: 'unit', currency: 'currency' }, group: 'Parties' },
    { key: 'customer_name', label: 'Customer', type: 'text', group: 'Parties' },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Parties' },
    { key: 'product_name', label: 'Product', type: 'text', listColumn: true, group: 'Parties' },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Parties' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Parties' },
    { key: 'country_of_origin', label: 'Country of origin', type: 'text', listColumn: true, group: 'Route' },
    { key: 'destination_country', label: 'Destination country', type: 'text', listColumn: true, group: 'Route' },
    { key: 'port_of_loading', label: 'Port of loading', type: 'text', group: 'Route' },
    { key: 'port_of_discharge', label: 'Port of discharge', type: 'text', group: 'Route' },
    { key: 'shipment_number', label: 'Shipment', type: 'lookup', lookupResource: '/trading/shipments', lookupLabelKey: 'shipment_number', group: 'Route' },
    { key: 'shipping_mode', label: 'Shipping mode', type: 'select', options: SHIPPING_MODES, group: 'Route' },
    { key: 'invoice_number', label: 'Invoice number', type: 'text', group: 'Value' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Value' },
    { key: 'total_value', label: 'Total value', type: 'number', listColumn: true, group: 'Value' },
    { key: 'incoterm', label: 'Incoterm', type: 'text', group: 'Value', placeholder: 'e.g. FOB, CIF, EXW' },
    { key: 'expected_shipment_date', label: 'Expected shipment date', type: 'date', group: 'Schedule' },
    { key: 'expected_arrival_date', label: 'Expected arrival date', type: 'date', group: 'Schedule' },
    { key: 'actual_arrival_date', label: 'Actual arrival date', type: 'date', group: 'Schedule' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Schedule' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Schedule' },
  ],
  kpis: [
    { icon: '⇄', iconClass: 'kpi-icon-ink', label: 'Import transactions', value: (r) => String(r.filter((x) => x.transaction_type === 'Import').length) },
    { icon: '⇄', iconClass: 'kpi-icon-ink', label: 'Export transactions', value: (r) => String(r.filter((x) => x.transaction_type === 'Export').length) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Import value', value: (r) => `₹${r.filter((x) => x.transaction_type === 'Import').reduce((sum, x) => sum + (Number(x.total_value) || 0), 0).toLocaleString()}` },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Export value', value: (r) => `₹${r.filter((x) => x.transaction_type === 'Export').reduce((sum, x) => sum + (Number(x.total_value) || 0), 0).toLocaleString()}` },
    { icon: '⚖', iconClass: 'kpi-icon-amber', label: 'Customs pending', value: (r) => String(r.filter((x) => x.status === 'Customs Pending' || x.status === 'Customs Clearance').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Completed', value: (r) => String(r.filter((x) => x.status === 'Completed').length) },
  ],
  sampleRecords: [
    { id: 'demo-impexp-1', transaction_number: 'TXN-0001', transaction_type: 'Export', deal_number: 'DEAL-0001', customer_name: 'Al Habib Foods', supplier_name: 'Orient Traders', product_name: 'Basmati Rice', quantity: 500, unit: 'MT', country_of_origin: 'India', destination_country: 'UAE', port_of_loading: 'Chennai Port', port_of_discharge: 'Jebel Ali Port', shipment_number: 'SHP-0001', shipping_mode: 'Sea', invoice_number: 'CI-2026-0091', currency: 'USD', total_value: 350000, incoterm: 'CIF', expected_shipment_date: '2026-08-28', expected_arrival_date: '2026-09-20', status: 'In Transit' },
    { id: 'demo-impexp-2', transaction_number: 'TXN-0002', transaction_type: 'Import', customer_name: 'Coastal Garments', supplier_name: 'Global Commodities Co', product_name: 'Cotton Yarn', quantity: 200, unit: 'Ton', country_of_origin: 'India', destination_country: 'India', port_of_loading: 'Coimbatore', port_of_discharge: 'Tiruppur', shipment_number: 'SHP-0002', shipping_mode: 'Road', currency: 'INR', total_value: 4200000, incoterm: 'EXW', expected_shipment_date: '2026-09-08', actual_arrival_date: '2026-09-09', status: 'Delivered' },
  ],
};

export function ImportExportPage() {
  return <TradingMasterPage config={config} />;
}