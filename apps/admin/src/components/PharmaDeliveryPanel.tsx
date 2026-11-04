import { useState } from 'react';
import { api } from '../lib/api';
import './SchoolDeliveryPanel.css';

export type PharmaDeliveryOrder = {
  id: string; status: string; dispatch_status?: string | null;
  pharma_packed_at?: string | null; pharma_dispatched_at?: string | null; pharma_delivered_at?: string | null;
  pharma_vehicle_no?: string | null; pharma_received_by?: string | null; pharma_delivery_note?: string | null;
};
type Step = 'pending' | 'packed' | 'dispatched' | 'delivered';
const LABEL: Record<string, string> = { pending: 'Not dispatched', packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered' };
const ORDER: Step[] = ['pending', 'packed', 'dispatched', 'delivered'];
const STEP_NAME = ['Confirmed', 'Packed', 'Dispatched', 'Delivered'];
const when = (v?: string | null) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/** Small status text under the order status in the Orders list (shown when Pharma is active). */
export function PharmaDeliveryBadge({ order }: { order: PharmaDeliveryOrder }) {
  const s = order.dispatch_status ?? 'pending';
  if (order.status !== 'confirmed' && order.status !== 'completed') return null;
  return <small style={{ display: 'block', fontSize: '.74rem', color: s === 'delivered' ? 'var(--green)' : 'var(--text-faint)' }}>{LABEL[s] ?? s}</small>;
}

/** Pharma only: Packed -> Dispatched (vehicle / LR no.) -> Delivered (received by). Saved in the database. */
export function PharmaDeliveryPanel({ order, onSaved }: { order: PharmaDeliveryOrder; onSaved: (saved: Partial<PharmaDeliveryOrder>) => void }) {
  const status = (order.dispatch_status ?? 'pending') as Step;
  const [vehicleNo, setVehicleNo] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canAct = order.status === 'confirmed';
  const index = Math.max(0, ORDER.indexOf(status));
  const stepTime = ['', when(order.pharma_packed_at), when(order.pharma_dispatched_at), when(order.pharma_delivered_at)];

  const move = async (next: Step) => {
    if (next === 'dispatched' && !vehicleNo.trim() && !order.pharma_vehicle_no) { setMessage('Enter the vehicle number or LR number.'); return; }
    if (next === 'delivered' && !receivedBy.trim()) { setMessage('Enter the name of the person who received the goods.'); return; }
    setBusy(true); setMessage('');
    try {
      const res = await api<{ data: PharmaDeliveryOrder }>(`/pharma/orders/${order.id}/delivery`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next, vehicleNo: next === 'dispatched' ? vehicleNo.trim() || undefined : undefined, receivedBy: next === 'delivered' ? receivedBy.trim() : undefined, note: note.trim() || undefined }),
      });
      onSaved(res.data);
      setNote(''); setReceivedBy(''); setVehicleNo('');
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not update the delivery.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="qd-panel">
      <div className="qd-panel-head">
        <span>Delivery to customer</span>
        <span className={`qd-pill ${status === 'delivered' ? 'ok' : 'warn'}`}>{LABEL[status] ?? status}</span>
      </div>

      <div className="sd-steps" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }} aria-label="Delivery progress">
        {ORDER.map((step, i) => (
          <div key={step} className={`sd-step ${i < index ? 'done' : i === index ? 'current' : ''}`}>
            <span className="sd-dot">{i < index || (status === 'delivered' && i === 3) ? '✓' : i + 1}</span>
            <span className="sd-step-name">{STEP_NAME[i]}</span>
            <span className="sd-step-when">{i === 0 ? '' : stepTime[i]}</span>
          </div>
        ))}
      </div>

      {(order.pharma_vehicle_no || order.pharma_received_by || order.pharma_delivery_note) && (
        <dl className="sd-info">
          {order.pharma_vehicle_no && <div><dt>Vehicle / LR no.</dt><dd>{order.pharma_vehicle_no}</dd></div>}
          {order.pharma_received_by && <div><dt>Received by</dt><dd>{order.pharma_received_by}</dd></div>}
          {order.pharma_delivered_at && <div><dt>Delivered on</dt><dd>{when(order.pharma_delivered_at)}</dd></div>}
          {order.pharma_delivery_note && <div className="wide"><dt>Note</dt><dd className="muted">{order.pharma_delivery_note}</dd></div>}
        </dl>
      )}

      {status === 'delivered' && <p className="sd-done">✓ Goods reached the customer. This delivery is locked; use a sales return for any problem.</p>}
      {!canAct && status !== 'delivered' && <p className="sd-hint">Only a confirmed order can be packed or dispatched.</p>}

      {canAct && status !== 'delivered' && (
        <div className="sd-form">
          {status === 'packed' && (
            <label className="sd-field">Vehicle / LR number *
              <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="e.g. TN 74 AB 1234 or LR 56789" maxLength={60} />
            </label>
          )}
          {status === 'dispatched' && (
            <label className="sd-field">Received by *
              <input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Name of the person at the customer" maxLength={120} />
            </label>
          )}
          <label className="sd-field">Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Driver, cold-chain, remarks" maxLength={500} />
          </label>
          {message && <p className="sd-error" role="alert">{message}</p>}
          <div className="sd-actions">
            {status === 'pending' && <button type="button" className="sd-btn" disabled={busy} onClick={() => void move('packed')}>{busy ? 'Saving…' : 'Mark packed'}</button>}
            {status === 'packed' && <button type="button" className="sd-btn" disabled={busy} onClick={() => void move('dispatched')}>{busy ? 'Saving…' : 'Mark dispatched'}</button>}
            {status === 'dispatched' && <button type="button" className="sd-btn success" disabled={busy} onClick={() => void move('delivered')}>{busy ? 'Saving…' : 'Mark delivered'}</button>}
            {status === 'packed' && <button type="button" className="sd-btn ghost" disabled={busy} onClick={() => void move('pending')}>Undo packed</button>}
            {status === 'dispatched' && <button type="button" className="sd-btn ghost" disabled={busy} onClick={() => void move('packed')}>Undo dispatch</button>}
          </div>
          <p className="sd-hint" style={{ padding: 0, border: 0 }}>Dispatching locks the order (no edit or cancel) and allows the GST invoice. Stock was already taken when the order was confirmed.</p>
        </div>
      )}
    </div>
  );
}
