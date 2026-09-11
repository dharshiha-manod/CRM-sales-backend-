import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const DEALER_TYPES = ['Authorized Dealer', 'Distributor', 'Sub Dealer', 'Branch', 'Franchise'];
const STATUSES = ['Active', 'Inactive', 'Suspended', 'Pending Approval'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/dealers',
  eyebrowModule: 'DEALER MANAGEMENT',
  title: 'Dealer management',
  description: 'Dealers, distributors and branches for the Vehicle industry. Vehicles, orders, collections and targets stay in their existing Core modules and link back here by dealer.',
  icon: '◎',
  emptyIcon: '◎',
  codeField: 'dealer_code',
  nameField: 'dealer_name',
  statusOptions: STATUSES,
  searchableKeys: ['dealer_code', 'dealer_name', 'contact_person', 'phone', 'city', 'territory'],
  fields: [
    { key: 'dealer_code', label: 'Dealer code', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'DLR' },
    { key: 'dealer_name', label: 'Dealer name', type: 'text', required: true, listColumn: true },
    { key: 'dealer_type', label: 'Dealer type', type: 'select', options: DEALER_TYPES, listColumn: true },
    { key: 'contact_person', label: 'Contact person', type: 'text', group: 'Contact' },
    { key: 'phone', label: 'Phone', type: 'text', group: 'Contact' },
    { key: 'email', label: 'Email', type: 'text', group: 'Contact' },
    { key: 'address', label: 'Address', type: 'textarea', group: 'Location' },
    { key: 'city', label: 'City', type: 'text', listColumn: true, group: 'Location' },
    { key: 'state', label: 'State', type: 'text', group: 'Location' },
    { key: 'country', label: 'Country', type: 'text', group: 'Location' },
    { key: 'territory', label: 'Territory', type: 'text', group: 'Location' },
    { key: 'gst_number', label: 'Tax / GST number', type: 'text', group: 'Commercial' },
    { key: 'assigned_manager', label: 'Assigned manager', type: 'text', group: 'Commercial' },
    { key: 'opening_date', label: 'Opening date', type: 'date', group: 'Commercial' },
    { key: 'sales_target', label: 'Sales target', type: 'number', group: 'Commercial' },
    { key: 'credit_limit', label: 'Credit limit', type: 'number', group: 'Commercial' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Commercial' },
    { key: 'status', label: 'Dealer status', type: 'select', options: STATUSES, listColumn: true, group: 'Commercial' },
  ],
  kpis: [
    { icon: '◎', iconClass: 'kpi-icon-ink', label: 'Total dealers', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active', value: (r) => String(r.filter((x) => x.status === 'Active').length) },
    { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Suspended', value: (r) => String(r.filter((x) => x.status === 'Suspended').length) },
      { icon: '₹', iconClass: 'kpi-icon-school', label: 'Combined sales target', value: (r) => `₹${r.reduce((sum, x) => sum + (Number(x.sales_target) || 0), 0).toLocaleString()}` },
  ],
  sampleRecords: [
    { id: 'demo-dealer-1', dealer_code: 'DLR-0001', dealer_name: 'City Motors', dealer_type: 'Authorized Dealer', city: 'Chennai', sales_target: 5000000, status: 'Active' },
    { id: 'demo-dealer-2', dealer_code: 'DLR-0002', dealer_name: 'Highway Auto', dealer_type: 'Sub Dealer', city: 'Coimbatore', sales_target: 2000000, status: 'Pending Approval' },
  ],
};

export function VehicleDealerPage() {
  return <VehicleMasterPage config={config} />;
}