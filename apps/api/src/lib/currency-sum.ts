// Adds up an amount column across records that may each be in a DIFFERENT currency, and returns the total in ONE
// currency (the currency of the report it goes into).
//
// Why this exists: Logistics and Customs rows are saved in the currency they were paid in (e.g. USD 5,000) and also
// store the rate used and the company currency. A profit report is in one currency (the deal's). Adding the raw
// numbers together mixes USD and INR - USD 5,000 counted as INR 5,000 instead of INR 482,500.
type Row = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One row's amount, expressed in `currency`. Returns null when the row has no amount in that column. */
export function amountInCurrency(row: Row, key: string, currency: string): number | null {
  const value = num(row[key]);
  if (value === null) return null;
  const own = String(row.currency ?? '').trim();
  if (!own || own === currency) return value;                      // already in the report currency
  const rate = num(row.exchange_rate);
  if (rate !== null && rate > 0 && String(row.base_currency ?? '').trim() === currency) {
    // Logistics freight also stores its converted value (base_value); the Logistics page shows that number, so use it.
    const base = key === 'freight_cost' ? num(row.base_value) : null;
    return base !== null && base > 0 ? base : value * rate;
  }
  return value;                                                     // no stored rate to that currency: keep as entered
}

/** Sum of `key` over all rows, in `currency`. Null when no row has a value. */
export function sumInCurrency(rows: Row[], key: string, currency: string): number | null {
  const parts = rows.map((r) => amountInCurrency(r, key, currency)).filter((n): n is number => n !== null);
  if (parts.length === 0) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
}