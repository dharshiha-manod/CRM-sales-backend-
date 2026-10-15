// FILE: admin/src/lib/currencyFormat.ts
// ONE place that decides how a money amount is written, so no page ever hard-codes "₹" again.
// Rule: an amount is always written in ITS OWN currency (PKR 11,025 / $500 / AED 1,200 / ₹300). When the company currency is
// different and a rate is known, " (≈ ₹3,307.5)" is added. Works for every currency code, not a fixed list.
import { findRate, getBaseCurrency, getCachedCurrencyRates, loadCurrencyRates } from './currencyLookup';

type Row = Record<string, unknown>;
const codeOf = (value: unknown): string => String(value ?? '').trim().toUpperCase();

/** Company currency (from Currency Management); INR until rates are loaded. */
export function companyCurrency(): string { return getBaseCurrency(getCachedCurrencyRates()); }

/** 11025, 'PKR' -> "PKR 11,025";  300, 'INR' -> "₹300";  50, 'USD' -> "$50". Empty code = company currency. */
export function formatMoney(amount: unknown, currency?: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const code = codeOf(currency) || companyCurrency();
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${code} ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
}

function warmRates() { if (getCachedCurrencyRates().length === 0) void loadCurrencyRates().catch(() => undefined); }

/** Rate from `code` to the company currency; 1 when equal; null when no rate is known yet. */
function toCompany(code: string): number | null {
  const rows = getCachedCurrencyRates();
  const base = getBaseCurrency(rows);
  if (!code || code === base) return 1;
  return findRate(rows, code, base);
}

/** "PKR 11,025 (≈ ₹3,307.5)" for a foreign amount, plain "₹300" for a company-currency one. */
export function formatMoneyWithBase(amount: unknown, currency?: unknown): string {
  warmRates();
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const code = codeOf(currency) || companyCurrency();
  const own = formatMoney(n, code);
  const rate = toCompany(code);
  if (rate == null || code === companyCurrency()) return own;
  return `${own} (≈ ${formatMoney(n * rate, companyCurrency())})`;
}

/** Total of many rows that may be in different currencies, e.g. "PKR 11,025 + $500 (≈ ₹45,000)". Never adds PKR to dollars. */
export function sumMoneyWithBase(rows: Row[], amountOf: (row: Row) => number): string {
  warmRates();
  const byCode = new Map<string, number>();
  for (const row of rows) {
    const amount = amountOf(row);
    if (!Number.isFinite(amount)) continue;
    const code = codeOf(row.currency) || companyCurrency();
    byCode.set(code, (byCode.get(code) ?? 0) + amount);
  }
  if (byCode.size === 0) return formatMoney(0, companyCurrency());
  const own = [...byCode].map(([code, total]) => formatMoney(total, code)).join(' + ');
  const base = companyCurrency();
  if (byCode.size === 1 && byCode.has(base)) return own;
  let converted = 0; let missing = 0;
  for (const [code, total] of byCode) { const rate = toCompany(code); if (rate == null) missing += 1; else converted += total * rate; }
  if (missing > 0) return `${own} (no rate yet for ${missing} of these)`;
  return `${own} (≈ ${formatMoney(converted, base)})`;
}

/** 'USD' -> "$", 'INR' -> "₹", 'PKR' -> "PKR" (no short symbol). Empty/unknown code -> "". */
export function currencySymbol(currency?: unknown): string {
  const code = codeOf(currency);
  if (!code) return '';
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((x) => x.type === 'currency');
    return part?.value ?? code;
  } catch { return code; }
}

/** ' (USD $)' style suffix for form labels; '' until a currency is chosen. */
export function currencyLabelSuffix(currency?: unknown): string {
  const code = codeOf(currency);
  if (!code) return '';
  const sym = currencySymbol(code);
  return sym && sym !== code ? ` (${code} ${sym})` : ` (${code})`;
}