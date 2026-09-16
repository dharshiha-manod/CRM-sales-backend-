import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const STATUSES = ['Draft', 'Sent', 'Supplier Responded', 'Under Comparison', 'Negotiation', 'Approved', 'Rejected', 'Converted to Deal', 'Closed'];

const config: TradingModuleConfig = {
  resource: '/trading/purchase-enquiries',
  eyebrowModule: 'PURCHASE ENQUIRY',
  title: 'Purchase enquiry',
  description: 'Send a requirement to one or more suppliers, capture their rates, and compare before selecting who to deal with.',
  icon: '❓',
  emptyIcon: '❓',
  codeField: 'enquiry_number',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['enquiry_number', 'product_name', 'supplier_name', 'procurement_person'],
  fields: [
    { key: 'enquiry_number', label: 'Enquiry number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'ENQ' },
    { key: 'enquiry_date', label: 'Enquiry date', type: 'date', listColumn: true },
    { key: 'required_by_date', label: 'Required by date', type: 'date', listColumn: true },
   { key: 'product_name', label: 'Product', type: 'lookup', required: true, lookupResource: '/products?status=active', lookupLabelKey: 'product_code', listColumn: true, group: 'Requirement', autoFillMap: { unit: 'unit' } },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Requirement' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Requirement' },
    { key: 'specification', label: 'Specification', type: 'textarea', group: 'Requirement' },
    { key: 'supplier_name', label: 'Supplier / vendor', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', listColumn: true, group: 'Supplier response' },
    { key: 'requested_rate', label: 'Requested / quoted rate', type: 'number', group: 'Supplier response' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Supplier response' },
    { key: 'delivery_location', label: 'Delivery location', type: 'text', group: 'Supplier response' },
    { key: 'delivery_terms', label: 'Delivery terms', type: 'text', group: 'Supplier response' },
    { key: 'payment_terms', label: 'Payment terms', type: 'text', group: 'Supplier response' },
    { key: 'procurement_person', label: 'Sales / procurement person', type: 'text', group: 'Supplier response' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Supplier response' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Supplier response' },
  ],
  kpis: [
    { icon: '❓', iconClass: 'kpi-icon-ink', label: 'Total enquiries', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pending supplier response', value: (r) => String(r.filter((x) => x.status === 'Sent').length) },
    { icon: '⚖', iconClass: 'kpi-icon-school', label: 'Under comparison', value: (r) => String(r.filter((x) => x.status === 'Under Comparison').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Converted', value: (r) => String(r.filter((x) => x.status === 'Converted to Deal').length) },
  ],
 
};

export function TradingPurchaseEnquiryPage() {
  return <TradingMasterPage config={config} />;
}