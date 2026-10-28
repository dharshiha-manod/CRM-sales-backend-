import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import './SchoolDeliveryPanel.css';
import './SchoolReturnsPanel.css';

// Textile only: fabric rolls allocated to this order, and returning a delivered roll (client credited, roll back to stock).
type Roll = { id: string; roll_number: string; product_code?: string | null; fabric_type?: string | null; colour?: string | null; length_meters?: number | null; quality_grade?: string | null; status: string };
export type TextileRollsOrder = { id: string; status: string; textile_delivery_status?: string | null };

export function TextileRollsPanel({ order, onChanged }: { order: TextileRollsOrder; onChanged: (patch: { returns_credit: number }) => void }) {
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [returning, setReturning] = useState<string | null>(null);
  const [condition, setCondition] = useState<'good' | 'damaged'>('good');
  const [reason, setReason] = useState('');
  const [creditClient, setCreditClient] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try { const res = await api<{ data: Roll[] }>(`/textile/orders/${order.id}/rolls`); setRolls(res.data ?? []); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Could not load the rolls.'); }
  }, [order.id]);
  useEffect(() => { void load(); }, [load, order.textile_delivery_status, order.status]);

  const submit = async (roll: Roll) => {
    setBusy(true); setMessage('');
    try {
      const res = await api<{ data: { credit: number; returns_credit: number } }>(`/textile/orders/${order.id}/return-roll`, {
        method: 'POST',
        body: JSON.stringify({ rollId: roll.id, condition, reason: reason.trim() || null, creditClient: condition === 'damaged' ? creditClient : true }),
      });
      setReturning(null); setReason(''); setCondition('good'); setCreditClient(true);
      onChanged({ returns_credit: res.data.returns_credit });
      await load();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not record the return.'); }
    finally { setBusy(false); }
  };

  const total = rolls.reduce((s, r) => s + Number(r.length_meters ?? 0), 0);
  return (
    <div className="qd-panel">
      <div className="qd-panel-head">
        <span>Fabric rolls on this order</span>
        <span className={`qd-pill ${rolls.length ? 'ok' : 'warn'}`}>{rolls.length ? `${rolls.length} ${rolls.length === 1 ? 'roll' : 'rolls'} · ${total} m` : 'None allocated'}</span>
      </div>
      {rolls.length === 0 && <p className="sd-hint">Allocate rolls from Fabric Roll Management (the roll must have a Pass inspection). Rolls must cover the ordered metres before dispatch.</p>}
      {rolls.length > 0 && (
        <div className="sr-list">
          {rolls.map((r) => (
            <div className="sr-row" key={r.id}>
              <div className="sr-top">
                <span className="sr-name">{r.roll_number} · {r.fabric_type ?? 'Fabric'}{r.colour ? ` · ${r.colour}` : ''}</span>
                <span className={`qd-pill ${r.status === 'Sold' ? 'ok' : 'warn'}`}>{r.status}</span>
              </div>
              <div className="sr-meta">{Number(r.length_meters ?? 0)} m{r.quality_grade ? ` · Grade ${r.quality_grade}` : ''}{r.product_code ? ` · ${r.product_code}` : ''}</div>
              {r.status === 'Sold' && order.status !== 'cancelled' && returning !== r.id && (
                <div className="sd-actions"><button type="button" className="sd-btn ghost" onClick={() => { setReturning(r.id); setMessage(''); }}>Return this roll</button></div>
              )}
              {returning === r.id && (
                <div className="sd-form">
                  <div className="sr-grid">
                    <label className="sd-field">Condition
                      <select className="sr-select" value={condition} onChange={(e) => setCondition(e.target.value as 'good' | 'damaged')}>
                        <option value="good">Good - back to stock</option>
                        <option value="damaged">Damaged</option>
                      </select>
                    </label>
                    <label className="sd-field">Reason (optional)
                      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Wrong colour, defect, etc." />
                    </label>
                  </div>
                  {condition === 'damaged' && <label className="sr-check"><input type="checkbox" checked={creditClient} onChange={(e) => setCreditClient(e.target.checked)} />Credit the client (untick if the client bears the loss)</label>}
                  <div className="sd-actions">
                    <button type="button" className="sd-btn" disabled={busy} onClick={() => void submit(r)}>{busy ? 'Saving…' : 'Confirm return'}</button>
                    <button type="button" className="sd-btn ghost" disabled={busy} onClick={() => setReturning(null)}>Back</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {message && <p className="sd-error" role="alert">{message}</p>}
      <p className="sd-hint">Returning a roll credits the client for its metres and takes the roll off this order.</p>
    </div>
  );
}