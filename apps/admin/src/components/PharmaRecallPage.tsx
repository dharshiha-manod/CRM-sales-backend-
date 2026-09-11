import { PharmaMasterPage, PharmaModuleConfig } from './PharmaMasterPage';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const STATUSES = ['Created', 'Batch identified', 'Stock identified', 'Notification sent', 'Collection in progress', 'Stock quarantined', 'Closed'];

const config: PharmaModuleConfig = {
  resource: '/pharma/recalls',
  eyebrowModule: 'RECALL MANAGEMENT',
  title: 'Recall management',
  description: 'Manage a product recall end to end — the affected batch and stock, who was notified, and progress bringing it back in and quarantined.',
  icon: '⚠',
  emptyIcon: '⚠',
  codeField: 'recall_code',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['recall_code', 'product_name', 'assigned_team'],
  fields: [
    { key: 'recall_code', label: 'Recall number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'RCL' },
    { key: 'product_name', label: 'Product', type: 'text', required: true, listColumn: true },
{ key: 'batch_number', label: 'Batch number', type: 'lookup', lookupResource: '/pharma/batches', lookupLabelKey: 'product_name', autoFillMap: { product_name: 'product_name' }, required: true, listColumn: true },
    { key: 'severity', label: 'Recall severity', type: 'select', options: SEVERITIES, listColumn: true },
    { key: 'reason', label: 'Recall reason', type: 'textarea', group: 'Recall details' },
    { key: 'recall_date', label: 'Recall date', type: 'date', group: 'Recall details' },
    { key: 'affected_quantity', label: 'Affected quantity', type: 'number', group: 'Recall details' },
    { key: 'affected_customers', label: 'Affected customers / hospitals / distributors', type: 'textarea', group: 'Recall details', placeholder: 'List affected accounts, one per line' },
    { key: 'assigned_team', label: 'Assigned team / sales rep', type: 'text', listColumn: true, group: 'Recall details' },
    { key: 'action_required', label: 'Action required', type: 'textarea', group: 'Recall details' },
    { key: 'completion_date', label: 'Completion date', type: 'date', group: 'Recall details' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Recall details' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Recall details' },
  ],
  kpis: [
    { icon: '⚠', iconClass: 'kpi-icon-ink', label: 'Active recalls', value: (r) => String(r.filter((x) => x.status !== 'Closed').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Critical recalls', value: (r) => String(r.filter((x) => x.severity === 'Critical' && x.status !== 'Closed').length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pending quantity', value: (r) => String(r.filter((x) => x.status !== 'Closed').reduce((sum, x) => sum + (Number(x.affected_quantity) || 0), 0)) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Closed recalls', value: (r) => String(r.filter((x) => x.status === 'Closed').length) },
  ],
  sampleRecords: [
    {
      id: 'demo-recall-1', recall_code: 'RCL-2026-011', product_name: 'Pantocid DSR', batch_number: 'BAT-2026-0182', severity: 'High',
      reason: 'Stability failure detected in retention sample testing.', recall_date: '2026-08-30', affected_quantity: 900,
      affected_customers: 'Kauvery Hospital\nCoimbatore Central Pharmacy', assigned_team: 'Divya Suresh',
      action_required: 'Collect all remaining stock from field and distributors.', completion_date: '', status: 'Notification sent', notes: '',
    },
    {
      id: 'demo-recall-2', recall_code: 'RCL-2026-006', product_name: 'Zoclar 500', batch_number: 'BAT-2026-0140', severity: 'Low',
      reason: 'Minor packaging label mismatch, no safety impact.', recall_date: '2026-05-12', affected_quantity: 300,
      affected_customers: 'Apollo Hospitals', assigned_team: 'Vikram Nair',
      action_required: 'Replace outer cartons with corrected labels.', completion_date: '2026-05-25', status: 'Closed', notes: '',
    },
  ],
};

export function PharmaRecallPage() {
  return <PharmaMasterPage config={config} />;
}