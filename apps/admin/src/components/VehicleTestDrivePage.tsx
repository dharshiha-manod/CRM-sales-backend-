import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const STATUSES = ['Requested', 'Scheduled', 'Confirmed', 'In Progress', 'Completed', 'Cancelled', 'No Show'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/test-drives',
  eyebrowModule: 'TEST DRIVE MANAGEMENT',
  title: 'Test drive management',
  description: 'Schedule and track test drives against a demo VIN. Completing a drive updates the linked Client/Lead and creates a Core follow-up automatically.',
  icon: '○',
  emptyIcon: '○',
  codeField: 'test_drive_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['test_drive_number', 'client_name', 'model_name', 'vin', 'sales_rep'],
  fields: [
    { key: 'test_drive_number', label: 'Test drive number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'TD' },
    { key: 'client_name', label: 'Lead / client', type: 'text', required: true, listColumn: true },
    {
      key: 'model_id', label: 'Model / variant', type: 'lookup', listColumn: true,
      lookupResource: '/vehicle/models', lookupLabelKey: 'model_name', autoFillMap: { model_name: 'model_name' },
    },
    { key: 'model_name', label: 'Model (auto-filled)', type: 'text', readOnly: true, group: 'Vehicle' },
    {
      key: 'vin', label: 'Demo VIN', type: 'lookup', group: 'Vehicle',
      lookupResource: '/vehicle/units', lookupLabelKey: 'model_name',
    },
    {
      key: 'dealer_id', label: 'Dealer', type: 'lookup', group: 'Vehicle',
      lookupResource: '/vehicle/dealers', lookupLabelKey: 'dealer_name', autoFillMap: { dealer_name: 'dealer_name' },
    },
    { key: 'dealer_name', label: 'Dealer (auto-filled)', type: 'text', readOnly: true, group: 'Vehicle' },
    { key: 'sales_rep', label: 'Sales representative', type: 'text', group: 'Schedule' },
    { key: 'drive_date', label: 'Date', type: 'date', listColumn: true, group: 'Schedule' },
    { key: 'start_time', label: 'Start time', type: 'text', group: 'Schedule' },
    { key: 'end_time', label: 'End time', type: 'text', group: 'Schedule' },
    { key: 'pickup_location', label: 'Pickup location', type: 'text', group: 'Schedule' },
    { key: 'return_location', label: 'Return location', type: 'text', group: 'Schedule' },
    { key: 'license_verified', label: 'Driving licence verified', type: 'select', options: ['Yes', 'No'], group: 'Vehicle condition' },
    { key: 'odometer_start', label: 'Odometer (start)', type: 'number', group: 'Vehicle condition' },
    { key: 'odometer_end', label: 'Odometer (end)', type: 'number', group: 'Vehicle condition' },
    { key: 'fuel_start', label: 'Fuel / battery (start)', type: 'text', group: 'Vehicle condition' },
    { key: 'fuel_end', label: 'Fuel / battery (end)', type: 'text', group: 'Vehicle condition' },
    { key: 'customer_feedback', label: 'Customer feedback', type: 'textarea', group: 'Outcome' },
    { key: 'outcome', label: 'Outcome', type: 'text', group: 'Outcome' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Outcome' },
  ],
  kpis: [
    { icon: '○', iconClass: 'kpi-icon-ink', label: 'Total test drives', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Scheduled / confirmed', value: (r) => String(r.filter((x) => x.status === 'Scheduled' || x.status === 'Confirmed').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Completed', value: (r) => String(r.filter((x) => x.status === 'Completed').length) },
        { icon: '⚠', iconClass: 'kpi-icon-red', label: 'No show / cancelled', value: (r) => String(r.filter((x) => x.status === 'No Show' || x.status === 'Cancelled').length) },
  ],
  sampleRecords: [
    { id: 'demo-td-1', test_drive_number: 'TD-0001', client_name: 'Arjun Nair', model_name: 'Nexon', drive_date: '2026-09-10', status: 'Scheduled' },
    { id: 'demo-td-2', test_drive_number: 'TD-0002', client_name: 'Divya Suresh', model_name: 'Creta', drive_date: '2026-09-02', status: 'Completed' },
  ],
};

export function VehicleTestDrivePage() {
  return <VehicleMasterPage config={config} />;
}