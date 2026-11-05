import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { HandoverData, openHandoverNote } from '../lib/vehicleHandover';

const STATUSES = ['Preparation', 'PDI Pending', 'Documentation Pending', 'Payment Pending', 'Ready for Delivery', 'Delivered', 'Cancelled'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/deliveries',
  eyebrowModule: 'VEHICLE DELIVERY / PDI',
  title: 'Vehicle delivery / PDI',
  description: 'Pre-delivery inspection and handover. A vehicle only becomes Ready for Delivery once PDI, documentation, registration/insurance (where applicable) and required payment are all complete. Delivery marks the VIN as Delivered, completes the Core order, opens the registration file and starts the warranty. Insurance must be Complete (or Not Applicable). The customer is messaged when the vehicle is ready and when it is delivered.',
  icon: '▣',
  emptyIcon: '▣',
  codeField: 'delivery_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['delivery_number', 'client_name', 'vin', 'dealer_name', 'sales_rep'],
  fields: [
    { key: 'delivery_number', label: 'Delivery number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'DLV' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true },
    { key: 'client_id', label: 'Client (pick to link)', type: 'lookup', group: 'Link', lookupResource: '/clients', lookupLabelKey: 'client_name', autoFillMap: { client_name: 'client_name' } },
    { key: 'order_id', label: 'Core order', type: 'lookup', group: 'Link', lookupResource: '/orders', lookupLabelKey: 'order_number', autoFillMap: { order_number: 'order_number' } },
    { key: 'order_number', label: 'Order number (auto-filled)', type: 'text', readOnly: true, group: 'Link' },
    { key: 'booking_number', label: 'Booking number (auto-linked)', type: 'text', readOnly: true, group: 'Link' },
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
  sampleRecords: [],
};
function HandoverButton({ id }: { id: string }) {
  const { activeIndustryTypeId } = useIndustryScope();
  return (
    <button
      type="button"
      className="quiet-button"
      onClick={async () => {
        try {
          const q = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
          const res = await api<{ data: HandoverData }>(`/vehicle/deliveries/${id}/handover${q}`);
          openHandoverNote(res.data);
        } catch (e) { window.alert(e instanceof Error ? e.message : 'Could not open the handover note'); }
      }}
    >Handover note</button>
  );
}

export function VehicleDeliveryPdiPage() {
  return <VehicleMasterPage config={{ ...config, rowActions: (r) => (typeof r.id === 'string' && !r.id.startsWith('demo-') ? <HandoverButton id={r.id} /> : null) }} />;
}