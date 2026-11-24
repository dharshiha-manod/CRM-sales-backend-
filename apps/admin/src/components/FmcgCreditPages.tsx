// FMCG Credit Control (limit, unpaid, overdue, available credit per client) and Cheque Tracker
// (received -> deposited -> cleared, or bounced; a bounced cheque puts the amount back on the client's unpaid balance).
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

type Risk = 'blocked' | 'over_limit' | 'near_limit' | 'ok' | 'no_limit';
type CreditRow = { id: string; client_code: string; client_name: string; city: string | null; credit_limit: number | null; credit_days: number | null; outstanding: number; overdue: number; available: number | null; utilization: number | null; risk: Risk; cheques_in_hand: number; cheques_in_hand_value: number; cheques_bounced: number; cheques_bounced_value: number };
type Overview = { rows: CreditRow[]; totals: { outstanding: number; overdue: number; blocked: number; over_limit: number; near_limit: number; no_limit: number; cheques_in_hand_value: number } };
type Cheque = { id: string; client_name: string; client_code: string | null; order_number: string | null; cheque_no: string | null; bank_name: string | null; cheque_date: string; amount: number; status: 'received' | 'deposited' | 'cleared' | 'bounced'; deposited_on: string | null; cleared_on: string | null; bounced_on: string | null; bounce_reason: string | null; bounce_charge: number; notes: string | null };

const money = (v: number | null) => (v == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v));
const dt = (v: string | null) => (v ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(v)) : '—');
const todayStr = () => new Date().toLocaleDateString('en-CA');
const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const RISK: Record<Risk, { label: string; color: string }> = {
  blocked: { label: 'Overdue – orders blocked', color: '#b91c1c' }, over_limit: { label: 'Over limit', color: '#c2410c' }, near_limit: { label: 'Near limit', color: '#d97706' }, ok: { label: 'Healthy', color: '#15803d' }, no_limit: { label: 'No limit set', color: '#64748b' },
};
const CHQ: Record<Cheque['status'], { label: string; color: string }> = { received: { label: 'In hand', color: '#2563eb' }, deposited: { label: 'Deposited', color: '#d97706' }, cleared: { label: 'Cleared', color: '#15803d' }, bounced: { label: 'Bounced', color: '#b91c1c' } };
const Chip = ({ label, color }: { label: string; color: string }) => <span style={{ background: `${color}1a`, color, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>;
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 };
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label style={{ display: 'grid', gap: 4, fontSize: 13 }}><span>{label}</span>{children}</label>;
const Kpi = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => <div className="kpi-card" style={{ minWidth: 160 }}><div><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div></div>;
function Modal({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="master-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div><button className="icon-action" type="button" aria-label="Close" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}

// ============================================================ Credit control
export function FmcgCreditControlPage() {
  const [data, setData] = useState<Overview | null>(null); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [msg, setMsg] = useState('');
  const [risk, setRisk] = useState('all'); const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<CreditRow | null>(null); const [limit, setLimit] = useState(''); const [days, setDays] = useState(''); const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    try { setData((await api<{ data: Overview }>('/fmcg/credit/overview')).data); setError(''); } catch (e) { setError(errText(e, 'Unable to load credit control.')); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => (risk === 'all' || r.risk === risk) && (!q || [r.client_name, r.client_code, r.city].some((v) => (v ?? '').toLowerCase().includes(q)))).sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
  }, [data, risk, search]);
  function open(r: CreditRow) { setEdit(r); setLimit(r.credit_limit == null ? '' : String(r.credit_limit)); setDays(r.credit_days == null ? '' : String(r.credit_days)); setError(''); }
  async function save(e: FormEvent) {
    e.preventDefault(); if (!edit) return; setBusy(true); setError('');
    try { await api(`/fmcg/credit/clients/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ credit_limit: limit, credit_days: days }) }); setEdit(null); setMsg('Credit terms updated.'); await load(); }
    catch (err) { setError(errText(err, 'Unable to save credit terms.')); } finally { setBusy(false); }
  }
  const t = data?.totals;
  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading"><div><p className="eyebrow">FMCG · CREDIT CONTROL</p><h2>Credit control</h2><p>New orders are refused automatically when a client is over the limit or has payments overdue beyond their credit days. This screen shows who is close.</p></div>
        <button onClick={() => void load()}>Refresh</button></div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '0 0 12px' }}>
        <Kpi label="Total unpaid" value={money(t?.outstanding ?? 0)} /><Kpi label="Overdue" value={money(t?.overdue ?? 0)} sub={`${t?.blocked ?? 0} client(s) blocked`} />
        <Kpi label="Over limit" value={t?.over_limit ?? 0} sub={`${t?.near_limit ?? 0} near limit`} /><Kpi label="Cheques in hand" value={money(t?.cheques_in_hand_value ?? 0)} /><Kpi label="No limit set" value={t?.no_limit ?? 0} />
      </div>
      <div className="master-toolbar"><div className="master-search"><input type="search" placeholder="Search client, code or city" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={risk} onChange={(e) => setRisk(e.target.value)}><option value="all">All clients</option>{(Object.keys(RISK) as Risk[]).map((k) => <option key={k} value={k}>{RISK[k].label}</option>)}</select></div></div>
      {error && !edit && <p className="error-message">{error}</p>}{msg && <p className="success-message">{msg}</p>}
      <div className="data-table-wrap"><table>
        <thead><tr><th>Client</th><th>Credit limit</th><th>Credit days</th><th>Unpaid</th><th>Overdue</th><th>Available</th><th>Used</th><th>Cheques in hand</th><th>Bounced</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={11} className="empty-row">Loading…</td></tr>}
          {!loading && rows.map((r) => (
            <tr key={r.id}><td><strong>{r.client_name}</strong><small style={{ display: 'block' }}>{r.client_code}{r.city ? ` · ${r.city}` : ''}</small></td>
              <td>{money(r.credit_limit)}</td><td>{r.credit_days ?? '—'}</td><td>{money(r.outstanding)}</td>
              <td style={{ color: r.overdue > 0 ? '#b91c1c' : undefined, fontWeight: r.overdue > 0 ? 600 : undefined }}>{money(r.overdue)}</td><td>{money(r.available)}</td>
              <td style={{ minWidth: 90 }}>{r.utilization == null ? '—' : <><div style={{ height: 6, background: '#e2e8f0', borderRadius: 4 }}><div style={{ width: `${Math.min(100, r.utilization)}%`, height: 6, borderRadius: 4, background: RISK[r.risk].color }} /></div><small>{r.utilization}%</small></>}</td>
              <td>{r.cheques_in_hand ? `${r.cheques_in_hand} · ${money(r.cheques_in_hand_value)}` : '—'}</td>
              <td style={{ color: r.cheques_bounced ? '#b91c1c' : undefined }}>{r.cheques_bounced ? `${r.cheques_bounced} · ${money(r.cheques_bounced_value)}` : '—'}</td>
              <td><Chip {...RISK[r.risk]} /></td><td><button onClick={() => open(r)}>Set limit</button></td></tr>
          ))}
          {!loading && rows.length === 0 && <tr><td colSpan={11} className="empty-row">No clients match.</td></tr>}
        </tbody></table></div>
      {edit && (
        <Modal eyebrow="CREDIT TERMS" title={edit.client_name} onClose={() => setEdit(null)}>
          <form onSubmit={save} style={{ display: 'grid', gap: 14 }}>
            <div style={grid}>
              <Field label="Credit limit (₹) – empty = no limit"><input type="number" min={0} step="any" value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
              <Field label="Credit days – empty = none"><input type="number" min={0} step={1} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
            </div>
            <small>Unpaid now {money(edit.outstanding)}. A new order that would push unpaid above the limit is refused, and so is any order for a client with a payment older than the credit days.</small>
            {error && <p className="error-message">{error}</p>}
            <div className="modal-actions"><button type="button" onClick={() => setEdit(null)}>Cancel</button><button className="primary-action" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}

// ============================================================ Cheque tracker
type Act = { cheque: Cheque; action: 'deposit' | 'clear' | 'bounce' | 'details' };
export function FmcgChequesPage() {
  const [rows, setRows] = useState<Cheque[]>([]); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [msg, setMsg] = useState(''); const [status, setStatus] = useState('all'); const [search, setSearch] = useState('');
  const [act, setAct] = useState<Act | null>(null); const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(todayStr()); const [reason, setReason] = useState(''); const [charge, setCharge] = useState(''); const [bank, setBank] = useState(''); const [chequeDate, setChequeDate] = useState(''); const [notes, setNotes] = useState('');
  async function load() {
    setLoading(true);
    try { setRows((await api<{ data: Cheque[] }>('/fmcg/cheques')).data ?? []); setError(''); } catch (e) { setError(errText(e, 'Unable to load cheques.')); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const today = todayStr();
  const inHand = rows.filter((r) => r.status === 'received' || r.status === 'deposited');
  const dueNow = rows.filter((r) => r.status === 'received' && r.cheque_date.slice(0, 10) <= today);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return rows.filter((r) => (status === 'all' || r.status === status) && (!q || [r.client_name, r.cheque_no, r.order_number, r.bank_name].some((v) => (v ?? '').toLowerCase().includes(q)))); }, [rows, status, search]);
  const sum = (l: Cheque[]) => l.reduce((s, r) => s + Number(r.amount), 0);
  function start(cheque: Cheque, action: Act['action']) { setAct({ cheque, action }); setDate(todayStr()); setReason(''); setCharge(''); setBank(cheque.bank_name ?? ''); setChequeDate(cheque.cheque_date.slice(0, 10)); setNotes(cheque.notes ?? ''); setError(''); }
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!act) return; setBusy(true); setError('');
    const body = act.action === 'details' ? { action: 'details', bank_name: bank, cheque_date: chequeDate, notes } : act.action === 'bounce' ? { action: 'bounce', date, reason, bounce_charge: charge === '' ? 0 : Number(charge) } : { action: act.action, date };
    try {
      await api(`/fmcg/cheques/${act.cheque.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg(act.action === 'bounce' ? 'Cheque marked bounced. The amount is back on the client’s unpaid balance and a follow-up was raised for the rep.' : 'Cheque updated.');
      setAct(null); await load();
    } catch (err) { setError(errText(err, 'Unable to update the cheque.')); } finally { setBusy(false); }
  }
  const title = act ? { deposit: 'Mark deposited', clear: 'Mark cleared', bounce: 'Mark bounced', details: 'Cheque details' }[act.action] : '';
  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading"><div><p className="eyebrow">FMCG · CHEQUE TRACKER</p><h2>Cheque tracker</h2><p>Every cheque collected by your reps appears here by itself. Track it to deposit and clearing. If it bounces, the payment is reversed automatically.</p></div>
        <button onClick={() => void load()}>Refresh</button></div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '0 0 12px' }}>
        <Kpi label="In hand + deposited" value={money(sum(inHand))} sub={`${inHand.length} cheque(s)`} /><Kpi label="Due for deposit" value={dueNow.length} sub={money(sum(dueNow))} />
        <Kpi label="Cleared" value={rows.filter((r) => r.status === 'cleared').length} /><Kpi label="Bounced" value={rows.filter((r) => r.status === 'bounced').length} sub={money(sum(rows.filter((r) => r.status === 'bounced')))} />
      </div>
      <div className="master-toolbar"><div className="master-search"><input type="search" placeholder="Search client, cheque no., order or bank" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All status</option>{(Object.keys(CHQ) as Cheque['status'][]).map((k) => <option key={k} value={k}>{CHQ[k].label}</option>)}</select></div></div>
      {error && !act && <p className="error-message">{error}</p>}{msg && <p className="success-message">{msg}</p>}
      <div className="data-table-wrap"><table>
        <thead><tr><th>Cheque</th><th>Client</th><th>Order</th><th>Amount</th><th>Cheque date</th><th>Bank</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={8} className="empty-row">Loading…</td></tr>}
          {!loading && filtered.map((r) => (
            <tr key={r.id}><td><strong>{r.cheque_no || '—'}</strong></td><td>{r.client_name}</td><td>{r.order_number ?? '—'}</td><td>{money(r.amount)}</td>
              <td>{dt(r.cheque_date)}{r.status === 'received' && r.cheque_date.slice(0, 10) > today && <small style={{ display: 'block', color: '#64748b' }}>post-dated</small>}</td><td>{r.bank_name || '—'}</td>
              <td><Chip {...CHQ[r.status]} />{r.status === 'bounced' && <small style={{ display: 'block' }}>{r.bounce_reason}{r.bounce_charge ? ` · charge ${money(r.bounce_charge)}` : ''}</small>}</td>
              <td className="master-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {r.status === 'received' && <button onClick={() => start(r, 'deposit')} disabled={r.cheque_date.slice(0, 10) > today} title={r.cheque_date.slice(0, 10) > today ? 'Post-dated: not before the cheque date' : ''}>Deposit</button>}
                {(r.status === 'received' || r.status === 'deposited') && <><button className="primary-action" onClick={() => start(r, 'clear')}>Cleared</button><button onClick={() => start(r, 'bounce')}>Bounced</button></>}
                <button className="icon-action" title="Edit details" onClick={() => start(r, 'details')}>✎</button></td></tr>
          ))}
          {!loading && filtered.length === 0 && <tr><td colSpan={8} className="empty-row">{rows.length === 0 ? 'No cheque collections yet.' : 'No cheques match.'}</td></tr>}
        </tbody></table></div>
      {act && (
        <Modal eyebrow="CHEQUE" title={`${title} · ${act.cheque.cheque_no || 'no number'}`} onClose={() => setAct(null)}>
          <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
            <small>{act.cheque.client_name} · {money(act.cheque.amount)}</small>
            {act.action === 'details' ? (
              <div style={grid}><Field label="Bank"><input value={bank} onChange={(e) => setBank(e.target.value)} /></Field><Field label="Cheque date"><input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} /></Field><Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
            ) : (
              <div style={grid}>
                <Field label="Date"><input type="date" max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                {act.action === 'bounce' && <><Field label="Bounce reason *"><input required value={reason} placeholder="e.g. Insufficient funds" onChange={(e) => setReason(e.target.value)} /></Field><Field label="Bank charge (₹)"><input type="number" min={0} step="any" value={charge} onChange={(e) => setCharge(e.target.value)} /></Field></>}
              </div>
            )}
            {act.action === 'bounce' && <small>The {money(act.cheque.amount)} payment is reversed: it goes back on the client’s unpaid balance (credit limit and overdue are recalculated), the order is reopened if it was completed, and a follow-up is raised for the rep.</small>}
            {error && <p className="error-message">{error}</p>}
            <div className="modal-actions"><button type="button" onClick={() => setAct(null)}>Cancel</button><button className="primary-action" disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}