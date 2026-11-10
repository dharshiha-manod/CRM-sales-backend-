import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';
import { orderPicker } from '../lib/vehicleOrderFill';

const STATUSES = ['Issued', 'Paid', 'Cancelled'];
const money = (n: number) => `\u20B9${Math.round(n).toLocaleString('en-IN')}`;

const config: VehicleModuleConfig = {
  resource: '/vehicle/invoices',
  eyebrowModule: 'TAX INVOICE',
  title: 'Vehicle tax invoices',
  description: 'One tax invoice per vehicle on a Core order. It is raised by itself when the Delivery / PDI file opens, ticks the Tax invoice paper on the delivery checklist, turns Paid when the delivery payment is Complete and is Cancelled when the delivery or order is cancelled. Amounts come from the order lines.',
  icon: '\u20B9',
  emptyIcon: '\u20B9',
  codeField: 'invoice_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['invoice_number', 'client_name', 'vin', 'order_number'],
  fields: [
    { key: 'invoice_number', label: 'Invoice number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'INV' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true },
    { key: 'client_id', label: 'Client (pick to link)', type: 'lookup', group: 'Link', lookupResource: '/clients', lookupLabelKey: 'client_name', autoFillMap: { client_name: 'client_name' } },
    { key: 'order_id', label: 'Core order', type: 'lookup', group: 'Link', ...orderPicker({}), autoFillMap: { order_number: 'order_number' } },
    { key: 'order_number', label: 'Order number (auto-filled)', type: 'text', readOnly: true, listColumn: true, group: 'Link' },
    { key: 'booking_number', label: 'Booking number (auto-linked)', type: 'text', readOnly: true, group: 'Link' },
    { key: 'delivery_number', label: 'Delivery number (auto-linked)', type: 'text', readOnly: true, group: 'Link' },
    { key: 'vin', label: 'Vehicle (VIN)', type: 'lookup', listColumn: true, group: 'Vehicle', lookupResource: '/vehicle/units', lookupLabelKey: 'vin', lookupSecondaryLabelKey: 'model_name', lookupValueKey: 'vin' },
    { key: 'invoice_date', label: 'Invoice date', type: 'date', listColumn: true, group: 'Amounts', helpText: 'Leave blank to use today.' },
    { key: 'due_date', label: 'Due date', type: 'date', group: 'Amounts', helpText: 'Leave blank to use the invoice date.' },
    { key: 'subtotal', label: 'Vehicle price (before discount)', type: 'number', group: 'Amounts' },
    { key: 'discount_amount', label: 'Discount', type: 'number', group: 'Amounts' },
    { key: 'tax_amount', label: 'GST / tax', type: 'number', group: 'Amounts' },
    { key: 'total_amount', label: 'Invoice total (calculated)', type: 'number', readOnly: true, listColumn: true, group: 'Amounts', helpText: 'Price - discount + tax. Always calculated by the server.' },
    { key: 'paid_amount', label: 'Paid', type: 'number', readOnly: true, group: 'Amounts', helpText: 'Fills itself when the delivery payment is Complete.' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', group: 'Amounts' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Amounts', helpText: 'Follows the delivery by itself. Choose Cancelled by hand only to withdraw an invoice.' },
  ],
  kpis: [
    { icon: '\u20B9', iconClass: 'kpi-icon-ink', label: 'Invoiced (not cancelled)', value: (r) => money(r.filter((x) => x.status !== 'Cancelled').reduce((s, x) => s + Number(x.total_amount ?? 0), 0)) },
    { icon: '\u2714', iconClass: 'kpi-icon-green', label: 'Paid', value: (r) => String(r.filter((x) => x.status === 'Paid').length) },
    { icon: '\u26A0', iconClass: 'kpi-icon-red', label: 'Issued, not paid', value: (r) => String(r.filter((x) => x.status === 'Issued').length) },
  ],
  sampleRecords: [],
};

export function VehicleInvoicePage() {
  return <VehicleMasterPage config={config} />;
}