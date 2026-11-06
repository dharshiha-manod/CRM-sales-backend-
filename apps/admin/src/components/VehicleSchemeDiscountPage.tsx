import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const DISCOUNT_TYPES = ['Percentage', 'Fixed Amount', 'Per Vehicle', 'Campaign Offer', 'Exchange Bonus'];
const CUSTOMER_TYPES = [
  'All customers', 'Retail', 'Corporate', 'Government', 'Defence / Police', 'Fleet', 'Taxi / Commercial', 'Employee',
  'Existing customer (repeat)', 'Referral', 'Farmer', 'Student', 'Senior citizen', 'Women', 'Doctor / Professional', 'Dealer staff', 'Other',
];
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
      format: (v, rec) => String(rec?.model_name || (v ? v : 'All models')),
      lookupResource: '/vehicle/models', lookupLabelKey: 'model_name', autoFillMap: { model_name: 'model_name' },
    },
    { key: 'model_name', label: 'Model', type: 'text', readOnly: true, listColumn: true, group: 'Scope', visibleIf: () => false }, // shown once, in 'Model / variant'
    {
      key: 'dealer_id', label: 'Branch (optional)', type: 'lookup', group: 'Scope',
      format: (v, rec) => String(rec?.dealer_name || (v ? v : 'All branches')),
      lookupResource: '/vehicle/dealers', lookupLabelKey: 'dealer_name', autoFillMap: { dealer_name: 'dealer_name' },
      lookupFilter: (o) => o.dealer_type === 'Branch', helpText: 'Leave blank if the scheme is for all branches.',
    },
    { key: 'dealer_name', label: 'Dealer (auto-filled)', type: 'text', readOnly: true, group: 'Scope', visibleIf: () => false }, // shown once, in 'Dealer'
    { key: 'customer_type', label: 'Customer type', type: 'select', options: CUSTOMER_TYPES, group: 'Scope' },
    { key: 'start_date', label: 'Start date', type: 'date', listColumn: true, group: 'Validity', helpText: 'Leave blank to start immediately' },
    { key: 'end_date', label: 'End date', type: 'date', listColumn: true, group: 'Validity', helpText: 'Must not be before the start date. The scheme turns Expired by itself after this date.' },
    // The boxes below follow the Discount type, so only the relevant ones show.
    { key: 'discount_type', label: 'Discount type', type: 'select', options: DISCOUNT_TYPES, required: true, listColumn: true, group: 'Discount', defaultValue: () => 'Percentage' },
    { key: 'discount_value', label: 'Discount value', type: 'number', min: 0, listColumn: true, group: 'Discount',
      // the symbol follows the Discount type: % for Percentage, ₹ for every amount type
      labelSuffix: (f) => (f.discount_type === 'Percentage' ? ' (%)' : ' (₹)'),
      format: (v, row) => (v === null || v === undefined || v === '' ? '—' : row.discount_type === 'Percentage' ? `${String(v)}%` : `₹${Number(v).toLocaleString('en-IN')}`),
      visibleIf: (f) => ['', 'Percentage', 'Fixed Amount', 'Per Vehicle'].includes(f.discount_type ?? ''), },
    { key: 'cash_discount', label: 'Cash discount (₹)', type: 'number', min: 0, group: 'Discount',
      visibleIf: (f) => f.discount_type === 'Campaign Offer',
      helpText: 'Flat ₹ off for this campaign' },
    { key: 'exchange_bonus', label: 'Exchange bonus (₹)', type: 'number', min: 0, group: 'Discount',
      visibleIf: (f) => ['Exchange Bonus', 'Campaign Offer'].includes(f.discount_type ?? ''),
      helpText: 'Extra ₹ for customers who exchange their old vehicle' },
    // Pick a common offer from the list, or type your own.
    { key: 'finance_offer', label: 'Finance offer', type: 'combo', group: 'Discount', comboOptions: ['Zero down payment', 'Low interest rate', 'Zero processing fee', 'Cashback on finance', 'Extended tenure', 'Pre-approved loan'] },
    { key: 'accessories_offer', label: 'Accessories offer', type: 'combo', group: 'Discount', comboOptions: ['Free accessories kit', 'Free helmet', 'Free seat cover', 'Free floor mats', 'Free body cover', 'Free mobile holder'] },
    { key: 'insurance_offer', label: 'Insurance offer', type: 'combo', group: 'Discount', comboOptions: ['Free first-year insurance', 'Discount on insurance', 'Zero depreciation cover', 'Free roadside assistance'] },
    { key: 'approval_required', label: 'Approval required', type: 'select', options: ['Yes', 'No'], group: 'Approval', defaultValue: () => 'No',
      helpText: 'Yes = never given automatically on a quotation / order; only a manager can select it on a booking.' },
    // Rules that limit a scheme (all optional; leave blank for no limit).
    { key: 'min_quantity', label: 'Minimum quantity', type: 'number', group: 'Limits', helpText: 'Scheme applies only when the line has at least this many vehicles.' },
    { key: 'usage_limit', label: 'Usage limit (vehicles)', type: 'number', group: 'Limits', helpText: 'Stops applying once this many vehicles have taken the scheme.' },
    { key: 'budget_cap', label: 'Budget cap (total discount)', type: 'number', group: 'Limits', helpText: 'Stops applying once this much discount has been given in total.' },
    { key: 'stackable', label: 'Can combine with another scheme', type: 'select', options: ['Yes', 'No'], group: 'Limits', defaultValue: () => 'No', helpText: 'No = only the single best scheme applies. Yes = this scheme is added on top of the best one.' },
    // Usage numbers (filled by the server, read only).
    { key: 'times_used', label: 'Orders using it', type: 'number', readOnly: true, listColumn: true, group: 'Usage', visibleIf: () => false },
    { key: 'vehicles_sold', label: 'Vehicles', type: 'number', readOnly: true, group: 'Usage', visibleIf: () => false },
    { key: 'total_discount', label: 'Discount given', type: 'number', readOnly: true, listColumn: true, group: 'Usage', visibleIf: () => false },
    { key: 'terms', label: 'Terms', type: 'textarea', group: 'Approval', helpText: 'Leave blank: it is written automatically from the dates, model and customer type.' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Approval', defaultValue: () => 'Active' },
  ],
  kpis: [
    { icon: '％', iconClass: 'kpi-icon-ink', label: 'Total schemes', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Currently active', value: (r) => String(r.filter((x) => x.status === 'Active').length) },
       { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Expired', value: (r) => String(r.filter((x) => x.status === 'Expired').length) },
    { icon: '₹', iconClass: 'kpi-icon-ink', label: 'Discount given', value: (r) => '₹' + Math.round(r.reduce((t, x) => t + (Number(x.total_discount) || 0), 0)).toLocaleString('en-IN') },
    { icon: '🚗', iconClass: 'kpi-icon-green', label: 'Vehicles on schemes', value: (r) => String(r.reduce((t, x) => t + (Number(x.vehicles_sold) || 0), 0)) },
  ],
  sampleRecords: [],
};

export function VehicleSchemeDiscountPage() {
  return <VehicleMasterPage config={config} />;
}