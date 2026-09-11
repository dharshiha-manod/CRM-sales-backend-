import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const STATUSES = ['Active', 'Expiring Soon', 'Expired', 'Cancelled'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/insurance-policies',
  eyebrowModule: 'INSURANCE',
  title: 'Vehicle insurance',
  description: 'Policy tracking per VIN and client, with reminders at 30, 15 and 7 days before expiry and an automatic status change on expiry.',
  icon: '▣',
  emptyIcon: '▣',
  codeField: 'policy_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['policy_number', 'client_name', 'provider', 'vin'],
  fields: [
    { key: 'policy_number', label: 'Policy number', type: 'text', required: true, listColumn: true },
    { key: 'vin', label: 'VIN', type: 'lookup', listColumn: true, group: 'Vehicle', lookupResource: '/vehicle/units', lookupLabelKey: 'model_name' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true, group: 'Vehicle' },
    { key: 'provider', label: 'Provider', type: 'text', listColumn: true, group: 'Policy' },
    { key: 'policy_type', label: 'Policy type', type: 'select', options: ['Comprehensive', 'Third Party', 'Zero Depreciation'], group: 'Policy' },
    { key: 'premium', label: 'Premium', type: 'number', group: 'Policy' },
    { key: 'coverage', label: 'Coverage', type: 'textarea', group: 'Policy' },
    { key: 'start_date', label: 'Start date', type: 'date', group: 'Validity' },
    { key: 'expiry_date', label: 'Expiry date', type: 'date', listColumn: true, group: 'Validity' },
    { key: 'policy_document_reference', label: 'Policy document reference', type: 'text', group: 'Validity' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Validity' },
  ],
  kpis: [
    { icon: '▣', iconClass: 'kpi-icon-ink', label: 'Total policies', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active', value: (r) => String(r.filter((x) => x.status === 'Active').length) },
      { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Expiring / expired', value: (r) => String(r.filter((x) => x.status === 'Expiring Soon' || x.status === 'Expired').length) },
  ],
  sampleRecords: [
    { id: 'demo-ins-1', policy_number: 'POL-0001', client_name: 'Ramesh Iyer', provider: 'ICICI Lombard', expiry_date: '2027-03-14', status: 'Active' },
    { id: 'demo-ins-2', policy_number: 'POL-0002', client_name: 'Priya Menon', provider: 'Bajaj Allianz', expiry_date: '2026-09-20', status: 'Expiring Soon' },
  ],
};

export function VehicleInsurancePage() {
  return <VehicleMasterPage config={config} />;
}