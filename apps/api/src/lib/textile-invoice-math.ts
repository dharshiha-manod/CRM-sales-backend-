// Pure GST maths for Textile sales invoices (no database calls, unit-tested).
type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const isGstin = (v: unknown) => typeof v === 'string' && GSTIN.test(v.trim().toUpperCase());
const stateCodeOf = (g: unknown) => (typeof g === 'string' && /^\d{2}/.test(g.trim()) ? g.trim().slice(0, 2) : null);

/** true = same state (CGST + SGST), false = different state (IGST), null = cannot be decided from the data. */
export function isIntraState(seller: { gstin?: unknown; state?: unknown }, buyer: { gstin?: unknown; state?: unknown }): boolean | null {
  const a = stateCodeOf(seller.gstin); const b = stateCodeOf(buyer.gstin);
  if (a && b) return a === b;
  const s1 = typeof seller.state === 'string' ? seller.state.trim().toLowerCase() : '';
  const s2 = typeof buyer.state === 'string' ? buyer.state.trim().toLowerCase() : '';
  return s1 && s2 ? s1 === s2 : null;
}

export interface InvoiceLine {
  product_name: string; product_code: string; hsn_code: string | null; colour: string | null; quantity: number; free_quantity: number;
  rate: number; discount: number; taxable_value: number; gst_percent: number; cgst: number; sgst: number; igst: number; amount: number;
  roll_numbers: string[];
}

/** GST split of one line: taxable value is already after discount. Intra-state halves the tax (CGST + SGST), inter-state is all IGST. */
export function splitGst(taxable: number, gstPercent: number, intra: boolean) {
  const tax = r2((taxable * gstPercent) / 100);
  const cgst = intra ? r2(tax / 2) : 0;
  const sgst = intra ? r2(tax - cgst) : 0;
  const igst = intra ? 0 : tax;
  return { cgst, sgst, igst, tax };
}

export function invoiceTotals(lines: Pick<InvoiceLine, 'taxable_value' | 'cgst' | 'sgst' | 'igst'>[]) {
  const taxable = r2(lines.reduce((s, l) => s + l.taxable_value, 0));
  const cgst = r2(lines.reduce((s, l) => s + l.cgst, 0));
  const sgst = r2(lines.reduce((s, l) => s + l.sgst, 0));
  const igst = r2(lines.reduce((s, l) => s + l.igst, 0));
  const exact = taxable + cgst + sgst + igst;
  const total = Math.round(exact);
  return { taxable_amount: taxable, cgst_amount: cgst, sgst_amount: sgst, igst_amount: igst, round_off: r2(total - exact), total_amount: total };
}

export { num, r2 };
export type { Row };
