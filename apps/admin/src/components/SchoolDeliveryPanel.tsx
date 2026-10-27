import { useState } from 'react';
import { api } from '../lib/api';
import './SchoolDeliveryPanel.css';

export type SchoolDeliveryOrder = {
  id: string; status: string; dispatch_status?: string | null;
  school_dispatched_at?: string | null; school_delivered_at?: string | null; school_received_by?: string | null; school_delivery_note?: string | null;
};
type Step = 'pending' | 'dispatched' | 'delivered';
const LABEL: Record<string, string> = { pending: 'Not dispatched', dispatched: 'Dispatched', delivered: 'Delivered' };
const ORDER: Step[] = ['pending', 'dispatched', 'delivered'];
const when = (v?: string | null) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/** Small status text under the order status in the Orders list (the page renders it only when School is active). */
export function SchoolDeliveryBadge({ order }: { order: SchoolDeliveryOrder }) {
  const s = order.dispatch_status ?? 'pending';
  if (order.status !== 'confirmed' && order.status !== 'completed') return null;
  return <small style={{ display: 'block', fontSize: '.74rem', color: s === 'delivered' ? 'var(--green)' : 'var(--text-faint)' }}>{LABEL[s] ?? s}</small>;
}

/** School only: did the goods leave the store and reach the school? Dispatch takes the stock out. */
export function SchoolDeliveryPanel({ order, onSaved }: { order: SchoolDeliveryOrder; onSaved: (saved: Partial<SchoolDeliveryOrder>) => void }) {
  const status = (order.dispatch_status ?? 'pending') as Step;
  const [receivedBy, setReceivedBy] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canAct = order.status === 'confirmed';
  const index = Math.max(0, ORDER.indexOf(status));
  const stepTime = ['', when(order.school_dispatched_at), when(order.school_delivered_at)];

  const move = async (next: Step) => {
    if (next === 'delivered' && !receivedBy.trim()) { setMessage('Enter the name of the person at the school who received the goods.'); return; }
    setBusy(true); setMessage('');
    try {
      const res = await api<{ data: SchoolDeliveryOrder }>(`/school/orders/${order.id}/delivery`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next, receivedBy: next === 'delivered' ? receivedBy.trim() : undefined, note: note.trim() || undefined }),
      });
      onSaved(res.data);
      setNote(''); setReceivedBy('');
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not update the delivery.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="qd-panel">
      <div className="qd-panel-head">
        <span>Delivery to school</span>
        <span className={`qd-pill ${status === 'delivered' ? 'ok' : 'warn'}`}>{LABEL[status] ?? status}</span>
      </div>

      <div className="sd-steps" aria-label="Delivery progress">
        {ORDER.map((step, i) => (
          <div key={step} className={`sd-step ${i < index ? 'done' : i === index ? 'current' : ''}`}>
            <span className="sd-dot">{i < index || (status === 'delivered' && i === 2) ? '✓' : i + 1}</span>
            <span className="sd-step-name">{step === 'pending' ? 'Confirmed' : step === 'dispatched' ? 'Dispatched' : 'Delivered'}</span>
            <span className="sd-step-when">{i === 0 ? '' : stepTime[i]}</span>
          </div>
        ))}
      </div>

      {(order.school_received_by || order.school_delivery_note) && (
        <dl className="sd-info">
          {order.school_received_by && <div><dt>Received by</dt><dd>{order.school_received_by}</dd></div>}
          {order.school_delivered_at && <div><dt>Delivered on</dt><dd>{when(order.school_delivered_at)}</dd></div>}
          {order.school_delivery_note && <div className="wide"><dt>Note</dt><dd className="muted">{order.school_delivery_note}</dd></div>}
        </dl>
      )}

      {status === 'delivered' && <p className="sd-done">✓ Goods reached the school. This delivery is locked; use a sales return for any problem.</p>}
      {!canAct && status !== 'delivered' && <p className="sd-hint">Only a confirmed order can be dispatched.</p>}

      {canAct && status !== 'delivered' && (
        <div className="sd-form">
          {status === 'dispatched' && (
            <label className="sd-field">Received by *
              <input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Name of the person at the school" maxLength={120} />
            </label>
          )}
          <label className="sd-field">Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vehicle no., driver, remarks" maxLength={500} />
          </label>
          {message && <p className="sd-error" role="alert">{message}</p>}
          <div className="sd-actions">
            {status === 'pending' && <button type="button" className="sd-btn" disabled={busy} onClick={() => void move('dispatched')}>{busy ? 'Saving…' : 'Mark dispatched'}</button>}
            {status === 'dispatched' && <button type="button" className="sd-btn success" disabled={busy} onClick={() => void move('delivered')}>{busy ? 'Saving…' : 'Mark delivered'}</button>}
            {status === 'dispatched' && <button type="button" className="sd-btn ghost" disabled={busy} onClick={() => void move('pending')}>Undo dispatch</button>}
          </div>
          <p className="sd-hint" style={{ padding: 0, border: 0 }}>{status === 'pending' ? 'Dispatching takes the stock out of inventory.' : 'Undoing the dispatch puts the stock back.'}</p>
        </div>
      )}
    </div>
  );
}