// FILE: admin/src/components/CurrencyManagementPage.tsx
// The module itself was reasonable — dated rate rows, history preserved by
// never overwriting. What was missing is that nothing read it: every other
// Trading module had a free-text currency field and no conversion anywhere.
// lib/currencyLookup.ts is the consumer side of this page; Logistics,
// Import/Export, Customs and Claims now source their currency dropdowns
// and exchange rates from these records.
//
// Each record is one exchange-rate entry for a currency pair, kept as its
// own row so historical rates are never overwritten — a new rate is a new
// record, not an edit to the old one. Transactions store the rate they
// were struck at, so changing a rate here never re-prices closed business.
import { useEffect, useState } from 'react';
import { TradingMasterPage, TradingModuleConfig, TradingRecord } from './TradingMasterPage';
import { api } from '../lib/api';
import { getBaseCurrency } from '../lib/currencyLookup';

const BASE_FLAGS = ['Yes', 'No'];
const STATUSES = ['Active', 'Upcoming', 'Expired'];

function rateStatus(r: Record<string, unknown>): string {
  const now = new Date();
  const from = r.effective_date ? new Date(r.effective_date as string) : null;
  const to = r.expiry_date ? new Date(r.expiry_date as string) : null;
  if (to && to < now) return 'Expired';
  if (from && from > now) return 'Upcoming';
  return 'Active';
}

/** Rate history for the pair being viewed — the point of keeping dated rows
 *  rather than editing one in place. Shown in the View modal so the audit
 *  trail is visible where it's relevant instead of buried in the list. */
function RateHistory({ record }: { record: TradingRecord }) {
  const [rows, setRows] = useState<TradingRecord[] | null>(null);
  const base = String(record.base_currency ?? '');
  const target = String(record.target_currency ?? '');

  useEffect(() => {
    if (!base || !target) { setRows([]); return; }
    let cancelled = false;
    api<{ data: TradingRecord[] }>('/trading/currency-rates')
      .then((res) => {
        if (cancelled) return;
        setRows((res.data ?? [])
          .filter((r) => r.base_currency === base && r.target_currency === target)
          .sort((a, b) => String(b.effective_date ?? '').localeCompare(String(a.effective_date ?? ''))));
      })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [base, target]);

  if (!base || !target) return null;

  return (
    <div style={{ margin: '1rem 0', padding: '0.9rem 1rem', border: '1px solid var(--line)', borderRadius: 10 }}>
      <p style={{ margin: '0 0 0.6rem', fontWeight: 700, fontSize: '.8rem', letterSpacing: '.02em' }}>
        Rate history — {base} → {target}
      </p>
      {rows === null ? (
        <p style={{ margin: 0, fontSize: '.85rem', opacity: 0.7 }}>Loading rate history…</p>
      ) : rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: '.85rem', opacity: 0.65 }}>No other rates recorded for this pair.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.3rem' }}>
          {rows.map((r) => (
            <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', fontSize: '.85rem' }}>
              <span>{r.effective_date ? String(r.effective_date) : 'undated'}{r.expiry_date ? ` → ${String(r.expiry_date)}` : ''}</span>
              <span>
                <strong>{String(r.exchange_rate ?? '—')}</strong>
                <span style={{ opacity: 0.7 }}> · {rateStatus(r)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const config: TradingModuleConfig = {
  resource: '/trading/currency-rates',
  eyebrowModule: 'CURRENCY MANAGEMENT',
  title: 'Currency management',
  description: 'Currencies and exchange rates used across deals, price lists, logistics, import/export, customs and claims. Each rate change is a new dated record — history is preserved and transactions keep the rate they were struck at.',
  icon: '＄',
  emptyIcon: '＄',
  // NEW
  codeField: 'currency_code',
  nameField: 'currency_name',
  statusOptions: STATUSES,
  // This page shows its own computed Status (Active/Upcoming/Expired,
  // derived from effective_date/expiry_date — the rate_status field
  // above), so the generic base Status column would just duplicate it
  // with a permanently empty badge. Hide the generic one.
  hideStatusColumn: true,
  searchableKeys: ['currency_code', 'currency_name', 'base_currency', 'target_currency', 'rate_source'],
  fields: [
    { key: 'currency_code', label: 'Currency code', type: 'text', required: true, listColumn: true, placeholder: 'e.g. INR' },
    { key: 'currency_name', label: 'Currency name', type: 'text', listColumn: true, placeholder: 'e.g. Indian Rupee' },
    { key: 'currency_symbol', label: 'Currency symbol', type: 'text', group: 'Currency' },
    { key: 'country_region', label: 'Country / region', type: 'text', group: 'Currency' },
    { key: 'decimal_places', label: 'Decimal places', type: 'number', group: 'Currency' },
    // Only one row may carry 'Yes' — the migration enforces it with a
    // partial unique index, so a second base currency is rejected by the
    // database rather than quietly breaking every conversion.
    { key: 'is_base_currency', label: 'Company base currency', type: 'select', options: BASE_FLAGS, listColumn: true, group: 'Currency' },
    {
      key: 'base_currency', label: 'From currency', type: 'text', listColumn: true, group: 'Exchange rate', placeholder: 'e.g. USD',
      // A pair is meaningless one-sided; default the from-side to the
      // currency being defined so the common case needs no thought.
      onValueChange: (v, f) => (!v && f.currency_code ? { base_currency: f.currency_code } : undefined),
    },
    { key: 'target_currency', label: 'To currency', type: 'text', listColumn: true, group: 'Exchange rate', placeholder: 'e.g. INR' },
    { key: 'exchange_rate', label: 'Exchange rate', type: 'number', listColumn: true, group: 'Exchange rate' },
    { key: 'effective_date', label: 'Effective from', type: 'date', group: 'Exchange rate' },
    { key: 'expiry_date', label: 'Effective to', type: 'date', group: 'Exchange rate' },
    { key: 'rate_source', label: 'Rate source', type: 'text', group: 'Exchange rate', placeholder: 'e.g. RBI reference rate' },
    {
      key: 'rate_status', label: 'Status', type: 'text', readOnly: true, listColumn: true,
      format: (_v, r) => rateStatus(r), group: 'Exchange rate',
    },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Exchange rate' },
  ],
  kpis: [
    {
      icon: '◆', iconClass: 'kpi-icon-ink', label: 'Company base currency',
      value: (r) => (r.length ? getBaseCurrency(r) : '—'),
      sub: (r) => (r.some((x) => String(x.is_base_currency).toLowerCase() === 'yes') ? 'Set' : 'Not set — defaulting to INR'),
    },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active exchange rates', value: (r) => String(r.filter((x) => rateStatus(x) === 'Active').length) },
    { icon: '◎', iconClass: 'kpi-icon-ink', label: 'Active currencies', value: (r) => String(new Set(r.filter((x) => rateStatus(x) === 'Active').map((x) => x.target_currency)).size) },
    {
      icon: '↗', iconClass: 'kpi-icon-amber', label: 'Updated in last 7 days',
      value: (r) => String(r.filter((x) => x.effective_date && (Date.now() - new Date(x.effective_date as string).getTime()) / 86400000 <= 7).length),
    },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Expired rates', value: (r) => String(r.filter((x) => rateStatus(x) === 'Expired').length) },
  ],
  detailExtra: (r) => <RateHistory record={r} />,

};

export function CurrencyManagementPage() {
  return <TradingMasterPage config={config} />;
}