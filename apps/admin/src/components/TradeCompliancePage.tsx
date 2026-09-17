// FILE: admin/src/components/TradeCompliancePage.tsx
// Rewritten. The previous version had the user pick a deal, then retype
// customer, supplier, product, country, HS code, shipment and transaction,
// and finally set "Document status" from memory — with nothing anywhere
// actually checking whether the documents existed.
//
// Now: pick the shipment (or the deal) and compliance reads the real
// position — which trade documents are raised, which are missing, which
// have expired, where customs has got to, what the import/export record
// says is required. The user supplies only what a system can't: risk
// judgement, the responsible person, a due date, and sign-off.
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { LinkedRecords } from './LinkedRecords';
import { ComplianceChecklist } from './ComplianceChecklist';
import { TRADING_HASH } from '../lib/recordFocus';
import { buildChain, loadTradingTables } from '../lib/tradingChain';
import { buildComplianceReport } from '../lib/complianceChecks';

const str = (v: unknown): string => (v == null ? '' : String(v));

const COMPLIANCE_TYPES = [
  'Document Compliance', 'Product Compliance', 'Supplier Compliance', 'Customer Compliance',
  'Country Compliance', 'Import Compliance', 'Export Compliance', 'Shipment Compliance', 'Internal Policy Compliance',
];
const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
const DOCUMENT_STATUSES = ['Complete', 'Incomplete', 'Missing'];
const APPROVAL_STATUSES = ['Not Required', 'Pending', 'Approved', 'Rejected'];
const STATUSES = [
  'Not Checked', 'Pending Review', 'Passed', 'Failed',
  'Exception Requested', 'Exception Approved', 'Exception Rejected', 'Resolved', 'Closed',
];

/**
 * One selection resolves the whole compliance position. Everything written
 * back is derived from a record that already exists — the module never asks
 * for a shipment's customer or a transaction's country a second time.
 */
async function fillFromChain(
  anchor: { deal_number?: string; shipment_number?: string },
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
) {
  if (!anchor.deal_number && !anchor.shipment_number) return;
  try {
    const tables = await loadTradingTables();
    const chain = buildChain(tables, anchor);
    const report = buildComplianceReport(chain);
    const deal = chain.deal;
    const shipment = chain.shipments[0];
    const trade = chain.importExport[0];
    const customs = chain.customs[0];

    setForm((prev) => {
      const next = { ...prev };
      const put = (key: string, value: unknown) => {
        if (value != null && value !== '') next[key] = String(value);
      };
      put('deal_number', deal?.deal_number);
      put('shipment_number', shipment?.shipment_number);
      put('transaction_number', trade?.transaction_number);
      put('customs_reference', customs?.customs_reference);
      put('customer_name', deal?.customer_name ?? shipment?.customer_name);
      put('supplier_name', deal?.supplier_name ?? shipment?.supplier_name);
      put('product_name', deal?.product_name ?? shipment?.product_name);
      put('hs_code', customs?.hs_code);
      put('country', trade?.destination_country ?? customs?.destination_country ?? shipment?.destination);
      put('incoterm', trade?.incoterm);

      next.required_documents = report.requiredDocuments.join(', ');
      next.missing_documents = report.missingDocuments.join(', ');
      next.expired_documents = [...report.expiredDocuments, ...report.expiringDocuments].join(', ');
      next.document_status = report.documentStatus;
      next.customs_status = report.customsStatus;
      next.shipment_status = report.shipmentStatus;
      next.check_date = new Date().toISOString().slice(0, 10);
      // A starting point only — the reviewer can raise or lower it.
      if (!prev.risk_level) next.risk_level = report.suggestedRisk;
      if (!prev.compliance_type) {
        next.compliance_type = trade
          ? (str(trade.transaction_type) === 'Import' ? 'Import Compliance' : 'Export Compliance')
          : 'Shipment Compliance';
      }
      // Never auto-pass. A clean checklist proposes Pending Review; a human
      // signs it off, which is the point of having a compliance module.
      if (!prev.status || prev.status === 'Not Checked') {
        next.status = report.missingDocuments.length > 0 || report.expiredDocuments.length > 0 ? 'Failed' : 'Pending Review';
      }
      return next;
    });
  } catch {
    // Leave the form as the user left it.
  }
}

const OPEN_STATUSES = ['Not Checked', 'Pending Review', 'Failed', 'Exception Requested'];

const config: TradingModuleConfig = {
  resource: '/trading/compliance',
  eyebrowModule: 'TRADE COMPLIANCE MANAGEMENT',
  title: 'Trade compliance management',
  description: 'Compliance checks read straight from the linked shipment, customs declaration, import/export transaction and trade documents. Missing and expired paperwork is detected, not typed in. Internal control checks only — not legal advice.',
  icon: '✓',
  emptyIcon: '✓',
  codeField: 'compliance_reference',
  nameField: 'compliance_type',
  statusOptions: STATUSES,
  searchableKeys: ['compliance_reference', 'deal_number', 'shipment_number', 'customer_name', 'supplier_name', 'product_name', 'country', 'hs_code', 'responsible_person'],
  fields: [
    { key: 'compliance_reference', label: 'Compliance reference', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'CMP' },

    // Either anchor resolves the whole chain.
    {
      key: 'shipment_number', label: 'Shipment', type: 'lookup', listColumn: true,
      lookupResource: '/trading/shipments', lookupLabelKey: 'product_name',
      onValueChangeAsync: (value, _form, setForm) => { void fillFromChain({ shipment_number: value }, setForm); },
    },
    {
      key: 'deal_number', label: 'Deal (if not shipment-specific)', type: 'lookup', listColumn: true,
      lookupResource: '/trading/deals', lookupLabelKey: 'deal_name',
      onValueChangeAsync: (value, form, setForm) => {
        if (form.shipment_number) return; // the shipment is the narrower anchor
        void fillFromChain({ deal_number: value }, setForm);
      },
    },
    { key: 'compliance_type', label: 'Compliance type', type: 'select', options: COMPLIANCE_TYPES, required: true, listColumn: true },

    { key: 'customer_name', label: 'Customer', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'supplier_name', label: 'Supplier', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'product_name', label: 'Product', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'transaction_number', label: 'Import / export transaction', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'customs_reference', label: 'Customs declaration', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'country', label: 'Destination country', type: 'text', readOnly: true, listColumn: true, group: 'From the transaction' },
    { key: 'hs_code', label: 'HS code', type: 'text', readOnly: true, group: 'From the transaction' },
    { key: 'incoterm', label: 'Incoterm', type: 'text', readOnly: true, group: 'From the transaction' },

    { key: 'required_documents', label: 'Required documents', type: 'textarea', readOnly: true, group: 'Detected position' },
    { key: 'missing_documents', label: 'Missing documents', type: 'textarea', readOnly: true, group: 'Detected position' },
    { key: 'expired_documents', label: 'Expired / expiring documents', type: 'textarea', readOnly: true, group: 'Detected position' },
    { key: 'document_status', label: 'Document status', type: 'select', options: DOCUMENT_STATUSES, readOnly: true, listColumn: true, group: 'Detected position' },
    { key: 'customs_status', label: 'Customs status', type: 'text', readOnly: true, listColumn: true, group: 'Detected position' },
    { key: 'shipment_status', label: 'Shipment status', type: 'text', readOnly: true, group: 'Detected position' },
    { key: 'check_date', label: 'Checked on', type: 'date', readOnly: true, group: 'Detected position' },

    // Judgement and ownership — the genuinely manual part.
    { key: 'risk_level', label: 'Risk level', type: 'select', options: RISK_LEVELS, listColumn: true, group: 'Review' },
    { key: 'responsible_person', label: 'Responsible person', type: 'text', listColumn: true, group: 'Review' },
    { key: 'checked_by', label: 'Checked by', type: 'text', group: 'Review' },
    { key: 'due_date', label: 'Due date', type: 'date', listColumn: true, group: 'Review' },
    { key: 'required_action', label: 'Required action', type: 'textarea', group: 'Review' },
    { key: 'approval_status', label: 'Approval status', type: 'select', options: APPROVAL_STATUSES, group: 'Resolution' },
    { key: 'exception_reason', label: 'Exception reason', type: 'textarea', group: 'Resolution' },
    { key: 'resolution', label: 'Resolution', type: 'textarea', group: 'Resolution' },
    { key: 'status', label: 'Compliance status', type: 'select', options: STATUSES, listColumn: true, group: 'Resolution' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Resolution' },
  ],
  kpis: [
    { icon: '✓', iconClass: 'kpi-icon-ink', label: 'Total checks', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Passed', value: (r) => String(r.filter((x) => ['Passed', 'Resolved', 'Closed'].includes(str(x.status))).length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Failed', value: (r) => String(r.filter((x) => str(x.status) === 'Failed').length) },
    {
      icon: '📄', iconClass: 'kpi-icon-red', label: 'Missing documents',
      value: (r) => String(r.filter((x) => str(x.missing_documents).trim().length > 0).length),
      sub: () => 'checks with paperwork outstanding',
    },
    { icon: '⚠', iconClass: 'kpi-icon-red', label: 'High / critical risk', value: (r) => String(r.filter((x) => ['High', 'Critical'].includes(str(x.risk_level))).length) },
    {
      icon: '⏰', iconClass: 'kpi-icon-amber', label: 'Overdue',
      value: (r) => String(r.filter((x) => x.due_date && OPEN_STATUSES.includes(str(x.status)) && new Date(str(x.due_date)).getTime() < Date.now()).length),
    },
  ],
  detailExtra: (r) => (
    <>
      <ComplianceChecklist record={r} />
      <LinkedRecords
        heading={`Chain for ${str(r.shipment_number || r.deal_number)}`}
        links={[
          { title: 'Deal', resource: '/trading/deals', matchField: 'deal_number', matchValue: str(r.deal_number), hash: TRADING_HASH.deal, codeField: 'deal_number', subField: 'deal_name' },
          { title: 'Shipment', resource: '/trading/shipments', matchField: 'shipment_number', matchValue: str(r.shipment_number), hash: TRADING_HASH.shipment, codeField: 'shipment_number', subField: 'status' },
          { title: 'Import / export', resource: '/trading/import-export', matchField: 'transaction_number', matchValue: str(r.transaction_number), hash: TRADING_HASH.importExport, codeField: 'transaction_number', subField: 'status' },
          { title: 'Customs', resource: '/trading/customs', matchField: 'customs_reference', matchValue: str(r.customs_reference), hash: TRADING_HASH.customs, codeField: 'customs_reference', subField: 'clearance_status' },
          { title: 'Trade documents', resource: '/trading/documents', matchField: 'shipment_number', matchValue: str(r.shipment_number), hash: TRADING_HASH.tradeDocuments, codeField: 'document_number', subField: 'document_type' },
        ]}
      />
    </>
  ),
};

export function TradeCompliancePage() {
  return <TradingMasterPage config={config} />;
}