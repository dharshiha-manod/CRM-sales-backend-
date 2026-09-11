import { TextileMasterPage, TextileModuleConfig } from './TextileMasterPage';

const CATEGORIES = ['Saree', 'Shirting', 'Suiting', 'Dress material', 'Bedding & furnishing', 'Kidswear', 'Other'];
const FABRIC_TYPES = ['Cotton', 'Silk', 'Linen', 'Polyester', 'Viscose', 'Wool', 'Denim', 'Blended', 'Other'];
const SEASONS = ['Spring/Summer', 'Autumn/Winter', 'Festive/Wedding', 'All season'];

const config: TextileModuleConfig = {
  resource: '/textile/designs',
  eyebrowModule: 'DESIGN & PATTERN MANAGEMENT',
  title: 'Design & pattern management',
  description: 'Maintain the master catalogue of designs and patterns — the reference every fabric roll, sample and variant ties back to.',
  icon: '✎',
  emptyIcon: '✎',
  codeField: 'design_code',
  nameField: 'design_name',
  statusOptions: ['Active', 'Draft', 'Discontinued'],
  searchableKeys: ['design_code', 'design_name', 'designer_name'],
  fields: [
    { key: 'design_code', label: 'Design code', type: 'text', required: true, listColumn: true, placeholder: 'e.g. DSN-2026-014' },
    { key: 'design_name', label: 'Design name', type: 'text', required: true, listColumn: true },
    { key: 'category', label: 'Category', type: 'select', options: CATEGORIES, listColumn: true },
    { key: 'fabric_type', label: 'Fabric type', type: 'select', options: FABRIC_TYPES, listColumn: true },
    { key: 'season', label: 'Season / collection', type: 'select', options: SEASONS, group: 'Design details' },
    { key: 'designer_name', label: 'Designer', type: 'text', group: 'Design details' },
    { key: 'reference_image_url', label: 'Reference image URL', type: 'text', group: 'Design details', placeholder: 'https://…' },
    { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Draft', 'Discontinued'], group: 'Design details' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Design details' },
  ],
  kpis: [
    { icon: '✎', iconClass: 'kpi-icon-ink', tone: 'ink', label: 'Designs on file', value: (r) => String(r.length), sub: (r) => `${r.filter((x) => x.status === 'Active').length} active` },
    { icon: '📅', iconClass: 'kpi-icon-amber', tone: 'amber', label: 'Draft designs', value: (r) => String(r.filter((x) => x.status === 'Draft').length), sub: () => 'awaiting approval' },
    { icon: '⊘', iconClass: 'kpi-icon-red', tone: 'red', label: 'Discontinued', value: (r) => String(r.filter((x) => x.status === 'Discontinued').length) },
  ],
  sampleRecords: [
    {
      id: 'demo-design-1', design_code: 'DSN-2026-014', design_name: 'Floral Zari Saree', category: 'Saree', fabric_type: 'Silk',
      season: 'Festive/Wedding', designer_name: 'Ananya Rao', reference_image_url: '', status: 'Active',
      notes: 'Best seller for the wedding season — reorder zari trims by mid-August.', created_at: '2026-05-10',
    },
    {
      id: 'demo-design-2', design_code: 'DSN-2026-021', design_name: 'Checked Cotton Shirting', category: 'Shirting', fabric_type: 'Cotton',
      season: 'All season', designer_name: 'Karthik Menon', reference_image_url: '', status: 'Draft', notes: '', created_at: '2026-06-02',
    },
    {
      id: 'demo-design-3', design_code: 'DSN-2025-188', design_name: 'Paisley Winter Shawl', category: 'Other', fabric_type: 'Wool',
      season: 'Autumn/Winter', designer_name: 'Ananya Rao', reference_image_url: '', status: 'Discontinued',
      notes: 'Retired after FY25 winter run.', created_at: '2025-11-14',
    },
  ],
};

export function DesignPatternPage() {
  return <TextileMasterPage config={config} />;
}