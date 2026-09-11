import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const STATUSES = ['Preparation', 'PDI Pending', 'Documentation Pending', 'Payment Pending', 'Ready for Delivery', 'Delivered', 'Cancelled'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/deliveries',
  eyebrowModule: 'VEHICLE DELIVERY / PDI',
  title: 'Vehicle delivery / PDI',
  description: 'Pre-delivery inspection and handover. A vehicle only becomes Ready for Delivery once PDI, documentation, registration/insurance (where applicable) and required payment are all complete. Delivery updates the existing Core Inventory, Core Order and Client ownership history, and activates warranty.',
  icon: '▣',
  emptyIcon: '▣',
  codeField: 'delivery_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['delivery_number', 'client_name', 'vin', 'dealer_name', 'sales_rep'],
  fields: [
    { key: 'delivery_number', label: 'Delivery number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'DLV' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true },
    { key: 'vin', label: 'VIN', type: 'lookup', listColumn: true, group: 'Vehicle', lookupResource: '/vehicle/units', lookupLabelKey: 'model_name' },
    { key: 'engine_number', label: 'Engine number', type: 'text', group: 'Vehicle' },
    { key: 'sales_order_reference', label: 'Sales order reference (Core Orders)', type: 'text', group: 'Vehicle' },
    {
      key: 'dealer_id', label: 'Dealer', type: 'lookup', group: 'Vehicle',
      lookupResource: '/vehicle/dealers', lookupLabelKey: 'dealer_name', autoFillMap: { dealer_name: 'dealer_name' },
    },
    { key: 'dealer_name', label: 'Dealer (auto-filled)', type: 'text', readOnly: true, group: 'Vehicle' },
    { key: 'sales_rep', label: 'Sales representative', type: 'text', group: 'Schedule' },
    { key: 'delivery_date', label: 'Delivery date', type: 'date', listColumn: true, group: 'Schedule' },
    { key: 'delivery_location', label: 'Delivery location', type: 'text', group: 'Schedule' },
    { key: 'odometer', label: 'Odometer', type: 'number', group: 'Handover' },
    { key: 'fuel_level', label: 'Fuel / battery level', type: 'text', group: 'Handover' },
    { key: 'pdi_status', label: 'PDI status', type: 'select', options: ['Not Started', 'In Progress', 'Passed', 'Failed'], listColumn: true, group: 'Readiness' },
    { key: 'documentation_status', label: 'Documentation status', type: 'select', options: ['Pending', 'Complete'], group: 'Readiness' },
    { key: 'payment_status', label: 'Payment status', type: 'select', options: ['Pending', 'Complete'], group: 'Readiness' },
    { key: 'registration_status', label: 'Registration status', type: 'select', options: ['Pending', 'Complete', 'Not Applicable'], group: 'Readiness' },
    { key: 'insurance_status', label: 'Insurance status', type: 'select', options: ['Pending', 'Complete', 'Not Applicable'], group: 'Readiness' },
    { key: 'accessories_status', label: 'Accessories status', type: 'select', options: ['Pending', 'Fitted', 'Not Applicable'], group: 'Readiness' },
    { key: 'customer_acknowledgement', label: 'Customer acknowledgement', type: 'select', options: ['Yes', 'No'], group: 'Readiness' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', group: 'Readiness' },
    { key: 'status', label: 'Delivery status', type: 'select', options: STATUSES, listColumn: true, group: 'Readiness' },
  ],
  kpis: [
    { icon: '▣', iconClass: 'kpi-icon-ink', label: 'Total deliveries', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'PDI / docs pending', value: (r) => String(r.filter((x) => x.status === 'PDI Pending' || x.status === 'Documentation Pending').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Ready for delivery', value: (r) => String(r.filter((x) => x.status === 'Ready for Delivery').length) },
     { icon: '↗', iconClass: 'kpi-icon-school', label: 'Delivered', value: (r) => String(r.filter((x) => x.status === 'Delivered').length) },
  ],
  sampleRecords: [
    { id: 'demo-dlv-1', delivery_number: 'DLV-0001', client_name: 'Ramesh Iyer', vin: 'MA3ERLF1S00123456', delivery_date: '2026-09-05', pdi_status: 'Passed', status: 'Delivered' },
    { id: 'demo-dlv-2', delivery_number: 'DLV-0002', client_name: 'Priya Menon', vin: 'MA3FYEB1S00654321', delivery_date: '2026-09-25', pdi_status: 'In Progress', status: 'PDI Pending' },
  ],
};
export function VehicleDeliveryPdiPage() {
  return <VehicleMasterPage config={config} />;
}