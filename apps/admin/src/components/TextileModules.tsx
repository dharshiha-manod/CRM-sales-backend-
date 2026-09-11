import { TextileMasterPage, TextileModuleConfig } from './TextileMasterPage';

// ---- shared option lists -------------------------------------------------
const FABRIC_TYPES = ['Cotton', 'Silk', 'Linen', 'Polyester', 'Viscose', 'Wool', 'Denim', 'Blended', 'Other'];
const CATEGORIES = ['Saree', 'Shirting', 'Suiting', 'Dress material', 'Bedding & furnishing', 'Kidswear', 'Other'];
const SEASONS = ['Spring/Summer', 'Autumn/Winter', 'Festive/Wedding', 'All season'];
const SIZES = ['Free size', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'By metre'];
const GRADES = ['A', 'B', 'C', 'Reject'];

// ---- 1. Design & Pattern Management --------------------------------------
export const designPatternConfig: TextileModuleConfig = {
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
    { icon: '✎', iconClass: 'kpi-icon-ink', label: 'Designs on file', value: (r) => String(r.length), sub: (r) => `${r.filter((x) => x.status === 'Active').length} active` },
    { icon: '📅', iconClass: 'kpi-icon-amber', label: 'Draft designs', value: (r) => String(r.filter((x) => x.status === 'Draft').length), sub: () => 'awaiting approval' },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Discontinued', value: (r) => String(r.filter((x) => x.status === 'Discontinued').length) },
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

// ---- 2. Colour & Size Management ------------------------------------------
export const colourSizeConfig: TextileModuleConfig = {
  resource: '/textile/variants',
  eyebrowModule: 'COLOUR & SIZE MANAGEMENT',
  title: 'Colour & size management',
  description: 'Track every colour and size variant sold against a design, with its own SKU and stock count.',
  icon: '🎨',
  emptyIcon: '🎨',
  codeField: 'sku',
  nameField: 'colour_name',
  statusOptions: ['Active', 'Inactive'],
  searchableKeys: ['sku', 'colour_name', 'design_code', 'size'],
  fields: [
    { key: 'sku', label: 'SKU', type: 'text', required: true, listColumn: true, placeholder: 'e.g. DSN-014-RED-M' },
    { key: 'design_code', label: 'Design code', type: 'text', required: true, listColumn: true, placeholder: 'links to Design & Pattern' },
    { key: 'colour_name', label: 'Colour', type: 'text', required: true, listColumn: true },
    { key: 'size', label: 'Size', type: 'select', options: SIZES, listColumn: true },
    { key: 'colour_hex', label: 'Colour swatch (hex)', type: 'text', group: 'Variant details', placeholder: '#RRGGBB' },
    { key: 'stock_quantity', label: 'Stock quantity', type: 'number', group: 'Variant details' },
    { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], group: 'Variant details' },
  ],
  kpis: [
    { icon: '🎨', iconClass: 'kpi-icon-ink', label: 'Variants tracked', value: (r) => String(r.length) },
    { icon: '▥', iconClass: 'kpi-icon-school', label: 'Total stock units', value: (r) => String(r.reduce((sum, x) => sum + (Number(x.stock_quantity) || 0), 0)) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Out of stock', value: (r) => String(r.filter((x) => Number(x.stock_quantity) === 0).length) },
  ],
  sampleRecords: [
    { id: 'demo-variant-1', sku: 'DSN-014-RED-M', design_code: 'DSN-2026-014', colour_name: 'Maroon Red', size: 'M', colour_hex: '#7b1e2b', stock_quantity: 42, status: 'Active' },
    { id: 'demo-variant-2', sku: 'DSN-014-GLD-FREE', design_code: 'DSN-2026-014', colour_name: 'Antique Gold', size: 'Free size', colour_hex: '#c9a24b', stock_quantity: 0, status: 'Active' },
  ],
};

// ---- 3. Fabric Roll Management ---------------------------------------------
export const fabricRollConfig: TextileModuleConfig = {
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
    { key: 'roll_number', label: 'Roll number', type: 'text', required: true, listColumn: true, placeholder: 'e.g. FR-2026-0891' },
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

// ---- 4. Textile Sample Management ------------------------------------------
export const textileSampleConfig: TextileModuleConfig = {
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
    { key: 'sample_code', label: 'Sample code', type: 'text', required: true, listColumn: true, placeholder: 'e.g. SMP-2026-102' },
    { key: 'design_code', label: 'Design code', type: 'text', listColumn: true, placeholder: 'links to Design & Pattern' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true },
    { key: 'sent_date', label: 'Sent date', type: 'date', listColumn: true },
    { key: 'expected_response_date', label: 'Expected response by', type: 'date', group: 'Sample tracking' },
    { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Approved', 'Rejected', 'Revision requested'], group: 'Sample tracking' },
    { key: 'feedback', label: 'Client feedback', type: 'textarea', group: 'Sample tracking' },
  ],
  kpis: [
    { icon: '▣', iconClass: 'kpi-icon-ink', label: 'Samples sent', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Awaiting response', value: (r) => String(r.filter((x) => x.status === 'Pending').length) },
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

// ---- 5. Quality & Inspection Management ------------------------------------
export const qualityInspectionConfig: TextileModuleConfig = {
  resource: '/textile/quality-inspections',
  eyebrowModule: 'QUALITY & INSPECTION MANAGEMENT',
  title: 'Quality & inspection management',
  description: 'Record inspection results against fabric rolls before they move to stock or dispatch.',
  icon: '✔',
  emptyIcon: '✔',
  codeField: 'inspection_code',
  nameField: 'inspection_code',
  statusOptions: ['Pass', 'Fail'],
  searchableKeys: ['inspection_code', 'roll_number', 'inspector_name'],
  fields: [
    { key: 'inspection_code', label: 'Inspection code', type: 'text', required: true, listColumn: true, placeholder: 'e.g. QC-2026-0456' },
    { key: 'roll_number', label: 'Fabric roll number', type: 'text', required: true, listColumn: true, placeholder: 'links to Fabric Roll' },
    { key: 'inspection_date', label: 'Inspection date', type: 'date', required: true, listColumn: true },
    { key: 'inspector_name', label: 'Inspector', type: 'text', listColumn: true },
    { key: 'grade', label: 'Grade', type: 'select', options: GRADES, group: 'Inspection result' },
    { key: 'defects_found', label: 'Defects found', type: 'textarea', group: 'Inspection result', placeholder: 'e.g. minor colour bleed, 2 slubs per metre' },
    { key: 'status', label: 'Result', type: 'select', options: ['Pass', 'Fail'], required: true, group: 'Inspection result' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', group: 'Inspection result' },
  ],
  kpis: [
    { icon: '✔', iconClass: 'kpi-icon-ink', label: 'Inspections logged', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Passed', value: (r) => String(r.filter((x) => x.status === 'Pass').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Failed', value: (r) => String(r.filter((x) => x.status === 'Fail').length) },
  ],
  sampleRecords: [
    {
      id: 'demo-qc-1', inspection_code: 'QC-2026-0456', roll_number: 'FR-2026-0891', inspection_date: '2026-05-02',
      inspector_name: 'Rajesh Kumar', grade: 'A', defects_found: '', status: 'Pass', remarks: 'Cleared for dispatch.',
    },
    {
      id: 'demo-qc-2', inspection_code: 'QC-2026-0461', roll_number: 'FR-2026-0915', inspection_date: '2026-06-02',
      inspector_name: 'Rajesh Kumar', grade: 'Reject', defects_found: 'Colour bleed across 3 sections, uneven weave.',
      status: 'Fail', remarks: 'Returned to supplier for credit.',
    },
  ],
};

// ---- page components (thin wrappers registered in App.tsx) ----------------
export function DesignPatternPage() { return <TextileMasterPage config={designPatternConfig} />; }
export function ColourSizePage() { return <TextileMasterPage config={colourSizeConfig} />; }
export function FabricRollPage() { return <TextileMasterPage config={fabricRollConfig} />; }
export function TextileSamplePage() { return <TextileMasterPage config={textileSampleConfig} />; }
export function QualityInspectionPage() { return <TextileMasterPage config={qualityInspectionConfig} />; }