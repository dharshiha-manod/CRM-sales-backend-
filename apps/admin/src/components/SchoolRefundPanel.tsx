import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import './SchoolDeliveryPanel.css';
import './SchoolReturnsPanel.css';

type RefundRow = { id: string; amount: number; mode: string; reference_no?: string | null; notes?: string | null; created_at?: string };
type RefundInfo = { refunds: RefundRow[]; due: number; orderTotal: number; collected: number; credited: number; refunded: number };
export type SchoolRefundOrder = { id: string; status: string; returns_credit?: number | null };
const MODES: Array<[string, string]> = [['cash', 'Cash'], ['upi', 'UPI'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['other', 'Other']];
const MODE_LABEL = Object.fromEntries(MODES);
const money = (n: number | null | undefined) => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (v?: string) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * School only: after an approved return, the school may have paid more than the order is now worth. That extra is
 * money we owe back; recording the refund keeps the order and the school's balance correct.
 */
export function SchoolRefundPanel({ order, onChanged, industry = 'school' }: { order: SchoolRefundOrder; onChanged: (patch: { refunded_amount: number }) => void; industry?: 'school' | 'pharma' }) {
  const party = industry === 'pharma' ? 'customer' : 'school';
  const [info, setInfo] = useState<RefundInfo | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const credit = Number(order.returns_credit ?? 0);

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: RefundInfo }>(`/${industry}/orders/${order.id}/refunds`);
      setInfo(res.data);
      setAmount(res.data.due > 0 ? String(res.data.due) : '');
      return res.data;
    } catch { setInfo(null); return null; } // panel simply stays hidden if the refunds could not be read
  }, [order.id]);

  // Reload when the order changes or when a return is approved / rejected (the credit changes).
  useEffect(() => { if (order.status !== 'cancelled') void load(); }, [order.status, credit, load]);

  if (order.status === 'cancelled' || !info || (info.due <= 0 && info.refunds.length === 0)) return null;

  const submit = async () => {
    const value = Number(amount);
    if (!(value > 0)) { setMessage('Enter the refund amount.'); return; }
    setBusy(true); setMessage('');
    try {
      await api(`/${industry}/refunds`, { method: 'POST', body: JSON.stringify({ orderId: order.id, amount: value, mode, referenceNo: reference.trim() || null, notes: notes.trim() || null }) });
      setReference(''); setNotes('');
      const fresh = await load();
      if (fresh) onChanged({ refunded_amount: fresh.refunded });
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not record the refund.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="qd-panel">
      <div className="qd-panel-head">
        <span>Refund to {party}</span>
        <span className={`qd-pill ${info.due > 0 ? 'warn' : 'ok'}`}>{info.due > 0 ? `Refund due ${money(info.due)}` : 'Refunded'}</span>
      </div>

      {info.refunds.length > 0 && (
        <div className="sr-list">
          {info.refunds.map((r) => (
            <div className="sr-row" key={r.id}>
              <div className="sr-top">
                <span className="sr-name">{money(r.amount)} · {MODE_LABEL[r.mode] ?? r.mode}</span>
                <span className="sr-meta">{when(r.created_at)}</span>
              </div>
              {(r.reference_no || r.notes) && <div className="sr-meta">{[r.reference_no ? `Ref ${r.reference_no}` : '', r.notes ?? ''].filter(Boolean).join(' · ')}</div>}
            </div>
          ))}
        </div>
      )}

      {info.due > 0 && (
        <div className="sd-form">
          <div className="sr-grid">
            <label className="sd-field">Amount
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="sd-field">Paid back by
              <select className="sr-select" value={mode} onChange={(e) => setMode(e.target.value)}>
                {MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="sd-field">Reference no. (optional)
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder="UTR / cheque no." />
            </label>
            <label className="sd-field">Notes (optional)
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            </label>
          </div>
          {message && <p className="sd-error" role="alert">{message}</p>}
          <div className="sd-actions">
            <button type="button" className="sd-btn" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Record refund'}</button>
          </div>
        </div>
      )}
      <p className="sd-hint">The {party} paid {money(info.collected)} and the order is worth {money(info.orderTotal - info.credited)} after returns ({money(info.orderTotal)} − {money(info.credited)}). Refunded so far: {money(info.refunded)}. Record a refund only after you have paid the money back.</p>
    </div>
  );
}