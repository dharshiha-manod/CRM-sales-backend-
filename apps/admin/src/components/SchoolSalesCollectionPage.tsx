import { FormEvent, MouseEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

type IndustryDetails = { advanceAmount?: string | number; advancePaymentMode?: string; advancePaymentDate?: string };
type Client = { id: string; client_code: string; client_name: string; client_type: string; status: 'active' | 'inactive'; city?: string | null; industry_details?: IndustryDetails | null };
type Order = { id: string; order_number: string; status: string; total_amount: number; created_at: string; client_id?: string };
type Collection = { id: string; amount: number; mode: string; reference_no?: string | null; collected_at: string; sale_orders?: { order_number?: string } | null; client_id?: string };

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const money2 = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
const paymentModes = ['cash', 'upi', 'bank_transfer', 'cheque', 'other'] as const;

function advanceAmountOf(client: Client): number {
  const raw = client.industry_details?.advanceAmount;
  return raw ? Number(raw) || 0 : 0;
}

// Ledger numbers here are pre-computed rather than derived from orders/collections,
// since these demo schools have no real order/collection rows to aggregate from.
const DEMO_ROWS = [
  {
    school: {
      id: 'demo-school-1',
      client_code: 'SCH-0001',
      client_name: 'Sunrise Public School',
      client_type: 'School',
      status: 'active' as const,
      city: 'Chennai',
      industry_details: { advanceAmount: 50000, advancePaymentMode: 'Bank transfer', advancePaymentDate: '2026-06-15' },
    },
    orderCount: 4,
    totalSales: 320000,
    totalCollected: 270000,
    outstanding: 50000,
    lastOrderDate: '2026-08-20',
    advance: 50000,
  },
  {
    school: {
      id: 'demo-school-2',
      client_code: 'SCH-0002',
      client_name: 'Greenfield Matriculation School',
      client_type: 'School',
      status: 'active' as const,
      city: 'Coimbatore',
      industry_details: {},
    },
    orderCount: 2,
    totalSales: 145000,
    totalCollected: 145000,
    outstanding: 0,
    lastOrderDate: '2026-08-05',
    advance: 0,
  },
];

export function SchoolSalesCollectionPage() {
  const [schools, setSchools] = useState<Client[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  const [search, setSearch] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'due' | 'clear'>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewing, setViewing] = useState<Client | null>(null);
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);

  const [collectOpen, setCollectOpen] = useState(false);
  const [collectOrderId, setCollectOrderId] = useState('');
  const [collectAmount, setCollectAmount] = useState('');
  const [collectMode, setCollectMode] = useState<(typeof paymentModes)[number]>('cash');
  const [collectReferenceNo, setCollectReferenceNo] = useState('');
  const [collectNotes, setCollectNotes] = useState('');
  const [collectError, setCollectError] = useState<string | null>(null);
  const [collectSaving, setCollectSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [clientsRes, ordersRes, collectionsRes] = await Promise.all([
        api<{ data: Client[] }>('/clients'),
        api<{ data: Order[] }>('/orders').catch(() => ({ data: [] })),
        api<{ data: Collection[] }>('/collections').catch(() => ({ data: [] })),
      ]);
      setSchools((clientsRes.data ?? []).filter((c) => (c.client_type ?? '').toLowerCase() === 'school'));
      setOrders(ordersRes.data ?? []);
      setCollections(collectionsRes.data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load school sales & collection data.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function toggleMenu(event: MouseEvent<HTMLButtonElement>, schoolId: string) {
    if (menuFor?.id === schoolId) {
      setMenuFor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: schoolId, top: rect.bottom + 6, left: Math.max(8, rect.right - 168) });
  }

  function ledger(clientId: string) {
    const clientOrders = orders.filter((o) => o.client_id === clientId && o.status !== 'cancelled');
    const clientCollections = collections.filter((c) => c.client_id === clientId);
    const totalSales = clientOrders.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);
    const totalCollected = clientCollections.reduce((sum, c) => sum + (c.amount ?? 0), 0);
    const outstanding = Math.max(0, totalSales - totalCollected);
    const lastOrder = clientOrders.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    return { orderCount: clientOrders.length, totalSales, totalCollected, outstanding, lastOrderDate: lastOrder?.created_at ?? null };
  }

  const collectedByOrder = useMemo(() => {
    const map: Record<string, number> = {};
    collections.forEach((c) => {
      const key = c.sale_orders?.order_number;
      if (!key) return;
      map[key] = (map[key] ?? 0) + Number(c.amount || 0);
    });
    return map;
  }, [collections]);

  const usingDemoData = !loading && schools.length === 0;

  const rows = useMemo(() => {
    if (usingDemoData) return DEMO_ROWS;
    return schools.map((s) => ({ school: s, ...ledger(s.id), advance: advanceAmountOf(s) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schools, orders, collections, usingDemoData]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (balanceFilter === 'due' && r.outstanding <= 0) return false;
      if (balanceFilter === 'clear' && r.outstanding > 0) return false;
      if (!q) return true;
      return r.school.client_name.toLowerCase().includes(q) || r.school.client_code.toLowerCase().includes(q) || (r.school.city ?? '').toLowerCase().includes(q);
    });
  }, [rows, search, balanceFilter]);

  const totalSales = rows.reduce((sum, r) => sum + r.totalSales, 0);
  const totalCollected = rows.reduce((sum, r) => sum + r.totalCollected, 0);
  const totalOutstanding = rows.reduce((sum, r) => sum + r.outstanding, 0);
  const totalAdvance = rows.reduce((sum, r) => sum + r.advance, 0);

  const viewingLedger = viewing
    ? (String(viewing.id).startsWith('demo-') ? DEMO_ROWS.find((r) => r.school.id === viewing.id) ?? ledger(viewing.id) : ledger(viewing.id))
    : null;
  const viewingOrders = viewing ? orders.filter((o) => o.client_id === viewing.id).slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) : [];
  const viewingCollections = viewing ? collections.filter((c) => c.client_id === viewing.id).slice().sort((a, b) => new Date(b.collected_at).getTime() - new Date(a.collected_at).getTime()) : [];
  const viewingOutstandingOrders = viewingOrders.filter((o) => o.status !== 'cancelled' && Number(o.total_amount) - (collectedByOrder[o.order_number] ?? 0) > 0.01);

  function openCollect() {
    setCollectOrderId('');
    setCollectAmount('');
    setCollectMode('cash');
    setCollectReferenceNo('');
    setCollectNotes('');
    setCollectError(null);
    setCollectOpen(true);
  }
  function selectCollectOrder(id: string) {
    setCollectOrderId(id);
    setCollectError(null);
    const order = viewingOutstandingOrders.find((o) => o.id === id);
    if (!order) return;
    const paid = collectedByOrder[order.order_number] ?? 0;
    const balance = Number(order.total_amount) - paid;
    setCollectAmount(balance > 0 ? balance.toFixed(2) : '');
  }
  async function submitCollect(event: FormEvent) {
    event.preventDefault();
    setCollectError(null);
    const order = viewingOutstandingOrders.find((o) => o.id === collectOrderId);
    if (!order) return setCollectError('Select an order to record a payment against.');
    const value = Number(collectAmount);
    if (!value || value <= 0) return setCollectError('Enter an amount greater than zero.');
    const paid = collectedByOrder[order.order_number] ?? 0;
    const balance = Number(order.total_amount) - paid;
    if (value > balance + 0.01) return setCollectError(`Amount exceeds the outstanding balance of ${money2(balance)}.`);
    setCollectSaving(true);
    try {
      await api('/collections', {
        method: 'POST',
        body: JSON.stringify({ orderId: order.id, amount: value, mode: collectMode, referenceNo: collectReferenceNo.trim() || null, notes: collectNotes.trim() || null }),
      });
      setCollectOpen(false);
      await load();
    } catch (caught) {
      setCollectError(caught instanceof Error ? caught.message : 'Unable to record this collection.');
    } finally {
      setCollectSaving(false);
    }
  }

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">SCHOOL · SCHOOL-WISE SALES &amp; COLLECTION</p>
          <h2>School-wise sales &amp; collection</h2>
          <p>Per-school sales totals, collections received and outstanding balance, alongside any advance already on file.</p>
        </div>
      </div>

           <div className="kpi-grid">
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon">₹</div>
          <div><span>Total sales</span><strong>{money(totalSales)}</strong><small>across all schools</small></div>
        </div>
        <div className="kpi-card" data-tone="green">
          <div className="kpi-icon">₹</div>
          <div><span>Total collected</span><strong>{money(totalCollected)}</strong><small>incl. advance-adjusted</small></div>
        </div>
        <div className="kpi-card" data-tone="amber">
          <div className="kpi-icon">◒</div>
          <div><span>Outstanding</span><strong>{money(totalOutstanding)}</strong><small>pending collection</small></div>
        </div>
        <div className="kpi-card" data-tone="blue">
          <div className="kpi-icon">₹</div>
          <div><span>Advance on file</span><strong>{money(totalAdvance)}</strong><small>from School Management</small></div>
        </div>
      </div>

      {error && !usingDemoData && <p role="alert" className="error">{error}</p>}
      {usingDemoData && <p className="demo-data-banner">Showing sample data for preview — this is a UI-only demo, nothing here is saved.</p>}

 
      <div className="master-toolbar">
        <div className="master-search">
          <input value={search} placeholder="Search school name, code or city" onChange={(e) => setSearch(e.target.value)} />
          <button className="quiet-button" type="button" onClick={() => setFiltersOpen(!filtersOpen)}>
            Filters{balanceFilter !== 'all' ? ' (active)' : ''}
          </button>
        </div>
        <button className="primary-action" type="button" onClick={() => { window.location.hash = 'industry:school:school-management'; }}>
          + Add school
        </button>
      </div>
      {filtersOpen && (
        <div className="master-filter-bar">
          <label>
            Balance
            <select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value as typeof balanceFilter)}>
              <option value="all">All schools</option>
              <option value="due">Balance due</option>
              <option value="clear">Fully collected</option>
            </select>
          </label>
          <button type="button" className="link-button" onClick={() => setBalanceFilter('all')} disabled={balanceFilter === 'all'}>
            Clear filters
          </button>
        </div>
      )}

      {loading ? (
        <div className="data-table-wrap">
          <table>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td><span className="skeleton-block" style={{ width: '70%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '40%' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>School</th>
                <th>Orders</th>
                <th>Total sales</th>
                <th>Collected</th>
                <th>Outstanding</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ school, orderCount, totalSales: sales, totalCollected: collected, outstanding }) => (
                <tr key={school.id}>
                  <td>
                    <strong>{school.client_name}</strong>
                    <small>{school.client_code}{school.city ? ` · ${school.city}` : ''}</small>
                  </td>
                  <td>{orderCount}</td>
                  <td>{money(sales)}</td>
                  <td>{money(collected)}</td>
                  <td className={outstanding > 0 ? 'text-warn' : ''}>{money(outstanding)}</td>
                                    <td className="master-actions">
                    <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label="More actions" onClick={(e) => toggleMenu(e, school.id)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="5" cy="12" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="19" cy="12" r="1.8" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-row">
                 <div className="empty-state">
                      <span className="empty-state-icon">₹</span>
                      <p>{rows.length === 0 ? 'No schools yet. Add one to get started.' : 'No schools match your search or filters.'}</p>
                      {rows.length === 0 && (
                        <button type="button" className="primary-action" onClick={() => { window.location.hash = 'industry:school:school-management'; }}>
                          + Add school
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
              </table>
        </div>
      )}

      {menuFor && (
        <>
          <div className="row-menu-backdrop" onMouseDown={() => setMenuFor(null)} />
          <div className="row-menu row-menu--icons" style={{ top: menuFor.top, left: menuFor.left }}>
            {(() => {
              const row = filteredRows.find((r) => r.school.id === menuFor.id);
              if (!row) return null;
              return (
                <button type="button" title="View" onClick={() => { setMenuFor(null); setViewing(row.school); }}>
                  <span>◉</span>
                  <span>View ledger</span>
                </button>
              );
            })()}
          </div>
        </>
      )}

      {viewing && viewingLedger && (
        <div className="modal-backdrop" onMouseDown={() => !collectOpen && setViewing(null)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">SCHOOL LEDGER</p>
                <h3>{viewing.client_name}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setViewing(null)}>×</button>
            </div>

            <dl className="detail-dl">
              <dt>Total sales</dt><dd>{money(viewingLedger.totalSales)}</dd>
              <dt>Total collected</dt><dd>{money(viewingLedger.totalCollected)}</dd>
              <dt>Outstanding</dt><dd className={viewingLedger.outstanding > 0 ? 'text-warn' : ''}>{money(viewingLedger.outstanding)}</dd>
              <dt>Advance on file</dt><dd>{advanceAmountOf(viewing) > 0 ? money(advanceAmountOf(viewing)) : 'None recorded'}</dd>
            </dl>

            <h5 className="ledger-heading">Orders</h5>
            <div className="data-table-wrap">
              <table>
                <thead><tr><th>Order no.</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead>
                <tbody>
                  {viewingOrders.slice(0, 10).map((o) => (
                    <tr key={o.id}>
                      <td>{o.order_number}</td>
                      <td><span className={`status-badge status-${o.status}`}>{o.status}</span></td>
                      <td>{money2(o.total_amount)}</td>
                      <td>{dateLabel(o.created_at)}</td>
                    </tr>
                  ))}
                  {viewingOrders.length === 0 && <tr><td colSpan={4} className="empty-row">No orders recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>

            <h5 className="ledger-heading">Collections</h5>
            <div className="data-table-wrap">
              <table>
                <thead><tr><th>Amount</th><th>Mode</th><th>Order</th><th>Date</th></tr></thead>
                <tbody>
                  {viewingCollections.slice(0, 10).map((c) => (
                    <tr key={c.id}>
                      <td>{money2(c.amount)}</td>
                      <td className="capitalize">{c.mode}</td>
                      <td>{c.sale_orders?.order_number ?? '—'}</td>
                      <td>{dateLabel(c.collected_at)}</td>
                    </tr>
                  ))}
                  {viewingCollections.length === 0 && <tr><td colSpan={4} className="empty-row">No collections recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setViewing(null)}>Close</button>
              <button
                type="button"
                className="primary-action"
                disabled={viewingOutstandingOrders.length === 0}
                title={viewingOutstandingOrders.length === 0 ? 'No outstanding orders for this school' : ''}
                onClick={openCollect}
              >
                Record collection
              </button>
            </div>
          </div>
        </div>
      )}

      {collectOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !collectSaving && setCollectOpen(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="school-collect-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">PAYMENT CONTROL</p><h3 id="school-collect-title">Record collection</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setCollectOpen(false)}>×</button>
            </div>
            <form onSubmit={submitCollect} className="master-modal-form">
              {collectError && <p className="error-message" style={{ gridColumn: '1 / -1' }}>{collectError}</p>}
              <label style={{ gridColumn: '1 / -1' }}>
                Order
                <select required value={collectOrderId} onChange={(e) => selectCollectOrder(e.target.value)}>
                  <option value="">Select an outstanding order for this school</option>
                  {viewingOutstandingOrders.map((o) => {
                    const paid = collectedByOrder[o.order_number] ?? 0;
                    const balance = Number(o.total_amount) - paid;
                    return <option key={o.id} value={o.id}>{o.order_number} — {money2(balance)} due</option>;
                  })}
                </select>
              </label>
              <label>Amount (₹)<input type="number" min="0" step="0.01" required value={collectAmount} onChange={(e) => setCollectAmount(e.target.value)} /></label>
              <label>Mode<select value={collectMode} onChange={(e) => setCollectMode(e.target.value as (typeof paymentModes)[number])}>{paymentModes.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select></label>
              <label>Reference no.<input value={collectReferenceNo} onChange={(e) => setCollectReferenceNo(e.target.value)} /></label>
              <label style={{ gridColumn: '1 / -1' }}>Notes<input value={collectNotes} onChange={(e) => setCollectNotes(e.target.value)} /></label>
              <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
                <button type="button" className="quiet-button" onClick={() => setCollectOpen(false)} disabled={collectSaving}>Cancel</button>
                <button type="submit" className="primary-action" disabled={collectSaving}>{collectSaving ? 'Saving…' : 'Record collection'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}