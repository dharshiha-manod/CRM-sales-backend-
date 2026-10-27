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
{ key: 'sku', label: 'SKU', type: 'text', required: true, listColumn: true, placeholder: 'auto-generated from design + colour + size', readOnly: true, regenerateOn: ['design_code', 'colour_name', 'size'], autoGenerate: (row) =>`${row.design_code || 'DSN'}-${(row.colour_name || '').slice(0,3).toUpperCase()}-${row.size || ''}` },
    { key: 'design_code', label: 'Design code', type: 'lookup', lookupResource: '/textile/designs', lookupLabelKey: 'design_name', required: true, listColumn: true },
    { key: 'colour_name', label: 'Colour', type: 'text', required: true, listColumn: true },
    { key: 'size', label: 'Size', type: 'select', options: SIZES, listColumn: true },
{ key: 'colour_hex', label: 'Colour swatch (hex)', type: 'colour', group: 'Variant details', placeholder: '#RRGGBB' },
    { key: 'stock_quantity', label: 'Stock quantity', type: 'number', group: 'Variant details', helpText: 'Posts to Inventory only when a Textile product exists with the same code as this SKU (see "Inventory link").' },
    { key: 'inventory_status', label: 'Inventory link', type: 'text', readOnly: true, listColumn: true, group: 'Variant details', format: (v) => (v === 'Linked' ? '✔ Linked' : v === 'Not linked' ? '⚠ Not linked' : '') },
    { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], group: 'Variant details' },
  ],
  kpis: [
  { icon: '◧', iconClass: 'kpi-icon-ink', label: 'Variants tracked', value: (r) => String(r.length) },
    { icon: '▥', iconClass: 'kpi-icon-school', label: 'Total stock units', value: (r) => String(r.reduce((sum, x) => sum + (Number(x.stock_quantity) || 0), 0)) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Out of stock', value: (r) => String(r.filter((x) => Number(x.stock_quantity) === 0).length) },
    { icon: '⚠', iconClass: 'kpi-icon-amber', label: 'Low stock (<10)', value: (r) => String(r.filter((x) => Number(x.stock_quantity) > 0 && Number(x.stock_quantity) < 10).length) },
  ],
};

export function ColourSizePage() {
  return <TextileMasterPage config={config} />;
}