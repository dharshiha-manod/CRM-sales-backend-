import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { useOrgSettings } from '../settings/useOrgSettings';
import { kpiClick } from '../lib/kpiClick';
import { addDaysIso, daysLeft, previewBatchNo } from '../lib/batchExpiry';
import './MasterDataPages.css';
import './SalesReturnDamagePage.css';
import './BatchExpiryPage.css';

/* ══════════════════════════════════════════════════════════════════════
   Batch & expiry (FMCG)

   Expiry limits come from Settings → Inventory Configuration ("Expiry warning")
   and Settings → Expiry & Batch Rules ("Block sale within … days of expiry"),
   for the active industry only. The server uses the same two values when it
   picks batches for an order, so what this page shows as "blocked" really
   cannot be sold.
   ══════════════════════════════════════════════════════════════════════ */

type Product = { id: string; product_code: string; product_name: string; selling_price: number; cost_price?: number | null; shelf_life_days?: number | null; stock_quantity?: number | null; status: 'active' | 'inactive'; industry_type_id?: string | null };
type Batch = { id: string; product_id: string; batch_no: string; mfg_date: string | null; expiry_date: string | null; quantity: number };
type BatchForm = { productId: string; batchNo: string; mfgDate: string; expiryDate: string; quantity: string; source: 'new' | 'existing'; shelfLifeDays: string };
type WriteOffReason = 'expired' | 'damaged' | 'other';
type Tone = 'expired' | 'blocked' | 'soon' | 'ok' | 'unset';
type Tab = 'all' | Tone;
type Toast = { id: number; tone: 'success' | 'error'; message: string };

const todayIso = () => new Date().toISOString().slice(0, 10);
const blankForm = (): BatchForm => ({ productId: '', batchNo: '', mfgDate: todayIso(), expiryDate: '', quantity: '', source: 'new', shelfLifeDays: '' });
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
/** What one unit cost you; selling price only when no cost is entered. */
const unitCost = (p?: Product) => Number(p?.cost_price ?? 0) > 0 ? Number(p?.cost_price) : Number(p?.selling_price ?? 0);

function expiryInfo(expiryDate: string | null, warnDays: number, blockDays: number): { tone: Tone; label: string; days: number | null } {
  if (!expiryDate) return { tone: 'unset', label: 'No expiry', days: null };
  const days = daysLeft(expiryDate);
  if (days < 0) return { tone: 'expired', label: `Expired ${Math.abs(days)}d ago`, days };
  if (blockDays > 0 && days <= blockDays) return { tone: 'blocked', label: days === 0 ? 'Expires today' : `${days}d left`, days };
  if (days <= warnDays) return { tone: 'soon', label: `${days}d left`, days };
  return { tone: 'ok', label: `${days}d left`, days };
}
const notSellable = (tone: Tone) => tone === 'expired' || tone === 'blocked';
const atRisk = (tone: Tone) => tone === 'expired' || tone === 'blocked' || tone === 'soon';

export function BatchExpiryPage() {
  const { matchesActiveIndustry, activeIndustryTypeId } = useIndustryScope();
  const { settings } = useOrgSettings();
  const warnDays = Math.max(0, Number(settings.inventory.expiryWarningDays) || 0);
  const blockDays = Math.max(0, Number(settings.expiryBatch.blockSaleWithinDaysOfExpiry) || 0);

  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [showEmpty, setShowEmpty] = useState(false);
  const [showAtRisk, setShowAtRisk] = useState(false);

  const [modal, setModal] = useState<{ editing: Batch | null } | null>(null);
  const [form, setForm] = useState<BatchForm>(blankForm);
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [writeOff, setWriteOff] = useState<{ batch: Batch; tone: Tone } | null>(null);
  const [woQty, setWoQty] = useState('');
  const [woReason, setWoReason] = useState<WriteOffReason>('expired');
  const [woRemarks, setWoRemarks] = useState('');
  const [woError, setWoError] = useState('');
  const [woSaving, setWoSaving] = useState(false);

  function toast(tone: Toast['tone'], message: string) {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, tone, message }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4200);
  }

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

  const allRows = useMemo(() => batches
    .map((batch) => {
      const product = productById.get(batch.product_id);
      const info = expiryInfo(batch.expiry_date, warnDays, blockDays);
      return { batch, product, info, value: Number(batch.quantity) * unitCost(product) };
    })
    .filter((r) => r.product && matchesActiveIndustry(r.product.industry_type_id))
    .sort((a, b) => (a.info.days == null ? 1 : b.info.days == null ? -1 : a.info.days - b.info.days)), [batches, productById, activeIndustryTypeId, warnDays, blockDays]);

  // Batches with no units left stay in the history but out of the way.
  const rows = useMemo(() => allRows.filter((r) => showEmpty || Number(r.batch.quantity) > 0), [allRows, showEmpty]);
  const emptyCount = allRows.filter((r) => Number(r.batch.quantity) <= 0).length;
  const live = allRows.filter((r) => Number(r.batch.quantity) > 0);
  const count = (tone: Tone) => live.filter((r) => r.info.tone === tone).length;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== 'all' && r.info.tone !== tab) return false;
      if (!q) return true;
      return (r.product?.product_name ?? '').toLowerCase().includes(q) || (r.product?.product_code ?? '').toLowerCase().includes(q) || r.batch.batch_no.toLowerCase().includes(q);
    });
  }, [rows, search, tab]);

  const atRiskRows = live.filter((r) => atRisk(r.info.tone));
  const atRiskValue = atRiskRows.reduce((sum, r) => sum + r.value, 0);

  // Per product: what is in stock, what cannot be sold (expired / blocked), what can.
  const stockRows = useMemo(() => scopedProducts
    .filter((p) => p.stock_quantity != null)
    .map((p) => {
      const inBatches = live.filter((r) => r.batch.product_id === p.id);
      const locked = inBatches.filter((r) => notSellable(r.info.tone)).reduce((s, r) => s + Number(r.batch.quantity), 0);
      const batched = inBatches.reduce((s, r) => s + Number(r.batch.quantity), 0);
      const stock = Number(p.stock_quantity ?? 0);
      return { product: p, stock, locked, sellable: Math.max(0, stock - locked), unbatched: Math.max(0, stock - batched), hasBatches: inBatches.length > 0 };
    })
    .filter((x) => x.hasBatches || x.unbatched > 0)
    .sort((a, b) => b.locked - a.locked || b.unbatched - a.unbatched), [scopedProducts, live]);
  const unbatchedCount = stockRows.filter((x) => x.unbatched > 0).length;

  const TABS: { key: Tab; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: live.length },
    { key: 'expired', label: 'Expired', n: count('expired') },
    { key: 'blocked', label: `Blocked${blockDays > 0 ? ` (≤${blockDays}d)` : ''}`, n: count('blocked') },
    { key: 'soon', label: `Expiring soon (≤${warnDays}d)`, n: count('soon') },
    { key: 'ok', label: 'OK', n: count('ok') },
  ];

  function openAdd(prefill: Partial<BatchForm> = {}) { setForm({ ...blankForm(), ...prefill }); setExpiryTouched(false); setFormError(''); setModal({ editing: null }); }
  function openEdit(batch: Batch) { setForm({ productId: batch.product_id, batchNo: batch.batch_no, mfgDate: batch.mfg_date ?? '', expiryDate: batch.expiry_date ?? '', quantity: String(batch.quantity), source: 'new', shelfLifeDays: '' }); setExpiryTouched(true); setFormError(''); setModal({ editing: batch }); }

  // What the Add form works out by itself.
  const formProduct = productById.get(form.productId);
  const formShelfLife = Number(form.shelfLifeDays) || Number(formProduct?.shelf_life_days) || 0;
  const autoExpiry = form.mfgDate && formShelfLife ? addDaysIso(form.mfgDate, formShelfLife) : '';
  const effectiveExpiry = expiryTouched ? form.expiryDate : (autoExpiry || form.expiryDate);
  const expiryIsAuto = !expiryTouched && Boolean(autoExpiry);
  const unbatchedOf = (productId: string) => Math.max(0, Number(productById.get(productId)?.stock_quantity ?? 0) - live.filter((r) => r.batch.product_id === productId).reduce((s, r) => s + Number(r.batch.quantity), 0));
  const formUnbatched = form.productId ? unbatchedOf(form.productId) : 0;
  const batchNoPreview = formProduct ? previewBatchNo(formProduct.product_code, form.mfgDate, batches.filter((b) => b.product_id === formProduct.id).map((b) => b.batch_no)) : '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!modal) return;
    setSaving(true);
    setFormError('');
    try {
      const quantity = Number(form.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Enter a valid quantity.');
      if (modal.editing) {
        await api(`/fmcg/batches/${modal.editing.id}`, { method: 'PATCH', body: JSON.stringify({ batchNo: form.batchNo.trim(), mfgDate: form.mfgDate || null, expiryDate: form.expiryDate || null, quantity }) });
      } else {
        if (!form.productId) throw new Error('Select a product.');
        await api('/fmcg/batches', { method: 'POST', body: JSON.stringify({ productId: form.productId, batchNo: form.batchNo.trim() || undefined, mfgDate: form.mfgDate || null, expiryDate: effectiveExpiry || null, quantity, isNewStock: form.source === 'new', shelfLifeDays: !formProduct?.shelf_life_days && Number(form.shelfLifeDays) > 0 ? Number(form.shelfLifeDays) : undefined }) });
      }
      setModal(null);
      await load();
      toast('success', modal.editing ? 'Batch saved.' : 'Batch added.');
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Unable to save the batch.');
    } finally {
      setSaving(false);
    }
  }

  function openWriteOff(batch: Batch, tone: Tone) {
    setWriteOff({ batch, tone });
    setWoQty(String(batch.quantity));
    setWoReason(tone === 'expired' || tone === 'blocked' ? 'expired' : 'damaged');
    setWoRemarks('');
    setWoError('');
  }

  async function submitWriteOff(event: FormEvent) {
    event.preventDefault();
    if (!writeOff) return;
    const quantity = Number(woQty);
    if (!Number.isFinite(quantity) || quantity <= 0) { setWoError('Enter how many units to write off.'); return; }
    if (quantity > Number(writeOff.batch.quantity)) { setWoError(`This batch only has ${writeOff.batch.quantity} unit(s).`); return; }
    setWoSaving(true);
    setWoError('');
    try {
      await api(`/fmcg/batches/${writeOff.batch.id}/write-off`, { method: 'POST', body: JSON.stringify({ quantity, reason: woReason, remarks: woRemarks.trim() || undefined }) });
      setWriteOff(null);
      await load();
      toast('success', `${quantity} unit(s) written off from batch ${writeOff.batch.batch_no}.`);
    } catch (caught) {
      setWoError(caught instanceof Error ? caught.message : 'Unable to write off.');
    } finally {
      setWoSaving(false);
    }
  }

  const expiredRows = live.filter((r) => r.info.tone === 'expired');
  const expiredUnits = expiredRows.reduce((sum, r) => sum + Number(r.batch.quantity), 0);
  const expiredValue = expiredRows.reduce((sum, r) => sum + r.value, 0);
  async function writeOffAllExpired() {
    setBulkRunning(true);
    let done = 0; let failed = 0;
    for (const r of expiredRows) {
      try { await api(`/fmcg/batches/${r.batch.id}/write-off`, { method: 'POST', body: JSON.stringify({ reason: 'expired', remarks: 'Bulk write-off of expired batches' }) }); done += 1; } catch { failed += 1; }
    }
    setBulkRunning(false);
    setBulkOpen(false);
    await load();
    toast(failed ? 'error' : 'success', failed ? `${done} batch(es) written off, ${failed} failed. Try the failed ones one by one.` : `${done} expired batch(es) written off.`);
  }

  async function remove(batch: Batch) {
    if (!window.confirm(`Remove the empty batch ${batch.batch_no}?`)) return;
    try { await api(`/fmcg/batches/${batch.id}`, { method: 'DELETE' }); await load(); toast('success', 'Batch removed.'); } catch (caught) { toast('error', caught instanceof Error ? caught.message : 'Unable to remove the batch.'); }
  }

  const woBatchProduct = writeOff ? productById.get(writeOff.batch.product_id) : undefined;
  const woQtyNum = Number(woQty) || 0;

  return (
    <section className="page-panel master-page returns-page batch-page">
      <div className="page-panel-heading">
        <div><h2>Batch &amp; expiry</h2></div>
        <div className="master-actions">
          <button type="button" className="quiet-button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          <button className="primary-action" type="button" onClick={() => openAdd()}>+ Add batch</button>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="kpi-grid returns-kpis">
        <div className="kpi-card" data-tone="red" {...kpiClick(tab === 'expired', () => { setTab('expired'); setSearch(''); })}>
          <div className="kpi-icon kpi-icon-red">⚠</div>
          <div><span>Expired</span><strong>{count('expired')}</strong></div>
        </div>
        <div className="kpi-card" data-tone="red" {...kpiClick(tab === 'blocked', () => { setTab('blocked'); setSearch(''); })}>
          <div className="kpi-icon kpi-icon-red">⛔</div>
          <div><span>Blocked from sale</span><strong>{count('blocked')}</strong>{blockDays > 0 && <small>within {blockDays} days</small>}</div>
        </div>
        <div className="kpi-card" data-tone="amber" {...kpiClick(tab === 'soon', () => { setTab('soon'); setSearch(''); })}>
          <div className="kpi-icon kpi-icon-amber">◷</div>
          <div><span>Expiring soon</span><strong>{count('soon')}</strong><small>within {warnDays} days</small></div>
        </div>
        <div className="kpi-card" data-tone="ink" {...kpiClick(showAtRisk, () => setShowAtRisk((v) => !v))}>
          <div className="kpi-icon">₹</div>
          <div><span>Value at risk</span><strong>{money(atRiskValue)}</strong><small>at purchase price</small></div>
        </div>
      </div>

      {showAtRisk && (
        <div className="returns-card bx-risk">
          <div className="bx-card-head"><strong>At risk · {atRiskRows.length} batch(es)</strong><button type="button" className="icon-action" aria-label="Close" onClick={() => setShowAtRisk(false)}>×</button></div>
          <div className="data-table-wrap returns-table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th><th className="num">Value</th></tr></thead>
              <tbody>
                {atRiskRows.length === 0 && <tr><td colSpan={5}><div className="empty-state empty-state-lg"><h3>Nothing at risk</h3></div></td></tr>}
                {atRiskRows.map(({ batch, product, info, value }) => (
                  <tr key={batch.id}><td><strong>{product?.product_name}</strong></td><td>{batch.batch_no}</td><td><span className={`status-badge bx-${info.tone}`}>{info.label}</span></td><td className="num">{batch.quantity}</td><td className="num">{money(value)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="returns-card">
        <div className="returns-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`returns-tab ${tab === t.key ? 'active' : ''} ${(t.key === 'expired' || t.key === 'blocked') && t.n > 0 ? 'tab-attn' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}<span className="tab-count">{t.n}</span>
            </button>
          ))}
        </div>
        <div className="returns-filters">
          <input type="search" placeholder="Search product, code or batch no…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {expiredRows.length > 0 && <button type="button" className="quiet-button bx-writeoff bx-writeoff--due" onClick={() => setBulkOpen(true)}>Write off all expired ({expiredRows.length})</button>}
          {emptyCount > 0 && (
            <label className="bx-toggle"><input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />Show empty ({emptyCount})</label>
          )}
        </div>

        <div className="data-table-wrap returns-table-wrap">
          <table>
            <thead>
              <tr><th>Product</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th><th className="num">Value at risk</th><th className="col-actions" aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3].map((i) => <tr key={i} className="skeleton-row"><td colSpan={6}><span className="skeleton-block" style={{ width: '100%' }} /></td></tr>)
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state empty-state-lg">
                      <div className="empty-state-icon">⏱</div>
                      <h3>{live.length === 0 ? 'No batches yet' : 'No matching batches'}</h3>
                      {live.length === 0 && <button className="quiet-button" type="button" onClick={() => openAdd()}>+ Add batch</button>}
                    </div>
                  </td>
                </tr>
              ) : filteredRows.map(({ batch, product, info, value }) => {
                const empty = Number(batch.quantity) <= 0;
                return (
                  <tr key={batch.id} className={empty ? 'bx-row-empty' : ''}>
                    <td><div className="stack-cell"><strong>{product?.product_name}</strong><small>{product?.product_code}</small></div></td>
                    <td><strong>{batch.batch_no}</strong></td>
                    <td><div className="stack-cell"><span className={`status-badge bx-${info.tone}`}>{info.label}</span>{batch.expiry_date && <small>{batch.expiry_date}</small>}</div></td>
                    <td className="num">{batch.quantity}</td>
                    <td className="num">{atRisk(info.tone) && value > 0 && !empty ? money(value) : '—'}</td>
                    <td className="row-actions-cell">
                      {!empty && <button type="button" className={`quiet-button bx-writeoff ${notSellable(info.tone) ? 'bx-writeoff--due' : ''}`} onClick={() => openWriteOff(batch, info.tone)}>Write off</button>}
                      <button type="button" className="icon-action" title="Edit batch" aria-label={`Edit batch ${batch.batch_no}`} onClick={() => openEdit(batch)}>✎</button>
                      {empty && <button type="button" className="icon-action" title="Remove empty batch" aria-label={`Remove batch ${batch.batch_no}`} onClick={() => void remove(batch)}>✕</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {stockRows.length > 0 && (
        <div className="returns-card">
          <div className="bx-card-head">
            <strong>Sellable stock</strong>
            {unbatchedCount > 0 && <small>{unbatchedCount} product(s) have units that are not in any batch</small>}
          </div>
          <div className="data-table-wrap returns-table-wrap">
            <table>
              <thead><tr><th>Product</th><th className="num">In stock</th><th className="num">Expired / blocked</th><th className="num">Sellable</th><th className="num">Not in a batch</th><th className="col-actions" aria-label="Actions" /></tr></thead>
              <tbody>
                {stockRows.map(({ product, stock, locked, sellable, unbatched }) => (
                  <tr key={product.id}>
                    <td><div className="stack-cell"><strong>{product.product_name}</strong><small>{product.product_code}</small></div></td>
                    <td className="num">{stock}</td>
                    <td className={`num ${locked > 0 ? 'text-warn' : ''}`}>{locked > 0 ? locked : '—'}</td>
                    <td className="num"><strong>{sellable}</strong></td>
                    <td className="num">{unbatched > 0 ? unbatched : '—'}</td>
                    <td className="row-actions-cell">{unbatched > 0 && <button type="button" className="quiet-button bx-writeoff" onClick={() => openAdd({ productId: product.id, source: 'existing', quantity: String(unbatched) })}>Assign to batch</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Add / edit batch ── */}
      {modal && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setModal(null)}>
          <div className="master-modal returns-drawer" role="dialog" aria-modal="true" aria-labelledby="batch-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><h3 id="batch-modal-title">{modal.editing ? `Edit batch ${modal.editing.batch_no}` : 'Add batch'}</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(null)}>×</button>
            </div>
            <form className="rd-form" onSubmit={submit}>
              <div className="rd-body">
                {formError && <p className="error-message">{formError}</p>}
                <div className="rd-field">
                  <label htmlFor="bx-product">Product</label>
                  <select id="bx-product" required disabled={Boolean(modal.editing)} value={form.productId} onChange={(e) => { setForm({ ...form, productId: e.target.value, shelfLifeDays: '' }); setExpiryTouched(false); }}>
                    <option value="">Select product</option>
                    {(modal.editing ? products : scopedProducts).map((p) => <option key={p.id} value={p.id}>{p.product_name} ({p.product_code}) — stock {p.stock_quantity ?? 0}</option>)}
                  </select>
                </div>

                {!modal.editing && (
                  <div className="rd-field">
                    <label>Stock source</label>
                    <div className="rd-segment" role="radiogroup">
                      <button type="button" role="radio" aria-checked={form.source === 'new'} className={form.source === 'new' ? 'active' : ''} onClick={() => setForm({ ...form, source: 'new' })}>New stock received</button>
                      <button type="button" role="radio" aria-checked={form.source === 'existing'} className={form.source === 'existing' ? 'active' : ''} onClick={() => setForm({ ...form, source: 'existing', quantity: form.quantity || (formUnbatched ? String(formUnbatched) : '') })}>Already in stock</button>
                    </div>
                    <small className="bx-hint">{form.source === 'new' ? 'These units are added to the product stock.' : form.productId ? `${formUnbatched} unit(s) of this product are not in any batch yet.` : 'Gives a batch to units already counted in stock.'}</small>
                  </div>
                )}

                <div className="rd-row">
                  <div className="rd-field">
                    <label htmlFor="bx-qty">Quantity{!modal.editing && form.source === 'existing' && formUnbatched > 0 ? ` (max ${formUnbatched})` : ''}</label>
                    <input id="bx-qty" type="number" min="0" step="1" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                  </div>
                  <div className="rd-field">
                    <label htmlFor="bx-no">Batch no. <em>{modal.editing ? '' : '(optional)'}</em></label>
                    <input id="bx-no" required={Boolean(modal.editing)} value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })} placeholder={modal.editing ? '' : batchNoPreview || 'Auto'} />
                  </div>
                </div>

                <div className="rd-row">
                  <div className="rd-field"><label htmlFor="bx-mfg">Manufacturing date</label><input id="bx-mfg" type="date" value={form.mfgDate} onChange={(e) => setForm({ ...form, mfgDate: e.target.value })} /></div>
                  <div className="rd-field">
                    <label htmlFor="bx-exp">Expiry date {expiryIsAuto && <em className="bx-auto">auto</em>}</label>
                    <input id="bx-exp" type="date" value={effectiveExpiry} onChange={(e) => { setExpiryTouched(true); setForm({ ...form, expiryDate: e.target.value }); }} />
                  </div>
                </div>

                {!modal.editing && formProduct && !formProduct.shelf_life_days && (
                  <div className="rd-field">
                    <label htmlFor="bx-shelf">Shelf life (days) <em>(optional)</em></label>
                    <input id="bx-shelf" type="number" min="1" step="1" placeholder="e.g. 180" value={form.shelfLifeDays} onChange={(e) => { setExpiryTouched(false); setForm({ ...form, shelfLifeDays: e.target.value }); }} />
                    <small className="bx-hint">Saved on the product, so the expiry date is filled in automatically next time.</small>
                  </div>
                )}

                {!modal.editing && formProduct && (
                  <div className="rd-summary">
                    <div className="rd-summary-main"><span>Batch</span><strong>{form.batchNo.trim() || batchNoPreview}</strong></div>
                    <div className="rd-tags"><em>{effectiveExpiry ? `Expires ${effectiveExpiry}` : 'No expiry set'}</em>{formProduct.shelf_life_days ? <em>Shelf life {formProduct.shelf_life_days}d</em> : null}</div>
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(null)} disabled={saving}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save batch'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Write off ── */}
      {writeOff && (
        <div className="modal-backdrop modal-backdrop--center" role="presentation" onMouseDown={() => !woSaving && setWriteOff(null)}>
          <div className="master-modal master-modal--center bx-writeoff-modal" role="dialog" aria-modal="true" aria-labelledby="bx-wo-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">{woBatchProduct?.product_name ?? 'Batch'} · {writeOff.batch.batch_no}</p><h3 id="bx-wo-title">Write off stock</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setWriteOff(null)}>×</button>
            </div>
            <form onSubmit={submitWriteOff}>
              <div className="rd-body">
                {woError && <p className="error-message">{woError}</p>}
                <div className="rd-field">
                  <label htmlFor="bx-wo-qty">Quantity</label>
                  <div className="rd-qty">
                    <input id="bx-wo-qty" type="number" min="1" step="1" max={writeOff.batch.quantity} required value={woQty} onChange={(e) => setWoQty(e.target.value)} />
                    <span>/ {writeOff.batch.quantity}</span>
                  </div>
                </div>
                <div className="rd-field">
                  <label>Reason</label>
                  <div className="rd-segment bx-segment-3" role="radiogroup">
                    {(['expired', 'damaged', 'other'] as WriteOffReason[]).map((r) => (
                      <button key={r} type="button" role="radio" aria-checked={woReason === r} className={woReason === r ? 'active' : ''} onClick={() => setWoReason(r)}>{r === 'expired' ? 'Expired' : r === 'damaged' ? 'Damaged' : 'Other'}</button>
                    ))}
                  </div>
                </div>
                <div className="rd-field">
                  <label htmlFor="bx-wo-note">Note <em>(optional)</em></label>
                  <input id="bx-wo-note" value={woRemarks} maxLength={300} onChange={(e) => setWoRemarks(e.target.value)} />
                </div>
                {woQtyNum > 0 && (
                  <div className="rd-summary rd-summary--red">
                    <div className="rd-summary-main"><span>Loss at purchase price</span><strong>{money(woQtyNum * unitCost(woBatchProduct))}</strong></div>
                    <div className="rd-tags"><em>−{woQtyNum} from stock</em></div>
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setWriteOff(null)} disabled={woSaving}>Cancel</button>
                <button className="primary-action icon-action--danger" type="submit" disabled={woSaving}>{woSaving ? 'Saving…' : 'Write off'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bulkOpen && (
        <div className="modal-backdrop modal-backdrop--center" role="presentation" onMouseDown={() => !bulkRunning && setBulkOpen(false)}>
          <div className="master-modal master-modal--center returns-confirm" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><h3>Write off all expired</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setBulkOpen(false)}>×</button>
            </div>
            <div className="returns-confirm-body">
              <p><strong>{expiredRows.length}</strong> expired batch(es), <strong>{expiredUnits}</strong> unit(s), about <strong>{money(expiredValue)}</strong> at purchase price will be removed from stock. This cannot be undone.</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setBulkOpen(false)} disabled={bulkRunning}>Cancel</button>
              <button type="button" className="primary-action icon-action--danger" onClick={() => void writeOffAllExpired()} disabled={bulkRunning}>{bulkRunning ? 'Writing off…' : 'Write off all'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="returns-toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`returns-toast ${t.tone}`}>{t.message}</div>)}
      </div>
    </section>
  );
}
