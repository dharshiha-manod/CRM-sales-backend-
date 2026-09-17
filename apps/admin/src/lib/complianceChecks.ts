// FILE: admin/src/lib/complianceChecks.ts
// Compliance is a control layer over records that already exist, not a
// second place to describe a shipment. Everything here is derived: the
// documents actually raised in Trade Documents, their expiry dates, the
// customs clearance state, the shipment state, and the document list the
// Import/Export record itself says is required.
//
// The only thing a user adds in the Compliance module is judgement —
// risk level, responsible person, due date, exception reason, sign-off.
import type { TradingChain } from './tradingChain';

const str = (v: unknown): string => (v == null ? '' : String(v));

/** Baseline paperwork for any trade movement. */
const BASE_DOCS = ['Commercial Invoice', 'Packing List'];
/** Additional paperwork once goods cross a border. */
const CROSS_BORDER_DOCS = ['Bill of Lading', 'Certificate of Origin', 'Insurance Certificate'];

export type CheckState = 'pass' | 'warn' | 'fail' | 'info';

export interface ComplianceCheck {
  label: string;
  state: CheckState;
  detail: string;
}

export interface ComplianceReport {
  checks: ComplianceCheck[];
  requiredDocuments: string[];
  presentDocuments: string[];
  missingDocuments: string[];
  expiredDocuments: string[];
  expiringDocuments: string[];
  /** Complete / Incomplete / Missing — matches the module's stored field */
  documentStatus: string;
  customsStatus: string;
  shipmentStatus: string;
  /** Low / Medium / High — a starting point the reviewer can override */
  suggestedRisk: string;
  crossBorder: boolean;
}

function daysUntil(value: unknown): number | null {
  const raw = str(value);
  if (!raw) return null;
  const days = (new Date(raw).getTime() - Date.now()) / 86400000;
  return Number.isFinite(days) ? Math.floor(days) : null;
}

/**
 * Works out what this transaction needs and what it actually has.
 * The required list comes from the Import/Export record's own
 * `required_documents` when one exists — that module already captures it,
 * so compliance reads it rather than asking for it a second time.
 */
export function buildComplianceReport(chain: TradingChain): ComplianceReport {
  const trade = chain.importExport[0];
  const customs = chain.customs[0];
  const shipment = chain.shipments[0];
  const crossBorder = Boolean(trade) || Boolean(customs);

  const declared = str(trade?.required_documents ?? customs?.required_documents)
    .split(',').map((s) => s.trim()).filter(Boolean);

  const requiredDocuments = declared.length
    ? declared
    : [...BASE_DOCS, ...(crossBorder ? CROSS_BORDER_DOCS : [])];

  const usable = chain.documents.filter((d) => str(d.status) !== 'Rejected' && str(d.verification_status) !== 'Rejected');
  const presentDocuments = [...new Set(usable.map((d) => str(d.document_type)).filter(Boolean))];

  // A declared list can name either a document type or a document number,
  // so match on both rather than forcing one convention.
  const has = (want: string) => usable.some((d) => str(d.document_type) === want || str(d.document_number) === want);
  const missingDocuments = requiredDocuments.filter((want) => !has(want));

  const expiredDocuments: string[] = [];
  const expiringDocuments: string[] = [];
  for (const d of usable) {
    const days = daysUntil(d.expiry_date);
    if (days == null) continue;
    const label = `${str(d.document_type) || str(d.document_number)}`;
    if (days < 0) expiredDocuments.push(label);
    else if (days <= 30) expiringDocuments.push(`${label} (${days}d)`);
  }

  const documentStatus = presentDocuments.length === 0
    ? 'Missing'
    : missingDocuments.length > 0 || expiredDocuments.length > 0 ? 'Incomplete' : 'Complete';

  const customsStatus = customs ? (str(customs.clearance_status) || 'Not Started') : 'No customs record';
  const shipmentStatus = shipment ? (str(shipment.status) || 'No status') : 'No shipment raised';

  const checks: ComplianceCheck[] = [];

  for (const want of requiredDocuments) {
    checks.push(has(want)
      ? { label: want, state: 'pass', detail: 'Raised in Trade Documents' }
      : { label: want, state: 'fail', detail: 'Missing' });
  }
  for (const label of expiredDocuments) {
    checks.push({ label, state: 'fail', detail: 'Expired' });
  }
  for (const label of expiringDocuments) {
    checks.push({ label, state: 'warn', detail: 'Expiring within 30 days' });
  }

  checks.push(customs
    ? {
      label: `Customs — ${str(customs.customs_reference)}`,
      state: ['Cleared', 'Duty Paid'].includes(customsStatus) ? 'pass' : ['Held', 'Rejected'].includes(customsStatus) ? 'fail' : 'warn',
      detail: customsStatus,
    }
    : { label: 'Customs', state: crossBorder ? 'warn' : 'info', detail: crossBorder ? 'Cross-border movement with no customs declaration recorded' : 'Not applicable — no cross-border movement recorded' });

  checks.push(trade
    ? {
      label: `Import / export — ${str(trade.transaction_number)}`,
      state: 'pass',
      detail: `${str(trade.transaction_type) || 'Transaction'} · ${str(trade.incoterm) || 'no incoterm recorded'}`,
    }
    : { label: 'Import / export', state: 'info', detail: 'No import/export transaction recorded' });

  checks.push(shipment
    ? {
      label: `Shipment — ${str(shipment.shipment_number)}`,
      state: shipmentStatus === 'Delivered' ? 'pass' : shipmentStatus === 'Delayed' ? 'warn' : 'info',
      detail: shipmentStatus,
    }
    : { label: 'Shipment', state: 'warn', detail: 'No shipment raised against this transaction' });

  if (chain.claims.length > 0) {
    checks.push({
      label: 'Open claims',
      state: 'warn',
      detail: `${chain.claims.length} claim(s) raised against this transaction`,
    });
  }

  const failures = checks.filter((c) => c.state === 'fail').length;
  const warnings = checks.filter((c) => c.state === 'warn').length;
  const suggestedRisk = failures > 1 ? 'Critical' : failures === 1 ? 'High' : warnings > 0 ? 'Medium' : 'Low';

  return {
    checks,
    requiredDocuments,
    presentDocuments,
    missingDocuments,
    expiredDocuments,
    expiringDocuments,
    documentStatus,
    customsStatus,
    shipmentStatus,
    suggestedRisk,
    crossBorder,
  };
}