// Turns the free-text "Payment terms" on a Deal ("Net 30", "45 days", "100% advance") into a due date for the
// customer invoice. Pure functions, no database. A term that cannot be read gives null: a due date is never invented.

/** Number of days after the invoice date that payment is due, or null when the text does not say. */
export function daysFromPaymentTerms(terms: unknown): number | null {
  const t = String(terms ?? '').trim().toLowerCase();
  if (!t) return null;
  const match = t.match(/(\d{1,3})\s*(?:calendar\s*)?days?\b/) ?? t.match(/\bnet\s*-?\s*(\d{1,3})\b/) ?? t.match(/\b(\d{1,3})\s*d\b/);
  if (match) {
    const days = Number(match[1]);
    return days >= 0 && days <= 365 ? days : null;
  }
  if (/advance|prepaid|upfront|cash|\bcod\b|immediate|on delivery/.test(t)) return 0;
  return null;
}

/** YYYY-MM-DD plus a number of days, as YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Invoice due date from the invoice date and the Deal's payment terms (null when the terms give no days). */
export function dueDateFromTerms(invoiceDate: string, terms: unknown): string | null {
  const days = daysFromPaymentTerms(terms);
  return days === null ? null : addDays(invoiceDate, days);
}