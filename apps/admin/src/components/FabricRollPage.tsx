import { TextileMasterPage, TextileModuleConfig } from './TextileMasterPage';

const FABRIC_TYPES = ['Cotton', 'Silk', 'Linen', 'Polyester', 'Viscose', 'Wool', 'Denim', 'Blended', 'Other'];
const GRADES = ['A', 'B', 'C', 'Reject'];

const config: TextileModuleConfig = {
  resource: '/textile/fabric-rolls',
  eyebrowModule: 'FABRIC ROLL MANAGEMENT',
  title: 'Fabric roll management',
  description: 'Warehouse-level inventory of physical fabric rolls — lot, length, grade and location — feeding quality inspection and stock decisions.',
  icon: '▤',
  emptyIcon: '▤',
  codeField: 'roll_number',
  nameField: 'roll_number',
  statusOptions: ['In stock', 'Issued', 'Damaged', 'Sold'],
  searchableKeys: ['roll_number', 'lot_number', 'fabric_type', 'supplier_name', 'warehouse_location'],
  fields: [
    { key: 'roll_number', label: 'Roll number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'FR' },
    { key: 'fabric_type', label: 'Fabric type', type: 'select', options: FABRIC_TYPES, required: true, listColumn: true },
    { key: 'colour', label: 'Colour', type: 'text', listColumn: true },
    { key: 'length_meters', label: 'Length (m)', type: 'number', listColumn: true },
    { key: 'gsm', label: 'GSM (weight)', type: 'number', group: 'Roll specification', placeholder: 'grams per sq. metre' },
    { key: 'width_inches', label: 'Width (inches)', type: 'number', group: 'Roll specification' },
    { key: 'lot_number', label: 'Lot number', type: 'text', group: 'Roll specification' },
    { key: 'quality_grade', label: 'Quality grade', type: 'select', options: GRADES, group: 'Roll specification' },
    { key: 'supplier_name', label: 'Supplier', type: 'text', group: 'Sourcing & storage' },
    { key: 'received_date', label: 'Received date', type: 'date', group: 'Sourcing & storage' },
    { key: 'warehouse_location', label: 'Warehouse location', type: 'text', group: 'Sourcing & storage', placeholder: 'e.g. Rack B-12' },
    { key: 'status', label: 'Status', type: 'select', options: ['In stock', 'Issued', 'Damaged', 'Sold'], group: 'Sourcing & storage' },
  ],
  kpis: [
    { icon: '▤', iconClass: 'kpi-icon-ink', label: 'Rolls in inventory', value: (r) => String(r.length) },
    { icon: '📏', iconClass: 'kpi-icon-school', label: 'Total length', value: (r) => `${r.reduce((sum, x) => sum + (Number(x.length_meters) || 0), 0)} m` },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'In stock', value: (r) => String(r.filter((x) => x.status === 'In stock').length) },
    { icon: '⚠', iconClass: 'kpi-icon-amber', label: 'Low length (<5m)', value: (r) => String(r.filter((x) => x.status === 'In stock' && Number(x.length_meters) > 0 && Number(x.length_meters) < 5).length), sub: () => 'consider reordering' },
    { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Damaged', value: (r) => String(r.filter((x) => x.status === 'Damaged').length) },
  ],
  sampleRecords: [
    {
      id: 'demo-roll-1', roll_number: 'FR-2026-0891', fabric_type: 'Silk', colour: 'Maroon Red', length_meters: 120, gsm: 90,
      width_inches: 44, lot_number: 'LOT-2205', quality_grade: 'A', supplier_name: 'Kanchi Silk Weavers',
      received_date: '2026-05-01', warehouse_location: 'Rack B-12', status: 'In stock',
    },
    {
      id: 'demo-roll-2', roll_number: 'FR-2026-0902', fabric_type: 'Cotton', colour: 'Sky Blue', length_meters: 60, gsm: 140,
      width_inches: 58, lot_number: 'LOT-2311', quality_grade: 'B', supplier_name: 'Coimbatore Textiles Ltd',
      received_date: '2026-05-18', warehouse_location: 'Rack C-04', status: 'Issued',
    },
    {
      id: 'demo-roll-3', roll_number: 'FR-2026-0915', fabric_type: 'Denim', colour: 'Indigo', length_meters: 25, gsm: 320,
      width_inches: 60, lot_number: 'LOT-2402', quality_grade: 'Reject', supplier_name: 'Coimbatore Textiles Ltd',
      received_date: '2026-06-01', warehouse_location: 'Rack A-07', status: 'Damaged',
    },
  ],
};

export function FabricRollPage() {
  return <TextileMasterPage config={config} />;
}