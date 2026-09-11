import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const TRANSACTION_TYPES = ['Import', 'Export'];
const INSPECTION_STATUSES = ['Not Required', 'Pending', 'In Progress', 'Passed', 'Failed'];
const CLEARANCE_STATUSES = ['Not Started', 'Documentation Pending', 'Declaration Submitted', 'Under Review', 'Inspection Required', 'Duty Pending', 'Duty Paid', 'Cleared', 'Held', 'Rejected'];

const config: TradingModuleConfig = {
  resource: '/trading/customs',
  eyebrowModule: 'CUSTOMS & CLEARANCE',
  title: 'Customs & clearance',
  description: 'Customs documentation, declarations, duty and clearance status for import/export shipments — a shipment is not fully complete until this clears.',
  icon: '🛃',
  emptyIcon: '🛃',
  codeField: 'customs_reference',
  nameField: 'product_name',
  statusOptions: CLEARANCE_STATUSES,
  searchableKeys: ['customs_reference', 'shipment_number', 'transaction_number', 'customer_name', 'supplier_name', 'product_name', 'hs_code'],
  fields: [
    { key: 'customs_reference', label: 'Customs reference number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'CUS' },
{ key: 'shipment_number', label: 'Shipment', type: 'lookup', lookupResource: '/trading/shipments', lookupLabelKey: 'shipment_number', autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name' }, listColumn: true, group: 'Transaction' },
{ key: 'transaction_number', label: 'Trade transaction', type: 'lookup', lookupResource: '/trading/import-export', lookupLabelKey: 'transaction_number', autoFillMap: { transaction_type: 'transaction_type', customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name', country_of_origin: 'country_of_origin', destination_country: 'destination_country' }, group: 'Transaction' },
    { key: 'transaction_type', label: 'Import / export', type: 'select', options: TRANSACTION_TYPES, listColumn: true, group: 'Transaction' },
    { key: 'customer_name', label: 'Customer', type: 'text', group: 'Transaction' },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Transaction' },
    { key: 'product_name', label: 'Product', type: 'text', listColumn: true, group: 'Transaction' },
    { key: 'hs_code', label: 'HS code', type: 'text', listColumn: true, group: 'Transaction' },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Transaction' },
    { key: 'country_of_origin', label: 'Country of origin', type: 'text', group: 'Transaction' },
    { key: 'destination_country', label: 'Destination country', type: 'text', group: 'Transaction' },
    { key: 'port', label: 'Port', type: 'text', group: 'Transaction' },
    { key: 'declared_value', label: 'Declared value', type: 'number', group: 'Duty & cost' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Duty & cost' },
    { key: 'customs_broker', label: 'Customs broker', type: 'text', group: 'Duty & cost' },
    { key: 'declaration_date', label: 'Declaration date', type: 'date', group: 'Duty & cost' },
    { key: 'customs_duty', label: 'Customs duty', type: 'number', group: 'Duty & cost' },
    { key: 'other_charges', label: 'Other charges', type: 'number', group: 'Duty & cost' },
    {
      key: 'total_customs_cost',
      label: 'Total customs cost',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => `₹${((Number(r.customs_duty) || 0) + (Number(r.other_charges) || 0)).toLocaleString()}`,
      group: 'Duty & cost',
    },
    { key: 'inspection_status', label: 'Inspection status', type: 'select', options: INSPECTION_STATUSES, group: 'Clearance' },
    { key: 'clearance_date', label: 'Clearance date', type: 'date', group: 'Clearance' },
    { key: 'clearance_status', label: 'Clearance status', type: 'select', options: CLEARANCE_STATUSES, listColumn: true, group: 'Clearance' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Clearance' },
  ],
  kpis: [
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Customs pending', value: (r) => String(r.filter((x) => !['Cleared', 'Rejected'].includes(String(x.clearance_status))).length) },
    { icon: '⚖', iconClass: 'kpi-icon-school', label: 'Under review', value: (r) => String(r.filter((x) => x.clearance_status === 'Under Review' || x.clearance_status === 'Inspection Required').length) },
    { icon: '₹', iconClass: 'kpi-icon-amber', label: 'Duty pending', value: (r) => String(r.filter((x) => x.clearance_status === 'Duty Pending').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Cleared', value: (r) => String(r.filter((x) => x.clearance_status === 'Cleared').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Held / rejected', value: (r) => String(r.filter((x) => x.clearance_status === 'Held' || x.clearance_status === 'Rejected').length) },
    { icon: '₹', iconClass: 'kpi-icon-ink', label: 'Total customs duty', value: (r) => `₹${r.reduce((sum, x) => sum + (Number(x.customs_duty) || 0), 0).toLocaleString()}` },
  ],
  sampleRecords: [
    { id: 'demo-customs-1', customs_reference: 'CUS-0001', shipment_number: 'SHP-0001', transaction_number: 'TXN-0001', transaction_type: 'Export', customer_name: 'Al Habib Foods', supplier_name: 'Orient Traders', product_name: 'Basmati Rice', hs_code: '1006.30', quantity: 500, country_of_origin: 'India', destination_country: 'UAE', port: 'Chennai Port', declared_value: 350000, currency: 'USD', customs_broker: 'Chennai Customs Clearing Agency', declaration_date: '2026-08-27', customs_duty: 0, other_charges: 4500, inspection_status: 'Passed', clearance_date: '2026-08-28', clearance_status: 'Cleared' },
    { id: 'demo-customs-2', customs_reference: 'CUS-0002', shipment_number: 'SHP-0002', transaction_number: 'TXN-0002', transaction_type: 'Import', customer_name: 'Coastal Garments', supplier_name: 'Global Commodities Co', product_name: 'Cotton Yarn', hs_code: '5205.11', quantity: 200, country_of_origin: 'India', destination_country: 'India', port: 'Coimbatore ICD', declared_value: 4200000, currency: 'INR', customs_broker: 'Southern Freight Forwarders', declaration_date: '2026-09-07', customs_duty: 42000, other_charges: 6500, inspection_status: 'Pending', clearance_status: 'Duty Pending' },
  ],
};

export function CustomsClearancePage() {
  return <TradingMasterPage config={config} />;
}