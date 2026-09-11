import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import './MasterDataPages.css';

type Product = {
  id: string;
  product_code: string;
  product_name: string;
  category?: string | null;
  selling_price: number;
  stock_quantity?: number | null;
  status: 'active' | 'inactive';
  // Not present on every deployment yet — same lenient scoping used by
  // ProductsPage/useIndustryScope: products without this field simply
  // aren't hidden when switching industries.
  industry_type_id?: string | null;
};

// Batch/expiry fields have no backend column yet — persisted client-side in
// localStorage, keyed by product id. This is the SAME key used by the Products
// page's FMCG details tab, so edits here stay in sync with product records there.
const FMCG_META_PREFIX = 'fs-fmcg-product-meta:';
type FmcgMeta = {
  barcode: string;
  brand: string;
  subCategory: string;
  unit: string;
  packSize: string;
  mrp: string;
  discountPercent: string;
  taxPercent: string;
  batchNumber: string;
  mfgDate: string;
  expiryDate: string;
  minStockLevel: string;
};
const blankFmcgMeta: FmcgMeta = {
  barcode: '', brand: '', subCategory: '', unit: 'pcs', packSize: '', mrp: '', discountPercent: '', taxPercent: '',
  batchNumber: '', mfgDate: '', expiryDate: '', minStockLevel: '',
};
function loadFmcgMeta(productId: string): FmcgMeta {
  try {
    const raw = window.localStorage.getItem(`${FMCG_META_PREFIX}${productId}`);
    return raw ? { ...blankFmcgMeta, ...JSON.parse(raw) } : blankFmcgMeta;
  } catch {
    return blankFmcgMeta;
  }
}
function saveFmcgMeta(productId: string, meta: FmcgMeta) {
  try {
    window.localStorage.setItem(`${FMCG_META_PREFIX}${productId}`, JSON.stringify(meta));
  } catch {
    /* best-effort */
  }
}
function loadAllFmcgMeta(): Record<string, FmcgMeta> {
  const out: Record<string, FmcgMeta> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(FMCG_META_PREFIX)) {
        const productId = key.slice(FMCG_META_PREFIX.length);
        out[productId] = loadFmcgMeta(productId);
      }
    }
  } catch {
    /* best-effort */
  }
  return out;
}

const currency = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

type ExpiryTone = 'expired' | 'critical' | 'warn' | 'ok' | 'unset';
function expiryInfo(expiryDate: string): { tone: ExpiryTone; label: string; days: number | null } {
  if (!expiryDate) return { tone: 'unset', label: 'Not recorded', days: null };
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { tone: 'expired', label: `Expired ${Math.abs(days)}d ago`, days };
  if (days <= 7) return { tone: 'critical', label: `Expires in ${days}d`, days };
  if (days <= 30) return { tone: 'warn', label: `Expires in ${days}d`, days };
  return { tone: 'ok', label: `Expires in ${days}d`, days };
}
const toneBadgeClass: Record<ExpiryTone, string> = {
  expired: 'status-badge status-cancelled',
  critical: 'status-badge status-cancelled',
  warn: 'status-badge status-quoted',
  ok: 'status-badge status-completed',
  unset: 'status-badge',
};

export function BatchExpiryPage() {
  const { matchesActiveIndustry, activeIndustryTypeId } = useIndustryScope();
  const [products, setProducts] = useState<Product[]>([]);
  const [metaMap, setMetaMap] = useState<Record<string, FmcgMeta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [search, setSearch] = useState('');
  const [toneFilter, setToneFilter] = useState<'all' | ExpiryTone>('all');

  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<{ batchNumber: string; mfgDate: string; expiryDate: string; minStockLevel: string }>({
    batchNumber: '', mfgDate: '', expiryDate: '', minStockLevel: '',
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ data: Product[] }>('/products');
      setProducts(res.data ?? []);
      setMetaMap(loadAllFmcgMeta());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load products.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    return products
      .filter((p) => p.status === 'active' && matchesActiveIndustry(p.industry_type_id))
      .map((p) => {
        const meta = metaMap[p.id] ?? blankFmcgMeta;
        const info = expiryInfo(meta.expiryDate);
        const stockValue = (p.stock_quantity ?? 0) * Number(p.selling_price || 0);
        return { product: p, meta, info, stockValue };
      })
      .sort((a, b) => {
        if (a.info.days == null) return 1;
        if (b.info.days == null) return -1;
        return a.info.days - b.info.days;
      });
  }, [products, metaMap, activeIndustryTypeId]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (toneFilter !== 'all' && r.info.tone !== toneFilter) return false;
      if (!q) return true;
      return (
        r.product.product_name.toLowerCase().includes(q) ||
        r.product.product_code.toLowerCase().includes(q) ||
        r.meta.batchNumber.toLowerCase().includes(q)
      );
    });
  }, [rows, search, toneFilter]);

  function openEdit(product: Product) {
    const meta = metaMap[product.id] ?? blankFmcgMeta;
    setEditing(product);
    setForm({ batchNumber: meta.batchNumber, mfgDate: meta.mfgDate, expiryDate: meta.expiryDate, minStockLevel: meta.minStockLevel });
    setMessage('');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const existing = metaMap[editing.id] ?? blankFmcgMeta;
      const next: FmcgMeta = { ...existing, batchNumber: form.batchNumber.trim(), mfgDate: form.mfgDate, expiryDate: form.expiryDate, minStockLevel: form.minStockLevel };
      saveFmcgMeta(editing.id, next);
      setMetaMap((m) => ({ ...m, [editing.id]: next }));
      setMessage('Batch & expiry details updated successfully.');
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  const expiredCount = rows.filter((r) => r.info.tone === 'expired').length;
  const criticalCount = rows.filter((r) => r.info.tone === 'critical').length;
  const warnCount = rows.filter((r) => r.info.tone === 'warn').length;
  const atRiskValue = rows.filter((r) => r.info.tone === 'expired' || r.info.tone === 'critical' || r.info.tone === 'warn').reduce((sum, r) => sum + r.stockValue, 0);

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">FMCG · BATCH &amp; EXPIRY MANAGEMENT</p>
          <h2>Batch &amp; expiry management</h2>
          <p>Track batch numbers and expiry dates across active products, sorted by urgency, so nothing goes stale on the shelf unnoticed.</p>
        </div>
      </div>
      <div className="kpi-grid">
        <div className="kpi-card" data-tone="red">
          <div className="kpi-icon">⚠</div>
          <div>
            <span>Expired</span>
            <strong>{expiredCount}</strong>
            <small>pull from stock</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="red">
          <div className="kpi-icon">◷</div>
          <div>
            <span>Expiring within 7 days</span>
            <strong>{criticalCount}</strong>
            <small>urgent — push or discount</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="amber">
          <div className="kpi-icon">⏱</div>
          <div>
            <span>Expiring within 30 days</span>
            <strong>{warnCount}</strong>
            <small>plan ahead</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon">₹</div>
          <div>
            <span>Stock value at risk</span>
            <strong>{currency(atRiskValue)}</strong>
            <small>expired + expiring ≤30d</small>
          </div>
        </div>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input
            type="search"
            placeholder="Search product, code or batch number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={toneFilter} onChange={(e) => setToneFilter(e.target.value as 'all' | ExpiryTone)}>
            <option value="all">All products</option>
            <option value="expired">Expired</option>
            <option value="critical">Expiring ≤7 days</option>
            <option value="warn">Expiring ≤30 days</option>
            <option value="ok">OK</option>
            <option value="unset">No expiry recorded</option>
          </select>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}
      {message && <p className={message.includes('successfully') ? 'success-message' : 'error-message'}>{message}</p>}

      {loading ? (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr><th>Product</th><th>Batch no.</th><th>Mfg date</th><th>Expiry</th><th>Stock</th><th>Value at risk</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map((i) => (
                <tr key={i} className="skeleton-row">
                  <td><span className="skeleton-block" style={{ width: '75%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '50%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '65%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '30%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '40%' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr><th>Product</th><th>Batch no.</th><th>Mfg date</th><th>Expiry</th><th>Stock</th><th>Value at risk</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filteredRows.map(({ product, meta, info, stockValue }) => (
                <tr key={product.id}>
                  <td>
                    <strong>{product.product_name}</strong>
                    <small>{product.product_code}</small>
                  </td>
                  <td>{meta.batchNumber || '—'}</td>
                  <td>{meta.mfgDate || '—'}</td>
                  <td>
                    <span className={toneBadgeClass[info.tone]}>{info.label}</span>
                  </td>
                  <td>{product.stock_quantity ?? '—'}</td>
                  <td className={info.tone === 'expired' || info.tone === 'critical' || info.tone === 'warn' ? 'text-warn' : ''}>
                    {stockValue > 0 && (info.tone === 'expired' || info.tone === 'critical' || info.tone === 'warn') ? currency(stockValue) : '—'}
                  </td>
                  <td className="master-actions">
                    <button type="button" className="icon-action" title="Edit batch / expiry" aria-label={`Edit batch details for ${product.product_name}`} onClick={() => openEdit(product)}>
                      ✎
                    </button>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-row">
                    <div className="empty-state">
                      <span className="empty-state-icon">⏱</span>
                      <p>No active products match your search or filters.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setEditing(null)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="batch-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">BATCH &amp; EXPIRY</p>
                <h3 id="batch-modal-title">{editing.product_name}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <form className="master-modal-form" onSubmit={submit}>
              <label>
                Batch number
                <input value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} placeholder="e.g. B-2026-0417" />
              </label>
              <label>
                Min stock level
                <input type="number" min="0" value={form.minStockLevel} onChange={(e) => setForm({ ...form, minStockLevel: e.target.value })} />
              </label>
              <label>
                Manufacturing date
                <input type="date" value={form.mfgDate} onChange={(e) => setForm({ ...form, mfgDate: e.target.value })} />
              </label>
              <label>
                Expiry date
                <input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
              </label>
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setEditing(null)} disabled={saving}>
                  Cancel
                </button>
                <button className="primary-action" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>  
      )}
    </section>
  );
}