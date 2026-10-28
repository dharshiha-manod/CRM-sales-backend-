import { useState } from 'react';
import { api } from '../lib/api';
import './SchoolDeliveryPanel.css';

// Textile only: the fabric goes to the client. Confirmed -> Dispatched -> Out for delivery -> Delivered.
export type TextileDeliveryOrder = {
  id: string; status: string;
  textile_delivery_status?: string | null;
  textile_dispatched_at?: string | null; textile_delivered_at?: string | null; textile_received_by?: string | null; textile_delivery_note?: string | null;
};
type Step = 'confirmed' | 'dispatched' | 'out_for_delivery' | 'delivered';
const STEPS: Step[] = ['confirmed', 'dispatched', 'out_for_delivery', 'delivered'];
const LABEL: Record<Step, string> = { confirmed: 'Not dispatched', dispatched: 'Dispatched', out_for_delivery: 'Out for delivery', delivered: 'Delivered' };
const STEP_NAME: Record<Step, string> = { confirmed: 'Confirmed', dispatched: 'Dispatched', out_for_delivery: 'Out for delivery', delivered: 'Delivered' };
const when = (v?: string | null) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const stepOf = (o: TextileDeliveryOrder): Step => (o.textile_delivery_status as Step | null | undefined) ?? 'confirmed';

/** Small status text under the order status in the Orders list (the page renders it only for Textile orders with a distributor). */
export function TextileDeliveryBadge({ order }: { order: TextileDeliveryOrder }) {
  if (order.status !== 'confirmed' && order.status !== 'completed') return null;
  const s = stepOf(order);
  return <small style={{ display: 'block', fontSize: '.74rem', color: s === 'delivered' ? 'var(--green)' : 'var(--text-faint)' }}>{LABEL[s]}</small>;
}

export function TextileDeliveryPanel({ order, onSaved }: { order: TextileDeliveryOrder; onSaved: (saved: Partial<TextileDeliveryOrder>) => void }) {
  const status = stepOf(order);
  const [receivedBy, setReceivedBy] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canAct = order.status === 'confirmed';
  const index = STEPS.indexOf(status);
  const stepTime = ['', when(order.textile_dispatched_at), '', when(order.textile_delivered_at)];

  const move = async (next: Exclude<Step, 'confirmed'>) => {
    if (next === 'delivered' && !receivedBy.trim()) { setMessage('Enter the name of the person at the client who received the fabric.'); return; }
    setBusy(true); setMessage('');
    try {
      const res = await api<{ data: Partial<TextileDeliveryOrder> }>(`/textile/orders/${order.id}/delivery`, {
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
        <span>Delivery to client</span>
        <span className={`qd-pill ${status === 'delivered' ? 'ok' : 'warn'}`}>{LABEL[status]}</span>
      </div>

      <div className="sd-steps" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }} aria-label="Delivery progress">
        {STEPS.map((step, i) => (
          <div key={step} className={`sd-step ${i < index ? 'done' : i === index ? 'current' : ''}`}>
            <span className="sd-dot">{i < index || (status === 'delivered' && i === 3) ? '✓' : i + 1}</span>
            <span className="sd-step-name">{STEP_NAME[step]}</span>
            <span className="sd-step-when">{stepTime[i]}</span>
          </div>
        ))}
      </div>

      {(order.textile_received_by || order.textile_delivery_note) && (
        <dl className="sd-info">
          {order.textile_received_by && <div><dt>Received by</dt><dd>{order.textile_received_by}</dd></div>}
          {order.textile_delivered_at && <div><dt>Delivered on</dt><dd>{when(order.textile_delivered_at)}</dd></div>}
          {order.textile_delivery_note && <div className="wide"><dt>Note</dt><dd className="muted">{order.textile_delivery_note}</dd></div>}
        </dl>
      )}

      {status === 'delivered' && <p className="sd-done">✓ Fabric reached the client. This delivery is locked; use a sales return for any problem.</p>}
      {!canAct && status !== 'delivered' && <p className="sd-hint">Only a confirmed order can be dispatched.</p>}

      {canAct && status !== 'delivered' && (
        <div className="sd-form">
          {status !== 'confirmed' && (
            <label className="sd-field">Received by *
              <input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Name of the person at the client" maxLength={120} />
            </label>
          )}
          <label className="sd-field">Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vehicle no., driver, LR number, remarks" maxLength={500} />
          </label>
          {message && <p className="sd-error" role="alert">{message}</p>}
          <div className="sd-actions">
            {status === 'confirmed' && <button type="button" className="sd-btn" disabled={busy} onClick={() => void move('dispatched')}>{busy ? 'Saving…' : 'Mark dispatched'}</button>}
            {status === 'dispatched' && <button type="button" className="sd-btn" disabled={busy} onClick={() => void move('out_for_delivery')}>{busy ? 'Saving…' : 'Out for delivery'}</button>}
            {status !== 'confirmed' && <button type="button" className="sd-btn success" disabled={busy} onClick={() => void move('delivered')}>{busy ? 'Saving…' : 'Mark delivered'}</button>}
          </div>
          <p className="sd-hint" style={{ padding: 0, border: 0 }}>{status === 'confirmed' ? 'Once dispatched, the fabric rolls on this order are marked Sold and the order can no longer be cancelled.' : 'Delivered needs the name of the person who received the fabric.'}</p>
        </div>
      )}
    </div>
  );
}