import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const STATUSES = ['Requested', 'Reserved', 'Confirmed', 'Allocation Pending', 'Vehicle Allocated', 'Converted to Order', 'Cancelled'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/bookings',
  eyebrowModule: 'VEHICLE BOOKING',
  title: 'Vehicle booking / reservation',
  description: 'Reserve a vehicle or a specific VIN ahead of a sale. Confirming a booking reserves the VIN; cancelling releases it. Booking amounts post to the existing Core Collections module, and converting a booking creates/updates the existing Core Order — this module never keeps its own payment or order ledger.',
  icon: '▣',
  emptyIcon: '▣',
  codeField: 'booking_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['booking_number', 'client_name', 'model_name', 'vin', 'dealer_name', 'sales_rep'],
  fields: [
    { key: 'booking_number', label: 'Booking number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'BK' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true },
    {
      key: 'model_id', label: 'Model / variant', type: 'lookup', listColumn: true,
      lookupResource: '/vehicle/models', lookupLabelKey: 'model_name', autoFillMap: { model_name: 'model_name' },
    },
    { key: 'model_name', label: 'Model (auto-filled)', type: 'text', readOnly: true, group: 'Vehicle' },
    { key: 'vin', label: 'Specific VIN (if selected)', type: 'lookup', group: 'Vehicle', lookupResource: '/vehicle/units', lookupLabelKey: 'model_name' },
    {
      key: 'dealer_id', label: 'Dealer', type: 'lookup', listColumn: true, group: 'Vehicle',
      lookupResource: '/vehicle/dealers', lookupLabelKey: 'dealer_name', autoFillMap: { dealer_name: 'dealer_name' },
    },
    { key: 'dealer_name', label: 'Dealer (auto-filled)', type: 'text', readOnly: true, group: 'Vehicle' },
    { key: 'sales_rep', label: 'Sales representative', type: 'text', group: 'Schedule' },
    { key: 'booking_date', label: 'Booking date', type: 'date', group: 'Schedule' },
    { key: 'expected_delivery_date', label: 'Expected delivery date', type: 'date', listColumn: true, group: 'Schedule' },
    { key: 'booking_amount', label: 'Booking amount', type: 'number', listColumn: true, group: 'Payment' },
    { key: 'payment_reference', label: 'Payment reference (Core Collections)', type: 'text', group: 'Payment' },
    { key: 'scheme_name', label: 'Scheme applied', type: 'text', group: 'Payment' },
    { key: 'exchange_reference', label: 'Exchange reference', type: 'text', group: 'Payment' },
    { key: 'finance_required', label: 'Finance required', type: 'select', options: ['Yes', 'No'], group: 'Payment' },
    { key: 'insurance_required', label: 'Insurance required', type: 'select', options: ['Yes', 'No'], group: 'Payment' },
    { key: 'cancellation_reason', label: 'Cancellation reason', type: 'textarea', group: 'Status' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', group: 'Status' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Status' },
  ],
  kpis: [
    { icon: '▣', iconClass: 'kpi-icon-ink', label: 'Total bookings', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pending allocation', value: (r) => String(r.filter((x) => x.status === 'Allocation Pending' || x.status === 'Reserved').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Converted to order', value: (r) => String(r.filter((x) => x.status === 'Converted to Order').length) },
     { icon: '₹', iconClass: 'kpi-icon-school', label: 'Booking amount collected', value: (r) => `₹${r.reduce((sum, x) => sum + (Number(x.booking_amount) || 0), 0).toLocaleString()}` },
  ],
  sampleRecords: [
    { id: 'demo-booking-1', booking_number: 'BK-0001', client_name: 'Ramesh Iyer', model_name: 'Nexon', dealer_name: 'City Motors', expected_delivery_date: '2026-10-05', booking_amount: 25000, status: 'Confirmed' },
    { id: 'demo-booking-2', booking_number: 'BK-0002', client_name: 'Priya Menon', model_name: 'Creta', dealer_name: 'Highway Auto', expected_delivery_date: '2026-10-20', booking_amount: 50000, status: 'Allocation Pending' },
  ],
};

export function VehicleBookingPage() {
  return <VehicleMasterPage config={config} />;
}