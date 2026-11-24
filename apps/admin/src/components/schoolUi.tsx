/* eslint-disable @typescript-eslint/no-explicit-any */
import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { useIndustry } from '../industry/IndustryContext';
import { useIndustryScope } from '../industry/useIndustryScope';

// Shared building blocks for the School distributor pages (purchase orders, goods receipt, payments, invoices, credit notes).
// Only School pages import this file.

export type Row = Record<string, any>;
export type Product = {
  id: string; product_code: string; product_name: string; unit?: string | null; category?: string | null; hsn_code?: string | null; specification?: string | null;
  supplier_name?: string | null; tax_percent?: number | null; cost_price?: number | null; stock_quantity?: number | null; min_stock_level?: number | null;
};

export const money = (v: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v ?? 0));
export const num = (v: unknown) => Number(v ?? 0) || 0;
export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
export const messageOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
export const isoToday = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
export const label = (p: Product) => `${p.product_code} — ${p.product_name}`;
export const sameName = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
export const at = (v: unknown) => (v ? new Date(String(v)).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const day = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
export const post = <T,>(path: string, payload: unknown, method = 'POST') => api<{ data: T }>(path, { method, body: JSON.stringify(payload) });


// ------------------------------------------------------------------------------------------ look and feel
export const card: CSSProperties = { flex: '1 1 190px', border: '1px solid #e5e2da', borderRadius: 12, padding: '12px 16px', background: '#fff' };
export const cardLabel: CSSProperties = { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: '#6b675d', margin: 0 };
export const cardValue: CSSProperties = { fontSize: 22, fontWeight: 700, margin: '4px 0 0' };
export const hint: CSSProperties = { fontSize: 12, color: '#6b675d' };
export const chip = (active: boolean): CSSProperties => ({ border: '1px solid ' + (active ? '#111827' : '#d9d5ca'), background: active ? '#111827' : '#fff', color: active ? '#fff' : '#111827', borderRadius: 999, padding: '5px 12px', fontSize: 13, cursor: 'pointer' });

const TONES: Record<string, { bg: string; fg: string }> = {
  green: { bg: '#ecfdf3', fg: '#067647' }, red: { bg: '#fef3f2', fg: '#b42318' }, amber: { bg: '#fffaeb', fg: '#b54708' },
  blue: { bg: '#eff8ff', fg: '#175cd3' }, gray: { bg: '#f2f4f7', fg: '#475467' }, purple: { bg: '#f4f3ff', fg: '#5925dc' },
};
export function Pill({ text, tone = 'gray', title }: { text: string; tone?: keyof typeof TONES | string; title?: string }) {
  const t = TONES[tone] ?? TONES.gray;
  return <span title={title} style={{ background: t.bg, color: t.fg, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{text}</span>;
}
export function Kpis({ items }: { items: { label: string; value: ReactNode; tone?: 'red' | 'green'; sub?: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '8px 0 14px' }}>
      {items.map((k) => (
        <div key={k.label} style={card}>
          <p style={cardLabel}>{k.label}</p>
          <p style={{ ...cardValue, color: k.tone === 'red' ? '#b42318' : k.tone === 'green' ? '#067647' : undefined }}>{k.value}</p>
          {k.sub && <p style={{ ...hint, margin: '2px 0 0' }}>{k.sub}</p>}
        </div>
      ))}
    </div>
  );
}
export function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{options.map((o) => <button key={o} type="button" style={chip(value === o)} onClick={() => onChange(o)}>{o}</button>)}</span>;
}
export function PageShell({ module, title, description, kpis, actions, error, message, children }: { module: string; title: string; description: string; kpis?: ReactNode; actions?: ReactNode; error?: string; message?: string; children: ReactNode }) {
  const { config } = useIndustry();
  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading"><div><p className="eyebrow">{config.label.toUpperCase()} · {module}</p><h2>{title}</h2><p>{description}</p></div></div>
      {kpis}
      {actions && <div className="master-toolbar" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
      {error && <p className="error-message">{error}</p>}
      {message && <p className="success-message">{message}</p>}
      {children}
    </section>
  );
}
/** Opens a printable page. `body` is trusted HTML built with esc(). */
export function openPrint(title: string, body: string) {
  const w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<!doctype html><title>${esc(title)}</title><style>body{font:13px Arial;margin:28px;color:#111}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:6px}th{background:#f1f1f1}.r{text-align:right}h2{margin:0}.cols{display:flex;justify-content:space-between;gap:24px;margin:10px 0}</style>${body}<script>window.print()</script>`);
  w.document.close();
}

// ------------------------------------------------------------------------------------------ data + dialogs
export function useRows<T = Row>(path: string) {
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


export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop modal-backdrop--center" role="dialog" aria-modal="true">
      <div className={`master-modal master-modal--center${wide ? ' master-modal--wide' : ''}`} style={{ width: wide ? undefined : 'min(900px, 96vw)', maxWidth: '96vw', maxHeight: '94vh', overflowY: 'auto' }}>
        <div className="modal-heading"><h3>{title}</h3><button type="button" className="quiet-button" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}


/** Active products of this industry, straight from the Product module. */
export function useProducts(industryId: string | null) {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    if (!industryId) return;
    api<{ data: Product[] }>(`/products?status=active&industryTypeId=${industryId}`).then((r) => setProducts(r.data ?? [])).catch(() => setProducts([]));
  }, [industryId]);
  return products;
}
/** The company profile (Company & GST page): printed on documents. */
export function useCompany(industryId: string | null) {
  const [company, setCompany] = useState<Row | null>(null);
  useEffect(() => {
    if (!industryId) return;
    api<{ data: Row | null }>(`/school/company-profile?industryTypeId=${industryId}`).then((r) => setCompany(r.data)).catch(() => setCompany(null));
  }, [industryId]);
  return company;
}

// ------------------------------------------------------------------------------------------ product dropdown
const GRID = '128px minmax(180px, 1fr) 86px 96px 56px 84px 96px';

// ------------------------------------------------------------------------------------------ product dropdown
export function ProductCombobox({ products, value, onPick, supplierId, supplierName, lastPaid }: {
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