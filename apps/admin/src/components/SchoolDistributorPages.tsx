/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { TextileMasterPage, TextileModuleConfig } from './TextileMasterPage';
import { PageShell, Row, messageOf, money, post, useProducts } from './schoolUi';


// School distributor back office: Company & GST, Suppliers, Reports. The working pages live in their own files and are
// re-exported at the bottom so App.tsx keeps importing everything from here.

// ---------------------------------------------------------------------------------------------- Company & GST
const STATE_BY_GST: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar',
  '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};
const COMPANY_FIELDS: { key: string; label: string; textarea?: boolean; placeholder?: string }[] = [
  { key: 'company_name', label: 'Company name *' }, { key: 'gstin', label: 'GSTIN', placeholder: '33AABCM1234F1Z4' }, { key: 'pan', label: 'PAN' },
  { key: 'invoice_prefix', label: 'Invoice prefix', placeholder: 'INV' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email (replies and supplier notices come here)' },
  { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'pincode', label: 'PIN code (6 digits)' },
  { key: 'bank_name', label: 'Bank name' }, { key: 'bank_account', label: 'Bank account no.' }, { key: 'bank_ifsc', label: 'IFSC' },
  { key: 'address', label: 'Address', textarea: true }, { key: 'terms', label: 'Terms & conditions (printed on invoice)', textarea: true },
];

export function SchoolCompanyPage() {
  const { activeIndustryTypeId } = useIndustryScope();
  const [form, setForm] = useState<Record<string, string>>({});
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => {
    if (!activeIndustryTypeId) return;
    api<{ data: Row | null }>(`/school/company-profile?industryTypeId=${activeIndustryTypeId}`).then((r) => {
      setForm(Object.fromEntries(COMPANY_FIELDS.map((f) => [f.key, String(r.data?.[f.key] ?? (f.key === 'invoice_prefix' ? 'INV' : ''))])));
      setAuto(r.data?.auto_invoice_on_dispatch !== false);
    }).catch((e) => setError(messageOf(e, 'Unable to load.')));
  }, [activeIndustryTypeId]);

  // Typing the GSTIN fills the PAN and the state by itself (they are part of the GSTIN).
  function setGstin(raw: string) {
    const gstin = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
    setForm((f) => ({ ...f, gstin, ...(gstin.length === 15 ? { pan: f.pan || gstin.slice(2, 12), state: f.state || STATE_BY_GST[gstin.slice(0, 2)] || '' } : {}) }));
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setError(''); setMessage('');
    try { await post('/school/company-profile', { ...form, auto_invoice_on_dispatch: auto, industryTypeId: activeIndustryTypeId }, 'PUT'); setMessage('Company & GST details saved.'); } catch (err) { setError(messageOf(err, 'Unable to save.')); }
  }
  return (
    <PageShell module="COMPANY & GST" title="Company & GST" description="Your own legal and bank details. They print on every invoice and purchase order, and decide CGST/SGST or IGST (from your state)." error={error} message={message}>
      <form className="master-modal-form" onSubmit={save}>
        <div className="field-grid">{COMPANY_FIELDS.map((f) => (
          <label key={f.key}>{f.label}{f.textarea ? <textarea value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} /> : <input placeholder={f.placeholder} value={form[f.key] ?? ''} onChange={(e) => (f.key === 'gstin' ? setGstin(e.target.value) : setForm({ ...form, [f.key]: e.target.value }))} />}</label>
        ))}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, flexDirection: 'row', flexShrink: 0 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span><b>Create the GST invoice automatically when an order is dispatched</b><br /><small>If a school has no state or GSTIN the order simply waits in GST Sales Invoices.</small></span>
        </label>
        <div className="modal-actions"><button type="submit" className="primary-action">Save</button></div>
      </form>
    </PageShell>
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
    { icon: '🏭', iconClass: 'kpi-icon-ink', label: 'Total suppliers', value: (r: Row[]) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active', value: (r: Row[]) => String(r.filter((x: Row) => x.status === 'Active').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Inactive', value: (r: Row[]) => String(r.filter((x: Row) => x.status === 'Inactive').length) },
  ],
};
export function SchoolSuppliersPage() { return <TextileMasterPage config={supplierConfig} />; }


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
    if (kind === 'gst-register' || kind === 'cash-book') { if (from) q.set('from', from); if (to) q.set('to', to); }
    try { const res = await api<{ data: Row }>(`/school/reports/${kind}?${q.toString()}`); setData(res.data); } catch (e) { setError(messageOf(e, 'Unable to load the report.')); } finally { setLoading(false); }
  }, [activeIndustryTypeId, kind, productId, from, to]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const titles: Record<string, string> = { 'receivables-ageing': 'Receivables ageing', 'low-stock': 'Low stock', 'stock-movements': 'Stock movement register', 'gst-register': 'GST sales register', 'cash-book': 'Cash & bank book' };
  return (
    <PageShell module="REPORTS" title={titles[kind] ?? 'Report'} description={kind === 'stock-movements' ? 'Goods received and goods dispatched for one product. Manual inventory adjustments and return restocks are not included, so the running net is not the shelf balance.' : kind === 'gst-register' ? 'Issued invoices less credit notes for the period (default: this financial year).' : kind === 'receivables-ageing' ? 'Invoice total less returns credit and collections, bucketed by days past the due date.' : kind === 'cash-book' ? 'Money received from schools against money paid to suppliers, by payment mode (default: this month).' : 'Products at or below their minimum stock level.'} error={error}
      actions={kind === 'stock-movements' ? <select value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Select product</option>{products.map((p) => <option key={p.id} value={p.id}>{p.product_code} — {p.product_name}</option>)}</select>
        : (kind === 'gst-register' || kind === 'cash-book') ? <><label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label> <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></> : undefined}>
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
      {!loading && data && kind === 'cash-book' && (<>
        <p>{data.from} to {data.to} · Received {money(data.totals.in)} · Paid out {money(data.totals.out)} · <b>Net {money(data.totals.net)}</b></p>
        <table><thead><tr><th>Mode</th><th style={{ textAlign: 'right' }}>Received</th><th style={{ textAlign: 'right' }}>Paid out</th><th style={{ textAlign: 'right' }}>Net</th></tr></thead><tbody>
          {(data.by_mode as Row[]).map((r) => <tr key={r.mode}><td>{r.mode}</td><td style={{ textAlign: 'right' }}>{money(r.in)}</td><td style={{ textAlign: 'right' }}>{money(r.out)}</td><td style={{ textAlign: 'right' }}><b>{money(r.net)}</b></td></tr>)}
        </tbody></table>
        <h3>Received from schools ({data.receipts.length})</h3>
        {data.receipts.length === 0 ? <p className="empty-state">No collections in this period.</p> : <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Date</th><th>School</th><th>Order</th><th>Mode</th><th>Reference</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead><tbody>
          {(data.receipts as Row[]).map((r) => <tr key={r.id}><td>{String(r.collected_at).slice(0, 10)}</td><td>{r.clients?.client_name}</td><td>{r.sale_orders?.order_number ?? '—'}</td><td>{r.mode}</td><td>{r.reference_no ?? '—'}</td><td style={{ textAlign: 'right' }}>{money(r.amount)}</td></tr>)}
        </tbody></table></div>}
        <h3>Paid to suppliers ({data.payments.length})</h3>
        {data.payments.length === 0 ? <p className="empty-state">No supplier payments in this period.</p> : <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Date</th><th>Payment</th><th>Supplier</th><th>Against</th><th>Mode</th><th>Reference</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead><tbody>
          {(data.payments as Row[]).map((r) => <tr key={r.id}><td>{String(r.payment_date).slice(0, 10)}</td><td>{r.payment_number}</td><td>{r.school_suppliers?.supplier_name}</td><td>{r.school_grns?.grn_number ?? 'Oldest bills first'}</td><td>{r.mode ?? '—'}</td><td>{r.reference_no ?? '—'}</td><td style={{ textAlign: 'right' }}>{money(r.amount)}</td></tr>)}
        </tbody></table></div>}</>)}
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
    </PageShell>
  );
}

// ---------------------------------------------------------------------------------------------- working pages (own files)
export { SchoolGrnPage } from './SchoolGrnPage';
export { SchoolSupplierPaymentsPage } from './SchoolSupplierPaymentsPage';
export { SchoolInvoicesPage } from './SchoolInvoicesPage';
export { SchoolCreditNotesPage } from './SchoolCreditNotesPage';