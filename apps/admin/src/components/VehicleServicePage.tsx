import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const SERVICE_TYPES = ['First Service', 'Periodic Service', 'Repair', 'Inspection', 'Breakdown', 'Warranty Service'];
const STATUSES = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/service-records',
  eyebrowModule: 'SERVICE / AFTER-SALES',
  title: 'Vehicle service / after-sales',
  description: 'Service and repair history per VIN. Completing a service calculates the next service due date/odometer and creates the existing Core follow-up and notification when it falls due.',
  icon: '🔧',
  emptyIcon: '🔧',
  codeField: 'service_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['service_number', 'client_name', 'vin', 'registration_number', 'workshop'],
  fields: [
    { key: 'service_number', label: 'Service number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'SRV' },
    { key: 'vin', label: 'VIN', type: 'lookup', listColumn: true, group: 'Vehicle', lookupResource: '/vehicle/units', lookupLabelKey: 'model_name' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true, group: 'Vehicle' },
    { key: 'registration_number', label: 'Registration number', type: 'text', group: 'Vehicle' },
    { key: 'service_type', label: 'Service type', type: 'select', options: SERVICE_TYPES, listColumn: true, group: 'Service' },
    { key: 'service_date', label: 'Service date', type: 'date', listColumn: true, group: 'Service' },
    { key: 'odometer', label: 'Odometer', type: 'number', group: 'Service' },
    { key: 'service_advisor', label: 'Service advisor', type: 'text', group: 'Service' },
    { key: 'workshop', label: 'Workshop', type: 'text', group: 'Service' },
    { key: 'parts_used', label: 'Parts used', type: 'textarea', group: 'Cost' },
    { key: 'labour', label: 'Labour', type: 'text', group: 'Cost' },
    { key: 'service_cost', label: 'Service cost', type: 'number', listColumn: true, group: 'Cost' },
    { key: 'complaint', label: 'Complaint', type: 'textarea', group: 'Resolution' },
    { key: 'resolution', label: 'Resolution', type: 'textarea', group: 'Resolution' },
    { key: 'next_service_date', label: 'Next service date', type: 'date', group: 'Resolution' },
    { key: 'next_service_odometer', label: 'Next service odometer', type: 'number', group: 'Resolution' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Resolution' },
  ],
  kpis: [
    { icon: '🔧', iconClass: 'kpi-icon-ink', label: 'Total service records', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'In progress', value: (r) => String(r.filter((x) => x.status === 'In Progress' || x.status === 'Scheduled').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Completed', value: (r) => String(r.filter((x) => x.status === 'Completed').length) },
      { icon: '₹', iconClass: 'kpi-icon-school', label: 'Service revenue', value: (r) => `₹${r.reduce((sum, x) => sum + (Number(x.service_cost) || 0), 0).toLocaleString()}` },
  ],
  sampleRecords: [
    { id: 'demo-srv-1', service_number: 'SRV-0001', client_name: 'Ramesh Iyer', service_type: 'Periodic Service', service_date: '2026-08-15', service_cost: 4200, status: 'Completed' },
    { id: 'demo-srv-2', service_number: 'SRV-0002', client_name: 'Suresh Babu', service_type: 'Repair', service_date: '2026-09-01', service_cost: 8900, status: 'In Progress' },
  ],
};
export function VehicleServicePage() {
  return <VehicleMasterPage config={config} />;
}