// FILE: admin/src/components/CustomsClearancePage.tsx
// Rewritten for automation. The import/export lookup previously copied
// only parties and countries — declared value, currency, quantity and
// ports were all retyped, which is exactly the data customs exists to
// declare. Selecting the trade transaction now brings the whole
// declaration across, converts the value through Currency Management, and
// surfaces the trade documents already raised against that shipment.
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { LinkedRecords } from './LinkedRecords';
import { TRADING_HASH } from '../lib/recordFocus';
import { applyCurrencyConversion } from '../lib/currencyLookup';

const TRANSACTION_TYPES = ['Import', 'Export'];
const INSPECTION_STATUSES = ['Not Required', 'Pending', 'In Progress', 'Passed', 'Failed'];
const CLEARANCE_STATUSES = [
  'Not Started', 'Documentation Pending', 'Declaration Submitted', 'Under Review',
  'Inspection Required', 'Duty Pending', 'Duty Paid', 'Cleared', 'Held', 'Rejected',
];

const convertDeclared = (
  _v: string,
  _f: Record<string, string>,
  setForm: (u: (prev: Record<string, string>) => Record<string, string>) => void,
) => { void applyCurrencyConversion(setForm, {
  amount: 'declared_value', currency: 'currency',
  rate: 'exchange_rate', baseCurrency: 'base_currency', baseValue: 'base_value',
  // Duty is assessed on the rate at declaration date, not today's rate.
  onDateField: 'declaration_date',
}); };

/** Duty and charges are levied in the company/base currency by the
 *  authority, so the total is a straight sum — no conversion applied. */
function totalCustomsCost(r: Record<string, unknown>): number {
  return (Number(r.customs_duty) || 0) + (Number(r.other_charges) || 0);
}

/** Clearance status follows the dates recorded, so the dropdown doesn't
 *  have to be moved by hand as well. Terminal/manual states are left alone. */
const AUTO_MANAGED = new Set(['', 'Not Started', 'Documentation Pending', 'Declaration Submitted', 'Under Review', 'Duty Pending', 'Duty Paid']);

function deriveClearance(form: Record<string, string>): Record<string, string> | void {
  if (!AUTO_MANAGED.has(form.clearance_status ?? '')) return;
  if (form.clearance_date) return { clearance_status: 'Cleared', status: 'Cleared' };
  if (form.duty_paid_date) return { clearance_status: 'Duty Paid' };
  if (form.declaration_date) return { clearance_status: 'Declaration Submitted' };
  return;
}

const config: TradingModuleConfig = {
  resource: '/trading/customs',
  eyebrowModule: 'CUSTOMS & CLEARANCE',
  title: 'Customs & clearance',
  description: 'Declarations, duty and clearance against an existing import/export transaction. Parties, products, value and documents come from the linked records — only customs-specific detail is entered here.',
  icon: '🛃',
  emptyIcon: '🛃',
  codeField: 'customs_reference',
  nameField: 'product_name',
  statusOptions: CLEARANCE_STATUSES,
  searchableKeys: ['customs_reference', 'shipment_number', 'transaction_number', 'customer_name', 'supplier_name', 'product_name', 'hs_code', 'customs_broker'],
  fields: [
    { key: 'customs_reference', label: 'Customs reference number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'CUS' },

    // Primary source. One selection brings the whole declaration across.
    {
      key: 'transaction_number', label: 'Trade transaction', type: 'lookup', required: true, listColumn: true,
      lookupResource: '/trading/import-export', lookupLabelKey: 'product_name',
      autoFillMap: {
        transaction_type: 'transaction_type',
        shipment_number: 'shipment_number',
        customer_name: 'customer_name',
        supplier_name: 'supplier_name',
        product_name: 'product_name',
        quantity: 'quantity',
        country_of_origin: 'country_of_origin',
        destination_country: 'destination_country',
        port_of_loading: 'port_of_loading',
        port_of_discharge: 'port_of_discharge',
        total_value: 'declared_value',
        currency: 'currency',
        exchange_rate: 'exchange_rate',
        base_currency: 'base_currency',
        base_value: 'base_value',
        required_documents: 'required_documents',
      },
      onValueChangeAsync: convertDeclared,
      group: 'Transaction',
    },
    // Available when customs is being raised directly off a shipment that
    // has no import/export record yet.
    {
      key: 'shipment_number', label: 'Shipment', type: 'lookup', listColumn: true,
      lookupResource: '/trading/shipments', lookupLabelKey: 'product_name',
      autoFillMap: {
        customer_name: 'customer_name',
        supplier_name: 'supplier_name',
        product_name: 'product_name',
        quantity: 'quantity',
        origin: 'port_of_loading',
        destination: 'port_of_discharge',
      },
      group: 'Transaction',
    },
    { key: 'transaction_type', label: 'Import / export', type: 'select', options: TRANSACTION_TYPES, listColumn: true, group: 'Transaction' },
    { key: 'customer_name', label: 'Customer', type: 'text', readOnly: true, group: 'Transaction' },
    { key: 'supplier_name', label: 'Supplier', type: 'text', readOnly: true, group: 'Transaction' },
    { key: 'product_name', label: 'Product', type: 'text', readOnly: true, listColumn: true, group: 'Transaction' },
    { key: 'quantity', label: 'Quantity', type: 'number', readOnly: true, group: 'Transaction' },
    // Customs-specific and genuinely entered here — the tariff
    // classification is a customs decision, not a shipment attribute.
    { key: 'hs_code', label: 'HS code', type: 'text', listColumn: true, group: 'Transaction' },
    { key: 'country_of_origin', label: 'Country of origin', type: 'text', group: 'Ports' },
    { key: 'destination_country', label: 'Destination country', type: 'text', group: 'Ports' },
    { key: 'port_of_loading', label: 'Port of loading', type: 'text', group: 'Ports' },
    { key: 'port_of_discharge', label: 'Port of discharge', type: 'text', group: 'Ports' },

    { key: 'declared_value', label: 'Declared value', type: 'number', group: 'Duty & cost', onValueChangeAsync: convertDeclared },
    {
      key: 'currency', label: 'Currency', type: 'lookup', group: 'Duty & cost',
      lookupResource: '/trading/currency-rates', lookupValueKey: 'currency_code', lookupLabelKey: 'currency_name',
      onValueChangeAsync: convertDeclared,
    },
    { key: 'exchange_rate', label: 'Exchange rate at declaration', type: 'number', readOnly: true, group: 'Duty & cost' },
    { key: 'base_currency', label: 'Company currency', type: 'text', readOnly: true, group: 'Duty & cost' },
    { key: 'base_value', label: 'Declared value (company currency)', type: 'number', readOnly: true, listColumn: true, group: 'Duty & cost' },
    { key: 'customs_broker', label: 'Customs broker', type: 'text', group: 'Duty & cost' },
    { key: 'customs_duty', label: 'Customs duty', type: 'number', group: 'Duty & cost' },
    { key: 'other_charges', label: 'Other charges', type: 'number', group: 'Duty & cost' },
    {
      key: 'total_customs_cost', label: 'Total customs cost', type: 'text', readOnly: true, listColumn: true,
      format: (_v, r) => `${r.base_currency ? `${r.base_currency} ` : ''}${totalCustomsCost(r).toLocaleString()}`,
      group: 'Duty & cost',
    },

    // Documents already raised in Trade Documents — referenced, not copied.
    {
      key: 'required_documents', label: 'Customs documents', type: 'multi-lookup',
      lookupResource: '/trading/documents', lookupValueKey: 'document_number', lookupLabelKey: 'document_type',
      group: 'Clearance',
    },
    { key: 'declaration_date', label: 'Declaration date', type: 'date', group: 'Clearance', onValueChange: (_v, f) => deriveClearance(f), onValueChangeAsync: convertDeclared },
    { key: 'assessment_date', label: 'Assessment date', type: 'date', group: 'Clearance' },
    { key: 'duty_paid_date', label: 'Duty paid date', type: 'date', group: 'Clearance', onValueChange: (_v, f) => deriveClearance(f) },
    { key: 'inspection_status', label: 'Inspection status', type: 'select', options: INSPECTION_STATUSES, group: 'Clearance' },
    { key: 'clearance_date', label: 'Clearance date', type: 'date', group: 'Clearance', onValueChange: (_v, f) => deriveClearance(f) },
    { key: 'clearance_status', label: 'Clearance status', type: 'select', options: CLEARANCE_STATUSES, listColumn: true, group: 'Clearance' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Clearance' },
  ],
  kpis: [
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Customs pending', value: (r) => String(r.filter((x) => !['Cleared', 'Rejected'].includes(String(x.clearance_status))).length) },
    { icon: '⚖', iconClass: 'kpi-icon-school', label: 'Under review', value: (r) => String(r.filter((x) => x.clearance_status === 'Under Review' || x.clearance_status === 'Inspection Required').length) },
    { icon: '₹', iconClass: 'kpi-icon-amber', label: 'Duty pending', value: (r) => String(r.filter((x) => x.clearance_status === 'Duty Pending').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Cleared', value: (r) => String(r.filter((x) => x.clearance_status === 'Cleared').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Held / rejected', value: (r) => String(r.filter((x) => x.clearance_status === 'Held' || x.clearance_status === 'Rejected').length) },
    {
      icon: '₹', iconClass: 'kpi-icon-ink', label: 'Duty & charges',
      value: (r) => r.reduce((s, x) => s + totalCustomsCost(x), 0).toLocaleString(),
    },
    {
      icon: '⏱', iconClass: 'kpi-icon-school', label: 'Avg clearance days',
      value: (r) => {
        const done = r.filter((x) => x.declaration_date && x.clearance_date);
        if (!done.length) return '—';
        const days = done.reduce((s, x) => s + (new Date(x.clearance_date as string).getTime() - new Date(x.declaration_date as string).getTime()) / 86400000, 0);
        return `${(days / done.length).toFixed(1)}d`;
      },
    },
  ],
  detailExtra: (r) => (
    <LinkedRecords
      heading={`Chain for ${String(r.customs_reference ?? '')}`}
      links={[
        { title: 'Import / export', resource: '/trading/import-export', matchField: 'transaction_number', matchValue: String(r.transaction_number ?? ''), hash: TRADING_HASH.importExport, codeField: 'transaction_number', subField: 'status' },
        { title: 'Shipment', resource: '/trading/shipments', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.shipment, codeField: 'shipment_number', subField: 'status' },
        { title: 'Logistics', resource: '/trading/logistics', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.logistics, codeField: 'logistics_number', subField: 'status' },
        { title: 'Trade documents', resource: '/trading/documents', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.tradeDocuments, codeField: 'document_number', subField: 'document_type' },
        { title: 'Claims', resource: '/trading/claims', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.claims, codeField: 'claim_number', subField: 'status' },
      ]}
    />
  ),
 
};

export function CustomsClearancePage() {
  return <TradingMasterPage config={config} />;
}