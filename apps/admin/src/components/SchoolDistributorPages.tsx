/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustry } from '../industry/IndustryContext';
import { useIndustryScope } from '../industry/useIndustryScope';
import { TextileMasterPage, TextileModuleConfig } from './TextileMasterPage';

// School distributor / wholesaler back office. Backed by /school/* (see api/src/routes/school-distributor.routes.ts).
// Pages: Company & GST, Suppliers, Purchase Orders, Goods Receipt (GRN), Supplier Payments, GST Invoices, GST Credit Notes, Reports.

type Row = Record<string, any>;
type Product = { id: string; product_code: string; product_name: string; tax_percent?: number | null; cost_price?: number | null; stock_quantity?: number | null };
type Line = { product_id: string; quantity: string; rate: string; gst_percent: string };

const money = (v: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v ?? 0));
const messageOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const post = <T,>(path: string, payload: unknown, method = 'POST') => api<{ data: T }>(path, { method, body: JSON.stringify(payload) });

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

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop modal-backdrop--center" role="dialog" aria-modal="true">
      <div className="master-modal master-modal--center" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-heading"><h3>{title}</h3><button type="button" className="quiet-button" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

function Shell({ module, title, description, actions, error, message, children }: { module: string; title: string; description: string; actions?: ReactNode; error?: string; message?: string; children: ReactNode }) {
  const { config } = useIndustry();
  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading"><div><p className="eyebrow">{config.label.toUpperCase()} · {module}</p><h2>{title}</h2><p>{description}</p></div></div>
      {actions && <div className="master-toolbar">{actions}</div>}
      {error && <p className="error-message">{error}</p>}
      {message && <p className="success-message">{message}</p>}
      {children}
    </section>
  );
}

function useProducts(industryId: string | null) {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    if (!industryId) return;
    api<{ data: Product[] }>(`/products?status=active&industryTypeId=${industryId}`).then((r) => setProducts(r.data ?? [])).catch(() => setProducts([]));
  }, [industryId]);
  return products;
}

function LineEditor({ lines, products, onChange, rateLabel = 'Rate' }: { lines: Line[]; products: Product[]; onChange: (next: Line[]) => void; rateLabel?: string }) {
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const pick = (i: number, id: string) => { const p = products.find((x) => x.id === id); set(i, { product_id: id, rate: p?.cost_price != null ? String(p.cost_price) : lines[i].rate, gst_percent: p?.tax_percent != null ? String(p.tax_percent) : lines[i].gst_percent }); };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table><thead><tr><th>Product</th><th>Qty</th><th>{rateLabel}</th><th>GST %</th><th /></tr></thead><tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td><select value={l.product_id} onChange={(e) => pick(i, e.target.value)}><option value="">Select product</option>{products.map((p) => <option key={p.id} value={p.id}>{p.product_code} — {p.product_name}</option>)}</select></td>
            <td><input type="number" min="0" step="any" style={{ width: 90 }} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
            <td><input type="number" min="0" step="any" style={{ width: 100 }} value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} /></td>
            <td><input type="number" min="0" max="100" step="any" style={{ width: 80 }} value={l.gst_percent} onChange={(e) => set(i, { gst_percent: e.target.value })} /></td>
            <td><button type="button" className="quiet-button" onClick={() => onChange(lines.filter((_, k) => k !== i))}>Remove</button></td>
          </tr>
        ))}
      </tbody></table>
      <button type="button" className="quiet-button" onClick={() => onChange([...lines, { product_id: '', quantity: '', rate: '', gst_percent: '' }])}>+ Add product</button>
    </div>
  );
}

function printDoc(kind: string, doc: Row, company: Row, party: string, ref: string) {
  const co = company ?? {};
  const rows = (doc.lines as Row[]).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.product_name)}</td><td>${esc(l.hsn_code)}</td><td class="r">${l.quantity}</td><td class="r">${Number(l.rate).toFixed(2)}</td><td class="r">${Number(l.taxable_value).toFixed(2)}</td><td class="r">${l.gst_percent}%</td><td class="r">${Number(l.amount).toFixed(2)}</td></tr>`).join('');
  const w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<!doctype html><title>${esc(ref)}</title><style>body{font:13px Arial;margin:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:5px}.r{text-align:right}h2{margin:0}</style>
<h2>${esc(co.company_name)}</h2><div>${esc(co.address)} ${esc(co.city)} ${esc(co.state)} ${esc(co.pincode)}<br>GSTIN: ${esc(co.gstin)} · ${esc(co.phone)}</div><hr>
<h3>${esc(kind)} ${esc(ref)}</h3><div>Date: ${esc(doc.invoice_date ?? doc.note_date)}${doc.due_date ? ` · Due: ${esc(doc.due_date)}` : ''}${doc.supply_type ? ` · ${esc(doc.supply_type)}` : ''}<br>Bill to: <b>${esc(party)}</b>${doc.place_of_supply ? ` · Place of supply: ${esc(doc.place_of_supply)}` : ''}${doc.reason ? `<br>Reason: ${esc(doc.reason)}` : ''}</div><br>
<table><tr><th>#</th><th>Description</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Taxable</th><th>GST</th><th>Amount</th></tr>${rows}</table><br>
<table style="width:45%;margin-left:auto"><tr><td>Taxable value</td><td class="r">${Number(doc.taxable_amount).toFixed(2)}</td></tr>${Number(doc.cgst_amount) ? `<tr><td>CGST</td><td class="r">${Number(doc.cgst_amount).toFixed(2)}</td></tr><tr><td>SGST</td><td class="r">${Number(doc.sgst_amount).toFixed(2)}</td></tr>` : `<tr><td>IGST</td><td class="r">${Number(doc.igst_amount).toFixed(2)}</td></tr>`}<tr><td>Round off</td><td class="r">${Number(doc.round_off).toFixed(2)}</td></tr><tr><td><b>Total</b></td><td class="r"><b>${Number(doc.total_amount).toFixed(2)}</b></td></tr></table>
<p>Bank: ${esc(co.bank_name)} A/c ${esc(co.bank_account)} IFSC ${esc(co.bank_ifsc)}</p><p><small>${esc(co.terms)}</small></p><script>window.print()</script>`);
  w.document.close();
}

// ---------------------------------------------------------------------------------------------- Company & GST
const COMPANY_FIELDS: { key: string; label: string; textarea?: boolean; placeholder?: string }[] = [
  { key: 'company_name', label: 'Company name *' }, { key: 'gstin', label: 'GSTIN', placeholder: '33AABCM1234F1Z4' }, { key: 'pan', label: 'PAN' },
  { key: 'invoice_prefix', label: 'Invoice prefix', placeholder: 'INV' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
  { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'pincode', label: 'PIN code (6 digits)' },
  { key: 'bank_name', label: 'Bank name' }, { key: 'bank_account', label: 'Bank account no.' }, { key: 'bank_ifsc', label: 'IFSC' },
  { key: 'address', label: 'Address', textarea: true }, { key: 'terms', label: 'Terms & conditions (printed on invoice)', textarea: true },
];

export function SchoolCompanyPage() {
  const { activeIndustryTypeId } = useIndustryScope();
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => {
    if (!activeIndustryTypeId) return;
    api<{ data: Row | null }>(`/school/company-profile?industryTypeId=${activeIndustryTypeId}`).then((r) => setForm(Object.fromEntries(COMPANY_FIELDS.map((f) => [f.key, String(r.data?.[f.key] ?? (f.key === 'invoice_prefix' ? 'INV' : ''))])))).catch((e) => setError(messageOf(e, 'Unable to load.')));
  }, [activeIndustryTypeId]);
  async function save(e: FormEvent) {
    e.preventDefault(); setError(''); setMessage('');
    try { await post('/school/company-profile', { ...form, industryTypeId: activeIndustryTypeId }, 'PUT'); setMessage('Company & GST details saved.'); } catch (err) { setError(messageOf(err, 'Unable to save.')); }
  }
  return (
    <Shell module="COMPANY & GST" title="Company & GST" description="Your own legal and bank details. They print on every GST invoice and decide CGST/SGST or IGST (from your state)." error={error} message={message}>
      <form className="master-modal-form" onSubmit={save}>
        <div className="field-grid">{COMPANY_FIELDS.map((f) => (
          <label key={f.key}>{f.label}{f.textarea ? <textarea value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} /> : <input placeholder={f.placeholder} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}</label>
        ))}</div>
        <div className="modal-actions"><button type="submit" className="primary-action">Save</button></div>
      </form>
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------- Suppliers (config-driven page)
const SUPPLIER_STATUSES = ['Active', 'Inactive'];
const supplierConfig: TextileModuleConfig = {
  resource: '/school/suppliers',
  eyebrowModule: 'SUPPLIERS / PUBLISHERS',
  title: 'Suppliers / publishers',
  description: 'Publishers, manufacturers and wholesalers you buy books, uniforms and stationery from.',
  icon: '🏭', emptyIcon: '🏭',
  codeField: 'supplier_code', nameField: 'supplier_name',
  statusOptions: SUPPLIER_STATUSES,
  searchableKeys: ['supplier_code', 'supplier_name', 'contact_person', 'city', 'gstin'],
  fields: [
    { key: 'supplier_code', label: 'Supplier code', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'SUP' },
    { key: 'supplier_name', label: 'Supplier name', type: 'text', required: true, listColumn: true },
    { key: 'contact_person', label: 'Contact person', type: 'text', group: 'Contact' },
    { key: 'phone', label: 'Phone', type: 'text', group: 'Contact', listColumn: true },
    { key: 'email', label: 'Email', type: 'text', group: 'Contact' },
    { key: 'address', label: 'Address', type: 'textarea', group: 'Contact' },
    { key: 'city', label: 'City', type: 'text', group: 'Contact', listColumn: true },
    { key: 'state', label: 'State', type: 'text', group: 'Contact' },
    { key: 'gstin', label: 'GSTIN', type: 'text', group: 'Commercial' },
    { key: 'payment_terms_days', label: 'Credit days', type: 'number', min: 0, group: 'Commercial' },
    { key: 'status', label: 'Status', type: 'select', options: SUPPLIER_STATUSES, listColumn: true, group: 'Commercial' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Commercial' },
  ],
  kpis: [
    { icon: '🏭', iconClass: 'kpi-icon-ink', label: 'Total suppliers', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active', value: (r) => String(r.filter((x) => x.status === 'Active').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Inactive', value: (r) => String(r.filter((x) => x.status === 'Inactive').length) },
  ],
};
export function SchoolSuppliersPage() { return <TextileMasterPage config={supplierConfig} />; }

// ---------------------------------------------------------------------------------------------- Purchase orders
export function SchoolPurchaseOrdersPage() {
  const { rows, loading, error, reload, industryId } = useRows('/school/purchase-orders');
  const suppliers = useRows('/school/suppliers');
  const products = useProducts(industryId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>([{ product_id: '', quantity: '', rate: '', gst_percent: '' }]);
  const [formError, setFormError] = useState(''); const [message, setMessage] = useState(''); const [pageError, setPageError] = useState('');
  async function create(e: FormEvent) {
    e.preventDefault(); setFormError('');
    try {
      const res = await post<Row>('/school/purchase-orders', { industryTypeId: industryId, ...form, lines: lines.filter((l) => l.product_id) });
      setOpen(false); setMessage(`Purchase order ${res.data.po_number} created as Draft. Mark it Sent when you place it with the supplier.`); await reload();
    } catch (err) { setFormError(messageOf(err, 'Unable to create.')); }
  }
  async function setStatus(po: Row, status: string) {
    setPageError(''); setMessage('');
    try { await post(`/school/purchase-orders/${po.id}?industryTypeId=${industryId}`, { status }, 'PATCH'); await reload(); } catch (err) { setPageError(messageOf(err, 'Unable to update.')); }
  }
  return (
    <Shell module="PURCHASE ORDERS" title="Purchase orders" description="Orders placed with suppliers. Goods you receive against them go in through Goods Receipt (GRN)." error={error || pageError} message={message}
      actions={<button type="button" className="primary-action" onClick={() => { setForm({ supplier_id: '', order_date: new Date().toISOString().slice(0, 10), expected_date: '', notes: '' }); setLines([{ product_id: '', quantity: '', rate: '', gst_percent: '' }]); setFormError(''); setOpen(true); }}>New purchase order</button>}>
      {rows.length === 0 ? <p className="empty-state">{loading ? 'Loading…' : 'No purchase orders yet.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>PO</th><th>Date</th><th>Supplier</th><th>Expected</th><th>Total</th><th>Received</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map((po) => {
            const ordered = (po.lines as Row[]).reduce((s, l) => s + Number(l.quantity), 0); const got = (po.lines as Row[]).reduce((s, l) => s + Number(l.received_quantity ?? 0), 0);
            return (
              <tr key={po.id}><td>{po.po_number}</td><td>{po.order_date}</td><td>{po.school_suppliers?.supplier_name ?? '—'}</td><td>{po.expected_date ?? '—'}</td><td>{money(po.total_amount)}</td><td>{got} / {ordered}</td><td><span className="status-badge">{po.status}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {po.status === 'Draft' && <button type="button" className="quiet-button" onClick={() => void setStatus(po, 'Sent')}>Mark sent</button>}{' '}
                  {['Draft', 'Sent'].includes(po.status) && <button type="button" className="quiet-button" onClick={() => void setStatus(po, 'Cancelled')}>Cancel</button>}
                </td></tr>
            );
          })}
        </tbody></table></div>
      )}
      {open && (
        <Modal title="New purchase order" onClose={() => setOpen(false)}>
          <form className="master-modal-form" onSubmit={create}>
            <div className="field-grid">
              <label>Supplier *<select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}><option value="">Select supplier</option>{suppliers.rows.filter((s) => s.status === 'Active').map((s) => <option key={s.id} value={s.id}>{s.supplier_code} — {s.supplier_name}</option>)}</select></label>
              <label>Order date<input type="date" value={form.order_date} onChange={(e) => setForm({ ...form, order_date: e.target.value })} /></label>
              <label>Expected date<input type="date" value={form.expected_date} onChange={(e) => setForm({ ...form, expected_date: e.target.value })} /></label>
              <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            </div>
            <LineEditor lines={lines} products={products} onChange={setLines} rateLabel="Purchase rate" />
            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary-action">Create</button></div>
          </form>
        </Modal>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------- Goods receipt (GRN)
export function SchoolGrnPage() {
  const { rows, loading, error, reload, industryId } = useRows('/school/grns');
  const pos = useRows('/school/purchase-orders');
  const suppliers = useRows('/school/suppliers');
  const products = useProducts(industryId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [formError, setFormError] = useState(''); const [message, setMessage] = useState(''); const [pageError, setPageError] = useState('');
  const receivable = pos.rows.filter((p) => ['Sent', 'Partially received'].includes(p.status));
  function pickPo(id: string) {
    const po = receivable.find((p) => p.id === id);
    setForm((f) => ({ ...f, po_id: id, supplier_id: po?.supplier_id ?? f.supplier_id }));
    if (po) setLines((po.lines as Row[]).filter((l) => Number(l.quantity) - Number(l.received_quantity ?? 0) > 0).map((l) => ({ product_id: l.product_id, quantity: String(Number(l.quantity) - Number(l.received_quantity ?? 0)), rate: String(l.rate), gst_percent: String(l.gst_percent) })));
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setFormError('');
    try {
      const res = await post<Row>('/school/grns', { industryTypeId: industryId, ...form, po_id: form.po_id || null, lines: lines.filter((l) => l.product_id && Number(l.quantity) > 0) });
      setOpen(false); setMessage(`Goods receipt ${res.data.grn_number} posted. Stock was added to the shelf.`); await reload(); await pos.reload();
    } catch (err) { setFormError(messageOf(err, 'Unable to post.')); }
  }
  async function cancel(g: Row) {
    if (!window.confirm(`Cancel ${g.grn_number}? The received stock will be taken back.`)) return;
    setPageError(''); setMessage('');
    try { await post(`/school/grns/${g.id}/cancel?industryTypeId=${industryId}`, {}); setMessage('Goods receipt cancelled and stock taken back.'); await reload(); await pos.reload(); } catch (err) { setPageError(messageOf(err, 'Unable to cancel.')); }
  }
  return (
    <Shell module="GOODS RECEIPT" title="Goods receipt (GRN)" description="Record goods that arrive from a supplier. Posting adds the quantity to product stock and updates the purchase order." error={error || pageError} message={message}
      actions={<button type="button" className="primary-action" onClick={() => { setForm({ po_id: '', supplier_id: '', received_date: new Date().toISOString().slice(0, 10), supplier_invoice_no: '', notes: '' }); setLines([{ product_id: '', quantity: '', rate: '', gst_percent: '' }]); setFormError(''); setOpen(true); }}>Receive goods</button>}>
      {rows.length === 0 ? <p className="empty-state">{loading ? 'Loading…' : 'No goods receipts yet.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>GRN</th><th>Date</th><th>Supplier</th><th>PO</th><th>Supplier invoice</th><th>Items</th><th>Value</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map((g) => (
            <tr key={g.id}><td>{g.grn_number}</td><td>{g.received_date}</td><td>{g.school_suppliers?.supplier_name ?? '—'}</td><td>{g.school_purchase_orders?.po_number ?? 'Direct'}</td><td>{g.supplier_invoice_no ?? '—'}</td><td>{(g.lines as Row[]).map((l) => `${l.product_name} × ${l.quantity}`).join(', ')}</td><td>{money(g.total_amount)}</td><td><span className="status-badge">{g.status}</span></td>
              <td>{g.status === 'Posted' && <button type="button" className="quiet-button" onClick={() => void cancel(g)}>Cancel</button>}</td></tr>
          ))}
        </tbody></table></div>
      )}
      {open && (
        <Modal title="Receive goods" onClose={() => setOpen(false)}>
          <form className="master-modal-form" onSubmit={save}>
            <div className="field-grid">
              <label>Against purchase order<select value={form.po_id} onChange={(e) => pickPo(e.target.value)}><option value="">Direct purchase (no PO)</option>{receivable.map((p) => <option key={p.id} value={p.id}>{p.po_number} — {p.school_suppliers?.supplier_name}</option>)}</select></label>
              <label>Supplier *<select value={form.supplier_id} disabled={!!form.po_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}><option value="">Select supplier</option>{suppliers.rows.filter((s) => s.status === 'Active').map((s) => <option key={s.id} value={s.id}>{s.supplier_code} — {s.supplier_name}</option>)}</select></label>
              <label>Received date<input type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} /></label>
              <label>Supplier invoice no.<input value={form.supplier_invoice_no} onChange={(e) => setForm({ ...form, supplier_invoice_no: e.target.value })} /></label>
            </div>
            <LineEditor lines={lines} products={products} onChange={setLines} rateLabel="Purchase rate" />
            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary-action">Post receipt</button></div>
          </form>
        </Modal>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------- Supplier payments
export function SchoolSupplierPaymentsPage() {
  const { rows, loading, error, reload, industryId } = useRows('/school/supplier-payments');
  const payables = useRows('/school/supplier-outstanding');
  const grns = useRows('/school/grns');
  const suppliers = useRows('/school/suppliers');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState(''); const [message, setMessage] = useState(''); const [pageError, setPageError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault(); setFormError('');
    try { const res = await post<Row>('/school/supplier-payments', { industryTypeId: industryId, ...form, grn_id: form.grn_id || null }); setOpen(false); setMessage(`Payment ${res.data.payment_number} recorded.`); await reload(); await payables.reload(); }
    catch (err) { setFormError(messageOf(err, 'Unable to save.')); }
  }
  async function remove(p: Row) {
    if (!window.confirm(`Delete payment ${p.payment_number}?`)) return;
    setPageError('');
    try { await api(`/school/supplier-payments/${p.id}?industryTypeId=${industryId}`, { method: 'DELETE' }); await reload(); await payables.reload(); } catch (err) { setPageError(messageOf(err, 'Unable to delete.')); }
  }
  return (
    <Shell module="SUPPLIER PAYMENTS" title="Supplier bills & payments" description="What you owe each supplier (posted goods receipts, GST included) less the payments you have made." error={error || pageError} message={message}
      actions={<button type="button" className="primary-action" onClick={() => { setForm({ supplier_id: '', grn_id: '', amount: '', payment_date: new Date().toISOString().slice(0, 10), mode: 'Bank transfer', reference_no: '', notes: '' }); setFormError(''); setOpen(true); }}>Record payment</button>}>
      <h3>Payables by supplier</h3>
      {payables.rows.length === 0 ? <p className="empty-state">{payables.loading ? 'Loading…' : 'Nothing purchased yet.'}</p> : (
        <table><thead><tr><th>Supplier</th><th>Purchased</th><th>Paid</th><th>Payable</th></tr></thead><tbody>
          {payables.rows.map((r) => <tr key={r.supplier_id}><td>{r.supplier_code} — {r.supplier_name}</td><td>{money(r.purchased)}</td><td>{money(r.paid)}</td><td><b>{money(r.payable)}</b>{r.advance_paid > 0 ? ` (advance ${money(r.advance_paid)})` : ''}</td></tr>)}
        </tbody></table>
      )}
      <h3>Payments</h3>
      {rows.length === 0 ? <p className="empty-state">{loading ? 'Loading…' : 'No payments yet.'}</p> : (
        <table><thead><tr><th>Payment</th><th>Date</th><th>Supplier</th><th>GRN</th><th>Mode</th><th>Reference</th><th>Amount</th><th /></tr></thead><tbody>
          {rows.map((p) => <tr key={p.id}><td>{p.payment_number}</td><td>{p.payment_date}</td><td>{p.school_suppliers?.supplier_name ?? '—'}</td><td>{p.school_grns?.grn_number ?? '—'}</td><td>{p.mode ?? '—'}</td><td>{p.reference_no ?? '—'}</td><td>{money(p.amount)}</td><td><button type="button" className="quiet-button" onClick={() => void remove(p)}>Delete</button></td></tr>)}
        </tbody></table>
      )}
      {open && (
        <Modal title="Record supplier payment" onClose={() => setOpen(false)}>
          <form className="master-modal-form" onSubmit={save}>
            <div className="field-grid">
              <label>Supplier *<select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value, grn_id: '' })}><option value="">Select supplier</option>{suppliers.rows.filter((s) => s.status === 'Active').map((s) => <option key={s.id} value={s.id}>{s.supplier_code} — {s.supplier_name}</option>)}</select></label>
              <label>Against goods receipt (optional)<select value={form.grn_id} onChange={(e) => setForm({ ...form, grn_id: e.target.value })}><option value="">On account</option>{grns.rows.filter((g) => g.supplier_id === form.supplier_id && g.status === 'Posted').map((g) => <option key={g.id} value={g.id}>{g.grn_number} — {money(g.total_amount)}</option>)}</select></label>
              <label>Amount *<input type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
              <label>Date<input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></label>
              <label>Mode<select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>{['Bank transfer', 'Cheque', 'UPI', 'Cash'].map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Reference no.<input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></label>
            </div>
            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary-action">Save</button></div>
          </form>
        </Modal>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------- GST invoices
export function SchoolInvoicesPage() {
  const { rows, loading, error, reload, industryId } = useRows('/school/invoices');
  const pending = useRows('/school/invoices/pending-orders');
  const [company, setCompany] = useState<Row | null>(null);
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState(''); const [pageError, setPageError] = useState('');
  useEffect(() => { if (industryId) api<{ data: Row | null }>(`/school/company-profile?industryTypeId=${industryId}`).then((r) => setCompany(r.data)).catch(() => setCompany(null)); }, [industryId]);
  async function create(o: Row) {
    setBusy(o.id); setPageError(''); setMessage('');
    try { const res = await post<Row>('/school/invoices', { industryTypeId: industryId, orderId: o.id }); setMessage(`Invoice ${res.data.invoice_number} created for order ${o.order_number}.`); await reload(); await pending.reload(); }
    catch (err) { setPageError(messageOf(err, 'Unable to create the invoice.')); } finally { setBusy(''); }
  }
  async function cancel(inv: Row) {
    const reason = window.prompt(`Cancel invoice ${inv.invoice_number}? Enter the reason:`); if (!reason) return;
    setPageError('');
    try { await post(`/school/invoices/${inv.id}/cancel?industryTypeId=${industryId}`, { reason }); setMessage('Invoice cancelled.'); await reload(); await pending.reload(); } catch (err) { setPageError(messageOf(err, 'Unable to cancel.')); }
  }
  return (
    <Shell module="GST SALES INVOICES" title="GST sales invoices" description="One tax invoice per dispatched order. CGST + SGST inside your state, IGST outside. Needs your Company & GST details." error={error || pageError} message={message}>
      <h3>Dispatched orders waiting for an invoice ({pending.rows.length})</h3>
      {pending.rows.length === 0 ? <p className="empty-state">{pending.loading ? 'Loading…' : 'Every dispatched order has an invoice.'}</p> : (
        <table><thead><tr><th>Order</th><th>School</th><th>Delivery</th><th>Order value</th><th /></tr></thead><tbody>
          {pending.rows.map((o) => <tr key={o.id}><td>{o.order_number}</td><td>{o.client_name ?? '—'}</td><td>{o.delivery_status}</td><td>{money(o.total_amount)}</td><td><button type="button" className="quiet-button" disabled={busy === o.id} onClick={() => void create(o)}>{busy === o.id ? 'Creating…' : 'Create invoice'}</button></td></tr>)}
        </tbody></table>
      )}
      <h3>Invoices ({rows.length})</h3>
      {rows.length === 0 ? <p className="empty-state">{loading ? 'Loading…' : 'No invoices yet.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Invoice</th><th>Date</th><th>School</th><th>Order</th><th>Taxable</th><th>GST</th><th>Total</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map((inv) => (
            <tr key={inv.id}><td>{inv.invoice_number}</td><td>{inv.invoice_date}</td><td>{inv.clients?.client_name ?? '—'}</td><td>{inv.sale_orders?.order_number ?? '—'}</td><td>{money(inv.taxable_amount)}</td><td>{money(Number(inv.cgst_amount) + Number(inv.sgst_amount) + Number(inv.igst_amount))}</td><td><b>{money(inv.total_amount)}</b></td><td><span className="status-badge">{inv.status}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="quiet-button" onClick={() => printDoc('TAX INVOICE', inv, inv.company ?? company ?? {}, inv.clients?.client_name ?? '', inv.invoice_number)}>Print</button>{' '}{inv.status === 'Issued' && <button type="button" className="quiet-button" onClick={() => void cancel(inv)}>Cancel</button>}</td></tr>
          ))}
        </tbody></table></div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------- GST credit notes
export function SchoolCreditNotesPage() {
  const { rows, loading, error, reload, industryId } = useRows('/school/credit-notes');
  const invoices = useRows('/school/invoices');
  const [company, setCompany] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const [invoiceId, setInvoiceId] = useState(''); const [reason, setReason] = useState(''); const [qty, setQty] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState(''); const [message, setMessage] = useState(''); const [pageError, setPageError] = useState('');
  useEffect(() => { if (industryId) api<{ data: Row | null }>(`/school/company-profile?industryTypeId=${industryId}`).then((r) => setCompany(r.data)).catch(() => setCompany(null)); }, [industryId]);
  const invoice = invoices.rows.find((i) => i.id === invoiceId);
  async function save(e: FormEvent) {
    e.preventDefault(); setFormError('');
    try {
      const lines = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([i, v]) => ({ index: Number(i), quantity: Number(v) }));
      const res = await post<Row>('/school/credit-notes', { industryTypeId: industryId, invoiceId, reason, lines });
      setOpen(false); setMessage(`Credit note ${res.data.credit_note_number} issued. Record the matching return / refund on the sales order so the school balance is adjusted.`); await reload();
    } catch (err) { setFormError(messageOf(err, 'Unable to issue.')); }
  }
  async function cancel(cn: Row) {
    if (!window.confirm(`Cancel credit note ${cn.credit_note_number}?`)) return;
    setPageError('');
    try { await post(`/school/credit-notes/${cn.id}/cancel?industryTypeId=${industryId}`, {}); await reload(); } catch (err) { setPageError(messageOf(err, 'Unable to cancel.')); }
  }
  return (
    <Shell module="GST CREDIT NOTES" title="GST credit notes" description="The tax document for goods a school returns or damaged goods you credit. It reduces the GST in your register." error={error || pageError} message={message}
      actions={<button type="button" className="primary-action" onClick={() => { setInvoiceId(''); setReason(''); setQty({}); setFormError(''); setOpen(true); }}>New credit note</button>}>
      {rows.length === 0 ? <p className="empty-state">{loading ? 'Loading…' : 'No credit notes yet.'}</p> : (
        <table><thead><tr><th>Credit note</th><th>Date</th><th>School</th><th>Invoice</th><th>Reason</th><th>Total</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map((cn) => (
            <tr key={cn.id}><td>{cn.credit_note_number}</td><td>{cn.note_date}</td><td>{cn.clients?.client_name ?? '—'}</td><td>{cn.school_invoices?.invoice_number ?? '—'}</td><td>{cn.reason}</td><td><b>{money(cn.total_amount)}</b></td><td><span className="status-badge">{cn.status}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="quiet-button" onClick={() => printDoc('CREDIT NOTE', cn, company ?? {}, cn.clients?.client_name ?? '', cn.credit_note_number)}>Print</button>{' '}{cn.status === 'Issued' && <button type="button" className="quiet-button" onClick={() => void cancel(cn)}>Cancel</button>}</td></tr>
          ))}
        </tbody></table>
      )}
      {open && (
        <Modal title="New credit note" onClose={() => setOpen(false)}>
          <form className="master-modal-form" onSubmit={save}>
            <div className="field-grid">
              <label>Invoice *<select value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setQty({}); }}><option value="">Select invoice</option>{invoices.rows.filter((i) => i.status === 'Issued').map((i) => <option key={i.id} value={i.id}>{i.invoice_number} — {i.clients?.client_name}</option>)}</select></label>
              <label>Reason *<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged books returned" /></label>
            </div>
            {invoice && (
              <table><thead><tr><th>Product</th><th>Invoiced qty</th><th>Rate</th><th>Credit qty</th></tr></thead><tbody>
                {(invoice.lines as Row[]).map((l, i) => <tr key={i}><td>{l.product_name}</td><td>{l.quantity}</td><td>{money(l.rate)}</td><td><input type="number" min="0" max={l.quantity} step="any" style={{ width: 90 }} value={qty[i] ?? ''} onChange={(e) => setQty({ ...qty, [i]: e.target.value })} /></td></tr>)}
              </tbody></table>
            )}
            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary-action">Issue credit note</button></div>
          </form>
        </Modal>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------- Reports
export function SchoolReportsPage({ kind }: { kind: string }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const products = useProducts(activeIndustryTypeId);
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [productId, setProductId] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const load = useCallback(async () => {
    if (!activeIndustryTypeId) return;
    if (kind === 'stock-movements' && !productId) { setData(null); return; }
    setLoading(true); setError('');
    const q = new URLSearchParams({ industryTypeId: activeIndustryTypeId });
    if (kind === 'stock-movements') q.set('productId', productId);
    if (kind === 'gst-register') { if (from) q.set('from', from); if (to) q.set('to', to); }
    try { const res = await api<{ data: Row }>(`/school/reports/${kind}?${q.toString()}`); setData(res.data); } catch (e) { setError(messageOf(e, 'Unable to load the report.')); } finally { setLoading(false); }
  }, [activeIndustryTypeId, kind, productId, from, to]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const titles: Record<string, string> = { 'receivables-ageing': 'Receivables ageing', 'low-stock': 'Low stock', 'stock-movements': 'Stock movement register', 'gst-register': 'GST sales register' };
  return (
    <Shell module="REPORTS" title={titles[kind] ?? 'Report'} description={kind === 'stock-movements' ? 'Goods received and goods dispatched for one product. Manual inventory adjustments and return restocks are not included, so the running net is not the shelf balance.' : kind === 'gst-register' ? 'Issued invoices less credit notes for the period (default: this financial year).' : kind === 'receivables-ageing' ? 'Invoice total less returns credit and collections, bucketed by days past the due date.' : 'Products at or below their minimum stock level.'} error={error}
      actions={kind === 'stock-movements' ? <select value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Select product</option>{products.map((p) => <option key={p.id} value={p.id}>{p.product_code} — {p.product_name}</option>)}</select>
        : kind === 'gst-register' ? <><label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label> <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></> : undefined}>
      {loading && <p className="empty-state">Loading…</p>}
      {!loading && data && kind === 'receivables-ageing' && (<>
        <p>{Object.entries(data.buckets as Record<string, number>).map(([k, v]) => `${k}: ${money(v)}`).join('  ·  ')}  ·  <b>Total {money(data.total)}</b></p>
        {data.rows.length === 0 ? <p className="empty-state">No outstanding invoices.</p> : <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Invoice</th><th>School</th><th>Date</th><th>Due</th><th>Total</th><th>Outstanding</th><th>Days overdue</th><th>Bucket</th></tr></thead><tbody>
          {(data.rows as Row[]).map((r) => <tr key={r.invoice_number}><td>{r.invoice_number}</td><td>{r.client_name}</td><td>{r.invoice_date}</td><td>{r.due_date ?? '—'}</td><td>{money(r.total_amount)}</td><td><b>{money(r.outstanding)}</b></td><td>{r.days_overdue}</td><td>{r.bucket}</td></tr>)}
        </tbody></table></div>}</>)}
      {!loading && data && kind === 'low-stock' && (data.rows.length === 0 ? <p className="empty-state">Every product is above its minimum level (products without a minimum level are not checked).</p> : (
        <table><thead><tr><th>Code</th><th>Product</th><th>Stock</th><th>Minimum</th><th>Shortfall</th></tr></thead><tbody>
          {(data.rows as Row[]).map((r) => <tr key={r.product_code}><td>{r.product_code}</td><td>{r.product_name}</td><td>{r.stock_quantity} {r.unit ?? ''}</td><td>{r.min_stock_level}</td><td><b>{r.shortfall}</b></td></tr>)}
        </tbody></table>))}
      {!loading && data && kind === 'stock-movements' && (<>
        <p><b>{data.product.product_name}</b> · shelf stock now: {data.product.stock_quantity ?? 'not tracked'}</p>
        {data.rows.length === 0 ? <p className="empty-state">No receipts or dispatches for this product.</p> : <table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Qty</th><th>Running net</th></tr></thead><tbody>
          {(data.rows as Row[]).map((r, i) => <tr key={i}><td>{r.date ?? '—'}</td><td>{r.type}</td><td>{r.ref}</td><td>{r.quantity > 0 ? `+${r.quantity}` : r.quantity}</td><td>{r.running_net}</td></tr>)}
        </tbody></table>}</>)}
      {!loading && data && kind === 'gst-register' && (<>
        <p>{data.from} to {data.to} · Net taxable {money(data.net.taxable)} · CGST {money(data.net.cgst)} · SGST {money(data.net.sgst)} · IGST {money(data.net.igst)} · <b>Net total {money(data.net.total)}</b></p>
        <h3>Invoices ({data.invoices.length})</h3>
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Invoice</th><th>Date</th><th>School</th><th>GSTIN</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead><tbody>
          {(data.invoices as Row[]).map((r) => <tr key={r.invoice_number}><td>{r.invoice_number}</td><td>{r.invoice_date}</td><td>{r.clients?.client_name}</td><td>{r.clients?.gstin ?? '—'}</td><td>{money(r.taxable_amount)}</td><td>{money(r.cgst_amount)}</td><td>{money(r.sgst_amount)}</td><td>{money(r.igst_amount)}</td><td>{money(r.total_amount)}</td></tr>)}
        </tbody></table></div>
        <h3>Credit notes ({data.creditNotes.length})</h3>
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Credit note</th><th>Date</th><th>School</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead><tbody>
          {(data.creditNotes as Row[]).map((r) => <tr key={r.credit_note_number}><td>{r.credit_note_number}</td><td>{r.note_date}</td><td>{r.clients?.client_name}</td><td>{money(r.taxable_amount)}</td><td>{money(r.cgst_amount)}</td><td>{money(r.sgst_amount)}</td><td>{money(r.igst_amount)}</td><td>{money(r.total_amount)}</td></tr>)}
        </tbody></table></div></>)}
    </Shell>
  );
}
