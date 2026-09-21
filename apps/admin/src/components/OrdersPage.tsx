import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import { buildDraftFromOrder } from '../lib/tradeDocumentHandoff';
import './MasterDataPages.css';

const ORDER_DOC_TYPES = ['Commercial Invoice', 'Packing List', 'Delivery Note', 'Bill of Lading', 'Other'];

type OrderItem = {
  quantity: number;
  unit_price: number;
  discount_amount: number;
  subtotal: number;
  products?: { product_code?: string; product_name?: string } | null;
};
type Order = {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  discount_amount: number;
  created_at: string;
  notes?: string | null;
  visit_id?: string | null;
  quotation_id?: string | null; // not populated by every API response — rendered/matched only if present
  clients?: { client_code?: string; client_name?: string; industry_types?: { name?: string } | null } | null;
  sales_representatives?: { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null;
  sale_order_items?: OrderItem[];
};
type CollectionRecord = { amount: number; sale_orders?: { order_number?: string } | null };
type VisitRef = {
  id: string;
  check_in_time: string;
  outcome?: string | null;
  clients?: { client_name?: string } | null;
};
type AddClient = { id: string; client_code: string; client_name: string };
type AddProduct = { id: string; product_code: string; product_name: string; selling_price: number };
type AddOrderLine = { productId: string; quantity: string; discountPercent: string; freeQuantity: string };
const emptyAddLine: AddOrderLine = { productId: '', quantity: '1', discountPercent: '0', freeQuantity: '0' };

// ── Automatic Sales Order pipeline (Requirement → Quotation → Order) ──
// Quotations already carry a "convert" action on the backend (used today by
// QuotationsPage). This page reuses that same endpoint so an accepted
// quotation can become a Sales Order in one click, without touching the API.
type QuotationItemRef = {
  quantity: number;
  unit_price: number;
  discount_amount: number;
  subtotal: number;
  products?: { product_code?: string; product_name?: string } | null;
};
type ReadyQuotation = {
  id: string;
  quotation_number: string;
  status: 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';
  // An accepted quotation is converted automatically on approval. The API
  // retains the accepted status for older records, so this is the reliable
  // signal that an order already exists.
  converted_order_id?: string | null;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  notes?: string | null;
  created_at: string;
  requirement_id?: string | null; // not populated by every API response — rendered only if present
  clients?: { client_code?: string; client_name?: string } | null;
  sales_representatives?: { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null;
  quotation_items?: QuotationItemRef[];
};
type RequirementRef = { id: string; title?: string };

/** An order counts as automatic if it carries a quotation_id. Older/manual
 *  orders never have one, so they fall back to "Manual" — no guessing. */
function orderSource(order: Order): 'quotation' | 'manual' {
  return order.quotation_id ? 'quotation' : 'manual';
}
function sourceBadgeLabel(order: Order): string {
  return orderSource(order) === 'quotation' ? 'From Quotation' : 'Manual';
}

const currency = (value: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const dateOnly = (value: string) => value?.slice(0, 10) ?? '';

const paymentModes = ['cash', 'upi', 'bank_transfer', 'cheque', 'other'] as const;
type PaymentForm = { amount: string; mode: (typeof paymentModes)[number]; referenceNo: string; notes: string };
const emptyPaymentForm: PaymentForm = { amount: '', mode: 'cash', referenceNo: '', notes: '' };

// Free quantity: parsed back out of the notes block FieldActivityPage packs in, keyed by product code.
function parseFreeQuantities(notes?: string | null): Record<string, string> {
  if (!notes) return {};
  const match = notes.match(/\[FREE_QTY\]([\s\S]*?)\[\/FREE_QTY\]/);
  if (!match) return {};
  try { return JSON.parse(match[1]); } catch { return {}; }
}
function cleanNotes(notes?: string | null): string {
  if (!notes) return '';
  return notes.replace(/\[FREE_QTY\][\s\S]*?\[\/FREE_QTY\]/, '').trim();
}
// Same packing convention used by FieldActivityPage's visit-order form, so
// this page's own parseFreeQuantities/cleanNotes above can read it back.
function packFreeQuantities(lines: AddOrderLine[], products: AddProduct[], notes: string): string {
  const map: Record<string, string> = {};
  for (const line of lines) {
    if (!line.freeQuantity || Number(line.freeQuantity) <= 0) continue;
    const code = products.find((p) => p.id === line.productId)?.product_code;
    if (code) map[code] = line.freeQuantity;
  }
  if (Object.keys(map).length === 0) return notes;
  const block = `[FREE_QTY]${JSON.stringify(map)}[/FREE_QTY]`;
  return notes ? `${notes}\n${block}` : block;
}

// Payment type and delivery/dispatch status have no backend column yet — persisted
// client-side in localStorage, keyed by order id, same pattern as Products/Sales reps.
const ORDER_META_PREFIX = 'fs-order-meta:';
type OrderMeta = { paymentType: string; dispatchStatus: string };
const blankOrderMeta: OrderMeta = { paymentType: 'credit', dispatchStatus: 'pending' };
const dispatchLabels: Record<string, string> = { pending: 'Pending dispatch', packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered' };
function loadOrderMeta(orderId: string): OrderMeta {
  try {
    const raw = window.localStorage.getItem(`${ORDER_META_PREFIX}${orderId}`);
    return raw ? { ...blankOrderMeta, ...JSON.parse(raw) } : blankOrderMeta;
  } catch { return blankOrderMeta; }
}
function saveOrderMeta(orderId: string, meta: OrderMeta) {
  try { window.localStorage.setItem(`${ORDER_META_PREFIX}${orderId}`, JSON.stringify(meta)); } catch { /* best-effort */ }
}

export function OrdersPage() {
  const { clientMatchesActiveIndustry, activeIndustry } = useIndustryScope();

  const [items, setItems] = useState<Order[]>([]);
  const [collected, setCollected] = useState<Record<string, number>>({});
  const [visitMap, setVisitMap] = useState<Map<string, VisitRef>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Accepted-but-not-yet-converted quotations power "Ready for Sales Order".
  const [readyQuotations, setReadyQuotations] = useState<ReadyQuotation[]>([]);
  const [convertedQuotationIds, setConvertedQuotationIds] = useState<Set<string>>(new Set());
  const [requirementMap, setRequirementMap] = useState<Map<string, RequirementRef>>(new Map());

  // Review-before-confirm step for automatic conversion.
  const [reviewQuotation, setReviewQuotation] = useState<ReadyQuotation | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{ orderNumber: string; clientName: string; total: number; quotationNumber: string } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [status, setStatus] = useState('');

  const [paymentFilter, setPaymentFilter] = useState('');
  const [dispatchFilter, setDispatchFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [selected, setSelected] = useState<Order | null>(null);
  const [orderMeta, setOrderMeta] = useState<OrderMeta>(blankOrderMeta);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);

  // Add Order — direct entry, no active field visit required. Client and
  // product lines are picked here; the total updates automatically as
  // quantity/discount/free-qty change, same math as the visit order form.
  const [addOpen, setAddOpen] = useState(false);
  const [addOptionsLoading, setAddOptionsLoading] = useState(false);
  const [addClients, setAddClients] = useState<AddClient[]>([]);
  const [addProducts, setAddProducts] = useState<AddProduct[]>([]);
  const [addClientId, setAddClientId] = useState('');
  const [addClientMode, setAddClientMode] = useState<'existing' | 'outside'>('existing');
  const [addClientName, setAddClientName] = useState('');
  const [addLines, setAddLines] = useState<AddOrderLine[]>([emptyAddLine]);
  const [addNotes, setAddNotes] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [ordersRes, collectionsRes, visitsRes, quotationsRes, requirementsRes] = await Promise.all([
        api<{ data: Order[] }>('/orders'),
        api<{ data: CollectionRecord[] }>('/collections').catch(() => ({ data: [] })),
        api<{ data: VisitRef[] }>('/field-visits').catch(() => ({ data: [] })),
        api<{ data: ReadyQuotation[] }>('/quotations').catch(() => ({ data: [] })),
        api<{ data: RequirementRef[] }>('/requirements').catch(() => ({ data: [] })),
      ]);
      setItems(ordersRes.data ?? []);
      const byOrder: Record<string, number> = {};
      for (const c of collectionsRes.data ?? []) {
        const key = c.sale_orders?.order_number;
        if (!key) continue;
        byOrder[key] = (byOrder[key] ?? 0) + Number(c.amount || 0);
      }
      setCollected(byOrder);
      setVisitMap(new Map((visitsRes.data ?? []).map((v) => [v.id, v])));

      const allQuotations = quotationsRes.data ?? [];
      setReadyQuotations(allQuotations.filter((q) => q.status === 'accepted'));
      // Newer records are marked converted; older records retain "accepted"
      // but have a converted_order_id. Honour both shapes so no created order
      // is ever offered for creation again.
      setConvertedQuotationIds(new Set(
        allQuotations
          .filter((q) => q.status === 'converted' || q.converted_order_id)
          .map((q) => q.id),
      ));
      setRequirementMap(new Map((requirementsRes.data ?? []).map((r) => [r.id, r])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load orders.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  function paymentStatus(order: Order): { label: string; tone: 'good' | 'warn' | 'bad' } {
    const paid = collected[order.order_number] ?? 0;
    if (paid <= 0) return { label: 'Outstanding — payment reminder due', tone: 'bad' };
    if (paid < Number(order.total_amount)) return { label: `Partially paid (${currency(paid)} of ${currency(order.total_amount)})`, tone: 'warn' };
    return { label: 'Paid', tone: 'good' };
  }
  function paymentFilterValue(order: Order): 'paid' | 'partial' | 'outstanding' {
    const tone = paymentStatus(order).tone;
    return tone === 'good' ? 'paid' : tone === 'warn' ? 'partial' : 'outstanding';
  }

  function openOrder(order: Order) {
    setSelected(order);
    setPaymentOpen(false);
    setPaymentForm(emptyPaymentForm);
    setPaymentError(null);
    setPaymentMessage(null);
    setOrderMeta(loadOrderMeta(order.id));
  }
   function quickRecordPayment(order: Order) {
    openOrder(order);
    setPaymentOpen(true);
  }

  useEffect(() => {
    if (paymentOpen) {
      requestAnimationFrame(() => {
        document.querySelector('.master-modal.order-detail .master-form')
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [paymentOpen]);
  function updateOrderMeta(patch: Partial<OrderMeta>) {
    if (!selected) return;
    const next = { ...orderMeta, ...patch };
    setOrderMeta(next);
    saveOrderMeta(selected.id, next);
  }
  function closeOrder() {
    setSelected(null);
    setPaymentOpen(false);
  }
  async function handleAddOrder() {
    setAddError(null);
    setAddSuccess(null);
       setAddClientId('');
    setAddClientMode('existing');
    setAddClientName('');
    setAddLines([emptyAddLine]);
    setAddNotes('');
    setAddOpen(true);
    setAddOptionsLoading(true);
    try {
      const [clientsRes, productsRes] = await Promise.all([
        api<{ data: AddClient[] }>('/clients'),
        api<{ data: AddProduct[] }>('/products'),
      ]);
      setAddClients((clientsRes.data ?? []).filter((c) => clientMatchesActiveIndustry(c.client_code)));
      setAddProducts(productsRes.data ?? []);
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : 'Unable to load clients and products.');
    } finally {
      setAddOptionsLoading(false);
    }
  }
  function closeAddOrder(force = false) {
    if (addSaving && !force) return;
    setAddOpen(false);
  }
  function updateAddLine(index: number, patch: Partial<AddOrderLine>) {
    setAddLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }
  function addLineTotal(line: AddOrderLine): number {
    const product = addProducts.find((p) => p.id === line.productId);
    const gross = Number(product?.selling_price ?? 0) * Number(line.quantity || 0);
    return gross - (gross * Number(line.discountPercent || 0)) / 100;
  }
  const addOrderTotal = addLines.reduce((total, line) => total + addLineTotal(line), 0);

  async function submitAddOrder() {
    setAddError(null);
    if (addClientMode === 'existing' && !addClientId) return setAddError('Select a client.');
    if (addClientMode === 'outside' && !addClientName.trim()) return setAddError('Enter the client name.');
    const validLines = addLines.filter((line) => line.productId);
    if (!validLines.length) return setAddError('Add at least one product line.');
    for (const line of validLines) {
      if (!line.quantity || Number(line.quantity) <= 0) return setAddError('Each line needs a quantity greater than zero.');
    }
    setAddSaving(true);
    try {
      const notesWithFreeQty = packFreeQuantities(validLines, addProducts, addNotes.trim());
      const result = await api<{ data: { order_number: string } }>('/orders', {
        method: 'POST',
              body: JSON.stringify({
          clientId: addClientMode === 'existing' ? addClientId : null,
          clientName: addClientMode === 'outside' ? addClientName.trim() : null,
          items: validLines.map((line) => ({
            productId: line.productId,
            quantity: Number(line.quantity),
            discountPercent: Number(line.discountPercent || 0),
          })),
          notes: notesWithFreeQty || null,
        }),
      });
      setAddSuccess(`Order ${result.data.order_number} created successfully.`);
      closeAddOrder(true);
      await load();
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : 'Unable to create this order.');
    } finally {
      setAddSaving(false);
    }
  }
  function clearFilters() {
    setSearch(''); setClientFilter(''); setRepFilter(''); setStatus('');
    setPaymentFilter(''); setDateFrom(''); setDateTo('');
  }

  function quotationLineTotal(q: ReadyQuotation): number {
    return (q.quotation_items ?? []).reduce((sum, line) => sum + Number(line.subtotal || 0), 0);
  }
  function openReview(quotation: ReadyQuotation) {
    setConvertError(null);
    setReviewQuotation(quotation);
  }
  function closeReview() {
    if (converting) return;
    setReviewQuotation(null);
    setConvertError(null);
  }
  async function confirmConvert(quotation: ReadyQuotation) {
    setConverting(true);
    setConvertError(null);
    try {
      const result = await api<{ data: { order_number: string } }>(`/quotations/${quotation.id}/convert`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setJustCreated({
        orderNumber: result.data.order_number,
        clientName: quotation.clients?.client_name ?? 'Client',
        total: Number(quotation.total_amount || 0),
        quotationNumber: quotation.quotation_number,
      });
      setReviewQuotation(null);
      await load();
    } catch (caught) {
      setConvertError(caught instanceof Error ? caught.message : 'Unable to create this sales order.');
    } finally {
      setConverting(false);
    }
  }

  async function submitPayment(order: Order) {
    setPaymentError(null);
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) return setPaymentError('Enter an amount greater than zero.');
    const alreadyPaid = collected[order.order_number] ?? 0;
    const balance = Number(order.total_amount) - alreadyPaid;
    if (amount > balance + 0.01) return setPaymentError(`Amount exceeds the outstanding balance of ${currency(balance)}.`);
    setPaymentSaving(true);
    try {
      await api('/collections', {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.id,
          amount,
          mode: paymentForm.mode,
          referenceNo: paymentForm.referenceNo.trim() || null,
          notes: paymentForm.notes.trim() || null,
        }),
      });
      setPaymentMessage('Payment recorded and applied to this order.');
      setPaymentOpen(false);
      setPaymentForm(emptyPaymentForm);
      await load();
    } catch (caught) {
      setPaymentError(caught instanceof Error ? caught.message : 'Unable to record this payment.');
    } finally {
      setPaymentSaving(false);
    }
  }

  const scopedItems = useMemo(
    () => items.filter((order) => clientMatchesActiveIndustry(order.clients?.client_code)),
    [items, clientMatchesActiveIndustry],
  );

  const clientOptions = useMemo(
    () => [...new Set(scopedItems.map((o) => o.clients?.client_name).filter(Boolean))] as string[],
    [scopedItems],
  );
  const repOptions = useMemo(
    () => [...new Set(scopedItems.map((o) => o.sales_representatives?.user_profiles?.display_name ?? o.sales_representatives?.employee_code).filter(Boolean))] as string[],
    [scopedItems],
  );

  const shown = useMemo(() => scopedItems.filter((order) => {
    const repLabel = order.sales_representatives?.user_profiles?.display_name ?? order.sales_representatives?.employee_code ?? '';
    const text = `${order.order_number} ${order.clients?.client_name ?? ''} ${repLabel}`.toLowerCase();
    const created = dateOnly(order.created_at);
    return (
      (!search || text.includes(search.toLowerCase())) &&
      (!clientFilter || order.clients?.client_name === clientFilter) &&
      (!repFilter || repLabel === repFilter) &&
         (!status || order.status === status) &&
      (!paymentFilter || paymentFilterValue(order) === paymentFilter) &&
      (!dateFrom || created >= dateFrom) &&
      (!dateTo || created <= dateTo)
    );
    }), [scopedItems, search, clientFilter, repFilter, status, paymentFilter, dateFrom, dateTo, collected]);

  const filtersActive = !!(search || clientFilter || repFilter || status || paymentFilter || dateFrom || dateTo);

  const scopedReadyQuotations = useMemo(
    () => readyQuotations.filter((q) => clientMatchesActiveIndustry(q.clients?.client_code) && !q.converted_order_id && !convertedQuotationIds.has(q.id)),
    [readyQuotations, clientMatchesActiveIndustry, convertedQuotationIds],
  );

  // KPI cards reflect the full industry-scoped ledger, independent of the table's own filters.
  const totalOrders = scopedItems.length;
  const pendingCount = scopedItems.filter((o) => o.status === 'pending').length;
  const confirmedCount = scopedItems.filter((o) => o.status === 'confirmed').length;
  const completedCount = scopedItems.filter((o) => o.status === 'completed').length;
  const cancelledCount = scopedItems.filter((o) => o.status === 'cancelled').length;
  const totalSalesValue = useMemo(
    () => scopedItems.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + Number(o.total_amount || 0), 0),
    [scopedItems],
  );

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">SALES LEDGER</p>
          <h2>Sales Orders</h2>
          <p>Track customer orders, payments and fulfilment.</p>
        </div>
        <button className="quiet-button" type="button" onClick={() => void handleAddOrder()}>+ Create Manual Order</button>
        </div>

      {addSuccess && <p className="success-message">{addSuccess}</p>}
      {justCreated && (
        <div className="success-message order-created-banner">
          <div>
            Sales Order <strong>{justCreated.orderNumber}</strong> created successfully from Quotation <strong>{justCreated.quotationNumber}</strong>.
            <div className="order-created-summary">
              <span>Client <strong>{justCreated.clientName}</strong></span>
              <span>Total <strong>{currency(justCreated.total)}</strong></span>
              <span>Status <strong>Confirmed</strong></span>
              <span>Source <strong>Quotation</strong></span>
            </div>
          </div>
          <button type="button" className="icon-action" aria-label="Dismiss" onClick={() => setJustCreated(null)}>×</button>
        </div>
      )}
      <div className="kpi-grid order-kpi-grid order-kpi-grid-6">
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon">▤</div><div><span>Total Orders</span><strong>{totalOrders}</strong></div></div>
        <div className="kpi-card" data-tone="amber"><div className="kpi-icon">◔</div><div><span>Pending</span><strong>{pendingCount}</strong></div></div>
        <div className="kpi-card" data-tone="blue"><div className="kpi-icon">●</div><div><span>Confirmed</span><strong>{confirmedCount}</strong></div></div>
        <div className="kpi-card" data-tone="green"><div className="kpi-icon">✓</div><div><span>Completed</span><strong>{completedCount}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon">⊘</div><div><span>Cancelled</span><strong>{cancelledCount}</strong></div></div>
        <div className="kpi-card" data-tone="amber"><div className="kpi-icon">₹</div><div><span>Total Sales Value</span><strong>{currency(totalSalesValue)}</strong></div></div>
      </div>  
           {scopedReadyQuotations.length > 0 && (
        <div className="ready-for-order-section">
          <div className="ready-for-order-heading">
            <h3>Ready for Sales Order</h3>
            <p>Accepted quotations eligible to become sales orders. Review and confirm — no re-entry needed.</p>
          </div>
          <div className="ready-order-grid">
            {scopedReadyQuotations.map((q) => {
              const requirement = q.requirement_id ? requirementMap.get(q.requirement_id) : undefined;
              return (
                <div className="ready-order-card" key={q.id}>
                  {requirement && (
                    <p className="ready-order-trace">Requirement #{requirement.title ?? requirement.id.slice(0, 8)} → Quotation #{q.quotation_number}</p>
                  )}
                  <div className="ready-order-card-top">
                    <strong>{q.clients?.client_name ?? 'Client'}</strong>
                    <span className="status-badge status-accepted">Accepted</span>
                  </div>
                  <p className="ready-order-quote-no">Quotation #{q.quotation_number}</p>
                  <ul className="ready-order-items">
                    {(q.quotation_items ?? []).map((line, i) => (
                      <li key={i}>{line.products?.product_name ?? line.products?.product_code ?? 'Product'} × {line.quantity}</li>
                    ))}
                    {(!q.quotation_items || q.quotation_items.length === 0) && <li className="text-faint-inline">No line items recorded.</li>}
                  </ul>
                  <div className="ready-order-value">{currency(q.total_amount)}</div>
                  <button type="button" className="primary-action" onClick={() => openReview(q)}>Create Sales Order</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="master-toolbar orders-toolbar">
        <div className="master-search">
          <input value={search} placeholder="Search order or client" onChange={(e) => setSearch(e.target.value)} />
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            <option value="">All clients</option>
            {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
            <option value="">All representatives</option>
            {repOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
            <option value="">All payment statuses</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="outstanding">Outstanding</option>
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
          <button type="button" className="link-button" disabled={!filtersActive} onClick={clearFilters}>Clear Filters</button>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}

      {loading ? (
        <p>Loading sales orders…</p>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead>
                          <tr>
                <th>Order ID</th><th>Client</th><th>Industry</th><th>Representative</th><th>Items</th>
                <th>Order Value</th><th>Payment Status</th><th>Order Status</th><th>Order Date</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {scopedItems.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <div className="empty-state empty-state-lg ready-empty-state">
                      <div className="empty-state-icon">🧾</div>
                      <h3>No sales orders yet</h3>
                      <p>Once a quotation is accepted it will appear here automatically, or create one manually.</p>
                      <button type="button" className="primary-action" onClick={() => void handleAddOrder()}>+ Create Manual Order</button>
                    </div>
                  </td>
                </tr>
              ) : (
                                 <>
                    {shown.map((order) => {
                    const ps = paymentStatus(order);
                    const itemCount = order.sale_order_items?.length ?? 0;
                    return (
                      <tr key={order.id}>
                        <td><strong>{order.order_number}</strong></td>
                        <td>{order.clients?.client_name ?? '—'}<small>{order.clients?.client_code}</small></td>
                        <td>{order.clients?.industry_types?.name ?? '—'}</td>
                        <td>{order.sales_representatives?.user_profiles?.display_name ?? order.sales_representatives?.employee_code ?? '—'}</td>
                        <td>{itemCount} {itemCount === 1 ? 'Item' : 'Items'}</td>
                        <td>{currency(order.total_amount)}</td>
                        <td><span className={`status-badge status-${ps.tone === 'good' ? 'paid' : ps.tone === 'warn' ? 'quoted' : 'overdue'}`}>{ps.tone === 'good' ? 'Paid' : ps.tone === 'warn' ? 'Partial' : 'Outstanding'}</span></td>
                        <td><span className={`status-badge status-${order.status}`}>{order.status}</span></td>
                        <td>{dateLabel(order.created_at)}</td>
                        <td className="master-actions">
                          <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label="More actions" onClick={() => openOrder(order)}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="5" cy="12" r="1.8" />
                              <circle cx="12" cy="12" r="1.8" />
                              <circle cx="19" cy="12" r="1.8" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr><td colSpan={10} className="empty-row">No orders match these filters. <button type="button" className="link-button" onClick={clearFilters}>Clear filters</button></td></tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && (() => {
        const freeQty = parseFreeQuantities(selected.notes);
        const notesText = cleanNotes(selected.notes);
        const ps = paymentStatus(selected);
        const alreadyPaid = collected[selected.order_number] ?? 0;
        const balance = Number(selected.total_amount) - alreadyPaid;
        const relatedVisit = selected.visit_id ? visitMap.get(selected.visit_id) : undefined;

        return (
          <div className="modal-backdrop" onMouseDown={closeOrder}>
<div className="master-modal detail-panel order-detail" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-heading">
                <div>
                  <p className="eyebrow">ORDER DETAILS</p>
                  <h3>{selected.order_number}</h3>
                </div>
                <button type="button" className="icon-action" aria-label="Close" onClick={closeOrder}>×</button>
              </div>

              <div className="order-source-card">
                <span className="order-source-label">Order Source</span>
                {selected.quotation_id ? (
                  <p className="order-source-trace">
                    Quotation #{selected.quotation_id.slice(0, 8)} → Sales Order #{selected.order_number}
                  </p>
                ) : (
                  <p className="order-source-trace">Manual entry — no Requirement or Quotation linked.</p>
                )}
              </div>

              <dl className="detail-dl">
                <dt>Client</dt>
                <dd>{selected.clients?.client_name ?? '—'} {selected.clients?.client_code && <span className="text-faint-inline">({selected.clients.client_code})</span>}</dd>
                <dt>Representative</dt>
                <dd>{selected.sales_representatives?.user_profiles?.display_name ?? selected.sales_representatives?.employee_code ?? '—'}</dd>
                <dt>Created</dt>
                <dd>{dateLabel(selected.created_at)}</dd>
                <dt>Order status</dt>
                <dd><span className={`status-badge status-${selected.status}`}>{selected.status}</span></dd>
                <dt>Related visit</dt>
                <dd>
                  {selected.visit_id ? (
                    relatedVisit
                      ? <>Checked in {dateLabel(relatedVisit.check_in_time)}{relatedVisit.outcome ? ` · ${relatedVisit.outcome}` : ''}</>
                      : <span className="text-faint-inline">Visit {selected.visit_id.slice(0, 8)}</span>
                  ) : <span className="text-faint-inline">Not linked</span>}
                </dd>
                {selected.quotation_id && (
                  <>
                    <dt>Related quotation</dt>
                    <dd><span className="text-faint-inline">Quotation {selected.quotation_id.slice(0, 8)}</span></dd>
                  </>
                )}
              </dl>

              <div className="data-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th><th>Quantity</th><th>Free qty</th><th>Unit price</th><th>Discount</th><th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.sale_order_items?.map((line, index) => (
                      <tr key={index}>
                        <td>{line.products?.product_name ?? line.products?.product_code ?? 'Product'}</td>
                        <td>{line.quantity}</td>
                        <td>{line.products?.product_code ? (freeQty[line.products.product_code] ?? '—') : '—'}</td>
                        <td>{currency(line.unit_price)}</td>
                        <td>{currency(line.discount_amount)}</td>
                        <td>{currency(line.subtotal)}</td>
                      </tr>
                    ))}
                    {(!selected.sale_order_items || selected.sale_order_items.length === 0) && (
                      <tr><td colSpan={6} className="empty-row">No line items recorded.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="order-total">
                Order total <strong>{currency(selected.total_amount)}</strong>
              </div>
              {activeIndustry === 'trading' && (
                <div className="modal-actions">
                  <GenerateDocumentButton
                    label="Generate Trade Document"
                    docTypes={ORDER_DOC_TYPES}
                    buildDraft={(documentType) => buildDraftFromOrder(selected, documentType)}
                  />
                </div>
              )}
              {notesText && <p>{notesText}</p>}

              <div className="master-filter-bar">
                <label>
                  Payment type
                  <select value={orderMeta.paymentType} onChange={(e) => updateOrderMeta({ paymentType: e.target.value })}>
                    <option value="credit">Credit</option>
                    <option value="advance">Advance</option>
                    <option value="cod">Cash on delivery</option>
                  </select>
                </label>
                <label>
                  Dispatch status
                  <select value={orderMeta.dispatchStatus} onChange={(e) => updateOrderMeta({ dispatchStatus: e.target.value })}>
                    {Object.entries(dispatchLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>

                         <div className="sales-summary">
                <div><span>Payment status</span><strong>{ps.label}</strong></div>
                <div><span>Collected</span><strong>{currency(alreadyPaid)}</strong></div>
                <div><span>Balance</span><strong>{currency(Math.max(balance, 0))}</strong></div>
              </div>  

              {paymentMessage && <p className="success-message">{paymentMessage}</p>}
              {paymentError && <p className="error-message">{paymentError}</p>}

              {balance > 0.01 && (
                paymentOpen ? (
                  <form className="master-form" onSubmit={(e) => { e.preventDefault(); void submitPayment(selected); }}>
                    <label>
                      Amount
                      <input type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
                    </label>
                    <label>
                      Mode
                      <select value={paymentForm.mode} onChange={(e) => setPaymentForm({ ...paymentForm, mode: e.target.value as PaymentForm['mode'] })}>
                        {paymentModes.map((mode) => <option key={mode} value={mode}>{mode.replace('_', ' ')}</option>)}
                      </select>
                    </label>
                    <label>
                      Reference no.
                      <input value={paymentForm.referenceNo} onChange={(e) => setPaymentForm({ ...paymentForm, referenceNo: e.target.value })} />
                    </label>
                    <label>
                      Notes
                      <input value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} />
                    </label>
                    <div className="modal-actions">
                      <button type="button" className="quiet-button" onClick={() => setPaymentOpen(false)} disabled={paymentSaving}>Cancel</button>
                      <button type="submit" className="primary-action" disabled={paymentSaving}>{paymentSaving ? 'Saving…' : 'Save payment'}</button>
                    </div>
                  </form>
                ) : (
                  <div className="modal-actions">
                    <button type="button" className="primary-action" onClick={() => setPaymentOpen(true)}>+ Record payment</button>
                  </div>
                )
              )}
            </div>
          </div>
        );
      })()}

      {addOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => closeAddOrder()}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="add-order-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">SALES LEDGER</p>
                <h3 id="add-order-modal-title">Add order</h3>
              </div>
              <button type="button" className="icon-action" aria-label="Close" title="Close" onClick={() => closeAddOrder()}>×</button>
            </div>

            {addOptionsLoading ? (
              <p>Loading clients and products…</p>
            ) : (
              <div className="order-builder">
                {addError && <p className="error-message">{addError}</p>}

                                              <label className="order-builder-field">
                  <span>Client</span>
                  <div className="segmented-toggle" role="group" aria-label="Client source">
                    <button
                      type="button"
                      className={addClientMode === 'existing' ? 'segmented-toggle-active' : ''}
                      onClick={() => { setAddClientMode('existing'); setAddClientName(''); }}
                    >
                      From CRM
                    </button>
                    <button
                      type="button"
                      className={addClientMode === 'outside' ? 'segmented-toggle-active' : ''}
                      onClick={() => { setAddClientMode('outside'); setAddClientId(''); }}
                    >
                      Outside client (type name)
                    </button>
                  </div>
                  {addClientMode === 'existing' ? (
                    <>
                      <select value={addClientId} onChange={(e) => setAddClientId(e.target.value)}>
                        <option value="">Select a client</option>
                        {addClients.map((c) => <option key={c.id} value={c.id}>{c.client_code} — {c.client_name}</option>)}
                      </select>
                      {!addClients.length && <small className="text-faint-inline">No clients found. Add a client first.</small>}
                    </>
                  ) : (
                    <input required value={addClientName} placeholder="Type the client's name" onChange={(e) => setAddClientName(e.target.value)} />
                  )}
                </label>
                <strong>Products</strong>
                <div className="order-line order-line-header" aria-hidden="true">
                  <span className="order-line-label">Product</span>
                  <span className="order-line-label">Qty</span>
                  <span className="order-line-label">Discount %</span>
                  <span className="order-line-label">Free qty</span>
                  <span className="order-line-label">Subtotal</span>
                </div>
                {addLines.map((line, index) => (
                  <div className="order-line" key={index}>
                    <select value={line.productId} onChange={(e) => updateAddLine(index, { productId: e.target.value })}>
                      <option value="">Select product</option>
                      {addProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.product_code} — {product.product_name} (₹{Number(product.selling_price).toFixed(2)})
                        </option>
                      ))}
                    </select>
                    <input type="number" min="0.01" step="0.01" value={line.quantity} aria-label="Quantity" placeholder="Qty" onChange={(e) => updateAddLine(index, { quantity: e.target.value })} />
                    <input type="number" min="0" max="100" step="0.01" value={line.discountPercent} aria-label="Discount percent" placeholder="Discount %" onChange={(e) => updateAddLine(index, { discountPercent: e.target.value })} />
                    <input type="number" min="0" step="1" value={line.freeQuantity} aria-label="Free quantity" placeholder="Free qty" onChange={(e) => updateAddLine(index, { freeQuantity: e.target.value })} />
                    <span>{currency(addLineTotal(line))}</span>
                    {addLines.length > 1 && (
                      <button type="button" className="text-action" onClick={() => setAddLines(addLines.filter((_, i) => i !== index))}>Remove</button>
                    )}
                  </div>
                ))}
                <button type="button" className="secondary-action" onClick={() => setAddLines([...addLines, emptyAddLine])}>+ Add product</button>

                <textarea value={addNotes} placeholder="Order notes (optional)" onChange={(e) => setAddNotes(e.target.value)} />

                <div className="order-total">
                  <strong>Order total</strong>
                  <b>{currency(addOrderTotal)}</b>
                </div>

                <div className="modal-actions">
                  <button type="button" className="quiet-button" onClick={() => closeAddOrder()} disabled={addSaving}>Cancel</button>
                  <button
                    type="button"
                    className="primary-action"
                    disabled={addSaving || (addClientMode === 'existing' ? !addClientId : !addClientName.trim()) || !addLines.some((line) => line.productId && Number(line.quantity) > 0)}
                    onClick={() => void submitAddOrder()}
                  >
                    {addSaving ? 'Saving…' : 'Create order'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {reviewQuotation && (() => {
        const q = reviewQuotation;
        const subtotal = quotationLineTotal(q);
        const requirement = q.requirement_id ? requirementMap.get(q.requirement_id) : undefined;
        return (
          <div className="modal-backdrop" role="presentation" onMouseDown={closeReview}>
            <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="review-order-modal-title" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-heading">
                <div>
                  <p className="eyebrow">AUTOMATIC SALES ORDER</p>
                  <h3 id="review-order-modal-title">Create Sales Order</h3>
                </div>
                <button type="button" className="icon-action" aria-label="Close" title="Close" onClick={closeReview}>×</button>
              </div>

              <dl className="detail-dl">
                <dt>Source</dt>
                <dd>
                  {requirement ? `Requirement #${requirement.title ?? requirement.id.slice(0, 8)} → ` : ''}
                  Quotation #{q.quotation_number}
                </dd>
                <dt>Client</dt>
                <dd>{q.clients?.client_name ?? '—'} {q.clients?.client_code && <span className="text-faint-inline">({q.clients.client_code})</span>}</dd>
                <dt>Sales Representative</dt>
                <dd>{q.sales_representatives?.user_profiles?.display_name ?? q.sales_representatives?.employee_code ?? '—'}</dd>
              </dl>

              <div className="data-table-wrap">
                <table>
                  <thead>
                    <tr><th>Product</th><th>Quantity</th><th>Unit price</th><th>Subtotal</th></tr>
                  </thead>
                  <tbody>
                    {(q.quotation_items ?? []).map((line, index) => (
                      <tr key={index}>
                        <td>{line.products?.product_name ?? line.products?.product_code ?? 'Product'}</td>
                        <td>{line.quantity}</td>
                        <td>{currency(line.unit_price)}</td>
                        <td>{currency(line.subtotal)}</td>
                      </tr>
                    ))}
                    {(!q.quotation_items || q.quotation_items.length === 0) && (
                      <tr><td colSpan={4} className="empty-row">No line items recorded.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="sales-summary">
                <div><span>Subtotal</span><strong>{currency(subtotal)}</strong></div>
                <div><span>Discount</span><strong>{currency(q.discount_amount)}</strong></div>
                <div><span>Tax</span><strong>{currency(q.tax_amount)}</strong></div>
              </div>
              <div className="order-total">
                Total <strong>{currency(q.total_amount)}</strong>
              </div>

              {q.notes && <p className="text-faint-inline">{q.notes}</p>}
              {convertError && <p className="error-message">{convertError}</p>}

              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={closeReview} disabled={converting}>Back to Edit</button>
                <button type="button" className="primary-action" disabled={converting} onClick={() => void confirmConvert(q)}>
                  {converting ? 'Creating…' : 'Confirm & Create Order'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
