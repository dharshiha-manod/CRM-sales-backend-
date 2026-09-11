import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const DOC_TYPES = [
  'Proforma Invoice', 'Commercial Invoice', 'Purchase Order', 'Sales Order', 'Packing List',
  'Delivery Note', 'Bill of Lading', 'Airway Bill', 'Certificate of Origin', 'Insurance Certificate',
  'Inspection Certificate', 'Shipping Instructions', 'Transport Document', 'Other',
];
const VERIFICATION_STATUSES = ['Pending Verification', 'Verified', 'Rejected'];
const STATUSES = ['Draft', 'Uploaded', 'Pending Verification', 'Verified', 'Rejected', 'Expired', 'Archived'];

const config: TradingModuleConfig = {
  resource: '/trading/documents',
  eyebrowModule: 'TRADE DOCUMENTS',
  title: 'Trade documents',
  description: 'Documents required across deals, shipments and import/export activity — created, referenced, verified and archived against the deal or shipment they belong to.',
  icon: '📄',
  emptyIcon: '📄',
  codeField: 'document_id',
  nameField: 'document_number',
  statusOptions: STATUSES,
  searchableKeys: ['document_id', 'document_number', 'deal_number', 'shipment_number', 'customer_name', 'supplier_name'],
  fields: [
    { key: 'document_id', label: 'Document ID', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'DOC' },
    { key: 'document_number', label: 'Document number', type: 'text', required: true, listColumn: true },
    { key: 'document_type', label: 'Document type', type: 'select', options: DOC_TYPES, listColumn: true },
 { key: 'deal_number', label: 'Deal', type: 'lookup', lookupResource: '/trading/deals', lookupLabelKey: 'deal_name', autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name' }, group: 'Linked records' },
{ key: 'shipment_number', label: 'Shipment', type: 'lookup', lookupResource: '/trading/shipments', lookupLabelKey: 'shipment_number', autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name' }, group: 'Linked records' },
    { key: 'customer_name', label: 'Customer', type: 'text', group: 'Linked records' },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Linked records' },
    { key: 'product_name', label: 'Product', type: 'text', group: 'Linked records' },
    { key: 'reference_number', label: 'Reference number', type: 'text', group: 'Linked records' },
    { key: 'issue_date', label: 'Issue date', type: 'date', listColumn: true, group: 'Validity' },
    { key: 'expiry_date', label: 'Expiry date', type: 'date', listColumn: true, group: 'Validity' },
    { key: 'issued_by', label: 'Issued by', type: 'text', group: 'Validity' },
    { key: 'uploaded_by', label: 'Uploaded by', type: 'text', group: 'Validity' },
    { key: 'file_reference', label: 'File (link / reference)', type: 'text', group: 'Validity', placeholder: 'Paste a link to the stored file' },
    { key: 'verification_status', label: 'Verification status', type: 'select', options: VERIFICATION_STATUSES, listColumn: true, group: 'Status' },
    { key: 'status', label: 'Document status', type: 'select', options: STATUSES, listColumn: true, group: 'Status' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Status' },
  ],
  kpis: [
    { icon: '📄', iconClass: 'kpi-icon-ink', label: 'Total documents', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pending verification', value: (r) => String(r.filter((x) => x.verification_status === 'Pending Verification').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Verified', value: (r) => String(r.filter((x) => x.verification_status === 'Verified').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Rejected', value: (r) => String(r.filter((x) => x.verification_status === 'Rejected').length) },
    {
      icon: '⚠',
      iconClass: 'kpi-icon-red',
      label: 'Expiring documents',
      value: (r) => String(r.filter((x) => {
        if (!x.expiry_date) return false;
        const days = (new Date(x.expiry_date as string).getTime() - Date.now()) / 86400000;
        return days >= 0 && days <= 30;
      }).length),
    },
  ],
 
};

export function TradeDocumentsPage() {
  return <TradingMasterPage config={config} />;
}