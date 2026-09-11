import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

function calc(r: Record<string, unknown>) {
  const qty = Number(r.quantity) || 0;
  const purchaseValue = qty * (Number(r.purchase_rate) || 0);
  const salesValue = qty * (Number(r.selling_rate) || 0);
  const totalCost = purchaseValue
    + (Number(r.freight) || 0) + (Number(r.insurance) || 0) + (Number(r.customs_duty) || 0)
    + (Number(r.port_charges) || 0) + (Number(r.handling_charges) || 0) + (Number(r.logistics_cost) || 0)
    + (Number(r.commission) || 0) + (Number(r.other_costs) || 0);
  const grossProfit = salesValue - totalCost;
  const marginPercent = salesValue ? (grossProfit / salesValue) * 100 : 0;
  return { purchaseValue, salesValue, totalCost, grossProfit, marginPercent };
}

// Illustrative thresholds — spec says don't hardcode a minimum margin, so
// treat these as defaults to make thresholds admin-configurable rather than
// literal, and swap in a real settings value once one exists on the backend.
function profitStatus(marginPercent: number): string {
  if (marginPercent < 0) return 'Loss';
  if (marginPercent === 0) return 'Break-even';
  if (marginPercent < 10) return 'Low Margin';
  if (marginPercent < 20) return 'Profitable';
  return 'Highly Profitable';
}

const config: TradingModuleConfig = {
  resource: '/trading/profitability',
  eyebrowModule: 'TRADE PROFITABILITY',
  title: 'Trade profitability',
  description: 'Full landed-cost profitability per deal — purchase value plus freight, insurance, customs, logistics and commission, against sales value.',
  icon: '↗',
  emptyIcon: '↗',
  codeField: 'deal_number',
  nameField: 'product_name',
  statusOptions: ['Highly Profitable', 'Profitable', 'Low Margin', 'Break-even', 'Loss'],
  searchableKeys: ['deal_number', 'customer_name', 'supplier_name', 'product_name', 'period'],
  fields: [
{ key: 'deal_number', label: 'Deal', type: 'lookup', lookupResource: '/trading/deals', lookupLabelKey: 'deal_name', autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name', quantity: 'quantity', purchase_rate: 'purchase_rate', selling_rate: 'selling_rate', currency: 'currency' }, required: true, listColumn: true },
    { key: 'customer_name', label: 'Customer', type: 'text', listColumn: true, group: 'Deal' },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Deal' },
    { key: 'product_name', label: 'Product', type: 'text', listColumn: true, group: 'Deal' },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Deal' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Deal' },
    { key: 'exchange_rate', label: 'Exchange rate', type: 'number', group: 'Deal' },
    { key: 'period', label: 'Period', type: 'text', listColumn: true, group: 'Deal', placeholder: 'e.g. 2026-Q3, Sep 2026' },
    { key: 'purchase_rate', label: 'Purchase rate', type: 'number', group: 'Revenue & direct cost' },
    { key: 'selling_rate', label: 'Selling rate', type: 'number', group: 'Revenue & direct cost' },
    { key: 'freight', label: 'Freight', type: 'number', group: 'Landed cost' },
    { key: 'insurance', label: 'Insurance', type: 'number', group: 'Landed cost' },
    { key: 'customs_duty', label: 'Customs duty', type: 'number', group: 'Landed cost' },
    { key: 'port_charges', label: 'Port charges', type: 'number', group: 'Landed cost' },
    { key: 'handling_charges', label: 'Handling charges', type: 'number', group: 'Landed cost' },
    { key: 'logistics_cost', label: 'Logistics cost', type: 'number', group: 'Landed cost' },
    { key: 'commission', label: 'Commission', type: 'number', group: 'Landed cost' },
    { key: 'other_costs', label: 'Other costs', type: 'number', group: 'Landed cost' },
    { key: 'purchase_value', label: 'Purchase value', type: 'text', readOnly: true, format: (_v, r) => `₹${calc(r).purchaseValue.toLocaleString()}`, group: 'Result' },
    { key: 'sales_value', label: 'Sales value', type: 'text', readOnly: true, listColumn: true, format: (_v, r) => `₹${calc(r).salesValue.toLocaleString()}`, group: 'Result' },
    { key: 'total_cost', label: 'Total cost', type: 'text', readOnly: true, listColumn: true, format: (_v, r) => `₹${calc(r).totalCost.toLocaleString()}`, group: 'Result' },
    { key: 'gross_profit', label: 'Gross profit', type: 'text', readOnly: true, listColumn: true, format: (_v, r) => `₹${calc(r).grossProfit.toLocaleString()}`, group: 'Result' },
    { key: 'margin_percent', label: 'Margin %', type: 'text', readOnly: true, listColumn: true, format: (_v, r) => `${calc(r).marginPercent.toFixed(2)}%`, group: 'Result' },
    { key: 'profit_status', label: 'Profit status', type: 'text', readOnly: true, listColumn: true, format: (_v, r) => profitStatus(calc(r).marginPercent), group: 'Result' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Result' },
  ],
  kpis: [
    { icon: '₹', iconClass: 'kpi-icon-ink', label: 'Total revenue', value: (r) => `₹${r.reduce((sum, x) => sum + calc(x).salesValue, 0).toLocaleString()}` },
    { icon: '₹', iconClass: 'kpi-icon-amber', label: 'Total cost', value: (r) => `₹${r.reduce((sum, x) => sum + calc(x).totalCost, 0).toLocaleString()}` },
    { icon: '↗', iconClass: 'kpi-icon-green', label: 'Gross profit', value: (r) => `₹${r.reduce((sum, x) => sum + calc(x).grossProfit, 0).toLocaleString()}` },
    { icon: '％', iconClass: 'kpi-icon-school', label: 'Average margin %', value: (r) => { if (!r.length) return '0%'; const avg = r.reduce((sum, x) => sum + calc(x).marginPercent, 0) / r.length; return `${avg.toFixed(2)}%`; } },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Loss-making deals', value: (r) => String(r.filter((x) => calc(x).marginPercent < 0).length) },
  ],
 
};

export function TradeProfitabilityPage() {
  return <TradingMasterPage config={config} />;
}