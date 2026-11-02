import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './PharmaRefundsPage.css';

type RefundRow = {
  id: string; amount: number; mode: string; reference_no?: string | null; notes?: string | null; created_at?: string; recorded_by?: string;
  sale_orders?: { order_number?: string | null } | null;
  clients?: { client_code?: string | null; client_name?: string | null } | null;
};
type DueRow = { order_id: string; order_number: string; client_name: string; client_code: string; order_total: number; collected: number; credited: number; refunded: number; due: number };
const MODES: Array<[string, string]> = [['cash', 'Cash'], ['upi', 'UPI'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['other', 'Other']];
const MODE_LABEL: Record<string, string> = Object.fromEntries(MODES);
const AVATAR_COLORS = ['#2e7d6b', '#3457d5', '#a6631a', '#6d43c9', '#a6402b', '#3d5a80'];
const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (v?: string) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const clock = (v?: string) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
const initials = (name?: string | null) => (name ?? '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
const colorOf = (name?: string | null) => AVATAR_COLORS[[...(name ?? '')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const ICONS: Record<string, string> = {
  hourglass: 'M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2',
  check: 'M20 6 9 17l-5-5',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
};
function Ico({ n }: { n: string }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[n]} /></svg>;
}

function Customer({ name, code }: { name?: string | null; code?: string | null }) {
  return (
    <div className="prf-who">
      <span className="prf-avatar" style={{ background: colorOf(name) }}>{initials(name)}</span>
      <div><strong>{name ?? '—'}</strong><small className="mono">{code ?? ''}</small></div>
    </div>
  );
}

/**
 * Pharma customer refunds. A refund is owed when a customer paid more than their order is worth after return credit.
 * "Waiting to be refunded" is the worklist (record the payout right here); "Refund history" is every payout already made.
 */
export function PharmaRefundsPage() {
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [due, setDue] = useState<DueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('');
  const [picked, setPicked] = useState<DueRow | null>(null);
  const [amount, setAmount] = useState('');
  const [payMode, setPayMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    try {
      const [history, pending] = await Promise.all([
        api<{ data: RefundRow[] }>('/pharma/refunds'),
        api<{ data: DueRow[] }>('/pharma/refunds/pending'),
      ]);
      setRows(history.data ?? []);
      setDue(pending.data ?? []);
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load refunds.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = (row: DueRow) => { setPicked(row); setAmount(String(row.due)); setPayMode('cash'); setReference(''); setNotes(''); setMessage(''); setDone(''); };

  const submit = async () => {
    if (!picked) return;
    const value = Number(amount);
    if (!(value > 0)) { setMessage('Enter the refund amount.'); return; }
    if (value > picked.due + 0.005) { setMessage(`Only ${money(picked.due)} can be refunded on this order.`); return; }
    setBusy(true); setMessage('');
    try {
      await api('/pharma/refunds', { method: 'POST', body: JSON.stringify({ orderId: picked.order_id, amount: value, mode: payMode, referenceNo: reference.trim() || null, notes: notes.trim() || null }) });
      setDone(`Refund of ${money(value)} recorded for ${picked.client_name} (${picked.order_number}).`);
      setPicked(null);
      await load();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not record the refund.'); }
    finally { setBusy(false); }
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (!mode || r.mode === mode)
      && (!q || [r.clients?.client_name, r.clients?.client_code, r.sale_orders?.order_number, r.reference_no, r.notes].some((v) => String(v ?? '').toLowerCase().includes(q))));
  }, [rows, search, mode]);
  const totalShown = shown.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const totalDue = due.reduce((sum, r) => sum + r.due, 0);
  const totalPaid = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const exportCsv = () => {
    const head = ['Date', 'Customer', 'Customer code', 'Sales order', 'Amount', 'Paid back by', 'Reference', 'Notes', 'Recorded by'];
    const lines = shown.map((r) => [day(r.created_at), r.clients?.client_name, r.clients?.client_code, r.sale_orders?.order_number, r.amount, MODE_LABEL[r.mode] ?? r.mode, r.reference_no, r.notes, r.recorded_by].map(csvCell).join(','));
    const blob = new Blob([[head.map(csvCell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `pharma-customer-refunds-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  return (
    <section className="page-panel master-page prf-page">
      <div className="prf-head">
        <div>
          <p className="eyebrow">PHARMA · CUSTOMER REFUNDS</p>
          <h2>Customer refunds</h2>
        </div>
        <div className="prf-head-actions">
          <button type="button" className="prf-btn ghost" disabled={refreshing} onClick={() => { setRefreshing(true); void load(); }}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
        </div>
      </div>

      {error && <p className="prf-notice err" role="alert">{error}</p>}
      {done && <p className="prf-notice ok" role="status">✓ {done}</p>}

      <div className="prf-kpis">
        <div className={`prf-kpi ${due.length ? 'red' : 'green'}`}><span className="prf-kpi-icon"><Ico n="hourglass" /></span><div><span className="prf-kpi-label">Refund due</span><strong>{money(totalDue)}</strong><small>{due.length} order{due.length === 1 ? '' : 's'} waiting</small></div></div>
        <div className="prf-kpi green"><span className="prf-kpi-icon"><Ico n="check" /></span><div><span className="prf-kpi-label">Refunded so far</span><strong>{money(totalPaid)}</strong><small>paid back to customers</small></div></div>
        <div className="prf-kpi blue"><span className="prf-kpi-icon"><Ico n="undo" /></span><div><span className="prf-kpi-label">Refunds recorded</span><strong>{rows.length}</strong><small>all time</small></div></div>
        <div className="prf-kpi ink"><span className="prf-kpi-icon"><Ico n="clock" /></span><div><span className="prf-kpi-label">Last refund</span><strong>{day(rows[0]?.created_at)}</strong><small>{rows[0]?.clients?.client_name ?? 'none yet'}</small></div></div>
      </div>

      {loading ? <p>Loading refunds…</p> : (
        <>
          <div className="prf-card">
            <div className="prf-card-head">
              <div><h3>Waiting to be refunded</h3><p>Customers who paid more than their order is now worth.</p></div>
              <span className={`prf-pill ${due.length ? 'warn' : 'ok'}`}>{due.length ? `${due.length} pending · ${money(totalDue)}` : '✓ All settled'}</span>
            </div>
            {due.length === 0 ? (
<div className="prf-allclear"><span className="tick">✓</span><div><strong>No refunds pending</strong></div></div>            ) : (
              <div className="prf-scroll">
                <table className="prf-table">
                  <thead><tr><th>Customer</th><th>Sales order</th><th className="num">Order total</th><th className="num">Return credit</th><th className="num">Customer paid</th><th className="num">Already refunded</th><th className="num">Refund due</th><th /></tr></thead>
                  <tbody>
                    {due.map((r) => (
                      <tr key={r.order_id}>
                        <td><Customer name={r.client_name} code={r.client_code} /></td>
                        <td><a className="prf-order" href="#orders">{r.order_number}</a></td>
                        <td className="num">{money(r.order_total)}</td>
                        <td className="num">− {money(r.credited)}</td>
                        <td className="num">{money(r.collected)}</td>
                        <td className="num">{money(r.refunded)}</td>
                        <td className="num prf-due">{money(r.due)}</td>
                        <td className="num"><button type="button" className="prf-btn small" onClick={() => open(r)}>Record refund</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {picked && (
              <div className="prf-form">
                <div className="prf-form-head">
                  <div><h3>Record refund</h3><p>{picked.client_name} · {picked.order_number}</p></div>
                  <span className="prf-pill warn">Refund due {money(picked.due)}</span>
                </div>
                <div className="prf-summary">
                  <div><span>Order total</span><strong>{money(picked.order_total)}</strong></div>
                  <div><span>Return credit</span><strong>− {money(picked.credited)}</strong></div>
                  <div><span>Customer paid</span><strong>{money(picked.collected)}</strong></div>
                  <div className="hot"><span>To pay back</span><strong>{money(picked.due)}</strong></div>
                </div>
                <div className="prf-grid">
                  <label className="prf-field">Amount paid back (₹)
                    <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </label>
                  <label className="prf-field">Paid back by
                    <select value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                      {MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label className="prf-field">Reference no. (optional)
                    <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder="UTR / cheque no." />
                  </label>
                  <label className="prf-field">Notes (optional)
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
                  </label>
                </div>
                {message && <p className="prf-err" role="alert">{message}</p>}
                <div className="prf-actions">
                  <button type="button" className="prf-btn" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Save refund'}</button>
                  <button type="button" className="prf-btn ghost" disabled={busy} onClick={() => setPicked(null)}>Cancel</button>
                </div>
                <p className="prf-hint">Save only after you have actually paid the money back. A smaller amount leaves the rest still due.</p>
              </div>
            )}
          </div>

          <div className="prf-card">
            <div className="prf-card-head">
              <div><h3>Refund history</h3><p>Every refund already paid back to a customer.</p></div>
              <div className="prf-tools">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, order or reference…" />
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="">All payment modes</option>
                  {MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button type="button" className="prf-btn ghost" disabled={shown.length === 0} onClick={exportCsv}>⬇ Export CSV</button>
              </div>
            </div>
            {shown.length === 0 ? (
              <div className="prf-empty"><strong>{rows.length === 0 ? 'No refunds recorded yet' : 'No refunds match your search'}</strong>{rows.length === 0 ? 'Refunds you record will appear here.' : 'Try a different customer, order or payment mode.'}</div>
            ) : (
              <div className="prf-scroll">
                <table className="prf-table">
                  <thead><tr><th>Date</th><th>Customer</th><th>Sales order</th><th className="num">Amount</th><th>Paid back by</th><th>Reference</th><th>Notes</th><th>Recorded by</th></tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id}>
                        <td>{day(r.created_at)}<small>{clock(r.created_at)}</small></td>
                        <td><Customer name={r.clients?.client_name} code={r.clients?.client_code} /></td>
                        <td><a className="prf-order" href="#orders">{r.sale_orders?.order_number ?? '—'}</a></td>
                        <td className="num"><strong>{money(r.amount)}</strong></td>
                        <td><span className={`prf-pill ${r.mode}`}>{MODE_LABEL[r.mode] ?? r.mode}</span></td>
                        <td>{r.reference_no || <span className="prf-muted">—</span>}</td>
                        <td>{r.notes || <span className="prf-muted">—</span>}</td>
                        <td>{r.recorded_by || <span className="prf-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={3}>Total refunded ({shown.length})</td><td className="num">{money(totalShown)}</td><td colSpan={4} /></tr></tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}