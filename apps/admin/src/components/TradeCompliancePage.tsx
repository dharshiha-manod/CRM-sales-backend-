import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const COMPLIANCE_TYPES = [
  'Document Compliance', 'Product Compliance', 'Supplier Compliance', 'Customer Compliance',
  'Country Compliance', 'Import Compliance', 'Export Compliance', 'Shipment Compliance', 'Internal Policy Compliance',
];
const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
const DOCUMENT_STATUSES = ['Complete', 'Incomplete', 'Missing'];
const APPROVAL_STATUSES = ['Not Required', 'Pending', 'Approved', 'Rejected'];
const STATUSES = ['Not Checked', 'Pending Review', 'Passed', 'Failed', 'Exception Requested', 'Exception Approved', 'Exception Rejected', 'Resolved', 'Closed'];

const config: TradingModuleConfig = {
  resource: '/trading/compliance',
  eyebrowModule: 'TRADE COMPLIANCE MANAGEMENT',
  title: 'Trade compliance management',
  description: 'Internal compliance checks against documentation, product, country and policy requirements for a deal, shipment or import/export transaction. Not legal advice — configurable internal checks only.',
  icon: '✓',
  emptyIcon: '✓',
  codeField: 'compliance_reference',
  nameField: 'compliance_type',
  statusOptions: STATUSES,
  searchableKeys: ['compliance_reference', 'deal_number', 'customer_name', 'supplier_name', 'product_name', 'country', 'hs_code'],
  fields: [
    { key: 'compliance_reference', label: 'Compliance reference', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'CMP' },
    { key: 'compliance_type', label: 'Compliance type', type: 'select', options: COMPLIANCE_TYPES, required: true, listColumn: true },
    { key: 'deal_number', label: 'Deal', type: 'lookup', lookupResource: '/trading/deals', lookupLabelKey: 'deal_name', group: 'Linked records' },
    { key: 'customer_name', label: 'Customer', type: 'text', group: 'Linked records' },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Linked records' },
    { key: 'product_name', label: 'Product', type: 'text', group: 'Linked records' },
    { key: 'shipment_number', label: 'Shipment', type: 'lookup', lookupResource: '/trading/shipments', lookupLabelKey: 'shipment_number', group: 'Linked records' },
    { key: 'transaction_number', label: 'Import/export transaction', type: 'lookup', lookupResource: '/trading/import-export', lookupLabelKey: 'transaction_number', group: 'Linked records' },
    { key: 'country', label: 'Country', type: 'text', listColumn: true, group: 'Linked records' },
    { key: 'hs_code', label: 'HS code', type: 'text', group: 'Linked records' },
    { key: 'document_status', label: 'Document status', type: 'select', options: DOCUMENT_STATUSES, group: 'Check' },
    { key: 'risk_level', label: 'Risk level', type: 'select', options: RISK_LEVELS, listColumn: true, group: 'Check' },
    { key: 'check_date', label: 'Check date', type: 'date', group: 'Check' },
    { key: 'checked_by', label: 'Checked by', type: 'text', group: 'Check' },
    { key: 'required_action', label: 'Required action', type: 'textarea', group: 'Check' },
    { key: 'due_date', label: 'Due date', type: 'date', listColumn: true, group: 'Check' },
    { key: 'approval_status', label: 'Approval status', type: 'select', options: APPROVAL_STATUSES, group: 'Resolution' },
    { key: 'exception_reason', label: 'Exception reason', type: 'textarea', group: 'Resolution' },
    { key: 'resolution', label: 'Resolution', type: 'textarea', group: 'Resolution' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Resolution' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Resolution' },
  ],
  kpis: [
    { icon: '✓', iconClass: 'kpi-icon-ink', label: 'Total checks', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Passed', value: (r) => String(r.filter((x) => x.status === 'Passed' || x.status === 'Resolved').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Failed', value: (r) => String(r.filter((x) => x.status === 'Failed').length) },
    { icon: '⚠', iconClass: 'kpi-icon-red', label: 'High / critical risk', value: (r) => String(r.filter((x) => x.risk_level === 'High' || x.risk_level === 'Critical').length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Open exceptions', value: (r) => String(r.filter((x) => x.status === 'Exception Requested').length) },
    {
      icon: '⏰',
      iconClass: 'kpi-icon-red',
      label: 'Overdue items',
      value: (r) => String(r.filter((x) => x.due_date && !['Resolved', 'Closed'].includes(String(x.status)) && new Date(x.due_date as string).getTime() < Date.now()).length),
    },
  
  
  ],
};

export function TradeCompliancePage() {
  return <TradingMasterPage config={config} />;
}