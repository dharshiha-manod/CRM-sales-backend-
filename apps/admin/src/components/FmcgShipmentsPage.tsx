// FILE: admin/src/components/FmcgShipmentsPage.tsx
// FMCG > Shipments: every shipment of every order (local + international) in one place.
// Same database records as the Shipment panel inside an order, so the two can never disagree.
// New shipments are created from the order (it needs the order's product lines); this page tracks and updates them.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';
import './FmcgShipmentsPage.css';

type Status = 'packed' | 'dispatched' | 'delivered' | 'cancelled';
type Shipment = {
  id: string; order_id: string; shipment_no: string; status: Status;
  transport_ref: string | null; shipped_at: string | null; expected_arrival: string | null; delivered_at: string | null; notes: string | null; created_at: string;
  order_number: string; order_status: string; client_code: string | null; client_name: string; market: string;
  total_quantity: number; items: Array<{ product_name: string; quantity: number }>;
};
type Mode = 'dispatch' | 'deliver' | 'edit' | 'cancel';
type Action = { shipment: Shipment; mode: Mode } | null;
type Tab = 'all' | Status | 'late';

const STATUS_LABEL: Record<Status, string> = { packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' };
const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const qty = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function FmcgShipmentsPage() {
  const [rows, setRows] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [market, setMarket] = useState<'all' | 'local' | 'international'>('all');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<Action>(null);
  const [shipDate, setShipDate] = useState(todayLocal());
  const [deliverDate, setDeliverDate] = useState(todayLocal());
  const [transport, setTransport] = useState('');
  const [eta, setEta] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await api<{ data: Shipment[] }>('/fmcg/shipments')).data); setError(''); }
    catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const today = todayLocal();
  const isLate = (s: Shipment) => s.status === 'dispatched' && !!s.expected_arrival && s.expected_arrival < today;
  const count = (f: (s: Shipment) => boolean) => rows.filter(f).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((s) => {
      if (tab === 'late' ? !isLate(s) : tab !== 'all' && s.status !== tab) return false;
      if (market !== 'all' && s.market !== market) return false;
      if (!q) return true;
      return `${s.shipment_no} ${s.order_number} ${s.client_name} ${s.client_code ?? ''} ${s.transport_ref ?? ''}`.toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tab, market, search]);

  const openAction = (shipment: Shipment, mode: Mode) => {
    setAction({ shipment, mode });
    setTransport(shipment.transport_ref ?? '');
    setEta(shipment.expected_arrival ?? '');
    setNotes(shipment.notes ?? '');
    setShipDate(shipment.shipped_at ?? todayLocal());
    setDeliverDate(todayLocal());
    setModalError('');
  };
  const closeAction = () => { if (!busy) setAction(null); };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true); setModalError('');
    try {
      await api(`/fmcg/shipments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setAction(null); await load();
    } catch (err) { setModalError((err as Error).message); } finally { setBusy(false); }
  };
  const submitAction = () => {
    if (!action) return;
    const id = action.shipment.id;
    const common = { transportRef: transport.trim() || null, expectedArrival: eta || null, notes: notes.trim() || null };
    if (action.mode === 'dispatch') void patch(id, { ...common, status: 'dispatched', shippedAt: shipDate });
    else if (action.mode === 'deliver') void patch(id, { status: 'delivered', deliveredAt: deliverDate });
    else if (action.mode === 'edit') void patch(id, common);
    else void patch(id, { status: 'cancelled' });
  };

  const exportCsv = () => {
    const head = ['Shipment', 'Order', 'Client', 'Market', 'Quantity', 'Vehicle / Container', 'Shipped', 'Expected', 'Delivered', 'Status'];
    const lines = visible.map((s) => [s.shipment_no, s.order_number, s.client_name, s.market, s.total_quantity, s.transport_ref ?? '', s.shipped_at ?? '', s.expected_arrival ?? '', s.delivered_at ?? '', STATUS_LABEL[s.status] ?? s.status].map(csvCell).join(','));
    const blob = new Blob([[head.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `shipments-${todayLocal()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const tabs: Array<[Tab, string, number]> = [
    ['all', 'All', rows.length],
    ['packed', 'Packed', count((s) => s.status === 'packed')],
    ['dispatched', 'In transit', count((s) => s.status === 'dispatched')],
    ['late', 'Late', count(isLate)],
    ['delivered', 'Delivered', count((s) => s.status === 'delivered')],
    ['cancelled', 'Cancelled', count((s) => s.status === 'cancelled')],
  ];
  const international = action?.shipment.market === 'international';
  const refLabel = international ? 'Container / AWB / BL number' : 'Vehicle / LR number';
  const etaLabel = international ? 'Expected arrival (ETA)' : 'Expected delivery';
  const kpis: Array<[Tab, string, number, string]> = [
    ['packed', 'Ready to dispatch', count((s) => s.status === 'packed'), 'amber'],
    ['dispatched', 'In transit', count((s) => s.status === 'dispatched'), 'blue'],
    ['late', 'Late', count(isLate), 'red'],
    ['delivered', 'Delivered', count((s) => s.status === 'delivered'), 'green'],
  ];

  return (
    <section className="page-panel master-page shipments-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">FMCG · SHIPMENTS</p>
          <h2>Shipments</h2>
        </div>
        <button type="button" className="quiet-button" onClick={exportCsv} disabled={visible.length === 0}>Export CSV</button>
      </div>

      <div className="sp-kpis">
        {kpis.map(([key, label, n, toneName]) => (
          <button key={key} type="button" className={`sp-kpi sp-tone-${toneName}${tab === key ? ' active' : ''}`} onClick={() => setTab(tab === key ? 'all' : key)}>
            <span>{label}</span><strong>{n}</strong>
          </button>
        ))}
      </div>

      <div className="sp-card">
        <div className="sp-tabs">
          {tabs.map(([key, label, n]) => (
            <button key={key} type="button" className={`sp-tab${tab === key ? ' active' : ''}${key === 'late' && n > 0 ? ' attn' : ''}`} onClick={() => setTab(key)}>
              {label}<span className="tab-count">{n}</span>
            </button>
          ))}
        </div>
        <div className="sp-filters">
          <input type="search" placeholder="Search shipment, order, client or vehicle" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={market} onChange={(e) => setMarket(e.target.value as typeof market)} aria-label="Market">
            <option value="all">All markets</option><option value="local">Local</option><option value="international">International</option>
          </select>
        </div>
        {error && <p className="error-message" style={{ margin: '1rem 1.1rem 0' }}>{error}</p>}
        <div className="sp-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Shipment</th><th>Client</th><th>Market</th><th className="num">Qty</th><th>Vehicle / Container</th>
                <th>Shipped</th><th>Expected</th><th>Delivered</th><th>Status</th><th className="actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="sp-empty">Loading shipments…</td></tr>}
              {!loading && visible.length === 0 && (
                <tr><td colSpan={10} className="sp-empty">{rows.length === 0 ? 'No shipments yet.' : 'No shipments match this filter.'}</td></tr>
              )}
              {visible.map((s) => {
                const late = isLate(s);
                return (
                  <Fragment key={s.id}>
                    <tr className={openId === s.id ? 'open' : undefined}>
                      <td>
                        <button type="button" className="sp-link" onClick={() => setOpenId(openId === s.id ? null : s.id)} aria-expanded={openId === s.id}>
                          <span className="sp-caret">{openId === s.id ? '▾' : '▸'}</span>{s.shipment_no}
                        </button>
                        <small className="sp-sub">Order {s.order_number}</small>
                      </td>
                      <td>
                        <div className="sp-client">
                          <span className="sp-avatar">{initials(s.client_name)}</span>
                          <div><strong>{s.client_name}</strong>{s.client_code ? <small className="sp-sub">{s.client_code}</small> : null}</div>
                        </div>
                      </td>
                      <td><span className={`sp-chip ${s.market === 'international' ? 'intl' : 'local'}`}>{s.market === 'international' ? 'International' : 'Local'}</span></td>
                      <td className="num">{qty(s.total_quantity)}</td>
                      <td>{s.transport_ref ?? '—'}</td>
                      <td>{fmtDate(s.shipped_at)}</td>
                      <td className={late ? 'sp-late' : undefined}>{fmtDate(s.expected_arrival)}{late ? <small className="sp-sub sp-late">Overdue</small> : null}</td>
                      <td>{fmtDate(s.delivered_at)}</td>
                      <td><span className={`sp-status sp-${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span></td>
                      <td className="actions">
                        {s.status === 'packed' && <button type="button" className="sp-btn primary" onClick={() => openAction(s, 'dispatch')}>Dispatch</button>}
                        {s.status === 'dispatched' && <button type="button" className="sp-btn primary" onClick={() => openAction(s, 'deliver')}>Mark delivered</button>}
                        {s.status !== 'cancelled' && <button type="button" className="sp-btn" onClick={() => openAction(s, 'edit')}>Edit</button>}
                        {s.status === 'packed' && <button type="button" className="sp-btn danger" onClick={() => openAction(s, 'cancel')}>Cancel</button>}
                      </td>
                    </tr>
                    {openId === s.id && (
                      <tr className="sp-detail">
                        <td colSpan={10}>
                          <div className="sp-detail-grid">
                            <table className="sp-items">
                              <thead><tr><th>Product</th><th className="num">Quantity</th></tr></thead>
                              <tbody>
                                {s.items.map((i, idx) => <tr key={`${s.id}-${idx}`}><td>{i.product_name}</td><td className="num">{qty(i.quantity)}</td></tr>)}
                                <tr className="total"><td>Total</td><td className="num">{qty(s.total_quantity)}</td></tr>
                              </tbody>
                            </table>
                            {s.notes ? <div className="sp-notes"><span>Notes</span><p>{s.notes}</p></div> : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {action && (
        <div className="modal-backdrop" onMouseDown={closeAction}>
          <div className="master-modal sp-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">ORDER {action.shipment.order_number} · {action.shipment.client_name}</p>
                <h3>
                  {action.mode === 'dispatch' && `Dispatch ${action.shipment.shipment_no}`}
                  {action.mode === 'deliver' && `Mark ${action.shipment.shipment_no} delivered`}
                  {action.mode === 'edit' && `Edit ${action.shipment.shipment_no}`}
                  {action.mode === 'cancel' && `Cancel ${action.shipment.shipment_no}`}
                </h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={closeAction}>×</button>
            </div>

            {action.mode === 'cancel' ? (
              <p className="sp-modal-text">The quantity of this shipment goes back to Remaining on order {action.shipment.order_number}.</p>
            ) : action.mode === 'deliver' ? (
              <label className="sp-field">Delivered date
                <input type="date" value={deliverDate} min={action.shipment.shipped_at ?? undefined} max={today} onChange={(e) => setDeliverDate(e.target.value)} />
              </label>
            ) : (
              <>
                {action.mode === 'dispatch' && (
                  <label className="sp-field">Ship date
                    <input type="date" value={shipDate} max={today} onChange={(e) => setShipDate(e.target.value)} />
                  </label>
                )}
                <label className="sp-field">{refLabel}
                  <input type="text" maxLength={80} value={transport} onChange={(e) => setTransport(e.target.value)} placeholder={international ? 'e.g. MSKU1234567' : 'e.g. TN 09 AB 1234'} />
                </label>
                <label className="sp-field">{etaLabel}
                  <input type="date" value={eta} min={action.mode === 'dispatch' ? shipDate : action.shipment.shipped_at ?? undefined} onChange={(e) => setEta(e.target.value)} />
                </label>
                <label className="sp-field">Notes
                  <input type="text" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
              </>
            )}

            {modalError && <p className="error-message">{modalError}</p>}
            <div className="modal-actions">
              <button type="button" className="quiet-button" disabled={busy} onClick={closeAction}>Close</button>
              <button type="button" className={action.mode === 'cancel' ? 'sp-btn danger solid' : 'primary-action'} disabled={busy} onClick={submitAction}>
                {busy ? 'Saving…' : action.mode === 'dispatch' ? 'Dispatch' : action.mode === 'deliver' ? 'Mark delivered' : action.mode === 'edit' ? 'Save' : 'Cancel shipment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}