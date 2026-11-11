import { TextileMasterPage, TextileModuleConfig, TextileRecord } from './TextileMasterPage';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';

// Approved sample -> open Requirement for the client (then build the quotation from Requirements as usual).
function CreateRequirementButton({ sample }: { sample: TextileRecord }) {
  const { activeIndustryTypeId } = useIndustryScope();
  if (sample.status !== 'Approved' || String(sample.id).startsWith('demo-')) return null;
  async function run() {
    const answer = window.prompt('How many metres does the client want?');
    if (answer === null) return;
    const quantity = Number(answer);
    if (!(quantity > 0)) { window.alert('Enter a number of metres more than zero.'); return; }
    try {
      await api(`/textile/samples/${sample.id}/create-requirement`, { method: 'POST', body: JSON.stringify({ industryTypeId: activeIndustryTypeId, quantity }) });
      window.alert('Requirement created for this client. Open Requirements to build the quotation.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Unable to create the requirement.');
    }
  }
  return <button type="button" onClick={() => void run()}>Create requirement</button>;
}

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
  rowActions: (r) => <CreateRequirementButton sample={r} />,
  searchableKeys: ['sample_code', 'design_code', 'client_name'],
  fields: [
    { key: 'sample_code', label: 'Sample code', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'SMP' },
    {
      key: 'design_code', label: 'Product', type: 'lookup', listColumn: true,
      lookupResource: '/products', industryScoped: true, lookupValueKey: 'product_code', lookupLabelKey: 'product_name', lookupSecondaryLabelKey: 'product_code',
      helpText: 'Pick the fabric product this sample is cut from.',
    },
    {
      key: 'client_name', label: 'Client', type: 'lookup', required: true, listColumn: true,
      lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_name', lookupSecondaryLabelKey: 'client_code',
      helpText: 'Pick the client the sample was sent to.',
    },
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
};

export function TextileSamplePage() {
  return <TextileMasterPage config={config} />;
}