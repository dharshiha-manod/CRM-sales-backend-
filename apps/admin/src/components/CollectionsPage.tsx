import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import './MasterDataPages.css';
import './CollectionsPage.css';

/* ══════════════════════════════════════════════════════════════════════
   Collections — frontend-only rewrite wired to the real Sales Order flow.

   Sales Order → Payment → Collection

   Every non-cancelled Sales Order automatically becomes one row on this
   ledger the moment it's created (pending amount = order total, nothing
   collected yet). Recording a payment against an order (either from here
   or from the Orders page) hits the same `/collections` endpoint, and
   Paid Amount / Balance / Payment Status recompute automatically because
   they're derived, not stored locally.

   No mock data, no local seed — orders and collections both come from the
   API, same endpoints Sales Orders already uses (`/orders`, `/collections`).
   ══════════════════════════════════════════════════════════════════════ */

type OrderRef = {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  created_at: string;
  clients?: { client_code?: string; client_name?: string } | null;
  sales_representatives?: { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null;
};

type PaymentMode = 'cash' | 'upi' | 'bank_transfer' | 'cheque' | 'other';
const PAYMENT_MODES: PaymentMode[] = ['cash', 'upi', 'bank_transfer', 'cheque', 'other'];
const MODE_LABEL: Record<PaymentMode, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' };

// Raw shape of a collection (payment) row as returned by GET /collections —
// same endpoint & shape the Sales Orders page already consumes.
type CollectionApiRecord = {
  id?: string;
  amount: number;
  mode?: string | null;
  reference_no?: string | null;
  notes?: string | null;
  created_at?: string | null;
  order_id?: string | null;
  sale_orders?: { id?: string; order_number?: string } | null;
};

type PaymentStatus = 'pending' | 'partially_paid' | 'paid' | 'overdue';
const STATUS_LABEL: Record<PaymentStatus, string> = { pending: 'Pending', partially_paid: 'Partially Paid', paid: 'Paid', overdue: 'Overdue' };
const STATUS_CLASS: Record<PaymentStatus, string> = { pending: 'status-pending', partially_paid: 'status-partial', paid: 'status-paid-c', overdue: 'status-overdue' };

// The orders table has no due-date column yet, so — same convention the
// Orders page already uses for payment type / dispatch status (fields the
// backend doesn't carry) — we assume a standard 30-day credit window from
// the order date. Only used to flag "Overdue"; doesn't touch the backend.
const CREDIT_DAYS = 30;

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
const monthLabel = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' }).format(new Date(`${value}-01T00:00:00`));
const todayIso = () => new Date().toISOString().slice(0, 10);
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (iso: string, days: number) => { const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString(); };
const monthKey = (iso: string) => iso.slice(0, 7);

// ── One row per Sales Order — this *is* the "Sales Order → Payment → Collection" link ──
type CollectionRow = {
  collectionId: string;
  orderId: string;
  orderNumber: string;
  clientCode?: string;
  clientName: string;
  repName: string;
  invoiceAmount: number;
  paidAmount: number;
  balance: number;
  status: PaymentStatus;
  orderDate: string;
  dueDate: string;
  lastPaymentDate: string | null;
  payments: CollectionApiRecord[];
};

function computeStatus(balance: number, paidAmount: number, dueDateIso: string): PaymentStatus {
  if (balance <= 0.5) return 'paid';
  if (new Date(dueDateIso) < startOfToday()) return 'overdue';
  if (paidAmount > 0) return 'partially_paid';
  return 'pending';
}

type SortField = 'client' | 'orderId' | 'rep' | 'invoiceAmount' | 'paid' | 'balance' | 'status' | 'lastPayment';
type SortDir = 'asc' | 'desc';
type Toast = { id: number; message: string; tone: 'success' | 'info' };

export function CollectionsPage() {
  const { clientMatchesActiveIndustry } = useIndustryScope();

  const [orders, setOrders] = useState<OrderRef[]>([]);
  const [payments, setPayments] = useState<CollectionApiRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [search, setSearch] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dueBeforeFilter, setDueBeforeFilter] = useState('');
  const [paidSinceFilter, setPaidSinceFilter] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');

  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'lastPayment', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
 
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followedUp, setFollowedUp] = useState<Set<string>>(new Set());
  const [followUpConfirm, setFollowUpConfirm] = useState<CollectionRow | null>(null);
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);
  function toggleMenu(event: React.MouseEvent<HTMLButtonElement>, orderId: string) {
    if (menuFor?.id === orderId) { setMenuFor(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: orderId, top: rect.bottom + 6, left: Math.max(8, rect.right - 168) });
  }

  function pushToast(message: string, tone: Toast['tone'] = 'success') {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { id, message, tone }]);
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 3200);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [ordersRes, collectionsRes] = await Promise.all([
        api<{ data: OrderRef[] }>('/orders'),
        api<{ data: CollectionApiRecord[] }>('/collections').catch(() => ({ data: [] })),
      ]);
      setOrders(ordersRes.data ?? []);
      setPayments(collectionsRes.data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load collections.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { setPage(1); }, [search, repFilter, statusFilter, dueBeforeFilter, paidSinceFilter, amountMin, amountMax]);

  // Every payment keyed by both order id and order number so it lines up
  // with an order regardless of which one the API happened to populate.
  const paymentsByOrder = useMemo(() => {
    const map = new Map<string, CollectionApiRecord[]>();
    const push = (key: string | undefined | null, record: CollectionApiRecord) => {
      if (!key) return;
      const list = map.get(key) ?? [];
      list.push(record);
      map.set(key, list);
    };
    for (const p of payments) {
      push(p.order_id, p);
      push(p.sale_orders?.id, p);
      push(p.sale_orders?.order_number, p);
    }
    return map;
  }, [payments]);

  // ── Sales Order → Collection: one row per non-cancelled order, scoped to the active industry ──
  const rows = useMemo<CollectionRow[]>(() => {
    return orders
      .filter((order) => order.status !== 'cancelled')
      .filter((order) => clientMatchesActiveIndustry(order.clients?.client_code))
      .map((order) => {
        const pays = paymentsByOrder.get(order.id) ?? paymentsByOrder.get(order.order_number) ?? [];
        const invoiceAmount = Number(order.total_amount || 0);
        const paidAmount = pays.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const balance = Math.max(0, invoiceAmount - paidAmount);
        const dueDate = addDays(order.created_at, CREDIT_DAYS);
        const lastPaymentDate = pays.length
          ? [...pays].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')).at(-1)!.created_at ?? null
          : null;
        return {
          collectionId: `COL-${order.order_number}`,
          orderId: order.id,
          orderNumber: order.order_number,
          clientCode: order.clients?.client_code,
          clientName: order.clients?.client_name ?? order.clients?.client_code ?? 'Unknown client',
          repName: order.sales_representatives?.user_profiles?.display_name ?? order.sales_representatives?.employee_code ?? 'Unassigned',
          invoiceAmount,
          paidAmount,
          balance,
          status: computeStatus(balance, paidAmount, dueDate),
          orderDate: order.created_at,
          dueDate,
          lastPaymentDate,
          payments: pays,
        };
      });
  }, [orders, paymentsByOrder, clientMatchesActiveIndustry]);

  const repOptions = useMemo(() => [...new Set(rows.map((r) => r.repName))].sort(), [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    const text = `${r.clientName} ${r.orderNumber} ${r.repName} ${r.collectionId}`.toLowerCase();
    const min = amountMin ? Number(amountMin) : null;
    const max = amountMax ? Number(amountMax) : null;
    return (
      (!search || text.includes(search.toLowerCase())) &&
      (!repFilter || r.repName === repFilter) &&
      (!statusFilter || r.status === statusFilter) &&
      (!dueBeforeFilter || r.dueDate.slice(0, 10) <= dueBeforeFilter) &&
      (!paidSinceFilter || (r.lastPaymentDate ?? '').slice(0, 10) >= paidSinceFilter) &&
      (min === null || r.invoiceAmount >= min) &&
      (max === null || r.invoiceAmount <= max)
    );
  }), [rows, search, repFilter, statusFilter, dueBeforeFilter, paidSinceFilter, amountMin, amountMax]);

  function clearFilters() {
    setSearch(''); setRepFilter(''); setStatusFilter(''); setDueBeforeFilter(''); setPaidSinceFilter(''); setAmountMin(''); setAmountMax('');
  }
  const filtersActive = !!(search || repFilter || statusFilter || dueBeforeFilter || paidSinceFilter || amountMin || amountMax);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (sort.field) {
        case 'client': return a.clientName.localeCompare(b.clientName) * dir;
        case 'orderId': return a.orderNumber.localeCompare(b.orderNumber) * dir;
        case 'rep': return a.repName.localeCompare(b.repName) * dir;
        case 'invoiceAmount': return (a.invoiceAmount - b.invoiceAmount) * dir;
        case 'paid': return (a.paidAmount - b.paidAmount) * dir;
        case 'balance': return (a.balance - b.balance) * dir;
        case 'status': return a.status.localeCompare(b.status) * dir;
        case 'lastPayment': return (a.lastPaymentDate ?? '').localeCompare(b.lastPaymentDate ?? '') * dir;
        default: return 0;
      }
    });
    return list;
  }, [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize);

  function toggleSort(field: SortField) {
    setSort((cur) => (cur.field === field ? { field, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }));
  }
  const sortIndicator = (field: SortField) => (sort.field !== field ? '' : sort.dir === 'asc' ? ' ▲' : ' ▼');

  // ── KPIs (full industry-scoped ledger, independent of the table's own filters) ──
  const totalOutstanding = useMemo(() => rows.reduce((sum, r) => sum + r.balance, 0), [rows]);
  const thisMonthKey = todayIso().slice(0, 7);
  const lastMonthKey = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const scopedPayments = useMemo(() => {
    const orderIds = new Set(rows.map((r) => r.orderId));
    const orderNumbers = new Set(rows.map((r) => r.orderNumber));
    return payments.filter((p) => (p.order_id && orderIds.has(p.order_id)) || (p.sale_orders?.order_number && orderNumbers.has(p.sale_orders.order_number)));
  }, [payments, rows]);
  const collectedInMonth = (key: string) => scopedPayments.filter((p) => monthKey(p.created_at ?? '') === key).reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const collectedThisMonth = useMemo(() => collectedInMonth(thisMonthKey), [scopedPayments]); // eslint-disable-line react-hooks/exhaustive-deps
  const collectedLastMonth = useMemo(() => collectedInMonth(lastMonthKey), [scopedPayments]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthTrendPct = collectedLastMonth > 0 ? Math.round(((collectedThisMonth - collectedLastMonth) / collectedLastMonth) * 100) : (collectedThisMonth > 0 ? 100 : 0);
  const pendingRecords = useMemo(() => rows.filter((r) => r.status !== 'paid'), [rows]);
  const overdueRecords = useMemo(() => rows.filter((r) => r.status === 'overdue'), [rows]);
  const overdueAmount = useMemo(() => overdueRecords.reduce((sum, r) => sum + r.balance, 0), [overdueRecords]);
  const totalDue = useMemo(() => rows.reduce((sum, r) => sum + r.invoiceAmount, 0), [rows]);
  const totalCollected = useMemo(() => rows.reduce((sum, r) => sum + r.paidAmount, 0), [rows]);
  const collectionRate = totalDue > 0 ? Math.round((totalCollected / totalDue) * 100) : 0;

  // ── Charts ──
  const monthsBack = useMemo(() => {
    const arr: string[] = [];
    for (let i = 5; i >= 0; i -= 1) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); arr.push(d.toISOString().slice(0, 7)); }
    return arr;
  }, []);
  const monthlyTrend = useMemo(() => monthsBack.map((key) => ({ key, value: collectedInMonth(key) })), [monthsBack, scopedPayments]); // eslint-disable-line react-hooks/exhaustive-deps
  const trendMax = Math.max(1, ...monthlyTrend.map((m) => m.value));
  const perfBars = [
    { label: 'Collected', value: totalCollected, tone: 'good' as const },
    { label: 'Outstanding', value: totalOutstanding, tone: 'warn' as const },
    { label: 'Overdue', value: overdueAmount, tone: 'bad' as const },
  ];
  const perfMax = Math.max(1, ...perfBars.map((b) => b.value));

  // ── + Add Collection modal — manual entries reuse the same /collections endpoint ──
  // When launched from a row (an order already linked to a Sales Order), the
  // client & order are pre-selected and locked — no re-entry. Launched from
  // the toolbar button, the user picks an existing Client, then an existing
  // Order for that client; nothing is typed free-form.
  const [payModal, setPayModal] = useState(false);
  const [payLocked, setPayLocked] = useState(false);
  const [payClientCode, setPayClientCode] = useState('');
  const [payOrderId, setPayOrderId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState<PaymentMode>('bank_transfer');
  const [payReference, setPayReference] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState('');
  const [saving, setSaving] = useState(false);

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) { if (r.clientCode) map.set(r.clientCode, r.clientName); }
    return [...map.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);
  const eligibleOrdersForClient = useMemo(
    () => rows.filter((r) => r.clientCode === payClientCode && r.status !== 'paid'),
    [rows, payClientCode],
  );
  const activeRow = rows.find((r) => r.orderId === payOrderId) ?? null;

  function openAddCollection(row: CollectionRow | null) {
    setPayModal(true);
    setPayLocked(!!row);
    setPayClientCode(row?.clientCode ?? '');
    setPayOrderId(row?.orderId ?? '');
    setPayAmount(''); setPayMode('bank_transfer'); setPayReference(''); setPayNotes(''); setPayError('');
  }
  function closeAddCollection() { if (!saving) setPayModal(false); }

  async function submitPayment() {
    setPayError('');
    if (!activeRow) { setPayError('Select a client and order to record this collection against.'); return; }
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { setPayError('Enter a collection amount greater than zero.'); return; }
    if (amount > activeRow.balance + 0.5) { setPayError(`Amount exceeds the outstanding balance of ${money(activeRow.balance)}.`); return; }
    setSaving(true);
    try {
      await api('/collections', {
        method: 'POST',
        body: JSON.stringify({
          orderId: activeRow.orderId,
          amount,
          mode: payMode,
          referenceNo: payReference.trim() || null,
          notes: payNotes.trim() || null,
        }),
      });
      pushToast(`Collection of ${money(amount)} recorded for ${activeRow.clientName}.`);
      setPayModal(false);
      await load();
    } catch (caught) {
      setPayError(caught instanceof Error ? caught.message : 'Unable to record this collection.');
    } finally {
      setSaving(false);
    }
  }

// NEW
  // ── Follow-up — creates a real row in Follow-ups (same pattern Field
  // activity uses: POST .../follow-ups against the source record — here the
  // Sales Order) so it actually shows up on the Follow-ups page, onsite or
  // office-created alike. ──
  async function confirmFollowUp() {
    if (!followUpConfirm) return;
    setFollowUpSaving(true);
    try {
      await api(`/orders/${followUpConfirm.orderId}/follow-ups`, {
        method: 'POST',
        body: JSON.stringify({
          title: `Overdue payment — ${followUpConfirm.clientName} (${followUpConfirm.orderNumber})`,
          dueAt: new Date().toISOString(),
          priority: 'high',
        }),
      });
      setFollowedUp((cur) => new Set(cur).add(followUpConfirm.orderId));
      pushToast(`Follow-up created in Follow-ups module for ${followUpConfirm.clientName}.`);
      setFollowUpConfirm(null);
    } catch (caught) {
      pushToast(caught instanceof Error ? caught.message : 'Unable to create follow-up.', 'info');
    } finally {
      setFollowUpSaving(false);
    }
  }

  function exportCsv() {
    const header = ['Collection ID', 'Client', 'Order ID', 'Representative', 'Invoice Amount', 'Paid Amount', 'Balance', 'Payment Status', 'Payment Date'];
    const lines = sorted.map((r) => [r.collectionId, r.clientName, r.orderNumber, r.repName, r.invoiceAmount, r.paidAmount, r.balance, STATUS_LABEL[r.status], r.lastPaymentDate ? r.lastPaymentDate.slice(0, 10) : '']
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `collections-${todayIso()}.csv`; a.click();
    URL.revokeObjectURL(url);
    pushToast('Export downloaded.', 'info');
  }

  const selected = selectedId ? rows.find((r) => r.orderId === selectedId) ?? null : null;

  return (
    <section className="page-panel master-page collections-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">RECEIVABLES</p>
          <h2>Collections</h2>
          <p>Every Sales Order flows straight into this ledger — track its payment status, balance and history here.</p>
        </div>
        <div className="master-actions">
          <button type="button" className="primary-action" onClick={() => openAddCollection(null)}>+ Add Collection</button>
          <button type="button" className="quiet-button" onClick={exportCsv}>Export</button>
          <button type="button" className="quiet-button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="kpi-grid collections-kpi-grid">
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon kpi-icon-ink">₹</div>
          <div><span>Total Outstanding</span><strong>{money(totalOutstanding)}</strong></div>
        </div>
        <div className="kpi-card" data-tone="green">
          <div className="kpi-icon kpi-icon-green">✓</div>
          <div>
            <span>Collected This Month</span><strong>{money(collectedThisMonth)}</strong>

          </div>
        </div>
        <div className="kpi-card" data-tone="amber">
          <div className="kpi-icon kpi-icon-amber">◔</div>
          <div><span>Pending Collections</span><strong>{pendingRecords.length}</strong></div>
        </div>
        <div className="kpi-card" data-tone="red">
          <div className="kpi-icon kpi-icon-red">⚠</div>
          <div><span>Overdue Amount</span><strong>{money(overdueAmount)}</strong></div>
        </div>
        <div className="kpi-card" data-tone="blue">
          <div className="kpi-icon kpi-icon-blue">%</div>
          <div>
            <span>Collection Rate</span><strong>{collectionRate}%</strong>
            <div className="kpi-progress"><div className="kpi-progress-fill" style={{ width: `${Math.min(100, collectionRate)}%` }} /></div>
          </div>
        </div>
      </div>

      <div className="master-toolbar collections-toolbar">
        <div className="master-search">
          <input type="search" value={search} placeholder="Search client / order ID" onChange={(e) => setSearch(e.target.value)} />
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
            <option value="">All representatives</option>
            {repOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as PaymentStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <label className="filter-date"><span>Due before</span><input type="date" value={dueBeforeFilter} onChange={(e) => setDueBeforeFilter(e.target.value)} /></label>
          <label className="filter-date"><span>Paid since</span><input type="date" value={paidSinceFilter} onChange={(e) => setPaidSinceFilter(e.target.value)} /></label>
          <input type="number" min="0" placeholder="Min amount" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} className="filter-amount" />
          <input type="number" min="0" placeholder="Max amount" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} className="filter-amount" />
          <button type="button" className="link-button" disabled={!filtersActive} onClick={clearFilters}>Clear Filters</button>
        </div>
      </div>

         <div className="data-table-wrap collections-table-wrap">
        <table className="sortable-table">
          <thead>
            <tr>
              <th>Collection ID</th>
              <th className="sortable" onClick={() => toggleSort('client')}>Client{sortIndicator('client')}</th>
              <th className="sortable" onClick={() => toggleSort('orderId')}>Order ID{sortIndicator('orderId')}</th>
              <th className="sortable" onClick={() => toggleSort('rep')}>Representative{sortIndicator('rep')}</th>
              <th className="sortable" onClick={() => toggleSort('invoiceAmount')}>Invoice Amount{sortIndicator('invoiceAmount')}</th>
              <th className="sortable" onClick={() => toggleSort('paid')}>Paid Amount{sortIndicator('paid')}</th>
              <th className="sortable" onClick={() => toggleSort('balance')}>Balance{sortIndicator('balance')}</th>
              <th className="sortable" onClick={() => toggleSort('status')}>Payment Status{sortIndicator('status')}</th>
              <th className="sortable" onClick={() => toggleSort('lastPayment')}>Payment Date{sortIndicator('lastPayment')}</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0, 1, 2, 3].map((i) => <tr key={i} className="skeleton-row"><td colSpan={10}><span className="skeleton-block" style={{ width: '100%' }} /></td></tr>)
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={10}>
                  <div className="empty-state empty-state-lg">
                    <div className="empty-state-icon">₹</div>
                    <h3>No collections yet</h3>
                    <p>{filtersActive ? 'No collections match these filters.' : 'Create a Sales Order and its pending amount will show up here automatically.'}</p>
                    {filtersActive && <button className="quiet-button" type="button" onClick={clearFilters}>Clear filters</button>}
                  </div>
                </td>
              </tr>
            ) : (
              pageItems.map((row) => (
                <tr key={row.orderId} className={row.status === 'overdue' ? 'row-overdue' : ''}>
                  <td>{row.collectionId}</td>
                  <td><strong>{row.clientName}</strong></td>
                  <td>{row.orderNumber}</td>
                  <td>{row.repName}</td>
                  <td>{money(row.invoiceAmount)}</td>
                  <td>{money(row.paidAmount)}</td>
                  <td>{money(row.balance)}</td>
                  <td><span className={`status-badge ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span></td>
                  <td>{row.lastPaymentDate ? dateLabel(row.lastPaymentDate) : '—'}</td>
                  <td className="master-actions">
                    <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label="More actions" onClick={(e) => toggleMenu(e, row.orderId)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="5" cy="12" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="19" cy="12" r="1.8" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && sorted.length > 0 && (
        <div className="table-pagination">
          <div className="page-size">
            <span>Rows per page</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
          <span className="page-range">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} of {sorted.length}</span>
          <div className="page-controls">
            <button type="button" className="quiet-button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <span>Page {page} of {pageCount}</span>
            <button type="button" className="quiet-button" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button>
          </div>
        </div>
      )}

      {menuFor && (
        <>
          <div className="row-menu-backdrop" onMouseDown={() => setMenuFor(null)} />
          <div className="row-menu row-menu--icons" style={{ top: menuFor.top, left: menuFor.left }}>
            {(() => {
              const row = pageItems.find((r) => r.orderId === menuFor.id);
              if (!row) return null;
              return (
                <>
                  <button type="button" title="View" onClick={() => { setSelectedId(row.orderId); setMenuFor(null); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span>View</span>
                  </button>
                  {row.status !== 'paid' && (
                    <button type="button" title="Record payment" onClick={() => { openAddCollection(row); setMenuFor(null); }}>
                      <span>₹</span>
                      <span>Record payment</span>
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* ── Charts ── */}
      <div className="collections-charts">
        <div className="chart-card">
          <h4>Collection Performance</h4>
          <div className="perf-bars">
            {perfBars.map((bar) => (
              <div className="perf-bar-row" key={bar.label}>
                <span className="perf-bar-label">{bar.label}</span>
                <div className="perf-bar-track"><div className={`perf-bar-fill tone-${bar.tone}`} style={{ width: `${(bar.value / perfMax) * 100}%` }} /></div>
                <span className="perf-bar-value">{money(bar.value)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="chart-card">
          <h4>Monthly Collection Trend</h4>
          <div className="trend-chart">
            {monthlyTrend.map((m) => (
              <div className="trend-bar-col" key={m.key}>
                <span className="trend-bar-value">{m.value > 0 ? money(m.value) : ''}</span>
                <div className="trend-bar" style={{ height: `${Math.max(4, (m.value / trendMax) * 100)}%` }} />
                <span className="trend-bar-label">{monthLabel(m.key)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Overdue Collections ── */}
      <div className="overdue-section">
        <h3>Overdue Collections</h3>
        {overdueRecords.length === 0 ? (
          <p className="text-faint-inline">No overdue collections right now.</p>
        ) : (
          <div className="data-table-wrap">
            <table>
              <thead><tr><th>Client</th><th>Order ID</th><th>Outstanding</th><th>Representative</th><th>Follow-up</th><th>Action</th></tr></thead>
              <tbody>
                {overdueRecords.map((row) => (
                  <tr key={row.orderId} className="row-overdue">
                    <td>{row.clientName}</td>
                    <td>{row.orderNumber}</td>
                    <td>{money(row.balance)}</td>
                    <td>{row.repName}</td>
                    <td><span className={`status-badge ${followedUp.has(row.orderId) ? 'status-paid-c' : 'status-pending'}`}>{followedUp.has(row.orderId) ? 'Follow-up created' : 'Not started'}</span></td>
                    <td><button type="button" className="quiet-button" disabled={followedUp.has(row.orderId)} onClick={() => setFollowUpConfirm(row)}>{followedUp.has(row.orderId) ? 'Follow-up sent' : 'Create Follow-up'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Detail panel ── */}
      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelectedId(null)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">COLLECTION DETAILS</p><h3>{selected.clientName}</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setSelectedId(null)}>×</button>
            </div>

            <dl className="detail-dl">
              <dt>Collection ID</dt><dd>{selected.collectionId}</dd>
              <dt>Order ID</dt><dd>{selected.orderNumber} · placed {dateLabel(selected.orderDate)}</dd>
              <dt>Representative</dt><dd>{selected.repName}</dd>
              <dt>Invoice amount</dt><dd>{money(selected.invoiceAmount)}</dd>
              <dt>Paid amount</dt><dd>{money(selected.paidAmount)}</dd>
              <dt>Balance</dt><dd>{money(selected.balance)}</dd>
              <dt>Payment status</dt><dd><span className={`status-badge ${STATUS_CLASS[selected.status]}`}>{STATUS_LABEL[selected.status]}</span></dd>
            </dl>
            <p className="ledger-heading">Payment timeline</p>
            <ul className="lead-activity-timeline collections-timeline">
              <li><span className="timeline-dot" /><div><strong>Order placed</strong><p>{dateLabel(selected.orderDate)} · pending amount due {dateLabel(selected.dueDate)}</p></div></li>
              {[...selected.payments].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')).map((p, i) => (
                <li key={p.id ?? i}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>Payment {i + 1} — {money(Number(p.amount || 0))}</strong>
                    <p>{p.created_at ? dateLabel(p.created_at) : '—'} · {p.mode ? MODE_LABEL[p.mode as PaymentMode] ?? p.mode : '—'}{p.reference_no ? ` · Ref ${p.reference_no}` : ''}</p>
                  </div>
                </li>
              ))}
              {selected.payments.length === 0 && <li><span className="timeline-dot" /><div><strong>No payments recorded yet</strong><p>Awaiting first collection.</p></div></li>}
            </ul>

            {selected.status !== 'paid' && (
              <div className="modal-actions">
                <button type="button" className="primary-action" onClick={() => { setSelectedId(null); openAddCollection(selected); }}>Record Payment</button>
              </div>
            )}
            </div>
        </div>
      )}

      {/* ── Add / record collection modal ── */}
      {payModal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => closeAddCollection()}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="collection-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">PAYMENT CONTROL</p><h3 id="collection-modal-title">{payLocked ? 'Record payment' : 'Add collection'}</h3></div>
              <button type="button" className="icon-action" aria-label="Close" title="Close" onClick={() => closeAddCollection()}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={(e) => { e.preventDefault(); void submitPayment(); }}>
              {payError && <p className="error-message" style={{ gridColumn: '1 / -1' }}>{payError}</p>}

              <label style={{ gridColumn: '1 / -1' }}>
                Client
                <select
                  required
                  value={payClientCode}
                  disabled={payLocked}
                  onChange={(e) => { setPayClientCode(e.target.value); setPayOrderId(''); }}
                >
                  <option value="">Select a client</option>
                  {clientOptions.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>

              <label style={{ gridColumn: '1 / -1' }}>
                Order
                <select required value={payOrderId} disabled={payLocked || !payClientCode} onChange={(e) => setPayOrderId(e.target.value)}>
                  <option value="">Select an outstanding order</option>
                  {eligibleOrdersForClient.map((r) => <option key={r.orderId} value={r.orderId}>{r.orderNumber} ({money(r.balance)} due)</option>)}
                </select>
                {payClientCode && eligibleOrdersForClient.length === 0 && <small className="text-faint-inline">No outstanding orders for this client.</small>}
              </label>

              {activeRow && <>
                <label>Representative<input value={activeRow.repName} disabled /></label>
                <label>Invoice amount<input value={money(activeRow.invoiceAmount)} disabled /></label>
                <label>Already paid<input value={money(activeRow.paidAmount)} disabled /></label>
                <label>Outstanding balance<input value={money(activeRow.balance)} disabled /></label>
                <label>Collection amount<input type="number" min="0.01" step="0.01" required value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={String(activeRow.balance)} /></label>
                <label>Payment mode
                  <select value={payMode} onChange={(e) => setPayMode(e.target.value as PaymentMode)}>
                    {PAYMENT_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                  </select>
                </label>
                <label>Reference number<input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="UTR / cheque no. (optional)" /></label>
                <label style={{ gridColumn: '1 / -1' }}>Notes<textarea rows={2} value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Optional" /></label>
              </>}

              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => closeAddCollection()} disabled={saving}>Cancel</button>
                <button type="submit" className="primary-action" disabled={saving || !activeRow}>{saving ? 'Saving…' : 'Record collection'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Follow-up confirmation ── */}
      {followUpConfirm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setFollowUpConfirm(null)}>
          <div className="master-modal confirm-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">FOLLOW-UP</p><h3>Create follow-up?</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setFollowUpConfirm(null)}>×</button>
            </div>
            <p className="confirm-body">This creates a follow-up task in the Follow-ups module for <strong>{followUpConfirm.clientName}</strong> ({money(followUpConfirm.balance)} outstanding on order {followUpConfirm.orderNumber}).</p>
          
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setFollowUpConfirm(null)} disabled={followUpSaving}>Cancel</button>
              <button type="button" className="primary-action" onClick={() => void confirmFollowUp()} disabled={followUpSaving}>{followUpSaving ? 'Saving…' : 'Create Follow-up'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toasts ── */}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.message}</div>)}
      </div>
    </section>
  );
} 