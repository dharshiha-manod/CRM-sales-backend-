// FILE: admin/src/components/CommissionManagementPage.tsx
// Rewritten. The previous version asked the user to type the sales rep,
// customer, product, quantity, purchase value, selling value, basis AND
// rate onto every record, then multiplied two of them on render. All of
// that already exists on the Deal, the Sales Order and the Shipment, and
// the rate belongs to a rule, not to a row.
//
// Now: pick the deal and the whole record fills from the live chain —
// order, shipment, invoice, delivery status and collection status included
// — and the amount is calculated by the matching rule in Commission Rules.
// The commission amount is STORED, not recomputed on render, so an
// approved payout keeps the terms it was earned under (same reasoning as
// the stored exchange rate in currencyLookup.ts).
//
// The Pending -> Eligible -> Approved -> Paid workflow is driven by the
// rule's qualifying event. A draft deal never produces earned commission.
import { TradingMasterPage, TradingModuleConfig, TradingRecord } from './TradingMasterPage';
import { LinkedRecords } from './LinkedRecords';
import { CommissionAutoPanel } from './CommissionAutoPanel';
import { TRADING_HASH } from '../lib/recordFocus';
import {
  buildChain, chainFinancials, chainStatus, loadTradingTables, money, num,
} from '../lib/tradingChain';
import {
  COMMISSION_BASES, COMMISSION_STATUSES, QUALIFYING_EVENTS,
  computeCommission, hasQualified, loadCommissionRules, qualifyingNote, resolveRule,
} from '../lib/commissionRules';

const str = (v: unknown): string => (v == null ? '' : String(v));

/** Set by the engine on every render so the automation panel can refresh the list. */
let reloadPage: (() => void) | undefined;

/**
 * One deal selection fills the entire record. Everything written here comes
 * from an existing record — nothing is invented, and a field with no source
 * is left blank rather than zero-filled.
 */
async function fillFromDeal(
  dealNumber: string,
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
) {
  if (!dealNumber) return;
  try {
    const [tables, rules] = await Promise.all([loadTradingTables(), loadCommissionRules()]);
    const chain = buildChain(tables, { deal_number: dealNumber });
    if (!chain.deal) return;

    const financials = chainFinancials(chain);
    const status = chainStatus(chain);
    const deal = chain.deal;

    const periodSales = tables.deals
      .filter((d) => str(d.sales_rep) === str(deal.sales_rep))
      .map((d) => chainFinancials(buildChain(tables, { deal_number: str(d.deal_number) })).revenue)
      .filter((v): v is number => v != null)
      .reduce((a, b) => a + b, 0);

    const ctx = {
      sales_rep: str(deal.sales_rep),
      customer_name: str(deal.customer_name),
      product_name: str(deal.product_name),
      product_category: str(deal.product_category),
      deal_number: dealNumber,
      salesValue: financials.revenue,
      purchaseValue: financials.purchaseCost,
      quantity: financials.quantity,
      periodSalesValue: periodSales || null,
    };
    const rule = resolveRule(rules, ctx);
    const result = computeCommission(rule, ctx);
    const qualified = hasQualified(rule, status);

    setForm((prev) => {
      const next = { ...prev };
      const put = (key: string, value: unknown) => {
        if (value != null && value !== '') next[key] = String(value);
      };
      put('order_number', chain.order?.order_number ?? deal.order_number);
      put('shipment_number', chain.shipments[0]?.shipment_number);
      put('invoice_number', status.invoiceNumber);
      put('sales_rep', deal.sales_rep);
      put('customer_name', deal.customer_name);
      put('product_name', deal.product_name);
      put('quantity', financials.quantity);
      put('purchase_value', financials.purchaseCost);
      put('selling_value', financials.revenue);
      put('currency', financials.currency);
      put('rule_code', rule?.rule_code);
      put('commission_basis', rule?.commission_basis);
      put('qualifying_event', rule?.qualifying_event);
      put('commission_rate', result.rateApplied);
      put('commission_amount', result.amount);
      next.calculation_note = `${result.workingNote} ${qualifyingNote(rule, status)}`.trim();
      next.delivery_status = status.deliveryStatus;
      next.payment_status = status.paymentStatus;
      next.calculation_date = new Date().toISOString().slice(0, 10);
      // Never mark a record earned on a transaction that hasn't qualified.
      if (!prev.status || prev.status === 'Pending' || prev.status === 'Eligible') {
        next.status = qualified ? 'Eligible' : 'Pending';
        if (qualified) next.eligible_date = new Date().toISOString().slice(0, 10);
      }
      return next;
    });
  } catch {
    // Automation is a convenience — a failed chain read leaves the form
    // usable and the user's own figures untouched.
  }
}

const EARNED = ['Eligible', 'Approved', 'Paid'];

const config: TradingModuleConfig = {
  resource: '/trading/commissions',
  eyebrowModule: 'COMMISSION MANAGEMENT',
  title: 'Commission management',
  description: 'Commission calculated from real trading transactions. Pick the deal and the sales value, costs, order, shipment, invoice and collection status come from the linked records; the amount comes from the matching rule in Commission Rules.',
  icon: '％',
  emptyIcon: '％',
  codeField: 'commission_number',
  nameField: 'sales_rep',
  statusOptions: [...COMMISSION_STATUSES],
  searchableKeys: ['commission_number', 'sales_rep', 'deal_number', 'order_number', 'customer_name', 'product_name', 'rule_code'],
  fields: [
    { key: 'commission_number', label: 'Commission number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'COM' },

    // The single point of entry.
    {
      key: 'deal_number', label: 'Deal', type: 'lookup', required: true, listColumn: true,
      lookupResource: '/trading/deals', lookupLabelKey: 'deal_name',
      onValueChangeAsync: (value, _form, setForm) => { void fillFromDeal(value, setForm); },
    },

    // Everything below is owned by another module. Read-only here so the
    // same figure can't drift between commission and the deal it came from.
    { key: 'sales_rep', label: 'Sales representative', type: 'text', readOnly: true, listColumn: true, group: 'From the transaction' },
    { key: 'customer_name', label: 'Customer', type: 'text', readOnly: true, listColumn: true, group: 'From the transaction' },
    { key: 'product_name', label: 'Product', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'quantity', label: 'Quantity', type: 'number', readOnly: true, group: 'From the transaction' },
    { key: 'order_number', label: 'Sales order', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'shipment_number', label: 'Shipment', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'invoice_number', label: 'Invoice', type: 'text', readOnly: true, group: 'From the transaction' },
    {
      key: 'selling_value', label: 'Sales value', type: 'number', readOnly: true, group: 'From the transaction',
      format: (v, r) => money(num(v), str(r.currency)),
    },
    {
      key: 'purchase_value', label: 'Purchase value', type: 'number', readOnly: true, group: 'From the transaction',
      format: (v, r) => money(num(v), str(r.currency)),
    },
    {
      key: 'gross_profit', label: 'Gross profit', type: 'text', readOnly: true, group: 'From the transaction',
      format: (_v, r) => {
        const sales = num(r.selling_value);
        const purchase = num(r.purchase_value);
        return sales == null || purchase == null ? 'Not recorded' : money(sales - purchase, str(r.currency));
      },
    },
    { key: 'currency', label: 'Currency', type: 'text', readOnly: true, group: 'From the transaction' },

    // Calculated by the rule, stored as calculated.
    { key: 'rule_code', label: 'Rule applied', type: 'text', readOnly: true, listColumn: true, group: 'Calculation' },
    { key: 'commission_basis', label: 'Basis', type: 'select', options: [...COMMISSION_BASES], readOnly: true, group: 'Calculation' },
    { key: 'commission_rate', label: 'Rate applied', type: 'number', readOnly: true, group: 'Calculation' },
    {
      key: 'commission_amount', label: 'Commission amount', type: 'number', readOnly: true, listColumn: true,
      format: (v, r) => money(num(v), str(r.currency)), group: 'Calculation',
    },
    { key: 'calculation_note', label: 'Working', type: 'textarea', readOnly: true, group: 'Calculation' },

    { key: 'qualifying_event', label: 'Earned when', type: 'select', options: [...QUALIFYING_EVENTS], readOnly: true, group: 'Eligibility' },
    { key: 'delivery_status', label: 'Delivery status', type: 'text', readOnly: true, listColumn: true, group: 'Eligibility' },
    { key: 'payment_status', label: 'Collection status', type: 'text', readOnly: true, listColumn: true, group: 'Eligibility' },
    { key: 'calculation_date', label: 'Calculated on', type: 'date', readOnly: true, group: 'Eligibility' },
    { key: 'eligible_date', label: 'Eligible from', type: 'date', readOnly: true, group: 'Eligibility' },

    // The only genuinely manual part: the approval and payout decision.
    { key: 'status', label: 'Commission status', type: 'select', options: [...COMMISSION_STATUSES], listColumn: true, group: 'Approval & payout' },
    { key: 'approved_by', label: 'Approved by', type: 'text', group: 'Approval & payout' },
    { key: 'approval_date', label: 'Approval date', type: 'date', group: 'Approval & payout' },
    { key: 'payment_date', label: 'Payment date', type: 'date', group: 'Approval & payout' },
    { key: 'payment_reference', label: 'Payment reference', type: 'text', group: 'Approval & payout' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Approval & payout' },
  ],
  kpis: [
    {
      icon: '％', iconClass: 'kpi-icon-ink', label: 'Earned commission',
      value: (r) => money(r.filter((x) => EARNED.includes(str(x.status)))
        .reduce((s, x) => s + (num(x.commission_amount) ?? 0), 0)),
      sub: () => 'eligible, approved or paid',
    },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pending qualification', value: (r) => String(r.filter((x) => str(x.status) === 'Pending').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Awaiting approval', value: (r) => String(r.filter((x) => str(x.status) === 'Eligible').length) },
    {
      icon: '₹', iconClass: 'kpi-icon-school', label: 'Approved, unpaid',
      value: (r) => money(r.filter((x) => str(x.status) === 'Approved').reduce((s, x) => s + (num(x.commission_amount) ?? 0), 0)),
    },
    {
      icon: '✓', iconClass: 'kpi-icon-green', label: 'Paid',
      value: (r) => money(r.filter((x) => str(x.status) === 'Paid').reduce((s, x) => s + (num(x.commission_amount) ?? 0), 0)),
    },
  ],
  renderInsights: (rows: TradingRecord[]) => (
    <CommissionAutoPanel commissions={rows} onChanged={() => reloadPage?.()} />
  ),
  registerReload: (reload) => { reloadPage = reload; },
  detailExtra: (r) => (
    <LinkedRecords
      heading={`Transaction behind ${str(r.commission_number)}`}
      links={[
        { title: 'Deal', resource: '/trading/deals', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.deal, codeField: 'deal_number', subField: 'deal_name' },
        { title: 'Sales order', resource: '/trading/sales-orders', matchField: 'order_number', matchValue: str(r.order_number), hash: TRADING_HASH.salesOrder, codeField: 'order_number', subField: 'status' },
        { title: 'Shipment', resource: '/trading/shipments', matchField: 'shipment_number', matchValue: str(r.shipment_number), hash: TRADING_HASH.shipment, codeField: 'shipment_number', subField: 'status' },
        { title: 'Invoice / documents', resource: '/trading/documents', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.tradeDocuments, codeField: 'document_number', subField: 'document_type' },
        { title: 'Trade finance', resource: '/trading/trade-finance', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.tradeFinance, codeField: 'finance_reference', subField: 'payment_status' },
      ]}
    />
  ),
};

export function CommissionManagementPage() {
  return <TradingMasterPage config={config} />;
}