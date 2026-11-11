// FILE: admin/src/components/TextileSupplierPaymentsPage.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// Textile > Supplier Bills & Payments. A posted GRN is the supplier bill; pay it here and see what is due, overdue and how old.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';

type Row = Record<string, any>;
const msgOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const money = (v: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v ?? 0));
const today = () => new Date().toISOString().slice(0, 10);
const MODES = ['Bank Transfer', 'UPI', 'Cheque', 'Cash', 'Other'];

const card: React.CSSProperties = { background: 'var(--surface, #fff)', border: '1px solid var(--border, #e5e2dc)', borderRadius: 12, padding: 16, marginTop: 16 };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 12, padding: '8px 10px', color: 'var(--text-muted, #6b6b6b)', borderBottom: '1px solid var(--border, #e5e2dc)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 14, borderBottom: '1px solid var(--border, #f0eee9)', verticalAlign: 'middle' };
const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border, #d6d2c9)', background: 'transparent', cursor: 'pointer', fontSize: 13 };
const btnMain: React.CSSProperties = { ...btn, background: 'var(--accent, #1f6f4a)', borderColor: 'var(--accent, #1f6f4a)', color: '#fff' };
const tab = (on: boolean): React.CSSProperties => ({ ...btn, borderRadius: 999, background: on ? 'var(--accent, #1f6f4a)' : 'transparent', color: on ? '#fff' : 'inherit', borderColor: on ? 'var(--accent, #1f6f4a)' : 'var(--border, #d6d2c9)' });
const tone = (s: string) => (s === 'Overdue' ? '#b3261e' : s === 'Paid' ? '#1f6f4a' : s === 'Partly paid' ? '#b26a00' : 'inherit');

export function TextileSupplierPaymentsPage() {
  const { activeIndustryTypeId: it } = useIndustryScope();
  const [tabKey, setTabKey] = useState<'bills' | 'suppliers' | 'payments'>('bills');
  const [bills, setBills] = useState<Row[]>([]);
  const [sups, setSups] = useState<Row[]>([]);
  const [pays, setPays] = useState<Row[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [form, setForm] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!it) return;
    const q = `industryTypeId=${encodeURIComponent(it)}`;
    try {
      const [b, s, p] = await Promise.all([
        api<{ data: Row[] }>(`/textile/supplier-bills?${q}`), api<{ data: Row[] }>(`/textile/supplier-outstanding?${q}`), api<{ data: Row[] }>(`/textile/supplier-payments?${q}`),
      ]);
      setBills(b.data ?? []); setSups(s.data ?? []); setPays(p.data ?? []); setErr('');
    } catch (e) { setErr(msgOf(e)); }
  }, [it]);
  useEffect(() => { void load(); }, [load]);

  const owed = sups.reduce((t, s) => t + Number(s.outstanding || 0), 0);
  const overdue = sups.reduce((t, s) => t + Number(s.overdue_1_30 || 0) + Number(s.overdue_31_60 || 0) + Number(s.overdue_60_plus || 0), 0);
  const openBills = bills.filter((b) => b.balance > 0.004);

  function pay(bill?: Row, supplier?: Row) {
    const supplierId = bill?.supplier_id ?? supplier?.supplier_id ?? '';
    setForm({ supplier_id: supplierId, grn_id: bill?.id ?? '', amount: bill ? String(bill.balance) : supplier ? String(supplier.outstanding) : '', mode: 'Bank Transfer', payment_date: today(), reference_no: '' });
  }
  async function save() {
    if (!form) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const res = await api<{ data: Row }>('/textile/supplier-payments', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount), industryTypeId: it }) });
      setMsg(`Payment ${res.data.payment_number} recorded.`); setForm(null); await load();
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  }
  async function cancel(p: Row) {
    const reason = window.prompt(`Cancel payment ${p.payment_number}? Enter a reason:`);
    if (!reason) return;
    try { await api(`/textile/supplier-payments/${p.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); setMsg(`${p.payment_number} cancelled.`); await load(); }
    catch (e) { setErr(msgOf(e)); }
  }

  const supplierBills = form ? openBills.filter((b) => b.supplier_id === form.supplier_id) : [];
  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">TEXTILE · SUPPLIER BILLS & PAYMENTS</p>
          <h2>Supplier bills & payments</h2>
          <p>Every posted goods receipt is a bill from the mill. Pay it here and see what is due and overdue.</p>
        </div>
        <button type="button" style={btnMain} onClick={() => pay()}>Record payment</button>
      </div>
      {err && <p className="error-message">{err}</p>}
      {msg && <p className="success-message">{msg}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div style={{ ...card, marginTop: 0 }}><div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b6b6b' }}>You owe suppliers</div><div style={{ fontSize: 26, fontWeight: 700 }}>{money(owed)}</div></div>
        <div style={{ ...card, marginTop: 0 }}><div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b6b6b' }}>Overdue</div><div style={{ fontSize: 26, fontWeight: 700, color: overdue ? '#b3261e' : 'inherit' }}>{money(overdue)}</div></div>
        <div style={{ ...card, marginTop: 0 }}><div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b6b6b' }}>Open bills</div><div style={{ fontSize: 26, fontWeight: 700 }}>{openBills.length}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" style={tab(tabKey === 'bills')} onClick={() => setTabKey('bills')}>Bills</button>
        <button type="button" style={tab(tabKey === 'suppliers')} onClick={() => setTabKey('suppliers')}>By supplier (ageing)</button>
        <button type="button" style={tab(tabKey === 'payments')} onClick={() => setTabKey('payments')}>Payments</button>
      </div>

      {tabKey === 'bills' && (
        <div style={card}>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Show open bills only</label>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>GRN</th><th style={th}>Supplier</th><th style={th}>Mill invoice</th><th style={th}>Received</th><th style={th}>Due</th><th style={th}>Bill</th><th style={th}>Paid</th><th style={th}>Balance</th><th style={th}>Status</th><th style={th} /></tr></thead>
              <tbody>
                {(onlyOpen ? openBills : bills).map((b) => (
                  <tr key={b.id}>
                    <td style={td}><strong>{b.grn_number}</strong></td><td style={td}>{b.supplier_name}</td><td style={td}>{b.supplier_invoice_no || '-'}</td>
                    <td style={td}>{b.received_date}</td><td style={td}>{b.due_date}</td><td style={td}>{money(b.total)}</td><td style={td}>{money(b.paid)}</td><td style={td}><strong>{money(b.balance)}</strong></td>
                    <td style={{ ...td, color: tone(b.status), fontWeight: 600 }}>{b.status}{b.days_overdue ? ` (${b.days_overdue} d)` : ''}</td>
                    <td style={td}>{b.balance > 0.004 && <button type="button" style={btn} onClick={() => pay(b)}>Pay</button>}</td>
                  </tr>
                ))}
                {(onlyOpen ? openBills : bills).length === 0 && <tr><td style={td} colSpan={10}>No bills yet. Bills appear when goods are received (GRN).</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tabKey === 'suppliers' && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Supplier / mill</th><th style={th}>Terms</th><th style={th}>Billed</th><th style={th}>Paid</th><th style={th}>Outstanding</th><th style={th}>Not due</th><th style={th}>1-30 d</th><th style={th}>31-60 d</th><th style={th}>60+ d</th><th style={th}>Advance</th><th style={th} /></tr></thead>
            <tbody>
              {sups.map((s) => (
                <tr key={s.supplier_id}>
                  <td style={td}><strong>{s.supplier_name}</strong></td><td style={td}>{s.payment_terms_days} d</td><td style={td}>{money(s.billed)}</td><td style={td}>{money(s.paid)}</td>
                  <td style={td}><strong>{money(s.outstanding)}</strong></td><td style={td}>{money(s.not_due)}</td><td style={td}>{money(s.overdue_1_30)}</td><td style={td}>{money(s.overdue_31_60)}</td>
                  <td style={{ ...td, color: s.overdue_60_plus ? '#b3261e' : 'inherit' }}>{money(s.overdue_60_plus)}</td><td style={td}>{s.advance ? money(s.advance) : '-'}</td>
                  <td style={td}>{s.outstanding > 0.004 && <button type="button" style={btn} onClick={() => pay(undefined, s)}>Pay</button>}</td>
                </tr>
              ))}
              {sups.length === 0 && <tr><td style={td} colSpan={11}>No suppliers yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tabKey === 'payments' && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Payment</th><th style={th}>Date</th><th style={th}>Supplier</th><th style={th}>Against</th><th style={th}>Mode</th><th style={th}>Reference</th><th style={th}>Amount</th><th style={th}>Status</th><th style={th} /></tr></thead>
            <tbody>
              {pays.map((p) => (
                <tr key={p.id} style={{ opacity: p.status === 'Cancelled' ? 0.55 : 1 }}>
                  <td style={td}><strong>{p.payment_number}</strong></td><td style={td}>{p.payment_date}</td><td style={td}>{p.textile_suppliers?.supplier_name}</td>
                  <td style={td}>{p.textile_grns?.grn_number ?? 'Oldest bills first'}</td><td style={td}>{p.mode}</td><td style={td}>{p.reference_no || '-'}</td>
                  <td style={td}>{money(p.amount)}</td><td style={td}>{p.status}</td>
                  <td style={td}>{p.status === 'Paid' && <button type="button" style={btn} onClick={() => void cancel(p)}>Cancel</button>}</td>
                </tr>
              ))}
              {pays.length === 0 && <tr><td style={td} colSpan={9}>No payments recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setForm(null)}>
          <div style={{ ...card, marginTop: 0, width: 440, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Record supplier payment</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              <label>Supplier / mill
                <select style={{ width: '100%' }} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value, grn_id: '', amount: '' })}>
                  <option value="">Pick supplier</option>
                  {sups.filter((s) => s.outstanding > 0.004).map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name} - owes {money(s.outstanding)}</option>)}
                </select>
              </label>
              <label>Pay against bill (optional)
                <select style={{ width: '100%' }} value={form.grn_id} onChange={(e) => { const b = openBills.find((x) => x.id === e.target.value); setForm({ ...form, grn_id: e.target.value, amount: b ? String(b.balance) : form.amount }); }}>
                  <option value="">Oldest bills first</option>
                  {supplierBills.map((b) => <option key={b.id} value={b.id}>{b.grn_number} - balance {money(b.balance)}</option>)}
                </select>
              </label>
              <label>Amount<input style={{ width: '100%' }} type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
              <label>Mode<select style={{ width: '100%' }} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Date<input style={{ width: '100%' }} type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></label>
              <label>Reference / UTR / cheque no.<input style={{ width: '100%' }} value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" style={btn} onClick={() => setForm(null)}>Close</button>
              <button type="button" style={btnMain} disabled={busy} onClick={() => void save()}>Save payment</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}