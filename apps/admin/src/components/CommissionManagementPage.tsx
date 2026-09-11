import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const COMMISSION_BASES = ['% of Sales Value', '% of Gross Profit', 'Fixed Amount per Unit', 'Fixed Amount per Deal', 'Tiered Commission', 'Target-based Commission'];
const STATUSES = ['Draft', 'Calculated', 'Pending Approval', 'Approved', 'Rejected', 'Payable', 'Paid', 'Cancelled'];

function commissionAmount(r: Record<string, unknown>): number {
  const sellingValue = Number(r.selling_value) || 0;
  const purchaseValue = Number(r.purchase_value) || 0;
  const grossProfit = sellingValue - purchaseValue;
  const rate = Number(r.commission_rate) || 0;
  const quantity = Number(r.quantity) || 0;
  switch (r.commission_basis) {
    case '% of Sales Value': return sellingValue * (rate / 100);
    case '% of Gross Profit': return grossProfit * (rate / 100);
    case 'Fixed Amount per Unit': return rate * quantity;
    case 'Fixed Amount per Deal': return rate;
    default: return 0; // Tiered / Target-based need a rules table — see note below
  }
}

const config: TradingModuleConfig = {
  resource: '/trading/commissions',
  eyebrowModule: 'COMMISSION MANAGEMENT',
  title: 'Commission management',
  description: 'Sales commission per completed deal — commission amount is calculated from the basis and rate you enter on each record.',
  icon: '％',
  emptyIcon: '％',
  codeField: 'commission_number',
  nameField: 'sales_rep',
  statusOptions: STATUSES,
  searchableKeys: ['commission_number', 'sales_rep', 'deal_number', 'customer_name', 'product_name'],
  fields: [
    { key: 'commission_number', label: 'Commission number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'COM' },
    { key: 'sales_rep', label: 'Sales rep / employee', type: 'text', required: true, listColumn: true },
{ key: 'deal_number', label: 'Deal', type: 'lookup', lookupResource: '/trading/deals', lookupLabelKey: 'deal_name', autoFillMap: { customer_name: 'customer_name', product_name: 'product_name', quantity: 'quantity' }, listColumn: true, group: 'Deal basis' },
    { key: 'customer_name', label: 'Customer', type: 'text', group: 'Deal basis' },
    { key: 'product_name', label: 'Product', type: 'text', group: 'Deal basis' },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Deal basis', placeholder: 'used for per-unit basis' },
    { key: 'purchase_value', label: 'Purchase value', type: 'number', group: 'Deal basis' },
    { key: 'selling_value', label: 'Selling value', type: 'number', group: 'Deal basis' },
    {
      key: 'gross_profit',
      label: 'Gross profit',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => `₹${((Number(r.selling_value) || 0) - (Number(r.purchase_value) || 0)).toLocaleString()}`,
      group: 'Deal basis',
    },
    { key: 'commission_basis', label: 'Commission basis', type: 'select', options: COMMISSION_BASES, listColumn: true, group: 'Commission' },
    { key: 'commission_rate', label: 'Rate (% or fixed amount)', type: 'number', group: 'Commission' },
    {
      key: 'commission_amount',
      label: 'Commission amount',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => `₹${commissionAmount(r).toLocaleString()}`,
      group: 'Commission',
    },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Commission' },
    { key: 'eligible_date', label: 'Eligible date', type: 'date', group: 'Timeline' },
    { key: 'calculation_date', label: 'Calculation date', type: 'date', group: 'Timeline' },
    { key: 'approval_date', label: 'Approval date', type: 'date', group: 'Timeline' },
    { key: 'payment_date', label: 'Payment date', type: 'date', group: 'Timeline' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Timeline' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Timeline' },
  ],
  kpis: [
    { icon: '％', iconClass: 'kpi-icon-ink', label: 'Total commission', value: (r) => `₹${r.reduce((sum, x) => sum + commissionAmount(x), 0).toLocaleString()}` },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pending approval', value: (r) => String(r.filter((x) => x.status === 'Pending Approval').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Approved', value: (r) => String(r.filter((x) => x.status === 'Approved' || x.status === 'Payable').length) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Paid', value: (r) => `₹${r.filter((x) => x.status === 'Paid').reduce((sum, x) => sum + commissionAmount(x), 0).toLocaleString()}` },
  ],
  sampleRecords: [
    { id: 'demo-commission-1', commission_number: 'COM-0001', sales_rep: 'Priya Ramesh', deal_number: 'DEAL-0001', customer_name: 'Al Habib Foods', product_name: 'Basmati Rice', quantity: 500, purchase_value: 310000, selling_value: 350000, commission_basis: '% of Gross Profit', commission_rate: 5, currency: 'USD', eligible_date: '2026-08-25', calculation_date: '2026-08-26', approval_date: '2026-08-27', status: 'Approved' },
    { id: 'demo-commission-2', commission_number: 'COM-0002', sales_rep: 'Arjun Nair', deal_number: 'DEAL-0002', customer_name: 'Coastal Garments', product_name: 'Cotton Yarn', quantity: 200, purchase_value: 3700000, selling_value: 4200000, commission_basis: '% of Sales Value', commission_rate: 2, currency: 'INR', eligible_date: '2026-09-05', calculation_date: '2026-09-06', approval_date: '2026-09-07', payment_date: '2026-09-08', status: 'Paid' },
  ],
};

export function CommissionManagementPage() {
  return <TradingMasterPage config={config} />;
}