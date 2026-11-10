import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './SchoolDeliveryPanel.css';
import './SchoolReturnsPanel.css';

// Textile only: sell fabric BY THE METRE from a roll. The metres are taken off the roll straight away,
// the roll keeps the rest, and the order is covered once its ordered metres are cut.
type CutLine = { product_code: string; product_name: string; ordered: number; covered: number; remaining: number; colours: string[] };
type CutRoll = { id: string; roll_number: string; product_code: string; colour?: string | null; lot_number?: string | null; length_meters: number; quality_grade?: string | null; warehouse_location?: string | null };
type Cut = { id: string; roll_number: string; product_code?: string | null; metres: number; status: string };
export type TextileCutOrder = { id: string; status: string; textile_delivery_status?: string | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function TextileCutPanel({ order, onChanged }: { order: TextileCutOrder; onChanged: () => void }) {
  const [options, setOptions] = useState<{ open: boolean; lines: CutLine[]; rolls: CutRoll[] } | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [productCode, setProductCode] = useState('');
  const [rollId, setRollId] = useState('');
  const [metres, setMetres] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const [o, c] = await Promise.all([
        api<{ data: { open: boolean; lines: CutLine[]; rolls: CutRoll[] } }>(`/textile/orders/${order.id}/cut-options`),
        api<{ data: Cut[] }>(`/textile/orders/${order.id}/cuts`),
      ]);
      setOptions(o.data); setCuts(c.data ?? []);
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not load the fabric cuts.'); }
  }, [order.id]);
  useEffect(() => { void load(); }, [load, order.status, order.textile_delivery_status]);

  const lines = options?.lines ?? [];
  const needy = lines.filter((l) => l.remaining > 0);
  const activeCode = productCode || needy[0]?.product_code || '';
  const activeLine = lines.find((l) => l.product_code === activeCode);
  const rolls = useMemo(() => (options?.rolls ?? []).filter((r) => r.product_code === activeCode), [options, activeCode]);
  const picked = rolls.find((r) => r.id === rollId);
  const maxCut = picked && activeLine ? Math.min(picked.length_meters, activeLine.remaining) : 0;

  function pickRoll(id: string) {
    setRollId(id);
    const r = rolls.find((x) => x.id === id);
    if (r && activeLine) setMetres(String(r2(Math.min(r.length_meters, activeLine.remaining))));
  }

  async function cut() {
    const n = Number(metres);
    if (!rollId) { setMessage('Pick a roll.'); return; }
    if (!Number.isFinite(n) || n <= 0) { setMessage('Enter the metres to cut.'); return; }
    if (picked && n > picked.length_meters + 1e-9) { setMessage(`Roll ${picked.roll_number} has only ${picked.length_meters} m.`); return; }
    setBusy(true); setMessage('');
    try {
      await api(`/textile/orders/${order.id}/cut-roll`, { method: 'POST', body: JSON.stringify({ rollId, metres: n }) });
      setRollId(''); setMetres('');
      await load(); onChanged();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not cut the fabric.'); }
    finally { setBusy(false); }
  }

  async function release(c: Cut) {
    if (!window.confirm(`Remove the ${c.metres} m cut from roll ${c.roll_number}? The metres go back on the roll.`)) return;
    setBusy(true); setMessage('');
    try { await api(`/textile/cuts/${c.id}`, { method: 'DELETE' }); await load(); onChanged(); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Could not remove the cut.'); }
    finally { setBusy(false); }
  }

  if (!options) return message ? <p className="sd-error" role="alert">{message}</p> : null;
  const totalRemaining = r2(lines.reduce((s, l) => s + l.remaining, 0));
  if (!lines.length) return null;

  return (
    <div className="qd-panel">
      <div className="qd-panel-head">
        <span>Cut fabric by the metre</span>
        <span className={`qd-pill ${totalRemaining === 0 ? 'ok' : 'warn'}`}>{totalRemaining === 0 ? 'Fully covered' : `${totalRemaining} m still to cover`}</span>
      </div>

      <div className="sr-list">
        {lines.map((l) => (
          <div className="sr-row" key={l.product_code}>
            <div className="sr-top"><span className="sr-name">{l.product_name}{l.colours.length ? ` · ${l.colours.join(', ')}` : ''}</span></div>
            <div className="sr-meta">Ordered {l.ordered} m · covered {l.covered} m · remaining {l.remaining} m</div>
          </div>
        ))}
      </div>

      {options.open && needy.length > 0 && (
        <div className="sd-form">
          <div className="sr-grid">
            {needy.length > 1 && (
              <label className="sd-field">Product
                <select className="sr-select" value={activeCode} onChange={(e) => { setProductCode(e.target.value); setRollId(''); setMetres(''); }}>
                  {needy.map((l) => <option key={l.product_code} value={l.product_code}>{l.product_name}</option>)}
                </select>
              </label>
            )}
            <label className="sd-field">Roll
              <select className="sr-select" value={rollId} onChange={(e) => pickRoll(e.target.value)}>
                <option value="">{rolls.length ? 'Select a roll…' : 'No inspected (Pass) rolls in stock'}</option>
                {rolls.map((r) => (
                  <option key={r.id} value={r.id}>{r.roll_number}{r.colour ? ` · ${r.colour}` : ''}{r.lot_number ? ` · Lot ${r.lot_number}` : ''} · {r.length_meters} m left</option>
                ))}
              </select>
            </label>
            <label className="sd-field">Metres to cut{picked ? ` (max ${r2(maxCut)})` : ''}
              <input type="number" step="0.01" min="0" value={metres} onChange={(e) => setMetres(e.target.value)} />
            </label>
          </div>
          <div className="sd-actions">
            <button type="button" className="sd-btn" disabled={busy || !rollId} onClick={() => void cut()}>{busy ? 'Saving…' : 'Cut & reserve'}</button>
          </div>
        </div>
      )}

      {cuts.length > 0 && (
        <div className="sr-list">
          {cuts.map((c) => (
            <div className="sr-row" key={c.id}>
              <div className="sr-top">
                <span className="sr-name">{c.metres} m from roll {c.roll_number}</span>
                <span className={`qd-pill ${c.status === 'Sold' ? 'ok' : 'warn'}`}>{c.status === 'Sold' ? 'Dispatched' : 'Reserved'}</span>
              </div>
              {c.status === 'Reserved' && order.status !== 'cancelled' && (
                <div className="sd-actions"><button type="button" className="sd-btn ghost" disabled={busy} onClick={() => void release(c)}>Remove cut</button></div>
              )}
            </div>
          ))}
        </div>
      )}

      {message && <p className="sd-error" role="alert">{message}</p>}
      <p className="sd-hint">Cut metres leave the roll immediately; the rest stays on the roll for other customers. Cuts become Sold when the order is dispatched and go back on the roll if the order is cancelled.</p>
    </div>
  );
}