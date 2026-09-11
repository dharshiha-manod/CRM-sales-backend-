import { TextileMasterPage, TextileModuleConfig } from './TextileMasterPage';

const config: TextileModuleConfig = {
  resource: '/textile/samples',
  eyebrowModule: 'TEXTILE SAMPLE MANAGEMENT',
  title: 'Textile sample management',
  description: 'Log samples sent to clients for approval and track turnaround before an order is confirmed.',
  icon: '▣',
  emptyIcon: '▣',
  codeField: 'sample_code',
  nameField: 'sample_code',
  statusOptions: ['Pending', 'Approved', 'Rejected', 'Revision requested'],
  searchableKeys: ['sample_code', 'design_code', 'client_name'],
  fields: [
    { key: 'sample_code', label: 'Sample code', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'SMP' },
    { key: 'design_code', label: 'Design code', type: 'lookup', lookupResource: '/textile/designs', lookupLabelKey: 'design_name', listColumn: true },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true },
    { key: 'sent_date', label: 'Sent date', type: 'date', listColumn: true },
    { key: 'expected_response_date', label: 'Expected response by', type: 'date', group: 'Sample tracking' },
    { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Approved', 'Rejected', 'Revision requested'], group: 'Sample tracking' },
    { key: 'feedback', label: 'Client feedback', type: 'textarea', group: 'Sample tracking' },
  ],
  kpis: [
    { icon: '▣', iconClass: 'kpi-icon-ink', label: 'Samples sent', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Awaiting response', value: (r) => String(r.filter((x) => x.status === 'Pending').length) },
    { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Overdue', value: (r) => String(r.filter((x) => x.status === 'Pending' && x.expected_response_date && new Date(x.expected_response_date as string) < new Date()).length), sub: () => 'past expected response date' },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Approved', value: (r) => String(r.filter((x) => x.status === 'Approved').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Rejected', value: (r) => String(r.filter((x) => x.status === 'Rejected').length) },
  ],
  sampleRecords: [
    {
      id: 'demo-sample-1', sample_code: 'SMP-2026-102', design_code: 'DSN-2026-014', client_name: 'Meera Boutique',
      sent_date: '2026-05-20', expected_response_date: '2026-05-27', status: 'Pending', feedback: '',
    },
    {
      id: 'demo-sample-2', sample_code: 'SMP-2026-098', design_code: 'DSN-2026-021', client_name: 'Trends Apparel Wholesale',
      sent_date: '2026-05-10', expected_response_date: '2026-05-17', status: 'Approved',
      feedback: 'Loved the check pattern — proceed to bulk order.',
    },
    {
      id: 'demo-sample-3', sample_code: 'SMP-2026-091', design_code: 'DSN-2025-188', client_name: 'Highland Retail Co.',
      sent_date: '2026-04-28', expected_response_date: '2026-05-05', status: 'Rejected',
      feedback: 'Colour did not match brand palette.',
    },
  ],
};

export function TextileSamplePage() {
  return <TextileMasterPage config={config} />;
}