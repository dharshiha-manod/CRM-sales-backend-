/* eslint-disable @typescript-eslint/no-explicit-any */
// Pharma Distributor / Wholesaler pages. Same look as the other Pharma modules (page-panel, KPI cards, toolbar, table, modal).
// Company & GST, Suppliers, Purchase Orders, GRN, Stock Ledger, Scan, GST Invoices, Purchase Returns, Supplier Payments,
// Customer Outstanding & Ageing, Reports. Own API routes under /pharma/*; used only when the Pharma industry is active.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';

type Row = Record<string, any>;
export const money = (v: unknown) => `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const money0 = (v: unknown) => `₹${Math.round(Number(v ?? 0)).toLocaleString('en-IN')}`;
const d10 = (v: unknown) => (v ? String(v).slice(0, 10) : '—');
export const dShow = (v: unknown) => { if (!v) return '—'; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };
export const msgOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const todayStr = () => new Date().toISOString().slice(0, 10);
const thisMonth = (v: unknown) => String(v ?? '').slice(0, 7) === todayStr().slice(0, 7);

const GOOD = new Set(['active', 'received', 'posted', 'issued', 'paid', 'valid', 'sellable']);
const BAD = new Set(['inactive', 'cancelled', 'expired', 'blocked', 'overdue']);
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
export function Page({ eyebrow, title, desc, kpis, toolbar, error, notice, children }: { eyebrow: string; title: string; desc: string; kpis?: Kpi[]; toolbar?: ReactNode; error?: string; notice?: string; children: ReactNode }) {
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
export function Toolbar({ search, setSearch, label, statuses, status, setStatus, onAdd, addLabel, extra }: { search: string; setSearch: (v: string) => void; label: string; statuses?: string[]; status?: string; setStatus?: (v: string) => void; onAdd?: () => void; addLabel?: string; extra?: ReactNode }) {
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
export function Table({ cols, rows, loading, emptyText, emptyIcon, onAdd, addLabel, hasAny = true }: { cols: Col[]; rows: Row[]; loading?: boolean; emptyText?: string; emptyIcon?: string; onAdd?: () => void; addLabel?: string; hasAny?: boolean }) {
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
export const Status = ({ s }: { s: string }) => <span className={badge(s)}>{s}</span>;
export function Dialog({ eyebrow, title, onClose, children, wide }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`master-modal${wide ? ' master-modal--wide' : ''}`} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()} style={wide ? { width: 'min(1120px,100vw)' } : undefined}>
        <div className="modal-heading"><div><p className="eyebrow">PHARMA · {eyebrow}</p><h3>{title}</h3></div><button className="icon-action" type="button" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="master-modal-form">{children}</div>
      </div>
    </div>
  );
}
export const Actions = ({ onCancel, onSave, saving, label }: { onCancel: () => void; onSave: () => void; saving?: boolean; label: string }) => (
  <div className="modal-actions"><button type="button" className="quiet-button" onClick={onCancel} disabled={saving}>Cancel</button><button type="button" className="primary-action" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : label}</button></div>
);

export function useIndustryId() { return useIndustryScope().activeIndustryTypeId; }
export function useList(path: string, it: string | null) {
  const [rows, setRows] = useState<Row[]>([]); const [err, setErr] = useState(''); const [loading, setLoading] = useState(true);
  const load = useCallback(async (silent?: boolean) => {
    if (!it) return; if (silent !== true) setLoading(true);
    try { const r = await api<{ data: Row[] }>(`${path}${path.includes('?') ? '&' : '?'}industryTypeId=${encodeURIComponent(it)}`); setRows(r.data ?? []); setErr(''); }
    catch (e) { setErr(msgOf(e)); } finally { setLoading(false); }
  }, [path, it]);
  useEffect(() => { void load(); }, [load]);
  return { rows, err, loading, reload: load, setErr };
}
export const send = (method: string, path: string, body?: unknown) => api<{ data: Row }>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
export function useProducts(it: string | null) {
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
export const Loading = () => <section className="page-panel master-page"><p>Loading the Pharma workspace…</p></section>;


// GS1 (the 2D / DataMatrix code printed on most Indian pharma packs) carries GTIN, batch and expiry. Reads both "(01)...(17)...(10)..." and raw FNC1 strings.
export function parseGs1(raw: string): { gtin?: string; batch?: string; expiry?: string; mfg?: string } | null {
  const text = raw.trim().replace(/^\][A-Za-z]\d/, ''); const out: Record<string, string> = {};
  const ymd = (v: string) => { const yy = Number(v.slice(0, 2)); const mm = v.slice(2, 4); let dd = v.slice(4, 6); const yyyy = 2000 + yy; if (dd === '00') dd = String(new Date(yyyy, Number(mm), 0).getDate()).padStart(2, '0'); return `${yyyy}-${mm}-${dd}`; };
  if (text.includes('(')) { for (const m of text.matchAll(/\((\d{2})\)([^(]+)/g)) out[m[1]] = m[2]; }
  else {
    let i = 0; const fixed: Record<string, number> = { '01': 14, '11': 6, '17': 6, '15': 6 };
    while (i < text.length) {
      const ai = text.slice(i, i + 2); i += 2;
      if (fixed[ai]) { out[ai] = text.slice(i, i + fixed[ai]); i += fixed[ai]; }
      else if (ai === '10' || ai === '21') { let j = i; while (j < text.length && text[j] !== '\x1d') j += 1; out[ai] = text.slice(i, j); i = j + 1; }
      else return null;
    }
  }
  if (!out['01'] && !out['10']) return null;
  return { gtin: out['01'], batch: out['10'], expiry: out['17'] && /^\d{6}$/.test(out['17']) ? ymd(out['17']) : undefined, mfg: out['11'] && /^\d{6}$/.test(out['11']) ? ymd(out['11']) : undefined };
}
/** Internal batch number for stock that arrives without one. It will NOT match the pack. */
export const autoBatchNo = (productCode: string) => {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const tail = String(productCode ?? '').split('-').pop()?.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'X';
  return `AUTO-${ymd}-${tail}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
};
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
const PO_STATUSES = ['Draft', 'Ordered', 'Partially Received', 'Received', 'Closed', 'Cancelled'];
const fmtWhen = (v?: string) => v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

const PO_CSS = `
.po-actions{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;white-space:nowrap}
.po-actions button.po-btn{display:inline-flex!important;align-items:center;gap:6px;height:34px;padding:0 14px!important;font-size:13px!important;font-weight:600!important;line-height:1;border-radius:10px!important;cursor:pointer;transition:all .15s ease;background:#fff!important;color:#1f2937!important;border:1px solid #d6d3c9!important;box-shadow:0 1px 1px rgba(0,0,0,.04)}
.po-actions button.po-btn:hover{background:#f3f1ea!important;border-color:#1f2937!important;transform:translateY(-1px)}
.po-actions button.po-btn svg{width:15px;height:15px;flex:none}
.po-actions button.po-btn-primary{background:#111827!important;color:#fff!important;border-color:#111827!important;box-shadow:0 2px 6px rgba(17,24,39,.25)}
.po-actions button.po-btn-primary:hover{background:#2563eb!important;border-color:#2563eb!important}
.po-actions button.po-btn-danger{background:#fff!important;color:#b42318!important;border-color:#f1c0bb!important}
.po-actions button.po-btn-danger:hover{background:#fdecea!important;border-color:#b42318!important}
.po-late{color:#b42318;font-weight:700;white-space:nowrap}
.po-late small{display:block;font-weight:600;font-size:11px}
.po-actions button.po-btn-receive{background:#15803d!important;color:#fff!important;border-color:#15803d!important;box-shadow:0 2px 6px rgba(21,128,61,.3)}
.po-actions button.po-btn-receive:hover{background:#166534!important;border-color:#166534!important}
.po-mail{display:inline-flex;flex-direction:column;gap:2px;padding:6px 12px;border-radius:10px;font-size:12.5px;line-height:1.25;white-space:nowrap;border:1px solid transparent}
.po-mail b{font-weight:700}
.po-mail small{font-size:11px;opacity:.8}
.po-mail-sent{background:#e8f0fe;color:#1d4ed8;border-color:#c7d8fb}
.po-mail-replied{background:#e7f6ec;color:#15803d;border-color:#bfe6cc}
.po-mail-none{background:#fff;color:#6b7280;border-color:#d6d3c9;font-weight:600}
.po-thread{margin-top:16px;padding:14px 16px;border:1px solid #d6d3c9;border-radius:12px;background:#faf9f5}
.po-thread p{margin:4px 0}
.po-thread pre{white-space:pre-wrap;font:inherit;margin:8px 0 0;padding:12px;background:#fff;border:1px solid #e5e2d8;border-radius:8px}
`;
const ico = {
  eye: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  send: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>,
  x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>,
  box: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>,
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>,
};

function ExpectedCell({ r }: { r: Row }) {
  const open = ['Ordered', 'Partially Received'].includes(r.status);
  const d = r.expected_date ? String(r.expected_date).slice(0, 10) : '';
  if (!d) return <>—</>;
  const late = open && d < todayStr();
  if (!late) return <>{dShow(r.expected_date)}</>;
  const days = Math.max(1, Math.round((new Date(todayStr()).getTime() - new Date(d).getTime()) / 86400000));
  return <span className="po-late">{dShow(r.expected_date)}<small>⚠ {days} day{days > 1 ? 's' : ''} late</small></span>;
}

function MailChip({ r }: { r: Row }) {
  if (r.supplier_mail_status === 'Replied')
    return <span className="po-mail po-mail-replied" title={`Reply from ${r.supplier_reply_from ?? 'supplier'}`}><b>✓ Replied</b><small>{fmtWhen(r.supplier_replied_at)}</small></span>;
  if (r.supplier_mail_status === 'Sent')
    return <span className="po-mail po-mail-sent" title={`Emailed to ${r.supplier_mailed_to ?? ''}`}><b>✉ Awaiting reply</b><small>Sent {fmtWhen(r.supplier_mailed_at)}</small></span>;
  return <span className="po-mail po-mail-none">Not sent</span>;
}

function PoActions({ r, onView, onSend, onReceive, onAct, onDel }: { r: Row; onView: () => void; onSend: () => void; onReceive: () => void; onAct: (st: string) => void; onDel: () => void }) {
  const canSend = ['Ordered', 'Partially Received'].includes(r.status);
  const sentBefore = r.supplier_mail_status === 'Sent' || r.supplier_mail_status === 'Replied';
  return (
    <div className="master-actions-inner po-actions">
      <button type="button" className="po-btn" onClick={onView}>{ico.eye}View</button>
      {r.status === 'Draft' && <button type="button" className="po-btn po-btn-primary" onClick={() => onAct('Ordered')}>{ico.check}Mark ordered</button>}
      {canSend && <button type="button" className={sentBefore ? 'po-btn' : 'po-btn po-btn-primary'} onClick={onSend}>{ico.send}{sentBefore ? 'Resend' : 'Send to supplier'}</button>}
      {canSend && <button type="button" className="po-btn po-btn-receive" onClick={onReceive} title="Open Goods Receipt pre-filled from this order">{ico.box}Receive goods</button>}
      {['Draft', 'Ordered'].includes(r.status) && <button type="button" className="po-btn po-btn-danger" onClick={() => { if (window.confirm(`Cancel ${r.po_number}?`)) onAct('Cancelled'); }}>{ico.x}Cancel</button>}
      {r.status === 'Partially Received' && <button type="button" className="po-btn po-btn-danger" onClick={() => { if (window.confirm(`Close ${r.po_number}? The pending quantity will no longer count as on order.`)) onAct('Closed'); }}>{ico.x}Close PO</button>}
      {r.status === 'Draft' && <button type="button" className="po-btn po-btn-danger" onClick={onDel}>{ico.trash}Delete</button>}
    </div>
  );
}
export function PharmaPurchaseOrdersPage() {
  const it = useIndustryId(); const { rows, err, loading, reload, setErr } = useList('/pharma/purchase-orders', it);
  const sup = useList('/pharma/suppliers', it); const products = useProducts(it);
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false); const [f, setF] = useState<Row>({}); const [lines, setLines] = useState<Row[]>([{}]); const [saving, setSaving] = useState(false); const [fe, setFe] = useState(''); const [view, setView] = useState<Row | null>(null);
  const shown = useFiltered(rows, search, status, ['po_number', 'pharma_suppliers.supplier_name', 'status']);
  const [ok, setOk] = useState('');
  // Pick up supplier replies automatically (no page refresh needed)
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) void reload(true); }, 30000); return () => clearInterval(t); }, [reload]);
  const total = useMemo(() => lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.rate || 0) * (1 + Number(l.gst_percent || 0) / 100), 0), [lines]);
  if (!it) return <Loading />;
  const openRows = rows.filter((r) => ['Ordered', 'Partially Received'].includes(r.status));
  const pick = (i: number, code: string) => { const p = products.find((x) => x.product_code === code); setLines((ls) => ls.map((l, j) => j === i ? { ...l, product_code: code, rate: l.rate || p?.cost_price || '', gst_percent: l.gst_percent || p?.tax_percent || '' } : l)); };
  const setL = (i: number, k: string, v: string) => setLines((ls) => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const save = async (st: string) => { setSaving(true); setFe(''); try { await send('POST', '/pharma/purchase-orders', { ...f, status: st, lines, industryTypeId: it }); setOpen(false); await reload(); } catch (e) { setFe(msgOf(e)); } finally { setSaving(false); } };
  const sendPo = async (r: Row) => {
    try {
      const d = (await send('POST', `/pharma/automation/po/${r.id}/send`, { industryTypeId: it })).data as Row;
      if (d.whatsapp_link) window.open(String(d.whatsapp_link), '_blank');
      if (d.emailed) { setOk(`${r.po_number} emailed to ${d.to}. Status updates automatically when the supplier replies.`); setErr(''); }
      else { setOk(''); setErr('Email is not set up, or the supplier has no email address.'); }
      await reload();
    } catch (e) { setErr(msgOf(e)); }
  };
  const checkReplies = async () => {
    setErr(''); setOk('Checking the mailbox…');
    try {
      const d = (await send('POST', '/pharma/automation/po/check-replies', { industryTypeId: it })).data as Row;
      if (!d.configured) { setOk(''); setErr('Reply tracking is not set up: SUPPLIER_REPLY_IMAP_HOST / USER / PASS are missing in the API .env file.'); }
      else if (d.error) { setOk(''); setErr(`Could not read the mailbox: ${d.error}`); }
      else setOk(`Checked ${d.candidates} email(s). ${d.updated} purchase order(s) updated.${d.skipped?.length ? ` Not used: ${d.skipped.join(', ')}.` : ''}`);
      await reload();
    } catch (e) { setOk(''); setErr(msgOf(e)); }
  };
  const receive = (r: Row) => { sessionStorage.setItem('pharma:grn-from-po', JSON.stringify({ po_id: r.id })); window.location.hash = '#industry:pharma:grn'; };
  const act = async (r: Row, st: string) => {try { await send('PATCH', `/pharma/purchase-orders/${r.id}`, { status: st }); await reload(); } catch (e) { setErr(msgOf(e)); } };
  const del = async (r: Row) => { if (!window.confirm(`Delete ${r.po_number}?`)) return; try { await send('DELETE', `/pharma/purchase-orders/${r.id}`); await reload(); } catch (e) { setErr(msgOf(e)); } };
  const addNew = () => { setF({ order_date: todayStr() }); setLines([{}]); setFe(''); setOpen(true); };
  return (
    <Page eyebrow="PURCHASE ORDERS" title="Purchase Orders" desc="Order stock from suppliers. Goods are received against a purchase order in Goods Receipt (GRN)." error={err} notice={ok}
      kpis={[{ label: 'Purchase orders', value: rows.length, sub: 'all time', icon: '🧾' }, { label: 'Awaiting goods', value: openRows.length, sub: 'ordered / partly received', icon: '⏳', tone: 'amber' }, { label: 'Received', value: rows.filter((r) => r.status === 'Received').length, sub: 'completed', icon: '✓', tone: 'green' }, { label: 'Open order value', value: money0(openRows.reduce((s, r) => s + Number(r.total_amount), 0)), sub: 'incl. GST', icon: '₹', tone: 'blue' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="purchase orders" statuses={PO_STATUSES} status={status} setStatus={setStatus} onAdd={addNew} addLabel="+ Add purchase order" />}>
      <style>{PO_CSS}</style>
      <div className="po-actions" style={{ justifyContent: 'flex-end', margin: '0 0 10px' }}><button type="button" className="po-btn" onClick={() => void checkReplies()} title="Read the mailbox now instead of waiting for the next automatic check">↻ Check supplier replies now</button></div>
      <Table loading={loading} rows={shown} hasAny={rows.length > 0} emptyIcon="🧾" emptyText="No purchase orders yet. Create one to order stock from a supplier." onAdd={addNew} addLabel="+ Add purchase order"
        cols={[{ key: 'po_number', label: 'PO no.' }, { key: 's', label: 'Supplier', render: (r) => r.pharma_suppliers?.supplier_name ?? '—' }, { key: 'order_date', label: 'Date', render: (r) => dShow(r.order_date) }, { key: 'expected_date', label: 'Expected', render: (r) => <ExpectedCell r={r} /> },
          { key: 'q', label: 'Received / ordered', render: (r) => `${(r.lines ?? []).reduce((s: number, l: Row) => s + Number(l.received_quantity || 0), 0)} / ${(r.lines ?? []).reduce((s: number, l: Row) => s + Number(l.quantity || 0), 0)}` },
          { key: 'total_amount', label: 'Total', right: true, render: (r) => money(r.total_amount) }, { key: 'mail', label: 'Supplier mail', render: (r) => <MailChip r={r} /> }, { key: 'status', label: 'Status', render: (r) => <Status s={r.status} /> },
          { key: 'a', label: 'Actions', render: (r) => <PoActions r={r} onView={() => setView(r)} onSend={() => void sendPo(r)} onReceive={() => receive(r)} onAct={(st) => void act(r, st)} onDel={() => void del(r)} /> }]} />
      {view && <Dialog eyebrow="PURCHASE ORDERS" title={`${view.po_number} · ${view.pharma_suppliers?.supplier_name ?? ''}`} onClose={() => setView(null)} wide>
        <div className="data-table-wrap"><table><thead><tr><th>Product</th><th>Ordered</th><th>Received</th><th>Rate</th><th>GST %</th></tr></thead><tbody>{(view.lines ?? []).map((l: Row, i: number) => <tr key={i}><td>{l.product_name}</td><td>{l.quantity}</td><td>{l.received_quantity}</td><td>{money(l.rate)}</td><td>{l.gst_percent}%</td></tr>)}</tbody></table></div>
        <div className="pd-total"><span>Subtotal {money(view.subtotal)}</span><span>GST {money(view.tax_amount)}</span><span>Total {money(view.total_amount)}</span></div>
        {view.supplier_mail_status && view.supplier_mail_status !== 'Not sent' && (
          <div className="po-thread">
            <p><b>✉ Emailed</b> to {view.supplier_mailed_to} · {fmtWhen(view.supplier_mailed_at)}</p>
            {view.supplier_mail_status === 'Replied'
              ? <><p><b>✓ Supplier replied</b> · {fmtWhen(view.supplier_replied_at)} · {view.supplier_reply_from}</p><pre>{view.supplier_reply_text}</pre></>
              : <p className="pd-muted">Waiting for the supplier's reply. It will appear here automatically.</p>}
          </div>
        )}
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
  const it = useIndustryId(); const { rows, err, loading, reload, setErr } = useList('/pharma/grn', it);
  const sup = useList('/pharma/suppliers', it); const pos = useList('/pharma/purchase-orders', it); const products = useProducts(it);
  const [search, setSearch] = useState(''); const [open, setOpen] = useState(false); const [f, setF] = useState<Row>({}); const [lines, setLines] = useState<Row[]>([]); const [view, setView] = useState<Row | null>(null); const [saving, setSaving] = useState(false); const [fe, setFe] = useState('');
  const shown = useFiltered(rows, search, 'all', ['grn_number', 'pharma_suppliers.supplier_name', 'supplier_invoice_no']);
  // "Receive goods" on a purchase order lands here with the order and its pending items already filled in
  useEffect(() => {
    if (!it || !pos.rows.length || !sup.rows.length) return;
    const raw = sessionStorage.getItem('pharma:grn-from-po'); if (!raw) return;
    sessionStorage.removeItem('pharma:grn-from-po');
    try {
      const po = pos.rows.find((x) => x.id === JSON.parse(raw).po_id); if (!po) return;
      setF({ grn_date: todayStr(), supplier_id: po.supplier_id }); setFe(''); setOpen(true); loadPo(String(po.id));
    } catch { /* ignore a bad hand-off */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it, pos.rows, sup.rows]);
  if (!it) return <Loading />;
  const month = rows.filter((r) => thisMonth(r.grn_date) && r.status !== 'Cancelled');
  const units = month.reduce((s, r) => s + (r.lines ?? []).reduce((a: number, l: Row) => a + Number(l.quantity || 0) + Number(l.free_quantity || 0), 0), 0);
  const openPos = pos.rows.filter((p) => p.supplier_id === f.supplier_id && ['Ordered', 'Partially Received'].includes(p.status));
  const loadPo = (poId: string) => {
    const po = pos.rows.find((p) => p.id === poId); setF((x) => ({ ...x, po_id: poId }));
    if (po) {
      const pending = (po.lines as Row[]).filter((l) => Number(l.quantity) > Number(l.received_quantity || 0)).map((l) => ({ product_code: l.product_code, quantity: Number(l.quantity) - Number(l.received_quantity || 0), rate: l.rate, gst_percent: l.gst_percent }));
      setLines(pending);
      // prefill MRP from the last batch of each product (batch no. and expiry still come from the supplier's invoice or the pack barcode)
      api<{ data: Row }>(`/pharma/grn-hints?codes=${encodeURIComponent(pending.map((l) => l.product_code).join(','))}&industryTypeId=${it}`)
        .then((h) => setLines((ls) => ls.map((l) => (l.mrp === undefined || l.mrp === '') && h.data?.[l.product_code]?.mrp != null ? { ...l, mrp: h.data[l.product_code].mrp } : l))).catch(() => undefined);
    }
  };
  const setL = (i: number, k: string, v: string) => setLines((ls) => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const onScan = async (code: string) => {
    try {
      const g = parseGs1(code); const tries = g?.gtin ? [g.gtin, g.gtin.replace(/^0+/, ''), g.gtin.slice(1)] : [code];
      let p: Row | null = null;
      for (const c of tries) { const r = await api<{ data: Row | null }>(`/pharma/scan?code=${encodeURIComponent(c)}&industryTypeId=${it}`); if (r.data?.product) { p = r.data.product as Row; break; } }
      if (!p) { setFe(`Code ${g?.gtin ?? code} is not linked to a product. Link it first in Scan & Barcodes.`); return; }
      setFe('');
      const fromGs1 = { ...(g?.batch ? { batch_number: g.batch } : {}), ...(g?.expiry ? { expiry_date: g.expiry } : {}), ...(g?.mfg ? { manufacture_date: g.mfg } : {}) };
      setLines((ls) => {
        // a second scan of the same product + batch adds one more unit instead of a new row
        const same = g?.batch ? ls.findIndex((l) => l.product_code === p!.product_code && l.batch_number === g.batch) : -1;
        if (same >= 0) return ls.map((l, j) => j === same ? { ...l, quantity: String(Number(l.quantity || 0) + 1) } : l);
        const open = ls.findIndex((l) => l.product_code === p!.product_code && !l.batch_number); // fill the PO row that is waiting for batch details
        if (open >= 0) return ls.map((l, j) => j === open ? { ...l, ...fromGs1 } : l);
        return [...ls, { product_code: p!.product_code, quantity: g?.batch ? '1' : '', rate: p!.cost_price ?? '', gst_percent: p!.tax_percent ?? '', ...fromGs1 }];
      });
    } catch (e) { setFe(msgOf(e)); }
  };
  const save = async () => { setSaving(true); setFe(''); try { await send('POST', '/pharma/grn', { ...f, lines, industryTypeId: it }); setOpen(false); await Promise.all([reload(), pos.reload()]); } catch (e) { setFe(msgOf(e)); } finally { setSaving(false); } };
  const addNew = () => { setF({ grn_date: todayStr() }); setLines([]); setFe(''); setOpen(true); };
  const cancelGrn = async (r: Row) => {
    const reason = window.prompt(`Reason for cancelling ${r.grn_number}? Its stock will be taken back out of the batches.`); if (reason === null) return;
    try { await send('POST', `/pharma/grn/${r.id}/cancel`, { reason, industryTypeId: it }); await Promise.all([reload(), pos.reload()]); } catch (e) { setErr(msgOf(e)); }
  };
  return (
    <Page eyebrow="GOODS RECEIPT (GRN)" title="Goods Receipt (GRN)" desc="Receiving goods creates the batch (or tops it up) with manufacture and expiry dates and adds the stock." error={err}
      kpis={[{ label: 'GRNs this month', value: month.length, sub: `${rows.length} in total`, icon: '📥' }, { label: 'Units received', value: units.toLocaleString('en-IN'), sub: 'this month incl. free', icon: '▦', tone: 'green' }, { label: 'Purchase value', value: money0(month.reduce((s, r) => s + Number(r.total_amount), 0)), sub: 'this month incl. GST', icon: '₹', tone: 'blue' }, { label: 'Open POs', value: pos.rows.filter((p) => ['Ordered', 'Partially Received'].includes(p.status)).length, sub: 'awaiting goods', icon: '⏳', tone: 'amber' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="GRNs" onAdd={addNew} addLabel="+ Add GRN" />}>
      <Table loading={loading} rows={shown} hasAny={rows.length > 0} emptyIcon="📥" emptyText="No goods received yet. Post a GRN when stock arrives." onAdd={addNew} addLabel="+ Add GRN"
        cols={[{ key: 'grn_number', label: 'GRN no.' }, { key: 's', label: 'Supplier', render: (r) => r.pharma_suppliers?.supplier_name ?? '—' }, { key: 'grn_date', label: 'Date', render: (r) => dShow(r.grn_date) }, { key: 'supplier_invoice_no', label: 'Supplier invoice' }, { key: 'n', label: 'Items', render: (r) => (r.lines ?? []).length }, { key: 'total_amount', label: 'Total', right: true, render: (r) => money(r.total_amount) }, { key: 'status', label: 'Status', render: (r) => <Status s={r.status} /> },
          { key: 'a', label: 'Actions', render: (r) => <div className="master-actions-inner po-actions"><button type="button" className="quiet-button" onClick={() => setView(r)}>View</button>{r.status !== 'Cancelled' && <button type="button" className="po-btn po-btn-danger" onClick={() => void cancelGrn(r)}>Cancel</button>}</div> }]} />
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
            <td style={{ minWidth: 200 }}><div style={{ display: 'flex', gap: 4 }}>
  <input value={l.batch_number ?? ''} onChange={(e) => setL(i, 'batch_number', e.target.value)} />
  <button type="button" className="quiet-button"
    title="Generate an internal batch number (use only when the supplier gives none)"
    disabled={!l.product_code}
    onClick={() => setL(i, 'batch_number', autoBatchNo(l.product_code))}>Auto</button>
</div></td>
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
      kpis={[{ label: 'Movements', value: rows.length, sub: 'latest 500', icon: '⇄' }, { label: 'Units in', value: inn.toLocaleString('en-IN'), sub: 'receipts, returns, restocks', icon: '↓', tone: 'green' }, { label: 'Units out', value: Math.abs(out).toLocaleString('en-IN'), sub: 'sales, purchase returns, write-offs', icon: '↑', tone: 'amber' }, { label: 'Units held', value: rows.reduce((t, r) => t + (Number(r.held_qty) || 0), 0).toLocaleString('en-IN'), sub: 'quarantine, damaged, expired returns', icon: '⏸', tone: 'amber' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="movements" />}>
      <Table loading={loading} rows={shown.map((r, i) => ({ ...r, id: r.id ?? i }))} hasAny={rows.length > 0} emptyIcon="⇄" emptyText="No stock movements yet."
        cols={[{ key: 'created_at', label: 'Date & time', render: (r) => new Date(r.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }, { key: 'product_name', label: 'Product' }, { key: 'batch_number', label: 'Batch' },
          { key: 'delta', label: 'Change', right: true, render: (r) => Number(r.held_qty) > 0 && Number(r.delta) === 0 ? <strong style={{ color: 'var(--amber,#b7791f)' }}>Held {r.held_qty}</strong> : <strong style={{ color: Number(r.delta) > 0 ? 'var(--green,#1b7a3d)' : 'var(--red,#c0392b)' }}>{Number(r.delta) > 0 ? '+' : ''}{r.delta}</strong> }, { key: 'location', label: 'Held at' }, { key: 'source', label: 'Source' }, { key: 'note', label: 'Note' }]} />
    </Page>
  );
}

// ---------------------------------------------------------------- Purchase Returns
export function PharmaPurchaseReturnsPage() {
  const it = useIndustryId(); const { rows, err, loading, reload, setErr } = useList('/pharma/purchase-returns', it);
  const sup = useList('/pharma/suppliers', it); const batches = useList('/pharma/batches', it);
  const [search, setSearch] = useState(''); const [open, setOpen] = useState(false); const [f, setF] = useState<Row>({}); const [lines, setLines] = useState<Row[]>([{}]); const [saving, setSaving] = useState(false); const [fe, setFe] = useState(''); const [view, setView] = useState<Row | null>(null); const [ok, setOk] = useState('');
  const [dlg, setDlg] = useState<{ kind: 'dispatch' | 'accept'; r: Row } | null>(null); const [df, setDf] = useState<Row>({});
  const shown = useFiltered(rows, search, 'all', ['return_number', 'pharma_suppliers.supplier_name', 'reason', 'status', 'credit_note_number']);
  if (!it) return <Loading />;
  const stock = batches.rows.filter((b) => Number(b.quantity) > 0);
  const setL = (i: number, k: string, v: string) => setLines((ls) => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const save = async () => { setSaving(true); setFe(''); try { await send('POST', '/pharma/purchase-returns', { ...f, lines, industryTypeId: it }); setOpen(false); await Promise.all([reload(), batches.reload()]); } catch (e) { setFe(msgOf(e)); } finally { setSaving(false); } };
  const sendRet = async (r: Row) => {
    try {
      const d = (await send('POST', `/pharma/automation/purchase-return/${r.id}/send`, { industryTypeId: it })).data as Row;
      if (d.whatsapp_link) window.open(String(d.whatsapp_link), '_blank');
      if (d.emailed) { setOk(`${r.return_number} emailed to ${d.to}.`); setErr(''); }
      else { setOk(''); setErr('Email is not set up, or the supplier has no email address.'); }
      await reload();
    } catch (e) { setErr(msgOf(e)); }
  };
  const checkReplies = async () => {
    setErr(''); setOk('Checking the mailbox…');
    try {
      const d = (await send('POST', '/pharma/automation/po/check-replies', { industryTypeId: it })).data as Row;
      if (!d.configured) { setOk(''); setErr('Reply tracking is not set up: SUPPLIER_REPLY_IMAP_HOST / USER / PASS are missing in the API .env file.'); }
      else if (d.error) { setOk(''); setErr(`Could not read the mailbox: ${d.error}`); }
      else setOk(`Checked ${d.candidates} email(s). ${d.updated} reply(ies) filed.${d.skipped?.length ? ` Not used: ${d.skipped.join(', ')}.` : ''}`);
      await reload();
    } catch (e) { setOk(''); setErr(msgOf(e)); }
  };
  const openDlg = (kind: 'dispatch' | 'accept', r: Row) => { setFe(''); setDf(kind === 'dispatch' ? { dispatch_date: todayStr() } : { accepted_date: todayStr(), accepted_amount: r.total_amount }); setDlg({ kind, r }); };
  const submitDlg = async () => {
    if (!dlg) return; setSaving(true); setFe('');
    try {
      await send('POST', `/pharma/automation/purchase-return/${dlg.r.id}/${dlg.kind}`, { ...df, industryTypeId: it });
      setOk(dlg.kind === 'dispatch' ? `${dlg.r.return_number} marked as dispatched.` : `${dlg.r.return_number} accepted. Supplier balance reduced.`); setErr(''); setDlg(null); await reload();
    } catch (e) { setFe(msgOf(e)); } finally { setSaving(false); }
  };
  const addNew = () => { setF({ return_date: todayStr() }); setLines([{}]); setFe(''); setOpen(true); };
  return (
    <Page eyebrow="PURCHASE RETURNS" title="Purchase Returns" desc="Send expired, damaged or wrong stock back to a supplier. Stock goes down when you post. The supplier balance goes down only when the supplier accepts and you enter their credit note." error={err} notice={ok}
      kpis={[{ label: 'Returns', value: rows.length, sub: 'all time', icon: '📤' }, { label: 'Awaiting supplier', value: rows.filter((r) => r.status !== 'Accepted').length, sub: money0(rows.filter((r) => r.status !== 'Accepted').reduce((s, r) => s + Number(r.total_amount), 0)) + ' not yet credited', icon: '⏳', tone: 'amber' }, { label: 'Credit received', value: money0(rows.filter((r) => r.status === 'Accepted').reduce((s, r) => s + Number(r.accepted_amount ?? r.total_amount), 0)), sub: 'reduces supplier dues', icon: '₹', tone: 'green' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="purchase returns" onAdd={addNew} addLabel="+ Add purchase return" />}>
      <style>{PO_CSS}</style>
      <div className="po-actions" style={{ justifyContent: 'flex-end', margin: '0 0 10px' }}><button type="button" className="po-btn" onClick={() => void checkReplies()} title="Read the mailbox now instead of waiting for the next automatic check">↻ Check supplier replies now</button></div>
      <Table loading={loading} rows={shown} hasAny={rows.length > 0} emptyIcon="📤" emptyText="No purchase returns yet." onAdd={addNew} addLabel="+ Add purchase return"
        cols={[{ key: 'return_number', label: 'Return no.' }, { key: 's', label: 'Supplier', render: (r) => r.pharma_suppliers?.supplier_name ?? '—' }, { key: 'return_date', label: 'Date', render: (r) => dShow(r.return_date) }, { key: 'reason', label: 'Reason' }, { key: 'total_amount', label: 'Credit value', right: true, render: (r) => money(r.total_amount) }, { key: 'mail', label: 'Supplier mail', render: (r) => <MailChip r={r} /> },
          { key: 'ship', label: 'Dispatch', render: (r) => r.dispatched_at ? <span className="po-mail po-mail-sent" title={r.dispatch_note ?? ''}><b>🚚 {r.dispatch_carrier}</b><small>{r.dispatch_tracking_no ? `${r.dispatch_tracking_no} · ` : ''}{dShow(r.dispatched_at)}</small></span> : <span className="po-mail po-mail-none">Not dispatched</span> },
          { key: 'status', label: 'Status', render: (r) => <Status s={r.status} /> },
          { key: 'a', label: 'Actions', render: (r) => <div className="master-actions-inner po-actions"><button type="button" className="po-btn" onClick={() => setView(r)}>{ico.eye}View</button><button type="button" className={r.supplier_mailed_at ? 'po-btn' : 'po-btn po-btn-primary'} onClick={() => void sendRet(r)}>{ico.send}{r.supplier_mailed_at ? 'Resend' : 'Send to supplier'}</button>{r.status !== 'Accepted' && <button type="button" className="po-btn" onClick={() => openDlg('dispatch', r)}>{ico.box}{r.dispatched_at ? 'Edit dispatch' : 'Mark dispatched'}</button>}{r.status !== 'Accepted' && <button type="button" className="po-btn po-btn-receive" onClick={() => openDlg('accept', r)}>{ico.check}Mark accepted</button>}</div> }]} />
      {view && <Dialog eyebrow="PURCHASE RETURNS" title={`${view.return_number} · ${view.pharma_suppliers?.supplier_name ?? ''}`} onClose={() => setView(null)} wide>
        <div className="data-table-wrap"><table><thead><tr><th>Product</th><th>Batch</th><th>Qty</th><th>Rate</th><th>GST %</th></tr></thead><tbody>{(view.lines ?? []).map((l: Row, i: number) => <tr key={i}><td>{l.product_name}</td><td>{l.batch_number}</td><td>{l.quantity}</td><td>{money(l.rate)}</td><td>{l.gst_percent}%</td></tr>)}</tbody></table></div>
        <div className="pd-total"><span>Subtotal {money(view.subtotal)}</span><span>GST {money(view.tax_amount)}</span><span>Credit value {money(view.total_amount)}</span></div>
        <div className="po-thread">
          <p><b>Status:</b> {view.status}</p>
          {view.supplier_mailed_at ? <p><b>✉ Emailed</b> to {view.supplier_mailed_to} · {fmtWhen(view.supplier_mailed_at)}</p> : <p className="pd-muted">Not emailed to the supplier yet.</p>}
          {view.supplier_mail_status === 'Replied' ? <><p><b>✓ Supplier replied</b> · {fmtWhen(view.supplier_replied_at)} · {view.supplier_reply_from}</p><pre>{view.supplier_reply_text}</pre></> : view.supplier_mailed_at && <p className="pd-muted">Waiting for the supplier's reply. It will appear here automatically.</p>}
          {view.dispatched_at && <p><b>🚚 Dispatched</b> via {view.dispatch_carrier}{view.dispatch_tracking_no ? ` · ${view.dispatch_tracking_no}` : ''} · {dShow(view.dispatched_at)}{view.dispatch_note ? ` · ${view.dispatch_note}` : ''}</p>}
          {view.status === 'Accepted' && <p><b>✓ Accepted</b> · credit note {view.credit_note_number} · {money(view.accepted_amount ?? view.total_amount)} · {dShow(view.accepted_at)}</p>}
        </div></Dialog>}
      {dlg && <Dialog eyebrow="PURCHASE RETURNS" title={`${dlg.kind === 'dispatch' ? 'Dispatch details' : 'Supplier acceptance'} · ${dlg.r.return_number}`} onClose={() => setDlg(null)}>
        {fe && <p role="alert" className="error">{fe}</p>}
        {dlg.kind === 'dispatch'
          ? <fieldset className="modal-fieldset"><legend>How the goods left your shop</legend><div className="fieldset-grid">
              <label>Courier / transport *<input value={df.carrier ?? ''} placeholder="e.g. DTDC, VRL, own van" onChange={(e) => setDf({ ...df, carrier: e.target.value })} /></label>
              <label>Tracking / LR number<input value={df.tracking_no ?? ''} onChange={(e) => setDf({ ...df, tracking_no: e.target.value })} /></label>
              <label>Dispatch date<input type="date" value={df.dispatch_date ?? ''} onChange={(e) => setDf({ ...df, dispatch_date: e.target.value })} /></label>
              <label>Note<input value={df.note ?? ''} onChange={(e) => setDf({ ...df, note: e.target.value })} /></label></div></fieldset>
          : <fieldset className="modal-fieldset"><legend>Credit note from the supplier</legend><div className="fieldset-grid">
              <label>Credit note number *<input value={df.credit_note_number ?? ''} onChange={(e) => setDf({ ...df, credit_note_number: e.target.value })} /></label>
              <label>Accepted amount (max {money(dlg.r.total_amount)})<input type="number" min="0" step="0.01" value={df.accepted_amount ?? ''} onChange={(e) => setDf({ ...df, accepted_amount: e.target.value })} /></label>
              <label>Credit note date<input type="date" value={df.accepted_date ?? ''} onChange={(e) => setDf({ ...df, accepted_date: e.target.value })} /></label></div>
              <p className="pd-muted">The supplier balance goes down by the accepted amount when you save.</p></fieldset>}
        <Actions onCancel={() => setDlg(null)} onSave={() => void submitDlg()} saving={saving} label={dlg.kind === 'dispatch' ? 'Save dispatch' : 'Mark accepted'} />
      </Dialog>}
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
  const it = useIndustryId(); const { rows, err, loading, reload } = useList('/pharma/supplier-payments', it); const bal = useList('/pharma/supplier-outstanding', it); const bills = useList('/pharma/automation/supplier-bills', it);
  const [search, setSearch] = useState(''); const [f, setF] = useState<Row | null>(null); const [ok, setOk] = useState(''); const [saving, setSaving] = useState(false); const [fe, setFe] = useState('');
  const shown = useFiltered(rows, search, 'all', ['payment_number', 'pharma_suppliers.supplier_name', 'reference_no', 'mode']);
  if (!it) return <Loading />;
  const due = bal.rows.reduce((s, r) => s + Math.max(0, Number(r.outstanding)), 0);
  const save = async () => { setSaving(true); setFe(''); try { await send('POST', '/pharma/supplier-payments', { ...f, industryTypeId: it }); setF(null); setOk('Payment recorded successfully.'); await Promise.all([reload(), bal.reload(), bills.reload()]); } catch (e) { setFe(msgOf(e)); } finally { setSaving(false); } };
  const cancelPay = async (r: Row) => { const reason = window.prompt(`Cancel payment ${r.payment_number}? Enter a reason:`); if (!reason || !reason.trim()) return; setOk(''); try { await send('POST', `/pharma/supplier-payments/${r.id}/cancel`, { reason: reason.trim(), industryTypeId: it }); setOk('Payment cancelled. The supplier balance has been restored.'); await Promise.all([reload(), bal.reload(), bills.reload()]); } catch (e) { setOk(''); setFe(msgOf(e)); } };
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
        cols={[{ key: 'payment_number', label: 'Payment no.' }, { key: 's', label: 'Supplier', render: (r) => r.pharma_suppliers?.supplier_name ?? '—' }, { key: 'payment_date', label: 'Date', render: (r) => dShow(r.payment_date) }, { key: 'mode', label: 'Mode' }, { key: 'reference_no', label: 'Reference' }, { key: 'grn', label: 'Bill (GRN)', render: (r) => r.pharma_grn?.grn_number ?? 'Oldest first' }, { key: 'amount', label: 'Amount', right: true, render: (r) => money(r.amount) }, { key: 'status', label: 'Status', render: (r) => <Status s={r.status ?? 'Posted'} /> }, { key: 'a', label: 'Actions', render: (r) => r.status === 'Cancelled' ? '—' : <button type="button" className="po-btn po-btn-danger" onClick={() => void cancelPay(r)}>Cancel</button> }]} />
      {f && <Dialog eyebrow="SUPPLIER PAYMENTS" title="Add supplier payment" onClose={() => setF(null)}>
        {fe && <p role="alert" className="error">{fe}</p>}
        <fieldset className="modal-fieldset"><legend>Payment details</legend><div className="fieldset-grid">
          <label>Supplier *<select value={f.supplier_id ?? ''} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}><option value="">Select supplier…</option>{bal.rows.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name} (due {money(s.outstanding)})</option>)}</select></label>
          <label>Against bill (optional)<select value={f.grn_id ?? ''} onChange={(e) => { const b = bills.rows.find((x) => x.grn_id === e.target.value); setF({ ...f, grn_id: e.target.value, amount: b ? b.open : f.amount }); }}><option value="">Oldest bill first</option>{bills.rows.filter((x) => x.supplier_id === f.supplier_id).map((x) => <option key={x.grn_id} value={x.grn_id}>{x.grn_number}{x.supplier_invoice_no ? ` · ${x.supplier_invoice_no}` : ''} (open {money(x.open)})</option>)}</select></label>
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
    <Page eyebrow="OUTSTANDING & AGEING" title="Customer Outstanding & Ageing" desc="What each pharmacy owes you: billed − collected − approved credit notes, aged by days past the invoice due date. Record payments in Collections." error={err}
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
  const [missingCn, setMissingCn] = useState<Row[]>([]);
  const loadMissingCn = () => { if (!it) return; api<{ data: Row[] }>(`/pharma/credit-notes/missing?industryTypeId=${encodeURIComponent(it)}`).then((r) => setMissingCn(r.data ?? [])).catch(() => setMissingCn([])); };
  useEffect(loadMissingCn, [it, rows.length]);
  useEffect(() => { if (!it) return; api<{ data: Row[] }>('/orders').then((r) => setOrders((r.data ?? []).filter((o) => o.clients?.industry_type_id === it))).catch(() => setOrders([])); }, [it, rows.length]);
  if (!it) return <Loading />;
  const live = rows.filter((r) => r.status !== 'Cancelled'); const invoiced = new Set(live.map((r) => r.order_id));
  const pending = orders.filter((o) => !invoiced.has(o.id) && !['cancelled', 'rejected', 'draft', 'pending_approval'].includes(o.status));
  const create = async (allowEarly = false) => { setSaving(true); setFe(''); try { const r = await send('POST', '/pharma/invoices', { order_id: orderId, industryTypeId: it, ...(allowEarly ? { allow_before_dispatch: true } : {}) }); setOpen(false); setOk(`Invoice ${r.data.invoice_number} created successfully.`); await reload(); }
    catch (e) { const m = msgOf(e); if (!allowEarly && m.startsWith('Goods not dispatched') && window.confirm(`${m}\n\nInvoice it now anyway?`)) { setSaving(false); await create(true); return; } setFe(m); } finally { setSaving(false); } };
  const show = async (r: Row) => { try { const d = await api<{ data: Row }>(`/pharma/invoices/${r.id}`); printInvoice(d.data); } catch (e) { setErr(msgOf(e)); } };
  const sendInv = async (r: Row) => {
    try {
      const d = (await send('POST', `/pharma/automation/invoice/${r.id}/send`, { industryTypeId: it })).data as Row;
      if (d.emailed) { setOk(`${r.invoice_number} emailed to ${d.to}.`); setErr(''); }
      else { setOk(''); setErr(d.to ? 'Email is not set up on the server, so the invoice was not sent.' : 'This customer has no email address. Add it in Customers & Pharmacies and try again.'); if (d.whatsapp_link) window.open(String(d.whatsapp_link), '_blank'); }
      await reload();
    } catch (e) { setErr(msgOf(e)); }
  };
  const cancel = async (r: Row) => {
    const reason = window.prompt('Reason for cancelling this invoice?'); if (reason === null) return;
    try { await send('POST', `/pharma/invoices/${r.id}/cancel`, { reason }); await reload(); }
    catch (e) {
      const m = msgOf(e);
      if (m.startsWith('Payments received') && window.confirm(`${m}\n\nCancel the invoice anyway?`)) { try { await send('POST', `/pharma/invoices/${r.id}/cancel`, { reason, confirm_paid: true }); await reload(); } catch (e2) { setErr(msgOf(e2)); } }
      else setErr(m);
    }
  };
  const einvoice = async (r: Row) => {
    try {
      const d = (await api<{ data: { payload: Row; missing: string[]; warnings: string[] } }>(`/pharma/invoices/${r.id}/einvoice-json`)).data;
      if (d.missing.length && !window.confirm(`The IRP will reject this invoice until these are fixed:\n\n• ${d.missing.join('\n• ')}\n\nDownload the JSON anyway?`)) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify([d.payload], null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `einvoice-${String(r.invoice_number).replace(/[^A-Za-z0-9-]/g, '_')}.json`; a.click(); URL.revokeObjectURL(url);
      setErr(''); setOk(d.warnings.length ? `e-Invoice JSON downloaded. Note: ${d.warnings.join(' ')}` : `e-Invoice JSON for ${r.invoice_number} downloaded. Upload it to the IRP / your GSP to get the IRN.`);
    } catch (e) { setErr(msgOf(e)); }
  };
  const reissueCn = async () => {
    try {
      const out = (await send('POST', '/pharma/credit-notes/reissue', { industryTypeId: it })).data as unknown as Row[];
      const done = out.filter((x) => x.ok).length; const failed = out.filter((x) => !x.ok);
      setOk(`${done} credit note(s) issued.`); setErr(failed.length ? failed.map((x) => `${x.return_code}: ${x.reason}`).join(' · ') : '');
      loadMissingCn();
    } catch (e) { setErr(msgOf(e)); }
  };
  const addNew = () => { setErr(''); setOk(''); setFe(''); setOrderId(''); setOpen(true); };
  return (
    <Page eyebrow="GST SALES INVOICES" title="GST Sales Invoices" desc="Tax invoices from confirmed sales orders. CGST + SGST or IGST is decided from the GSTIN states, and batch & expiry print on every line." error={err} notice={ok}
      kpis={[{ label: 'Invoices', value: live.length, sub: `${rows.length - live.length} cancelled`, icon: '🧮' }, { label: 'Billed value', value: money0(live.reduce((s, r) => s + Number(r.total_amount), 0)), sub: 'incl. GST', icon: '₹', tone: 'blue' }, { label: 'GST charged', value: money0(live.reduce((s, r) => s + Number(r.cgst_amount) + Number(r.sgst_amount) + Number(r.igst_amount), 0)), sub: 'CGST + SGST + IGST', icon: '%', tone: 'green' }, { label: 'Orders to invoice', value: pending.length, sub: 'confirmed, not yet billed', icon: '⏳', tone: 'amber' }]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="invoices" statuses={['Issued', 'Cancelled']} status={status} setStatus={setStatus} onAdd={addNew} addLabel="+ Add invoice" />}>
      <style>{PO_CSS}</style>
      {missingCn.length > 0 && <p role="alert" className="error">{missingCn.length} approved return(s) have no GST credit note yet ({missingCn.slice(0, 5).map((m) => m.return_code).join(', ')}{missingCn.length > 5 ? '…' : ''}). <button type="button" className="po-btn po-btn-primary" onClick={() => void reissueCn()}>Issue missing credit notes</button></p>}
      <Table loading={loading} rows={shown} hasAny={rows.length > 0} emptyIcon="🧮" emptyText="No invoices yet. Create one from a confirmed sales order." onAdd={addNew} addLabel="+ Add invoice"
        cols={[{ key: 'invoice_number', label: 'Invoice no.' }, { key: 'c', label: 'Customer', render: (r) => r.clients?.client_name ?? '—' }, { key: 'invoice_date', label: 'Date', render: (r) => dShow(r.invoice_date) }, { key: 'due_date', label: 'Due', render: (r) => dShow(r.due_date) }, { key: 'supply_type', label: 'Supply' }, { key: 'taxable_amount', label: 'Taxable', right: true, render: (r) => money(r.taxable_amount) }, { key: 'gst', label: 'GST', right: true, render: (r) => money(Number(r.cgst_amount) + Number(r.sgst_amount) + Number(r.igst_amount)) }, { key: 'total_amount', label: 'Total', right: true, render: (r) => <strong>{money(r.total_amount)}</strong> }, { key: 'balance_amount', label: 'Balance', right: true, render: (r) => r.payment_status ? money(r.balance_amount) : '—' }, { key: 'payment_status', label: 'Payment', render: (r) => r.payment_status ? <Status s={r.payment_status} /> : '—' }, { key: 'mail', label: 'Client mail', render: (r) => r.client_mailed_at ? <span className="po-mail po-mail-sent" title={`Emailed to ${r.client_mailed_to ?? ''}`}><b>✉ Sent</b><small>{fmtWhen(r.client_mailed_at)}</small></span> : <span className="po-mail po-mail-none">Not sent</span> }, { key: 'status', label: 'Status', render: (r) => <Status s={r.status} /> },
          { key: 'a', label: 'Actions', render: (r) => <div className="master-actions-inner po-actions"><button type="button" className="po-btn" onClick={() => void show(r)}>Print</button>{r.status !== 'Cancelled' && <button type="button" className="po-btn" title="Download the NIC e-invoice (IRP) JSON" onClick={() => void einvoice(r)}>e-Invoice JSON</button>}{r.status !== 'Cancelled' && <button type="button" className={r.client_mailed_at ? 'po-btn' : 'po-btn po-btn-primary'} onClick={() => void sendInv(r)}>{ico.send}{r.client_mailed_at ? 'Resend' : 'Send to client'}</button>}{r.status !== 'Cancelled' && <button type="button" className="po-btn po-btn-danger" onClick={() => void cancel(r)}>Cancel</button>}</div> }]} />
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
const REPORTS: [string, string][] = [['sales', 'Sales (GST)'], ['credit-notes', 'Credit notes (GST)'], ['purchase', 'Purchases'], ['debit-notes', 'Debit notes (GST)'], ['gstr1', 'GSTR-1 register'], ['hsn', 'HSN summary'], ['gstr3b', 'GSTR-3B summary'], ['schedule-register', 'Schedule drug register'], ['inventory', 'Batch stock'], ['expiry', 'Expiry (180 days)'], ['low-stock', 'Low stock'], ['customer-outstanding', 'Customer outstanding'], ['supplier-outstanding', 'Supplier payables']];
const REPORT_GROUPS: { title: string; hint: string; keys: string[] }[] = [
  { title: 'GST & returns', hint: 'Filing registers', keys: ['sales', 'credit-notes', 'debit-notes', 'gstr1', 'gstr3b', 'hsn'] },
  { title: 'Purchases', hint: 'Buying from suppliers', keys: ['purchase'] },
  { title: 'Stock & compliance', hint: 'Batches, expiry, drugs', keys: ['inventory', 'expiry', 'low-stock', 'schedule-register'] },
  { title: 'Outstanding', hint: 'Who owes whom', keys: ['customer-outstanding', 'supplier-outstanding'] },
];
const RPT_CSS = `
.rpt-picker{border:1px solid #e5e2d8;border-radius:14px;background:#fff;margin:0 0 16px;overflow:hidden}
.rpt-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid #eeebe1;background:#faf9f5}
.rpt-head h4{margin:0;font-size:16px}
.rpt-head small{display:block;color:#6b7280;margin-top:2px;font-size:12.5px}
.rpt-group{display:grid;grid-template-columns:190px 1fr;gap:12px;align-items:center;padding:12px 18px;border-bottom:1px solid #f1eee5}
.rpt-group:last-child{border-bottom:0}
.rpt-group b{display:block;font-size:13px;color:#111827}
.rpt-group small{color:#6b7280;font-size:11.5px}
.rpt-pills{display:flex;flex-wrap:wrap;gap:8px}
.rpt-pill{height:34px;padding:0 14px;border-radius:999px;border:1px solid #d6d3c9;background:#fff;color:#1f2937;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s ease}
.rpt-pill:hover{border-color:#111827;background:#f3f1ea}
.rpt-pill.on{background:#111827;color:#fff;border-color:#111827;box-shadow:0 2px 6px rgba(17,24,39,.25)}
.rpt-dates{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rpt-dates label{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:#4b5563}
.rpt-dates input,.rpt-dates select{height:38px;border:1px solid #d6d3c9;border-radius:10px;padding:0 10px;background:#fff;font-size:13px}
@media(max-width:800px){.rpt-group{grid-template-columns:1fr}}
`;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function rangeFor(k: string): [string, string] {
  const n = new Date(); const y = n.getFullYear(); const m = n.getMonth();
  if (k === 'month') return [isoDay(new Date(y, m, 1)), isoDay(new Date(y, m + 1, 0))];
  if (k === 'last') return [isoDay(new Date(y, m - 1, 1)), isoDay(new Date(y, m, 0))];
  if (k === 'fy') { const sy = m >= 3 ? y : y - 1; return [`${sy}-04-01`, `${sy + 1}-03-31`]; }
  return ['', ''];
}
export function PharmaReportsPage({ kind: fixedKind }: { kind?: string } = {}) {
  const it = useIndustryId(); const [pickedKind, setKind] = useState('sales'); const kind = fixedKind ?? pickedKind; const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [rows, setRows] = useState<Row[]>([]); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false); const [search, setSearch] = useState('');
  useEffect(() => { setSearch(''); setFrom(''); setTo(''); setRows([]); setErr(''); }, [fixedKind]);
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
  const dated = ['sales', 'purchase', 'credit-notes', 'debit-notes', 'gstr1', 'hsn', 'gstr3b', 'schedule-register'].includes(kind); const label = REPORTS.find(([k]) => k === kind)?.[1] ?? '';
  const totalKey = keys.find((k) => ['total', 'stock_value', 'outstanding', 'shortfall'].includes(k));
  const moneyKey = (k: string) => /rate|value|total|amount|taxable|cgst|sgst|igst|paid|billed|collected|outstanding|purchased|returned|b0_30|b31_60|b61_90|b90_plus|limit/.test(k);
  return (
    <Page eyebrow="REPORTS" title={fixedKind ? label : 'Pharma Reports'} desc="Report for this industry only. Search, filter by date and download as CSV." error={err}
      kpis={[{ label: 'Rows', value: shown.length, sub: label, icon: '📊' }, ...(totalKey ? [{ label: totalKey.replace(/_/g, ' '), value: totalKey === 'shortfall' ? shown.reduce((s, r) => s + Number(r[totalKey] || 0), 0) : money0(shown.reduce((s, r) => s + Number(r[totalKey] || 0), 0)), sub: 'sum of shown rows', icon: '₹', tone: 'blue' as const }] : [])]}
      toolbar={<Toolbar search={search} setSearch={setSearch} label="rows" extra={dated ? <div className="rpt-dates"><label>Period<select key={kind} defaultValue="all" onChange={(e) => { const [f2, t2] = rangeFor(e.target.value); setFrom(f2); setTo(t2); }}><option value="all">All time</option><option value="month">This month</option><option value="last">Last month</option><option value="fy">This financial year</option></select></label><label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div> : undefined} />}>
      <style>{RPT_CSS}</style>
      <div className="rpt-picker">
        <div className="rpt-head"><div>{!fixedKind && <h4>{label}</h4>}<small style={fixedKind ? { margin: 0, fontSize: 13 } : undefined}>{shown.length} row{shown.length === 1 ? '' : 's'}{dated && (from || to) ? ` · ${from || 'start'} to ${to || 'today'}` : ''}</small></div><button type="button" className="primary-action" disabled={!rows.length} onClick={csv}>Download CSV</button></div>
        {!fixedKind && REPORT_GROUPS.map((g) => <div className="rpt-group" key={g.title}><div><b>{g.title}</b><small>{g.hint}</small></div><div className="rpt-pills">{g.keys.map((k) => <button key={k} type="button" className={`rpt-pill${kind === k ? ' on' : ''}`} onClick={() => { setKind(k); setSearch(''); }}>{REPORTS.find(([x]) => x === k)?.[1] ?? k}</button>)}</div></div>)}
      </div>
      <Table loading={loading} rows={shown.map((r, i) => ({ ...r, id: i }))} hasAny={rows.length > 0} emptyIcon="📊" emptyText="No data for this report yet." cols={keys.map((k) => ({ key: k, label: k.replace(/_/g, ' '), right: isNum(k), render: (r: Row) => (typeof r[k] === 'number' ? (moneyKey(k) ? money(r[k]) : r[k]) : (r[k] === null || r[k] === '' || r[k] === undefined ? '—' : String(r[k]))) }))} />
    </Page>
  );
}