import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const STATUSES = ['Pending', 'Submitted', 'Under Process', 'Completed', 'Rejected'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/registrations',
  eyebrowModule: 'REGISTRATION & DOCUMENTS',
  title: 'Vehicle registration & documents',
  description: 'Registration and documentation tracking per VIN. Uses the existing Global document/file infrastructure for the actual files rather than a second document system.',
  icon: '📄',
  emptyIcon: '📄',
  codeField: 'vin',
  nameField: 'vin',
  statusOptions: STATUSES,
  searchableKeys: ['vin', 'engine_number', 'registration_number', 'registration_authority'],
  fields: [
    { key: 'vin', label: 'VIN', type: 'lookup', required: true, listColumn: true, lookupResource: '/vehicle/units', lookupLabelKey: 'model_name' },
    { key: 'engine_number', label: 'Engine number', type: 'text', group: 'Registration' },
    { key: 'registration_number', label: 'Registration number', type: 'text', listColumn: true, group: 'Registration' },
    { key: 'registration_authority', label: 'Registration authority', type: 'text', group: 'Registration' },
    { key: 'registration_date', label: 'Registration date', type: 'date', group: 'Registration' },
    { key: 'rc_status', label: 'RC status', type: 'select', options: ['Not Issued', 'Issued', 'In Transit'], group: 'Registration' },
    { key: 'insurance_reference', label: 'Insurance reference', type: 'text', group: 'References' },
    { key: 'invoice_reference', label: 'Invoice reference', type: 'text', group: 'References' },
    { key: 'delivery_reference', label: 'Delivery reference', type: 'text', group: 'References' },
    { key: 'required_documents', label: 'Required documents', type: 'textarea', group: 'Documents' },
    { key: 'submitted_date', label: 'Submitted date', type: 'date', group: 'Documents' },
    { key: 'completion_date', label: 'Completion date', type: 'date', group: 'Documents' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', group: 'Documents' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Documents' },
  ],
  kpis: [
    { icon: '📄', iconClass: 'kpi-icon-ink', label: 'Total registrations', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Under process', value: (r) => String(r.filter((x) => x.status === 'Under Process' || x.status === 'Submitted').length) },
       { icon: '✔', iconClass: 'kpi-icon-green', label: 'Completed', value: (r) => String(r.filter((x) => x.status === 'Completed').length) },
  ],
  sampleRecords: [
    { id: 'demo-reg-1', vin: 'MA3ERLF1S00123456', registration_number: 'TN 22 AB 1234', registration_authority: 'RTO Chennai', status: 'Completed' },
    { id: 'demo-reg-2', vin: 'MA3FYEB1S00654321', registration_number: '—', registration_authority: 'RTO Coimbatore', status: 'Under Process' },
  ],
};
export function VehicleRegistrationPage() {
  return <VehicleMasterPage config={config} />;
}