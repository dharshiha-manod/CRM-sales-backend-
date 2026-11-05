import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const STATUSES = ['Requested', 'Under Review', 'Approved', 'Rejected', 'Vehicle Received', 'Inspection', 'Refund Pending', 'Refunded', 'Closed'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/returns',
  eyebrowModule: 'RETURNS / CANCELLATION',
  title: 'Returns / cancellation',
  description: 'Booking cancellations, sales cancellations and vehicle returns. Approval releases the vehicle reservation, a returned vehicle moves the linked unit to Returned/Inspection in the existing Core Inventory, and a completed refund updates the existing Core Collections module.',
  icon: '↩',
  emptyIcon: '↩',
  codeField: 'return_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['return_number', 'client_name', 'vin', 'sales_order_reference', 'booking_reference'],
  fields: [
    { key: 'return_number', label: 'Return / cancellation number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'RTN' },
    { key: 'return_type', label: 'Type', type: 'select', options: ['Booking Cancellation', 'Sales Cancellation', 'Vehicle Return', 'Exchange Cancellation'], listColumn: true },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true },
    { key: 'client_id', label: 'Client (pick to link)', type: 'lookup', group: 'Link', lookupResource: '/clients', lookupLabelKey: 'client_name', autoFillMap: { client_name: 'client_name' } },
    { key: 'order_id', label: 'Core order', type: 'lookup', group: 'Link', lookupResource: '/orders', lookupLabelKey: 'order_number' },
    { key: 'vin', label: 'VIN', type: 'lookup', group: 'Reference', lookupResource: '/vehicle/units', lookupLabelKey: 'model_name' },
    { key: 'sales_order_reference', label: 'Sales order reference (Core Orders)', type: 'text', group: 'Reference' },
    { key: 'booking_reference', label: 'Booking reference', type: 'text', group: 'Reference' },
    { key: 'reason', label: 'Reason', type: 'textarea', group: 'Request' },
    { key: 'request_date', label: 'Date', type: 'date', listColumn: true, group: 'Request' },
    { key: 'amount', label: 'Amount', type: 'number', group: 'Refund' },
    { key: 'refund_amount', label: 'Refund amount', type: 'number', listColumn: true, group: 'Refund' },
    { key: 'inspection_result', label: 'Inspection result', type: 'textarea', group: 'Inspection' },
    { key: 'vehicle_condition', label: 'Vehicle condition', type: 'select', options: ['Excellent', 'Good', 'Fair', 'Poor', 'Not Applicable'], group: 'Inspection' },
    { key: 'approval', label: 'Approved by', type: 'text', group: 'Inspection' },
    { key: 'status', label: 'Final status', type: 'select', options: STATUSES, listColumn: true, group: 'Inspection' },
  ],
  kpis: [
    { icon: '↩', iconClass: 'kpi-icon-ink', label: 'Total requests', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Under review / inspection', value: (r) => String(r.filter((x) => x.status === 'Under Review' || x.status === 'Inspection').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Refunded / closed', value: (r) => String(r.filter((x) => x.status === 'Refunded' || x.status === 'Closed').length) },
      { icon: '₹', iconClass: 'kpi-icon-school', label: 'Refunded amount', value: (r) => `₹${r.reduce((sum, x) => sum + (Number(x.refund_amount) || 0), 0).toLocaleString()}` },
  ],
  sampleRecords: [],
};

export function VehicleReturnsPage() {
  return <VehicleMasterPage config={config} />;
}