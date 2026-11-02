/* eslint-disable @typescript-eslint/no-explicit-any */
// Pharma Distributor / Wholesaler pages. Same look as the other Pharma modules (page-panel, KPI cards, toolbar, table, modal).
// Company & GST, Suppliers, Purchase Orders, GRN, Stock Ledger, Scan, GST Invoices, Purchase Returns, Supplier Payments,
// Customer Outstanding & Ageing, Reports. Own API routes under /pharma/*; used only when the Pharma industry is active.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';

type Row = Record<string, any>;
const money = (v: unknown) => `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (v: unknown) => `₹${Math.round(Number(v ?? 0)).toLocaleString('en-IN')}`;
const d10 = (v: unknown) => (v ? String(v).slice(0, 10) : '—');
const dShow = (v: unknown) => { if (!v) return '—'; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };
const msgOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const todayStr = () => new Date().toISOString().slice(0, 10);
const thisMonth = (v: unknown) => String(v ?? '').slice(0, 7) === todayStr().slice(0, 7);

const GOOD = new Set(['active', 'received', 'posted', 'issued', 'paid', 'valid', 'sellable']);
const BAD = new Set(['inactive', 'cancelled', 'expired', 'blocked']);
const WATCH = new Set(['draft', 'partially received']);
const MOVING = new Set(['ordered']);
const badge = (s?: string) => { const k = String(s ?? '').trim().toLowerCase(); return GOOD.has(k) ? 'status-badge status-completed' : BAD.has(k) ? 'status-badge inactive' : WATCH.has(k) ? 'status-badge status-quoted' : MOVING.has(k) ? 'status-badge status-new' : 'status-badge'; };

const EXTRA_CSS = `
.pd-lines{width:100%;border-collapse:collapse;font-size:.82rem}
.pd-lines th{text-align:left;padding:.35rem .4rem;font-size:.7rem;letter-spacing:.04em;text-transform:uppercase;opacity:.65;white-space:nowrap}
.pd-lines td{padding:.25rem;vertical-align:top}
.pd-lines input,.pd-lines select{width:100%;min-width:92px;padding:.5rem;border:1px solid var(--line,#d9dde3);border-radius:8px;font:inherit;background:var(--surface,#fff);color:inherit}
.pd-scroll{overflow-x:auto}
.pd-total{display:flex;justify-content:flex-end;gap:1.2rem;font-weight:600;padding:.6rem .2rem}
.pd-tabs{display:flex;gap:.45rem;flex-wrap:wrap;margin:0 0 .9rem}
.pd-tabs button.on{background:var(--ink,#10151f);color:#f5f3ec;border-color:var(--ink,#10151f)}
.pd-scan video{width:100%;max-height:280px;border-radius:12px;background:#000;margin-top:.7rem}
.pd-muted{opacity:.7;font-size:.85rem}
.pd-over{color:var(--red,#c0392b);font-weight:600}
`;

type Kpi = { label: string; value: ReactNode; sub?: string; icon: string; tone?: 'ink' | 'blue' | 'amber' | 'green' | 'red' };
function Page({ eyebrow, title, desc, kpis, toolbar, error, notice, children }: { eyebrow: string; title: string; desc: string; kpis?: Kpi[]; toolbar?: ReactNode; error?: string; notice?: string; children: ReactNode }) {
  return (
    <section className="page-panel master-page">
      <style>{EXTRA_CSS}</style>
      <div className="page-panel-heading"><div><p className="eyebrow">PHARMA · {eyebrow}</p><h2>{title}</h2><p>{desc}</p></div></div>
      {kpis && kpis.length > 0 && (
        <div className="kpi-grid" style={{ '--kpi-count': kpis.length } as CSSProperties}>
          {kpis.map((k) => <div className="kpi-card" data-tone={k.tone ?? 'ink'} key={k.label}><div className="kpi-icon">{k.icon}</div><div><span>{k.label}</span><strong>{k.value}</strong>{k.sub && <small>{k.sub}</small>}</div></div>)}
        </div>
      )}
      {toolbar}
      {error && <p className="error-message">{error}</p>}
      {notice && <p className="success-message">{notice}</p>}
      {children}
    </section>
  );
}
function Toolbar({ search, setSearch, label, statuses, status, setStatus, onAdd, addLabel, extra }: { search: string; setSearch: (v: string) => void; label: string; statuses?: string[]; status?: string; setStatus?: (v: string) => void; onAdd?: () => void; addLabel?: string; extra?: ReactNode }) {
  return (
    <div className="master-toolbar">
      <div className="master-search">
        <input type="search" placeholder={`Search ${label}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        {statuses && setStatus && <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{statuses.map((s) => <option key={s} value={s.toLowerCase()}>{s}</option>)}</select>}
        {extra}
      </div>
      {onAdd && <button className="primary-action" type="button" onClick={onAdd}>{addLabel ?? '+ Add'}</button>}
    </div>
  );
}
type Col = { key: string; label: string; render?: (r: Row) => ReactNode; right?: boolean };
function Table({ cols, rows, loading, emptyText, emptyIcon, onAdd, addLabel, hasAny = true }: { cols: Col[]; rows: Row[]; loading?: boolean; emptyText?: string; emptyIcon?: string; onAdd?: () => void; addLabel?: string; hasAny?: boolean }) {
  return (
    <div className="data-table-wrap">
      <table>
        <thead><tr>{cols.map((c) => <th key={c.key} style={c.right ? { textAlign: 'right' } : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {loading && rows.length === 0 && [0, 1, 2].map((i) => <tr key={i} className="skeleton-row">{cols.map((c) => <td key={c.key}><span className="skeleton-block" style={{ width: '60%' }} /></td>)}</tr>)}
          {rows.map((r, i) => <tr key={String(r.id ?? i)}>{cols.map((c) => <td key={c.key} style={c.right ? { textAlign: 'right' } : undefined}>{c.render ? c.render(r) : (r[c.key] != null && r[c.key] !== '' ? String(r[c.key]) : '—')}</td>)}</tr>)}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={cols.length} className="empty-row"><div className="empty-state"><span className="empty-state-icon">{emptyIcon ?? '▤'}</span>
              <p>{hasAny ? 'No records match your search or filters.' : (emptyText ?? 'No records yet.')}</p>
              {!hasAny && onAdd && <button type="button" className="primary-action" onClick={onAdd}>{addLabel ?? '+ Add'}</button>}</div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
const Status = ({ s }: { s: string }) => <span className={badge(s)}>{s}</span>;
function Dialog({ eyebrow, title, onClose, children, wide }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`master-modal${wide ? ' master-modal--wide' : ''}`} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()} style={wide ? { width: 'min(1120px,100vw)' } : undefined}>
        <div className="modal-heading"><div><p className="eyebrow">PHARMA · {eyebrow}</p><h3>{title}</h3></div><button className="icon-action" type="button" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="master-modal-form">{children}</div>
      </div>
    </div>
  );
}
const Actions = ({ onCancel, onSave, saving, label }: { onCancel: () => void; onSave: () => void; saving?: boolean; label: string }) => (
  <div className="modal-actions"><button type="button" className="quiet-button" onClick={onCancel} disabled={saving}>Cancel</button><button type="button" className="primary-action" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : label}</button></div>
);

function useIndustryId() { return useIndustryScope().activeIndustryTypeId; }
function useList(path: string, it: string | null) {
  const [rows, setRows] = useState<Row[]>([]); const [err, setErr] = useState(''); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!it) return; setLoading(true);
    try { const r = await api<{ data: Row[] }>(`${path}${path.includes('?') ? '&' : '?'}industryTypeId=${encodeURIComponent(it)}`); setRows(r.data ?? []); setErr(''); }
    catch (e) { setErr(msgOf(e)); } finally { setLoading(false); }
  }, [path, it]);
  useEffect(() => { void load(); }, [load]);
  return { rows, err, loading, reload: load, setErr };
}
const send = (method: string, path: string, body?: unknown) => api<{ data: Row }>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
function useProducts(it: string | null) {
  const [products, setProducts] = useState<Row[]>([]);
  useEffect(() => { if (!it) return; api<{ data: Row[] }>(`/products?industryTypeId=${encodeURIComponent(it)}`).then((r) => setProducts(r.data ?? [])).catch(() => setProducts([])); }, [it]);
  return products;
}
function useFiltered(rows: Row[], search: string, status: string, keys?: string[]) {
  return useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (status === 'all' || String(r.status ?? '').toLowerCase() === status) && (!q || JSON.stringify(keys ? keys.map((k) => k.split('.').reduce((a: any, p) => a?.[p], r)) : Object.values(r)).toLowerCase().includes(q)));
  }, [rows, search, status, keys]);
}
const Loading = () => <section className="page-panel master-page"><p>Loading the Pharma workspace…</p></section>;

// ---------------------------------------------------------------- barcode scan input (USB / Bluetooth scanner, typing, or phone camera)
export function ScanInput({ onScan, placeholder }: { onScan: (code: string) => void; placeholder?: string }) {
  const [text, setText] = useState(''); const [camera, setCamera] = useState(false); const [camErr, setCamErr] = useState('');
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!camera) return;
    let stop = false; let stream: MediaStream | null = null; let timer = 0;
    (async () => {
      try {
        const Detector = (window as any).BarcodeDetector;
        if (!Detector) { setCamErr('This browser cannot scan with the camera. Use Chrome on Android, or a USB / Bluetooth scanner (it types into the box).'); setCamera(false); return; }
        const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'data_matrix', 'itf'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        const tick = async () => {
          if (stop || !video.current) return;
          try { const found = await detector.detect(video.current); if (found.length) { setCamera(false); onScan(String(found[0].rawValue)); return; } } catch { /* keep trying */ }
          timer = window.setTimeout(tick, 300);
        };
        void tick();
      } catch (e) { setCamErr(msgOf(e)); setCamera(false); }
    })();
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [camera, onScan]);
  return (
    <div className="pd-scan">
      <div className="master-toolbar" style={{ margin: 0 }}>
        <div className="master-search"><input autoFocus value={text} placeholder={placeholder ?? 'Scan barcode or type product code, then press Enter'} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { e.preventDefault(); onScan(text.trim()); setText(''); } }} /></div>
        <button type="button" className="quiet-button" onClick={() => { setCamErr(''); setCamera((c) => !c); }}>{camera ? 'Stop camera' : '📷 Scan with camera'}</button>
      </div>
      {camErr && <p className="error-message">{camErr}</p>}
      {camera && <video ref={video} muted playsInline />}
    </div>
  );
}

// ---------------------------------------------------------------- Company & GST
export function PharmaCompanyPage() {
  const it = useIndustryId(); const [f, setF] = useState<Row>({ invoice_prefix: 'INV' }); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!it) return; api<{ data: Row | null }>(`/pharma/company?industryTypeId=${it}`).then((r) => { if (r.data) setF(r.data); }).catch((e) => setErr(msgOf(e))); }, [it]);
  if (!it) return <Loading />;
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => { setErr(''); setOk(''); setSaving(true); try { const r = await send('PUT', '/pharma/company', { ...f, industryTypeId: it }); setF(r.data); setOk('Company details saved successfully. They print on every GST invoice.'); } catch (e) { setErr(msgOf(e)); } finally { setSaving(false); } };
  const fld = (k: string, label: string, ph = '', req = false) => <label>{label}{req ? ' *' : ''}<input value={f[k] ?? ''} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></label>;
  return (
    <Page eyebrow="COMPANY & GST" title="Company & GST" desc="Your distributor details. Your GSTIN state decides CGST + SGST (same state) or IGST (other state) on every invoice." error={err} notice={ok}>
      <div className="master-modal-form" style={{ maxWidth: 980 }}>
        <fieldset className="modal-fieldset"><legend>Business details</legend><div className="fieldset-grid">{fld('company_name', 'Company name', '', true)}{fld('gstin', 'GSTIN', '33AAAAA0000A1Z5')}{fld('drug_license_number', 'Drug licence number')}{fld('state', 'State', 'Tamil Nadu')}{fld('phone', 'Phone')}{fld('invoice_prefix', 'Invoice prefix', 'INV')}</div></fieldset>
        <fieldset className="modal-fieldset"><legend>Printed on invoice</legend><div className="fieldset-grid">
          <label>Address<textarea rows={3} value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></label>
          <label>Bank details<textarea rows={3} value={f.bank_details ?? ''} onChange={(e) => set('bank_details', e.target.value)} /></label>
          <label>Terms & conditions<textarea rows={3} value={f.terms ?? ''} onChange={(e) => set('terms', e.target.value)} /></label></div></fieldset>
        <div className="modal-actions"><button type="button" className="primary-action" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save company details'}</button></div>
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- Suppliers
export function PharmaSuppliersPage() {
  const it = useIndustryId(); const { rows, err, loading, reload, setErr } = useList('/pharma/suppliers', it);
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all'); const [edit, setEdit] = useState<Row | null>(null); const [f, setF] = useState<Row>({}); const [saving, setSaving] = useState(false); const [fe, setFe] = useState('');
  const shown = useFiltered(rows, search, status, ['supplier_code', 'supplier_name', 'gstin', 'phone', 'city']);
  if (!it) return <Loading />;
  const expiring = rows.filter((r) => r.drug_license_valid_till && String(r.drug_license_valid_till).slice(0, 10) <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).length;
  const open = (r: Row | null) => { setEdit(r ?? {}); setF(r ? { ...r } : { status: 'active', payment_terms_days: 30 }); setFe(''); };
  const save = async () => { setSaving(true); setFe(''); try { if (edit?.id) await send('PATCH', `/pharma/suppliers/${edit.id}`, f); else await send('POST', '/pharma/suppliers', { ...f, industryTypeId: it }); setEdit(null); await reload(); } catch (e) { setFe(msgOf(e)); } finally { setSaving(false); } };
  const del = async (r: Row) => { if (!window.confirm(`Delete supplier ${r.supplier_name}?`)) return; try { await send('DELETE', `/pharma/suppliers/${r.id}`); await reload(); } catch (e) { setErr(msgOf(e)); } };
  const fld = (k: string, label: string, type = 'text', req = false) => <label>{label}{req ? ' *' : ''}<input type={type} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <Page eyebrow="SUPPLIER MANAGEMENT" title="Supplier Management" desc="Manufacturers, stockists and companies you buy medicines from." error={err}
      kpis={[{ label: 'Suppliers', value: rows.length, sub: 'all', icon: '🏭' }, { label: 'Active', value: rows.filter((r) => r.status === 'active').length, sub: 'can receive orders', icon: '✓', tone: 'green' }, { label: 'Inactive', value: rows.filter((r) => r.status === 'inactive').length, sub: 'blocked for new orders', icon: '⏸', tone: 'amber' }, { label: 'Licence expiring', value: expiring, sub: 'within 30 days or expired', icon: '⚠', tone: 'red' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="suppliers" statuses={['Active', 'Inactive']} status={status} setStatus={setStatus} onAdd={() => open(null)} addLabel="+ Add supplier" />}>
      <Table loading={loading} rows={shown} hasAny={rows.length > 0} emptyIcon="🏭" emptyText="No suppliers yet. Add your first supplier to start purchasing." onAdd={() => open(null)} addLabel="+ Add supplier"
        cols={[{ key: 'supplier_code', label: 'Code' }, { key: 'supplier_name', label: 'Supplier' }, { key: 'gstin', label: 'GSTIN' }, { key: 'phone', label: 'Phone' }, { key: 'city', label: 'City' }, { key: 'payment_terms_days', label: 'Terms (days)' }, { key: 'drug_license_valid_till', label: 'Licence valid till', render: (r) => dShow(r.drug_license_valid_till) }, { key: 'status', label: 'Status', render: (r) => <Status s={r.status} /> },
          { key: 'a', label: 'Actions', render: (r) => <div className="master-actions-inner"><button type="button" className="quiet-button" onClick={() => open(r)}>Edit</button><button type="button" className="quiet-button" onClick={() => void del(r)}>Delete</button></div> }]} />
      {edit && <Dialog eyebrow="SUPPLIER MANAGEMENT" title={edit.id ? 'Edit supplier' : 'Add supplier'} onClose={() => setEdit(null)}>
        {fe && <p role="alert" className="error">{fe}</p>}
        <fieldset className="modal-fieldset"><legend>Supplier details</legend><div className="fieldset-grid">{fld('supplier_name', 'Supplier name', 'text', true)}{fld('contact_person', 'Contact person')}{fld('phone', 'Phone')}{fld('email', 'Email', 'email')}{fld('city', 'City')}{fld('state', 'State')}</div></fieldset>
        <fieldset className="modal-fieldset"><legend>Compliance & terms</legend><div className="fieldset-grid">{fld('gstin', 'GSTIN')}{fld('drug_license_number', 'Drug licence number')}{fld('drug_license_valid_till', 'Licence valid till', 'date')}{fld('payment_terms_days', 'Payment terms (days)', 'number')}
          <label>Status<select value={f.status ?? 'active'} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div>
          <label>Address<textarea rows={2} value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></label></fieldset>
        <Actions onCancel={() => setEdit(null)} onSave={() => void save()} saving={saving} label={edit.id ? 'Save changes' : 'Add supplier'} />
      </Dialog>}
    </Page>
  );
}

// ---------------------------------------------------------------- Purchase Orders
const PO_STATUSES = ['Draft', 'Ordered', 'Partially Received', 'Received', 'Cancelled'];
export function PharmaPurchaseOrdersPage() {
  const it = useIndustryId(); const { rows, err, loading, reload, setErr } = useList('/pharma/purchase-orders', it);
  const sup = useList('/pharma/suppliers', it); const products = useProducts(it);
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false); const [f, setF] = useState<Row>({}); const [lines, setLines] = useState<Row[]>([{}]); const [saving, setSaving] = useState(false); const [fe, setFe] = useState(''); const [view, setView] = useState<Row | null>(null);
  const shown = useFiltered(rows, search, status, ['po_number', 'pharma_suppliers.supplier_name', 'status']);
  const total = useMemo(() => lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.rate || 0) * (1 + Number(l.gst_percent || 0) / 100), 0), [lines]);
  if (!it) return <Loading />;
  const openRows = rows.filter((r) => ['Ordered', 'Partially Received'].includes(r.status));
  const pick = (i: number, code: string) => { const p = products.find((x) => x.product_code === code); setLines((ls) => ls.map((l, j) => j === i ? { ...l, product_code: code, rate: l.rate || p?.cost_price || '', gst_percent: l.gst_percent || p?.tax_percent || '' } : l)); };
  const setL = (i: number, k: string, v: string) => setLines((ls) => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const save = async (st: string) => { setSaving(true); setFe(''); try { await send('POST', '/pharma/purchase-orders', { ...f, status: st, lines, industryTypeId: it }); setOpen(false); await reload(); } catch (e) { setFe(msgOf(e)); } finally { setSaving(false); } };
  const act = async (r: Row, st: string) => { try { await send('PATCH', `/pharma/purchase-orders/${r.id}`, { status: st }); await reload(); } catch (e) { setErr(msgOf(e)); } };
  const del = async (r: Row) => { if (!window.confirm(`Delete ${r.po_number}?`)) return; try { await send('DELETE', `/pharma/purchase-orders/${r.id}`); await reload(); } catch (e) { setErr(msgOf(e)); } };
  const addNew = () => { setF({ order_date: todayStr() }); setLines([{}]); setFe(''); setOpen(true); };
  return (
    <Page eyebrow="PURCHASE ORDERS" title="Purchase Orders" desc="Order stock from suppliers. Goods are received against a purchase order in Goods Receipt (GRN)." error={err}
      kpis={[{ label: 'Purchase orders', value: rows.length, sub: 'all time', icon: '🧾' }, { label: 'Awaiting goods', value: openRows.length, sub: 'ordered / partly received', icon: '⏳', tone: 'amber' }, { label: 'Received', value: rows.filter((r) => r.status === 'Received').length, sub: 'completed', icon: '✓', tone: 'green' }, { label: 'Open order value', value: money0(openRows.reduce((s, r) => s + Number(r.total_amount), 0)), sub: 'incl. GST', icon: '₹', tone: 'blue' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="purchase orders" statuses={PO_STATUSES} status={status} setStatus={setStatus} onAdd={addNew} addLabel="+ Add purchase order" />}>
      <Table loading={loading} rows={shown} hasAny={rows.length > 0} emptyIcon="🧾" emptyText="No purchase orders yet. Create one to order stock from a supplier." onAdd={addNew} addLabel="+ Add purchase order"
        cols={[{ key: 'po_number', label: 'PO no.' }, { key: 's', label: 'Supplier', render: (r) => r.pharma_suppliers?.supplier_name ?? '—' }, { key: 'order_date', label: 'Date', render: (r) => dShow(r.order_date) }, { key: 'expected_date', label: 'Expected', render: (r) => dShow(r.expected_date) },
          { key: 'q', label: 'Received / ordered', render: (r) => `${(r.lines ?? []).reduce((s: number, l: Row) => s + Number(l.received_quantity || 0), 0)} / ${(r.lines ?? []).reduce((s: number, l: Row) => s + Number(l.quantity || 0), 0)}` },
          { key: 'total_amount', label: 'Total', right: true, render: (r) => money(r.total_amount) }, { key: 'status', label: 'Status', render: (r) => <Status s={r.status} /> },
          { key: 'a', label: 'Actions', render: (r) => <div className="master-actions-inner"><button type="button" className="quiet-button" onClick={() => setView(r)}>View</button>{r.status === 'Draft' && <button type="button" className="quiet-button" onClick={() => void act(r, 'Ordered')}>Mark ordered</button>}{['Draft', 'Ordered'].includes(r.status) && <button type="button" className="quiet-button" onClick={() => void act(r, 'Cancelled')}>Cancel</button>}{r.status === 'Draft' && <button type="button" className="quiet-button" onClick={() => void del(r)}>Delete</button>}</div> }]} />
      {view && <Dialog eyebrow="PURCHASE ORDERS" title={`${view.po_number} · ${view.pharma_suppliers?.supplier_name ?? ''}`} onClose={() => setView(null)} wide>
        <div className="data-table-wrap"><table><thead><tr><th>Product</th><th>Ordered</th><th>Received</th><th>Rate</th><th>GST %</th></tr></thead><tbody>{(view.lines ?? []).map((l: Row, i: number) => <tr key={i}><td>{l.product_name}</td><td>{l.quantity}</td><td>{l.received_quantity}</td><td>{money(l.rate)}</td><td>{l.gst_percent}%</td></tr>)}</tbody></table></div>
        <div className="pd-total"><span>Subtotal {money(view.subtotal)}</span><span>GST {money(view.tax_amount)}</span><span>Total {money(view.total_amount)}</span></div>
      </Dialog>}
      {open && <Dialog eyebrow="PURCHASE ORDERS" title="Add purchase order" onClose={() => setOpen(false)} wide>
        {fe && <p role="alert" className="error">{fe}</p>}
        <fieldset className="modal-fieldset"><legend>Order details</legend><div className="fieldset-grid">
          <label>Supplier *<select value={f.supplier_id ?? ''} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}><option value="">Select supplier…</option>{sup.rows.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}</select></label>
          <label>Order date<input type="date" value={f.order_date ?? ''} onChange={(e) => setF({ ...f, order_date: e.target.value })} /></label>
          <label>Expected delivery<input type="date" value={f.expected_date ?? ''} onChange={(e) => setF({ ...f, expected_date: e.target.value })} /></label>
          <label>Notes<input value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label></div></fieldset>
        <fieldset className="modal-fieldset"><legend>Items</legend><div className="pd-scroll"><table className="pd-lines"><thead><tr><th>Product</th><th>Quantity</th><th>Rate</th><th>GST %</th><th>Amount</th><th /></tr></thead><tbody>
          {lines.map((l, i) => <tr key={i}>
            <td style={{ minWidth: 260 }}><select value={l.product_code ?? ''} onChange={(e) => pick(i, e.target.value)}><option value="">Select product…</option>{products.map((p) => <option key={p.id} value={p.product_code}>{p.product_code} · {p.product_name}</option>)}</select></td>
            <td><input type="number" min="0" value={l.quantity ?? ''} onChange={(e) => setL(i, 'quantity', e.target.value)} /></td>
            <td><input type="number" min="0" step="0.01" value={l.rate ?? ''} onChange={(e) => setL(i, 'rate', e.target.value)} /></td>
            <td><input type="number" min="0" step="0.01" value={l.gst_percent ?? ''} onChange={(e) => setL(i, 'gst_percent', e.target.value)} /></td>
            <td style={{ whiteSpace: 'nowrap', paddingTop: '.7rem' }}>{money(Number(l.quantity || 0) * Number(l.rate || 0) * (1 + Number(l.gst_percent || 0) / 100))}</td>
            <td><button type="button" className="quiet-button" aria-label="Remove line" onClick={() => setLines((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)}>✕</button></td></tr>)}
        </tbody></table></div>
          <p><button type="button" className="quiet-button" onClick={() => setLines((ls) => [...ls, {}])}>+ Add item</button></p>
          <div className="pd-total"><span>Order total incl. GST: {money(total)}</span></div></fieldset>
        <div className="modal-actions"><button type="button" className="quiet-button" disabled={saving} onClick={() => setOpen(false)}>Cancel</button><button type="button" className="quiet-button" disabled={saving} onClick={() => void save('Draft')}>Save as draft</button><button type="button" className="primary-action" disabled={saving} onClick={() => void save('Ordered')}>{saving ? 'Saving…' : 'Save & mark ordered'}</button></div>
      </Dialog>}
    </Page>
  );
}

// ---------------------------------------------------------------- GRN
export function PharmaGrnPage() {
  const it = useIndustryId(); const { rows, err, loading, reload } = useList('/pharma/grn', it);
  const sup = useList('/pharma/suppliers', it); const pos = useList('/pharma/purchase-orders', it); const products = useProducts(it);
  const [search, setSearch] = useState(''); const [open, setOpen] = useState(false); const [f, setF] = useState<Row>({}); const [lines, setLines] = useState<Row[]>([]); const [view, setView] = useState<Row | null>(null); const [saving, setSaving] = useState(false); const [fe, setFe] = useState('');
  const shown = useFiltered(rows, search, 'all', ['grn_number', 'pharma_suppliers.supplier_name', 'supplier_invoice_no']);
  if (!it) return <Loading />;
  const month = rows.filter((r) => thisMonth(r.grn_date));
  const units = month.reduce((s, r) => s + (r.lines ?? []).reduce((a: number, l: Row) => a + Number(l.quantity || 0) + Number(l.free_quantity || 0), 0), 0);
  const openPos = pos.rows.filter((p) => p.supplier_id === f.supplier_id && ['Ordered', 'Partially Received'].includes(p.status));
  const loadPo = (poId: string) => {
    const po = pos.rows.find((p) => p.id === poId); setF((x) => ({ ...x, po_id: poId }));
    if (po) setLines((po.lines as Row[]).filter((l) => Number(l.quantity) > Number(l.received_quantity || 0)).map((l) => ({ product_code: l.product_code, quantity: Number(l.quantity) - Number(l.received_quantity || 0), rate: l.rate, gst_percent: l.gst_percent })));
  };
  const setL = (i: number, k: string, v: string) => setLines((ls) => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const onScan = async (code: string) => {
    try { const r = await api<{ data: Row | null }>(`/pharma/scan?code=${encodeURIComponent(code)}&industryTypeId=${it}`);
      if (!r.data?.product) { setFe(`Code ${code} is not linked to a product. Link it first in Scan & Barcodes.`); return; }
      const p = r.data.product as Row; setFe('');
      setLines((ls) => [...ls, { product_code: p.product_code, quantity: '', rate: p.cost_price ?? '', gst_percent: p.tax_percent ?? '' }]);
    } catch (e) { setFe(msgOf(e)); }
  };
  const save = async () => { setSaving(true); setFe(''); try { await send('POST', '/pharma/grn', { ...f, lines, industryTypeId: it }); setOpen(false); await Promise.all([reload(), pos.reload()]); } catch (e) { setFe(msgOf(e)); } finally { setSaving(false); } };
  const addNew = () => { setF({ grn_date: todayStr() }); setLines([]); setFe(''); setOpen(true); };
  return (
    <Page eyebrow="GOODS RECEIPT (GRN)" title="Goods Receipt (GRN)" desc="Receiving goods creates the batch (or tops it up) with manufacture and expiry dates and adds the stock." error={err}
      kpis={[{ label: 'GRNs this month', value: month.length, sub: `${rows.length} in total`, icon: '📥' }, { label: 'Units received', value: units.toLocaleString('en-IN'), sub: 'this month incl. free', icon: '▦', tone: 'green' }, { label: 'Purchase value', value: money0(month.reduce((s, r) => s + Number(r.total_amount), 0)), sub: 'this month incl. GST', icon: '₹', tone: 'blue' }, { label: 'Open POs', value: pos.rows.filter((p) => ['Ordered', 'Partially Received'].includes(p.status)).length, sub: 'awaiting goods', icon: '⏳', tone: 'amber' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="GRNs" onAdd={addNew} addLabel="+ Add GRN" />}>
      <Table loading={loading} rows={shown} hasAny={rows.length > 0} emptyIcon="📥" emptyText="No goods received yet. Post a GRN when stock arrives." onAdd={addNew} addLabel="+ Add GRN"
        cols={[{ key: 'grn_number', label: 'GRN no.' }, { key: 's', label: 'Supplier', render: (r) => r.pharma_suppliers?.supplier_name ?? '—' }, { key: 'grn_date', label: 'Date', render: (r) => dShow(r.grn_date) }, { key: 'supplier_invoice_no', label: 'Supplier invoice' }, { key: 'n', label: 'Items', render: (r) => (r.lines ?? []).length }, { key: 'total_amount', label: 'Total', right: true, render: (r) => money(r.total_amount) }, { key: 'status', label: 'Status', render: (r) => <Status s={r.status} /> },
          { key: 'a', label: 'Actions', render: (r) => <button type="button" className="quiet-button" onClick={() => setView(r)}>View</button> }]} />
      {view && <Dialog eyebrow="GOODS RECEIPT (GRN)" title={`${view.grn_number} · ${view.pharma_suppliers?.supplier_name ?? ''}`} onClose={() => setView(null)} wide>
        <div className="data-table-wrap"><table><thead><tr><th>Product</th><th>Batch</th><th>Mfg</th><th>Expiry</th><th>Qty</th><th>Free</th><th>Rate</th><th>GST %</th></tr></thead><tbody>{(view.lines ?? []).map((l: Row, i: number) => <tr key={i}><td>{l.product_name}</td><td>{l.batch_number}</td><td>{dShow(l.manufacture_date)}</td><td>{dShow(l.expiry_date)}</td><td>{l.quantity}</td><td>{l.free_quantity || 0}</td><td>{money(l.rate)}</td><td>{l.gst_percent}%</td></tr>)}</tbody></table></div>
      </Dialog>}
      {open && <Dialog eyebrow="GOODS RECEIPT (GRN)" title="Add goods receipt" onClose={() => setOpen(false)} wide>
        {fe && <p role="alert" className="error">{fe}</p>}
        <fieldset className="modal-fieldset"><legend>Receipt details</legend><div className="fieldset-grid">
          <label>Supplier *<select value={f.supplier_id ?? ''} onChange={(e) => { setF({ ...f, supplier_id: e.target.value, po_id: '' }); setLines([]); }}><option value="">Select supplier…</option>{sup.rows.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}</select></label>
          <label>Against purchase order<select value={f.po_id ?? ''} onChange={(e) => loadPo(e.target.value)}><option value="">Direct receipt (no PO)</option>{openPos.map((p) => <option key={p.id} value={p.id}>{p.po_number}</option>)}</select></label>
          <label>Received date<input type="date" value={f.grn_date ?? ''} onChange={(e) => setF({ ...f, grn_date: e.target.value })} /></label>
          <label>Supplier invoice no.<input value={f.supplier_invoice_no ?? ''} onChange={(e) => setF({ ...f, supplier_invoice_no: e.target.value })} /></label></div></fieldset>
        <fieldset className="modal-fieldset"><legend>Received items</legend>
          <ScanInput onScan={(c) => void onScan(c)} placeholder="Scan a product barcode to add an item" />
          <div className="pd-scroll" style={{ marginTop: '.8rem' }}><table className="pd-lines"><thead><tr><th>Product</th><th>Batch no. *</th><th>Mfg date</th><th>Expiry *</th><th>Qty</th><th>Free</th><th>Rate</th><th>MRP</th><th>GST %</th><th /></tr></thead><tbody>
            {lines.map((l, i) => <tr key={i}>
              <td style={{ minWidth: 240 }}><select value={l.product_code ?? ''} onChange={(e) => { const p = products.find((x) => x.product_code === e.target.value); setLines((ls) => ls.map((x, j) => j === i ? { ...x, product_code: e.target.value, rate: x.rate || p?.cost_price || '', gst_percent: x.gst_percent || p?.tax_percent || '' } : x)); }}><option value="">Select product…</option>{products.map((p) => <option key={p.id} value={p.product_code}>{p.product_code} · {p.product_name}</option>)}</select></td>
              <td><input value={l.batch_number ?? ''} onChange={(e) => setL(i, 'batch_number', e.target.value)} /></td>
              <td><input type="date" value={l.manufacture_date ?? ''} onChange={(e) => setL(i, 'manufacture_date', e.target.value)} /></td>
              <td><input type="date" value={l.expiry_date ?? ''} onChange={(e) => setL(i, 'expiry_date', e.target.value)} /></td>
              <td><input type="number" min="0" value={l.quantity ?? ''} onChange={(e) => setL(i, 'quantity', e.target.value)} /></td>
              <td><input type="number" min="0" value={l.free_quantity ?? ''} onChange={(e) => setL(i, 'free_quantity', e.target.value)} /></td>
              <td><input type="number" min="0" step="0.01" value={l.rate ?? ''} onChange={(e) => setL(i, 'rate', e.target.value)} /></td>
              <td><input type="number" min="0" step="0.01" value={l.mrp ?? ''} onChange={(e) => setL(i, 'mrp', e.target.value)} /></td>
              <td><input type="number" min="0" step="0.01" value={l.gst_percent ?? ''} onChange={(e) => setL(i, 'gst_percent', e.target.value)} /></td>
              <td><button type="button" className="quiet-button" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button></td></tr>)}
          </tbody></table></div>
          {lines.length === 0 && <p className="pd-muted">Pick a purchase order, scan a barcode, or add an item.</p>}
          <p><button type="button" className="quiet-button" onClick={() => setLines((ls) => [...ls, {}])}>+ Add item</button></p></fieldset>
        <label>Notes<input value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <Actions onCancel={() => setOpen(false)} onSave={() => void save()} saving={saving} label="Post GRN & add stock" />
      </Dialog>}
    </Page>
  );
}

// ---------------------------------------------------------------- Stock Ledger
export function PharmaStockLedgerPage() {
  const it = useIndustryId(); const { rows, err, loading } = useList('/pharma/stock-ledger', it); const [search, setSearch] = useState('');
  const shown = useFiltered(rows, search, 'all', ['product_name', 'product_code', 'batch_number', 'source', 'note']);
  if (!it) return <Loading />;
  const inn = rows.filter((r) => Number(r.delta) > 0).reduce((s, r) => s + Number(r.delta), 0); const out = rows.filter((r) => Number(r.delta) < 0).reduce((s, r) => s + Number(r.delta), 0);
  return (
    <Page eyebrow="STOCK LEDGER" title="Stock Ledger" desc="Every stock movement by batch: goods in (GRN), sales out, returns and adjustments. Latest 500 movements." error={err}
      kpis={[{ label: 'Movements', value: rows.length, sub: 'latest 500', icon: '⇄' }, { label: 'Units in', value: inn.toLocaleString('en-IN'), sub: 'receipts, returns, restocks', icon: '↓', tone: 'green' }, { label: 'Units out', value: Math.abs(out).toLocaleString('en-IN'), sub: 'sales, purchase returns, write-offs', icon: '↑', tone: 'amber' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="movements" />}>
      <Table loading={loading} rows={shown.map((r, i) => ({ ...r, id: r.id ?? i }))} hasAny={rows.length > 0} emptyIcon="⇄" emptyText="No stock movements yet."
        cols={[{ key: 'created_at', label: 'Date & time', render: (r) => new Date(r.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }, { key: 'product_name', label: 'Product' }, { key: 'batch_number', label: 'Batch' },
          { key: 'delta', label: 'Change', right: true, render: (r) => <strong style={{ color: Number(r.delta) > 0 ? 'var(--green,#1b7a3d)' : 'var(--red,#c0392b)' }}>{Number(r.delta) > 0 ? '+' : ''}{r.delta}</strong> }, { key: 'source', label: 'Source' }, { key: 'note', label: 'Note' }]} />
    </Page>
  );
}

// ---------------------------------------------------------------- Purchase Returns
export function PharmaPurchaseReturnsPage() {
  const it = useIndustryId(); const { rows, err, loading, reload } = useList('/pharma/purchase-returns', it);
  const sup = useList('/pharma/suppliers', it); const batches = useList('/pharma/batches', it);
  const [search, setSearch] = useState(''); const [open, setOpen] = useState(false); const [f, setF] = useState<Row>({}); const [lines, setLines] = useState<Row[]>([{}]); const [saving, setSaving] = useState(false); const [fe, setFe] = useState(''); const [view, setView] = useState<Row | null>(null);
  const shown = useFiltered(rows, search, 'all', ['return_number', 'pharma_suppliers.supplier_name', 'reason']);
  if (!it) return <Loading />;
  const stock = batches.rows.filter((b) => Number(b.quantity) > 0);
  const setL = (i: number, k: string, v: string) => setLines((ls) => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const save = async () => { setSaving(true); setFe(''); try { await send('POST', '/pharma/purchase-returns', { ...f, lines, industryTypeId: it }); setOpen(false); await Promise.all([reload(), batches.reload()]); } catch (e) { setFe(msgOf(e)); } finally { setSaving(false); } };
  const addNew = () => { setF({ return_date: todayStr() }); setLines([{}]); setFe(''); setOpen(true); };
  return (
    <Page eyebrow="PURCHASE RETURNS" title="Purchase Returns" desc="Send expired, damaged or wrong stock back to a supplier. The batch quantity goes down and the supplier balance is reduced." error={err}
      kpis={[{ label: 'Returns', value: rows.length, sub: 'all time', icon: '📤' }, { label: 'This month', value: rows.filter((r) => thisMonth(r.return_date)).length, sub: 'returns posted', icon: '▦', tone: 'amber' }, { label: 'Credit value', value: money0(rows.reduce((s, r) => s + Number(r.total_amount), 0)), sub: 'reduces supplier dues', icon: '₹', tone: 'blue' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="purchase returns" onAdd={addNew} addLabel="+ Add purchase return" />}>
      <Table loading={loading} rows={shown} hasAny={rows.length > 0} emptyIcon="📤" emptyText="No purchase returns yet." onAdd={addNew} addLabel="+ Add purchase return"
        cols={[{ key: 'return_number', label: 'Return no.' }, { key: 's', label: 'Supplier', render: (r) => r.pharma_suppliers?.supplier_name ?? '—' }, { key: 'return_date', label: 'Date', render: (r) => dShow(r.return_date) }, { key: 'reason', label: 'Reason' }, { key: 'total_amount', label: 'Credit value', right: true, render: (r) => money(r.total_amount) }, { key: 'status', label: 'Status', render: (r) => <Status s={r.status} /> },
          { key: 'a', label: 'Actions', render: (r) => <button type="button" className="quiet-button" onClick={() => setView(r)}>View</button> }]} />
      {view && <Dialog eyebrow="PURCHASE RETURNS" title={`${view.return_number} · ${view.pharma_suppliers?.supplier_name ?? ''}`} onClose={() => setView(null)} wide>
        <div className="data-table-wrap"><table><thead><tr><th>Product</th><th>Batch</th><th>Qty</th><th>Rate</th><th>GST %</th></tr></thead><tbody>{(view.lines ?? []).map((l: Row, i: number) => <tr key={i}><td>{l.product_name}</td><td>{l.batch_number}</td><td>{l.quantity}</td><td>{money(l.rate)}</td><td>{l.gst_percent}%</td></tr>)}</tbody></table></div></Dialog>}
      {open && <Dialog eyebrow="PURCHASE RETURNS" title="Add purchase return" onClose={() => setOpen(false)} wide>
        {fe && <p role="alert" className="error">{fe}</p>}
        <fieldset className="modal-fieldset"><legend>Return details</legend><div className="fieldset-grid">
          <label>Supplier *<select value={f.supplier_id ?? ''} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}><option value="">Select supplier…</option>{sup.rows.map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}</select></label>
          <label>Return date<input type="date" value={f.return_date ?? ''} onChange={(e) => setF({ ...f, return_date: e.target.value })} /></label>
          <label>Reason<input value={f.reason ?? ''} placeholder="Expired / damaged / wrong item" onChange={(e) => setF({ ...f, reason: e.target.value })} /></label></div></fieldset>
        <fieldset className="modal-fieldset"><legend>Items returned</legend><div className="pd-scroll"><table className="pd-lines"><thead><tr><th>Batch</th><th>Quantity</th><th>Rate</th><th>GST %</th><th /></tr></thead><tbody>
          {lines.map((l, i) => <tr key={i}>
            <td style={{ minWidth: 340 }}><select value={l.batch_number ?? ''} onChange={(e) => { const b = stock.find((x) => x.batch_number === e.target.value); setLines((ls) => ls.map((x, j) => j === i ? { ...x, batch_number: e.target.value, rate: b?.purchase_rate ?? x.rate ?? '' } : x)); }}><option value="">Select batch…</option>{stock.map((b) => <option key={b.id} value={b.batch_number}>{b.product_name} · {b.batch_number} · {b.quantity} left · exp {d10(b.expiry_date)}</option>)}</select></td>
            <td><input type="number" min="0" value={l.quantity ?? ''} onChange={(e) => setL(i, 'quantity', e.target.value)} /></td>
            <td><input type="number" min="0" step="0.01" value={l.rate ?? ''} onChange={(e) => setL(i, 'rate', e.target.value)} /></td>
            <td><input type="number" min="0" step="0.01" value={l.gst_percent ?? ''} onChange={(e) => setL(i, 'gst_percent', e.target.value)} /></td>
            <td><button type="button" className="quiet-button" aria-label="Remove line" onClick={() => setLines((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)}>✕</button></td></tr>)}
        </tbody></table></div><p><button type="button" className="quiet-button" onClick={() => setLines((ls) => [...ls, {}])}>+ Add item</button></p></fieldset>
        <Actions onCancel={() => setOpen(false)} onSave={() => void save()} saving={saving} label="Post return & reduce stock" />
      </Dialog>}
    </Page>
  );
}

// ---------------------------------------------------------------- Supplier Payments
export function PharmaSupplierPaymentsPage() {
  const it = useIndustryId(); const { rows, err, loading, reload } = useList('/pharma/supplier-payments', it); const bal = useList('/pharma/supplier-outstanding', it);
  const [search, setSearch] = useState(''); const [f, setF] = useState<Row | null>(null); const [ok, setOk] = useState(''); const [saving, setSaving] = useState(false); const [fe, setFe] = useState('');
  const shown = useFiltered(rows, search, 'all', ['payment_number', 'pharma_suppliers.supplier_name', 'reference_no', 'mode']);
  if (!it) return <Loading />;
  const due = bal.rows.reduce((s, r) => s + Math.max(0, Number(r.outstanding)), 0);
  const save = async () => { setSaving(true); setFe(''); try { await send('POST', '/pharma/supplier-payments', { ...f, industryTypeId: it }); setF(null); setOk('Payment recorded successfully.'); await Promise.all([reload(), bal.reload()]); } catch (e) { setFe(msgOf(e)); } finally { setSaving(false); } };
  const newPay = (r?: Row) => { setOk(''); setFe(''); setF({ supplier_id: r?.supplier_id ?? '', amount: r && r.outstanding > 0 ? r.outstanding : '', mode: 'Bank Transfer', payment_date: todayStr() }); };
  return (
    <Page eyebrow="SUPPLIER PAYMENTS" title="Supplier Payments" desc="Pay your suppliers and track what you still owe. Balance = goods received − purchase returns − payments." error={err || bal.err} notice={ok}
      kpis={[{ label: 'Payable to suppliers', value: money0(due), sub: `${bal.rows.filter((r) => Number(r.outstanding) > 0).length} suppliers with dues`, icon: '₹', tone: 'red' }, { label: 'Paid this month', value: money0(rows.filter((r) => thisMonth(r.payment_date)).reduce((s, r) => s + Number(r.amount), 0)), sub: 'all modes', icon: '✓', tone: 'green' }, { label: 'Payments', value: rows.length, sub: 'all time', icon: '💳' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="payments" onAdd={() => newPay()} addLabel="+ Add payment" />}>
      <h3 style={{ margin: '.2rem 0 .6rem' }}>Outstanding by supplier</h3>
      <Table loading={bal.loading} rows={bal.rows.map((r) => ({ ...r, id: r.supplier_id }))} emptyIcon="🏭" emptyText="No supplier balances yet." hasAny={bal.rows.length > 0}
        cols={[{ key: 'supplier_code', label: 'Code' }, { key: 'supplier_name', label: 'Supplier' }, { key: 'purchased', label: 'Purchased (GRN)', right: true, render: (r) => money(r.purchased) }, { key: 'returned', label: 'Returned', right: true, render: (r) => money(r.returned) }, { key: 'paid', label: 'Paid', right: true, render: (r) => money(r.paid) }, { key: 'outstanding', label: 'Outstanding', right: true, render: (r) => <strong className={Number(r.outstanding) > 0 ? 'pd-over' : undefined}>{money(r.outstanding)}</strong> },
          { key: 'a', label: 'Actions', render: (r) => <button type="button" className="quiet-button" disabled={Number(r.outstanding) <= 0} onClick={() => newPay(r)}>Pay</button> }]} />
      <h3 style={{ margin: '1.2rem 0 .6rem' }}>Payment history</h3>
      <Table loading={loading} rows={shown} hasAny={rows.length > 0} emptyIcon="💳" emptyText="No payments recorded yet."
        cols={[{ key: 'payment_number', label: 'Payment no.' }, { key: 's', label: 'Supplier', render: (r) => r.pharma_suppliers?.supplier_name ?? '—' }, { key: 'payment_date', label: 'Date', render: (r) => dShow(r.payment_date) }, { key: 'mode', label: 'Mode' }, { key: 'reference_no', label: 'Reference' }, { key: 'amount', label: 'Amount', right: true, render: (r) => money(r.amount) }]} />
      {f && <Dialog eyebrow="SUPPLIER PAYMENTS" title="Add supplier payment" onClose={() => setF(null)}>
        {fe && <p role="alert" className="error">{fe}</p>}
        <fieldset className="modal-fieldset"><legend>Payment details</legend><div className="fieldset-grid">
          <label>Supplier *<select value={f.supplier_id ?? ''} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}><option value="">Select supplier…</option>{bal.rows.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name} (due {money(s.outstanding)})</option>)}</select></label>
          <label>Amount *<input type="number" min="0" step="0.01" value={f.amount ?? ''} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          <label>Mode *<select value={f.mode ?? ''} onChange={(e) => setF({ ...f, mode: e.target.value })}>{['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></label>
          <label>Date<input type="date" value={f.payment_date ?? ''} onChange={(e) => setF({ ...f, payment_date: e.target.value })} /></label>
          <label>Reference / UTR / cheque no.<input value={f.reference_no ?? ''} onChange={(e) => setF({ ...f, reference_no: e.target.value })} /></label></div></fieldset>
        <Actions onCancel={() => setF(null)} onSave={() => void save()} saving={saving} label="Save payment" />
      </Dialog>}
    </Page>
  );
}

// ---------------------------------------------------------------- Customer Outstanding & Ageing
export function PharmaOutstandingPage() {
  const it = useIndustryId(); const { rows, err, loading } = useList('/pharma/customer-outstanding', it); const [search, setSearch] = useState(''); const [only, setOnly] = useState('all');
  const searched = useFiltered(rows, search, 'all', ['client_code', 'client_name']);
  if (!it) return <Loading />;
  const shown = searched.filter((r) => only === 'all' || (only === 'due' ? Number(r.outstanding) > 0 : r.over_limit));
  const due = rows.reduce((s, r) => s + Math.max(0, Number(r.outstanding)), 0); const old = rows.reduce((s, r) => s + Number(r.b61_90) + Number(r.b90_plus), 0);
  return (
    <Page eyebrow="OUTSTANDING & AGEING" title="Customer Outstanding & Ageing" desc="What each pharmacy owes you: billed − collected − approved credit notes, aged from the order date. Record payments in Collections." error={err}
      kpis={[{ label: 'Total receivable', value: money0(due), sub: `${rows.filter((r) => Number(r.outstanding) > 0).length} customers owe money`, icon: '₹', tone: 'blue' }, { label: 'Over 60 days', value: money0(old), sub: 'follow up first', icon: '⏰', tone: 'red' }, { label: 'Over credit limit', value: rows.filter((r) => r.over_limit).length, sub: 'customers', icon: '⚠', tone: 'amber' }, { label: 'Customers billed', value: rows.length, sub: 'with orders', icon: '▦' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="customers" extra={<select value={only} onChange={(e) => setOnly(e.target.value)}><option value="all">All customers</option><option value="due">With dues</option><option value="limit">Over credit limit</option></select>} />}>
      <Table loading={loading} rows={shown.map((r) => ({ ...r, id: r.client_id }))} hasAny={rows.length > 0} emptyIcon="₹" emptyText="No billed customers yet."
        cols={[{ key: 'client_code', label: 'Code' }, { key: 'client_name', label: 'Customer' }, { key: 'billed', label: 'Billed', right: true, render: (r) => money(r.billed) }, { key: 'collected', label: 'Collected', right: true, render: (r) => money(r.collected) }, { key: 'credit_notes', label: 'Credit notes', right: true, render: (r) => money(r.credit_notes) },
          { key: 'b0_30', label: '0–30 d', right: true, render: (r) => money0(r.b0_30) }, { key: 'b31_60', label: '31–60 d', right: true, render: (r) => money0(r.b31_60) }, { key: 'b61_90', label: '61–90 d', right: true, render: (r) => money0(r.b61_90) }, { key: 'b90_plus', label: '90+ d', right: true, render: (r) => <span className={Number(r.b90_plus) > 0 ? 'pd-over' : undefined}>{money0(r.b90_plus)}</span> },
          { key: 'outstanding', label: 'Outstanding', right: true, render: (r) => <strong className={r.over_limit ? 'pd-over' : undefined}>{money(r.outstanding)}</strong> }, { key: 'credit_limit', label: 'Credit limit', right: true, render: (r) => (Number(r.credit_limit) > 0 ? money0(r.credit_limit) : '—') }]} />
    </Page>
  );
}

// ---------------------------------------------------------------- GST Invoices
const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number): string => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`);
function words(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = []; const cr = Math.floor(n / 1e7); const lk = Math.floor((n % 1e7) / 1e5); const th = Math.floor((n % 1e5) / 1e3); const h = Math.floor((n % 1e3) / 100); const r = n % 100;
  if (cr) parts.push(`${two(cr)} Crore`); if (lk) parts.push(`${two(lk)} Lakh`); if (th) parts.push(`${two(th)} Thousand`); if (h) parts.push(`${ones[h]} Hundred`); if (r) parts.push(two(r));
  return parts.join(' ');
}
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
function printInvoice(inv: Row) {
  const c = inv.company ?? {}; const cl = inv.clients ?? {}; const inter = String(inv.supply_type).startsWith('Inter');
  const body = (inv.lines as Row[]).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.product_name)}</td><td>${esc(l.hsn_code)}</td><td>${(l.batches ?? []).map((b: Row) => `${esc(b.batch_number)}${b.expiry_date ? ` (Exp ${esc(b.expiry_date)})` : ''}`).join('<br>')}</td><td class="r">${l.quantity}${l.free_quantity ? ` + ${l.free_quantity} free` : ''}</td><td class="r">${Number(l.rate).toFixed(2)}</td><td class="r">${Number(l.discount).toFixed(2)}</td><td class="r">${Number(l.taxable_value).toFixed(2)}</td><td class="r">${l.gst_percent}%</td><td class="r">${(inter ? Number(l.igst) : Number(l.cgst) + Number(l.sgst)).toFixed(2)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.invoice_number)}</title><style>body{font:12px Arial;margin:24px;color:#111}h1{font-size:18px;margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #999;padding:4px;text-align:left;vertical-align:top}th{background:#f1f1f1}.r{text-align:right}.row{display:flex;justify-content:space-between;gap:20px}.box{border:1px solid #999;padding:8px;flex:1}.tot td{border:none;padding:2px 4px}@media print{button{display:none}}</style></head><body>
<button onclick="window.print()">Print / Save as PDF</button><h1>TAX INVOICE ${inv.status === 'Cancelled' ? '(CANCELLED)' : ''}</h1>
<div class="row"><div class="box"><b>${esc(c.company_name)}</b><br>${esc(c.address)}<br>GSTIN: ${esc(c.gstin)}<br>Drug Licence: ${esc(c.drug_license_number)}<br>${esc(c.phone)}</div>
<div class="box">Invoice No: <b>${esc(inv.invoice_number)}</b><br>Date: ${esc(d10(inv.invoice_date))}<br>Due: ${esc(d10(inv.due_date))}<br>Supply: ${esc(inv.supply_type)}<br>Place of supply: ${esc(inv.place_of_supply)}</div></div>
<div class="box" style="margin-top:8px"><b>Bill to: ${esc(cl.client_name)}</b><br>${esc(cl.street_address)} ${esc(cl.city)} ${esc(cl.state)}<br>GSTIN: ${esc(cl.gstin)}<br>Drug Licence: ${esc(cl.industry_details?.drugLicenseNumber)}</div>
<table><thead><tr><th>#</th><th>Medicine</th><th>HSN</th><th>Batch / Expiry</th><th>Qty</th><th>Rate</th><th>Disc.</th><th>Taxable</th><th>GST</th><th>Tax amt</th></tr></thead><tbody>${body}</tbody></table>
<table class="tot" style="width:320px;margin-left:auto"><tr><td>Taxable value</td><td class="r">${Number(inv.taxable_amount).toFixed(2)}</td></tr>${inter ? `<tr><td>IGST</td><td class="r">${Number(inv.igst_amount).toFixed(2)}</td></tr>` : `<tr><td>CGST</td><td class="r">${Number(inv.cgst_amount).toFixed(2)}</td></tr><tr><td>SGST</td><td class="r">${Number(inv.sgst_amount).toFixed(2)}</td></tr>`}<tr><td>Round off</td><td class="r">${Number(inv.round_off).toFixed(2)}</td></tr><tr><td><b>Total</b></td><td class="r"><b>₹${Number(inv.total_amount).toFixed(2)}</b></td></tr></table>
<p><b>Amount in words:</b> Rupees ${words(Math.round(Number(inv.total_amount)))} Only</p><p>${esc(c.bank_details)}</p><p>${esc(c.terms)}</p></body></html>`;
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); }
}
export function PharmaInvoicesPage() {
  const it = useIndustryId(); const { rows, err, loading, reload, setErr } = useList('/pharma/invoices', it);
  const [orders, setOrders] = useState<Row[]>([]); const [open, setOpen] = useState(false); const [orderId, setOrderId] = useState(''); const [ok, setOk] = useState(''); const [saving, setSaving] = useState(false); const [fe, setFe] = useState('');
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all');
  const shown = useFiltered(rows, search, status, ['invoice_number', 'clients.client_name', 'supply_type']);
  useEffect(() => { if (!it) return; api<{ data: Row[] }>('/orders').then((r) => setOrders((r.data ?? []).filter((o) => o.clients?.industry_type_id === it))).catch(() => setOrders([])); }, [it, rows.length]);
  if (!it) return <Loading />;
  const live = rows.filter((r) => r.status !== 'Cancelled'); const invoiced = new Set(live.map((r) => r.order_id));
  const pending = orders.filter((o) => !invoiced.has(o.id) && !['cancelled', 'rejected', 'draft', 'pending_approval'].includes(o.status));
  const create = async () => { setSaving(true); setFe(''); try { const r = await send('POST', '/pharma/invoices', { order_id: orderId, industryTypeId: it }); setOpen(false); setOk(`Invoice ${r.data.invoice_number} created successfully.`); await reload(); } catch (e) { setFe(msgOf(e)); } finally { setSaving(false); } };
  const show = async (r: Row) => { try { const d = await api<{ data: Row }>(`/pharma/invoices/${r.id}`); printInvoice(d.data); } catch (e) { setErr(msgOf(e)); } };
  const cancel = async (r: Row) => { const reason = window.prompt('Reason for cancelling this invoice?'); if (reason === null) return; try { await send('POST', `/pharma/invoices/${r.id}/cancel`, { reason }); await reload(); } catch (e) { setErr(msgOf(e)); } };
  const addNew = () => { setErr(''); setOk(''); setFe(''); setOrderId(''); setOpen(true); };
  return (
    <Page eyebrow="GST SALES INVOICES" title="GST Sales Invoices" desc="Tax invoices from confirmed sales orders. CGST + SGST or IGST is decided from the GSTIN states, and batch & expiry print on every line." error={err} notice={ok}
      kpis={[{ label: 'Invoices', value: live.length, sub: `${rows.length - live.length} cancelled`, icon: '🧮' }, { label: 'Billed value', value: money0(live.reduce((s, r) => s + Number(r.total_amount), 0)), sub: 'incl. GST', icon: '₹', tone: 'blue' }, { label: 'GST charged', value: money0(live.reduce((s, r) => s + Number(r.cgst_amount) + Number(r.sgst_amount) + Number(r.igst_amount), 0)), sub: 'CGST + SGST + IGST', icon: '%', tone: 'green' }, { label: 'Orders to invoice', value: pending.length, sub: 'confirmed, not yet billed', icon: '⏳', tone: 'amber' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="invoices" statuses={['Issued', 'Cancelled']} status={status} setStatus={setStatus} onAdd={addNew} addLabel="+ Add invoice" />}>
      <Table loading={loading} rows={shown} hasAny={rows.length > 0} emptyIcon="🧮" emptyText="No invoices yet. Create one from a confirmed sales order." onAdd={addNew} addLabel="+ Add invoice"
        cols={[{ key: 'invoice_number', label: 'Invoice no.' }, { key: 'c', label: 'Customer', render: (r) => r.clients?.client_name ?? '—' }, { key: 'invoice_date', label: 'Date', render: (r) => dShow(r.invoice_date) }, { key: 'due_date', label: 'Due', render: (r) => dShow(r.due_date) }, { key: 'supply_type', label: 'Supply' }, { key: 'taxable_amount', label: 'Taxable', right: true, render: (r) => money(r.taxable_amount) }, { key: 'gst', label: 'GST', right: true, render: (r) => money(Number(r.cgst_amount) + Number(r.sgst_amount) + Number(r.igst_amount)) }, { key: 'total_amount', label: 'Total', right: true, render: (r) => <strong>{money(r.total_amount)}</strong> }, { key: 'status', label: 'Status', render: (r) => <Status s={r.status} /> },
          { key: 'a', label: 'Actions', render: (r) => <div className="master-actions-inner"><button type="button" className="quiet-button" onClick={() => void show(r)}>Print</button>{r.status !== 'Cancelled' && <button type="button" className="quiet-button" onClick={() => void cancel(r)}>Cancel</button>}</div> }]} />
      {open && <Dialog eyebrow="GST SALES INVOICES" title="Add GST invoice" onClose={() => setOpen(false)}>
        {fe && <p role="alert" className="error">{fe}</p>}
        <fieldset className="modal-fieldset"><legend>Sales order</legend>
          <label>Confirmed order *<select value={orderId} onChange={(e) => setOrderId(e.target.value)}><option value="">Select an order…</option>{pending.map((o) => <option key={o.id} value={o.id}>{o.order_number} · {o.clients?.client_name} · {money(o.total_amount)}</option>)}</select></label>
          {pending.length === 0 && <p className="pd-muted">No confirmed orders are waiting for an invoice.</p>}</fieldset>
        <Actions onCancel={() => setOpen(false)} onSave={() => void create()} saving={saving || !orderId} label="Generate invoice" />
      </Dialog>}
    </Page>
  );
}

// ---------------------------------------------------------------- Scan & Barcodes
export function PharmaScanPage() {
  const it = useIndustryId(); const products = useProducts(it);
  const [res, setRes] = useState<Row | null>(null); const [code, setCode] = useState(''); const [unknown, setUnknown] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [link, setLink] = useState('');
  const onScan = useCallback(async (c: string) => {
    if (!it) return; setCode(c); setErr(''); setOk(''); setUnknown(false); setRes(null);
    try { const r = await api<{ data: Row | null }>(`/pharma/scan?code=${encodeURIComponent(c)}&industryTypeId=${it}`); if (r.data) setRes(r.data); else setUnknown(true); } catch (e) { setErr(msgOf(e)); }
  }, [it]);
  if (!it) return <Loading />;
  const doLink = async () => { try { await send('POST', '/pharma/barcodes', { barcode: code, product_code: link, industryTypeId: it }); setOk(`Barcode ${code} linked to ${link}.`); await onScan(code); } catch (e) { setErr(msgOf(e)); } };
  return (
    <Page eyebrow="SCAN & BARCODES" title="Scan & Barcodes" desc="Scan a medicine pack with the phone camera (Chrome on Android) or a USB / Bluetooth scanner to see its stock, batches and expiry. Link an unknown barcode to a product once." error={err} notice={ok}>
      <ScanInput onScan={(c) => void onScan(c)} />
      {unknown && <fieldset className="modal-fieldset" style={{ marginTop: '1rem' }}><legend>Code {code} is not linked yet</legend>
        <div className="master-toolbar" style={{ margin: 0 }}><div className="master-search"><select value={link} onChange={(e) => setLink(e.target.value)}><option value="">Link to product…</option>{products.map((p) => <option key={p.id} value={p.product_code}>{p.product_code} · {p.product_name}</option>)}</select></div><button type="button" className="primary-action" disabled={!link} onClick={() => void doLink()}>Link barcode</button></div></fieldset>}
      {res?.product && <div style={{ marginTop: '1rem' }}>
        <div className="kpi-grid" style={{ '--kpi-count': 4 } as CSSProperties}>
          <div className="kpi-card" data-tone="ink"><div className="kpi-icon">💊</div><div><span>Product</span><strong style={{ fontSize: '1rem' }}>{res.product.product_name}</strong><small>{res.product.product_code}</small></div></div>
          <div className="kpi-card" data-tone="green"><div className="kpi-icon">▦</div><div><span>Stock</span><strong>{res.product.stock_quantity}</strong><small>sellable units</small></div></div>
          <div className="kpi-card" data-tone="blue"><div className="kpi-icon">₹</div><div><span>Selling price</span><strong>{money(res.product.selling_price)}</strong><small>GST {res.product.tax_percent ?? 0}%</small></div></div>
          <div className="kpi-card" data-tone="amber"><div className="kpi-icon">#</div><div><span>HSN</span><strong>{res.product.hsn_code ?? '—'}</strong><small>reorder at {res.product.min_stock_level ?? '—'}</small></div></div>
        </div>
        <Table rows={(res.batches ?? []).map((b: Row, i: number) => ({ ...b, id: i }))} emptyText="No batch in stock." emptyIcon="▤" hasAny={false}
          cols={[{ key: 'batch_number', label: 'Batch' }, { key: 'manufacture_date', label: 'Mfg', render: (b) => dShow(b.manufacture_date) }, { key: 'expiry_date', label: 'Expiry', render: (b) => dShow(b.expiry_date) }, { key: 'days_left', label: 'Days left' }, { key: 'quantity', label: 'Qty', right: true }, { key: 'mrp', label: 'MRP', right: true, render: (b) => (b.mrp ? money(b.mrp) : '—') }, { key: 'sellable', label: 'Sellable', render: (b) => <Status s={b.sellable ? 'Sellable' : 'Blocked'} /> }]} /></div>}
    </Page>
  );
}

// ---------------------------------------------------------------- Reports
const REPORTS: [string, string][] = [['sales', 'Sales (GST)'], ['purchase', 'Purchases'], ['inventory', 'Batch stock'], ['expiry', 'Expiry (180 days)'], ['low-stock', 'Low stock'], ['customer-outstanding', 'Customer outstanding'], ['supplier-outstanding', 'Supplier payables']];
export function PharmaReportsPage() {
  const it = useIndustryId(); const [kind, setKind] = useState('sales'); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [rows, setRows] = useState<Row[]>([]); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false); const [search, setSearch] = useState('');
  useEffect(() => {
    if (!it) return; let live = true; setLoading(true);
    api<{ data: Row[] }>(`/pharma/reports/${kind}?industryTypeId=${it}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`).then((r) => { if (live) { setRows(r.data ?? []); setErr(''); } }).catch((e) => { if (live) setErr(msgOf(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [it, kind, from, to]);
  const shown = useFiltered(rows, search, 'all');
  if (!it) return <Loading />;
  const keys = rows[0] ? Object.keys(rows[0]).filter((k) => !['id', 'supplier_id', 'client_id', 'over_limit'].includes(k)) : [];
  const isNum = (k: string) => rows.length > 0 && rows.every((r) => r[k] === null || r[k] === '' || typeof r[k] === 'number');
  const csv = () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const text = [keys.join(','), ...shown.map((r) => keys.map((k) => q(r[k])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `pharma-${kind}-${todayStr()}.csv`; a.click();
  };
  const dated = ['sales', 'purchase'].includes(kind); const label = REPORTS.find(([k]) => k === kind)?.[1] ?? '';
  const totalKey = keys.find((k) => ['total', 'stock_value', 'outstanding', 'shortfall'].includes(k));
  const moneyKey = (k: string) => /rate|value|total|amount|taxable|cgst|sgst|igst|paid|billed|collected|outstanding|purchased|returned|b0_30|b31_60|b61_90|b90_plus|limit/.test(k);
  return (
    <Page eyebrow="REPORTS" title="Pharma Reports" desc="Sales, purchase and inventory reports for this industry only. Download any report as CSV." error={err}
      kpis={[{ label: 'Rows', value: shown.length, sub: label, icon: '📊' }, ...(totalKey ? [{ label: totalKey.replace(/_/g, ' '), value: totalKey === 'shortfall' ? shown.reduce((s, r) => s + Number(r[totalKey] || 0), 0) : money0(shown.reduce((s, r) => s + Number(r[totalKey] || 0), 0)), sub: 'sum of shown rows', icon: '₹', tone: 'blue' as const }] : [])]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="rows" extra={dated ? <><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></> : undefined} />}>
      <div className="pd-tabs">{REPORTS.map(([k, l]) => <button key={k} type="button" className={`quiet-button ${kind === k ? 'on' : ''}`} onClick={() => { setKind(k); setSearch(''); }}>{l}</button>)}<button type="button" className="primary-action" style={{ marginLeft: 'auto' }} disabled={!rows.length} onClick={csv}>Download CSV</button></div>
      <Table loading={loading} rows={shown.map((r, i) => ({ ...r, id: i }))} hasAny={rows.length > 0} emptyIcon="📊" emptyText="No data for this report yet." cols={keys.map((k) => ({ key: k, label: k.replace(/_/g, ' '), right: isNum(k), render: (r: Row) => (typeof r[k] === 'number' ? (moneyKey(k) ? money(r[k]) : r[k]) : (r[k] === null || r[k] === '' || r[k] === undefined ? '—' : String(r[k]))) }))} />
    </Page>
  );
}