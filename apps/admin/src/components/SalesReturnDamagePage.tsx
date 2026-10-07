import { FormEvent, MouseEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { kpiClick } from '../lib/kpiClick';
import './MasterDataPages.css';
import './SalesReturnDamagePage.css';

/* ══════════════════════════════════════════════════════════════════════
   Sales return & damage (FMCG)

   Sales Order → pick the order → its items load automatically (with what is
   still returnable) → credit is worked out live → Approve →
     • client's outstanding in Collections goes down (credit note)
     • good returns go back on the shelf, into the batches they were sold from
   Everything is derived from the order — nothing is typed twice.
   ══════════════════════════════════════════════════════════════════════ */

type OrderItem = {
  quantity: number;
  free_quantity?: number | null;
  unit_price: number;
  subtotal?: number | null;
  products?: { id?: string; product_code?: string; product_name?: string } | null;
};
type Order = {
  id: string;
  order_number: string;
  status: string;
  total_amount?: number | null;
  currency_code?: string | null;
  exchange_rate?: number | null;
  created_at: string;
  clients?: { client_code?: string; client_name?: string } | null;
  sales_representatives?: { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null;
  sale_order_items?: OrderItem[];
};

const money = (value: number, code = 'INR') => new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(Number(value || 0));
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
const round2 = (v: number) => Math.round(v * 100) / 100;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

type Kind = 'return' | 'damage';
type RecordStatus = 'pending' | 'approved' | 'rejected';
type ReturnRecord = {
  id: string; orderId: string; orderNumber: string; clientName: string; productName: string; quantity: number; productId: string;
  restock: boolean; creditClient: boolean; credit: number; currency?: string; rate?: number; kind: Kind; reason: string; status: RecordStatus; createdAt: string;
};
type ApiReturn = {
  id: string; order_id: string; quantity: number; kind: Kind; reason: string | null; restock: boolean; credit_client?: boolean | null; status: RecordStatus; credit_amount: number; currency_code: string; exchange_rate: number; created_at: string; product_id: string;
  sale_orders?: { order_number?: string } | null; clients?: { client_name?: string } | null; products?: { product_name?: string; product_code?: string } | null;
};
const fromApi = (r: ApiReturn): ReturnRecord => ({
  id: r.id, orderId: r.order_id, orderNumber: r.sale_orders?.order_number ?? '—', clientName: r.clients?.client_name ?? '—',
  productName: r.products?.product_name ?? r.products?.product_code ?? '—', productId: r.product_id, quantity: Number(r.quantity), credit: Number(r.credit_amount),
  currency: r.currency_code, rate: Number(r.exchange_rate) || 1, kind: r.kind, reason: r.reason ?? '', restock: r.restock, creditClient: r.credit_client !== false, status: r.status, createdAt: r.created_at,
});

const STATUS_LABEL: Record<RecordStatus, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
const REASONS: Record<Kind, string[]> = {
  return: ['Wrong item delivered', 'Customer rejected goods', 'Near expiry', 'Excess quantity', 'Quality issue'],
  damage: ['Damaged in transit', 'Packaging broken', 'Expired stock', 'Spoiled / leaking', 'Damaged at outlet'],
};

// One row per product on an order, with how much of it can still be returned.
type Line = { productId: string; name: string; code: string; paidQty: number; freeQty: number; paid: number; sold: number; already: number; alreadyCredited: number; remaining: number; netUnit: number };
function buildLines(order: Order | null, records: ReturnRecord[]): Line[] {
  if (!order) return [];
  const map = new Map<string, Line>();
  for (const item of order.sale_order_items ?? []) {
    const id = item.products?.id;
    if (!id) continue;
    const line = map.get(id) ?? { productId: id, name: item.products?.product_name ?? item.products?.product_code ?? 'Product', code: item.products?.product_code ?? '', paidQty: 0, freeQty: 0, paid: 0, sold: 0, already: 0, alreadyCredited: 0, remaining: 0, netUnit: 0 };
    line.paidQty += Number(item.quantity || 0);
    line.freeQty += Number(item.free_quantity || 0);
    line.paid += Number(item.subtotal ?? Number(item.quantity || 0) * Number(item.unit_price || 0));
    map.set(id, line);
  }
  for (const line of map.values()) {
    line.sold = line.paidQty + line.freeQty;
    line.already = records.filter((r) => r.orderId === order.id && r.productId === line.productId && r.status !== 'rejected').reduce((s, r) => s + r.quantity, 0);
    line.alreadyCredited = records.filter((r) => r.orderId === order.id && r.productId === line.productId && r.status !== 'rejected' && r.creditClient).reduce((s, r) => s + r.quantity, 0);
    line.remaining = Math.max(0, line.sold - line.already);
    line.netUnit = line.paidQty > 0 ? line.paid / line.paidQty : 0;
  }
  return [...map.values()];
}
// Same rule the server uses: free units come back first and earn no credit; paid units are credited at what the client really paid.
function creditFor(line: Line | null, quantity: number, creditClient = true) {
  if (!line || !creditClient || quantity <= 0 || line.paidQty <= 0) return 0;
  const creditable = Math.max(0, line.alreadyCredited + quantity - line.freeQty) - Math.max(0, line.alreadyCredited - line.freeQty);
  return round2(line.netUnit * creditable);
}

type Form = { orderId: string; productId: string; quantity: string; kind: Kind; reason: string; restock: boolean; creditClient: boolean };
const blankForm: Form = { orderId: '', productId: '', quantity: '', kind: 'return', reason: '', restock: true, creditClient: true };
type Toast = { id: number; message: string; tone: 'success' | 'error' };

export function SalesReturnDamagePage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [records, setRecords] = useState<ReturnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [tab, setTab] = useState<'all' | RecordStatus>('all');
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all');
  const [search, setSearch] = useState('');

  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Form>(blankForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ record: ReturnRecord; status: 'approved' | 'rejected' } | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);

  function toast(message: string, tone: Toast['tone'] = 'success') {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { id, message, tone }]);
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 3600);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [res, ret] = await Promise.all([api<{ data: Order[] }>('/orders'), api<{ data: ApiReturn[] }>('/fmcg/returns')]);
      setOrders((res.data ?? []).filter((o) => !['cancelled', 'pending_approval', 'rejected'].includes(o.status)));
      setRecords((ret.data ?? []).map(fromApi));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load orders.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  /* ---------- form: everything below is derived from the chosen order ---------- */
  const selectedOrder = orders.find((o) => o.id === form.orderId) ?? null;
  const lines = useMemo(() => buildLines(selectedOrder, records), [selectedOrder, records]);
  const selectedLine = lines.find((l) => l.productId === form.productId) ?? null;
  const qty = Number(form.quantity) || 0;
  const credit = creditFor(selectedLine, qty, form.kind === 'return' || form.creditClient);
  const orderCurrency = selectedOrder?.currency_code ?? 'INR';
  const orderRate = Number(selectedOrder?.exchange_rate ?? 1) || 1;
  const repName = selectedOrder?.sales_representatives?.user_profiles?.display_name ?? selectedOrder?.sales_representatives?.employee_code ?? '';

  // Only orders that still have something that can come back.
  const returnableOrders = useMemo(() => orders.filter((o) => buildLines(o, records).some((l) => l.remaining > 0)), [orders, records]);

  function openCreate() {
    setForm(blankForm);
    setFormError('');
    setModal(true);
  }
  function pickOrder(orderId: string) {
    const order = orders.find((o) => o.id === orderId) ?? null;
    const open = buildLines(order, records).filter((l) => l.remaining > 0);
    // Automation: a single returnable product is selected for you, with the full returnable quantity filled in.
    if (open.length === 1) setForm({ ...form, orderId, productId: open[0].productId, quantity: String(open[0].remaining) });
    else setForm({ ...form, orderId, productId: '', quantity: '' });
  }
  function pickLine(line: Line) {
    if (line.remaining <= 0) return;
    setForm({ ...form, productId: line.productId, quantity: String(line.remaining) });
  }
  function setKind(kind: Kind) {
    setForm({ ...form, kind, creditClient: true, restock: kind === 'return', reason: REASONS[form.kind].includes(form.reason) ? '' : form.reason });
  }

  async function submit(event: FormEvent | null, approveNow: boolean) {
    event?.preventDefault();
    setFormError('');
    if (!selectedOrder) { setFormError('Select the sales order.'); return; }
    if (!selectedLine) { setFormError('Select the item from this order.'); return; }
    if (!qty || qty <= 0) { setFormError('Enter a quantity greater than zero.'); return; }
    if (qty > selectedLine.remaining + 1e-9) { setFormError(`Only ${selectedLine.remaining} unit(s) can still be returned or written off on this order.`); return; }
    setSaving(true);
    try {
      const res = await api<{ data: { id: string } }>('/fmcg/returns', { method: 'POST', body: JSON.stringify({ orderId: form.orderId, productId: form.productId, quantity: qty, kind: form.kind, reason: form.reason.trim() || null, restock: form.kind === 'return' ? form.restock : false, creditClient: form.kind === 'damage' ? form.creditClient : true }) });
      if (approveNow) {
        try {
          await api(`/fmcg/returns/${res.data.id}/decision`, { method: 'POST', body: JSON.stringify({ status: 'approved' }) });
          toast(credit > 0 ? `${form.kind === 'damage' ? 'Damage' : 'Return'} logged and approved — ${money(credit, orderCurrency)} credited to ${selectedOrder.clients?.client_name ?? 'the client'}.` : `Damage logged and approved — no credit, the client bears the loss.`);
        } catch (caught) {
          toast(`Logged, but approval failed: ${caught instanceof Error ? caught.message : 'please approve it from the list.'}`, 'error');
        }
      } else {
        toast(`${form.kind === 'damage' ? 'Damage' : 'Return'} logged and sent for approval.`);
      }
      setModal(false);
      await load();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Unable to save the entry.');
    } finally {
      setSaving(false);
    }
  }

  async function decide() {
    if (!confirm) return;
    setDeciding(true);
    try {
      await api(`/fmcg/returns/${confirm.record.id}/decision`, { method: 'POST', body: JSON.stringify({ status: confirm.status }) });
      toast(confirm.status === 'approved' ? 'Approved — client balance updated.' : 'Entry rejected.');
      setConfirm(null);
      await load();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Unable to update the entry.', 'error');
    } finally {
      setDeciding(false);
    }
  }

  async function removeRecord(record: ReturnRecord) {
    if (!window.confirm(`Remove this ${record.kind} entry for "${record.productName}"? This cannot be undone.`)) return;
    try {
      await api(`/fmcg/returns/${record.id}`, { method: 'DELETE' });
      toast('Entry removed.');
      await load();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Unable to remove the entry.', 'error');
    }
  }

  function toggleMenu(event: MouseEvent<HTMLButtonElement>, recordId: string) {
    if (menuFor?.id === recordId) { setMenuFor(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: recordId, top: rect.bottom + 6, left: Math.max(8, rect.right - 168) });
  }

  /* ---------- list ---------- */
  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      if (tab !== 'all' && r.status !== tab) return false;
      if (!q) return true;
      return r.clientName.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q) || r.orderNumber.toLowerCase().includes(q);
    });
  }, [records, kindFilter, tab, search]);

  const count = (s: RecordStatus) => records.filter((r) => r.status === s).length;
  const returnCount = records.filter((r) => r.kind === 'return').length;
  const damageCount = records.filter((r) => r.kind === 'damage').length;
  const pendingCount = count('pending');
  const approvedValue = records.filter((r) => r.status === 'approved').reduce((sum, r) => sum + r.credit * (r.rate ?? 1), 0);
  const pendingValue = records.filter((r) => r.status === 'pending').reduce((sum, r) => sum + r.credit * (r.rate ?? 1), 0);
  const TABS: { key: 'all' | RecordStatus; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: records.length },
    { key: 'pending', label: 'Pending', n: pendingCount },
    { key: 'approved', label: 'Approved', n: count('approved') },
    { key: 'rejected', label: 'Rejected', n: count('rejected') },
  ];

  return (
    <section className="page-panel master-page returns-page">
      <div className="page-panel-heading">
        <div>
          <h2>Sales return &amp; damage</h2>
        </div>
        <div className="master-actions">
          <button type="button" className="quiet-button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          <button className="primary-action" type="button" onClick={openCreate}>+ Log return / damage</button>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="kpi-grid returns-kpis">
        <div className="kpi-card" data-tone="blue" {...kpiClick(kindFilter === 'return', () => { setKindFilter('return'); setTab('all'); setSearch(''); })}>
          <div className="kpi-icon kpi-icon-blue">↩</div>
          <div><span>Returns</span><strong>{returnCount}</strong></div>
        </div>
        <div className="kpi-card" data-tone="red" {...kpiClick(kindFilter === 'damage', () => { setKindFilter('damage'); setTab('all'); setSearch(''); })}>
          <div className="kpi-icon kpi-icon-red">⚠</div>
          <div><span>Damage</span><strong>{damageCount}</strong></div>
        </div>
        <div className="kpi-card" data-tone="amber" {...kpiClick(tab === 'pending', () => { setTab('pending'); setKindFilter('all'); setSearch(''); })}>
          <div className="kpi-icon kpi-icon-amber">◷</div>
          <div><span>Awaiting approval</span><strong>{pendingCount}</strong>{pendingCount > 0 && <small>{money(pendingValue)}</small>}</div>
        </div>
        <div className="kpi-card" data-tone="green" {...kpiClick(tab === 'approved', () => { setTab('approved'); setKindFilter('all'); setSearch(''); })}>
          <div className="kpi-icon kpi-icon-green">₹</div>
          <div><span>Credited to clients</span><strong>{money(approvedValue)}</strong></div>
        </div>
      </div>

      <div className="returns-card">
        <div className="returns-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`returns-tab ${tab === t.key ? 'active' : ''} ${t.key === 'pending' && t.n > 0 ? 'tab-attn' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}<span className="tab-count">{t.n}</span>
            </button>
          ))}
        </div>
        <div className="returns-filters">
          <input type="search" placeholder="Search client, product or order no…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as 'all' | Kind)} aria-label="Type">
            <option value="all">All types</option>
            <option value="return">Returns</option>
            <option value="damage">Damage</option>
          </select>
        </div>

        <div className="data-table-wrap returns-table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Client</th><th>Order</th><th>Item</th><th className="num">Qty</th><th>Type</th><th className="num">Credit</th><th>Status</th><th className="col-actions" aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3].map((i) => <tr key={i} className="skeleton-row"><td colSpan={9}><span className="skeleton-block" style={{ width: '100%' }} /></td></tr>)
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="empty-state empty-state-lg">
                      <div className="empty-state-icon">↩</div>
                      <h3>{records.length === 0 ? 'No entries yet' : 'No matching entries'}</h3>
                      {records.length === 0 && <button className="quiet-button" type="button" onClick={openCreate}>+ Log return / damage</button>}
                    </div>
                  </td>
                </tr>
              ) : filteredRecords.map((r) => (
                <tr key={r.id}>
                  <td>{dateLabel(r.createdAt)}</td>
                  <td><div className="client-cell"><span className="client-avatar" aria-hidden="true">{initials(r.clientName)}</span><strong>{r.clientName}</strong></div></td>
                  <td><strong>{r.orderNumber}</strong></td>
                  <td><div className="stack-cell"><strong>{r.productName}</strong>{r.reason && <small title={r.reason}>{r.reason}</small>}</div></td>
                  <td className="num">{r.quantity}</td>
                  <td>
                    <div className="stack-cell">
                      <span className={`status-badge ${r.kind === 'damage' ? 'rd-damage' : 'rd-return'}`}>{r.kind === 'damage' ? 'Damage' : 'Return'}</span>
                      {r.kind === 'return' && <small>{r.restock ? 'Back to stock' : 'No restock'}</small>}
                    </div>
                  </td>
                  <td className="num">
                    {!r.creditClient ? <div className="stack-cell right"><strong>—</strong><small>Client pays</small></div> : <div className="stack-cell right"><strong>{money(r.credit, r.currency ?? 'INR')}</strong>{(r.currency ?? 'INR') !== 'INR' && <small>≈ {money(r.credit * (r.rate ?? 1))}</small>}</div>}
                  </td>
                  <td><span className={`status-badge rd-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                  <td className="row-actions-cell">
                    {r.status === 'pending' && (
                      <>
                        <button type="button" className="quiet-button rd-approve" onClick={() => setConfirm({ record: r, status: 'approved' })}>Approve</button>
                        <button type="button" className="quiet-button rd-reject" onClick={() => setConfirm({ record: r, status: 'rejected' })}>Reject</button>
                      </>
                    )}
                    {r.status !== 'approved' && (
                      <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label="More actions" onClick={(e) => toggleMenu(e, r.id)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {menuFor && (
        <>
          <div className="row-menu-backdrop" onMouseDown={() => setMenuFor(null)} />
          <div className="row-menu row-menu--icons" style={{ top: menuFor.top, left: menuFor.left }}>
            {(() => {
              const record = filteredRecords.find((rec) => rec.id === menuFor.id);
              if (!record) return null;
              return <button type="button" className="row-menu-danger" title="Delete" onClick={() => { setMenuFor(null); void removeRecord(record); }}><span>✕</span><span>Delete</span></button>;
            })()}
          </div>
        </>
      )}

      {/* ── Log return / damage ── */}
      {modal && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setModal(false)}>
          <div className="master-modal returns-drawer" role="dialog" aria-modal="true" aria-labelledby="rd-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><h3 id="rd-modal-title">Log return / damage</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>×</button>
            </div>
            <form className="rd-form" onSubmit={(e) => void submit(e, false)}>
              <div className="rd-body">
                {formError && <p className="error-message">{formError}</p>}

                <div className="rd-field">
                  <label htmlFor="rd-order">Sales order</label>
                  <select id="rd-order" required value={form.orderId} onChange={(e) => pickOrder(e.target.value)}>
                    <option value="">{returnableOrders.length ? 'Select order' : 'No returnable orders'}</option>
                    {returnableOrders.map((o) => <option key={o.id} value={o.id}>{o.order_number} — {o.clients?.client_name ?? 'Client'} ({dateLabel(o.created_at)})</option>)}
                  </select>
                </div>

                {selectedOrder && (
                  <div className="rd-order-card">
                    <div className="rd-order-line"><span>Client</span><strong>{selectedOrder.clients?.client_name ?? '—'}</strong></div>
                    <div className="rd-order-line"><span>Order date</span><strong>{dateLabel(selectedOrder.created_at)}</strong></div>
                    {repName && <div className="rd-order-line"><span>Representative</span><strong>{repName}</strong></div>}
                    <div className="rd-order-line"><span>Order total</span><strong>{money(Number(selectedOrder.total_amount ?? 0), orderCurrency)}</strong>{orderCurrency !== 'INR' && <small>≈ {money(Number(selectedOrder.total_amount ?? 0) * orderRate)}</small>}</div>
                  </div>
                )}

                {selectedOrder && (
                <div className="rd-field">
                  <label>Item</label>
                  {(
                    <div className="rd-lines">
                      {lines.map((l) => (
                        <button type="button" key={l.productId} className={`rd-line ${form.productId === l.productId ? 'active' : ''}`} disabled={l.remaining <= 0} onClick={() => pickLine(l)}>
                          <span className="rd-radio" aria-hidden="true" />
                          <span className="rd-line-main">
                            <strong>{l.name}</strong>
                            <small>{l.code ? `${l.code} · ` : ''}Ordered {l.paidQty}{l.freeQty > 0 ? ` + ${l.freeQty} free` : ''} @ {money(l.netUnit, orderCurrency)}</small>
                          </span>
                          <span className="rd-line-side">
                            {l.remaining > 0 ? <strong>{l.remaining} available</strong> : <strong className="rd-done">Fully returned</strong>}
                            {l.already > 0 && l.remaining > 0 && <small>{l.already} already logged</small>}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                )}

                {selectedLine && (<>
                <div className="rd-row">
                  <div className="rd-field">
                    <label htmlFor="rd-qty">Quantity</label>
                    <div className="rd-qty">
                      <input id="rd-qty" type="number" min="1" step="1" max={selectedLine.remaining} required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                      <span>/ {selectedLine.remaining}</span>
                    </div>
                  </div>
                  <div className="rd-field">
                    <label>Type</label>
                    <div className="rd-segment" role="radiogroup">
                      <button type="button" role="radio" aria-checked={form.kind === 'return'} className={form.kind === 'return' ? 'active' : ''} onClick={() => setKind('return')}>Return</button>
                      <button type="button" role="radio" aria-checked={form.kind === 'damage'} className={form.kind === 'damage' ? 'active' : ''} onClick={() => setKind('damage')}>Damage</button>
                    </div>
                  </div>
                </div>

                {form.kind === 'damage' && (
                  <div className="rd-field">
                    <label>Loss borne by</label>
                    <div className="rd-segment" role="radiogroup">
                      <button type="button" role="radio" aria-checked={form.creditClient} className={form.creditClient ? 'active' : ''} onClick={() => setForm({ ...form, creditClient: true })}>Company</button>
                      <button type="button" role="radio" aria-checked={!form.creditClient} className={!form.creditClient ? 'active' : ''} onClick={() => setForm({ ...form, creditClient: false })}>Client</button>
                    </div>
                  </div>
                )}

                {form.kind === 'return' && (
                  <label className="rd-check">
                    <input type="checkbox" checked={form.restock} onChange={(e) => setForm({ ...form, restock: e.target.checked })} />
                    <span>Add goods back to stock</span>
                  </label>
                )}

                <div className="rd-field">
                  <label htmlFor="rd-reason">Reason <em>(optional)</em></label>
                  <input id="rd-reason" value={form.reason} placeholder="Select or type a reason" onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                  <div className="rd-chips">
                    {REASONS[form.kind].map((r) => <button type="button" key={r} className={form.reason === r ? 'active' : ''} onClick={() => setForm({ ...form, reason: r, creditClient: r === 'Damaged at outlet' ? false : form.creditClient })}>{r}</button>)}
                  </div>
                </div>

                {qty > 0 && (
                  <div className="rd-summary">
                    <div className="rd-summary-main">
                      <span>Credit to client</span>
                      <strong>{money(credit, orderCurrency)}</strong>
                      {orderCurrency !== 'INR' && <small>≈ {money(credit * orderRate)}</small>}
                    </div>
                    <div className="rd-tags">
                      {form.kind === 'return' && form.restock && <em>+{qty} to stock</em>}
                      {form.kind === 'return' && !form.restock && <em>No restock</em>}
                      {form.kind === 'damage' && <em>Written off</em>}
                      {form.kind === 'damage' && !form.creditClient && <em>Client pays</em>}
                      {credit === 0 && (form.kind === 'return' || form.creditClient) && <em>Free units · no credit</em>}
                    </div>
                  </div>
                )}
                </>)}
              </div>

              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
                <button className="quiet-button" type="submit" disabled={saving || !selectedLine}>{saving ? 'Saving…' : 'Log for approval'}</button>
                <button className="primary-action" type="button" disabled={saving || !selectedLine} onClick={() => void submit(null, true)}>{saving ? 'Saving…' : 'Log & approve'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Approve / reject confirmation ── */}
      {confirm && (
        <div className="modal-backdrop modal-backdrop--center" role="presentation" onMouseDown={() => !deciding && setConfirm(null)}>
          <div className="master-modal master-modal--center returns-confirm" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">{confirm.record.kind === 'damage' ? 'DAMAGE' : 'RETURN'} · {confirm.record.orderNumber}</p><h3>{confirm.status === 'approved' ? 'Approve entry' : 'Reject entry'}</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setConfirm(null)}>×</button>
            </div>
            <div className="returns-confirm-body">
              {confirm.status === 'approved' ? (
                confirm.record.kind === 'damage' && !confirm.record.creditClient ? (
                <p>{confirm.record.quantity} × {confirm.record.productName} are written off. <strong>{confirm.record.clientName}</strong> is not credited and pays for these goods. This cannot be undone.</p>
              ) : (
                <p><strong>{confirm.record.clientName}</strong> is credited <strong>{money(confirm.record.credit, confirm.record.currency ?? 'INR')}</strong>{confirm.record.kind === 'return' && confirm.record.restock ? `, and ${confirm.record.quantity} × ${confirm.record.productName} go back into stock` : ''}. This cannot be undone.</p>
              )) : (
                <p>{confirm.record.quantity} × {confirm.record.productName} for {confirm.record.clientName} will be rejected. Balance and stock stay unchanged.</p>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setConfirm(null)} disabled={deciding}>Cancel</button>
              <button type="button" className={confirm.status === 'approved' ? 'primary-action' : 'primary-action icon-action--danger'} onClick={() => void decide()} disabled={deciding}>{deciding ? 'Saving…' : confirm.status === 'approved' ? 'Approve' : 'Reject'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="returns-toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`returns-toast ${t.tone}`}>{t.message}</div>)}
      </div>
    </section>
  );
}