import { TextileMasterPage, TextileModuleConfig } from './TextileMasterPage';

const GRADES = ['A', 'B', 'C', 'Reject'];

const config: TextileModuleConfig = {
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
    { key: 'inspection_code', label: 'Inspection code', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'QC' },
    { key: 'roll_number', label: 'Fabric roll number', type: 'lookup', lookupResource: '/textile/fabric-rolls', lookupLabelKey: 'fabric_type', required: true, listColumn: true },
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
};

export function QualityInspectionPage() {
  return <TextileMasterPage config={config} />;
}