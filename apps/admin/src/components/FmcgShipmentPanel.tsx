// FILE: admin/src/components/FmcgShipmentPanel.tsx
// Proper shipments for an FMCG order (local AND international): many shipments per order,
// quantities per product, vehicle / container, ship + delivery dates. All saved in the database.
// Rendered by OrdersPage only when the active industry is FMCG.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

type Line = { order_item_id: string; product_name: string; product_code: string; ordered: number; shipped: number; packed: number; remaining: number };
type Shipment = {
  id: string; shipment_no: string; status: string; transport_ref: string | null; shipped_at: string | null; expected_arrival: string | null;
  delivered_at: string | null; notes: string | null; items: Array<{ order_item_id: string; product_name: string; quantity: number }>;
};
type View = { dispatch_status: string; total_ordered: number; total_shipped: number; lines: Line[]; shipments: Shipment[] };
export type ShipmentOrder = { id: string; status: string; clients?: { country_code?: string | null } | null };

const OVERALL: Record<string, string> = { pending: 'Not shipped', packed: 'Packed', partially_shipped: 'Partially shipped', dispatched: 'Dispatched', delivered: 'Delivered' };
const tone = (s: string) => (s === 'delivered' ? 'ok' : 'warn');
const badge = (s: string) => (s === 'delivered' ? 'paid' : s === 'dispatched' ? 'quoted' : s === 'cancelled' ? 'overdue' : 'confirmed');
const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

type Action = { id: string; mode: 'dispatch' | 'deliver' | 'edit' } | null;

export function FmcgShipmentPanel({ order, onSaved }: { order: ShipmentOrder; onSaved: (saved: { dispatch_status: string }) => void }) {
  const international = !!order.clients?.country_code && order.clients.country_code.toUpperCase() !== 'IN';
  const canCreate = order.status === 'confirmed' || order.status === 'completed';
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  // New shipment form
  const [creating, setCreating] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [newRef, setNewRef] = useState('');
  const [newEta, setNewEta] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Update form for one shipment
  const [action, setAction] = useState<Action>(null);
  const [fRef, setFRef] = useState('');
  const [fShipped, setFShipped] = useState('');
  const [fEta, setFEta] = useState('');
  const [fDelivered, setFDelivered] = useState('');
  const [fNotes, setFNotes] = useState('');

  const refLabel = international ? 'Container / AWB / BL number' : 'Vehicle / LR number';
  const etaLabel = international ? 'Expected arrival (ETA)' : 'Expected delivery';

  const apply = useCallback((next: View, text?: string) => {
    setView(next); onSaved({ dispatch_status: next.dispatch_status });
    if (text) { setOk(true); setMessage(text); }
  }, [onSaved]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api<{ data: View }>(`/orders/${order.id}/shipments`)
      .then((res) => { if (live) setView(res.data); })
      .catch((err: Error) => { if (live) { setOk(false); setMessage(err.message); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [order.id]);

  function openCreate() {
    if (!view) return;
    const next: Record<string, string> = {};
    for (const line of view.lines) next[line.order_item_id] = line.remaining > 0 ? String(line.remaining) : '';
    setQty(next); setNewRef(''); setNewEta(''); setNewNotes(''); setCreating(true); setAction(null); setMessage('');
  }

  async function create() {
    if (!view) return;
    const items = view.lines.map((l) => ({ orderItemId: l.order_item_id, quantity: Number(qty[l.order_item_id] || 0) })).filter((i) => i.quantity > 0);
    setBusy(true); setMessage('');
    try {
      const res = await api<{ data: View }>(`/orders/${order.id}/shipments`, { method: 'POST', body: JSON.stringify({ items, transportRef: newRef || null, expectedArrival: newEta || null, notes: newNotes || null }) });
      apply(res.data, 'Shipment created (packed).'); setCreating(false);
    } catch (err) { setOk(false); setMessage((err as Error).message); } finally { setBusy(false); }
  }

  function openAction(s: Shipment, mode: 'dispatch' | 'deliver' | 'edit') {
    setAction({ id: s.id, mode }); setCreating(false); setMessage('');
    setFRef(s.transport_ref ?? ''); setFEta(s.expected_arrival ?? ''); setFNotes(s.notes ?? '');
    setFShipped(s.shipped_at ?? (mode === 'dispatch' ? todayLocal() : ''));
    setFDelivered(s.delivered_at ?? (mode === 'deliver' ? todayLocal() : ''));
  }

  async function patch(id: string, body: Record<string, unknown>, text: string) {
    setBusy(true); setMessage('');
    try {
      const res = await api<{ data: View }>(`/fmcg/shipments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      apply(res.data, text); setAction(null);
    } catch (err) { setOk(false); setMessage((err as Error).message); } finally { setBusy(false); }
  }

  function submitAction() {
    if (!action) return;
    const base = { transportRef: fRef || null, expectedArrival: fEta || null, notes: fNotes || null };
    if (action.mode === 'dispatch') void patch(action.id, { ...base, status: 'dispatched', shippedAt: fShipped || null }, 'Shipment dispatched.');
    else if (action.mode === 'deliver') void patch(action.id, { ...base, status: 'delivered', shippedAt: fShipped || null, deliveredAt: fDelivered || null }, 'Shipment marked delivered.');
    else void patch(action.id, base, 'Shipment updated.');
  }

  function cancelShipment(s: Shipment) {
    if (window.confirm(`Cancel shipment ${s.shipment_no}? Its quantities go back to "remaining".`)) void patch(s.id, { status: 'cancelled' }, 'Shipment cancelled.');
  }

  const anyRemaining = !!view && view.lines.some((l) => l.remaining > 0);

  return (
    <div className="qd-panel">
      <div className="qd-panel-head">
        <span>Shipments ({international ? 'international' : 'local'})</span>
        {view && <span className={`qd-pill ${tone(view.dispatch_status)}`}>{OVERALL[view.dispatch_status] ?? view.dispatch_status} · {view.total_shipped}/{view.total_ordered} shipped</span>}
      </div>

      {loading && <p className="muted">Loading shipments…</p>}

      {view && (
        <>
          <div className="data-table-wrap qd-items">
            <table>
              <thead><tr><th>Product</th><th>Ordered</th><th>Shipped</th><th>Packed</th><th>Remaining</th></tr></thead>
              <tbody>
                {view.lines.map((l) => (
                  <tr key={l.order_item_id}><td>{l.product_name}</td><td>{l.ordered}</td><td>{l.shipped}</td><td>{l.packed}</td><td><strong>{l.remaining}</strong></td></tr>
                ))}
              </tbody>
            </table>
          </div>

          {view.shipments.length === 0 && <p className="muted" style={{ margin: '10px 0' }}>No shipments yet.</p>}

          {view.shipments.map((s) => (
            <div key={s.id} style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 10, padding: 12, margin: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong>{s.shipment_no}</strong>
                <span className={`status-badge status-${badge(s.status)}`}>{s.status}</span>
              </div>
              <div style={{ margin: '6px 0', fontSize: 14 }}>{s.items.map((i) => `${i.product_name} × ${i.quantity}`).join(', ')}</div>
              <div style={{ fontSize: 13, display: 'grid', gap: 2 }}>
                <span>{refLabel}: {s.transport_ref || '—'}</span>
                <span>Shipped: {fmtDate(s.shipped_at)} · {etaLabel}: {fmtDate(s.expected_arrival)} · Delivered: {fmtDate(s.delivered_at)}</span>
                {s.notes && <span>Notes: {s.notes}</span>}
              </div>

              {action?.id === s.id ? (
                <div style={{ marginTop: 10 }}>
                  <div className="master-modal-form" style={{ padding: 0 }}>
                    <label>{refLabel}<input value={fRef} onChange={(e) => setFRef(e.target.value)} maxLength={80} /></label>
                    {action.mode !== 'edit' && <label>Ship date<input type="date" value={fShipped} onChange={(e) => setFShipped(e.target.value)} /></label>}
                    <label>{etaLabel}<input type="date" value={fEta} onChange={(e) => setFEta(e.target.value)} /></label>
                    {action.mode === 'deliver' && <label>Delivered on<input type="date" value={fDelivered} onChange={(e) => setFDelivered(e.target.value)} /></label>}
                    {action.mode === 'edit' && <label>Notes<input value={fNotes} onChange={(e) => setFNotes(e.target.value)} maxLength={500} /></label>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="primary-action" disabled={busy} onClick={submitAction}>{busy ? 'Saving…' : action.mode === 'dispatch' ? 'Confirm dispatch' : action.mode === 'deliver' ? 'Confirm delivery' : 'Save'}</button>
                    <button type="button" className="secondary-action" onClick={() => setAction(null)}>Close</button>
                  </div>
                </div>
              ) : (
                s.status !== 'cancelled' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {s.status === 'packed' && <button type="button" className="primary-action" onClick={() => openAction(s, 'dispatch')}>Dispatch</button>}
                    {s.status === 'dispatched' && <button type="button" className="primary-action" onClick={() => openAction(s, 'deliver')}>Mark delivered</button>}
                    <button type="button" className="secondary-action" onClick={() => openAction(s, 'edit')}>Edit details</button>
                    {s.status === 'packed' && <button type="button" className="secondary-action" onClick={() => cancelShipment(s)}>Cancel shipment</button>}
                  </div>
                )
              )}
            </div>
          ))}

          {creating ? (
            <div style={{ border: '1px dashed var(--line, #cbd5e1)', borderRadius: 10, padding: 12, margin: '10px 0' }}>
              <strong>New shipment</strong>
              <div className="data-table-wrap qd-items" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th>Product</th><th>Remaining</th><th>Quantity in this shipment</th></tr></thead>
                  <tbody>
                    {view.lines.map((l) => (
                      <tr key={l.order_item_id}>
                        <td>{l.product_name}</td><td>{l.remaining}</td>
                        <td><input type="number" min={0} max={l.remaining} step="any" disabled={l.remaining <= 0} value={qty[l.order_item_id] ?? ''} onChange={(e) => setQty({ ...qty, [l.order_item_id]: e.target.value })} style={{ width: 110 }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="master-modal-form" style={{ padding: 0, marginTop: 8 }}>
                <label>{refLabel}<input value={newRef} onChange={(e) => setNewRef(e.target.value)} maxLength={80} placeholder={international ? 'e.g. MSKU1234567' : 'e.g. TN 09 AB 1234'} /></label>
                <label>{etaLabel}<input type="date" value={newEta} onChange={(e) => setNewEta(e.target.value)} /></label>
                <label>Notes<input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} maxLength={500} /></label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="primary-action" disabled={busy} onClick={() => void create()}>{busy ? 'Saving…' : 'Create shipment'}</button>
                <button type="button" className="secondary-action" onClick={() => setCreating(false)}>Close</button>
              </div>
            </div>
          ) : (
            canCreate && anyRemaining && <button type="button" className="primary-action" onClick={openCreate}>+ New shipment</button>
          )}
          {!canCreate && <p className="muted">Shipments can be created only after the order is confirmed.</p>}
          {canCreate && !anyRemaining && view.shipments.length > 0 && <p className="muted">Everything on this order is in a shipment.</p>}
        </>
      )}

      {message && <p className={ok ? 'success-message' : 'error-message'}>{message}</p>}
    </div>
  );
}