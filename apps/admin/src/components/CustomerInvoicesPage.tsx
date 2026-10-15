// FILE: admin/src/components/CustomerInvoicesPage.tsx
// The bill we raise to the customer for a shipment. Picking the shipment adds up the sell amounts of its open
// Shipment Charges into the subtotal (charges in the first charge's currency). Tax, total, balance and status are
// recalculated by the API on every save, so what is stored always adds up.
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { LinkedRecords } from './LinkedRecords';
import { TRADING_HASH } from '../lib/recordFocus';
import { api } from '../lib/api';
import { sumMoneyWithBase } from '../lib/currencyFormat';
import { useEffect, useState } from 'react';
import { SendCustomerInvoiceButton, SendCustomerInvoiceMenuItem, SEND_CUSTOMER_INVOICE_EVENT } from './SendCustomerInvoiceButton';

const STATUSES = ['Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'];
const num = (v: unknown): number => Number(v) || 0;
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const tax = (r: Record<string, unknown>) => round2(num(r.subtotal) * num(r.tax_percent) / 100);
const total = (r: Record<string, unknown>) => round2(num(r.subtotal) + tax(r));
const balance = (r: Record<string, unknown>) => round2(total(r) - num(r.paid_amount));
const money = (r: Record<string, unknown>, v: number) => `${r.currency ? `${String(r.currency)} ` : ''}${v.toLocaleString()}`;

type Row = Record<string, unknown>;

// Days after the invoice date that payment is due, read from the Deal's free-text payment terms (same rule as the API).
const daysFromTerms = (terms: unknown): number | null => {
  const t = String(terms ?? '').trim().toLowerCase();
  if (!t) return null;
  const m = t.match(/(\d{1,3})\s*(?:calendar\s*)?days?\b/) ?? t.match(/\bnet\s*-?\s*(\d{1,3})\b/) ?? t.match(/\b(\d{1,3})\s*d\b/);
  if (m) { const d = Number(m[1]); return d >= 0 && d <= 365 ? d : null; }
  return /advance|prepaid|upfront|cash|\bcod\b|immediate|on delivery/.test(t) ? 0 : null;
};
const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Picking a shipment fills the subtotal (goods value + open sell charges), currency, tax % and due date, the same way the
// API does for an automatic invoice. Goods are billed on the FIRST invoice of a shipment only; a second invoice for the
// same shipment (late charges) takes the open charges alone. Everything stays editable.
const loadChargesTotal = (
  shipment: string,
  f: Record<string, string>,
  setForm: (u: (prev: Record<string, string>) => Record<string, string>) => void,
) => {
  if (!shipment) return;
  void Promise.all([
    api<{ data: Row[] }>('/trading/shipments'),
    api<{ data: Row[] }>('/trading/deals'),
    api<{ data: Row[] }>('/trading/shipment-charges'),
    api<{ data: Row[] }>('/trading/customer-invoices'),
  ])
    .then(([shipments, deals, charges, invoices]) => {
      const ship = (shipments.data ?? []).find((s) => s.shipment_number === shipment);
      const deal = ship?.deal_number ? (deals.data ?? []).find((d) => d.deal_number === ship.deal_number) : undefined;
      const open = (charges.data ?? []).filter((c) => c.shipment_number === shipment && !c.invoice_number && c.status !== 'Cancelled');
      const goodsBilled = (invoices.data ?? []).some((i) => i.shipment_number === shipment && i.status !== 'Cancelled');
      const currency = String(deal?.currency ?? '').trim() || String(open.find((c) => c.currency)?.currency ?? '');
      const chargesValue = open.filter((c) => String(c.currency ?? '') === currency).reduce((s, c) => s + num(c.sell_amount), 0);
      const goodsValue = goodsBilled ? 0 : num(ship?.quantity) * num(deal?.selling_rate) * (1 - num(deal?.discount_percent) / 100);
      if (!goodsValue && !chargesValue) return;
      const invoiceDate = f.invoice_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const days = daysFromTerms(deal?.payment_terms);
      setForm((prev) => ({
        ...prev,
        subtotal: String(round2(goodsValue + chargesValue)),
        ...(currency ? { currency } : {}),
        ...(deal && num(deal.tax_percent) ? { tax_percent: String(num(deal.tax_percent)) } : {}),
        ...(days !== null && !prev.due_date ? { due_date: addDays(invoiceDate, days) } : {}),
      }));
    })
    .catch(() => { /* leave the subtotal for the user to type */ });
};

const config: TradingModuleConfig = {
  resource: '/trading/customer-invoices',
  eyebrowModule: 'CUSTOMER INVOICES',
  title: 'Customer Invoices',
  description: 'Bill the customer for a shipment, then record payments against it. The subtotal comes from the shipment\'s charges; tax, total, balance and status are calculated for you.',
  icon: '🧾',
  emptyIcon: '🧾',
  codeField: 'invoice_number',
  nameField: 'customer_name',
  statusOptions: STATUSES,
  fitToScreen: true,
  searchableKeys: ['invoice_number', 'shipment_number', 'deal_number', 'customer_name', 'payment_reference'],
  fields: [
    { key: 'invoice_number', label: 'Invoice no.', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'CINV' },
    {
      key: 'shipment_number', label: 'Shipment', type: 'lookup', required: true, listColumn: true,
      lookupResource: '/trading/shipments', lookupLabelKey: 'product_name',
      autoFillMap: { deal_number: 'deal_number', customer_name: 'customer_name' },
      onValueChangeAsync: loadChargesTotal,
    },
    { key: 'customer_name', label: 'Customer', type: 'text', readOnly: true, listColumn: true, group: 'From shipment' },
    { key: 'deal_number', label: 'Deal', type: 'text', readOnly: true, group: 'From shipment' },
    { key: 'invoice_date', label: 'Invoice date', type: 'date', listColumn: true, group: 'Invoice' },
    { key: 'due_date', label: 'Due date', type: 'date', listColumn: true, group: 'Invoice' },
    {
      key: 'currency', label: 'Currency', type: 'lookup', group: 'Amounts',
      lookupResource: '/trading/currency-rates', lookupValueKey: 'currency_code', lookupLabelKey: 'currency_name',
    },
    { key: 'subtotal', label: 'Subtotal (goods + charges)', type: 'number', group: 'Amounts', helpText: 'Goods value (quantity x deal rate, less discount) plus the shipment\'s open charges. You can adjust it.' },
    { key: 'tax_percent', label: 'Tax %', type: 'number', group: 'Amounts' },
    { key: 'tax_amount', label: 'Tax', type: 'text', readOnly: true, group: 'Amounts', format: (_v, r) => money(r, tax(r)) },
    { key: 'total_amount', label: 'Invoice total', type: 'text', readOnly: true, listColumn: true, group: 'Amounts', format: (_v, r) => money(r, total(r)) },
    { key: 'paid_amount', label: 'Paid so far', type: 'number', group: 'Payment', listColumn: true, helpText: 'Enter the running total received from the customer.' },
    {
      key: 'balance_amount', label: 'Balance due', type: 'text', readOnly: true, listColumn: true, group: 'Payment',
      format: (_v, r) => money(r, balance(r)),
      render: (_v, r) => <strong style={{ color: balance(r) > 0 ? '#b45309' : '#15803d' }}>{money(r, balance(r))}</strong>,
    },
    { key: 'payment_date', label: 'Last payment date', type: 'date', group: 'Payment' },
    { key: 'payment_reference', label: 'Payment reference', type: 'text', group: 'Payment', placeholder: 'Cheque / transfer / UTR no.' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Payment', helpText: 'Draft and Cancelled are set by you. Other statuses follow the payments and due date.' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Payment' },
  ],
  kpis: [
    { icon: '🧾', iconClass: 'kpi-icon-ink', label: 'Invoices', value: (r) => String(r.filter((x) => x.status !== 'Cancelled').length) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Billed', value: (r) => sumMoneyWithBase(r.filter((x) => x.status !== 'Cancelled'), (x) => num(x.total_amount)) },
    { icon: '✓', iconClass: 'kpi-icon-green', label: 'Collected', value: (r) => sumMoneyWithBase(r.filter((x) => x.status !== 'Cancelled'), (x) => num(x.paid_amount)) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Outstanding', value: (r) => sumMoneyWithBase(r.filter((x) => x.status !== 'Cancelled'), (x) => num(x.balance_amount)) },
    { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Overdue', value: (r) => String(r.filter((x) => x.status === 'Overdue').length) },
  ],
  rowActions: (r) => <SendCustomerInvoiceMenuItem invoice={r} />,
  detailActions: (r) => <SendCustomerInvoiceButton invoice={r} />,
  detailExtra: (r) => (
    <LinkedRecords
      heading={`Charges on ${String(r.shipment_number ?? '')}`}
      links={[
        { title: 'Charges', resource: '/trading/shipment-charges', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.shipmentCharges, codeField: 'charge_number', subField: 'charge_type' },
        { title: 'Shipment', resource: '/trading/shipments', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.shipment, codeField: 'shipment_number', subField: 'status' },
      ]}
    />
  ),
};

export function CustomerInvoicesPage() {
  const [sendFor, setSendFor] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setSendFor((e as CustomEvent<Record<string, unknown>>).detail);
    window.addEventListener(SEND_CUSTOMER_INVOICE_EVENT, onOpen);
    return () => window.removeEventListener(SEND_CUSTOMER_INVOICE_EVENT, onOpen);
  }, []);
  return (
    <>
      <TradingMasterPage config={config} />
      {sendFor && <SendCustomerInvoiceButton key={String(sendFor.id)} invoice={sendFor} autoOpen onClose={() => setSendFor(null)} />}
    </>
  );
}