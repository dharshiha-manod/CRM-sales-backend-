import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const CLAIM_TYPES = [
  'Quantity Shortage', 'Wrong Product', 'Damaged Goods', 'Quality Issue', 'Delivery Delay',
  'Missing Goods', 'Price Dispute', 'Invoice Dispute', 'Payment Dispute', 'Documentation Issue',
  'Shipment Issue', 'Customs Issue', 'Freight Issue', 'Product Specification Issue', 'Other',
];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const RESPONSIBLE_PARTIES = ['Company', 'Customer', 'Supplier', 'Logistics Provider', 'Under Investigation'];
const STATUSES = [
  'Draft', 'Submitted', 'Under Review', 'Investigation', 'Awaiting Customer', 'Awaiting Supplier',
  'Awaiting Logistics', 'Negotiation', 'Approved', 'Partially Resolved', 'Resolved', 'Rejected', 'Closed',
];
const OPEN_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Investigation', 'Awaiting Customer', 'Awaiting Supplier', 'Awaiting Logistics', 'Negotiation', 'Approved', 'Partially Resolved'];

function daysSince(date: unknown): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date as string).getTime()) / 86400000);
}

const config: TradingModuleConfig = {
  resource: '/trading/claims',
  eyebrowModule: 'CLAIMS & DISPUTES',
  title: 'Claims & disputes',
  description: 'Commercial, shipment, product and payment disputes with customers, suppliers and logistics partners — from submission through investigation to resolution.',
  icon: '⚠',
  emptyIcon: '⚠',
  codeField: 'claim_number',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['claim_number', 'customer_name', 'supplier_name', 'deal_number', 'shipment_number', 'product_name', 'invoice_number', 'assigned_to'],
  fields: [
    { key: 'claim_number', label: 'Claim number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'CLM' },
    { key: 'claim_date', label: 'Claim date', type: 'date', listColumn: true },
    { key: 'claim_type', label: 'Claim type', type: 'select', options: CLAIM_TYPES, listColumn: true },
    { key: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, group: 'Classification' },
    { key: 'severity', label: 'Severity', type: 'select', options: SEVERITIES, listColumn: true, group: 'Classification' },
    { key: 'claim_source', label: 'Claim source', type: 'text', group: 'Classification', placeholder: 'e.g. Customer complaint, internal QC' },
    { key: 'customer_name', label: 'Customer', type: 'text', listColumn: true, group: 'Linked records' },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Linked records' },
 { key: 'deal_number', label: 'Deal', type: 'lookup', lookupResource: '/trading/deals', lookupLabelKey: 'deal_name', autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name' }, group: 'Linked records' },
    { key: 'purchase_enquiry', label: 'Purchase enquiry', type: 'lookup', lookupResource: '/trading/purchase-enquiries', lookupLabelKey: 'product_name', group: 'Linked records' },
{ key: 'shipment_number', label: 'Shipment', type: 'lookup', lookupResource: '/trading/shipments', lookupLabelKey: 'shipment_number', autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name' }, group: 'Linked records' },
    { key: 'logistics_provider', label: 'Logistics provider', type: 'text', group: 'Linked records' },
    { key: 'product_name', label: 'Product', type: 'text', group: 'Linked records' },
    { key: 'product_code', label: 'Product code', type: 'text', group: 'Linked records' },
    { key: 'batch_number', label: 'Batch number', type: 'text', group: 'Linked records' },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Claim value' },
    { key: 'claimed_value', label: 'Claimed value', type: 'number', listColumn: true, group: 'Claim value' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Claim value' },
    { key: 'invoice_number', label: 'Invoice number', type: 'text', group: 'Claim value' },
    { key: 'order_number', label: 'Order number', type: 'text', group: 'Claim value' },
    { key: 'document_reference', label: 'Document reference', type: 'text', group: 'Claim value' },
    { key: 'description', label: 'Description', type: 'textarea', group: 'Claim value' },
    { key: 'evidence_documents', label: 'Evidence / documents (link)', type: 'text', group: 'Claim value' },
    { key: 'reported_by', label: 'Reported by', type: 'text', group: 'Handling' },
    { key: 'assigned_to', label: 'Assigned to', type: 'text', listColumn: true, group: 'Handling' },
    { key: 'department', label: 'Department', type: 'text', group: 'Handling' },
    { key: 'responsible_party', label: 'Responsible party', type: 'select', options: RESPONSIBLE_PARTIES, group: 'Handling' },
    { key: 'expected_resolution_date', label: 'Expected resolution date', type: 'date', listColumn: true, group: 'Handling' },
    { key: 'actual_resolution_date', label: 'Actual resolution date', type: 'date', group: 'Handling' },
    {
      key: 'sla_flag',
      label: 'SLA',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => {
        if (['Resolved', 'Rejected', 'Closed'].includes(String(r.status))) return String(r.status);
        if (!r.expected_resolution_date) return '—';
        const days = Math.floor((new Date(r.expected_resolution_date as string).getTime() - Date.now()) / 86400000);
        if (days < 0) return `Overdue by ${Math.abs(days)}d`;
        if (days <= 2) return 'Due soon';
        return 'On track';
      },
      group: 'Handling',
    },
    { key: 'resolution', label: 'Resolution', type: 'textarea', group: 'Resolution' },
    { key: 'compensation_amount', label: 'Compensation amount', type: 'number', group: 'Resolution' },
    { key: 'credit_note_reference', label: 'Credit note reference', type: 'text', group: 'Resolution' },
    { key: 'replacement_reference', label: 'Replacement reference', type: 'text', group: 'Resolution' },
    { key: 'refund_amount', label: 'Refund amount', type: 'number', group: 'Resolution' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Resolution' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Resolution' },
  ],
  kpis: [
    { icon: '⚠', iconClass: 'kpi-icon-ink', label: 'Total claims', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Open claims', value: (r) => String(r.filter((x) => OPEN_STATUSES.includes(String(x.status))).length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Critical claims', value: (r) => String(r.filter((x) => x.severity === 'Critical' && OPEN_STATUSES.includes(String(x.status))).length) },
    {
      icon: '⏰',
      iconClass: 'kpi-icon-red',
      label: 'Overdue claims',
      value: (r) => String(r.filter((x) => {
        if (!OPEN_STATUSES.includes(String(x.status)) || !x.expected_resolution_date) return false;
        return new Date(x.expected_resolution_date as string).getTime() < Date.now();
      }).length),
    },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Resolved', value: (r) => String(r.filter((x) => x.status === 'Resolved' || x.status === 'Closed').length) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Total claim value', value: (r) => `₹${r.reduce((sum, x) => sum + (Number(x.claimed_value) || 0), 0).toLocaleString()}` },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Compensation value', value: (r) => `₹${r.reduce((sum, x) => sum + (Number(x.compensation_amount) || 0), 0).toLocaleString()}` },
  ],
  sampleRecords: [
    { id: 'demo-claim-1', claim_number: 'CLM-0001', claim_date: '2026-08-30', claim_type: 'Quality Issue', priority: 'High', severity: 'High', claim_source: 'Customer complaint', customer_name: 'Al Habib Foods', supplier_name: 'Orient Traders', deal_number: 'DEAL-0001', shipment_number: 'SHP-0001', product_name: 'Basmati Rice', quantity: 15, claimed_value: 10500, currency: 'USD', invoice_number: 'CI-2026-0091', reported_by: 'Al Habib Foods QC team', assigned_to: 'Priya Ramesh', responsible_party: 'Under Investigation', expected_resolution_date: '2026-09-15', status: 'Investigation' },
    { id: 'demo-claim-2', claim_number: 'CLM-0002', claim_date: '2026-09-01', claim_type: 'Delivery Delay', priority: 'Medium', severity: 'Medium', claim_source: 'Internal follow-up', customer_name: 'Coastal Garments', supplier_name: 'Global Commodities Co', deal_number: 'DEAL-0002', shipment_number: 'SHP-0002', product_name: 'Cotton Yarn', claimed_value: 5000, currency: 'INR', assigned_to: 'Arjun Nair', responsible_party: 'Logistics Provider', expected_resolution_date: '2026-09-05', actual_resolution_date: '2026-09-04', resolution: 'Freight partner issued a partial credit for the one-day delay.', compensation_amount: 5000, status: 'Resolved' },
  ],
};

export function ClaimsDisputesPage() {
  return <TradingMasterPage config={config} />;
}