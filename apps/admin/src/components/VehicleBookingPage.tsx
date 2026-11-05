import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';
import { consumeVehicleDraft } from '../lib/vehicleDraftHandoff';

const STATUSES = ['Requested', 'Reserved', 'Confirmed', 'Allocation Pending', 'Vehicle Allocated', 'Converted to Order', 'Cancelled'];

const config: VehicleModuleConfig = {
  consumePendingDraft: () => consumeVehicleDraft('booking'),
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
    { key: 'client_id', label: 'Client (pick to link)', type: 'lookup', group: 'Link', lookupResource: '/clients', lookupLabelKey: 'client_name', autoFillMap: { client_name: 'client_name' } },
    { key: 'lead_id', label: 'Lead (pick to link)', type: 'lookup', group: 'Link', lookupResource: '/leads', industryScoped: true, lookupLabelKey: 'company_name', autoFillMap: { client_name: 'company_name' } },
    { key: 'order_id', label: 'Core order', type: 'lookup', group: 'Link', lookupResource: '/orders', lookupLabelKey: 'order_number', autoFillMap: { order_number: 'order_number' } },
    { key: 'order_number', label: 'Order number (auto-filled)', type: 'text', readOnly: true, group: 'Link' },
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
  sampleRecords: [],
};

export function VehicleBookingPage() {
  return <VehicleMasterPage config={config} />;
}