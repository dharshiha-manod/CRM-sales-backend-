import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const RATE_TYPES = ['Purchase Rate', 'Selling Rate', 'Wholesale Rate', 'Retail Rate', 'Customer-specific Rate', 'Supplier-specific Rate'];
const STATUSES = ['Active', 'Upcoming', 'Expired'];

function rateStatus(r: Record<string, unknown>): string {
  const now = new Date();
  const from = r.effective_from ? new Date(r.effective_from as string) : null;
  const to = r.effective_to ? new Date(r.effective_to as string) : null;
  if (to && to < now) return 'Expired';
  if (from && from > now) return 'Upcoming';
  return 'Active';
}

const config: TradingModuleConfig = {
  resource: '/trading/price-lists',
  eyebrowModule: 'PRICE LIST / RATE MANAGEMENT',
  title: 'Price list / rate management',
  description: 'Supplier purchase rates and customer selling rates, with an effective date range. Each change is a new record — history is kept, never overwritten.',
  icon: '₹',
  emptyIcon: '₹',
  codeField: 'product_code',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['product_name', 'product_code', 'supplier_name', 'customer_name'],
  fields: [
    { key: 'product_name', label: 'Product', type: 'lookup', required: true, lookupResource: '/products?status=active', lookupLabelKey: 'product_code', autoFillMap: { product_code: 'product_code' }, listColumn: true },
    { key: 'product_code', label: 'Product code', type: 'text', readOnly: true, listColumn: true },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Rate' },
    { key: 'customer_name', label: 'Customer (if customer-specific)', type: 'lookup', lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_code', group: 'Rate' },
    { key: 'rate_type', label: 'Rate type', type: 'select', options: RATE_TYPES, listColumn: true, group: 'Rate' },
    { key: 'purchase_rate', label: 'Purchase rate', type: 'number', group: 'Rate' },
    { key: 'selling_rate', label: 'Selling rate', type: 'number', group: 'Rate' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Rate' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Rate' },
    { key: 'min_quantity', label: 'Minimum quantity', type: 'number', group: 'Rate' },
    { key: 'tax', label: 'Tax', type: 'number', group: 'Rate' },
    { key: 'discount', label: 'Discount', type: 'number', group: 'Rate' },
    { key: 'effective_from', label: 'Effective from', type: 'date', listColumn: true, group: 'Validity' },
    { key: 'effective_to', label: 'Effective to', type: 'date', listColumn: true, group: 'Validity' },
    {
      key: 'validity',
      label: 'Validity',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => rateStatus(r),
      group: 'Validity',
    },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, group: 'Validity' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Validity' },
  ],
  kpis: [
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active price lists', value: (r) => String(r.filter((x) => rateStatus(x) === 'Active').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Expired rates', value: (r) => String(r.filter((x) => rateStatus(x) === 'Expired').length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Upcoming rate changes', value: (r) => String(r.filter((x) => rateStatus(x) === 'Upcoming').length) },
    { icon: '₹', iconClass: 'kpi-icon-ink', label: 'Total price records', value: (r) => String(r.length) },
  ],
  
};

export function TradingPriceRateListPage() {
  return <TradingMasterPage config={config} />;
}