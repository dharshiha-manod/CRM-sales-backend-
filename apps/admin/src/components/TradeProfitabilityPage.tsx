// FILE: admin/src/components/TradeProfitabilityPage.tsx
// Rewritten. The previous version made the user retype the purchase rate,
// selling rate, quantity, freight, insurance, customs duty, port charges,
// handling, logistics cost and commission — every one of which already
// exists on a Deal, Shipment, Logistics, Customs or Commission record.
// Worse, a cost nobody had entered read as 0, which quietly overstated
// profit on exactly the deals where costs were still outstanding.
//
// Now: pick the deal and every recorded cost is pulled from its own
// module. A cost with no source record stays null and is shown as "Not
// recorded" — never zero-filled — and the breakdown panel names which ones
// are missing so the net figure is read as the upper bound it is.
//
// Values are stored at analysis time rather than recomputed on render, so
// a past period keeps the figures it was actually reported on.
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { LinkedRecords } from './LinkedRecords';
import { ProfitabilityBreakdown } from './ProfitabilityBreakdown';
import { TRADING_HASH } from '../lib/recordFocus';
import {
  buildChain, chainFinancials, loadTradingTables, money, num, percent,
} from '../lib/tradingChain';

const str = (v: unknown): string => (v == null ? '' : String(v));

const LEVELS = ['Deal', 'Order', 'Shipment', 'Product', 'Customer'];

const COST_KEYS = ['purchase_cost', 'freight', 'insurance', 'customs_duty', 'port_charges', 'other_costs', 'finance_charges', 'commission'];

/** Recomputed from the STORED figures, so the table and the saved record agree. */
function figures(r: Record<string, unknown>) {
  const revenue = num(r.revenue);
  const purchase = num(r.purchase_cost);
  const recorded = COST_KEYS.map((k) => num(r[k])).filter((n): n is number => n != null);
  const totalCost = recorded.length ? recorded.reduce((a, b) => a + b, 0) : null;
  const grossProfit = revenue != null && purchase != null ? revenue - purchase : null;
  const grossMargin = grossProfit != null && revenue ? (grossProfit / revenue) * 100 : null;
  const netProfit = revenue != null && totalCost != null ? revenue - totalCost : null;
  const netMargin = netProfit != null && revenue ? (netProfit / revenue) * 100 : null;
  const missing = COST_KEYS.filter((k) => num(r[k]) == null).length;
  return { revenue, totalCost, grossProfit, grossMargin, netProfit, netMargin, missing };
}

/** Thresholds are indicative and stay out of the stored data. */
function profitStatus(r: Record<string, unknown>): string {
  const { netMargin } = figures(r);
  if (netMargin == null) return 'Incomplete';
  if (netMargin < 0) return 'Loss';
  if (netMargin === 0) return 'Break-even';
  if (netMargin < 10) return 'Low Margin';
  if (netMargin < 20) return 'Profitable';
  return 'Highly Profitable';
}

/**
 * One deal selection pulls revenue and every recorded cost from the chain.
 * Nothing is written for a cost with no source — the field stays empty and
 * the breakdown panel reports it as not recorded.
 */
async function fillFromChain(
  anchor: { deal_number?: string; order_number?: string; shipment_number?: string },
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
) {
  if (!anchor.deal_number && !anchor.shipment_number && !anchor.order_number) return;
  try {
    const tables = await loadTradingTables();
    const chain = buildChain(tables, anchor);
    const f = chainFinancials(chain);
    const deal = chain.deal;

    setForm((prev) => {
      const next = { ...prev };
      const put = (key: string, value: unknown) => {
        if (value != null && value !== '') next[key] = String(value);
      };
      put('deal_number', deal?.deal_number);
      put('order_number', chain.order?.order_number ?? deal?.order_number);
      put('shipment_number', chain.shipments[0]?.shipment_number);
      put('customer_name', deal?.customer_name ?? chain.order?.customer_name);
      put('supplier_name', deal?.supplier_name);
      put('product_name', deal?.product_name ?? chain.order?.product_name);
      put('quantity', f.quantity);
      put('currency', f.currency);
      put('revenue', f.revenue);
      put('revenue_source', f.revenueSource);
      for (const line of f.lines) put(line.key, line.amount);
      // Recorded so the saved analysis says which costs were outstanding
      // at the time, instead of leaving a future reader to guess.
      next.cost_sources = f.lines
        .map((l) => `${l.label}: ${l.amount == null ? 'not recorded' : `${l.amount} (${l.source})`}`)
        .join('\n');
      next.analysis_date = new Date().toISOString().slice(0, 10);
      return next;
    });
  } catch {
    // Chain read failed — leave whatever the user has entered alone.
  }
}

const config: TradingModuleConfig = {
  resource: '/trading/profitability',
  eyebrowModule: 'TRADE PROFITABILITY',
  title: 'Trade profitability',
  description: 'Profitability built from the actual transaction — order value against purchase cost, freight, customs, trade charges and earned commission, each read from the module that owns it. Costs with no source record are shown as not recorded, never as zero.',
  icon: '↗',
  emptyIcon: '↗',
  codeField: 'deal_number',
  nameField: 'product_name',
  statusOptions: ['Highly Profitable', 'Profitable', 'Low Margin', 'Break-even', 'Loss', 'Incomplete'],
  hideStatusColumn: true,
  statusFilterable: false,
  searchableKeys: ['deal_number', 'order_number', 'shipment_number', 'customer_name', 'supplier_name', 'product_name', 'period'],
  fields: [
    { key: 'analysis_level', label: 'Analysis level', type: 'select', options: LEVELS, required: true, listColumn: true },

    {
      key: 'deal_number', label: 'Deal', type: 'lookup', required: true, listColumn: true,
      lookupResource: '/trading/deals', lookupLabelKey: 'deal_name',
      onValueChangeAsync: (value, form, setForm) => {
        void fillFromChain({ deal_number: value, shipment_number: form.shipment_number || undefined }, setForm);
      },
    },
    {
      key: 'shipment_number', label: 'Shipment (for shipment-level analysis)', type: 'lookup',
      lookupResource: '/trading/shipments', lookupLabelKey: 'product_name',
      visibleIf: (f) => f.analysis_level === 'Shipment',
      onValueChangeAsync: (value, _form, setForm) => { void fillFromChain({ shipment_number: value }, setForm); },
    },

    { key: 'order_number', label: 'Sales order', type: 'text', readOnly: true, group: 'Transaction' },
    { key: 'customer_name', label: 'Customer', type: 'text', readOnly: true, listColumn: true, group: 'Transaction' },
    { key: 'supplier_name', label: 'Supplier', type: 'text', readOnly: true, group: 'Transaction' },
    { key: 'product_name', label: 'Product', type: 'text', readOnly: true, listColumn: true, group: 'Transaction' },
    { key: 'quantity', label: 'Quantity', type: 'number', readOnly: true, group: 'Transaction' },
    { key: 'currency', label: 'Currency', type: 'text', readOnly: true, group: 'Transaction' },
    { key: 'period', label: 'Reporting period', type: 'text', group: 'Transaction', placeholder: 'e.g. 2026-Q3' },
    { key: 'analysis_date', label: 'Analysed on', type: 'date', readOnly: true, group: 'Transaction' },

    {
      key: 'revenue', label: 'Revenue', type: 'number', readOnly: true, listColumn: true, group: 'Revenue',
      format: (v, r) => money(num(v), str(r.currency)),
    },
    { key: 'revenue_source', label: 'Revenue taken from', type: 'text', readOnly: true, group: 'Revenue' },

    // Read-only: each of these belongs to another module. Editing them here
    // would put two different answers in the system for the same cost.
    { key: 'purchase_cost', label: 'Purchase / product cost', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: (v, r) => money(num(v), str(r.currency)) },
    { key: 'freight', label: 'Freight / logistics', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: (v, r) => money(num(v), str(r.currency)) },
    { key: 'customs_duty', label: 'Customs duty', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: (v, r) => money(num(v), str(r.currency)) },
    { key: 'port_charges', label: 'Port / clearance charges', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: (v, r) => money(num(v), str(r.currency)) },
    { key: 'other_costs', label: 'Other trade costs', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: (v, r) => money(num(v), str(r.currency)) },
    { key: 'finance_charges', label: 'Trade finance charges', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: (v, r) => money(num(v), str(r.currency)) },
    { key: 'commission', label: 'Commission (earned)', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: (v, r) => money(num(v), str(r.currency)) },

    // The one cost with no module of its own. Entered here, and clearly
    // labelled as such rather than pretending it came from somewhere.
    {
      key: 'insurance', label: 'Insurance', type: 'number', group: 'Costs (entered here)',
      placeholder: 'No insurance module exists yet — leave blank if not recorded',
    },
    { key: 'cost_sources', label: 'Cost sources at analysis time', type: 'textarea', readOnly: true, group: 'Costs (entered here)' },

    {
      key: 'gross_profit', label: 'Gross profit', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => money(figures(r).grossProfit, str(r.currency)),
    },
    {
      key: 'gross_margin_percent', label: 'Gross margin %', type: 'text', readOnly: true, group: 'Result',
      format: (_v, r) => percent(figures(r).grossMargin),
    },
    {
      key: 'total_cost', label: 'Total recorded cost', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => money(figures(r).totalCost, str(r.currency)),
    },
    {
      key: 'net_profit', label: 'Net profit', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => money(figures(r).netProfit, str(r.currency)),
    },
    {
      key: 'net_margin_percent', label: 'Net margin %', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => percent(figures(r).netMargin),
    },
    {
      key: 'profit_status', label: 'Profit status', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => profitStatus(r),
    },
    {
      key: 'completeness', label: 'Cost completeness', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => {
        const { missing } = figures(r);
        return missing === 0 ? 'Complete' : `${missing} cost${missing > 1 ? 's' : ''} not recorded`;
      },
    },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Result' },
  ],
  kpis: [
    { icon: '₹', iconClass: 'kpi-icon-ink', label: 'Revenue', value: (r) => money(r.reduce((s, x) => s + (num(x.revenue) ?? 0), 0)) },
    { icon: '₹', iconClass: 'kpi-icon-amber', label: 'Recorded cost', value: (r) => money(r.reduce((s, x) => s + (figures(x).totalCost ?? 0), 0)) },
    { icon: '↗', iconClass: 'kpi-icon-green', label: 'Net profit', value: (r) => money(r.reduce((s, x) => s + (figures(x).netProfit ?? 0), 0)) },
    {
      icon: '％', iconClass: 'kpi-icon-school', label: 'Average net margin',
      value: (r) => {
        const margins = r.map((x) => figures(x).netMargin).filter((m): m is number => m != null);
        return margins.length ? percent(margins.reduce((a, b) => a + b, 0) / margins.length) : 'Not recorded';
      },
    },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Loss-making', value: (r) => String(r.filter((x) => (figures(x).netMargin ?? 0) < 0).length) },
    {
      icon: '⚠', iconClass: 'kpi-icon-red', label: 'Incomplete costing',
      value: (r) => String(r.filter((x) => figures(x).missing > 0).length),
      sub: () => 'net profit is an upper bound',
    },
  ],
  detailExtra: (r) => (
    <>
      <ProfitabilityBreakdown record={r} />
      <LinkedRecords
        heading={`Records behind ${str(r.deal_number)}`}
        links={[
          { title: 'Deal', resource: '/trading/deals', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.deal, codeField: 'deal_number', subField: 'deal_name' },
          { title: 'Sales order', resource: '/trading/sales-orders', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.salesOrder, codeField: 'order_number', subField: 'status' },
          { title: 'Shipment', resource: '/trading/shipments', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.shipment, codeField: 'shipment_number', subField: 'status' },
          { title: 'Logistics', resource: '/trading/logistics', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.logistics, codeField: 'logistics_number', subField: 'status' },
          { title: 'Customs', resource: '/trading/customs', matchField: 'shipment_number', matchValue: str(r.shipment_number), hash: TRADING_HASH.customs, codeField: 'customs_reference', subField: 'clearance_status' },
          { title: 'Commission', resource: '/trading/commissions', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.commission, codeField: 'commission_number', subField: 'status' },
        ]}
      />
    </>
  ),
};

export function TradeProfitabilityPage() {
  return <TradingMasterPage config={config} />;
}