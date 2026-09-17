// FILE: admin/src/components/TradeDocumentsPage.tsx
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { api } from '../lib/api';
import { consumeTradeDocumentDraft } from '../lib/tradeDocumentHandoff';
import { TradeDocumentInsights } from './TradeDocumentInsights';

const DOC_TYPES = [
  'Proforma Invoice', 'Commercial Invoice', 'Purchase Order', 'Sales Order', 'Packing List',
  'Delivery Note', 'Bill of Lading', 'Airway Bill', 'Certificate of Origin', 'Insurance Certificate',
  'Inspection Certificate', 'Shipping Instructions', 'Transport Document', 'Other',
];
const VERIFICATION_STATUSES = ['Pending Verification', 'Verified', 'Rejected'];
const STATUSES = ['Draft', 'Uploaded', 'Pending Verification', 'Verified', 'Rejected', 'Expired', 'Archived'];

// Document number prefix by type — same "PREFIX-YEAR-SEQ" shape every other
// Trading module already uses (DEAL-2026-0001, SHP-2026-0001, ...), just
// keyed off document_type so PI/CI/PL/DN/BL etc. are all distinguishable at
// a glance per spec's numbering example.
const DOC_TYPE_PREFIXES: Record<string, string> = {
  'Proforma Invoice': 'PI',
  'Commercial Invoice': 'CI',
  'Purchase Order': 'PO',
  'Sales Order': 'SO',
  'Packing List': 'PL',
  'Delivery Note': 'DN',
  'Bill of Lading': 'BL',
  'Airway Bill': 'AWB',
  'Certificate of Origin': 'COO',
  'Insurance Certificate': 'INSC',
  'Inspection Certificate': 'INSP',
  'Shipping Instructions': 'SI',
  'Transport Document': 'TD',
  'Other': 'DOC',
};

function docPrefix(form: Record<string, string>): string {
  return DOC_TYPE_PREFIXES[form.document_type] ?? 'DOC';
}

function autoDocId(form: Record<string, string>, seq: string): string {
  return `${docPrefix(form)}-${seq}`;
}

function isExpired(doc: Record<string, unknown>): boolean {
  if (!doc.expiry_date || typeof doc.expiry_date !== 'string') return false;
  if (doc.status === 'Archived') return false;
  return new Date(doc.expiry_date).getTime() < Date.now();
}

// Fire-and-forget: once per load, quietly persist "Expired" for any document
// whose expiry date has passed and isn't already marked that way — per spec
// item 6/7, expiry is a system-derived transition, not something a user
// picks from a dropdown.
function reconcileExpiry(rows: Record<string, unknown>[]) {
  for (const doc of rows) {
    if (isExpired(doc) && doc.status !== 'Expired') {
      void api(`/trading/documents/${doc.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Expired' }) }).catch(() => {});
    }
  }
}

let reloadDocuments: () => void = () => {};

async function transitionStatus(record: Record<string, unknown>, patch: Record<string, string>) {
  await api(`/trading/documents/${record.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  reloadDocuments();
}

function DetailActions({ record }: { record: Record<string, unknown> }) {
  const status = String(record.status ?? 'Draft');
  const verification = String(record.verification_status ?? '');
  const hasFile = Boolean(record.file_reference);

  if (status === 'Draft' || status === '') {
    return (
      <button
        type="button"
        className="quiet-button"
        title={hasFile ? undefined : 'Add a file reference first'}
        disabled={!hasFile}
        onClick={() => void transitionStatus(record, { status: 'Uploaded' })}
      >
        Mark as uploaded
      </button>
    );
  }
  if (status === 'Uploaded') {
    return (
      <button type="button" className="quiet-button" onClick={() => void transitionStatus(record, { status: 'Pending Verification', verification_status: 'Pending Verification' })}>
        Submit for verification
      </button>
    );
  }
  if (status === 'Pending Verification' || verification === 'Pending Verification') {
    return (
      <>
        <button type="button" className="quiet-button" onClick={() => void transitionStatus(record, { status: 'Verified', verification_status: 'Verified' })}>
          Approve
        </button>
        <button type="button" className="quiet-button icon-action--danger" onClick={() => void transitionStatus(record, { status: 'Rejected', verification_status: 'Rejected' })}>
          Reject
        </button>
      </>
    );
  }
  if (status === 'Verified' || status === 'Rejected') {
    return (
      <button type="button" className="quiet-button" onClick={() => void transitionStatus(record, { status: 'Archived' })}>
        Archive
      </button>
    );
  }
  return null;
}

const config: TradingModuleConfig = {
  resource: '/trading/documents',
  eyebrowModule: 'TRADE DOCUMENTS',
  title: 'Trade documents',
  description: 'Documents required across deals, shipments and import/export activity — generated from the deal or shipment they belong to, verified and archived automatically as they move through the workflow.',
  icon: '📄',
  emptyIcon: '📄',
  codeField: 'document_id',
  nameField: 'document_number',
  statusOptions: STATUSES,
  searchableKeys: ['document_id', 'document_number', 'deal_number', 'shipment_number', 'customer_name', 'supplier_name'],
  fields: [
    { key: 'document_id', label: 'Document ID', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: autoDocId, regenerateOn: ['document_type'] },
    { key: 'document_number', label: 'Document number', type: 'text', required: true, listColumn: true, autoGenerate: autoDocId, regenerateOn: ['document_type'] },
    { key: 'document_type', label: 'Document type', type: 'select', options: DOC_TYPES, listColumn: true },
    {
      key: 'deal_number',
      label: 'Deal',
      type: 'lookup',
      lookupResource: '/trading/deals',
      lookupLabelKey: 'deal_name',
      autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name', quantity: 'quantity', unit: 'unit', currency: 'currency', sales_rep: 'sales_rep', expected_delivery_date: 'expected_delivery_date' },
      // Purchase Order prices off the supplier rate, every other doc type
      // off the selling rate — same deal, whichever side this document
      // is for. autoFillMap above can't branch on another field's value,
      // so the rate/total fill happens here instead.
      onLookupChange: (matched, setForm) => {
        setForm((prev) => {
          const isPO = prev.document_type === 'Purchase Order';
          const rate = Number(isPO ? matched.purchase_rate : matched.selling_rate);
          const qty = Number(matched.quantity);
          if (!Number.isFinite(rate) || rate === 0) return prev;
          const next = { ...prev, unit_price: String(rate) };
          if (Number.isFinite(qty) && qty > 0) next.total_value = String(rate * qty);
          return next;
        });
      },
      group: 'Linked records',
    },
    { key: 'shipment_number', label: 'Shipment', type: 'lookup', lookupResource: '/trading/shipments', lookupLabelKey: 'shipment_number', autoFillMap: { customer_name: 'customer_name', supplier_name: 'supplier_name', product_name: 'product_name', quantity: 'quantity', unit: 'unit', expected_delivery_date: 'expected_delivery_date', shipping_mode: 'shipping_mode', transporter: 'transporter', tracking_number: 'tracking_number' }, group: 'Linked records' },
    { key: 'customer_name', label: 'Customer', type: 'lookup', lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_code', group: 'Linked records' },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Linked records' },
    { key: 'product_name', label: 'Product', type: 'text', group: 'Linked records' },
    { key: 'reference_number', label: 'Reference number', type: 'text', group: 'Linked records' },
    { key: 'contact_person', label: 'Contact person', type: 'text', group: 'Linked records' },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Value' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Value' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Value', placeholder: 'e.g. INR, USD' },
    { key: 'unit_price', label: 'Unit price', type: 'number', group: 'Value' },
    { key: 'total_value', label: 'Total value', type: 'number', group: 'Value' },
    { key: 'tax_details', label: 'Tax / GST details', type: 'text', group: 'Value' },
    { key: 'billing_address', label: 'Billing address', type: 'textarea', group: 'Addresses' },
    { key: 'shipping_address', label: 'Shipping / delivery address', type: 'textarea', group: 'Addresses' },
    { key: 'sales_rep', label: 'Sales representative', type: 'text', group: 'Addresses' },
    { key: 'issue_date', label: 'Issue date', type: 'date', listColumn: true, group: 'Validity' },
    { key: 'order_date', label: 'Order date', type: 'date', group: 'Validity' },
    { key: 'expected_delivery_date', label: 'Expected delivery date', type: 'date', group: 'Validity' },
    { key: 'expiry_date', label: 'Expiry date', type: 'date', listColumn: true, group: 'Validity' },
    { key: 'shipping_mode', label: 'Shipping mode', type: 'text', group: 'Transport' },
    { key: 'transporter', label: 'Transporter', type: 'text', group: 'Transport' },
    { key: 'tracking_number', label: 'Tracking number', type: 'text', group: 'Transport' },
    { key: 'issued_by', label: 'Issued by', type: 'text', group: 'Status' },
    { key: 'uploaded_by', label: 'Uploaded by', type: 'text', group: 'Status' },
    {
      key: 'file_reference',
      label: 'File (link / reference)',
      type: 'text',
      group: 'Status',
      placeholder: 'Paste a link to the stored file',
      // Filling this in is the "upload" action — status advances on its own
      // per spec item 7 ("Upload file → Uploaded"), no manual status pick.
      onValueChange: (value, form) => {
        if (value && (!form.status || form.status === 'Draft')) return { status: 'Uploaded' };
      },
    },
    { key: 'verification_status', label: 'Verification status', type: 'select', options: VERIFICATION_STATUSES, listColumn: true, readOnly: true, group: 'Status' },
    { key: 'status', label: 'Document status', type: 'select', options: STATUSES, listColumn: true, readOnly: true, autoGenerate: () => 'Draft', group: 'Status' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Status' },
  ],
  kpis: [
    { icon: '📄', iconClass: 'kpi-icon-ink', label: 'Total documents', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pending verification', value: (r) => String(r.filter((x) => x.verification_status === 'Pending Verification').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Verified', value: (r) => String(r.filter((x) => x.verification_status === 'Verified').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Rejected', value: (r) => String(r.filter((x) => x.verification_status === 'Rejected').length) },
    {
      icon: '⚠',
      iconClass: 'kpi-icon-red',
      label: 'Expiring documents',
      value: (r) => String(r.filter((x) => {
        if (!x.expiry_date) return false;
        const days = (new Date(x.expiry_date as string).getTime() - Date.now()) / 86400000;
        return days >= 0 && days <= 30;
      }).length),
    },
  ],
  renderInsights: (rows) => <TradeDocumentInsights rows={rows} />,
  detailActions: (record) => <DetailActions record={record} />,
  consumePendingDraft: () => consumeTradeDocumentDraft(),
  onRecordsLoaded: (rows) => reconcileExpiry(rows),
  registerReload: (reload) => { reloadDocuments = reload; },
};

export function TradeDocumentsPage() {
  return <TradingMasterPage config={config} />;
}