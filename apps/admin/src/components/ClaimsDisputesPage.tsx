// FILE: admin/src/components/ClaimsDisputesPage.tsx
// Rewritten for linkage. The bones were here — claim type, severity, SLA,
// resolution — but the connections weren't: the purchase-enquiry lookup
// copied nothing, and order_number / invoice_number / document_reference /
// evidence_documents were all free text, so a claim could reference an
// order that didn't exist. Every link is now a real lookup into the
// existing record, and raising a claim from a shipment or order fills the
// rest in.
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { LinkedRecords } from './LinkedRecords';
import { TRADING_HASH } from '../lib/recordFocus';
import { applyCurrencyConversion } from '../lib/currencyLookup';

const CLAIM_TYPES = [
  'Quantity Shortage', 'Wrong Product', 'Damaged Goods', 'Quality Issue', 'Delivery Delay',
  'Missing Goods', 'Price Dispute', 'Invoice Dispute', 'Payment Dispute', 'Documentation Issue',
  'Shipment Issue', 'Customs Issue', 'Freight Issue', 'Product Specification Issue', 'Other',
];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const RESPONSIBLE_PARTIES = ['Company', 'Customer', 'Supplier', 'Logistics Provider', 'Carrier', 'Customs', 'Under Investigation'];
const STATUSES = [
  'Draft', 'Submitted', 'Under Review', 'Investigation', 'Awaiting Customer', 'Awaiting Supplier',
  'Awaiting Logistics', 'Negotiation', 'Approved', 'Partially Resolved', 'Resolved', 'Rejected', 'Closed',
];
const OPEN_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Investigation', 'Awaiting Customer', 'Awaiting Supplier', 'Awaiting Logistics', 'Negotiation', 'Approved', 'Partially Resolved'];
const CLOSED_STATUSES = ['Resolved', 'Rejected', 'Closed'];

const convertClaim = (
  _v: string,
  _f: Record<string, string>,
  setForm: (u: (prev: Record<string, string>) => Record<string, string>) => void,
) => { void applyCurrencyConversion(setForm, {
  amount: 'claimed_value', currency: 'currency',
  rate: 'exchange_rate', baseCurrency: 'base_currency', baseValue: 'base_value',
  onDateField: 'claim_date',
}); };

/** Recording the resolution date closes the claim, rather than leaving the
 *  status dropdown to be moved separately and forgotten. */
function deriveResolved(form: Record<string, string>): Record<string, string> | void {
  if (!form.actual_resolution_date) return;
  if (CLOSED_STATUSES.includes(form.status ?? '')) return;
  return { status: 'Resolved' };
}

const config: TradingModuleConfig = {
  resource: '/trading/claims',
  eyebrowModule: 'CLAIMS & DISPUTES',
  title: 'Claims & disputes',
  description: 'Claims raised against an existing order, shipment or supplier — every claim points at the real records it concerns, from submission through investigation to resolution.',
  icon: '⚠',
  emptyIcon: '⚠',
  codeField: 'claim_number',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['claim_number', 'customer_name', 'supplier_name', 'deal_number', 'shipment_number', 'order_number', 'product_name', 'invoice_number', 'assigned_to'],
  fields: [
    { key: 'claim_number', label: 'Claim number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'CLM' },
    { key: 'claim_date', label: 'Claim date', type: 'date', listColumn: true, onValueChangeAsync: convertClaim },
    { key: 'claim_type', label: 'Claim type', type: 'select', options: CLAIM_TYPES, required: true, listColumn: true },

    // Source record — pick whichever the claim arises from and the rest of
    // the form fills itself. This is the path a claim normally arrives by:
    // something went wrong with a specific shipment or order.
    {
      key: 'shipment_number', label: 'Shipment', type: 'lookup', listColumn: true,
      lookupResource: '/trading/shipments', lookupLabelKey: 'product_name',
      autoFillMap: {
        deal_number: 'deal_number',
        customer_name: 'customer_name',
        supplier_name: 'supplier_name',
        product_name: 'product_name',
        quantity: 'quantity',
        transporter: 'logistics_provider',
        batch_serial: 'batch_number',
      },
      group: 'Linked records',
    },
    {
      key: 'order_number', label: 'Sales order', type: 'lookup',
      lookupResource: '/trading/sales-orders', lookupLabelKey: 'product_name',
      autoFillMap: {
        deal_number: 'deal_number',
        customer_name: 'customer_name',
        product_name: 'product_name',
        quantity: 'quantity',
        currency: 'currency',
      },
      onValueChangeAsync: convertClaim,
      group: 'Linked records',
    },
    {
      key: 'purchase_enquiry', label: 'Purchase enquiry', type: 'lookup',
      lookupResource: '/trading/purchase-enquiries', lookupValueKey: 'enquiry_number', lookupLabelKey: 'product_name',
      autoFillMap: {
        deal_number: 'deal_number',
        supplier_name: 'supplier_name',
        product_name: 'product_name',
        quantity: 'quantity',
        currency: 'currency',
      },
      group: 'Linked records',
    },
    {
      key: 'deal_number', label: 'Deal', type: 'lookup',
      lookupResource: '/trading/deals', lookupLabelKey: 'deal_name',
      autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name', quantity: 'quantity', unit: 'unit', currency: 'currency' },
      onValueChangeAsync: convertClaim,
      group: 'Linked records',
    },
    {
      key: 'logistics_number', label: 'Logistics movement', type: 'lookup',
      lookupResource: '/trading/logistics', lookupLabelKey: 'carrier',
      autoFillMap: { carrier: 'logistics_provider', shipment_number: 'shipment_number' },
      group: 'Linked records',
    },
    {
      key: 'transaction_number', label: 'Import / export transaction', type: 'lookup',
      lookupResource: '/trading/import-export', lookupLabelKey: 'product_name',
      autoFillMap: { shipment_number: 'shipment_number', invoice_number: 'invoice_number', customer_name: 'customer_name', supplier_name: 'supplier_name' },
      group: 'Linked records',
    },

    // Parties: Core client record and Trading supplier record, never a new
    // copy created here.
    { key: 'customer_name', label: 'Customer', type: 'lookup', lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_code', listColumn: true, group: 'Parties' },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Parties' },
    { key: 'logistics_provider', label: 'Logistics provider', type: 'text', group: 'Parties' },
    { key: 'responsible_party', label: 'Responsible party', type: 'select', options: RESPONSIBLE_PARTIES, group: 'Parties' },

    { key: 'product_name', label: 'Product', type: 'text', group: 'Product & value' },
    { key: 'product_code', label: 'Product code', type: 'text', group: 'Product & value' },
    { key: 'batch_number', label: 'Batch / serial', type: 'text', group: 'Product & value' },
    { key: 'quantity', label: 'Quantity claimed', type: 'number', group: 'Product & value' },
    { key: 'claimed_value', label: 'Claim amount', type: 'number', listColumn: true, group: 'Product & value', onValueChangeAsync: convertClaim },
    {
      key: 'currency', label: 'Currency', type: 'lookup', group: 'Product & value',
      lookupResource: '/trading/currency-rates', lookupValueKey: 'currency_code', lookupLabelKey: 'currency_name',
      onValueChangeAsync: convertClaim,
    },
    { key: 'exchange_rate', label: 'Exchange rate applied', type: 'number', readOnly: true, group: 'Product & value' },
    { key: 'base_currency', label: 'Company currency', type: 'text', readOnly: true, group: 'Product & value' },
    { key: 'base_value', label: 'Claim in company currency', type: 'number', readOnly: true, group: 'Product & value' },

    // Evidence: references to documents that already exist in Trade
    // Documents, so a claim can't cite paperwork nobody can find.
    {
      key: 'document_reference', label: 'Supporting trade documents', type: 'multi-lookup',
      lookupResource: '/trading/documents', lookupValueKey: 'document_number', lookupLabelKey: 'document_type',
      group: 'Evidence',
    },
    { key: 'invoice_number', label: 'Invoice number', type: 'text', group: 'Evidence' },
    { key: 'evidence_documents', label: 'Other evidence (photos, reports)', type: 'text', group: 'Evidence' },
    { key: 'description', label: 'Description of the issue', type: 'textarea', group: 'Evidence' },

    { key: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, group: 'Handling' },
    { key: 'severity', label: 'Severity', type: 'select', options: SEVERITIES, listColumn: true, group: 'Handling' },
    { key: 'claim_source', label: 'Claim source', type: 'text', group: 'Handling', placeholder: 'e.g. Customer complaint, internal QC' },
    { key: 'reported_by', label: 'Reported by', type: 'text', group: 'Handling' },
    { key: 'assigned_to', label: 'Assigned to', type: 'text', listColumn: true, group: 'Handling' },
    { key: 'department', label: 'Department', type: 'text', group: 'Handling' },
    { key: 'expected_resolution_date', label: 'Expected resolution date', type: 'date', group: 'Handling' },
    { key: 'actual_resolution_date', label: 'Actual resolution date', type: 'date', group: 'Handling', onValueChange: (_v, f) => deriveResolved(f) },
    {
      key: 'sla_flag', label: 'SLA', type: 'text', readOnly: true, listColumn: true,
      format: (_v, r) => {
        if (CLOSED_STATUSES.includes(String(r.status))) return String(r.status);
        if (!r.expected_resolution_date) return '—';
        const days = Math.floor((new Date(r.expected_resolution_date as string).getTime() - Date.now()) / 86400000);
        if (days < 0) return `Overdue by ${Math.abs(days)}d`;
        if (days <= 2) return 'Due soon';
        return 'On track';
      },
      group: 'Handling',
    },

    { key: 'resolution', label: 'Resolution', type: 'textarea', group: 'Resolution' },
    { key: 'compensation_amount', label: 'Compensation amount', type: 'number', group: 'Resolution' },
    { key: 'credit_note_reference', label: 'Credit note reference', type: 'text', group: 'Resolution' },
    { key: 'replacement_reference', label: 'Replacement shipment / order', type: 'text', group: 'Resolution' },
    { key: 'refund_amount', label: 'Refund amount', type: 'number', group: 'Resolution' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Resolution' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Resolution' },
  ],
  kpis: [
    { icon: '⚠', iconClass: 'kpi-icon-ink', label: 'Total claims', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Open claims', value: (r) => String(r.filter((x) => OPEN_STATUSES.includes(String(x.status))).length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Critical claims', value: (r) => String(r.filter((x) => x.severity === 'Critical' && OPEN_STATUSES.includes(String(x.status))).length) },
    {
      icon: '⏰', iconClass: 'kpi-icon-red', label: 'Overdue claims',
      value: (r) => String(r.filter((x) => OPEN_STATUSES.includes(String(x.status)) && x.expected_resolution_date && new Date(x.expected_resolution_date as string).getTime() < Date.now()).length),
    },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Resolved', value: (r) => String(r.filter((x) => x.status === 'Resolved' || x.status === 'Closed').length) },
    {
      icon: '₹', iconClass: 'kpi-icon-school', label: 'Claim value (company currency)',
      value: (r) => r.reduce((s, x) => s + (Number(x.base_value) || 0), 0).toLocaleString(),
    },
    {
      icon: '₹', iconClass: 'kpi-icon-school', label: 'Compensation settled',
      value: (r) => r.reduce((s, x) => s + (Number(x.compensation_amount) || 0) + (Number(x.refund_amount) || 0), 0).toLocaleString(),
    },
  ],
  detailExtra: (r) => (
    <LinkedRecords
      heading={`Records this claim concerns`}
      links={[
        { title: 'Shipment', resource: '/trading/shipments', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.shipment, codeField: 'shipment_number', subField: 'status' },
        { title: 'Sales order', resource: '/trading/sales-orders', matchField: 'order_number', matchValue: String(r.order_number ?? ''), hash: TRADING_HASH.salesOrder, codeField: 'order_number', subField: 'status' },
        { title: 'Deal', resource: '/trading/deals', matchField: 'deal_number', matchValue: String(r.deal_number ?? ''), hash: TRADING_HASH.deal, codeField: 'deal_number', subField: 'deal_name' },
        { title: 'Logistics', resource: '/trading/logistics', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.logistics, codeField: 'logistics_number', subField: 'status' },
        { title: 'Customs', resource: '/trading/customs', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.customs, codeField: 'customs_reference', subField: 'clearance_status' },
        { title: 'Trade documents', resource: '/trading/documents', matchField: 'shipment_number', matchValue: String(r.shipment_number ?? ''), hash: TRADING_HASH.tradeDocuments, codeField: 'document_number', subField: 'document_type' },
      ]}
    />
  ),

};

export function ClaimsDisputesPage() {
  return <TradingMasterPage config={config} />;
}