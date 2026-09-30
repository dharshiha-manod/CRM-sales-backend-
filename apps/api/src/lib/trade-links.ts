// Links between Import/Export, Customs, Shipment and Compliance.
//
// Everything in this file is a PURE function (no database, no network), so it is easy to test and
// easy to reason about. The repository calls these to decide "what should the other record become?".
//
// Rules that apply everywhere:
//   - Statuses only move FORWARD. A later save never drags a record back to an earlier stage.
//   - Finished / cancelled records are left alone.
//   - Nothing is invented: a missing value stays missing.

type Row = Record<string, unknown>;

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

// ---------------------------------------------------------------------------
// Import / Export status
// ---------------------------------------------------------------------------

/** Order of an Import/Export transaction's life. A higher number is later. */
const TRANSACTION_RANK: Record<string, number> = {
  Draft: 0,
  'Documentation Pending': 1,
  'Ready for Shipment': 2,
  Shipped: 3,
  'In Transit': 4,
  'Customs Pending': 5,
  'Customs Clearance': 6,
  Cleared: 7,
  Delivered: 8,
  Completed: 9,
};

/** A transaction in one of these statuses is never moved automatically. */
const TRANSACTION_FROZEN = ['Completed', 'Cancelled'];

/** What each Customs clearance status means for the transaction it belongs to. */
const CUSTOMS_TO_TRANSACTION: Record<string, string> = {
  'Documentation Pending': 'Customs Pending',
  'Declaration Submitted': 'Customs Clearance',
  'Under Review': 'Customs Clearance',
  'Inspection Required': 'Customs Clearance',
  'Duty Pending': 'Customs Clearance',
  'Duty Paid': 'Customs Clearance',
  Cleared: 'Cleared',
  // Held / Rejected and Not Started deliberately absent: they do not move the transaction.
};

/** What each Shipment status means for the transaction that carries it. */
const SHIPMENT_TO_TRANSACTION: Record<string, string> = {
  'Ready to Ship': 'Ready for Shipment',
  Dispatched: 'Shipped',
  'In Transit': 'In Transit',
  'At Destination': 'Customs Pending', // arrived at the destination port, now waiting for customs
  Delivered: 'Delivered',
};

function forward(current: string, target: string | undefined): string | null {
  if (!target || current === target || TRANSACTION_FROZEN.includes(current)) return null;
  const from = TRANSACTION_RANK[current];
  const to = TRANSACTION_RANK[target];
  if (to === undefined) return null;
  // An unknown / blank current status counts as "before everything".
  return to > (from ?? -1) ? target : null;
}

/** New transaction status after customs changed, or null when nothing should change. */
export const nextTransactionStatusFromCustoms = (currentTransactionStatus: string, clearanceStatus: string) =>
  forward(text(currentTransactionStatus), CUSTOMS_TO_TRANSACTION[text(clearanceStatus)]);

/** New transaction status after its shipment changed, or null when nothing should change. */
export const nextTransactionStatusFromShipment = (currentTransactionStatus: string, shipmentStatus: string) =>
  forward(text(currentTransactionStatus), SHIPMENT_TO_TRANSACTION[text(shipmentStatus)]);

// ---------------------------------------------------------------------------
// Customs
// ---------------------------------------------------------------------------

/** Builds the Customs record that goes with a new Import/Export transaction. Values are copied, never typed twice. */
export function customsFromTransaction(txn: Row, customsReference: string): Row {
  return {
    customs_reference: customsReference,
    transaction_number: txn.transaction_number ?? null,
    transaction_type: txn.transaction_type ?? null,
    shipment_number: txn.shipment_number ?? null,
    customer_name: txn.customer_name ?? null,
    supplier_name: txn.supplier_name ?? null,
    product_name: txn.product_name ?? null,
    quantity: txn.quantity ?? null,
    country_of_origin: txn.country_of_origin ?? null,
    destination_country: txn.destination_country ?? null,
    port_of_loading: txn.port_of_loading ?? null,
    port_of_discharge: txn.port_of_discharge ?? null,
    declared_value: txn.total_value ?? null,
    currency: txn.currency ?? null,
    exchange_rate: txn.exchange_rate ?? null,
    base_currency: txn.base_currency ?? null,
    base_value: txn.base_value ?? null,
    required_documents: txn.required_documents ?? null,
    clearance_status: 'Not Started',
    status: 'Not Started',
    notes: `Automatically created from ${text(txn.transaction_number)}.`,
  };
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

const BASE_DOCS = ['Commercial Invoice', 'Packing List'];
const CROSS_BORDER_DOCS = ['Bill of Lading', 'Certificate of Origin', 'Insurance Certificate'];

export interface ComplianceInputs {
  transactions: Row[];
  customs: Row[];
  shipments: Row[];
  documents: Row[];
  claims: Row[];
}

export interface ComplianceSnapshot {
  required_documents: string;
  missing_documents: string;
  expired_documents: string;
  document_status: string;
  customs_status: string;
  shipment_status: string;
  suggested_risk: string;
  /** The status an OPEN check should show: Failed while paperwork is missing or expired, otherwise Pending Review. Never "Passed". */
  suggested_status: string;
}

const daysUntil = (value: unknown): number | null => {
  const raw = text(value);
  if (!raw) return null;
  const days = (new Date(raw).getTime() - Date.now()) / 86400000;
  return Number.isFinite(days) ? Math.floor(days) : null;
};

/** Same logic as the screen's buildComplianceReport (admin/src/lib/complianceChecks.ts), so the saved snapshot and the live checklist agree. */
export function buildComplianceSnapshot(input: ComplianceInputs): ComplianceSnapshot {
  const trade = input.transactions[0];
  const customs = input.customs[0];
  const shipment = input.shipments[0];
  const crossBorder = Boolean(trade) || Boolean(customs);

  const declared = text(trade?.required_documents ?? customs?.required_documents)
    .split(',').map((s) => s.trim()).filter(Boolean);
  const required = declared.length ? declared : [...BASE_DOCS, ...(crossBorder ? CROSS_BORDER_DOCS : [])];

  const usable = input.documents.filter((d) => text(d.status) !== 'Rejected' && text(d.verification_status) !== 'Rejected');
  const present = new Set(usable.map((d) => text(d.document_type)).filter(Boolean));
  const has = (want: string) => usable.some((d) => text(d.document_type) === want || text(d.document_number) === want);
  const missing = required.filter((want) => !has(want));

  const expired: string[] = [];
  const expiring: string[] = [];
  for (const d of usable) {
    const days = daysUntil(d.expiry_date);
    if (days === null) continue;
    const label = text(d.document_type) || text(d.document_number);
    if (days < 0) expired.push(label);
    else if (days <= 30) expiring.push(`${label} (${days}d)`);
  }

  const documentStatus = present.size === 0 ? 'Missing' : missing.length > 0 || expired.length > 0 ? 'Incomplete' : 'Complete';
  const customsStatus = customs ? (text(customs.clearance_status) || 'Not Started') : 'No customs record';
  const shipmentStatus = shipment ? (text(shipment.status) || 'No status') : 'No shipment raised';

  // Risk: count failures and warnings the same way the on-screen checklist does.
  let failures = missing.length + expired.length;
  let warnings = expiring.length + (input.claims.length > 0 ? 1 : 0);
  if (customs) {
    if (['Held', 'Rejected'].includes(customsStatus)) failures += 1;
    else if (!['Cleared', 'Duty Paid'].includes(customsStatus)) warnings += 1;
  } else if (crossBorder) warnings += 1;
  if (!shipment) warnings += 1;
  else if (shipmentStatus === 'Delayed') warnings += 1;

  const suggestedRisk = failures > 1 ? 'Critical' : failures === 1 ? 'High' : warnings > 0 ? 'Medium' : 'Low';

  return {
    required_documents: required.join(', '),
    missing_documents: missing.join(', '),
    expired_documents: [...expired, ...expiring].join(', '),
    document_status: documentStatus,
    customs_status: customsStatus,
    shipment_status: shipmentStatus,
    suggested_risk: suggestedRisk,
    suggested_status: missing.length > 0 || expired.length > 0 ? 'Failed' : 'Pending Review',
  };
}

/** Statuses where a person has not yet signed the check off, so the system may keep the detected position fresh. */
export const OPEN_COMPLIANCE_STATUSES = ['', 'Not Checked', 'Pending Review', 'Failed'];

/** Compliance type that fits a transaction. */
export const complianceTypeFor = (transactionType: unknown): string =>
  text(transactionType) === 'Import' ? 'Import Compliance' : text(transactionType) === 'Export' ? 'Export Compliance' : 'Shipment Compliance';

// ---------------------------------------------------------------------------
// Reference numbers
// ---------------------------------------------------------------------------

/** Next free "<PREFIX>-<year>-<0001>" given the references that already exist. */
export function nextReference(prefix: string, existing: unknown[], year = new Date().getFullYear()): string {
  const head = `${prefix}-${year}-`;
  let max = 0;
  for (const value of existing) {
    const ref = text(value);
    if (!ref.startsWith(head)) continue;
    const n = Number(ref.slice(head.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${head}${String(max + 1).padStart(4, '0')}`;
}