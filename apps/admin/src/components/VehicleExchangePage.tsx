import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const STATUSES = ['Requested', 'Inspection', 'Valuation', 'Approved', 'Rejected', 'Converted'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/exchanges',
  eyebrowModule: 'VEHICLE EXCHANGE',
  title: 'Trade-in / vehicle exchange',
  description: 'Customer trade-in vehicles, from inspection through valuation, approval and linking to the new-vehicle sales order.',
  icon: '↔',
  emptyIcon: '↔',
  codeField: 'exchange_id',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['exchange_id', 'client_name', 'existing_registration_number', 'new_vehicle_vin'],
  fields: [
    { key: 'exchange_id', label: 'Exchange ID', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'EXG' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true },
    { key: 'existing_registration_number', label: 'Existing vehicle registration number', type: 'text', group: 'Existing vehicle' },
    { key: 'existing_make', label: 'Make', type: 'text', group: 'Existing vehicle' },
    { key: 'existing_model', label: 'Model', type: 'text', listColumn: true, group: 'Existing vehicle' },
    { key: 'existing_variant', label: 'Variant', type: 'text', group: 'Existing vehicle' },
    { key: 'manufacturing_year', label: 'Manufacturing year', type: 'number', group: 'Existing vehicle' },
    { key: 'odometer', label: 'Odometer', type: 'number', group: 'Existing vehicle' },
    { key: 'condition', label: 'Condition', type: 'select', options: ['Excellent', 'Good', 'Fair', 'Poor'], group: 'Existing vehicle' },
    { key: 'inspection_result', label: 'Inspection result', type: 'textarea', group: 'Valuation' },
    { key: 'estimated_value', label: 'Estimated value', type: 'number', group: 'Valuation' },
    { key: 'approved_value', label: 'Approved value', type: 'number', listColumn: true, group: 'Valuation' },
    { key: 'outstanding_loan', label: 'Outstanding loan', type: 'number', group: 'Valuation' },
    { key: 'net_exchange_value', label: 'Net exchange value', type: 'number', listColumn: true, group: 'Valuation' },
    { key: 'new_vehicle_vin', label: 'New vehicle (VIN)', type: 'lookup', group: 'New vehicle', lookupResource: '/vehicle/units', lookupLabelKey: 'model_name' },
    { key: 'sales_order_reference', label: 'Sales order reference (Core Orders)', type: 'text', group: 'New vehicle' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'New vehicle' },
  ],
  kpis: [
    { icon: '↔', iconClass: 'kpi-icon-ink', label: 'Total exchanges', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'In valuation', value: (r) => String(r.filter((x) => x.status === 'Inspection' || x.status === 'Valuation').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Approved / converted', value: (r) => String(r.filter((x) => x.status === 'Approved' || x.status === 'Converted').length) },
      { icon: '₹', iconClass: 'kpi-icon-school', label: 'Net exchange value', value: (r) => `₹${r.reduce((sum, x) => sum + (Number(x.net_exchange_value) || 0), 0).toLocaleString()}` },
  ],
  sampleRecords: [
    { id: 'demo-exg-1', exchange_id: 'EXG-0001', client_name: 'Suresh Babu', existing_model: 'i10', approved_value: 180000, net_exchange_value: 150000, status: 'Approved' },
    { id: 'demo-exg-2', exchange_id: 'EXG-0002', client_name: 'Kavitha Raj', existing_model: 'Swift', approved_value: 320000, net_exchange_value: 280000, status: 'Valuation' },
  ],
};

export function VehicleExchangePage() {
  return <VehicleMasterPage config={config} />;
}