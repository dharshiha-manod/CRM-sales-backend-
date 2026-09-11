import { FormEvent, MouseEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

type OrderItem = { quantity: number; unit_price: number; products?: { product_code?: string; product_name?: string } | null };
type Order = {
  id: string;
  order_number: string;
  status: string;
  created_at: string;
  clients?: { client_code?: string; client_name?: string } | null;
  sale_order_items?: OrderItem[];
};

const currency = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));

type Kind = 'return' | 'damage';
type RecordStatus = 'pending' | 'approved' | 'rejected';
type ReturnRecord = {
  id: string;
  orderId: string;
  orderNumber: string;
  clientName: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  kind: Kind;
  reason: string;
  status: RecordStatus;
  createdAt: string;
};
type RecordForm = {
  orderId: string;
  productName: string;
  unitPrice: string;
  quantity: string;
  kind: Kind;
  reason: string;
};
const blankForm: RecordForm = { orderId: '', productName: '', unitPrice: '', quantity: '1', kind: 'return', reason: '' };

// Returns & damage records have no backend table yet — persisted client-side in
// localStorage, same approach used for beats/schemes elsewhere in this app.
// Orders and their line items below are real, live records pulled from the API.
const STORAGE_KEY = 'fs-returns-damage';
function loadStored(): ReturnRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReturnRecord[]) : [];
  } catch {
    return [];
  }
}
function saveStored(records: ReturnRecord[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* best-effort */
  }
}
function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `rd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

const statusBadge: Record<RecordStatus, string> = {
  pending: 'status-badge status-pending',
  approved: 'status-badge status-completed',
  rejected: 'status-badge status-cancelled',
};

export function SalesReturnDamagePage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [records, setRecords] = useState<ReturnRecord[]>([]);
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RecordStatus>('all');
  const [search, setSearch] = useState('');

  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<RecordForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ data: Order[] }>('/orders');
      setOrders((res.data ?? []).filter((o) => o.status !== 'cancelled'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load orders.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    setRecords(loadStored());
  }, []);

  function persist(next: ReturnRecord[]) {
    setRecords(next);
    saveStored(next);
  }

  const selectedOrder = orders.find((o) => o.id === form.orderId) ?? null;

  function openCreate() {
    setForm(blankForm);
    setMessage('');
    setModal(true);
  }

  function pickItem(orderId: string, productLabel: string) {
    const order = orders.find((o) => o.id === orderId);
    const item = order?.sale_order_items?.find((i) => (i.products?.product_name ?? i.products?.product_code ?? '') === productLabel);
    setForm((f) => ({
      ...f,
      orderId,
      productName: productLabel,
      unitPrice: item ? String(item.unit_price) : f.unitPrice,
      quantity: item ? String(Math.min(1, item.quantity)) : f.quantity,
    }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.orderId) {
      setMessage('Select the order this item was sold on.');
      return;
    }
    if (!form.productName.trim()) {
      setMessage('Select or enter a product.');
      return;
    }
    const quantity = Number(form.quantity);
    if (!quantity || quantity <= 0) {
      setMessage('Enter a quantity greater than zero.');
      return;
    }
    setSaving(true);
    try {
      const order = orders.find((o) => o.id === form.orderId);
      const record: ReturnRecord = {
        id: newId(),
        orderId: form.orderId,
        orderNumber: order?.order_number ?? '—',
        clientName: order?.clients?.client_name ?? '—',
        productName: form.productName.trim(),
        quantity,
        unitPrice: Number(form.unitPrice) || 0,
        kind: form.kind,
        reason: form.reason.trim(),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      persist([record, ...records]);
      setMessage(`${form.kind === 'damage' ? 'Damage' : 'Return'} logged successfully.`);
      setModal(false);
    } finally {
      setSaving(false);
    }
  }

  function toggleMenu(event: MouseEvent<HTMLButtonElement>, recordId: string) {
    if (menuFor?.id === recordId) {
      setMenuFor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: recordId, top: rect.bottom + 6, left: Math.max(8, rect.right - 168) });
  }

  function setStatus(record: ReturnRecord, status: RecordStatus) {
    persist(records.map((r) => (r.id === record.id ? { ...r, status } : r)));
  }

  function removeRecord(record: ReturnRecord) {
    if (!window.confirm(`Remove this ${record.kind} entry for "${record.productName}"? This cannot be undone.`)) return;
    persist(records.filter((r) => r.id !== record.id));
  }

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return r.clientName.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q) || r.orderNumber.toLowerCase().includes(q);
    });
  }, [records, kindFilter, statusFilter, search]);

  const returnCount = records.filter((r) => r.kind === 'return').length;
  const damageCount = records.filter((r) => r.kind === 'damage').length;
  const pendingCount = records.filter((r) => r.status === 'pending').length;
  const totalValue = records.reduce((sum, r) => sum + r.quantity * r.unitPrice, 0);

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">FMCG · SALES RETURN &amp; DAMAGE MANAGEMENT</p>
          <h2>Sales return &amp; damage management</h2>
          <p>Log returned or damaged stock against a real sales order, track review status, and see the value impact across your book.</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card" data-tone="blue">
          <div className="kpi-icon">↩</div>
          <div>
            <span>Returns logged</span>
            <strong>{returnCount}</strong>
            <small>customer returns</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="red">
          <div className="kpi-icon">⚠</div>
          <div>
            <span>Damage logged</span>
            <strong>{damageCount}</strong>
            <small>damaged / spoiled stock</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="amber">
          <div className="kpi-icon">◷</div>
          <div>
            <span>Pending review</span>
            <strong>{pendingCount}</strong>
            <small>awaiting approval</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon">₹</div>
          <div>
            <span>Total value</span>
            <strong>{currency(totalValue)}</strong>
            <small>across all entries</small>
          </div>
        </div>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input
            type="search"
            placeholder="Search client, product or order no…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as 'all' | Kind)}>
            <option value="all">Returns &amp; damage</option>
            <option value="return">Returns only</option>
            <option value="damage">Damage only</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | RecordStatus)}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <button className="primary-action" type="button" onClick={openCreate}>
          + Log return / damage
        </button>
      </div>

      {error && <p className="error-message">{error}</p>}
      {message && <p className={message.includes('successfully') ? 'success-message' : 'error-message'}>{message}</p>}

      {loading ? (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Client</th><th>Order</th><th>Item</th><th>Qty</th><th>Type</th><th>Value</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map((i) => (
                <tr key={i} className="skeleton-row">
                  <td><span className="skeleton-block" style={{ width: '60%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '70%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '65%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '25%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '50%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '50%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '70%' }} /></td>
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
                <th>Date</th><th>Client</th><th>Order</th><th>Item</th><th>Qty</th><th>Type</th><th>Value</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((r) => (
                <tr key={r.id}>
                  <td>{dateLabel(r.createdAt)}</td>
                  <td>{r.clientName}</td>
                  <td>{r.orderNumber}</td>
                  <td>
                    <strong>{r.productName}</strong>
                    {r.reason && <small>{r.reason}</small>}
                  </td>
                  <td>{r.quantity}</td>
                  <td>
                    <span className={`status-badge ${r.kind === 'damage' ? 'status-cancelled' : 'status-quoted'}`}>{r.kind === 'damage' ? 'Damage' : 'Return'}</span>
                  </td>
                  <td>{currency(r.quantity * r.unitPrice)}</td>
                  <td>
                    <span className={statusBadge[r.status]}>{r.status}</span>
                  </td>
                                <td className="master-actions">
                    <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label="More actions" onClick={(e) => toggleMenu(e, r.id)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="5" cy="12" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="19" cy="12" r="1.8" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty-row">
                    <div className="empty-state">
                      <span className="empty-state-icon">↩</span>
                      <p>
                        {records.length === 0
                          ? 'No returns or damage logged yet.'
                          : 'No entries match your search or filters.'}
                      </p>
                      {records.length === 0 && (
                        <button className="quiet-button" type="button" onClick={openCreate}>
                          + Log your first entry
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
              const record = filteredRecords.find((rec) => rec.id === menuFor.id);
              if (!record) return null;
              return (
                <>
                  {record.status !== 'approved' && (
                    <button type="button" title="Approve" onClick={() => { setMenuFor(null); setStatus(record, 'approved'); }}>
                      <span>✓</span>
                      <span>Approve</span>
                    </button>
                  )}
                  {record.status !== 'rejected' && (
                    <button type="button" title="Reject" onClick={() => { setMenuFor(null); setStatus(record, 'rejected'); }}>
                      <span>⊘</span>
                      <span>Reject</span>
                    </button>
                  )}
                                  <button type="button" className="row-menu-danger" title="Delete" onClick={() => { setMenuFor(null); removeRecord(record); }}>
                    <span>✕</span>
                    <span>Delete</span>
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}

      {modal && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setModal(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="rd-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">SALES RETURN / DAMAGE</p>
                <h3 id="rd-modal-title">Log return / damage</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>
                ×
              </button>
            </div>
            <form className="master-modal-form" onSubmit={submit}>
              <label style={{ gridColumn: '1 / -1' }}>
                Sales order
                <select
                  required
                  value={form.orderId}
                  onChange={(e) => setForm({ ...form, orderId: e.target.value, productName: '', unitPrice: '' })}
                >
                  <option value="">Select the order…</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number} — {o.clients?.client_name ?? 'Client'} ({dateLabel(o.created_at)})
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ gridColumn: '1 / -1' }}>
                Item
                {selectedOrder && (selectedOrder.sale_order_items?.length ?? 0) > 0 ? (
                  <select required value={form.productName} onChange={(e) => pickItem(form.orderId, e.target.value)}>
                    <option value="">Select item from this order…</option>
                    {selectedOrder.sale_order_items?.map((item, idx) => {
                      const label = item.products?.product_name ?? item.products?.product_code ?? `Item ${idx + 1}`;
                      return (
                        <option key={idx} value={label}>
                          {label} (ordered {item.quantity} @ {currency(item.unit_price)})
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <input
                    required
                    value={form.productName}
                    placeholder="Product name"
                    onChange={(e) => setForm({ ...form, productName: e.target.value })}
                  />
                )}
              </label>

              <label>
                Quantity
                <input type="number" min="1" step="1" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </label>
              <label>
                Unit price (₹)
                <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
              </label>
              <label>
                Type
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
                  <option value="return">Return</option>
                  <option value="damage">Damage</option>
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Reason
                <input value={form.reason} placeholder="e.g. Damaged in transit, wrong item, near expiry" onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </label>

              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(false)} disabled={saving}>
                  Cancel
                </button>
                <button className="primary-action" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Log entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}