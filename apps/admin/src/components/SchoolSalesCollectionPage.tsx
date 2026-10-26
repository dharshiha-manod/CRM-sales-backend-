import { FormEvent, MouseEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

// Everything on this page is calculated by the School API from the School industry's real orders and collections
// (nothing is typed in here). Orders and quotations are stamped with the academic year / term that was running when
// they were created, so the whole page can be narrowed to one year or one term.
type IndustryDetails = { advanceAmount?: string | number; advancePaymentMode?: string; advancePaymentDate?: string };
type Client = { id: string; client_code: string; client_name: string; client_type?: string; status: 'active' | 'inactive'; city?: string | null; industry_details?: IndustryDetails | null };
type SummaryRow = { school: Client; orderCount: number; totalSales: number; totalCollected: number; outstanding: number; lastOrderDate: string | null; advance: number };
type LedgerOrder = { id: string; order_number: string; status: string; total_amount: number; created_at: string; paid: number; balance: number; school_academic_years?: { label?: string } | null; school_terms?: { name?: string } | null };
type LedgerCollection = { id: string; amount: number; mode: string; reference_no?: string | null; collected_at: string; sale_orders?: { order_number?: string } | null };
type Ledger = { orders: LedgerOrder[]; collections: LedgerCollection[] };
type Year = { id: string; label: string; status: string; terms: { id: string; name: string }[] };

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const money2 = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
const paymentModes = ['cash', 'upi', 'bank_transfer', 'cheque', 'other'] as const;

function advanceAmountOf(client: Client): number {
  const raw = client.industry_details?.advanceAmount;
  return raw ? Number(raw) || 0 : 0;
}

export function SchoolSalesCollectionPage() {
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [yearId, setYearId] = useState('');
  const [termId, setTermId] = useState('');
  const [ledger, setLedger] = useState<Ledger>({ orders: [], collections: [] });
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

  const periodQuery = (() => {
    const q = new URLSearchParams();
    if (yearId) q.set('academicYearId', yearId);
    if (termId) q.set('termId', termId);
    const s = q.toString();
    return s ? `?${s}` : '';
  })();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const summaryRes = await api<{ data: { rows: SummaryRow[] } }>(`/school/sales-summary${periodQuery}`);
      setRows(summaryRes.data?.rows ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load school sales & collection data.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    api<{ data: Year[] }>('/school/academic-years').then((res) => setYears(res.data ?? [])).catch(() => setYears([]));
  }, []);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearId, termId]);

  async function loadLedger(schoolId: string) {
    try {
      const res = await api<{ data: Ledger }>(`/school/schools/${schoolId}/ledger${periodQuery}`);
      setLedger(res.data ?? { orders: [], collections: [] });
    } catch (caught) {
      setLedger({ orders: [], collections: [] });
      setError(caught instanceof Error ? caught.message : 'Unable to load this school\'s ledger.');
    }
  }
  useEffect(() => {
    if (viewing) void loadLedger(viewing.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing, yearId, termId]);

  function toggleMenu(event: MouseEvent<HTMLButtonElement>, schoolId: string) {
    if (menuFor?.id === schoolId) {
      setMenuFor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: schoolId, top: rect.bottom + 6, left: Math.max(8, rect.right - 168) });
  }

  const termsOfYear = useMemo(() => years.find((y) => y.id === yearId)?.terms ?? [], [years, yearId]);

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

  const viewingLedger = viewing ? rows.find((r) => r.school.id === viewing.id) ?? null : null;
  const viewingOrders = ledger.orders;
  const viewingCollections = ledger.collections;
  const viewingOutstandingOrders = viewingOrders.filter((o) => o.status !== 'cancelled' && o.balance > 0.01);

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
    setCollectAmount(order.balance > 0 ? order.balance.toFixed(2) : '');
  }
  async function submitCollect(event: FormEvent) {
    event.preventDefault();
    setCollectError(null);
    const order = viewingOutstandingOrders.find((o) => o.id === collectOrderId);
    if (!order) return setCollectError('Select an order to record a payment against.');
    const value = Number(collectAmount);
    if (!value || value <= 0) return setCollectError('Enter an amount greater than zero.');
    if (value > order.balance + 0.01) return setCollectError(`Amount exceeds the outstanding balance of ${money2(order.balance)}.`);
    setCollectSaving(true);
    try {
      await api('/collections', {
        method: 'POST',
        body: JSON.stringify({ orderId: order.id, amount: value, mode: collectMode, referenceNo: collectReferenceNo.trim() || null, notes: collectNotes.trim() || null }),
      });
      setCollectOpen(false);
      await Promise.all([load(), viewing ? loadLedger(viewing.id) : Promise.resolve()]);
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

      {error && <p role="alert" className="error">{error}</p>}

 
      <div className="master-toolbar">
        <div className="master-search">
          <input value={search} placeholder="Search school name, code or city" onChange={(e) => setSearch(e.target.value)} />
          <button className="quiet-button" type="button" onClick={() => setFiltersOpen(!filtersOpen)}>
            Filters{balanceFilter !== 'all' || yearId ? ' (active)' : ''}
          </button>
        </div>
        <button className="primary-action" type="button" onClick={() => { window.location.hash = 'industry:school:school-management'; }}>
          + Add school
        </button>
      </div>
      {filtersOpen && (
        <div className="master-filter-bar">
          <label>
            Academic year
            <select value={yearId} onChange={(e) => { setYearId(e.target.value); setTermId(''); }}>
              <option value="">All years</option>
              {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
            </select>
          </label>
          <label>
            Term
            <select value={termId} onChange={(e) => setTermId(e.target.value)} disabled={!yearId}>
              <option value="">All terms</option>
              {termsOfYear.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>
            Balance
            <select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value as typeof balanceFilter)}>
              <option value="all">All schools</option>
              <option value="due">Balance due</option>
              <option value="clear">Fully collected</option>
            </select>
          </label>
          <button type="button" className="link-button" onClick={() => { setBalanceFilter('all'); setYearId(''); setTermId(''); }} disabled={balanceFilter === 'all' && !yearId}>
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

      {viewing && (
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
              <dt>Total sales</dt><dd>{money(viewingLedger?.totalSales ?? 0)}</dd>
              <dt>Total collected</dt><dd>{money(viewingLedger?.totalCollected ?? 0)}</dd>
              <dt>Outstanding</dt><dd className={(viewingLedger?.outstanding ?? 0) > 0 ? 'text-warn' : ''}>{money(viewingLedger?.outstanding ?? 0)}</dd>
              <dt>Advance on file</dt><dd>{advanceAmountOf(viewing) > 0 ? money(advanceAmountOf(viewing)) : 'None recorded'}</dd>
            </dl>

            <h5 className="ledger-heading">Orders</h5>
            <div className="data-table-wrap">
              <table>
                <thead><tr><th>Order no.</th><th>Status</th><th>Amount</th><th>Balance</th><th>Year / term</th><th>Date</th></tr></thead>
                <tbody>
                  {viewingOrders.slice(0, 10).map((o) => (
                    <tr key={o.id}>
                      <td>{o.order_number}</td>
                      <td><span className={`status-badge status-${o.status}`}>{o.status}</span></td>
                      <td>{money2(o.total_amount)}</td>
                      <td className={o.balance > 0 && o.status !== 'cancelled' ? 'text-warn' : ''}>{o.status === 'cancelled' ? '—' : money2(o.balance)}</td>
                      <td>{o.school_academic_years?.label ?? '—'}{o.school_terms?.name ? ` · ${o.school_terms.name}` : ''}</td>
                      <td>{dateLabel(o.created_at)}</td>
                    </tr>
                  ))}
                  {viewingOrders.length === 0 && <tr><td colSpan={6} className="empty-row">No orders recorded yet.</td></tr>}
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
                    return <option key={o.id} value={o.id}>{o.order_number} — {money2(o.balance)} due</option>;
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