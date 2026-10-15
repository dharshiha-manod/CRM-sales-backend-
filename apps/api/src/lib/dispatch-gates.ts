// Dispatch gates: the checks a professional export flow does BEFORE a shipment is allowed to leave.
//   1. Documents  - Commercial Invoice and Packing List must be Verified (not Draft).
//   2. Customs    - export customs clearance must be Cleared.
//   3. Payment    - when the deal is backed by an LC or an advance, the LC must be issued / the advance received.
// Pure functions only (no database): the repository loads the rows, these decide what is wrong, in plain words.
type Row = Record<string, unknown>;

const text = (v: unknown): string => (v == null ? '' : String(v).trim());
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Documents that must be Verified before goods leave. */
export const GATED_DOCUMENT_TYPES = ['Commercial Invoice', 'Packing List'];

export const isVerifiedDocument = (d: Row): boolean => text(d.status) === 'Verified' || text(d.verification_status) === 'Verified';

export function documentProblems(docs: Row[], required: string[] = GATED_DOCUMENT_TYPES): string[] {
  const problems: string[] = [];
  for (const type of required) {
    const usable = docs.filter((d) => text(d.document_type) === type && !['Rejected', 'Expired'].includes(text(d.status)) && text(d.verification_status) !== 'Rejected');
    if (usable.length === 0) { problems.push(`${type} is missing`); continue; }
    if (usable.some(isVerifiedDocument)) continue;
    const doc = usable[0];
    problems.push(`${type} ${text(doc.document_number)} must be Verified (it is ${text(doc.status) || 'Draft'}) - attach the file, submit it and approve it in Trade Documents`.replace('  ', ' '));
  }
  return problems;
}

export function customsProblems(rows: Row[]): string[] {
  return rows
    .filter((r) => text(r.clearance_status) !== 'Cleared' && text(r.status) !== 'Cancelled')
    .map((r) => `Export customs ${text(r.customs_reference)} is "${text(r.clearance_status) || 'Not Started'}" - it must be Cleared in Customs & Clearance`.replace('  ', ' '));
}

/** Statuses of an LC where the bank has actually issued it. */
const LC_ISSUED = new Set(['Issued', 'Advised', 'Accepted', 'Documents Submitted', 'Under Review', 'Discrepancy', 'Payment Pending', 'Paid', 'Closed']);
const FINANCE_INACTIVE = new Set(['Cancelled', 'Expired']);

/** Advance still owed by the customer, or null when it cannot be worked out. */
function advanceRequired(r: Row): number | null {
  const amount = num(r.advance_amount);
  if (amount > 0) return amount;
  const percent = num(r.advance_percent);
  const value = num(r.transaction_value);
  return percent > 0 && value > 0 ? (percent / 100) * value : null;
}

export function paymentProblems(finance: Row[]): string[] {
  const problems: string[] = [];
  for (const r of finance) {
    if (FINANCE_INACTIVE.has(text(r.status))) continue;
    const instrument = text(r.instrument_type);
    const ref = text(r.lc_number) || text(r.finance_reference);
    if (instrument === 'Letter of Credit' && !LC_ISSUED.has(text(r.status))) {
      problems.push(`Letter of Credit ${ref} is still "${text(r.status) || 'Draft'}" - wait until the bank has Issued it`);
    }
    if (instrument === 'Advance Payment') {
      const needed = advanceRequired(r);
      const got = num(r.collected_amount);
      const paid = text(r.payment_status) === 'Paid' || (needed != null ? got + 0.005 >= needed : got > 0);
      if (!paid) problems.push(needed != null ? `Advance payment not received yet (received ${got} of ${Number(needed.toFixed(2))}) - ${ref}` : `Advance payment not received yet - ${ref}`);
    }
  }
  return problems;
}

export function dispatchBlockMessage(shipmentNumber: string, problems: string[]): string {
  return `Shipment ${shipmentNumber} cannot be dispatched yet. ${problems.map((p, i) => `${i + 1}) ${p}.`).join(' ')}`;
}