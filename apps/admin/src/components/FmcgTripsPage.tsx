// FMCG Delivery Trips: plan a vehicle run with many packed shipments, dispatch them together, deliver stop by stop
// (who received, short / damaged units), then settle the driver's cash.
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

type Stop = { id: string; shipment_no: string; status: string; order_number: string | null; order_total: number; payment_type: string | null; client_name: string; city: string | null; delivered_at: string | null; received_by: string | null; items: Array<{ id: string; product_name: string; quantity: number; short_quantity: number; damaged_quantity: number }> };
type Trip = { id: string; trip_no: string; trip_date: string; route_name: string | null; vehicle_no: string; driver_name: string | null; driver_phone: string | null; status: 'planned' | 'dispatched' | 'completed' | 'cancelled'; notes: string | null; expenses: number | null; cash_handed_over: number | null; settlement_notes: string | null; settled_at: string | null; stop_count?: number; delivered_count?: number; value?: number; stops?: Stop[]; cod_expected?: number; shortfall?: number };
type Available = { id: string; shipment_no: string; order_number: string | null; order_total: number; payment_type: string | null; client_name: string; city: string | null; units: number };
type DispatchResult = { shipment_no: string; ok: boolean; message?: string };

const money = (v: number | null | undefined) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v ?? 0);
const dt = (v: string | null) => (v ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(v)) : '—');
const todayStr = () => new Date().toLocaleDateString('en-CA');
const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const TONE: Record<string, string> = { planned: '#2563eb', dispatched: '#d97706', completed: '#15803d', cancelled: '#b91c1c', packed: '#2563eb', delivered: '#15803d' };
const Chip = ({ s }: { s: string }) => <span style={{ background: `${TONE[s] ?? '#64748b'}1a`, color: TONE[s] ?? '#64748b', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{s === 'dispatched' ? 'on the road' : s}</span>;
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 };
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label style={{ display: 'grid', gap: 4, fontSize: 13 }}><span>{label}</span>{children}</label>;
const Kpi = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => <div className="kpi-card" style={{ minWidth: 150 }}><div><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div></div>;
function Modal({ title, eyebrow, onClose, children, wide }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`master-modal${wide ? ' master-modal--wide' : ''}`} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div><button className="icon-action" type="button" aria-label="Close" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}

export function FmcgTripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [msg, setMsg] = useState(''); const [status, setStatus] = useState('all'); const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Trip | null>(null);          // trip detail
  const [form, setForm] = useState<{ trip_date: string; route_name: string; vehicle_no: string; driver_name: string; driver_phone: string; notes: string } | null>(null); // new trip
  const [pick, setPick] = useState<string[]>([]); const [avail, setAvail] = useState<Available[]>([]); const [pickFor, setPickFor] = useState<'new' | 'add' | null>(null);
  const [deliver, setDeliver] = useState<{ stop: Stop; date: string; by: string; lines: Array<{ id: string; short: string; damaged: string }> } | null>(null);
  const [settle, setSettle] = useState({ expenses: '', handed: '', notes: '' });
  const [results, setResults] = useState<DispatchResult[]>([]);
  const [busy, setBusy] = useState(false); const [modalError, setModalError] = useState('');

  async function load() {
    setLoading(true);
    try { setTrips((await api<{ data: Trip[] }>('/fmcg/trips')).data ?? []); setError(''); } catch (e) { setError(errText(e, 'Unable to load trips.')); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function loadAvail() { try { setAvail((await api<{ data: Available[] }>('/fmcg/trips/available-shipments')).data ?? []); } catch (e) { setModalError(errText(e, 'Unable to load packed shipments.')); } }
  async function reopen(id: string) { const t = (await api<{ data: Trip }>(`/fmcg/trips/${id}`)).data; setOpen(t); setSettle({ expenses: t.expenses == null ? '' : String(t.expenses), handed: t.cash_handed_over == null ? '' : String(t.cash_handed_over), notes: t.settlement_notes ?? '' }); return t; }
  async function openTrip(t: Trip) { setModalError(''); setResults([]); try { await reopen(t.id); } catch (e) { setError(errText(e, 'Unable to open the trip.')); } }
  async function run(fn: () => Promise<void>, ok?: string) {
    setBusy(true); setModalError('');
    try { await fn(); if (ok) setMsg(ok); await load(); } catch (e) { setModalError(errText(e, 'Action failed.')); } finally { setBusy(false); }
  }

  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return trips.filter((t) => (status === 'all' || t.status === status) && (!q || [t.trip_no, t.vehicle_no, t.driver_name, t.route_name].some((v) => (v ?? '').toLowerCase().includes(q)))); }, [trips, status, search]);
  const count = (s: string) => trips.filter((t) => t.status === s).length;

  function newTrip() { setForm({ trip_date: todayStr(), route_name: '', vehicle_no: '', driver_name: '', driver_phone: '', notes: '' }); setPick([]); setPickFor('new'); setModalError(''); void loadAvail(); }
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  async function createTrip(e: FormEvent) {
    e.preventDefault(); if (!form) return;
    await run(async () => { const t = (await api<{ data: Trip }>('/fmcg/trips', { method: 'POST', body: JSON.stringify({ ...form, shipment_ids: pick }) })).data; setForm(null); setPickFor(null); await reopen(t.id); }, 'Trip created.');
  }
  async function addStops() { if (!open) return; await run(async () => { await api(`/fmcg/trips/${open.id}/stops`, { method: 'POST', body: JSON.stringify({ shipment_ids: pick }) }); setPickFor(null); setPick([]); await reopen(open.id); }, 'Shipments added to the trip.'); }
  async function removeStop(s: Stop) { if (!open) return; await run(async () => { await api(`/fmcg/trips/${open.id}/stops/${s.id}`, { method: 'DELETE' }); await reopen(open.id); }); }
  async function dispatch() {
    if (!open || !window.confirm(`Dispatch ${open.trip_no}? Every packed stop is marked dispatched on ${open.vehicle_no}.`)) return;
    await run(async () => { const r = (await api<{ data: { results: DispatchResult[] } }>(`/fmcg/trips/${open.id}/dispatch`, { method: 'POST', body: '{}' })).data; setResults(r.results); await reopen(open.id); }, 'Trip dispatched.');
  }
  async function cancel() { if (!open || !window.confirm(`Cancel ${open.trip_no}? Its shipments go back to packed and can join another trip.`)) return; await run(async () => { await api(`/fmcg/trips/${open.id}/cancel`, { method: 'POST', body: '{}' }); setOpen(null); }, 'Trip cancelled.'); }
  function startDeliver(s: Stop) { setDeliver({ stop: s, date: todayStr(), by: '', lines: s.items.map((i) => ({ id: i.id, short: '', damaged: '' })) }); setModalError(''); }
  async function submitDeliver(e: FormEvent) {
    e.preventDefault(); if (!open || !deliver) return;
    const receipt = deliver.lines.filter((l) => Number(l.short) > 0 || Number(l.damaged) > 0).map((l) => ({ item_id: l.id, short_quantity: Number(l.short) || 0, damaged_quantity: Number(l.damaged) || 0 }));
    await run(async () => { await api(`/fmcg/trips/${open.id}/stops/${deliver.stop.id}/deliver`, { method: 'POST', body: JSON.stringify({ delivered_at: deliver.date, received_by: deliver.by, receipt }) }); setDeliver(null); await reopen(open.id); }, `${deliver.stop.shipment_no} delivered.`);
  }
  async function saveSettle(e: FormEvent) { e.preventDefault(); if (!open) return; await run(async () => { await api(`/fmcg/trips/${open.id}/settle`, { method: 'POST', body: JSON.stringify({ expenses: settle.expenses, cash_handed_over: settle.handed, settlement_notes: settle.notes }) }); await reopen(open.id); }, 'Settlement saved.'); }

  const stops = open?.stops ?? [];
  const packedLeft = stops.filter((s) => s.status === 'packed').length;
  const shortfall = (open?.cod_expected ?? 0) - (Number(settle.expenses) || 0) - (Number(settle.handed) || 0);
  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading"><div><p className="eyebrow">FMCG · DELIVERY TRIPS</p><h2>Delivery trips</h2><p>Load many packed shipments on one vehicle, dispatch together, deliver stop by stop and settle the driver’s cash.</p></div>
        <button className="primary-action" onClick={newTrip}>+ New trip</button></div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '0 0 12px' }}>
        <Kpi label="Planned" value={count('planned')} /><Kpi label="On the road" value={count('dispatched')} /><Kpi label="Completed" value={count('completed')} />
        <Kpi label="To settle" value={trips.filter((t) => t.status === 'completed' && !t.settled_at).length} sub="cash not settled yet" />
      </div>
      <div className="master-toolbar"><div className="master-search"><input type="search" placeholder="Search trip, vehicle, driver or route" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All status</option>{['planned', 'dispatched', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s === 'dispatched' ? 'on the road' : s}</option>)}</select></div></div>
      {error && <p className="error-message">{error}</p>}{msg && <p className="success-message">{msg}</p>}
      <div className="data-table-wrap"><table>
        <thead><tr><th>Trip</th><th>Date</th><th>Route</th><th>Vehicle / driver</th><th>Stops</th><th>Order value</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={8} className="empty-row">Loading…</td></tr>}
          {!loading && filtered.map((t) => (
            <tr key={t.id}><td><strong>{t.trip_no}</strong></td><td>{dt(t.trip_date)}</td><td>{t.route_name || '—'}</td><td>{t.vehicle_no}<small style={{ display: 'block' }}>{t.driver_name || '—'}{t.driver_phone ? ` · ${t.driver_phone}` : ''}</small></td>
              <td>{t.delivered_count ?? 0} / {t.stop_count ?? 0} delivered</td><td>{money(t.value)}</td>
              <td><Chip s={t.status} />{t.status === 'completed' && !t.settled_at && <small style={{ display: 'block', color: '#d97706' }}>settlement pending</small>}</td>
              <td><button onClick={() => void openTrip(t)}>Open</button></td></tr>
          ))}
          {!loading && filtered.length === 0 && <tr><td colSpan={8} className="empty-row">{trips.length === 0 ? 'No trips yet. Pack shipments from Orders, then create a trip.' : 'No trips match your filters.'}</td></tr>}
        </tbody></table></div>

      {form && pickFor === 'new' && (
        <Modal eyebrow="NEW TRIP" title="Plan a delivery trip" onClose={() => { setForm(null); setPickFor(null); }} wide>
          <form onSubmit={createTrip} style={{ display: 'grid', gap: 14 }}>
            <div style={grid}>
              <Field label="Trip date"><input type="date" value={form.trip_date} onChange={(e) => setForm({ ...form, trip_date: e.target.value })} /></Field>
              <Field label="Route / area"><input value={form.route_name} onChange={(e) => setForm({ ...form, route_name: e.target.value })} /></Field>
              <Field label="Vehicle number *"><input required value={form.vehicle_no} onChange={(e) => setForm({ ...form, vehicle_no: e.target.value.toUpperCase() })} /></Field>
              <Field label="Driver"><input value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} /></Field>
              <Field label="Driver phone"><input value={form.driver_phone} onChange={(e) => setForm({ ...form, driver_phone: e.target.value })} /></Field>
              <Field label="Notes"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
            <PickList avail={avail} pick={pick} toggle={toggle} />
            {modalError && <p className="error-message">{modalError}</p>}
            <div className="modal-actions"><button type="button" onClick={() => { setForm(null); setPickFor(null); }}>Cancel</button><button className="primary-action" disabled={busy}>{busy ? 'Saving…' : `Create trip (${pick.length} stop${pick.length === 1 ? '' : 's'})`}</button></div>
          </form>
        </Modal>
      )}

      {open && !form && (
        <Modal eyebrow={`TRIP · ${open.trip_no}`} title={`${open.vehicle_no}${open.route_name ? ` · ${open.route_name}` : ''}`} onClose={() => { setOpen(null); setPickFor(null); }} wide>
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><Chip s={open.status} /><span>{dt(open.trip_date)} · {open.driver_name || 'no driver'}{open.driver_phone ? ` · ${open.driver_phone}` : ''}</span></div>
            {results.some((r) => !r.ok) && <p className="error-message">Some stops could not be dispatched and stay packed: {results.filter((r) => !r.ok).map((r) => `${r.shipment_no} – ${r.message}`).join(' | ')}</p>}
            <div className="data-table-wrap"><table>
              <thead><tr><th>Shipment</th><th>Customer</th><th>Items</th><th>Order value</th><th>Payment</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {stops.map((s) => (
                  <tr key={s.id}><td><strong>{s.shipment_no}</strong><small style={{ display: 'block' }}>{s.order_number}</small></td><td>{s.client_name}<small style={{ display: 'block' }}>{s.city}</small></td>
                    <td>{s.items.map((i) => <small key={i.id} style={{ display: 'block' }}>{i.product_name} × {i.quantity}{i.short_quantity || i.damaged_quantity ? ` (short ${i.short_quantity}, damaged ${i.damaged_quantity})` : ''}</small>)}</td>
                    <td>{money(s.order_total)}</td><td style={{ textTransform: 'uppercase' }}>{s.payment_type ?? '—'}</td>
                    <td><Chip s={s.status} />{s.received_by && <small style={{ display: 'block' }}>received by {s.received_by}</small>}</td>
                    <td className="master-actions">{open.status === 'planned' && <button onClick={() => void removeStop(s)}>Remove</button>}{open.status === 'dispatched' && s.status === 'dispatched' && <button className="primary-action" onClick={() => startDeliver(s)}>Delivered</button>}</td></tr>
                ))}
                {stops.length === 0 && <tr><td colSpan={7} className="empty-row">No shipments on this trip yet.</td></tr>}
              </tbody></table></div>
            {pickFor === 'add' && <><PickList avail={avail} pick={pick} toggle={toggle} /><div className="modal-actions"><button onClick={() => setPickFor(null)}>Close list</button><button className="primary-action" disabled={busy || pick.length === 0} onClick={() => void addStops()}>Add {pick.length} to trip</button></div></>}
            {modalError && !deliver && <p className="error-message">{modalError}</p>}
            <div className="modal-actions">
              {open.status === 'planned' && <><button onClick={() => void cancel()} disabled={busy}>Cancel trip</button><button onClick={() => { setPick([]); setPickFor('add'); void loadAvail(); }}>+ Add shipments</button></>}
              {(open.status === 'planned' || (open.status === 'dispatched' && packedLeft > 0)) && <button className="primary-action" disabled={busy || packedLeft === 0} onClick={() => void dispatch()}>{open.status === 'dispatched' ? `Retry dispatch (${packedLeft})` : 'Dispatch trip'}</button>}
            </div>
            {open.status === 'completed' && (
              <form onSubmit={saveSettle} style={{ display: 'grid', gap: 12, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                <strong>Driver cash settlement</strong>
                <div style={grid}>
                  <Field label="COD cash collected on this trip"><input readOnly value={money(open.cod_expected)} /></Field>
                  <Field label="Driver expenses (fuel, toll…) ₹"><input type="number" min={0} step="any" value={settle.expenses} onChange={(e) => setSettle({ ...settle, expenses: e.target.value })} /></Field>
                  <Field label="Cash handed over ₹"><input type="number" min={0} step="any" value={settle.handed} onChange={(e) => setSettle({ ...settle, handed: e.target.value })} /></Field>
                  <Field label="Notes"><input value={settle.notes} onChange={(e) => setSettle({ ...settle, notes: e.target.value })} /></Field>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <strong style={{ color: Math.abs(shortfall) < 0.5 ? '#15803d' : '#b91c1c' }}>{Math.abs(shortfall) < 0.5 ? 'Cash tallies' : shortfall > 0 ? `Short by ${money(shortfall)}` : `Excess ${money(-shortfall)}`}</strong>
                  <button className="primary-action" disabled={busy}>{open.settled_at ? 'Update settlement' : 'Save settlement'}</button>
                </div>
              </form>
            )}
          </div>
        </Modal>
      )}

      {deliver && (
        <Modal eyebrow="DELIVERY" title={`${deliver.stop.shipment_no} · ${deliver.stop.client_name}`} onClose={() => setDeliver(null)}>
          <form onSubmit={submitDeliver} style={{ display: 'grid', gap: 12 }}>
            <div style={grid}>
              <Field label="Delivered on"><input type="date" max={todayStr()} value={deliver.date} onChange={(e) => setDeliver({ ...deliver, date: e.target.value })} /></Field>
              <Field label="Received by"><input value={deliver.by} onChange={(e) => setDeliver({ ...deliver, by: e.target.value })} /></Field>
            </div>
            <div className="data-table-wrap"><table>
              <thead><tr><th>Product</th><th>Sent</th><th>Short</th><th>Damaged</th></tr></thead>
              <tbody>{deliver.stop.items.map((i, n) => (
                <tr key={i.id}><td>{i.product_name}</td><td>{i.quantity}</td>
                  <td><input type="number" min={0} step="any" style={{ width: 80 }} value={deliver.lines[n].short} onChange={(e) => setDeliver({ ...deliver, lines: deliver.lines.map((l, k) => (k === n ? { ...l, short: e.target.value } : l)) })} /></td>
                  <td><input type="number" min={0} step="any" style={{ width: 80 }} value={deliver.lines[n].damaged} onChange={(e) => setDeliver({ ...deliver, lines: deliver.lines.map((l, k) => (k === n ? { ...l, damaged: e.target.value } : l)) })} /></td></tr>))}</tbody></table></div>
            <small>Damaged units go to Sales Return &amp; Damage as a pending entry. {deliver.stop.payment_type === 'cod' ? 'This is a cash-on-delivery order: the payment is recorded automatically once the whole order is delivered.' : ''}</small>
            {modalError && <p className="error-message">{modalError}</p>}
            <div className="modal-actions"><button type="button" onClick={() => setDeliver(null)}>Cancel</button><button className="primary-action" disabled={busy}>{busy ? 'Saving…' : 'Confirm delivery'}</button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function PickList({ avail, pick, toggle }: { avail: Available[]; pick: string[]; toggle: (id: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <strong style={{ fontSize: 13 }}>Packed shipments waiting for a vehicle ({avail.length})</strong>
      <div className="data-table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}><table>
        <thead><tr><th></th><th>Shipment</th><th>Customer</th><th>Units</th><th>Order value</th><th>Payment</th></tr></thead>
        <tbody>
          {avail.map((a) => <tr key={a.id}><td><input type="checkbox" checked={pick.includes(a.id)} onChange={() => toggle(a.id)} /></td><td>{a.shipment_no}<small style={{ display: 'block' }}>{a.order_number}</small></td><td>{a.client_name}<small style={{ display: 'block' }}>{a.city}</small></td><td>{a.units}</td><td>{money(a.order_total)}</td><td style={{ textTransform: 'uppercase' }}>{a.payment_type ?? '—'}</td></tr>)}
          {avail.length === 0 && <tr><td colSpan={6} className="empty-row">No packed shipments are waiting. Create shipments from an order first.</td></tr>}
        </tbody></table></div>
    </div>
  );
}