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
import { RecalculateProfitButton } from './RecalculateProfitButton';
import { TRADING_HASH } from '../lib/recordFocus';
import {
  buildChain, chainFinancials, COST_KEY_BY_LABEL, formatCostSources, loadTradingTables, money, num, percent,
} from '../lib/tradingChain';

const str = (v: unknown): string => (v == null ? '' : String(v));

// Stage of the profit record, kept as a tag at the start of `notes` by the API.
// Untagged rows (older or hand-made) are Final and never auto-updated.
const STAGES = ['Estimated', 'Provisional', 'Final'] as const;
const STAGE_COLOURS: Record<string, { bg: string; fg: string }> = {
  Estimated: { bg: '#fef3c7', fg: '#92400e' },
  Provisional: { bg: '#dbeafe', fg: '#1e40af' },
  Final: { bg: '#dcfce7', fg: '#166534' },
};
const stageOf = (r: Record<string, unknown>): string => /^\[(Estimated|Provisional|Final)\]/.exec(str(r.notes))?.[1] ?? 'Final';

// Pill + three-step tracker: one filled dot per stage reached.
function StageTracker({ stage }: { stage: string }) {
  const reached = STAGES.indexOf(stage as (typeof STAGES)[number]) + 1;
  const c = STAGE_COLOURS[stage] ?? STAGE_COLOURS.Final;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <span style={{ background: c.bg, color: c.fg, fontWeight: 700, fontSize: '.72rem', padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>{stage}</span>
      <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {STAGES.map((st, i) => (
          <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: i < reached ? c.fg : '#e2e8f0' }} />
            {i < STAGES.length - 1 && <span style={{ width: 10, height: 2, background: i < reached - 1 ? c.fg : '#e2e8f0' }} />}
          </span>
        ))}
      </span>
    </span>
  );
}

const RESULT_COLOURS: Record<string, { bg: string; fg: string }> = {
  'Highly Profitable': { bg: '#dcfce7', fg: '#166534' },
  'Profitable': { bg: '#ecfccb', fg: '#3f6212' },
  'Low Margin': { bg: '#fef3c7', fg: '#92400e' },
  'Break-even': { bg: '#f1f5f9', fg: '#475569' },
  'Loss': { bg: '#fee2e2', fg: '#991b1b' },
  'Incomplete': { bg: '#f1f5f9', fg: '#64748b' },
};

// Handed this page's own reload() so the list and the open record refresh after a recalculation.
let reloadPage: (() => void) | undefined;

const LEVELS = ['Deal', 'Order', 'Shipment', 'Product', 'Customer'];

const COST_KEYS = ['purchase_cost', 'freight', 'insurance', 'customs_duty', 'port_charges', 'other_costs', 'finance_charges', 'commission'];
/** Never counted as missing: insurance has no module of its own, and "other trade costs" are extra charges. */
const OPTIONAL_KEYS = ['insurance', 'other_costs'];

/** Costs the saved "Cost sources" text marked "not applicable" (e.g. customs on a domestic deal). */
function notApplicableKeys(r: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const line of str(r.cost_sources).split('\n')) {
    const label = /^(.+?): not applicable/.exec(line.trim())?.[1];
    if (label && COST_KEY_BY_LABEL[label]) out.add(COST_KEY_BY_LABEL[label]);
  }
  return out;
}

/** A cost's value for display: the amount, or "Not applicable" when the saved analysis found it can never exist for this deal. */
const costShown = (key: string) => (v: unknown, r: Record<string, unknown>): string => (
  num(v) == null && notApplicableKeys(r).has(key) ? 'Not applicable' : money(num(v), str(r.currency))
);

/** The stage tag ("[Final] ...") is kept in the notes for the system; people only read the sentence after it. */
const cleanNotes = (v: unknown): string => str(v).replace(/^\[(Estimated|Provisional|Final)\]\s*/, '');

/** Deals can be in different currencies (INR, USD...). Adding them into one card would be meaningless, so the cards
 *  add up the most common currency only and say how many records were left out. */
const currencyOf = (r: Record<string, unknown>): string => str(r.currency) || 'INR';
function mainCurrency(rows: Record<string, unknown>[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(currencyOf(r), (counts.get(currencyOf(r)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'INR';
}
const inMainCurrency = (rows: Record<string, unknown>[]) => rows.filter((r) => currencyOf(r) === mainCurrency(rows));
const otherCurrencyNote = (rows: Record<string, unknown>[]): string => {
  const left = rows.length - inMainCurrency(rows).length;
  return left > 0 ? `${mainCurrency(rows)} only · ${left} in other currencies not added` : `all in ${mainCurrency(rows)}`;
};

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
  const na = notApplicableKeys(r);
  const missing = COST_KEYS.filter((k) => num(r[k]) == null && !na.has(k) && !OPTIONAL_KEYS.includes(k)).length;
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
      next.cost_sources = formatCostSources(f.lines);
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
  detailVisibilityFromRecord: true,
  fitToScreen: true,
  statusFilterable: false,
  searchableKeys: ['deal_number', 'order_number', 'shipment_number', 'customer_name', 'supplier_name', 'product_name', 'period'],
  fields: [
    { key: 'analysis_level', label: 'Analysis level', type: 'select', options: LEVELS, required: true },

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
    {
      key: 'customer_name', label: 'Customer / product', type: 'text', readOnly: true, listColumn: true, group: 'Transaction',
      render: (_v, r) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <strong style={{ fontWeight: 600 }}>{str(r.customer_name) || '—'}</strong>
          <span style={{ color: '#64748b', fontSize: '.74rem' }}>{str(r.product_name) || '—'}</span>
        </span>
      ),
    },
    { key: 'supplier_name', label: 'Supplier', type: 'text', readOnly: true, group: 'Transaction' },
    { key: 'product_name', label: 'Product', type: 'text', readOnly: true, group: 'Transaction' },
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
    { key: 'purchase_cost', label: 'Purchase / product cost', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: costShown('purchase_cost') },
    { key: 'freight', label: 'Freight / logistics', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: costShown('freight') },
    { key: 'customs_duty', label: 'Customs duty', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: costShown('customs_duty') },
    { key: 'port_charges', label: 'Port / clearance charges', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: costShown('port_charges') },
    { key: 'other_costs', label: 'Other trade costs', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: costShown('other_costs') },
    { key: 'finance_charges', label: 'Trade finance charges', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: costShown('finance_charges') },
    { key: 'commission', label: 'Commission (earned)', type: 'number', readOnly: true, group: 'Costs (from linked records)', format: costShown('commission') },

    // The one cost with no module of its own. Entered here, and clearly
    // labelled as such rather than pretending it came from somewhere.
    {
      key: 'insurance', label: 'Insurance', type: 'number', group: 'Costs (entered here)',
      placeholder: 'No insurance module exists yet — leave blank if not recorded',
    },
    // Still stored (audit trail) and still sent on save, but not drawn: the Cost breakdown panel shows the same facts line by line.
    { key: 'cost_sources', label: 'Cost sources at analysis time', type: 'textarea', readOnly: true, group: 'Costs (entered here)', visibleIf: () => false },

    {
      key: 'gross_profit', label: 'Gross profit', type: 'text', readOnly: true, group: 'Result',
      format: (_v, r) => money(figures(r).grossProfit, str(r.currency)),
    },
    {
      key: 'gross_margin_percent', label: 'Gross margin %', type: 'text', readOnly: true, group: 'Result',
      format: (_v, r) => percent(figures(r).grossMargin),
    },
    {
      key: 'total_cost', label: 'Recorded cost', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => money(figures(r).totalCost, str(r.currency)),
    },
    {
      key: 'net_profit', label: 'Net profit', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => money(figures(r).netProfit, str(r.currency)),
    },
    {
      key: 'net_margin_percent', label: 'Margin', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => percent(figures(r).netMargin),
    },
    {
      key: 'profit_stage', label: 'Stage', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => stageOf(r),
      render: (_v, r) => <StageTracker stage={stageOf(r)} />,
    },
    {
      key: 'profit_status', label: 'Result', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => profitStatus(r),
      render: (_v, r) => {
        const label = profitStatus(r);
        const c = RESULT_COLOURS[label] ?? RESULT_COLOURS.Incomplete;
        return <span style={{ background: c.bg, color: c.fg, fontWeight: 700, fontSize: '.74rem', padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>{label}</span>;
      },
    },
    {
      key: 'completeness', label: 'Costs', type: 'text', readOnly: true, listColumn: true, group: 'Result',
      format: (_v, r) => {
        const { missing } = figures(r);
        return missing === 0 ? 'Complete' : `${missing} missing`;
      },
    },
    // `format` only changes how the detail view reads; the edit form still holds the raw text so the stage tag is kept.
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Result', format: (v) => cleanNotes(v) },
  ],
  kpis: [
    { icon: '₹', iconClass: 'kpi-icon-ink', label: 'Revenue', value: (r) => money(inMainCurrency(r).reduce((s, x) => s + (num(x.revenue) ?? 0), 0), mainCurrency(r)), sub: otherCurrencyNote },
    { icon: '₹', iconClass: 'kpi-icon-amber', label: 'Recorded cost', value: (r) => money(inMainCurrency(r).reduce((s, x) => s + (figures(x).totalCost ?? 0), 0), mainCurrency(r)), sub: otherCurrencyNote },
    { icon: '↗', iconClass: 'kpi-icon-green', label: 'Net profit', value: (r) => money(inMainCurrency(r).reduce((s, x) => s + (figures(x).netProfit ?? 0), 0), mainCurrency(r)), sub: otherCurrencyNote },
    {
      // Total profit / total revenue, so one small bad deal cannot swamp the figure the way a plain average of percentages does.
      icon: '％', iconClass: 'kpi-icon-school', label: 'Overall net margin',
      value: (r) => {
        const rows = inMainCurrency(r).map(figures).filter((x) => x.revenue != null && x.revenue > 0 && x.netProfit != null);
        const revenue = rows.reduce((s, x) => s + (x.revenue ?? 0), 0);
        const net = rows.reduce((s, x) => s + (x.netProfit ?? 0), 0);
        return revenue > 0 ? percent((net / revenue) * 100) : 'Not recorded';
      },
      sub: () => 'total profit ÷ total revenue',
    },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Loss-making', value: (r) => String(r.filter((x) => (figures(x).netMargin ?? 0) < 0).length) },
    {
      icon: '⚠', iconClass: 'kpi-icon-red', label: 'Incomplete costing',
      value: (r) => String(r.filter((x) => figures(x).missing > 0).length),
      sub: () => 'net profit is an upper bound',
    },
  ],
  registerReload: (reload) => { reloadPage = reload; },
  detailActions: (r) => <RecalculateProfitButton record={r} onDone={() => reloadPage?.()} />,
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