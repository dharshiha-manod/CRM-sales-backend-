import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const DISCOUNT_TYPES = ['Percentage', 'Fixed Amount', 'Per Vehicle', 'Campaign Offer', 'Exchange Bonus'];
const CUSTOMER_TYPES = ['Retail', 'Corporate', 'Government', 'Fleet', 'Employee'];
const STATUSES = ['Draft', 'Active', 'Expired', 'Suspended'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/schemes',
  eyebrowModule: 'SCHEMES & DISCOUNTS',
  title: 'Schemes & discounts',
  description: 'Vehicle-specific schemes and offers. Only active, unexpired schemes should be offerable on a quotation or order; discounts beyond the configured approval limit should route to an approval workflow. This does not replace the existing Core Quotations module — schemes are applied there, not recreated here.',
  icon: '％',
  emptyIcon: '％',
  codeField: 'scheme_id',
  nameField: 'scheme_name',
  statusOptions: STATUSES,
  searchableKeys: ['scheme_id', 'scheme_name', 'model_name', 'dealer_name'],
  fields: [
    { key: 'scheme_id', label: 'Scheme ID', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'SCH' },
    { key: 'scheme_name', label: 'Scheme name', type: 'text', required: true, listColumn: true },
    {
      key: 'model_id', label: 'Model / variant', type: 'lookup', group: 'Scope',
      lookupResource: '/vehicle/models', lookupLabelKey: 'model_name', autoFillMap: { model_name: 'model_name' },
    },
    { key: 'model_name', label: 'Model (auto-filled)', type: 'text', readOnly: true, group: 'Scope' },
    {
      key: 'dealer_id', label: 'Dealer', type: 'lookup', group: 'Scope',
      lookupResource: '/vehicle/dealers', lookupLabelKey: 'dealer_name', autoFillMap: { dealer_name: 'dealer_name' },
    },
    { key: 'dealer_name', label: 'Dealer (auto-filled)', type: 'text', readOnly: true, group: 'Scope' },
    { key: 'customer_type', label: 'Customer type', type: 'select', options: CUSTOMER_TYPES, group: 'Scope' },
    { key: 'start_date', label: 'Start date', type: 'date', listColumn: true, group: 'Validity' },
    { key: 'end_date', label: 'End date', type: 'date', listColumn: true, group: 'Validity' },
    { key: 'discount_type', label: 'Discount type', type: 'select', options: DISCOUNT_TYPES, listColumn: true, group: 'Discount' },
    { key: 'discount_value', label: 'Discount value', type: 'number', listColumn: true, group: 'Discount' },
    { key: 'cash_discount', label: 'Cash discount', type: 'number', group: 'Discount' },
    { key: 'exchange_bonus', label: 'Exchange bonus', type: 'number', group: 'Discount' },
    { key: 'finance_offer', label: 'Finance offer', type: 'text', group: 'Discount' },
    { key: 'accessories_offer', label: 'Accessories offer', type: 'text', group: 'Discount' },
    { key: 'insurance_offer', label: 'Insurance offer', type: 'text', group: 'Discount' },
    { key: 'approval_required', label: 'Approval required', type: 'select', options: ['Yes', 'No'], group: 'Approval' },
    { key: 'terms', label: 'Terms', type: 'textarea', group: 'Approval' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Approval' },
  ],
  kpis: [
    { icon: '％', iconClass: 'kpi-icon-ink', label: 'Total schemes', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Currently active', value: (r) => String(r.filter((x) => x.status === 'Active').length) },
       { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Expired', value: (r) => String(r.filter((x) => x.status === 'Expired').length) },
  ],
  sampleRecords: [
    { id: 'demo-scheme-1', scheme_id: 'SCH-0001', scheme_name: 'Festive Cash Discount', model_name: 'Nexon', start_date: '2026-09-01', end_date: '2026-10-15', discount_type: 'Fixed Amount', discount_value: 25000, status: 'Active' },
    { id: 'demo-scheme-2', scheme_id: 'SCH-0002', scheme_name: 'Exchange Bonus Offer', model_name: 'Creta', start_date: '2026-06-01', end_date: '2026-07-31', discount_type: 'Exchange Bonus', discount_value: 15000, status: 'Expired' },
  ],
};

export function VehicleSchemeDiscountPage() {
  return <VehicleMasterPage config={config} />;
}