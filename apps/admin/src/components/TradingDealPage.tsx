import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const STATUSES = ['Draft', 'Enquiry', 'Negotiation', 'Quotation', 'Confirmed', 'In Progress', 'Completed', 'Cancelled', 'Lost'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

function sellingValue(r: Record<string, unknown>) {
  return (Number(r.selling_rate) || 0) * (Number(r.quantity) || 0);
}
function purchaseValue(r: Record<string, unknown>) {
  return (Number(r.purchase_rate) || 0) * (Number(r.quantity) || 0);
}

const config: TradingModuleConfig = {
  resource: '/trading/deals',
  eyebrowModule: 'DEAL MANAGEMENT',
  title: 'Deal management',
  description: 'Trading deals from initial requirement through negotiation, confirmation and closure, with margin calculated automatically from purchase and selling rate.',
  icon: '◆',
  emptyIcon: '◆',
  codeField: 'deal_number',
  nameField: 'deal_name',
  statusOptions: STATUSES,
  searchableKeys: ['deal_number', 'deal_name', 'customer_name', 'supplier_name', 'product_name', 'sales_rep'],
  fields: [
    { key: 'deal_number', label: 'Deal number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'DEAL' },
    { key: 'deal_name', label: 'Deal name', type: 'text', required: true, listColumn: true },
    { key: 'customer_name', label: 'Customer', type: 'lookup', required: true, lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_code', listColumn: true },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', listColumn: true },
    { key: 'product_name', label: 'Product', type: 'lookup', lookupResource: '/products?status=active', lookupLabelKey: 'product_code', listColumn: true, group: 'Product & quantity' },
    { key: 'product_category', label: 'Product category', type: 'text', group: 'Product & quantity' },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Product & quantity' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Product & quantity' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Product & quantity', placeholder: 'e.g. INR, USD' },
    { key: 'purchase_rate', label: 'Purchase rate', type: 'number', group: 'Rates & margin' },
    { key: 'selling_rate', label: 'Selling rate', type: 'number', group: 'Rates & margin' },
    {
      key: 'gross_margin',
      label: 'Gross margin',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => `₹${(sellingValue(r) - purchaseValue(r)).toLocaleString()}`,
      group: 'Rates & margin',
    },
    {
      key: 'margin_percent',
      label: 'Margin %',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => {
        const sv = sellingValue(r);
        if (!sv) return '—';
        return `${(((sv - purchaseValue(r)) / sv) * 100).toFixed(2)}%`;
      },
      group: 'Rates & margin',
    },
    { key: 'deal_date', label: 'Deal date', type: 'date', group: 'Schedule & terms' },
    { key: 'expected_delivery_date', label: 'Expected delivery date', type: 'date', group: 'Schedule & terms' },
    { key: 'sales_rep', label: 'Sales representative', type: 'text', group: 'Schedule & terms' },
    { key: 'payment_terms', label: 'Payment terms', type: 'text', group: 'Schedule & terms' },
    { key: 'delivery_terms', label: 'Delivery terms', type: 'text', group: 'Schedule & terms' },
    { key: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, listColumn: true, group: 'Schedule & terms' },
    { key: 'status', label: 'Deal status', type: 'select', options: STATUSES, listColumn: true, group: 'Schedule & terms' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Schedule & terms' },
  ],
  kpis: [
    { icon: '◆', iconClass: 'kpi-icon-ink', label: 'Total deals', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Open deals', value: (r) => String(r.filter((x) => !['Completed', 'Cancelled', 'Lost'].includes(String(x.status))).length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Confirmed', value: (r) => String(r.filter((x) => x.status === 'Confirmed' || x.status === 'In Progress').length) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Deal value', value: (r) => `₹${r.reduce((sum, x) => sum + sellingValue(x), 0).toLocaleString()}` },
    { icon: '↗', iconClass: 'kpi-icon-green', label: 'Expected margin', value: (r) => `₹${r.reduce((sum, x) => sum + (sellingValue(x) - purchaseValue(x)), 0).toLocaleString()}` },
  ],
};

export function TradingDealPage() {
  return <TradingMasterPage config={config} />;
}