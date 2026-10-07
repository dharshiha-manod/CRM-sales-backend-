import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { kpiClick } from '../lib/kpiClick';
import { KpiDetailModal } from './KpiDetailModal';
import './MasterDataPages.css';

type Product = { id: string; product_code: string; product_name: string; selling_price: number; stock_quantity?: number | null; status: 'active' | 'inactive'; industry_type_id?: string | null };
type Batch = { id: string; product_id: string; batch_no: string; mfg_date: string | null; expiry_date: string | null; quantity: number };
type BatchForm = { productId: string; batchNo: string; mfgDate: string; expiryDate: string; quantity: string; isNewStock: boolean };
const blankForm: BatchForm = { productId: '', batchNo: '', mfgDate: '', expiryDate: '', quantity: '', isNewStock: false };

const currency = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

type ExpiryTone = 'expired' | 'critical' | 'warn' | 'ok' | 'unset';
function expiryInfo(expiryDate: string | null): { tone: ExpiryTone; label: string; days: number | null } {
  if (!expiryDate) return { tone: 'unset', label: 'Not recorded', days: null };
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { tone: 'expired', label: `Expired ${Math.abs(days)}d ago`, days };
  if (days <= 7) return { tone: 'critical', label: `Expires in ${days}d`, days };
  if (days <= 30) return { tone: 'warn', label: `Expires in ${days}d`, days };
  return { tone: 'ok', label: `Expires in ${days}d`, days };
}
const toneBadgeClass: Record<ExpiryTone, string> = { expired: 'status-badge status-cancelled', critical: 'status-badge status-cancelled', warn: 'status-badge status-quoted', ok: 'status-badge status-completed', unset: 'status-badge' };

export function BatchExpiryPage() {
  const { matchesActiveIndustry, activeIndustryTypeId } = useIndustryScope();
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [toneFilter, setToneFilter] = useState<'all' | ExpiryTone>('all');
  const [showAtRisk, setShowAtRisk] = useState(false);
  const [modal, setModal] = useState<{ editing: Batch | null } | null>(null);
  const [form, setForm] = useState<BatchForm>(blankForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, b] = await Promise.all([api<{ data: Product[] }>('/products'), api<{ data: Batch[] }>('/fmcg/batches')]);
      setProducts(p.data ?? []);
      setBatches(b.data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load batches.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [activeIndustryTypeId]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const scopedProducts = useMemo(() => products.filter((p) => p.status === 'active' && matchesActiveIndustry(p.industry_type_id)), [products, activeIndustryTypeId]);

  const rows = useMemo(() => batches
    .map((batch) => {
      const product = productById.get(batch.product_id);
      const info = expiryInfo(batch.expiry_date);
      return { batch, product, info, stockValue: Number(batch.quantity) * Number(product?.selling_price ?? 0) };
    })
    .filter((r) => r.product && matchesActiveIndustry(r.product.industry_type_id))
    .sort((a, b) => (a.info.days == null ? 1 : b.info.days == null ? -1 : a.info.days - b.info.days)), [batches, productById, activeIndustryTypeId]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (toneFilter !== 'all' && r.info.tone !== toneFilter) return false;
      if (!q) return true;
      return (r.product?.product_name ?? '').toLowerCase().includes(q) || (r.product?.product_code ?? '').toLowerCase().includes(q) || r.batch.batch_no.toLowerCase().includes(q);
    });
  }, [rows, search, toneFilter]);

  // Stock that is not yet inside any batch (so the manager can see what still needs a batch number).
  const unbatched = useMemo(() => scopedProducts.map((p) => ({ product: p, free: Number(p.stock_quantity ?? 0) - batches.filter((b) => b.product_id === p.id).reduce((s, b) => s + Number(b.quantity), 0) })).filter((x) => x.free > 0), [scopedProducts, batches]);

  function openAdd() { setForm(blankForm); setMessage(''); setModal({ editing: null }); }
  function openEdit(batch: Batch) { setForm({ productId: batch.product_id, batchNo: batch.batch_no, mfgDate: batch.mfg_date ?? '', expiryDate: batch.expiry_date ?? '', quantity: String(batch.quantity), isNewStock: false }); setMessage(''); setModal({ editing: batch }); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!modal) return;
    setSaving(true);
    setMessage('');
    try {
      const quantity = Number(form.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Enter a valid quantity.');
      if (modal.editing) {
        await api(`/fmcg/batches/${modal.editing.id}`, { method: 'PATCH', body: JSON.stringify({ batchNo: form.batchNo.trim(), mfgDate: form.mfgDate || null, expiryDate: form.expiryDate || null, quantity }) });
      } else {
        if (!form.productId) throw new Error('Select a product.');
        await api('/fmcg/batches', { method: 'POST', body: JSON.stringify({ productId: form.productId, batchNo: form.batchNo.trim(), mfgDate: form.mfgDate || null, expiryDate: form.expiryDate || null, quantity, isNewStock: form.isNewStock }) });
      }
      setModal(null);
      await load();
      setMessage('Batch saved successfully.');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Unable to save the batch.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(batch: Batch) {
    if (!window.confirm(`Remove batch ${batch.batch_no}? The units stay in the product's stock; only the batch label is removed.`)) return;
    try { await api(`/fmcg/batches/${batch.id}`, { method: 'DELETE' }); await load(); setMessage('Batch removed successfully.'); } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Unable to remove the batch.'); }
  }

  const count = (tone: ExpiryTone) => rows.filter((r) => r.info.tone === tone).length;
  const atRiskRows = rows.filter((r) => ['expired', 'critical', 'warn'].includes(r.info.tone));
  const atRiskValue = atRiskRows.reduce((sum, r) => sum + r.stockValue, 0);

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">FMCG · BATCH &amp; EXPIRY MANAGEMENT</p>
          <h2>Batch &amp; expiry management</h2>
          <p>Every batch has its own quantity and expiry. Orders take stock from the batch that expires first, and never from an expired one.</p>
        </div>
      </div>
      <div className="kpi-grid">
        <div className="kpi-card" data-tone="red" {...kpiClick(toneFilter === 'expired', () => { setToneFilter('expired'); setSearch(''); })}><div className="kpi-icon">⚠</div><div><span>Expired batches</span><strong>{count('expired')}</strong></div></div>
        <div className="kpi-card" data-tone="red" {...kpiClick(toneFilter === 'critical', () => { setToneFilter('critical'); setSearch(''); })}><div className="kpi-icon">◷</div><div><span>Expiring within 7 days</span><strong>{count('critical')}</strong></div></div>
        <div className="kpi-card" data-tone="amber" {...kpiClick(toneFilter === 'warn', () => { setToneFilter('warn'); setSearch(''); })}><div className="kpi-icon">⏱</div><div><span>Expiring within 30 days</span><strong>{count('warn')}</strong></div></div>
        <div className="kpi-card" data-tone="ink" {...kpiClick(showAtRisk, () => setShowAtRisk(true))}><div className="kpi-icon">₹</div><div><span>Stock value at risk</span><strong>{currency(atRiskValue)}</strong></div></div>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input type="search" placeholder="Search product, code or batch number…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={toneFilter} onChange={(e) => setToneFilter(e.target.value as 'all' | ExpiryTone)}>
            <option value="all">All batches</option><option value="expired">Expired</option><option value="critical">Expiring ≤7 days</option><option value="warn">Expiring ≤30 days</option><option value="ok">OK</option><option value="unset">No expiry recorded</option>
          </select>
        </div>
        <button className="primary-action" type="button" onClick={openAdd}>+ Add batch</button>
      </div>

      {error && <p className="error-message">{error}</p>}
      {message && <p className={message.includes('successfully') ? 'success-message' : 'error-message'}>{message}</p>}
      {unbatched.length > 0 && <p className="hint-message">{unbatched.length} product(s) have stock that is not in any batch yet (e.g. {unbatched[0].product.product_name}: {unbatched[0].free}). Add a batch with “This is new stock” unticked to record it.</p>}

      <div className="data-table-wrap">
        <table>
          <thead><tr><th>Product</th><th>Batch no.</th><th>Mfg date</th><th>Expiry</th><th>Batch qty</th><th>Value at risk</th><th>Actions</th></tr></thead>
          <tbody>
            {loading && [0, 1, 2].map((i) => <tr key={i} className="skeleton-row">{[0, 1, 2, 3, 4, 5, 6].map((c) => <td key={c}><span className="skeleton-block" style={{ width: '60%' }} /></td>)}</tr>)}
            {!loading && filteredRows.map(({ batch, product, info, stockValue }) => (
              <tr key={batch.id}>
                <td><strong>{product?.product_name}</strong><small>{product?.product_code}</small></td>
                <td>{batch.batch_no}</td>
                <td>{batch.mfg_date || '—'}</td>
                <td><span className={toneBadgeClass[info.tone]}>{info.label}</span></td>
                <td>{batch.quantity}</td>
                <td className={['expired', 'critical', 'warn'].includes(info.tone) ? 'text-warn' : ''}>{stockValue > 0 && ['expired', 'critical', 'warn'].includes(info.tone) ? currency(stockValue) : '—'}</td>
                <td className="master-actions">
                  <button type="button" className="icon-action" title="Edit batch" aria-label={`Edit batch ${batch.batch_no}`} onClick={() => openEdit(batch)}>✎</button>
                  <button type="button" className="icon-action" title="Remove batch" aria-label={`Remove batch ${batch.batch_no}`} onClick={() => void remove(batch)}>✕</button>
                </td>
              </tr>
            ))}
            {!loading && filteredRows.length === 0 && <tr><td colSpan={7} className="empty-row"><div className="empty-state"><span className="empty-state-icon">⏱</span><p>{batches.length === 0 ? 'No batches yet. Add your first batch.' : 'No batches match your search or filters.'}</p></div></td></tr>}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setModal(null)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="batch-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">BATCH &amp; EXPIRY</p><h3 id="batch-modal-title">{modal.editing ? `Edit batch ${modal.editing.batch_no}` : 'Add batch'}</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(null)}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={submit}>
              <label style={{ gridColumn: '1 / -1' }}>Product
                <select required disabled={Boolean(modal.editing)} value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                  <option value="">Select product…</option>
                  {(modal.editing ? products : scopedProducts).map((p) => <option key={p.id} value={p.id}>{p.product_name} ({p.product_code}) — stock {p.stock_quantity ?? 0}</option>)}
                </select>
              </label>
              <label>Batch number<input required value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })} placeholder="e.g. B-2026-0417" /></label>
              <label>Quantity in this batch<input type="number" min="0" step="1" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>
              <label>Manufacturing date<input type="date" value={form.mfgDate} onChange={(e) => setForm({ ...form, mfgDate: e.target.value })} /></label>
              <label>Expiry date<input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></label>
              {!modal.editing && (
                <label style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={form.isNewStock} onChange={(e) => setForm({ ...form, isNewStock: e.target.checked })} />
                  This is new stock (adds these units to the product's stock). Leave unticked if the units are already counted in stock.
                </label>
              )}
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(null)} disabled={saving}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save batch'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAtRisk && (
        <KpiDetailModal
          eyebrow="STOCK VALUE AT RISK"
          title="Batches expired or expiring within 30 days"
          subtitle={`${currency(atRiskValue)} of stock at risk across ${atRiskRows.length} batch(es)`}
          columns={['Product', 'Code', 'Batch', 'Expiry', 'Qty', 'Value at risk']}
          rows={atRiskRows.map(({ batch, product, info, stockValue }) => ({ id: batch.id, cells: [product?.product_name ?? '', product?.product_code ?? '', batch.batch_no, info.label, batch.quantity, currency(stockValue)] }))}
          emptyText="No batches are expired or expiring within 30 days."
          onClose={() => setShowAtRisk(false)}
        />
      )}
    </section>
  );
}
