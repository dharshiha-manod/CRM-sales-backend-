// FILE: admin/src/components/FmcgCurrencyRatesPage.tsx
import { CSSProperties, FormEvent, useEffect, useId, useState } from 'react';
import { api } from '../lib/api';
import { CURRENCIES } from '../lib/markets';
import './MasterDataPages.css';

type Rate = { id: string; currency_code: string; rate_to_inr: number; effective_from: string; created_at: string };
const today = () => new Date().toISOString().slice(0, 10);
const currencyNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'currency' }); } catch { return null; } })();
const nameOf = (code: string) => currencyNames?.of(code) ?? code;
const labelOf = (code: string) => `${code} — ${nameOf(code)}`;
const ADDABLE = CURRENCIES.filter((c) => c !== 'INR');
/** 'usd', 'USD' or 'USD — US Dollar' -> 'USD' when it is a currency we support, otherwise null. */
const parseCurrency = (text: string): string | null => { const code = text.trim().slice(0, 3).toUpperCase(); return ADDABLE.includes(code) && (text.trim().length === 3 || /^[A-Za-z]{3}\s*—/.test(text.trim())) ? code : null; };

export function FmcgCurrencyRatesPage() {
  const [rows, setRows] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [currencyText, setCurrencyText] = useState(labelOf('USD'));
  const listId = useId();
  const [form, setForm] = useState({ currencyCode: 'USD', rateToInr: '', effectiveFrom: today() });

  const load = () => {
    setLoading(true);
    api<{ data: Rate[] }>('/fmcg/currency-rates')
      .then((res) => { setRows(res.data ?? []); setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const current = new Map<string, Rate>();
  for (const r of rows) if (r.effective_from <= today() && !current.has(r.currency_code)) current.set(r.currency_code, r);

  // ---- Currency converter (same layout as Trading; uses this industry's own dated rates, INR is the base = 1) ----
  const [convAmount, setConvAmount] = useState('1000');
  const [convFrom, setConvFrom] = useState('USD');
  const [convTo, setConvTo] = useState('INR');
  const [convAsOf, setConvAsOf] = useState(today());
  const convCodes = ['INR', ...[...new Set(rows.map((r) => r.currency_code))].sort()];
  // Newest rate whose effective date is on or before the chosen date; INR is always 1.
  const inrPer = (code: string): number | null => {
    if (code === 'INR') return 1;
    const hit = rows.filter((r) => r.currency_code === code && r.effective_from <= convAsOf).sort((x, y) => (x.effective_from < y.effective_from ? 1 : x.effective_from > y.effective_from ? -1 : (x.created_at < y.created_at ? 1 : -1)))[0];
    return hit ? Number(hit.rate_to_inr) : null;
  };
  const fromRate = inrPer(convFrom);
  const toRate = inrPer(convTo);
  const crossRate = fromRate && toRate ? fromRate / toRate : null;
  const amountNum = Number(convAmount);
  const converted = crossRate !== null && convAmount.trim() !== '' && Number.isFinite(amountNum) ? amountNum * crossRate : null;
  const money = (n: number, code: string) => {
    try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(n); }
    catch { return `${code} ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`; }
  };
  const convBox: CSSProperties = { padding: '0.5rem 0.6rem', border: '1px solid var(--line)', borderRadius: 8, font: 'inherit', background: 'transparent', minWidth: 0 };
  const convLabel: CSSProperties = { display: 'grid', gap: 4, fontSize: '.72rem', fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', opacity: 0.75 };

  const remove = async (rate: Rate) => {
    if (!window.confirm(`Delete the ${rate.currency_code} rate ${rate.rate_to_inr} (from ${rate.effective_from})? Existing quotations and orders keep the rate they already used.`)) return;
    try { await api(`/fmcg/currency-rates/${rate.id}`, { method: 'DELETE' }); load(); } catch (err) { setError((err as Error).message); }
  };

  const q = search.trim().toLowerCase();
  const visibleRows = q ? rows.filter((r) => `${r.currency_code} ${nameOf(r.currency_code)}`.toLowerCase().includes(q)) : rows;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ADDABLE.includes(form.currencyCode)) { setError('Pick a currency from the list.'); return; }
    setSaving(true);
    try {
      await api('/fmcg/currency-rates', { method: 'POST', body: JSON.stringify({ currencyCode: form.currencyCode, rateToInr: Number(form.rateToInr), effectiveFrom: form.effectiveFrom }) });
      setModal(false);
      setForm({ currencyCode: 'USD', rateToInr: '', effectiveFrom: today() });
      setCurrencyText(labelOf('USD'));
      load();
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">FMCG · CURRENCY RATES</p>
          <h2>Currency rates</h2>
          <p>Exchange rates for international clients. Home currency is INR (India). A quotation for a foreign client uses the newest rate in force today; without a rate it cannot be created.</p>
        </div>
      </div>
      <div className="kpi-grid">
        {[...current.values()].map((r) => (
          <div className="kpi-card" data-tone="blue" key={r.currency_code}>
            <div className="kpi-icon">¤</div>
            <div><span>{r.currency_code} → INR · {nameOf(r.currency_code)}</span><strong>{Number(r.rate_to_inr).toLocaleString('en-IN', { maximumFractionDigits: 4 })}</strong><small>since {r.effective_from}</small></div>
          </div>
        ))}
      </div>
      <div style={{ margin: '0 0 1rem', padding: '1rem 1.2rem', border: '1px solid var(--line)', borderRadius: 14 }}>
        <p style={{ margin: '0 0 0.7rem', fontWeight: 700 }}>Currency converter</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'end' }}>
          <label style={convLabel}>Amount<input style={convBox} type="number" min="0" step="any" value={convAmount} onChange={(e) => setConvAmount(e.target.value)} /></label>
          <label style={convLabel}>From
            <select style={convBox} value={convFrom} onChange={(e) => setConvFrom(e.target.value)}>{convCodes.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
          <label style={convLabel}>To
            <select style={convBox} value={convTo} onChange={(e) => setConvTo(e.target.value)}>{convCodes.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
          <label style={convLabel}>Rate as of<input style={convBox} type="date" value={convAsOf} onChange={(e) => setConvAsOf(e.target.value)} /></label>
        </div>
        <p style={{ margin: '0.8rem 0 0', fontSize: '1rem' }}>
          {converted !== null && crossRate !== null ? (
            <>
              {money(amountNum, convFrom)} × <strong>{Number(crossRate.toFixed(6))}</strong> = <strong>{money(converted, convTo)}</strong>
            </>
          ) : (
            <span style={{ opacity: 0.7 }}>{loading ? 'Loading rates…' : `No exchange rate found for ${convFrom} → ${convTo} on this date. Add one below.`}</span>
          )}
        </p>
      </div>
      <div className="master-toolbar">
        <div className="master-search">
          <input type="search" placeholder="Search currency — e.g. USD, Dollar, Euro…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="primary-action" type="button" onClick={() => setModal(true)}>+ Add rate</button>
      </div>
      {error && <p className="error-message">{error}</p>}
      <div className="data-table-wrap">
        <table>
          <thead><tr><th>Currency</th><th>1 unit = INR</th><th>Effective from</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={5}>No rates yet. Add one (for example USD) to quote international clients.</td></tr>
              : visibleRows.length === 0 ? <tr><td colSpan={5}>No currency matches "{search}".</td></tr>
              : visibleRows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.currency_code}</strong> <small className="lead-code">{nameOf(r.currency_code)}</small></td>
                  <td>{Number(r.rate_to_inr).toLocaleString('en-IN', { maximumFractionDigits: 4 })}</td>
                  <td>{r.effective_from}</td>
                  <td><span className={current.get(r.currency_code)?.id === r.id ? 'status-badge status-completed' : r.effective_from > today() ? 'status-badge status-pending' : 'status-badge inactive'}>{current.get(r.currency_code)?.id === r.id ? 'In force' : r.effective_from > today() ? 'Upcoming' : 'Superseded'}</span></td>
                  <td><button className="quiet-button" type="button" style={{ color: '#b42318' }} onClick={() => void remove(r)}>Delete</button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setModal(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">CURRENCY RATE</p><h3>Add rate</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={submit}>
              <label>Currency
                <input
                  list={listId}
                  value={currencyText}
                  placeholder="Type to search — e.g. USD, Dollar, Dirham"
                  // Clear on focus so the browser lists EVERY currency (it filters the list by what is typed); restore on blur.
                  onFocus={() => setCurrencyText('')}
                  onChange={(e) => { setCurrencyText(e.target.value); const code = parseCurrency(e.target.value); if (code) setForm({ ...form, currencyCode: code }); }}
                  onBlur={() => setCurrencyText(form.currencyCode ? labelOf(form.currencyCode) : '')}
                  required
                />
                <datalist id={listId}>
                  {ADDABLE.map((c) => <option key={c} value={labelOf(c)} />)}
                </datalist>
              </label>
              <label>1 {form.currencyCode || 'unit'} = how many INR
                <input type="number" step="any" min="0" required value={form.rateToInr} onChange={(e) => setForm({ ...form, rateToInr: e.target.value })} placeholder="e.g. 88" />
              </label>
              <label>Effective from
                <input type="date" required value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
              </label>
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add rate'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}