import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import './RollLedger.css';

// Textile: one roll's metre summary + full transaction history, with "record damaged length" and "stock correction".
export type LedgerRoll = { id: string; roll_number: string; status?: string; product_code?: string | null };
type RollFull = LedgerRoll & {
  original_length_meters?: number | null; length_meters?: number | null; reserved_meters?: number | null;
  sold_meters?: number | null; damaged_meters?: number | null; fabric_type?: string | null; colour?: string | null; lot_number?: string | null;
};
type Txn = { id: string; txn_type: string; quantity_m: number; available_delta: number; balance_after: number; order_number?: string | null; note?: string | null; created_at: string };
type Cut = { id: string; order_number?: string | null; metres: number; status: string };

const LABEL: Record<string, string> = {
  receipt: 'Received', cut_reserve: 'Cut for order', cut_sold: 'Dispatched', cut_release: 'Cut released',
  damage: 'Damaged length', adjustment: 'Stock correction', return: 'Returned', transfer: 'Transfer',
};
const m = (n: unknown) => `${Math.round((Number(n ?? 0) || 0) * 100) / 100} m`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100} m`;

export function RollLedgerDialog({ roll, canEdit = true, onClose, onChanged }: { roll: LedgerRoll; canEdit?: boolean; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ roll: RollFull; transactions: Txn[]; cuts: Cut[] } | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'damage' | 'adjust'>('damage');
  const [metres, setMetres] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: { roll: RollFull; transactions: Txn[]; cuts: Cut[] } }>(`/textile/fabric-rolls/${roll.id}/transactions`);
      setData(res.data); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load the roll ledger.'); }
  }, [roll.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const r = data?.roll;
  const inStock = r?.status === 'In stock';
  const canDamage = canEdit && inStock;
  const canAdjust = canEdit && (r?.status === 'In stock' || r?.status === 'Quarantine' || r?.status === 'Damaged');

  async function submit() {
    const n = Number(metres);
    if (!Number.isFinite(n) || n === 0) { setError('Enter the metres.'); return; }
    if (mode === 'damage' && n < 0) { setError('Damaged metres must be positive.'); return; }
    if (mode === 'adjust' && reason.trim().length < 3) { setError('A reason is required for a stock correction.'); return; }
    setBusy(true); setError('');
    try {
      await api(`/textile/fabric-rolls/${roll.id}/${mode === 'damage' ? 'damage' : 'adjust'}`, {
        method: 'POST', body: JSON.stringify({ metres: n, reason: reason.trim() || null }),
      });
      setMetres(''); setReason('');
      await load(); onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  return createPortal(
    <div className="rl-overlay" role="dialog" aria-modal="true" aria-label={`Roll ledger ${roll.roll_number}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rl-card">
        <header className="rl-head">
          <div>
            <h3>Roll {roll.roll_number}</h3>
            <p>{[r?.fabric_type, r?.colour, r?.lot_number ? `Lot ${r.lot_number}` : null, r?.product_code].filter(Boolean).join(' · ') || ' '}</p>
          </div>
          <button type="button" className="rl-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="rl-tiles">
          <div><span>Original</span><b>{m(r?.original_length_meters)}</b></div>
          <div className="rl-main"><span>Available</span><b>{m(r?.length_meters)}</b></div>
          <div><span>Reserved (cut)</span><b>{m(r?.reserved_meters)}</b></div>
          <div><span>Sold (cut)</span><b>{m(r?.sold_meters)}</b></div>
          <div><span>Damaged</span><b>{m(r?.damaged_meters)}</b></div>
        </div>

        {(canDamage || canAdjust) && (
          <div className="rl-form">
            <div className="rl-tabs">
              {canDamage && <button type="button" className={mode === 'damage' ? 'on' : ''} onClick={() => { setMode('damage'); setError(''); }}>Record damaged length</button>}
              {canAdjust && <button type="button" className={mode === 'adjust' || !canDamage ? 'on' : ''} onClick={() => { setMode('adjust'); setError(''); }}>Stock correction</button>}
            </div>
            <div className="rl-row">
              <label>{mode === 'damage' && canDamage ? 'Damaged metres' : 'Metres (+ found / − lost)'}
                <input type="number" step="0.01" value={metres} onChange={(e) => setMetres(e.target.value)} placeholder={mode === 'damage' && canDamage ? 'e.g. 3.5' : 'e.g. -2'} />
              </label>
              <label>Reason{mode === 'adjust' || !canDamage ? ' (required)' : ''}
                <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={mode === 'damage' && canDamage ? 'Moth holes, stain...' : 'Re-measured on the table'} />
              </label>
              <button type="button" className="rl-save" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
            <p className="rl-hint">Stock can never go below zero. Every change is added to the history below and cannot be edited.</p>
          </div>
        )}
        {error && <p className="rl-error" role="alert">{error}</p>}

        <div className="rl-table-wrap">
          <table className="rl-table">
            <thead><tr><th>Date</th><th>Event</th><th>Order</th><th>Metres</th><th>Balance</th><th>Note</th></tr></thead>
            <tbody>
              {(data?.transactions ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.created_at).toLocaleString()}</td>
                  <td>{LABEL[t.txn_type] ?? t.txn_type}</td>
                  <td>{t.order_number || '—'}</td>
                  <td className={t.available_delta < 0 ? 'neg' : t.available_delta > 0 ? 'pos' : ''}>{t.available_delta === 0 ? `${m(t.quantity_m)} (no change)` : signed(t.available_delta)}</td>
                  <td>{m(t.balance_after)}</td>
                  <td>{t.note || '—'}</td>
                </tr>
              ))}
              {data && data.transactions.length === 0 && <tr><td colSpan={6} className="rl-empty">No movements yet.</td></tr>}
              {!data && !error && <tr><td colSpan={6} className="rl-empty">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}