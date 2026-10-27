import { TextileMasterPage, TextileModuleConfig } from './TextileMasterPage';

const metres = (value: unknown) => `${Number(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} m`;
const sum = (rows: Record<string, unknown>[], key: string) => rows.reduce((total, r) => total + (Number(r[key]) || 0), 0);

const config: TextileModuleConfig = {
  resource: '/textile/distributors',
  eyebrowModule: 'DISTRIBUTOR MANAGEMENT',
  title: 'Distributor management',
  description: 'Our delivery partners. Assign a distributor to a Sales Order and they deliver the fabric to the client — orders handled and metres distributed are tracked here.',
  icon: '▤',
  emptyIcon: '▤',
  codeField: 'distributor_code',
  nameField: 'distributor_name',
  statusOptions: ['Active', 'Inactive'],
  searchableKeys: ['distributor_code', 'distributor_name', 'contact_person', 'city', 'territory', 'phone'],
  fields: [
    { key: 'distributor_code', label: 'Distributor code', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'DST' },
    { key: 'distributor_name', label: 'Distributor name', type: 'text', required: true, listColumn: true },
    { key: 'contact_person', label: 'Contact person', type: 'text', listColumn: true },
    { key: 'phone', label: 'Phone', type: 'text', listColumn: true },
    { key: 'city', label: 'City', type: 'text', listColumn: true },
    { key: 'territory', label: 'Territory / area covered', type: 'text', group: 'Business details', placeholder: 'e.g. Kanyakumari & Tirunelveli' },
    { key: 'commission_percent', label: 'Commission %', type: 'number', group: 'Business details' },
    { key: 'gstin', label: 'GSTIN', type: 'text', group: 'Business details' },
    { key: 'email', label: 'Email', type: 'text', group: 'Business details' },
    { key: 'address', label: 'Address', type: 'textarea', group: 'Business details' },
    { key: 'state', label: 'State', type: 'text', group: 'Business details' },
    { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], group: 'Business details' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Business details' },
    { key: 'orders_handled', label: 'Orders handled', type: 'text', readOnly: true, listColumn: true, group: 'Delivery performance' },
    { key: 'metres_ordered', label: 'Metres to deliver', type: 'text', readOnly: true, listColumn: true, group: 'Delivery performance', format: metres },
    { key: 'metres_issued', label: 'Metres issued (rolls)', type: 'text', readOnly: true, group: 'Delivery performance', format: metres },
  ],
  kpis: [
    { icon: '▤', iconClass: 'kpi-icon-ink', label: 'Distributors', value: (r) => String(r.length), sub: (r) => `${r.filter((x) => x.status === 'Active').length} active` },
    { icon: '▣', iconClass: 'kpi-icon-green', label: 'Orders handled', value: (r) => String(sum(r, 'orders_handled')), sub: () => 'assigned to distributors' },
    { icon: '📏', iconClass: 'kpi-icon-school', label: 'Metres to deliver', value: (r) => metres(sum(r, 'metres_ordered')) },
    { icon: '▤', iconClass: 'kpi-icon-amber', label: 'Rolls issued', value: (r) => String(sum(r, 'rolls_issued')), sub: (r) => `${metres(sum(r, 'metres_issued'))} issued` },
  ],
};

export function TextileDistributorPage() {
  return <TextileMasterPage config={config} />;
}