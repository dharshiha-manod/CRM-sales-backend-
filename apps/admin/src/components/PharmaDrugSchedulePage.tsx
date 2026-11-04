import { PharmaMasterPage, PharmaModuleConfig } from './PharmaMasterPage';

const SCHEDULES = ['H', 'H1', 'X', 'Narcotic (NDPS)'];

const config: PharmaModuleConfig = {
  resource: '/pharma/drug-schedules',
  eyebrowModule: 'DRUG SCHEDULES',
  title: 'Drug schedules',
  description: 'Mark which medicines are Schedule H, H1, X or Narcotic. These can only be sold to customers with a drug licence number and validity date on file, and they appear in the Schedule drug register report.',
  icon: '℞',
  emptyIcon: '℞',
  codeField: 'schedule_code',
  nameField: 'product_name',
  statusOptions: ['Active', 'Inactive'],
  searchableKeys: ['schedule_code', 'product_name', 'product_code', 'schedule'],
  fields: [
    { key: 'schedule_code', label: 'Entry number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'SCH' },
    { key: 'product_name', label: 'Product', type: 'text', required: true, listColumn: true },
    { key: 'product_code', label: 'Product code', type: 'lookup', lookupResource: '/products', industryScoped: true, lookupLabelKey: 'product_name', lookupSecondaryLabelKey: 'product_code', autoFillMap: { product_name: 'product_name' }, required: true, listColumn: true },
    { key: 'schedule', label: 'Schedule', type: 'select', options: SCHEDULES, required: true, listColumn: true },
    { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], listColumn: true },
    { key: 'notes', label: 'Remarks', type: 'textarea' },
  ],
  kpis: [
    { icon: '℞', iconClass: 'kpi-icon-ink', label: 'Scheduled products', value: (r) => String(r.filter((x) => x.status !== 'Inactive').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'H1 / X / Narcotic', value: (r) => String(r.filter((x) => x.status !== 'Inactive' && x.schedule !== 'H').length) },
  ],
};

export function PharmaDrugSchedulePage() {
  return <PharmaMasterPage config={config} />;
}