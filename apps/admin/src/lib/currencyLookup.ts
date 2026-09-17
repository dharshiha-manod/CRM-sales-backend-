// FILE: admin/src/lib/currencyLookup.ts
// Makes Currency Management actually do something. Before this, the module
// stored rates and nothing ever read them — every other Trading module had
// a free-text `currency` field the user typed by hand and converted in
// their head.
//
// Same shape and same reasoning as priceListLookup.ts: one shared function
// the module configs call from `onLookupChange` / `onValueChange`, never
// duplicated per page. Conversion is a convenience — if a rate can't be
// found, nothing is overwritten and the user's own figures stand.
import { api } from './api';

export interface CurrencyRate extends Record<string, unknown> {
  currency_code?: string;
  is_base_currency?: string;
  base_currency?: string;
  target_currency?: string;
  exchange_rate?: number | string;
  effective_date?: string;
  expiry_date?: string;
}

/** Same "is this rate in force" rule the Currency Management page shows as its Status column. */
export function isRateActive(r: CurrencyRate, on: Date = new Date()): boolean {
  const from = r.effective_date ? new Date(r.effective_date) : null;
  const to = r.expiry_date ? new Date(r.expiry_date) : null;
  if (to && to < on) return false;
  if (from && from > on) return false;
  return true;
}

/**
 * The company's own currency — the one every transaction is ultimately
 * reported in. Taken from the row flagged `is_base_currency = 'Yes'`
 * (the migration enforces there can only be one per industry). Falls back
 * to INR so a half-configured Currency module degrades to the previous
 * behaviour rather than breaking saves.
 */
export function getBaseCurrency(rows: CurrencyRate[]): string {
  const flagged = rows.find((r) => String(r.is_base_currency).toLowerCase() === 'yes');
  return String(flagged?.currency_code ?? 'INR');
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 && v !== '' && v != null ? n : null;
};

/**
 * Resolves the rate to convert `from` -> `to` as of `on`, trying, in order:
 *   1. same currency          -> 1
 *   2. a direct active rate   (from -> to)
 *   3. the inverse rate       (to -> from, reciprocated)
 *   4. triangulation via the base currency (from -> base -> to)
 * Within each step the most recently effective rate wins, so a newly added
 * rate supersedes an older one without anybody having to expire the old row.
 * Returns null when no path exists — callers leave the form untouched.
 */
export function findRate(rows: CurrencyRate[], from: string, to: string, on: Date = new Date()): number | null {
  if (!from || !to) return null;
  if (from === to) return 1;

  const active = rows
    .filter((r) => isRateActive(r, on) && num(r.exchange_rate) != null)
    .sort((a, b) => String(b.effective_date ?? '').localeCompare(String(a.effective_date ?? '')));

  const direct = active.find((r) => r.base_currency === from && r.target_currency === to);
  if (direct) return num(direct.exchange_rate);

  const inverse = active.find((r) => r.base_currency === to && r.target_currency === from);
  if (inverse) {
    const rate = num(inverse.exchange_rate);
    return rate ? 1 / rate : null;
  }

  const base = getBaseCurrency(rows);
  if (base && base !== from && base !== to) {
    const toBase = findRate(active, from, base, on);
    const fromBase = findRate(active, base, to, on);
    if (toBase != null && fromBase != null) return toBase * fromBase;
  }
  return null;
}

/** Cached because several fields on one form can trigger a conversion in quick succession. */
let cache: { rows: CurrencyRate[]; at: number } | null = null;
const CACHE_MS = 60_000;

export async function loadCurrencyRates(force = false): Promise<CurrencyRate[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const res = await api<{ data: CurrencyRate[] }>('/trading/currency-rates');
  cache = { rows: res.data ?? [], at: Date.now() };
  return cache.rows;
}

/** Currency options for a form's currency dropdown, sourced from Currency Management. */
export async function listCurrencyCodes(): Promise<string[]> {
  try {
    const rows = await loadCurrencyRates();
    const codes = new Set<string>();
    for (const r of rows) {
      for (const v of [r.currency_code, r.base_currency, r.target_currency]) {
        if (v) codes.add(String(v));
      }
    }
    return [...codes].sort();
  } catch {
    return [];
  }
}

export interface ConversionTarget {
  /** form field holding the transaction amount, e.g. 'total_value' */
  amount: string;
  /** form field holding the transaction currency, e.g. 'currency' */
  currency: string;
  /** form field to write the resolved rate into */
  rate?: string;
  /** form field to write the company/base currency code into */
  baseCurrency?: string;
  /** form field to write the converted (base-currency) amount into */
  baseValue?: string;
  /** form field holding the date the rate should be read as of, e.g. 'declaration_date' */
  onDateField?: string;
}

/**
 * Fills the rate / base-currency / converted-value fields from the current
 * amount + currency on the form. Stored rather than recomputed on render,
 * so a historical record keeps the rate it was actually transacted at
 * instead of silently re-pricing itself every time somebody opens it —
 * which is the whole reason Currency Management keeps dated history.
 *
 * Call from a field's `onValueChange` (amount or currency changing) or after
 * a lookup autofill has populated them.
 */
export async function applyCurrencyConversion(
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
  target: ConversionTarget,
): Promise<void> {
  let rows: CurrencyRate[];
  try {
    rows = await loadCurrencyRates();
  } catch {
    return; // conversion is a convenience — never block the user's save
  }
  if (!rows.length) return;

  setForm((prev) => {
    const currency = prev[target.currency];
    const amount = Number(prev[target.amount]);
    if (!currency) return prev;

    const base = getBaseCurrency(rows);
    const on = target.onDateField && prev[target.onDateField] ? new Date(prev[target.onDateField]) : new Date();
    const rate = findRate(rows, currency, base, on);
    if (rate == null) return prev;

    const next = { ...prev };
    if (target.baseCurrency) next[target.baseCurrency] = base;
    if (target.rate) next[target.rate] = String(Number(rate.toFixed(6)));
    if (target.baseValue && Number.isFinite(amount) && prev[target.amount] !== '') {
      next[target.baseValue] = String(Number((amount * rate).toFixed(2)));
    }
    return next;
  });
}

/** Display helper for read-only "converted value" columns in list/detail views. */
export function formatConverted(record: Record<string, unknown>): string {
  const value = record.base_value;
  const currency = record.base_currency;
  if (value == null || value === '') return '—';
  return `${currency ? `${currency} ` : ''}${Number(value).toLocaleString()}`;
}