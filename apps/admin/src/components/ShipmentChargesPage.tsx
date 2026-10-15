// FILE: admin/src/components/ShipmentChargesPage.tsx
// One row per charge on a shipment (sea freight, customs duty, clearance fee, port, delivery, insurance...).
// cost_amount = what we pay the shipping line / customs agent / transporter.
// sell_amount = what we bill the customer. The difference is our margin on that line.
// Customer Invoices adds up the sell amounts of a shipment's open charges.
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const CHARGE_TYPES = [
  'Sea Freight', 'Air Freight', 'Road Freight', 'Customs Duty', 'Clearance Fee', 'Port / Terminal Charges',
  'Documentation Fee', 'Local Delivery', 'Insurance', 'Handling / Warehouse', 'Detention / Demurrage', 'Other',
];

const num = (v: unknown): number => Number(v) || 0;
const money = (r: Record<string, unknown>, v: number) => `${r.currency ? `${String(r.currency)} ` : ''}${v.toLocaleString()}`;

const config: TradingModuleConfig = {
  resource: '/trading/shipment-charges',
  eyebrowModule: 'SHIPMENT CHARGES',
  title: 'Shipment Charges',
  description: 'Every charge on a shipment, one line each. Enter what you pay (cost) and what you bill the customer (sell). Customer Invoices picks up the sell amounts.',
  icon: '₹',
  emptyIcon: '₹',
  codeField: 'charge_number',
  nameField: 'charge_type',
  statusOptions: ['Active', 'Cancelled'],
  fitToScreen: true,
  searchableKeys: ['charge_number', 'shipment_number', 'deal_number', 'customer_name', 'charge_type', 'vendor_name', 'invoice_number'],
  fields: [
    { key: 'charge_number', label: 'Charge reference', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'CHG' },
    {
      key: 'shipment_number', label: 'Shipment', type: 'lookup', required: true, listColumn: true,
      lookupResource: '/trading/shipments', lookupLabelKey: 'product_name',
      autoFillMap: { deal_number: 'deal_number', customer_name: 'customer_name' },
    },
    { key: 'customer_name', label: 'Customer', type: 'text', readOnly: true, listColumn: true, group: 'From shipment' },
    { key: 'deal_number', label: 'Deal', type: 'text', readOnly: true, group: 'From shipment' },
    { key: 'charge_type', label: 'Charge type', type: 'select', options: CHARGE_TYPES, required: true, listColumn: true, group: 'Charge' },
    { key: 'description', label: 'Description', type: 'text', group: 'Charge', placeholder: 'e.g. 40ft container, Shanghai to Karachi' },
    { key: 'vendor_name', label: 'Paid to (vendor)', type: 'text', group: 'Charge', placeholder: 'Shipping line, customs agent, transporter...' },
    {
      key: 'currency', label: 'Currency', type: 'lookup', group: 'Amounts', listColumn: true,
      lookupResource: '/trading/currency-rates', lookupValueKey: 'currency_code', lookupLabelKey: 'currency_name',
    },
    { key: 'cost_amount', label: 'Cost (what we pay)', type: 'number', group: 'Amounts', listColumn: true },
    { key: 'sell_amount', label: 'Sell (billed to customer)', type: 'number', group: 'Amounts', listColumn: true },
    {
      key: 'margin', label: 'Margin', type: 'text', readOnly: true, group: 'Amounts', listColumn: true,
      format: (_v, r) => money(r, num(r.sell_amount) - num(r.cost_amount)),
      render: (_v, r) => {
        const m = num(r.sell_amount) - num(r.cost_amount);
        return <span style={{ color: m < 0 ? '#b91c1c' : undefined }}>{money(r, m)}</span>;
      },
    },
    { key: 'invoice_number', label: 'Billed on invoice', type: 'text', readOnly: true, listColumn: true, group: 'Billing', helpText: 'Filled automatically when a Customer Invoice is raised for this shipment.' },
    { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Cancelled'], listColumn: true, group: 'Billing' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Billing' },
  ],
  kpis: [
    { icon: '₹', iconClass: 'kpi-icon-ink', label: 'Charge lines', value: (r) => String(r.filter((x) => x.status !== 'Cancelled').length) },
    { icon: '↓', iconClass: 'kpi-icon-amber', label: 'Total cost', value: (r) => r.filter((x) => x.status !== 'Cancelled').reduce((s, x) => s + num(x.cost_amount), 0).toLocaleString() },
    { icon: '↑', iconClass: 'kpi-icon-green', label: 'Total billable', value: (r) => r.filter((x) => x.status !== 'Cancelled').reduce((s, x) => s + num(x.sell_amount), 0).toLocaleString() },
    { icon: '%', iconClass: 'kpi-icon-school', label: 'Margin', value: (r) => r.filter((x) => x.status !== 'Cancelled').reduce((s, x) => s + num(x.sell_amount) - num(x.cost_amount), 0).toLocaleString() },
    { icon: '◷', iconClass: 'kpi-icon-red', label: 'Not yet invoiced', value: (r) => String(r.filter((x) => x.status !== 'Cancelled' && !x.invoice_number).length) },
  ],
};

export function ShipmentChargesPage() {
  return <TradingMasterPage config={config} />;
}
