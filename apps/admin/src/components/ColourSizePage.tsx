import { TextileMasterPage, TextileModuleConfig } from './TextileMasterPage';

const SIZES = ['Free size', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'By metre'];

const config: TextileModuleConfig = {
  resource: '/textile/variants',
  eyebrowModule: 'COLOUR & SIZE MANAGEMENT',
  title: 'Colour & size management',
  description: 'Track every colour and size variant sold against a design, with its own SKU and stock count.',
 icon: '◧',
emptyIcon: '◧', 
  codeField: 'sku',
  nameField: 'colour_name',
  statusOptions: ['Active', 'Inactive'],
  searchableKeys: ['sku', 'colour_name', 'design_code', 'size'],
  fields: [
{ key: 'sku', label: 'SKU', type: 'text', required: true, listColumn: true, placeholder: 'auto-generated from design + colour + size', readOnly: true, autoGenerate: (row) => `${row.design_code || 'DSN'}-${(row.colour_name || '').slice(0,3).toUpperCase()}-${row.size || ''}` },
    { key: 'design_code', label: 'Design code', type: 'lookup', lookupResource: '/textile/designs', lookupLabelKey: 'design_name', required: true, listColumn: true },
    { key: 'colour_name', label: 'Colour', type: 'text', required: true, listColumn: true },
    { key: 'size', label: 'Size', type: 'select', options: SIZES, listColumn: true },
{ key: 'colour_hex', label: 'Colour swatch (hex)', type: 'colour', group: 'Variant details', placeholder: '#RRGGBB' },
    { key: 'stock_quantity', label: 'Stock quantity', type: 'number', group: 'Variant details' },
    { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], group: 'Variant details' },
  ],
  kpis: [
  { icon: '◧', iconClass: 'kpi-icon-ink', label: 'Variants tracked', value: (r) => String(r.length) },
    { icon: '▥', iconClass: 'kpi-icon-school', label: 'Total stock units', value: (r) => String(r.reduce((sum, x) => sum + (Number(x.stock_quantity) || 0), 0)) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Out of stock', value: (r) => String(r.filter((x) => Number(x.stock_quantity) === 0).length) },
    { icon: '⚠', iconClass: 'kpi-icon-amber', label: 'Low stock (<10)', value: (r) => String(r.filter((x) => Number(x.stock_quantity) > 0 && Number(x.stock_quantity) < 10).length) },
{ icon: '⚠', iconClass: 'kpi-icon-amber', label: 'Low stock (<10)', value: (r) => String(r.filter((x) => Number(x.stock_quantity) > 0 && Number(x.stock_quantity) < 10).length) },
  ],
  sampleRecords: [
    { id: 'demo-variant-1', sku: 'DSN-014-RED-M', design_code: 'DSN-2026-014', colour_name: 'Maroon Red', size: 'M', colour_hex: '#7b1e2b', stock_quantity: 42, status: 'Active' },
    { id: 'demo-variant-2', sku: 'DSN-014-GLD-FREE', design_code: 'DSN-2026-014', colour_name: 'Antique Gold', size: 'Free size', colour_hex: '#c9a24b', stock_quantity: 0, status: 'Active' },
  ],
};

export function ColourSizePage() {
  return <TextileMasterPage config={config} />;
}