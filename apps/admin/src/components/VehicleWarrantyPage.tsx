import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const STATUSES = ['Active', 'Expiring Soon', 'Expired', 'Claimed'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/warranties',
  eyebrowModule: 'WARRANTY',
  title: 'Vehicle warranty',
  description: 'Warranty is activated automatically on delivery and tracked per VIN through to expiry or claim.',
  icon: '✔',
  emptyIcon: '✔',
  codeField: 'warranty_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['warranty_number', 'client_name', 'vin'],
  fields: [
    { key: 'warranty_number', label: 'Warranty number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'WAR' },
    { key: 'vin', label: 'VIN', type: 'lookup', listColumn: true, group: 'Vehicle', lookupResource: '/vehicle/units', lookupLabelKey: 'model_name' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true, group: 'Vehicle' },
    { key: 'start_date', label: 'Start date', type: 'date', group: 'Coverage' },
    { key: 'end_date', label: 'End date', type: 'date', listColumn: true, group: 'Coverage' },
    { key: 'coverage', label: 'Coverage', type: 'textarea', group: 'Coverage' },
    { key: 'warranty_claims', label: 'Warranty claims', type: 'textarea', group: 'History' },
    { key: 'service_history_reference', label: 'Service history reference', type: 'text', group: 'History' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'History' },
  ],
  kpis: [
    { icon: '✔', iconClass: 'kpi-icon-ink', label: 'Total warranties', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Expiring soon', value: (r) => String(r.filter((x) => x.status === 'Expiring Soon').length) },
       { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Expired', value: (r) => String(r.filter((x) => x.status === 'Expired').length) },
  ],
  sampleRecords: [
    { id: 'demo-war-1', warranty_number: 'WAR-0001', client_name: 'Ramesh Iyer', vin: 'MA3ERLF1S00123456', end_date: '2029-09-05', status: 'Active' },
    { id: 'demo-war-2', warranty_number: 'WAR-0002', client_name: 'Kavitha Raj', vin: 'MA3ABCD1S00987654', end_date: '2026-10-01', status: 'Expiring Soon' },
  ],
};

export function VehicleWarrantyPage() {
  return <VehicleMasterPage config={config} />;
}