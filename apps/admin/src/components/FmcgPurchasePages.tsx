// FMCG purchase side: Vendors / Companies, Purchase Orders (with reorder suggestions) and Goods Receipt (GRN).
// Receiving goods creates / tops up the batch (batch no + expiry) and adds stock automatically.
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

type Vendor = { id: string; vendor_code: string; vendor_name: string; vendor_type: string; contact_person: string | null; phone: string | null; email: string | null; address: string | null; city: string | null; state: string | null; gstin: string | null; pan: string | null; payment_terms_days: number; notes: string | null; status: string };
type PoLine = { product_id: string; product_code: string; product_name: string; quantity: number; received_quantity: number; rate: number; gst_percent: number };
type Po = { id: string; po_number: string; vendor_id: string; order_date: string; expected_date: string | null; tolerance_percent: number; status: string; lines: PoLine[]; subtotal: number; tax_amount: number; total_amount: number; notes: string | null; fmcg_vendors?: { vendor_name: string; vendor_code: string } | null };
type GrnLine = { product_name: string; quantity: number; batch_no: string | null; expiry_date: string | null };
type Grn = { id: string; grn_number: string; received_date: string; vendor_invoice_no: string | null; status: string; lines: GrnLine[]; total_quantity: number; fmcg_vendors?: { vendor_name: string } | null; fmcg_purchase_orders?: { po_number: string } | null };
type Product = { id: string; product_code: string; product_name: string; cost_price?: number | null; tax_percent?: number | null };
type Suggest = { product_id: string; product_name: string; stock: number; min_stock_level: number; on_order: number; quantity: number; vendor_name: string | null };

const num = (v: unknown) => Number(v ?? 0) || 0;
const money = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v || 0);
const qty = (v: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v || 0);
const dt = (v: string | null) => (v ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(v)) : '—');
const todayStr = () => new Date().toLocaleDateString('en-CA');
const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const STATUS_TONE: Record<string, string> = { Draft: '#64748b', Ordered: '#2563eb', 'Partially Received': '#d97706', Received: '#15803d', Closed: '#475569', Cancelled: '#b91c1c', Posted: '#15803d' };
const Chip = ({ s }: { s: string }) => <span style={{ background: `${STATUS_TONE[s] ?? '#64748b'}1a`, color: STATUS_TONE[s] ?? '#64748b', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{s}</span>;

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
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label style={{ display: 'grid', gap: 4, fontSize: 13 }}><span>{label}</span>{children}</label>;
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 };

// ============================================================ Vendors
export function FmcgVendorsPage() {
  const [rows, setRows] = useState<Vendor[]>([]); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [msg, setMsg] = useState(''); const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<Partial<Vendor> | null>(null); const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    try { setRows((await api<{ data: Vendor[] }>('/fmcg/vendors')).data ?? []); setError(''); } catch (e) { setError(errText(e, 'Unable to load vendors.')); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return rows.filter((r) => !q || [r.vendor_name, r.vendor_code, r.city, r.gstin].some((v) => (v ?? '').toLowerCase().includes(q))); }, [rows, search]);
  async function save(e: FormEvent) {
    e.preventDefault(); if (!edit) return; setBusy(true); setError('');
    const body: Record<string, unknown> = { ...(edit as Vendor) }; const id = body.id as string | undefined; delete body.id; delete body.vendor_code;
    try { await api(id ? `/fmcg/vendors/${id}` : '/fmcg/vendors', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }); setEdit(null); setMsg('Vendor saved successfully.'); await load(); }
    catch (err) { setError(errText(err, 'Unable to save vendor.')); } finally { setBusy(false); }
  }
  async function remove(v: Vendor) {
    if (!window.confirm(`Delete vendor ${v.vendor_name}?`)) return;
    try { await api(`/fmcg/vendors/${v.id}`, { method: 'DELETE' }); setMsg('Vendor deleted.'); await load(); } catch (err) { setError(errText(err, 'Unable to delete vendor.')); }
  }
  const set = (k: keyof Vendor, v: string) => setEdit((p) => ({ ...p, [k]: v }));
  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading"><div><p className="eyebrow">FMCG · VENDORS</p><h2>Vendors / Companies</h2><p>The companies and super stockists you buy stock from. Purchase Orders and Goods Receipts are raised against them.</p></div>
        <button className="primary-action" onClick={() => setEdit({ vendor_type: 'Company', payment_terms_days: 30, status: 'active' })}>+ Add vendor</button></div>
      <div className="master-toolbar"><div className="master-search"><input type="search" placeholder="Search name, code, city or GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
      {error && <p className="error-message">{error}</p>}{msg && <p className="success-message">{msg}</p>}
      <div className="data-table-wrap"><table>
        <thead><tr><th>Vendor</th><th>Type</th><th>Contact</th><th>City</th><th>GSTIN</th><th>Payment terms</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={8} className="empty-row">Loading…</td></tr>}
          {!loading && filtered.map((v) => (
            <tr key={v.id}><td><strong>{v.vendor_name}</strong><small style={{ display: 'block' }}>{v.vendor_code}</small></td><td>{v.vendor_type}</td><td>{v.contact_person || '—'}<small style={{ display: 'block' }}>{v.phone || v.email || ''}</small></td><td>{v.city || '—'}</td><td>{v.gstin || '—'}</td><td>{v.payment_terms_days} days</td>
              <td><Chip s={v.status === 'active' ? 'Received' : 'Closed'} /></td>
              <td className="master-actions"><button className="icon-action" title="Edit" onClick={() => setEdit(v)}>✎</button><button className="icon-action" title="Delete" onClick={() => void remove(v)}>🗑</button></td></tr>
          ))}
          {!loading && filtered.length === 0 && <tr><td colSpan={8} className="empty-row">{rows.length === 0 ? 'No vendors yet. Add the company you buy from.' : 'No vendors match your search.'}</td></tr>}
        </tbody></table></div>
      {edit && (
        <Modal eyebrow="VENDOR" title={edit.id ? 'Edit vendor' : 'Add vendor'} onClose={() => setEdit(null)} wide>
          <form onSubmit={save} style={{ display: 'grid', gap: 14 }}>
            <div style={grid}>
              <Field label="Vendor name *"><input required value={edit.vendor_name ?? ''} onChange={(e) => set('vendor_name', e.target.value)} /></Field>
              <Field label="Type"><select value={edit.vendor_type ?? 'Company'} onChange={(e) => set('vendor_type', e.target.value)}>{['Company', 'Super stockist', 'Dealer', 'Other'].map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="Contact person"><input value={edit.contact_person ?? ''} onChange={(e) => set('contact_person', e.target.value)} /></Field>
              <Field label="Phone"><input value={edit.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
              <Field label="Email"><input type="email" value={edit.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
              <Field label="City"><input value={edit.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
              <Field label="State"><input value={edit.state ?? ''} onChange={(e) => set('state', e.target.value)} /></Field>
              <Field label="GSTIN"><input value={edit.gstin ?? ''} maxLength={15} onChange={(e) => set('gstin', e.target.value.toUpperCase())} /></Field>
              <Field label="PAN"><input value={edit.pan ?? ''} maxLength={10} onChange={(e) => set('pan', e.target.value.toUpperCase())} /></Field>
              <Field label="Payment terms (days)"><input type="number" min={0} value={edit.payment_terms_days ?? 30} onChange={(e) => set('payment_terms_days', e.target.value)} /></Field>
              <Field label="Status"><select value={edit.status ?? 'active'} onChange={(e) => set('status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
            </div>
            <Field label="Address"><input value={edit.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="Notes"><input value={edit.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
            {error && <p className="error-message">{error}</p>}
            <div className="modal-actions"><button type="button" onClick={() => setEdit(null)}>Cancel</button><button className="primary-action" disabled={busy}>{busy ? 'Saving…' : 'Save vendor'}</button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}

// ============================================================ Receive goods (used by PO page and GRN page)
function ReceiveModal({ pos, po: initial, onClose, onDone }: { pos: Po[]; po?: Po; onClose: () => void; onDone: (m: string) => void }) {
  const open = pos.filter((p) => p.status === 'Ordered' || p.status === 'Partially Received');
  const [poId, setPoId] = useState(initial?.id ?? '');
  const po = open.find((p) => p.id === poId);
  const [received, setReceived] = useState(todayStr()); const [invoice, setInvoice] = useState(''); const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Array<{ idx: number; quantity: string; batch_no: string; mfg_date: string; expiry_date: string }>>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    setRows(po ? po.lines.map((l, idx) => ({ idx, quantity: String(Math.max(0, l.quantity - l.received_quantity)), batch_no: '', mfg_date: '', expiry_date: '' })).filter((r) => Number(r.quantity) > 0) : []);
  }, [poId]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (i: number, k: string, v: string) => setRows((r) => r.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!po) return; setBusy(true); setError('');
    try {
      const body = { po_id: po.id, received_date: received, vendor_invoice_no: invoice, notes, lines: rows.filter((r) => Number(r.quantity) > 0).map((r) => ({ po_line_index: r.idx, quantity: Number(r.quantity), batch_no: r.batch_no, mfg_date: r.mfg_date || null, expiry_date: r.expiry_date || null })) };
      const res = await api<{ data: { grn_number: string } }>('/fmcg/grns', { method: 'POST', body: JSON.stringify(body) });
      onDone(`Goods receipt ${res.data.grn_number} posted. Batches and stock are updated.`);
    } catch (err) { setError(errText(err, 'Unable to post the receipt.')); } finally { setBusy(false); }
  }
  return (
    <Modal eyebrow="GOODS RECEIPT" title="Receive goods" onClose={onClose} wide>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <div style={grid}>
          <Field label="Purchase order *"><select required value={poId} onChange={(e) => setPoId(e.target.value)} disabled={Boolean(initial)}><option value="">Select…</option>{open.map((p) => <option key={p.id} value={p.id}>{p.po_number} · {p.fmcg_vendors?.vendor_name}</option>)}</select></Field>
          <Field label="Received date"><input type="date" max={todayStr()} value={received} onChange={(e) => setReceived(e.target.value)} /></Field>
          <Field label="Vendor invoice no."><input value={invoice} onChange={(e) => setInvoice(e.target.value)} /></Field>
        </div>
        {po && (
          <div className="data-table-wrap"><table>
            <thead><tr><th>Product</th><th>Ordered / received</th><th>Receive now</th><th>Batch no.</th><th>Mfg date</th><th>Expiry date</th></tr></thead>
            <tbody>{rows.map((r, i) => { const l = po.lines[r.idx]; return (
              <tr key={r.idx}><td>{l.product_name}</td><td>{qty(l.quantity)} / {qty(l.received_quantity)}</td>
                <td><input type="number" min={0} step="any" style={{ width: 90 }} value={r.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} /></td>
                <td><input placeholder="Auto" value={r.batch_no} onChange={(e) => upd(i, 'batch_no', e.target.value)} /></td>
                <td><input type="date" value={r.mfg_date} onChange={(e) => upd(i, 'mfg_date', e.target.value)} /></td>
                <td><input type="date" value={r.expiry_date} onChange={(e) => upd(i, 'expiry_date', e.target.value)} /></td></tr>); })}
              {rows.length === 0 && <tr><td colSpan={6} className="empty-row">Everything on this order is already received.</td></tr>}</tbody></table></div>
        )}
        <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <small>Leave the batch number empty to have it numbered automatically. Expiry is needed if your FMCG expiry setting makes it mandatory. Receiving the same batch number again tops up that batch.</small>
        {error && <p className="error-message">{error}</p>}
        <div className="modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary-action" disabled={busy || !po || rows.length === 0}>{busy ? 'Posting…' : 'Post receipt'}</button></div>
      </form>
    </Modal>
  );
}

// ============================================================ Purchase orders
type Draft = { id?: string; vendor_id: string; order_date: string; expected_date: string; tolerance_percent: string; notes: string; lines: Array<{ product_id: string; quantity: string; rate: string; gst_percent: string }> };
const blankLine = { product_id: '', quantity: '', rate: '', gst_percent: '' };

export function FmcgPurchaseOrdersPage() {
  const [pos, setPos] = useState<Po[]>([]); const [vendors, setVendors] = useState<Vendor[]>([]); const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [msg, setMsg] = useState('');
  const [status, setStatus] = useState('all'); const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null); const [busy, setBusy] = useState(false);
  const [receive, setReceive] = useState<Po | null>(null);
  const [sug, setSug] = useState<{ items: Suggest[]; unassigned: Suggest[] } | null>(null);
  async function load() {
    setLoading(true);
    try {
      const [p, v, pr] = await Promise.all([api<{ data: Po[] }>('/fmcg/purchase-orders'), api<{ data: Vendor[] }>('/fmcg/vendors'), api<{ data: Product[] }>('/products')]);
      setPos(p.data ?? []); setVendors(v.data ?? []); setProducts(pr.data ?? []); setError('');
    } catch (e) { setError(errText(e, 'Unable to load purchase orders.')); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return pos.filter((p) => (status === 'all' || p.status === status) && (!q || [p.po_number, p.fmcg_vendors?.vendor_name].some((v) => (v ?? '').toLowerCase().includes(q)))); }, [pos, status, search]);
  const open = pos.filter((p) => ['Draft', 'Ordered', 'Partially Received'].includes(p.status));

  function openNew() { setDraft({ vendor_id: '', order_date: todayStr(), expected_date: '', tolerance_percent: '0', notes: '', lines: [{ ...blankLine }] }); }
  function openEdit(p: Po) { setDraft({ id: p.id, vendor_id: p.vendor_id, order_date: p.order_date, expected_date: p.expected_date ?? '', tolerance_percent: String(p.tolerance_percent), notes: p.notes ?? '', lines: p.lines.map((l) => ({ product_id: l.product_id, quantity: String(l.quantity), rate: String(l.rate), gst_percent: String(l.gst_percent) })) }); }
  const setLine = (i: number, k: string, v: string) => setDraft((d) => d && ({ ...d, lines: d.lines.map((l, n) => {
    if (n !== i) return l;
    const next = { ...l, [k]: v };
    if (k === 'product_id') { const p = products.find((x) => x.id === v); if (p) { next.rate = String(p.cost_price ?? ''); next.gst_percent = String(p.tax_percent ?? ''); } }
    return next;
  }) }));
  async function save(markOrdered: boolean) {
    if (!draft) return; setBusy(true); setError('');
    const body = { vendor_id: draft.vendor_id, order_date: draft.order_date, expected_date: draft.expected_date, tolerance_percent: Number(draft.tolerance_percent) || 0, notes: draft.notes, lines: draft.lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), rate: l.rate, gst_percent: l.gst_percent })), ...(markOrdered && !draft.id ? { status: 'Ordered' } : {}) };
    try {
      if (draft.id) { await api(`/fmcg/purchase-orders/${draft.id}`, { method: 'PATCH', body: JSON.stringify(body) }); if (markOrdered) await api(`/fmcg/purchase-orders/${draft.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Ordered' }) }); }
      else await api('/fmcg/purchase-orders', { method: 'POST', body: JSON.stringify(body) });
      setDraft(null); setMsg(markOrdered ? 'Purchase order placed.' : 'Draft saved.'); await load();
    } catch (err) { setError(errText(err, 'Unable to save the purchase order.')); } finally { setBusy(false); }
  }
  async function act(p: Po, to: 'Ordered' | 'Cancelled' | 'Closed' | 'delete') {
    const ask = { Ordered: `Place ${p.po_number} as Ordered?`, Cancelled: `Cancel ${p.po_number}?`, Closed: `Close ${p.po_number}? The vendor will not deliver the remaining quantity.`, delete: `Delete draft ${p.po_number}?` }[to];
    if (!window.confirm(ask)) return;
    try { await api(`/fmcg/purchase-orders/${p.id}`, to === 'delete' ? { method: 'DELETE' } : { method: 'PATCH', body: JSON.stringify({ status: to }) }); setMsg('Updated successfully.'); await load(); }
    catch (err) { setError(errText(err, 'Unable to update the order.')); }
  }
  async function showSuggestions() {
    try { setSug((await api<{ data: { items: Suggest[]; unassigned: Suggest[] } }>('/fmcg/purchase-orders/reorder-suggestions')).data); setError(''); } catch (err) { setError(errText(err, 'Unable to load suggestions.')); }
  }
  async function createDrafts() {
    setBusy(true);
    try { const r = await api<{ data: { created: Po[] } }>('/fmcg/purchase-orders/reorder-drafts', { method: 'POST', body: '{}' }); setSug(null); setMsg(`${r.data.created.length} draft purchase order(s) created. Review and place them.`); await load(); }
    catch (err) { setError(errText(err, 'Unable to create drafts.')); } finally { setBusy(false); }
  }
  const lineTotal = (draft?.lines ?? []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0) * (1 + (Number(l.gst_percent) || 0) / 100), 0);
  const sum = (s: string) => pos.filter((p) => p.status === s).length;

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading"><div><p className="eyebrow">FMCG · PURCHASE ORDERS</p><h2>Purchase orders</h2><p>Order stock from your vendors. When the goods arrive, receive them against the order and batches and stock update by themselves.</p></div>
        <div style={{ display: 'flex', gap: 8 }}><button onClick={() => void showSuggestions()}>Reorder suggestions</button><button className="primary-action" onClick={openNew}>+ New purchase order</button></div></div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '0 0 12px' }}>
        {['Draft', 'Ordered', 'Partially Received', 'Received'].map((s) => <div key={s} className="kpi-card" style={{ minWidth: 150 }}><div><span>{s}</span><strong>{sum(s)}</strong></div></div>)}
        <div className="kpi-card" style={{ minWidth: 150 }}><div><span>Open value</span><strong>{money(open.reduce((a, p) => a + num(p.total_amount), 0))}</strong></div></div>
      </div>
      <div className="master-toolbar"><div className="master-search"><input type="search" placeholder="Search PO number or vendor" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All status</option>{['Draft', 'Ordered', 'Partially Received', 'Received', 'Closed', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}</select></div></div>
      {error && <p className="error-message">{error}</p>}{msg && <p className="success-message">{msg}</p>}
      <div className="data-table-wrap"><table>
        <thead><tr><th>PO</th><th>Vendor</th><th>Order date</th><th>Expected</th><th>Items</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={8} className="empty-row">Loading…</td></tr>}
          {!loading && filtered.map((p) => (
            <tr key={p.id}><td><strong>{p.po_number}</strong></td><td>{p.fmcg_vendors?.vendor_name ?? '—'}</td><td>{dt(p.order_date)}</td><td>{dt(p.expected_date)}</td>
              <td>{p.lines.length}<small style={{ display: 'block' }}>{qty(p.lines.reduce((s, l) => s + l.received_quantity, 0))} of {qty(p.lines.reduce((s, l) => s + l.quantity, 0))} received</small></td>
              <td>{money(p.total_amount)}</td><td><Chip s={p.status} /></td>
              <td className="master-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {p.status === 'Draft' && <><button onClick={() => void act(p, 'Ordered')}>Place order</button><button className="icon-action" title="Edit" onClick={() => openEdit(p)}>✎</button><button className="icon-action" title="Delete" onClick={() => void act(p, 'delete')}>🗑</button></>}
                {(p.status === 'Ordered' || p.status === 'Partially Received') && <button className="primary-action" onClick={() => setReceive(p)}>Receive goods</button>}
                {p.status === 'Ordered' && <button onClick={() => void act(p, 'Cancelled')}>Cancel</button>}
                {p.status === 'Partially Received' && <button onClick={() => void act(p, 'Closed')}>Close</button>}
              </td></tr>
          ))}
          {!loading && filtered.length === 0 && <tr><td colSpan={8} className="empty-row">{pos.length === 0 ? 'No purchase orders yet.' : 'No purchase orders match your filters.'}</td></tr>}
        </tbody></table></div>

      {draft && (
        <Modal eyebrow="PURCHASE ORDER" title={draft.id ? 'Edit draft purchase order' : 'New purchase order'} onClose={() => setDraft(null)} wide>
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={grid}>
              <Field label="Vendor *"><select value={draft.vendor_id} onChange={(e) => setDraft({ ...draft, vendor_id: e.target.value })}><option value="">Select…</option>{vendors.filter((v) => v.status === 'active').map((v) => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}</select></Field>
              <Field label="Order date"><input type="date" value={draft.order_date} onChange={(e) => setDraft({ ...draft, order_date: e.target.value })} /></Field>
              <Field label="Expected delivery"><input type="date" min={draft.order_date} value={draft.expected_date} onChange={(e) => setDraft({ ...draft, expected_date: e.target.value })} /></Field>
              <Field label="Over / short tolerance %"><input type="number" min={0} max={100} value={draft.tolerance_percent} onChange={(e) => setDraft({ ...draft, tolerance_percent: e.target.value })} /></Field>
            </div>
            <div className="data-table-wrap"><table>
              <thead><tr><th>Product</th><th>Quantity</th><th>Rate (₹)</th><th>GST %</th><th>Amount</th><th></th></tr></thead>
              <tbody>{draft.lines.map((l, i) => (
                <tr key={i}><td><select value={l.product_id} onChange={(e) => setLine(i, 'product_id', e.target.value)}><option value="">Select product…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.product_name} ({p.product_code})</option>)}</select></td>
                  <td><input type="number" min={0} step="any" style={{ width: 90 }} value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></td>
                  <td><input type="number" min={0} step="any" style={{ width: 100 }} value={l.rate} onChange={(e) => setLine(i, 'rate', e.target.value)} /></td>
                  <td><input type="number" min={0} max={100} step="any" style={{ width: 70 }} value={l.gst_percent} onChange={(e) => setLine(i, 'gst_percent', e.target.value)} /></td>
                  <td>{money((Number(l.quantity) || 0) * (Number(l.rate) || 0) * (1 + (Number(l.gst_percent) || 0) / 100))}</td>
                  <td>{draft.lines.length > 1 && <button type="button" className="icon-action" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, n) => n !== i) })}>×</button>}</td></tr>))}</tbody></table></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><button type="button" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { ...blankLine }] })}>+ Add product</button><strong>Total (incl. GST): {money(lineTotal)}</strong></div>
            <Field label="Notes"><input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
            {error && <p className="error-message">{error}</p>}
            <div className="modal-actions"><button type="button" onClick={() => setDraft(null)}>Cancel</button><button type="button" disabled={busy} onClick={() => void save(false)}>Save as draft</button><button className="primary-action" type="button" disabled={busy} onClick={() => void save(true)}>{busy ? 'Saving…' : 'Save & place order'}</button></div>
          </div>
        </Modal>
      )}

      {receive && <ReceiveModal pos={pos} po={receive} onClose={() => setReceive(null)} onDone={(m) => { setReceive(null); setMsg(m); void load(); }} />}

      {sug && (
        <Modal eyebrow="REORDER" title="Low-stock reorder suggestions" onClose={() => setSug(null)} wide>
          <div style={{ display: 'grid', gap: 12 }}>
            <small>Products at or below their minimum stock level, not already covered by an open order. Suggested quantity brings stock back up to twice the minimum level.</small>
            <div className="data-table-wrap"><table>
              <thead><tr><th>Product</th><th>Stock / min</th><th>On order</th><th>Suggested qty</th><th>Vendor (from last PO)</th></tr></thead>
              <tbody>{[...sug.items, ...sug.unassigned].map((s) => <tr key={s.product_id}><td>{s.product_name}</td><td>{qty(s.stock)} / {qty(s.min_stock_level)}</td><td>{qty(s.on_order)}</td><td><strong>{qty(s.quantity)}</strong></td><td>{s.vendor_name ?? <em>No vendor yet — add it to a PO manually</em>}</td></tr>)}
                {sug.items.length + sug.unassigned.length === 0 && <tr><td colSpan={5} className="empty-row">Nothing to reorder right now.</td></tr>}</tbody></table></div>
            <div className="modal-actions"><button type="button" onClick={() => setSug(null)}>Close</button><button className="primary-action" disabled={busy || sug.items.length === 0} onClick={() => void createDrafts()}>{busy ? 'Creating…' : `Create draft POs (${sug.items.length} item${sug.items.length === 1 ? '' : 's'})`}</button></div>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ============================================================ Goods receipts
export function FmcgGrnPage() {
  const [grns, setGrns] = useState<Grn[]>([]); const [pos, setPos] = useState<Po[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [msg, setMsg] = useState(''); const [search, setSearch] = useState('');
  const [receive, setReceive] = useState(false);
  async function load() {
    setLoading(true);
    try { const [g, p] = await Promise.all([api<{ data: Grn[] }>('/fmcg/grns'), api<{ data: Po[] }>('/fmcg/purchase-orders')]); setGrns(g.data ?? []); setPos(p.data ?? []); setError(''); }
    catch (e) { setError(errText(e, 'Unable to load goods receipts.')); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return grns.filter((g) => !q || [g.grn_number, g.vendor_invoice_no, g.fmcg_vendors?.vendor_name, g.fmcg_purchase_orders?.po_number].some((v) => (v ?? '').toLowerCase().includes(q))); }, [grns, search]);
  async function cancel(g: Grn) {
    if (!window.confirm(`Cancel ${g.grn_number}? The received units are taken back out of stock.`)) return;
    try { await api(`/fmcg/grns/${g.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Cancelled' }) }); setMsg('Receipt cancelled and stock reversed.'); await load(); }
    catch (err) { setError(errText(err, 'Unable to cancel the receipt.')); }
  }
  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading"><div><p className="eyebrow">FMCG · GOODS RECEIPT</p><h2>Goods receipt (GRN)</h2><p>Every receipt creates or tops up a batch with its expiry, adds stock, and writes a stock-in entry.</p></div>
        <button className="primary-action" onClick={() => setReceive(true)}>+ Receive goods</button></div>
      <div className="master-toolbar"><div className="master-search"><input type="search" placeholder="Search GRN, PO, vendor or invoice no." value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
      {error && <p className="error-message">{error}</p>}{msg && <p className="success-message">{msg}</p>}
      <div className="data-table-wrap"><table>
        <thead><tr><th>GRN</th><th>PO</th><th>Vendor</th><th>Received</th><th>Vendor invoice</th><th>Items (batch · expiry)</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={8} className="empty-row">Loading…</td></tr>}
          {!loading && filtered.map((g) => (
            <tr key={g.id}><td><strong>{g.grn_number}</strong></td><td>{g.fmcg_purchase_orders?.po_number ?? '—'}</td><td>{g.fmcg_vendors?.vendor_name ?? '—'}</td><td>{dt(g.received_date)}</td><td>{g.vendor_invoice_no || '—'}</td>
              <td>{g.lines.map((l, i) => <small key={i} style={{ display: 'block' }}>{l.product_name} × {qty(l.quantity)} · {l.batch_no ?? '—'} · {dt(l.expiry_date)}</small>)}</td>
              <td><Chip s={g.status} /></td>
              <td className="master-actions">{g.status === 'Posted' && <button onClick={() => void cancel(g)}>Cancel receipt</button>}</td></tr>
          ))}
          {!loading && filtered.length === 0 && <tr><td colSpan={8} className="empty-row">{grns.length === 0 ? 'No goods received yet. Place a purchase order, then receive goods against it.' : 'No receipts match your search.'}</td></tr>}
        </tbody></table></div>
      {receive && <ReceiveModal pos={pos} onClose={() => setReceive(false)} onDone={(m) => { setReceive(false); setMsg(m); void load(); }} />}
    </section>
  );
}