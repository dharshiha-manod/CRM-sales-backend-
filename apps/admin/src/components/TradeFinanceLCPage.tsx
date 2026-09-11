import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const FINANCE_TYPES = ['Letter of Credit', 'Bank Guarantee', 'Documentary Collection', 'Advance Payment', 'Open Account', 'Other'];
const STATUSES = [
  'Draft', 'Requested', 'Application Submitted', 'Issued', 'Advised', 'Accepted', 'Documents Submitted',
  'Under Review', 'Discrepancy', 'Payment Pending', 'Paid', 'Expired', 'Cancelled', 'Closed',
];
const CLOSED_STATUSES = ['Paid', 'Expired', 'Cancelled', 'Closed'];

function expiryAlert(r: Record<string, unknown>): string {
  if (!r.expiry_date) return '—';
  if (CLOSED_STATUSES.includes(String(r.status))) return String(r.status);
  const days = Math.floor((new Date(r.expiry_date as string).getTime() - Date.now()) / 86400000);
  if (days < 0) return 'Expired';
  if (days <= 7) return 'Critical (≤7d)';
  if (days <= 15) return 'Important (≤15d)';
  if (days <= 30) return 'Warning (≤30d)';
  return 'OK';
}

const config: TradingModuleConfig = {
  resource: '/trading/trade-finance',
  eyebrowModule: 'TRADE FINANCE / LC MANAGEMENT',
  title: 'Trade finance / LC management',
  description: 'Letters of Credit and other trade finance instruments tied to a deal — tracked operationally through issue, shipment, document submission and payment. Not a banking or fund-transfer system.',
  icon: '₹',
  emptyIcon: '₹',
  codeField: 'lc_number',
  nameField: 'lc_type',
  statusOptions: STATUSES,
  searchableKeys: ['lc_number', 'deal_number', 'customer_name', 'supplier_name', 'issuing_bank', 'beneficiary'],
  fields: [
    { key: 'lc_number', label: 'LC number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'LC' },
    { key: 'lc_type', label: 'Trade finance type', type: 'select', options: FINANCE_TYPES, listColumn: true },
{ key: 'deal_number', label: 'Deal', type: 'lookup', lookupResource: '/trading/deals', lookupLabelKey: 'deal_name', autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', currency: 'currency' }, group: 'Parties' },
    { key: 'customer_name', label: 'Customer', type: 'text', group: 'Parties' },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Parties' },
    { key: 'issuing_bank', label: 'Issuing bank', type: 'text', group: 'Parties' },
    { key: 'advising_bank', label: 'Advising bank', type: 'text', group: 'Parties' },
    { key: 'confirming_bank', label: 'Confirming bank', type: 'text', group: 'Parties' },
    { key: 'applicant', label: 'Applicant', type: 'text', group: 'Parties' },
    { key: 'beneficiary', label: 'Beneficiary', type: 'text', group: 'Parties' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Value' },
    { key: 'lc_amount', label: 'LC amount', type: 'number', listColumn: true, group: 'Value' },
    { key: 'tolerance_percent', label: 'Tolerance %', type: 'number', group: 'Value' },
    { key: 'issue_date', label: 'Issue date', type: 'date', group: 'Timeline' },
    { key: 'expiry_date', label: 'Expiry date', type: 'date', listColumn: true, group: 'Timeline' },
    {
      key: 'expiry_alert',
      label: 'Expiry alert',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => expiryAlert(r),
      group: 'Timeline',
    },
    { key: 'latest_shipment_date', label: 'Latest shipment date', type: 'date', group: 'Timeline' },
    { key: 'presentation_period', label: 'Presentation period', type: 'text', group: 'Timeline', placeholder: 'e.g. 21 days from shipment' },
    { key: 'port_place', label: 'Port / place', type: 'text', group: 'Timeline' },
    { key: 'payment_terms', label: 'Payment terms', type: 'text', group: 'Requirements' },
    { key: 'document_requirements', label: 'Document requirements', type: 'textarea', group: 'Requirements' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Requirements' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Requirements' },
  ],
  kpis: [
    { icon: '₹', iconClass: 'kpi-icon-ink', label: 'Active LCs', value: (r) => String(r.filter((x) => !CLOSED_STATUSES.includes(String(x.status))).length) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'LC value', value: (r) => `₹${r.filter((x) => !CLOSED_STATUSES.includes(String(x.status))).reduce((sum, x) => sum + (Number(x.lc_amount) || 0), 0).toLocaleString()}` },
    { icon: '⚠', iconClass: 'kpi-icon-amber', label: 'Expiring (≤30 days)', value: (r) => String(r.filter((x) => { const a = expiryAlert(x); return a === 'Critical (≤7d)' || a === 'Important (≤15d)' || a === 'Warning (≤30d)'; }).length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Expired', value: (r) => String(r.filter((x) => expiryAlert(x) === 'Expired').length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Payment pending', value: (r) => String(r.filter((x) => x.status === 'Payment Pending').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Discrepancies', value: (r) => String(r.filter((x) => x.status === 'Discrepancy').length) },
  ],
  
};

export function TradeFinanceLCPage() {
  return <TradingMasterPage config={config} />;
}