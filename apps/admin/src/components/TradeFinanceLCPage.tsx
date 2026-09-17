// FILE: admin/src/components/TradeFinanceLCPage.tsx
// Rewritten. The previous version was an LC register: it only knew about
// Letters of Credit, it made the user retype customer, supplier, currency
// and amount that the Deal already holds, and it had no connection at all
// to whether the money had actually come in.
//
// Now it covers the trade-finance arrangement behind a transaction —
// payment terms, credit terms, advance payment, LC, documentary collection
// or open account — anchored to the Deal, with the value, parties and
// shipment dates read from the chain, and payment status read from the
// EXISTING Collections/payment records. No second collections system is
// created here; this module records the arrangement and reports against
// what Collections already knows.
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { LinkedRecords } from './LinkedRecords';
import { TRADING_HASH } from '../lib/recordFocus';
import {
  buildChain, chainFinancials, chainStatus, loadTradingTables, money, num,
} from '../lib/tradingChain';

const str = (v: unknown): string => (v == null ? '' : String(v));

const INSTRUMENTS = [
  'Open Account', 'Advance Payment', 'Letter of Credit', 'Documentary Collection',
  'Bank Guarantee', 'Credit Terms', 'Other',
];
/** Instruments where the bank/LC block is relevant. */
const BANKED = ['Letter of Credit', 'Documentary Collection', 'Bank Guarantee'];

const STATUSES = [
  'Draft', 'Requested', 'Application Submitted', 'Issued', 'Advised', 'Accepted',
  'Documents Submitted', 'Under Review', 'Discrepancy', 'Payment Pending', 'Paid',
  'Expired', 'Cancelled', 'Closed',
];
const CLOSED_STATUSES = ['Paid', 'Expired', 'Cancelled', 'Closed'];

function expiryAlert(r: Record<string, unknown>): string {
  const expiry = str(r.expiry_date) || str(r.due_date);
  if (!expiry) return 'Not recorded';
  if (CLOSED_STATUSES.includes(str(r.status))) return str(r.status);
  const days = Math.floor((new Date(expiry).getTime() - Date.now()) / 86400000);
  if (days < 0) return 'Overdue / expired';
  if (days <= 7) return `Critical (${days}d)`;
  if (days <= 15) return `Important (${days}d)`;
  if (days <= 30) return `Warning (${days}d)`;
  return 'OK';
}

function outstanding(r: Record<string, unknown>): number | null {
  const amount = num(r.financing_amount) ?? num(r.transaction_value);
  const collected = num(r.collected_amount);
  if (amount == null) return null;
  return amount - (collected ?? 0);
}

/**
 * One deal selection fills the transaction side: order, shipment, invoice,
 * value, currency, parties, payment terms and the live collection position.
 */
async function fillFromDeal(
  dealNumber: string,
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
) {
  if (!dealNumber) return;
  try {
    const tables = await loadTradingTables();
    const chain = buildChain(tables, { deal_number: dealNumber });
    if (!chain.deal) return;
    const f = chainFinancials(chain);
    const status = chainStatus(chain);
    const deal = chain.deal;
    const shipment = chain.shipments[0];

    setForm((prev) => {
      const next = { ...prev };
      const put = (key: string, value: unknown) => {
        if (value != null && value !== '') next[key] = String(value);
      };
      put('order_number', chain.order?.order_number ?? deal.order_number);
      put('shipment_number', shipment?.shipment_number);
      put('invoice_number', status.invoiceNumber);
      put('customer_name', deal.customer_name);
      put('supplier_name', deal.supplier_name);
      put('currency', f.currency);
      put('transaction_value', f.revenue);
      put('payment_terms', deal.payment_terms ?? chain.order?.payment_terms);
      put('latest_shipment_date', shipment?.shipment_date ?? deal.expected_delivery_date);
      put('collected_amount', status.collectedAmount);
      next.payment_status = status.paymentStatus;
      // The financing amount defaults to the transaction value; it can be
      // overridden where the facility covers only part of the trade.
      if (!prev.financing_amount && f.revenue != null) next.financing_amount = String(f.revenue);
      // Applicant/beneficiary follow the direction of trade rather than
      // being asked for again.
      if (!prev.applicant) put('applicant', deal.customer_name);
      if (!prev.beneficiary) put('beneficiary', deal.supplier_name);
      return next;
    });
  } catch {
    // Automation is a convenience — the form stays usable.
  }
}

const config: TradingModuleConfig = {
  resource: '/trading/trade-finance',
  eyebrowModule: 'TRADE FINANCE',
  title: 'Trade finance',
  description: 'The payment and financing arrangement behind a trade — terms, advance, LC, documentary collection or credit — anchored to the Deal. Value, parties, shipment dates and collection status come from the linked records and the existing Collections data; this module does not hold a second set of payments.',
  icon: '₹',
  emptyIcon: '₹',
  codeField: 'finance_reference',
  nameField: 'instrument_type',
  statusOptions: STATUSES,
  searchableKeys: ['finance_reference', 'lc_number', 'deal_number', 'order_number', 'customer_name', 'supplier_name', 'issuing_bank', 'bank_reference'],
  fields: [
    { key: 'finance_reference', label: 'Finance reference', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'TF' },
    { key: 'instrument_type', label: 'Instrument', type: 'select', options: INSTRUMENTS, required: true, listColumn: true },

    {
      key: 'deal_number', label: 'Deal', type: 'lookup', required: true, listColumn: true,
      lookupResource: '/trading/deals', lookupLabelKey: 'deal_name',
      onValueChangeAsync: (value, _form, setForm) => { void fillFromDeal(value, setForm); },
    },

    { key: 'order_number', label: 'Sales order', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'shipment_number', label: 'Shipment', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'invoice_number', label: 'Invoice', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'customer_name', label: 'Customer', type: 'text', readOnly: true, listColumn: true, group: 'From the transaction' },
    { key: 'supplier_name', label: 'Supplier', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'currency', label: 'Currency', type: 'text', readOnly: true, group: 'From the transaction' },
    {
      key: 'transaction_value', label: 'Transaction value', type: 'number', readOnly: true, group: 'From the transaction',
      format: (v, r) => money(num(v), str(r.currency)),
    },

    { key: 'payment_terms', label: 'Payment terms', type: 'text', group: 'Terms', placeholder: 'e.g. 30 days from B/L date' },
    { key: 'credit_days', label: 'Credit days', type: 'number', group: 'Terms' },
    { key: 'advance_percent', label: 'Advance %', type: 'number', group: 'Terms', visibleIf: (f) => f.instrument_type === 'Advance Payment' || f.instrument_type === 'Open Account' },
    { key: 'advance_amount', label: 'Advance amount', type: 'number', group: 'Terms', visibleIf: (f) => f.instrument_type === 'Advance Payment' || f.instrument_type === 'Open Account' },
    {
      key: 'financing_amount', label: 'Financing amount', type: 'number', listColumn: true, group: 'Terms',
      format: (v, r) => money(num(v), str(r.currency)),
    },
    { key: 'finance_charges', label: 'Bank / finance charges', type: 'number', group: 'Terms', placeholder: 'Flows into Trade Profitability as a trade cost' },

    // Bank block — only for instruments that actually involve a bank.
    { key: 'lc_number', label: 'LC / guarantee number', type: 'text', listColumn: true, group: 'Bank & instrument', visibleIf: (f) => BANKED.includes(f.instrument_type ?? '') },
    { key: 'issuing_bank', label: 'Issuing bank', type: 'text', group: 'Bank & instrument', visibleIf: (f) => BANKED.includes(f.instrument_type ?? '') },
    { key: 'advising_bank', label: 'Advising bank', type: 'text', group: 'Bank & instrument', visibleIf: (f) => BANKED.includes(f.instrument_type ?? '') },
    { key: 'confirming_bank', label: 'Confirming bank', type: 'text', group: 'Bank & instrument', visibleIf: (f) => BANKED.includes(f.instrument_type ?? '') },
    { key: 'applicant', label: 'Applicant', type: 'text', group: 'Bank & instrument', visibleIf: (f) => BANKED.includes(f.instrument_type ?? '') },
    { key: 'beneficiary', label: 'Beneficiary', type: 'text', group: 'Bank & instrument', visibleIf: (f) => BANKED.includes(f.instrument_type ?? '') },
    { key: 'tolerance_percent', label: 'Tolerance %', type: 'number', group: 'Bank & instrument', visibleIf: (f) => BANKED.includes(f.instrument_type ?? '') },
    { key: 'presentation_period', label: 'Presentation period', type: 'text', group: 'Bank & instrument', visibleIf: (f) => BANKED.includes(f.instrument_type ?? '') },
    { key: 'port_place', label: 'Port / place', type: 'text', group: 'Bank & instrument', visibleIf: (f) => BANKED.includes(f.instrument_type ?? '') },
    {
      key: 'document_requirements', label: 'Documents required', type: 'multi-lookup', group: 'Bank & instrument',
      lookupResource: '/trading/documents', lookupValueKey: 'document_number', lookupLabelKey: 'document_type',
      visibleIf: (f) => BANKED.includes(f.instrument_type ?? ''),
    },
    { key: 'bank_reference', label: 'Bank / payment reference', type: 'text', group: 'Bank & instrument' },

    { key: 'issue_date', label: 'Issue date', type: 'date', group: 'Timeline' },
    { key: 'latest_shipment_date', label: 'Latest shipment date', type: 'date', readOnly: true, group: 'Timeline' },
    { key: 'due_date', label: 'Payment due date', type: 'date', listColumn: true, group: 'Timeline' },
    { key: 'expiry_date', label: 'Instrument expiry date', type: 'date', group: 'Timeline', visibleIf: (f) => BANKED.includes(f.instrument_type ?? '') },
    {
      key: 'expiry_alert', label: 'Due / expiry alert', type: 'text', readOnly: true, listColumn: true, group: 'Timeline',
      format: (_v, r) => expiryAlert(r),
    },

    { key: 'payment_status', label: 'Collection status', type: 'text', readOnly: true, listColumn: true, group: 'Settlement' },
    {
      key: 'collected_amount', label: 'Collected to date', type: 'number', readOnly: true, group: 'Settlement',
      format: (v, r) => money(num(v), str(r.currency)),
    },
    {
      key: 'outstanding', label: 'Outstanding', type: 'text', readOnly: true, listColumn: true, group: 'Settlement',
      format: (_v, r) => money(outstanding(r), str(r.currency)),
    },
    { key: 'status', label: 'Financing status', type: 'select', options: STATUSES, listColumn: true, group: 'Settlement' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Settlement' },
  ],
  kpis: [
    { icon: '₹', iconClass: 'kpi-icon-ink', label: 'Live arrangements', value: (r) => String(r.filter((x) => !CLOSED_STATUSES.includes(str(x.status))).length) },
    {
      icon: '₹', iconClass: 'kpi-icon-school', label: 'Exposure',
      value: (r) => money(r.filter((x) => !CLOSED_STATUSES.includes(str(x.status))).reduce((s, x) => s + (outstanding(x) ?? 0), 0)),
      sub: () => 'outstanding on open arrangements',
    },
    {
      icon: '⚠', iconClass: 'kpi-icon-amber', label: 'Due within 30 days',
      value: (r) => String(r.filter((x) => expiryAlert(x).startsWith('Critical') || expiryAlert(x).startsWith('Important') || expiryAlert(x).startsWith('Warning')).length),
    },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Overdue / expired', value: (r) => String(r.filter((x) => expiryAlert(x) === 'Overdue / expired').length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Awaiting collection', value: (r) => String(r.filter((x) => str(x.payment_status) !== 'Paid' && !CLOSED_STATUSES.includes(str(x.status))).length) },
    { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Discrepancies', value: (r) => String(r.filter((x) => str(x.status) === 'Discrepancy').length) },
  ],
  detailExtra: (r) => (
    <LinkedRecords
      heading={`Transaction behind ${str(r.finance_reference)}`}
      links={[
        { title: 'Deal', resource: '/trading/deals', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.deal, codeField: 'deal_number', subField: 'deal_name' },
        { title: 'Sales order', resource: '/trading/sales-orders', matchField: 'order_number', matchValue: str(r.order_number), hash: TRADING_HASH.salesOrder, codeField: 'order_number', subField: 'status' },
        { title: 'Shipment', resource: '/trading/shipments', matchField: 'shipment_number', matchValue: str(r.shipment_number), hash: TRADING_HASH.shipment, codeField: 'shipment_number', subField: 'status' },
        { title: 'Trade documents', resource: '/trading/documents', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.tradeDocuments, codeField: 'document_number', subField: 'document_type' },
        { title: 'Compliance', resource: '/trading/compliance', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.tradeCompliance, codeField: 'compliance_reference', subField: 'status' },
      ]}
    />
  ),
};

export function TradeFinanceLCPage() {
  return <TradingMasterPage config={config} />;
}