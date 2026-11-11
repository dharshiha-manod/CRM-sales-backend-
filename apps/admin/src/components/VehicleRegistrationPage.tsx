import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';
import { queueVehicleDraft } from '../lib/vehicleDraftHandoff';

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
    { key: 'vin', label: 'VIN', type: 'lookup', required: true, listColumn: true, lookupResource: '/vehicle/units', lookupLabelKey: 'vin', lookupSecondaryLabelKey: 'model_name', lookupValueKey: 'vin' },
    { key: 'client_name', label: 'Owner (auto-filled from delivery)', type: 'text', listColumn: true, group: 'References' },
    { key: 'engine_number', label: 'Engine number', type: 'text', group: 'Registration' },
    { key: 'registration_number', label: 'Registration number', type: 'text', listColumn: true, group: 'Registration' },
    { key: 'registration_authority', label: 'Registration authority', type: 'text', group: 'Registration' },
    { key: 'registration_date', label: 'Registration date', type: 'date', group: 'Registration' },
    { key: 'rc_status', label: 'RC status', type: 'select', options: ['Not Issued', 'Issued', 'In Transit'], group: 'Registration' },
    { key: 'insurance_reference', label: 'Insurance reference', type: 'text', group: 'References', helpText: 'Filled by itself when a policy is added in Insurance. If you type a policy number here, an insurance file opens in Insurance for the details (insurer, dates).' },
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
  sampleRecords: [],
  rowActions: (r) => (typeof r.id === 'string' && !r.id.startsWith('demo-') && r.vin
    ? <button type="button" className="quiet-button" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => queueVehicleDraft('insurance', { vin: String(r.vin), ...(r.client_id ? { client_id: String(r.client_id) } : {}), client_name: String(r.client_name ?? ''), policy_type: 'Comprehensive', ...(r.insurance_reference ? { policy_document_reference: String(r.insurance_reference) } : {}) })}>Add insurance</button>
    : null),
};
export function VehicleRegistrationPage() {
  return <VehicleMasterPage config={config} />;
}