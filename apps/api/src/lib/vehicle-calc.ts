// Pure helpers for the Vehicle module (no database): easy to test.
type Row = Record<string, unknown>;
const has = (v: unknown) => v !== null && v !== undefined && v !== '';
const num = (v: unknown) => (has(v) ? Number(String(v).replace(/[₹,\s]/g, '')) || 0 : 0);

/** "BRK-001 x 2" / "BRK-001 * 2" / "BRK-001 2" / "BRK-001" (one per line or comma separated) -> [{ code, qty }]. Same code twice is added up. */
export function parsePartsUsed(text: unknown): { code: string; qty: number }[] {
  const out = new Map<string, number>();
  for (const raw of String(text ?? '').split(/[\n;]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._\/-]*)\s*(?:[x×*]\s*|\s+)?(\d+(?:\.\d+)?)?\s*$/.exec(line);
    if (!m) continue;
    const qty = m[2] ? Number(m[2]) : 1;
    if (qty > 0) out.set(m[1]!, (out.get(m[1]!) ?? 0) + qty);
  }
  return [...out].map(([code, qty]) => ({ code, qty }));
}

/** A labour amount typed as text ("1500", "₹1,500", "1500 for labour") -> number (0 when none). */
export function parseLabourAmount(text: unknown): number {
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(String(text ?? ''));
  return m ? Number((m[1] ?? '').replace(/,/g, '')) || 0 : 0;
}

/** Money value of a scheme against an order total: cash discount + exchange bonus + fixed / percentage discount, never more than the total. */
export function schemeCredit(scheme: Row, orderTotal: number): number {
  if (['Suspended', 'Draft'].includes(String(scheme.status))) return 0;
  let credit = num(scheme.cash_discount) + num(scheme.exchange_bonus);
  if (scheme.discount_type === 'Percentage') credit += (orderTotal * num(scheme.discount_value)) / 100;
  else if (scheme.discount_type === 'Fixed Amount') credit += num(scheme.discount_value);
  return Math.max(0, Math.min(credit, orderTotal));
}

/** The delivery stage follows what is still missing: PDI, then documents, then payment. */
export function stageFor(m: Row): string {
  if (!has(m.vin)) return 'Preparation';
  if (m.pdi_status !== 'Passed') return 'PDI Pending';
  if (m.documentation_status !== 'Complete') return 'Documentation Pending';
  if (m.payment_status !== 'Complete') return 'Payment Pending';
  return 'Ready for Delivery';
}
