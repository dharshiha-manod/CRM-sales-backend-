/* eslint-disable @typescript-eslint/no-explicit-any */
import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { useIndustry } from '../industry/IndustryContext';
import { useIndustryScope } from '../industry/useIndustryScope';

// School purchase orders.
// - Product dropdown lists every product of this industry from the Product module with its details (code, name, HSN,
//   purchase price, GST, stock, last price paid to the chosen supplier). Click to open, type to search, arrows + Enter.
// - Picking a product fills rate, GST and quantity; the cursor jumps to Qty and a fresh row appears.
// - "Auto-suggest" fills the order from live School orders not yet dispatched + minimum stock - shelf stock - open POs.
// - "Add all items of this supplier" uses the supplier name saved on each product.
// - Marking a PO as Sent e-mails it to the supplier automatically. The list shows the supplier's reply live:
//   Emailed -> Opened -> Confirmed / Declined (the page refreshes itself every 45 seconds).
// Backed by /school/purchase-orders and /school/purchase-suggestions (see school-distributor.routes.ts).

type Row = Record<string, any>;
type Product = {
  id: string; product_code: string; product_name: string; unit?: string | null; category?: string | null; hsn_code?: string | null; specification?: string | null;
  supplier_name?: string | null; tax_percent?: number | null; cost_price?: number | null; stock_quantity?: number | null; min_stock_level?: number | null;
};
type Suggestion = { product_id: string; stock: number | null; min_stock_level: number | null; pending_orders: number; on_order: number; suggested: number };
type Line = { product_id: string; quantity: string; rate: string; gst_percent: string; why?: string };
type MailInfo = { emailed: boolean; to: string | null; reason: string | null };

const STATUSES = ['All', 'Draft', 'Sent', 'Partially received', 'Received', 'Cancelled'];
const OPEN = ['Sent', 'Partially received'];
const EMPTY_LINE: Line = { product_id: '', quantity: '', rate: '', gst_percent: '' };

const money = (v: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v ?? 0));
const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const messageOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const isoToday = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
const label = (p: Product) => `${p.product_code} — ${p.product_name}`;
const lineAmount = (l: Line) => r2(num(l.quantity) * num(l.rate) * (1 + num(l.gst_percent) / 100));
const post = <T,>(path: string, payload: unknown, method = 'POST') => api<{ data: T }>(path, { method, body: JSON.stringify(payload) });
const sameName = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const at = (v: unknown) => (v ? new Date(String(v)).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** What the supplier has done with the e-mailed order, worked out from the PO row. */
function supplierState(po: Row): { text: string; bg: string; fg: string; title: string } | null {
  if (po.supplier_response === 'Confirmed') return { text: 'Confirmed', bg: '#ecfdf3', fg: '#067647', title: `Confirmed ${at(po.responded_at)}${po.supplier_delivery_date ? ` · delivery ${po.supplier_delivery_date}` : ''}${po.supplier_note ? ` · ${po.supplier_note}` : ''}` };
  if (po.supplier_response === 'Declined') return { text: 'Declined', bg: '#fef3f2', fg: '#b42318', title: `Declined ${at(po.responded_at)}${po.supplier_note ? ` · ${po.supplier_note}` : ''}` };
  if (po.viewed_at) return { text: 'Opened', bg: '#eff8ff', fg: '#175cd3', title: `Opened ${at(po.viewed_at)} · ${po.view_count} time(s)` };
  if (po.mail_status === 'Emailed') return { text: 'Emailed', bg: '#fffaeb', fg: '#b54708', title: `E-mailed to ${po.supplier_email} on ${at(po.mailed_at)}` };
  if (po.mail_status === 'Failed') return { text: 'E-mail failed', bg: '#fef3f2', fg: '#b42318', title: po.mail_error ?? 'E-mail failed' };
  if (OPEN.includes(po.status)) return { text: 'Not e-mailed', bg: '#f2f4f7', fg: '#475467', title: 'This order has not been e-mailed to the supplier yet.' };
  return null;
}
const mailNote = (info?: MailInfo | null) => (info?.emailed ? ` and e-mailed to ${info.to}` : '');

function useRows<T = Row>(path: string) {
  const { activeIndustryTypeId } = useIndustryScope();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!activeIndustryTypeId) return;
    setLoading(true); setError('');
    try { const res = await api<{ data: T[] }>(`${path}${path.includes('?') ? '&' : '?'}industryTypeId=${activeIndustryTypeId}`); setRows(res.data ?? []); }
    catch (e) { setError(messageOf(e, 'Unable to load.')); } finally { setLoading(false); }
  }, [path, activeIndustryTypeId]);
  useEffect(() => { void reload(); }, [reload]);
  return { rows, loading, error, reload, industryId: activeIndustryTypeId };
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop modal-backdrop--center" role="dialog" aria-modal="true">
      <div className={`master-modal master-modal--center${wide ? ' master-modal--wide' : ''}`} style={{ width: wide ? undefined : 'min(900px, 96vw)', maxWidth: '96vw', maxHeight: '94vh', overflowY: 'auto' }}>
        <div className="modal-heading"><h3>{title}</h3><button type="button" className="quiet-button" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

const card: CSSProperties = { flex: '1 1 190px', border: '1px solid #e5e2da', borderRadius: 12, padding: '12px 16px', background: '#fff' };
const cardLabel: CSSProperties = { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: '#6b675d', margin: 0 };
const cardValue: CSSProperties = { fontSize: 22, fontWeight: 700, margin: '4px 0 0' };
const chip = (active: boolean): CSSProperties => ({ border: '1px solid ' + (active ? '#111827' : '#d9d5ca'), background: active ? '#111827' : '#fff', color: active ? '#fff' : '#111827', borderRadius: 999, padding: '5px 12px', fontSize: 13, cursor: 'pointer' });
const hint: CSSProperties = { fontSize: 12, color: '#6b675d' };
const GRID = '128px minmax(180px, 1fr) 86px 96px 56px 84px 96px';

// ------------------------------------------------------------------------------------------ product dropdown
function ProductCombobox({ products, value, onPick, supplierId, supplierName, lastPaid }: {
  products: Product[]; value: string; onPick: (id: string) => void; supplierId: string; supplierName: string; lastPaid: Map<string, { rate: number; gst: number }>;
}) {
  const selected = products.find((p) => p.id === value);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ left: 0, top: 0, up: false });
  const q = query.trim().toLowerCase();

  const list = useMemo(() => {
    const rank = (p: Product) => (sameName(p.supplier_name, supplierName) ? 0 : 1);
    return products
      .filter((p) => !q || `${p.product_code} ${p.product_name} ${p.category ?? ''} ${p.hsn_code ?? ''} ${p.specification ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.product_name.localeCompare(b.product_name))
      .slice(0, 80);
  }, [products, q, supplierName]);

  function show() {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) { const up = r.bottom + 360 > window.innerHeight && r.top > 360; setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 780)), top: up ? r.top - 4 : r.bottom + 4, up }); }
    setOpen(true); setActive(0);
  }
  function choose(p: Product) { onPick(p.id); setOpen(false); setQuery(''); }

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return; setOpen(false); };
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);
  useEffect(() => { if (open) panelRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, open]);

  return (
    <>
      <input ref={inputRef} style={{ width: '100%', minWidth: 260 }} autoComplete="off" placeholder="Click to choose, or type code / name…"
        value={open ? query : selected ? label(selected) : ''}
        onFocus={show}
        onChange={(e) => { setQuery(e.target.value); if (!open) show(); setActive(0); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 160)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); else setActive((a) => Math.min(a + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (open && list[active]) choose(list[active]); }
          else if (e.key === 'Escape') { setOpen(false); }
        }} />
      {open && createPortal(
        <div ref={panelRef} style={{ position: 'fixed', left: pos.left, top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, width: 760, maxWidth: '96vw', maxHeight: 340, overflowY: 'auto', zIndex: 100000, background: '#fff', border: '1px solid #d9d5ca', borderRadius: 10, boxShadow: '0 18px 48px rgba(16,21,31,.22)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '8px 12px', position: 'sticky', top: 0, background: '#f6f4ee', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: '#6b675d' }}>
            <span>Code</span><span>Product</span><span>HSN</span><span style={{ textAlign: 'right' }}>Buy price</span><span style={{ textAlign: 'right' }}>GST</span><span style={{ textAlign: 'right' }}>Stock</span><span style={{ textAlign: 'right' }}>Last paid</span>
          </div>
          {list.length === 0 && <div style={{ padding: 14, color: '#6b675d' }}>No product matches “{query}”. Add it in Products first.</div>}
          {list.map((p, i) => {
            const stock = p.stock_quantity; const low = stock != null && (stock <= 0 || (p.min_stock_level != null && stock <= p.min_stock_level));
            const last = lastPaid.get(`${supplierId}|${p.id}`);
            return (
              <div key={p.id} data-active={i === active} onMouseDown={(e) => { e.preventDefault(); choose(p); }} onMouseEnter={() => setActive(i)}
                style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '8px 12px', cursor: 'pointer', background: i === active ? '#eef3ff' : undefined, borderTop: '1px solid #f0ede5', fontSize: 13, alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{p.product_code}</span>
                <span style={{ minWidth: 0 }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.product_name}</div>
                  <div style={{ ...hint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[p.category, p.specification, sameName(p.supplier_name, supplierName) ? '★ this supplier' : p.supplier_name].filter(Boolean).join(' · ')}</div>
                </span>
                <span>{p.hsn_code ?? '—'}</span>
                <span style={{ textAlign: 'right' }}>{p.cost_price != null ? money(p.cost_price) : '—'}</span>
                <span style={{ textAlign: 'right' }}>{p.tax_percent != null ? `${p.tax_percent}%` : '—'}</span>
                <span style={{ textAlign: 'right', color: low ? '#b42318' : undefined, fontWeight: low ? 700 : undefined }}>{stock != null ? `${stock}${p.unit ? ` ${p.unit}` : ''}` : 'n/t'}</span>
                <span style={{ textAlign: 'right', color: '#1f7a4d' }}>{last ? money(last.rate) : '—'}</span>
              </div>
            );
          })}
        </div>, document.body)}
    </>
  );
}

// ------------------------------------------------------------------------------------------ print
function printPo(po: Row, company: Row | null) {
  const co = company ?? {}; const s = po.school_suppliers ?? {};
  const rows = (po.lines as Row[]).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.product_code)} — ${esc(l.product_name)}</td><td>${esc(l.hsn_code)}</td><td class="r">${l.quantity}</td><td class="r">${num(l.rate).toFixed(2)}</td><td class="r">${l.gst_percent}%</td><td class="r">${num(l.amount).toFixed(2)}</td></tr>`).join('');
  const w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<!doctype html><title>${esc(po.po_number)}</title><style>body{font:13px Arial;margin:28px;color:#111}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:6px}th{background:#f1f1f1}.r{text-align:right}h2{margin:0}.cols{display:flex;justify-content:space-between;gap:24px;margin:10px 0}</style>
<h2>${esc(co.company_name)}</h2><div>${esc(co.address)} ${esc(co.city)} ${esc(co.state)} ${esc(co.pincode)}<br>GSTIN: ${esc(co.gstin)} · ${esc(co.phone)} · ${esc(co.email)}</div><hr>
<h3>PURCHASE ORDER ${esc(po.po_number)}</h3>
<div class="cols"><div><b>To:</b><br>${esc(s.supplier_name)}<br>${esc(s.address)} ${esc(s.city)} ${esc(s.state)}<br>GSTIN: ${esc(s.gstin)}<br>${esc(s.phone)} ${esc(s.email)}</div><div><b>Date:</b> ${esc(po.order_date)}<br><b>Expected by:</b> ${esc(po.expected_date || '—')}<br><b>Status:</b> ${esc(po.status)}</div></div>
<table><tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>GST</th><th>Amount</th></tr>${rows}</table><br>
<table style="width:40%;margin-left:auto"><tr><td>Sub-total</td><td class="r">${num(po.subtotal).toFixed(2)}</td></tr><tr><td>GST</td><td class="r">${num(po.tax_amount).toFixed(2)}</td></tr><tr><td><b>Total</b></td><td class="r"><b>${num(po.total_amount).toFixed(2)}</b></td></tr></table>
${po.notes ? `<p><b>Notes:</b> ${esc(po.notes)}</p>` : ''}<p><small>${esc(co.terms)}</small></p><br><br><div style="text-align:right">Authorised signatory</div><script>window.print()</script>`);
  w.document.close();
}

// ------------------------------------------------------------------------------------------ page
export function SchoolPurchaseOrdersPage() {
  const { config } = useIndustry();
  const { rows, loading, error, reload, industryId } = useRows('/school/purchase-orders');
  const suppliers = useRows('/school/suppliers');
  const [products, setProducts] = useState<Product[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [company, setCompany] = useState<Row | null>(null);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pageError, setPageError] = useState('');
  const [autoBusy, setAutoBusy] = useState(false);
  const [unassigned, setUnassigned] = useState<Row[]>([]);
  const [view, setView] = useState<Row | null>(null);

  useEffect(() => {
    if (!industryId) return;
    api<{ data: Product[] }>(`/products?status=active&industryTypeId=${industryId}`).then((r) => setProducts(r.data ?? [])).catch(() => setProducts([]));
    api<{ data: Row | null }>(`/school/company-profile?industryTypeId=${industryId}`).then((r) => setCompany(r.data)).catch(() => setCompany(null));
  }, [industryId]);

  // Supplier replies arrive by themselves: refresh the list every 45 seconds, and keep an open "View" window current.
  useEffect(() => { const t = window.setInterval(() => { void reload(); }, 45000); return () => window.clearInterval(t); }, [reload]);
  useEffect(() => { if (view) { const fresh = rows.find((r) => r.id === view.id); if (fresh && fresh !== view) setView(fresh); } }, [rows, view]);

  const activeSuppliers = useMemo(() => suppliers.rows.filter((s) => s.status === 'Active'), [suppliers.rows]);
  const supplier = activeSuppliers.find((s) => s.id === form.supplier_id);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const suggestionById = useMemo(() => new Map(suggestions.map((s) => [s.product_id, s])), [suggestions]);
  const supplierProducts = useMemo(() => (supplier ? products.filter((p) => sameName(p.supplier_name, supplier.supplier_name)) : []), [products, supplier]);

  // Last rate / GST paid to each supplier for each product (rows come newest first).
  const lastPaid = useMemo(() => {
    const m = new Map<string, { rate: number; gst: number }>();
    for (const po of rows) for (const l of (po.lines ?? []) as Row[]) { const k = `${po.supplier_id}|${l.product_id}`; if (!m.has(k) && po.status !== 'Cancelled') m.set(k, { rate: num(l.rate), gst: num(l.gst_percent) }); }
    return m;
  }, [rows]);

  const priced = useCallback((supplierId: string, p: Product, current?: Partial<Line>, qty?: number): Line => {
    const last = lastPaid.get(`${supplierId}|${p.id}`);
    return {
      product_id: p.id,
      quantity: qty ? String(qty) : current?.quantity || '1',
      rate: last ? String(last.rate) : p.cost_price != null ? String(p.cost_price) : current?.rate ?? '',
      gst_percent: last ? String(last.gst) : p.tax_percent != null ? String(p.tax_percent) : current?.gst_percent ?? '',
    };
  }, [lastPaid]);

  const validLines = lines.filter((l) => l.product_id && num(l.quantity) > 0);
  const sub = r2(validLines.reduce((s, l) => s + num(l.quantity) * num(l.rate), 0));
  const total = r2(validLines.reduce((s, l) => s + lineAmount(l), 0));
  const withTrailingBlank = (ls: Line[]) => (ls.length && !ls[ls.length - 1].product_id ? ls : [...ls, { ...EMPTY_LINE }]);

  function openNew(seed?: { supplier_id: string; lines: Line[] }) {
    const today = isoToday();
    setForm({ supplier_id: seed?.supplier_id ?? '', order_date: today, expected_date: addDays(today, 7), notes: '' });
    setLines(withTrailingBlank(seed?.lines ?? []));
    setFormError(''); setOpen(true);
    if (industryId) api<{ data: { items: Suggestion[] } }>(`/school/purchase-suggestions?industryTypeId=${industryId}`).then((r) => setSuggestions(r.data?.items ?? [])).catch(() => setSuggestions([]));
  }
  function repeat(po: Row) {
    openNew({ supplier_id: po.supplier_id, lines: (po.lines as Row[]).map((l) => ({ product_id: l.product_id, quantity: String(l.quantity), rate: String(l.rate), gst_percent: String(l.gst_percent) })) });
  }
  function changeSupplier(id: string) {
    setForm((f) => ({ ...f, supplier_id: id }));
    setLines((ls) => ls.map((l) => { const p = productById.get(l.product_id); return p ? { ...priced(id, p, l), why: l.why } : l; }));
  }
  function setLine(i: number, patch: Partial<Line>) { setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l))); }
  function pick(i: number, id: string) {
    const p = productById.get(id);
    if (!p) return;
    if (lines.some((l, k) => k !== i && l.product_id === id)) { setFormError(`${p.product_name} is already on this order. Change its quantity instead.`); return; }
    setFormError('');
    const sg = suggestionById.get(id);
    setLines((ls) => withTrailingBlank(ls.map((l, k) => (k === i ? { ...priced(form.supplier_id, p, l, sg?.suggested), why: sg ? whyText(sg) : undefined } : l))));
    window.setTimeout(() => document.getElementById(`po-qty-${i}`)?.focus(), 30);
  }
  const whyText = (s: Suggestion) => `Orders need ${s.pending_orders} · stock ${s.stock ?? '—'} · on order ${s.on_order}${s.min_stock_level != null ? ` · min ${s.min_stock_level}` : ''}`;
  function addMany(items: { product: Product; qty?: number; why?: string }[]) {
    const have = new Set(lines.map((l) => l.product_id));
    const add = items.filter((x) => !have.has(x.product.id)).map((x) => ({ ...priced(form.supplier_id, x.product, undefined, x.qty), why: x.why }));
    if (!add.length) { setFormError('Everything is already on this order.'); return; }
    setFormError('');
    setLines((ls) => withTrailingBlank([...ls.filter((l) => l.product_id), ...add]));
  }
  function autoSuggest() {
    const items = suggestions.map((s) => ({ product: productById.get(s.product_id), qty: s.suggested, why: whyText(s) })).filter((x): x is { product: Product; qty: number; why: string } => !!x.product);
    if (!items.length) { setFormError('Nothing to suggest: no pending orders need stock and no product is below its minimum level.'); return; }
    addMany(items);
  }

  async function submit(send: boolean) {
    setFormError('');
    if (!form.supplier_id) return setFormError('Select a supplier.');
    if (!validLines.length) return setFormError('Add at least one product with a quantity.');
    setBusy(true);
    try {
      const payload = validLines.map(({ product_id, quantity, rate, gst_percent }) => ({ product_id, quantity, rate, gst_percent }));
      const res = await post<Row>('/school/purchase-orders', { industryTypeId: industryId, ...form, lines: payload });
      let info: MailInfo | null = null;
      if (send) { const r = await api<{ email?: MailInfo | null }>(`/school/purchase-orders/${res.data.id}?industryTypeId=${industryId}`, { method: 'PATCH', body: JSON.stringify({ status: 'Sent' }) }); info = r.email ?? null; }
      setOpen(false); await reload();
      if (send && info && !info.emailed) setPageError(`${res.data.po_number} is marked Sent, but the e-mail was not sent: ${info.reason}`);
      else setMessage(`Purchase order ${res.data.po_number} ${send ? `created, marked Sent${mailNote(info)}` : 'saved as Draft'}.`);
    } catch (err) { setFormError(messageOf(err, 'Unable to create.')); } finally { setBusy(false); }
  }
  // One click: a Draft PO per supplier from pending orders + low stock (supplier and rate come from the last purchase of each product).
  async function autoDraft() {
    setPageError(''); setMessage(''); setUnassigned([]); setAutoBusy(true);
    try {
      const r = await api<{ data: { created: Row[]; unassigned: Row[]; failed: Row[] } }>(`/school/purchase-orders/auto-draft?industryTypeId=${industryId}`, { method: 'POST', body: JSON.stringify({ industryTypeId: industryId }) });
      const d = r.data;
      setMessage(d.created.length ? `${d.created.length} draft order(s) created: ${d.created.map((c) => `${c.po_number} (${c.supplier_name}, ${c.lines} item(s))`).join('; ')}. Check them, then mark Sent.` : 'Nothing to order right now.');
      setUnassigned(d.unassigned);
      if (d.failed.length) setPageError(d.failed.map((f) => `${f.supplier_name}: ${f.reason}`).join(' | '));
      await reload();
    } catch (err) { setPageError(err instanceof Error ? err.message : 'Unable to create the draft orders.'); } finally { setAutoBusy(false); }
  }
  async function setStatus(po: Row, status: string) {
    setPageError(''); setMessage('');
       try {
      const r = await api<{ email?: MailInfo | null }>(`/school/purchase-orders/${po.id}?industryTypeId=${industryId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await reload(); setView(null);
      if (status === 'Sent') { if (r.email && !r.email.emailed && r.email.reason !== 'Already e-mailed') setPageError(`${po.po_number} is marked Sent, but the e-mail was not sent: ${r.email.reason}`); else setMessage(`${po.po_number} marked Sent${mailNote(r.email)}.`); }
    } catch (err) { setPageError(messageOf(err, 'Unable to update.')); }
  }
  async function resend(po: Row) {
    setPageError(''); setMessage('');
    try {
      const r = await post<MailInfo>(`/school/purchase-orders/${po.id}/send?industryTypeId=${industryId}`, {});
      await reload();
      if (r.data.emailed) setMessage(`${po.po_number} e-mailed to ${r.data.to}.`); else setPageError(`E-mail not sent: ${r.data.reason}`);
    } catch (err) { setPageError(messageOf(err, 'Unable to send.')); }
  }

  const today = isoToday();
  const isOverdue = (po: Row) => OPEN.includes(po.status) && po.expected_date && po.expected_date < today;
  const monthKey = today.slice(0, 7);
  const stats = {
    open: rows.filter((p) => OPEN.includes(p.status)).length,
    pending: r2(rows.filter((p) => OPEN.includes(p.status)).reduce((s, p) => s + num(p.total_amount), 0)),
    overdue: rows.filter(isOverdue).length,
    awaiting: rows.filter((p) => OPEN.includes(p.status) && !p.supplier_response).length,
    month: r2(rows.filter((p) => p.status !== 'Cancelled' && String(p.order_date).startsWith(monthKey)).reduce((s, p) => s + num(p.total_amount), 0)),
  };
  const shown = rows.filter((p) => (filter === 'All' || p.status === filter) && (!search.trim() || `${p.po_number} ${p.school_suppliers?.supplier_name ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
  const progress = (po: Row) => { const o = (po.lines as Row[]).reduce((s, l) => s + num(l.quantity), 0); const g = (po.lines as Row[]).reduce((s, l) => s + num(l.received_quantity), 0); return { o, g, pct: o ? Math.min(100, Math.round((g / o) * 100)) : 0 }; };

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div><p className="eyebrow">{config.label.toUpperCase()} · PURCHASE ORDERS</p><h2>Purchase orders</h2><p>Orders placed with publishers and suppliers. Goods that arrive are booked through Goods Receipt (GRN).</p></div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '8px 0 14px' }}>
        <div style={card}><p style={cardLabel}>Open orders</p><p style={cardValue}>{stats.open}</p></div>
        <div style={card}><p style={cardLabel}>Value awaiting delivery</p><p style={cardValue}>{money(stats.pending)}</p></div>
        <div style={card}><p style={cardLabel}>Awaiting supplier reply</p><p style={cardValue}>{stats.awaiting}</p></div>
        <div style={card}><p style={cardLabel}>Overdue delivery</p><p style={{ ...cardValue, color: stats.overdue ? '#b42318' : undefined }}>{stats.overdue}</p></div>
        <div style={card}><p style={cardLabel}>Purchased this month</p><p style={cardValue}>{money(stats.month)}</p></div>
      </div>

      <div className="master-toolbar" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="primary-action" onClick={() => openNew()}>+ New purchase order</button>
        <button type="button" className="quiet-button" disabled={autoBusy || !industryId} onClick={() => void autoDraft()}>{autoBusy ? 'Drafting…' : '⚡ Draft orders from pending orders & low stock'}</button>
        <input placeholder="Search PO number or supplier" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 240 }} />
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{STATUSES.map((s) => <button key={s} type="button" style={chip(filter === s)} onClick={() => setFilter(s)}>{s}</button>)}</span>
      </div>
      {(error || pageError) && <p className="error-message">{error || pageError}</p>}
      {message && <p className="success-message">{message}</p>}
      {unassigned.length > 0 && <p className="error-message">No supplier known yet for: {unassigned.map((u) => `${u.product_code} ${u.product_name} (${u.suggested})`).join(', ')}. Place these with + New purchase order.</p>}
      {!activeSuppliers.length && !suppliers.loading && <p className="error-message">Add a supplier first (Suppliers / Publishers), then create purchase orders.</p>}

      {shown.length === 0 ? <p className="empty-state">{loading ? 'Loading…' : 'No purchase orders match.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>PO</th><th>Date</th><th>Supplier</th><th>Expected</th><th>Total</th><th>Received</th><th>Status</th><th>Supplier reply</th><th /></tr></thead><tbody>
          {shown.map((po) => {
            const pr = progress(po);
            return (
              <tr key={po.id}>
                <td><b>{po.po_number}</b></td><td>{po.order_date}</td><td>{po.school_suppliers?.supplier_name ?? '—'}</td>
                <td style={{ color: isOverdue(po) ? '#b42318' : undefined }}>{po.expected_date ?? '—'}{isOverdue(po) ? ' · overdue' : ''}</td>
                <td>{money(po.total_amount)}</td>
                <td style={{ minWidth: 120 }}><div style={{ height: 6, background: '#ece9e1', borderRadius: 4 }}><div style={{ width: `${pr.pct}%`, height: 6, background: '#1f7a4d', borderRadius: 4 }} /></div><span style={hint}>{pr.g} / {pr.o}</span></td>
                        <td><span className="status-badge">{po.status}</span></td>
                <td>{(() => { const st = supplierState(po); return st ? <span title={st.title} style={{ background: st.bg, color: st.fg, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{st.text}</span> : '—'; })()}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="quiet-button" onClick={() => setView(po)}>View</button>{' '}
                  {OPEN.includes(po.status) && !po.supplier_response && <><button type="button" className="quiet-button" onClick={() => void resend(po)}>{po.mail_status === 'Emailed' ? 'Resend e-mail' : 'Send e-mail'}</button>{' '}</>}
                  <button type="button" className="quiet-button" onClick={() => printPo(po, company)}>Print</button>{' '}
                  <button type="button" className="quiet-button" onClick={() => repeat(po)}>Repeat</button>{' '}
                  {po.status === 'Draft' && <button type="button" className="quiet-button" onClick={() => void setStatus(po, 'Sent')}>Mark sent</button>}{' '}
                  {['Draft', 'Sent'].includes(po.status) && <button type="button" className="quiet-button" onClick={() => void setStatus(po, 'Cancelled')}>Cancel</button>}
                </td>
              </tr>
            );
          })}
        </tbody></table></div>
      )}

      {view && (
        <Modal title={`${view.po_number} · ${view.status}`} onClose={() => setView(null)}>
          <p style={hint}>Supplier: <b>{view.school_suppliers?.supplier_name}</b> · Date {view.order_date} · Expected {view.expected_date ?? '—'}{view.notes ? ` · ${view.notes}` : ''}</p>
          <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Product</th><th>Ordered</th><th>Received</th><th>Pending</th><th>Rate</th><th>GST</th><th>Amount</th></tr></thead><tbody>
            {(view.lines as Row[]).map((l, i) => <tr key={i}><td>{l.product_code} — {l.product_name}</td><td>{l.quantity}</td><td>{num(l.received_quantity)}</td><td>{r2(num(l.quantity) - num(l.received_quantity))}</td><td>{money(l.rate)}</td><td>{l.gst_percent}%</td><td>{money(l.amount)}</td></tr>)}
          </tbody></table></div>
             <p style={{ textAlign: 'right' }}>Sub-total {money(view.subtotal)} · GST {money(view.tax_amount)} · <b>Total {money(view.total_amount)}</b></p>
          <div style={{ border: '1px solid #e5e2da', borderRadius: 10, padding: '10px 14px', fontSize: 14, lineHeight: 1.7 }}>
            <b>Supplier activity</b>
            <div>E-mailed: {view.mailed_at ? `${at(view.mailed_at)} to ${view.supplier_email}` : view.mail_error ? <span style={{ color: '#b42318' }}>{view.mail_error}</span> : 'not e-mailed yet'}</div>
            <div>Opened: {view.viewed_at ? `${at(view.viewed_at)} (${view.view_count} time${view.view_count === 1 ? '' : 's'})` : 'not opened yet'}</div>
            <div>Reply: {view.supplier_response ? <b style={{ color: view.supplier_response === 'Confirmed' ? '#067647' : '#b42318' }}>{view.supplier_response} {at(view.responded_at)}</b> : 'waiting for the supplier'}{view.supplier_delivery_date ? ` · promised delivery ${view.supplier_delivery_date}` : ''}{view.supplier_note ? ` · “${view.supplier_note}”` : ''}</div>
          </div>
          <div className="modal-actions">
            <button type="button" className="quiet-button" onClick={() => printPo(view, company)}>Print</button>
            {OPEN.includes(view.status) && !view.supplier_response && <button type="button" className="quiet-button" onClick={() => void resend(view)}>{view.mail_status === 'Emailed' ? 'Resend e-mail' : 'Send e-mail'}</button>}
            {OPEN.includes(view.status) && <button type="button" className="primary-action" onClick={() => { setView(null); window.location.hash = '#industry:school:grn'; }}>Receive goods</button>}
            {view.status === 'Draft' && <button type="button" className="primary-action" onClick={() => void setStatus(view, 'Sent')}>Mark sent</button>}
          </div>
        </Modal>
      )}

      {open && (
        <Modal title="New purchase order" onClose={() => setOpen(false)} wide>
          <form className="master-modal-form" onSubmit={(e) => { e.preventDefault(); void submit(true); }}>
            <div className="field-grid">
              <label>Supplier *<select value={form.supplier_id} onChange={(e) => changeSupplier(e.target.value)}><option value="">Select supplier</option>{activeSuppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_code} — {s.supplier_name}</option>)}</select></label>
              <label>Order date<input type="date" value={form.order_date} onChange={(e) => setForm({ ...form, order_date: e.target.value })} /></label>
              <label>Expected delivery<input type="date" value={form.expected_date} onChange={(e) => setForm({ ...form, expected_date: e.target.value })} /></label>
              <label>Notes<input value={form.notes} placeholder="Optional" onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '4px 0 0', flexWrap: 'wrap', flexShrink: 0 }}>
              <h4 style={{ margin: 0 }}>Items</h4>
              <button type="button" className="quiet-button" disabled={!suggestions.length} onClick={autoSuggest}>⚡ Auto-suggest from orders &amp; stock ({suggestions.length})</button>
              <button type="button" className="quiet-button" disabled={!supplierProducts.length} onClick={() => addMany(supplierProducts.map((p) => ({ product: p })))}>Add all items of this supplier ({supplierProducts.length})</button>
            </div>
            <span style={{ ...hint, flexShrink: 0 }}>Pick a product and the rate, GST and quantity fill in; the cursor moves to Qty and a new row opens. Rate = last price paid to this supplier, else the product purchase price.</span>

            <div style={{ overflowX: 'auto', flexShrink: 0 }}>
              <table><thead><tr><th style={{ width: 32 }}>#</th><th>Product</th><th>Stock</th><th style={{ width: 110 }}>Qty</th><th style={{ width: 130 }}>Rate (₹)</th><th style={{ width: 90 }}>GST %</th><th style={{ width: 130, textAlign: 'right' }}>Amount</th><th /></tr></thead><tbody>
                {lines.map((l, i) => {
                  const p = productById.get(l.product_id);
                  const sg = suggestionById.get(l.product_id);
                  const low = p && p.stock_quantity != null && (p.stock_quantity <= 0 || (p.min_stock_level != null && p.stock_quantity <= p.min_stock_level));
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        <ProductCombobox products={products} value={l.product_id} onPick={(id) => pick(i, id)} supplierId={form.supplier_id} supplierName={supplier?.supplier_name ?? ''} lastPaid={lastPaid} />
                        {l.why && <div style={{ ...hint, marginTop: 2 }}>{l.why}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', color: low ? '#b42318' : undefined }}>
                        {p ? (p.stock_quantity != null ? `${p.stock_quantity}${p.min_stock_level != null ? ` (min ${p.min_stock_level})` : ''}` : 'not tracked') : '—'}
                        {sg && sg.pending_orders > 0 && <div style={hint}>orders need {sg.pending_orders}</div>}
                      </td>
                      <td><input id={`po-qty-${i}`} type="number" min="0" step="any" style={{ width: '100%' }} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                      <td><input type="number" min="0" step="any" style={{ width: '100%' }} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></td>
                      <td><input type="number" min="0" max="100" step="any" style={{ width: '100%' }} value={l.gst_percent} onChange={(e) => setLine(i, { gst_percent: e.target.value })} /></td>
                      <td style={{ textAlign: 'right' }}>{l.product_id ? money(lineAmount(l)) : '—'}</td>
                      <td><button type="button" className="quiet-button" onClick={() => setLines((ls) => withTrailingBlank(ls.filter((_, k) => k !== i)))}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody></table>
            </div>

            <div style={{ marginLeft: 'auto', flexShrink: 0, width: 'min(340px, 100%)', marginTop: 12, border: '1px solid #e5e2da', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Sub-total</span><span>{money(sub)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>GST</span><span>{money(r2(total - sub))}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 17, marginTop: 4 }}><span>Total ({validLines.length} item{validLines.length === 1 ? '' : 's'})</span><span>{money(total)}</span></div>
            </div>

            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="quiet-button" disabled={busy} onClick={() => void submit(false)}>Save as draft</button>
              <button type="submit" className="primary-action" disabled={busy}>{busy ? 'Saving…' : 'Create & mark sent'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}