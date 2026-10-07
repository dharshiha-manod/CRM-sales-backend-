import { FormEvent, MouseEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { kpiClick } from '../lib/kpiClick';
import { KpiDetailModal } from './KpiDetailModal';
import './MasterDataPages.css';
import './SchemeForm.css';

type Product = { id: string; product_code: string; product_name: string; category?: string | null; selling_price: number; status: string };

type SchemeType = 'percentage' | 'flat_amount' | 'buy_x_get_y' | 'slab' | 'slab_free' | 'value_slab' | 'special_price' | 'pack_off';
const schemeTypeInfo: Record<SchemeType, { label: string; icon: string; blurb: string }> = {
  percentage: { label: 'Percentage discount', icon: '％', blurb: 'A fixed % off the line value.' },
  flat_amount: { label: 'Flat amount off', icon: '₹', blurb: 'A fixed ₹ amount off every unit.' },
  buy_x_get_y: { label: 'Buy X get Y free', icon: '＋', blurb: 'Free units for every X units bought.' },
  slab: { label: 'Quantity slab discount', icon: '≡', blurb: 'Discount % that grows with quantity.' },
  slab_free: { label: 'Quantity slab free goods', icon: '⊕', blurb: 'More free units as quantity grows.' },
  value_slab: { label: 'Value slab discount', icon: '◈', blurb: 'Discount % based on the line value in ₹.' },
  special_price: { label: 'Special net price', icon: '◎', blurb: 'A fixed ₹ rate per unit while live.' },
  pack_off: { label: 'Pack / case deal', icon: '▣', blurb: '₹ off for every full pack of X units.' },
};
const schemeTypeLabels = Object.fromEntries(Object.entries(schemeTypeInfo).map(([k, v]) => [k, v.label])) as Record<SchemeType, string>;
const schemeTypeIcons = Object.fromEntries(Object.entries(schemeTypeInfo).map(([k, v]) => [k, v.icon])) as Record<SchemeType, string>;
const SLAB_TYPES: SchemeType[] = ['slab', 'slab_free', 'value_slab'];

type Slab = { minQuantity: string; minValue: string; discountPercent: string; freeQuantity: string };
const blankSlab: Slab = { minQuantity: '', minValue: '', discountPercent: '', freeQuantity: '' };

type Scheme = {
  id: string;
  name: string;
  description: string;
  schemeType: SchemeType;
  discountPercent: string;
  discountAmount: string;
  buyQuantity: string;
  freeQuantity: string;
  slabs: Slab[];
  startDate: string;
  endDate: string;
  status: 'active' | 'inactive';
};
type SchemeForm = Omit<Scheme, 'id'>;
const blankForm: SchemeForm = {
  name: '',
  description: '',
  schemeType: 'percentage',
  discountPercent: '',
  discountAmount: '',
  buyQuantity: '',
  freeQuantity: '',
  slabs: [{ ...blankSlab }],
  startDate: '',
  endDate: '',
  status: 'active',
};

// Schemes are saved in the database (FMCG industry only) and are applied automatically when a quotation or
// order is priced for an FMCG client. Product data below is live from the API as well.
type ApiScheme = {
  id: string; name: string; description: string | null; scheme_type: SchemeType;
  discount_percent: number | null; discount_amount: number | null; buy_quantity: number | null; free_quantity: number | null;
  slabs: { minQuantity?: number | string; minValue?: number | string; discountPercent?: number | string; freeQuantity?: number | string }[] | null;
  start_date: string | null; end_date: string | null; status: 'active' | 'inactive'; product_ids: string[];
};
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
function fromApi(r: ApiScheme): Scheme {
  return {
    id: r.id, name: r.name, description: r.description ?? '', schemeType: r.scheme_type,
    discountPercent: str(r.discount_percent), discountAmount: str(r.discount_amount), buyQuantity: str(r.buy_quantity), freeQuantity: str(r.free_quantity),
    slabs: (r.slabs ?? []).map((x) => ({ minQuantity: str(x.minQuantity), minValue: str(x.minValue), discountPercent: str(x.discountPercent), freeQuantity: str(x.freeQuantity) })),
    startDate: r.start_date ?? '', endDate: r.end_date ?? '', status: r.status,
  };
}
function slabsForPayload(f: SchemeForm) {
  const n = (v: string) => Number(v);
  if (f.schemeType === 'slab') return f.slabs.filter((x) => x.minQuantity && x.discountPercent).map((x) => ({ minQuantity: n(x.minQuantity), discountPercent: n(x.discountPercent) }));
  if (f.schemeType === 'slab_free') return f.slabs.filter((x) => x.minQuantity && x.freeQuantity).map((x) => ({ minQuantity: n(x.minQuantity), freeQuantity: n(x.freeQuantity) }));
  if (f.schemeType === 'value_slab') return f.slabs.filter((x) => x.minValue && x.discountPercent).map((x) => ({ minValue: n(x.minValue), discountPercent: n(x.discountPercent) }));
  return [];
}
function toPayload(f: SchemeForm) {
  return {
    name: f.name, description: f.description || null, schemeType: f.schemeType,
    discountPercent: num(f.discountPercent), discountAmount: num(f.discountAmount), buyQuantity: num(f.buyQuantity), freeQuantity: num(f.freeQuantity),
    slabs: slabsForPayload(f),
    startDate: f.startDate || null, endDate: f.endDate || null, status: f.status,
  };
}
// Older versions kept schemes in this browser only. The first time the page loads with an empty database list,
// those browser-saved schemes are copied to the database once, then removed from the browser.
const LEGACY_KEY = 'fs-schemes';
async function migrateLegacy(current: ApiScheme[]): Promise<ApiScheme[]> {
  if (current.length > 0) return current;
  let legacy: { schemes?: Scheme[]; assignments?: Record<string, string[]> } | null = null;
  try { const raw = window.localStorage.getItem(LEGACY_KEY); legacy = raw ? JSON.parse(raw) : null; } catch { legacy = null; }
  if (!legacy?.schemes?.length) return current;
  for (const old of legacy.schemes) {
    try {
      const { id: _oldId, ...form } = old;
      const created = await api<{ data: ApiScheme }>('/fmcg/schemes', { method: 'POST', body: JSON.stringify(toPayload(form)) });
      const ids = legacy.assignments?.[old.id] ?? [];
      if (ids.length) await api(`/fmcg/schemes/${created.data.id}/products`, { method: 'PUT', body: JSON.stringify({ productIds: ids }) });
    } catch { /* a scheme that no longer passes validation is skipped */ }
  }
  try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* best-effort */ }
  return (await api<{ data: ApiScheme[] }>('/fmcg/schemes')).data ?? [];
}

type Lifecycle = 'inactive' | 'upcoming' | 'live' | 'expired';
function lifecycle(scheme: Scheme): Lifecycle {
  if (scheme.status === 'inactive') return 'inactive';
  const now = Date.now();
  if (scheme.startDate && now < new Date(scheme.startDate).getTime()) return 'upcoming';
  if (scheme.endDate && now > new Date(`${scheme.endDate}T23:59:59`).getTime()) return 'expired';
  return 'live';
}
const lifecycleBadge: Record<Lifecycle, { label: string; className: string }> = {
  inactive: { label: 'Inactive', className: 'status-badge inactive' },
  upcoming: { label: 'Upcoming', className: 'status-badge status-pending' },
  live: { label: 'Live', className: 'status-badge status-completed' },
  expired: { label: 'Expired', className: 'status-badge status-cancelled' },
};

function schemeValueLabel(scheme: Scheme): string {
  const valid = (pick: (s: Slab) => boolean) => scheme.slabs.filter(pick);
  switch (scheme.schemeType) {
    case 'percentage':
      return scheme.discountPercent ? `${scheme.discountPercent}% off` : '—';
    case 'flat_amount':
      return scheme.discountAmount ? `₹${scheme.discountAmount} off per unit` : '—';
    case 'buy_x_get_y':
      return scheme.buyQuantity && scheme.freeQuantity ? `Buy ${scheme.buyQuantity}, get ${scheme.freeQuantity} free` : '—';
    case 'slab': {
      const rows = valid((s) => !!(s.minQuantity && s.discountPercent));
      return rows.length ? rows.map((s) => `${s.minQuantity}+ → ${s.discountPercent}%`).join(', ') : '—';
    }
    case 'slab_free': {
      const rows = valid((s) => !!(s.minQuantity && s.freeQuantity));
      return rows.length ? rows.map((s) => `${s.minQuantity}+ → ${s.freeQuantity} free`).join(', ') : '—';
    }
    case 'value_slab': {
      const rows = valid((s) => !!(s.minValue && s.discountPercent));
      return rows.length ? rows.map((s) => `₹${s.minValue}+ → ${s.discountPercent}%`).join(', ') : '—';
    }
    case 'special_price':
      return scheme.discountAmount ? `Net ₹${scheme.discountAmount} per unit` : '—';
    case 'pack_off':
      return scheme.buyQuantity && scheme.discountAmount ? `₹${scheme.discountAmount} off per ${scheme.buyQuantity} units` : '—';
    default:
      return '—';
  }
}

/** One plain-English sentence describing the rule being set up, shown live in the form. */
function describeRule(f: SchemeForm): string {
  const has = (v: string) => v.trim() !== '';
  switch (f.schemeType) {
    case 'percentage': return has(f.discountPercent) ? `${f.discountPercent}% off the line value.` : 'Enter the discount percentage.';
    case 'flat_amount': return has(f.discountAmount) ? `₹${f.discountAmount} off on every unit (converted automatically for foreign-currency clients).` : 'Enter the amount off per unit.';
    case 'buy_x_get_y': return has(f.buyQuantity) && has(f.freeQuantity) ? `Buy ${f.buyQuantity}, get ${f.freeQuantity} free — repeats for every ${f.buyQuantity} units ordered.` : 'Enter the buy and free quantities.';
    case 'slab': { const r = f.slabs.filter((x) => x.minQuantity && x.discountPercent); return r.length ? r.map((x) => `${x.minQuantity}+ units → ${x.discountPercent}% off`).join(' · ') : 'Add at least one quantity slab.'; }
    case 'slab_free': { const r = f.slabs.filter((x) => x.minQuantity && x.freeQuantity); return r.length ? r.map((x) => `${x.minQuantity}+ units → ${x.freeQuantity} free`).join(' · ') : 'Add at least one slab.'; }
    case 'value_slab': { const r = f.slabs.filter((x) => x.minValue && x.discountPercent); return r.length ? r.map((x) => `line value ₹${x.minValue}+ → ${x.discountPercent}% off`).join(' · ') : 'Add at least one value slab.'; }
    case 'special_price': return has(f.discountAmount) ? `Net price ₹${f.discountAmount} per unit while the scheme is live (used only when lower than the normal price).` : 'Enter the special price per unit.';
    case 'pack_off': return has(f.buyQuantity) && has(f.discountAmount) ? `₹${f.discountAmount} off for every full pack of ${f.buyQuantity} units.` : 'Enter the pack size and the amount off per pack.';
    default: return '';
  }
}

function dateRangeLabel(scheme: Scheme): string {
  const fmt = (d: string) => (d ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(d)) : null);
  const start = fmt(scheme.startDate);
  const end = fmt(scheme.endDate);
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return 'No end date';
}


export function SchemeDiscountPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | Lifecycle>('all');
  const [search, setSearch] = useState('');

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Scheme | null>(null);
  const [form, setForm] = useState<SchemeForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [managing, setManaging] = useState<Scheme | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [formProducts, setFormProducts] = useState<string[]>([]);
  const [formProductSearch, setFormProductSearch] = useState('');
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);
  const [kpiView, setKpiView] = useState<null | 'expiring' | 'products'>(null);

  function applyRows(rows: ApiScheme[]) {
    setSchemes(rows.map(fromApi));
    setAssignments(Object.fromEntries(rows.map((r) => [r.id, r.product_ids])));
  }
  async function reloadSchemes() {
    const res = await api<{ data: ApiScheme[] }>('/fmcg/schemes');
    applyRows(res.data ?? []);
  }
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [productsRes, schemesRes] = await Promise.all([api<{ data: Product[] }>('/products?status=active'), api<{ data: ApiScheme[] }>('/fmcg/schemes')]);
      setProducts(productsRes.data ?? []);
      applyRows(await migrateLegacy(schemesRes.data ?? []));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load schemes.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const filteredSchemes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return schemes.filter((s) => {
      if (lifecycleFilter !== 'all' && lifecycle(s) !== lifecycleFilter) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    });
  }, [schemes, lifecycleFilter, search]);

  function openCreate() {
    setEditing(null);
    setForm(blankForm);
    setFormProducts([]);
    setFormProductSearch('');
    setMessage('');
    setModal(true);
  }
  function openEdit(scheme: Scheme) {
    setEditing(scheme);
    setForm({
      name: scheme.name,
      description: scheme.description,
      schemeType: scheme.schemeType,
      discountPercent: scheme.discountPercent,
      discountAmount: scheme.discountAmount,
      buyQuantity: scheme.buyQuantity,
      freeQuantity: scheme.freeQuantity,
      slabs: scheme.slabs.length ? scheme.slabs : [{ ...blankSlab }],
      startDate: scheme.startDate,
      endDate: scheme.endDate,
      status: scheme.status,
    });
    setFormProducts(assignments[scheme.id] ?? []);
    setFormProductSearch('');
    setMessage('');
    setModal(true);
  }

  function updateSlab(index: number, patch: Partial<Slab>) {
    setForm((f) => ({ ...f, slabs: f.slabs.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }
  function addSlab() {
    setForm((f) => ({ ...f, slabs: [...f.slabs, { ...blankSlab }] }));
  }
  function removeSlab(index: number) {
    setForm((f) => ({ ...f, slabs: f.slabs.filter((_, i) => i !== index) }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setMessage('Enter a scheme name.');
      return;
    }
    if (form.endDate && form.startDate && new Date(form.endDate) < new Date(form.startDate)) {
      setMessage('End date cannot be before the start date.');
      return;
    }
    if (formProducts.length === 0) {
      setMessage('Select at least one product this scheme applies to.');
      return;
    }
    setSaving(true);
    try {
      const payload = toPayload({ ...form, name: form.name.trim(), description: form.description.trim() });
      let schemeId = editing?.id ?? '';
      if (editing) {
        await api(`/fmcg/schemes/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        const created = await api<{ data: ApiScheme }>('/fmcg/schemes', { method: 'POST', body: JSON.stringify(payload) });
        schemeId = created.data.id;
      }
      // Applicable products are saved together with the scheme (a scheme with no products never applies).
      await api(`/fmcg/schemes/${schemeId}/products`, { method: 'PUT', body: JSON.stringify({ productIds: formProducts }) });
      setMessage(editing ? 'Scheme updated successfully.' : 'Scheme created successfully.');
      await reloadSchemes();
      setModal(false);
      setEditing(null);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Unable to save the scheme.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(scheme: Scheme) {
    try {
      await api(`/fmcg/schemes/${scheme.id}`, { method: 'PATCH', body: JSON.stringify({ status: scheme.status === 'active' ? 'inactive' : 'active' }) });
      await reloadSchemes();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to change the scheme status.');
    }
  }

  async function removeScheme(scheme: Scheme) {
    if (!window.confirm(`Remove "${scheme.name}"? Quotations and orders already priced with it keep their discount.`)) return;
    try {
      await api(`/fmcg/schemes/${scheme.id}`, { method: 'DELETE' });
      await reloadSchemes();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to remove the scheme.');
    }
  }

  function toggleMenu(event: MouseEvent<HTMLButtonElement>, schemeId: string) {
    if (menuFor?.id === schemeId) {
      setMenuFor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: schemeId, top: rect.bottom + 6, left: Math.max(8, rect.right - 168) });
  }

  function openManage(scheme: Scheme) {
    setManaging(scheme);
    setProductSearch('');
  }
  async function toggleProductAssignment(productId: string) {
    if (!managing) return;
    const current = assignments[managing.id] ?? [];
    const next = current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId];
    setAssignments({ ...assignments, [managing.id]: next });
    try {
      await api(`/fmcg/schemes/${managing.id}/products`, { method: 'PUT', body: JSON.stringify({ productIds: next }) });
    } catch (caught) {
      setAssignments({ ...assignments, [managing.id]: current });
      setError(caught instanceof Error ? caught.message : 'Unable to update the scheme products.');
    }
  }

  const manageableProducts = products.filter(
    (p) => !productSearch || `${p.product_name} ${p.product_code} ${p.category ?? ''}`.toLowerCase().includes(productSearch.toLowerCase())
  );

  const formProductRows = products.filter(
    (p) => !formProductSearch || `${p.product_name} ${p.product_code} ${p.category ?? ''}`.toLowerCase().includes(formProductSearch.toLowerCase())
  );
  const toggleFormProduct = (id: string) => setFormProducts((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const selectVisibleProducts = () => setFormProducts((cur) => [...new Set([...cur, ...formProductRows.map((p) => p.id)])]);
  const clearVisibleProducts = () => setFormProducts((cur) => cur.filter((id) => !formProductRows.some((p) => p.id === id)));

  const liveCount = schemes.filter((s) => lifecycle(s) === 'live').length;
  const daysLeft = (s: Scheme) => Math.ceil((new Date(s.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const expiringSchemes = schemes.filter((s) => {
    if (lifecycle(s) !== 'live' || !s.endDate) return false;
    const days = daysLeft(s);
    return days >= 0 && days <= 7;
  });
  const expiringSoon = expiringSchemes.length;
  const coveredProductIds = [...new Set(Object.values(assignments).flat())];
  const productsCovered = coveredProductIds.length;
  const coveredProductRows = coveredProductIds.map((productId) => ({
    productId,
    product: products.find((p) => p.id === productId),
    schemeNames: schemes.filter((s) => (assignments[s.id] ?? []).includes(productId)).map((s) => s.name),
  }));

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">FMCG · SCHEME / DISCOUNT MANAGEMENT</p>
          <h2>Scheme / Discount management</h2>
          <p>Create promotional schemes — percentage off, flat amount, buy-X-get-Y, or quantity slabs — set a validity window and assign them to products. A live scheme is applied automatically when a quotation or order is priced, unless the line already has its own discount.</p>
        </div>
      </div>
      <div className="kpi-grid scheme-kpi-grid">
<div className="kpi-card" data-tone="ink" {...kpiClick(lifecycleFilter === 'all' && !search.trim(), () => { setLifecycleFilter('all'); setSearch(''); })}>
          <div className="kpi-icon">≡</div>
          <div>
            <span>Total schemes</span>
            <strong>{schemes.length}</strong>
            <small>{schemes.filter((s) => s.status === 'active').length} active</small>
          </div>
        </div>
<div className="kpi-card" data-tone="green" {...kpiClick(lifecycleFilter === 'live', () => { setLifecycleFilter('live'); setSearch(''); })}>
          <div className="kpi-icon">✓</div>
          <div>
            <span>Live now</span>
            <strong>{liveCount}</strong>
            <small>running today</small>
          </div>
        </div>
<div className="kpi-card" data-tone="amber" {...kpiClick(kpiView === 'expiring', () => setKpiView('expiring'))}>
          <div className="kpi-icon">⏱</div>
          <div>
            <span>Expiring within 7 days</span>
            <strong>{expiringSoon}</strong>
            <small>needs renewal review</small>
          </div>
        </div>
      <div className="kpi-card" data-tone="blue" {...kpiClick(kpiView === 'products', () => setKpiView('products'))}>
          <div className="kpi-icon">▣</div>
          <div>
            <span>Products covered</span>
            <strong>{productsCovered}</strong>
            <small>of {products.length} active products</small>
          </div>
        </div>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input
            type="search"
            placeholder="Search schemes by name or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value as 'all' | Lifecycle)}>
            <option value="all">All schemes</option>
            <option value="live">Live now</option>
            <option value="upcoming">Upcoming</option>
            <option value="expired">Expired</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <button className="primary-action" type="button" onClick={openCreate}>
          + Add scheme
        </button>
      </div>

      {error && <p className="error-message">{error}</p>}
      {message && <p className={message.includes('successfully') ? 'success-message' : 'error-message'}>{message}</p>}

      {loading ? (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Scheme</th>
                <th>Type</th>
                <th>Value</th>
                <th>Validity</th>
                <th>Products</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map((i) => (
                <tr key={i} className="skeleton-row">
                  <td><span className="skeleton-block" style={{ width: '75%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '65%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '70%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '25%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '50%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '80%' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Scheme</th>
                <th>Type</th>
                <th>Value</th>
                <th>Validity</th>
                <th>Products</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchemes.map((scheme) => {
                const badge = lifecycleBadge[lifecycle(scheme)];
                const assignedCount = (assignments[scheme.id] ?? []).length;
                return (
                  <tr key={scheme.id}>
                    <td>
                      <strong>{scheme.name}</strong>
                      {scheme.description && <small>{scheme.description}</small>}
                    </td>
                    <td>
                      <span className="scheme-type-chip">
                        <i>{schemeTypeIcons[scheme.schemeType]}</i>
                        {schemeTypeLabels[scheme.schemeType]}
                      </span>
                    </td>
                    <td>{schemeValueLabel(scheme)}</td>
                    <td>{dateRangeLabel(scheme)}</td>
                    <td>{assignedCount}</td>
                    <td>
                      <span className={badge.className}>{badge.label}</span>
                    </td>
                                 <td className="master-actions">
                      <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label="More actions" onClick={(e) => toggleMenu(e, scheme.id)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="5" cy="12" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="19" cy="12" r="1.8" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredSchemes.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-row">
                    <div className="empty-state">
                      <span className="empty-state-icon">％</span>
                      <p>
                        {schemes.length === 0
                          ? 'No schemes created yet.'
                          : 'No schemes match your search or filters.'}
                      </p>
                      {schemes.length === 0 && (
                        <button className="quiet-button" type="button" onClick={openCreate}>
                          + Add your first scheme
                        </button>
                      )}
                    </div>
                           </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {menuFor && (
        <>
          <div className="row-menu-backdrop" onMouseDown={() => setMenuFor(null)} />
          <div className="row-menu row-menu--icons" style={{ top: menuFor.top, left: menuFor.left }}>
            {(() => {
              const scheme = filteredSchemes.find((s) => s.id === menuFor.id);
              if (!scheme) return null;
              return (
                <>
                  <button type="button" title="Manage products" onClick={() => { setMenuFor(null); openManage(scheme); }}>
                    <span>◎</span>
                    <span>Manage products</span>
                  </button>
                  <button type="button" title="Edit" onClick={() => { setMenuFor(null); openEdit(scheme); }}>
                    <span>✎</span>
                    <span>Edit</span>
                  </button>
                  <button type="button" title={scheme.status === 'active' ? 'Deactivate' : 'Activate'} onClick={() => { setMenuFor(null); toggleStatus(scheme); }}>
                    <span>{scheme.status === 'active' ? '⊘' : '✓'}</span>
                    <span>{scheme.status === 'active' ? 'Deactivate' : 'Activate'}</span>
                  </button>
                                 <button type="button" className="row-menu-danger" title="Delete" onClick={() => { setMenuFor(null); removeScheme(scheme); }}>
                    <span>✕</span>
                    <span>Delete</span>
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}

      {modal && (
        <div className="sf-backdrop" onMouseDown={() => !saving && setModal(false)}>
          <div className="sf-modal" role="dialog" aria-modal="true" aria-labelledby="scheme-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sf-head">
              <div>
                <small>Scheme / Discount</small>
                <h3 id="scheme-modal-title">{editing ? 'Edit scheme' : 'Add scheme'}</h3>
              </div>
              <button className="sf-close" type="button" aria-label="Close" onClick={() => setModal(false)}>×</button>
            </div>

            <form className="sf-form" onSubmit={submit}>
              <div className="sf-body">
                {/* LEFT: scheme setup */}
                <div className="sf-col">
                  <section>
                    <p className="sf-section-title">Basic details</p>
                    <div className="sf-grid two">
                      <label className="sf-field">Scheme name *
                        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Diwali festive discount" />
                      </label>
                      <label className="sf-field">Description
                        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional notes for the sales team" />
                      </label>
                    </div>
                  </section>

                  <section>
                    <p className="sf-section-title">Scheme type</p>
                    <div className="sf-types">
                      {(Object.keys(schemeTypeInfo) as SchemeType[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          title={schemeTypeInfo[t].blurb}
                          aria-pressed={form.schemeType === t}
                          className={`sf-type${form.schemeType === t ? ' on' : ''}`}
                          onClick={() => setForm({ ...form, schemeType: t, slabs: form.slabs.length ? form.slabs : [{ ...blankSlab }] })}
                        >
                          <i>{schemeTypeInfo[t].icon}</i>
                          {schemeTypeInfo[t].label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section>
                    <p className="sf-section-title">Discount rule</p>
                    {!SLAB_TYPES.includes(form.schemeType) && (
                      <div className="sf-grid two">
                        {form.schemeType === 'percentage' && (
                          <label className="sf-field">Discount percent (%)
                            <input type="number" min="0" max="100" step="0.01" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: e.target.value })} placeholder="e.g. 10" />
                          </label>
                        )}
                        {form.schemeType === 'flat_amount' && (
                          <label className="sf-field">Amount off per unit (₹)
                            <input type="number" min="0" step="0.01" value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: e.target.value })} placeholder="e.g. 5" />
                          </label>
                        )}
                        {form.schemeType === 'special_price' && (
                          <label className="sf-field">Special net price per unit (₹)
                            <input type="number" min="0" step="0.01" value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: e.target.value })} placeholder="e.g. 89" />
                          </label>
                        )}
                        {form.schemeType === 'buy_x_get_y' && (
                          <>
                            <label className="sf-field">Buy quantity (X)
                              <input type="number" min="1" step="1" value={form.buyQuantity} onChange={(e) => setForm({ ...form, buyQuantity: e.target.value })} placeholder="e.g. 10" />
                            </label>
                            <label className="sf-field">Free quantity (Y)
                              <input type="number" min="1" step="1" value={form.freeQuantity} onChange={(e) => setForm({ ...form, freeQuantity: e.target.value })} placeholder="e.g. 1" />
                            </label>
                          </>
                        )}
                        {form.schemeType === 'pack_off' && (
                          <>
                            <label className="sf-field">Pack size (units)
                              <input type="number" min="1" step="1" value={form.buyQuantity} onChange={(e) => setForm({ ...form, buyQuantity: e.target.value })} placeholder="e.g. 24" />
                            </label>
                            <label className="sf-field">Amount off per pack (₹)
                              <input type="number" min="0" step="0.01" value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: e.target.value })} placeholder="e.g. 50" />
                            </label>
                          </>
                        )}
                      </div>
                    )}

                    {SLAB_TYPES.includes(form.schemeType) && (
                      <div>
                        <div className="sf-slab-row" style={{ marginBottom: '.3rem' }}>
                          <span className="sf-slab-head">{form.schemeType === 'value_slab' ? 'Min line value (₹)' : 'Min quantity'}</span>
                          <span className="sf-slab-head">{form.schemeType === 'slab_free' ? 'Free units' : 'Discount %'}</span>
                          <span />
                        </div>
                        {form.slabs.map((slab, index) => (
                          <div key={index} className="sf-slab-row">
                            {form.schemeType === 'value_slab' ? (
                              <input type="number" min="1" step="any" placeholder="e.g. 10000" value={slab.minValue} onChange={(e) => updateSlab(index, { minValue: e.target.value })} />
                            ) : (
                              <input type="number" min="1" step="1" placeholder="e.g. 50" value={slab.minQuantity} onChange={(e) => updateSlab(index, { minQuantity: e.target.value })} />
                            )}
                            {form.schemeType === 'slab_free' ? (
                              <input type="number" min="1" step="1" placeholder="e.g. 5" value={slab.freeQuantity} onChange={(e) => updateSlab(index, { freeQuantity: e.target.value })} />
                            ) : (
                              <input type="number" min="0" max="100" step="0.01" placeholder="e.g. 5" value={slab.discountPercent} onChange={(e) => updateSlab(index, { discountPercent: e.target.value })} />
                            )}
                            {form.slabs.length > 1 ? (
                              <button type="button" className="sf-x" aria-label="Remove slab" onClick={() => removeSlab(index)}>✕</button>
                            ) : <span />}
                          </div>
                        ))}
                        <button type="button" className="sf-link" onClick={addSlab}>+ Add slab</button>
                      </div>
                    )}

                  </section>

                  <section>
                    <p className="sf-section-title">Validity &amp; status</p>
                    <div className="sf-grid three">
                      <label className="sf-field">Start date
                        <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                      </label>
                      <label className="sf-field">End date
                        <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                      </label>
                      <label className="sf-field">Status
                        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Scheme['status'] })}>
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </label>
                    </div>
                  </section>
                </div>

                {/* RIGHT: applicable products */}
                <div className="sf-col">
                  <div className="sf-prod-head">
                    <div>
                      <p className="sf-section-title" style={{ margin: 0 }}>Applicable products *</p>
                      <p>{formProducts.length} of {products.length} selected</p>
                    </div>
                    <div className="sf-prod-actions">
                      <button type="button" className="sf-link" onClick={selectVisibleProducts}>Select all{formProductSearch ? ' shown' : ''}</button>
                      <button type="button" className="sf-link" onClick={clearVisibleProducts}>Clear</button>
                    </div>
                  </div>
                  <div className="sf-search">
                    <input type="search" value={formProductSearch} placeholder="Search by name, code or category" onChange={(e) => setFormProductSearch(e.target.value)} />
                  </div>
                  <div className="sf-list">
                    {formProductRows.map((p) => {
                      const on = formProducts.includes(p.id);
                      return (
                        <label key={p.id} className={`sf-item${on ? ' on' : ''}`}>
                          <input type="checkbox" checked={on} onChange={() => toggleFormProduct(p.id)} />
                          <span>
                            <strong>{p.product_name}</strong>
                            <small>{p.product_code}{p.category ? ` · ${p.category}` : ''}</small>
                          </span>
                          <span className="price">₹{Number(p.selling_price).toFixed(2)}</span>
                        </label>
                      );
                    })}
                    {formProductRows.length === 0 && (
                      <p className="sf-empty">{products.length === 0 ? 'No active products yet. Add products first.' : 'No products match this search.'}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="sf-foot">
                {message && !message.includes('successfully') ? <p className="sf-error">{message}</p> : <span />}
                <div className="sf-foot-btns">
                  <button type="button" className="sf-btn ghost" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
                  <button className="sf-btn solid" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add scheme'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {managing && (
        <div className="modal-backdrop" onMouseDown={() => setManaging(null)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">PRODUCTS ON THIS SCHEME</p>
                <h3>{managing.name}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setManaging(null)}>
                ×
              </button>
            </div>
            <input
              value={productSearch}
              placeholder="Search products by name, code or category"
              onChange={(e) => setProductSearch(e.target.value)}
              style={{ marginBottom: '.9rem', width: '100%', boxSizing: 'border-box' }}
            />
            <div className="data-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Code</th>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {manageableProducts.map((p) => {
                    const assigned = (assignments[managing.id] ?? []).includes(p.id);
                    return (
                      <tr key={p.id}>
                        <td>
                          <input type="checkbox" checked={assigned} onChange={() => toggleProductAssignment(p.id)} aria-label={`Assign ${p.product_name}`} />
                        </td>
                        <td>{p.product_code}</td>
                        <td>{p.product_name}</td>
                        <td>{p.category || '—'}</td>
                        <td>₹{Number(p.selling_price).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                  {manageableProducts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty-row">
                        No products match this search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="primary-action" onClick={() => setManaging(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
 
      {kpiView === 'expiring' && (
        <KpiDetailModal
              eyebrow="EXPIRING WITHIN 7 DAYS"
          title="Schemes needing renewal review"
          columns={['Scheme', 'Type', 'Value', 'Valid period', 'Days left']}
          rows={expiringSchemes.map((s) => ({ id: s.id, cells: [s.name, schemeTypeLabels[s.schemeType], schemeValueLabel(s), dateRangeLabel(s), `${daysLeft(s)}d`] }))}
          emptyText="No live schemes are expiring in the next 7 days."
          onClose={() => setKpiView(null)}
        />
      )}

      {kpiView === 'products' && (
        <KpiDetailModal
                eyebrow="PRODUCTS COVERED"
          title="Products covered by schemes"
          columns={['Product', 'Code', 'Category', 'Schemes applied']}
          rows={coveredProductRows.map((r) => ({ id: r.productId, cells: [r.product?.product_name ?? 'Removed product', r.product?.product_code ?? '—', r.product?.category || '—', r.schemeNames.join(', ') || '—'] }))}
          emptyText="No products have a scheme assigned yet."
          onClose={() => setKpiView(null)}
        />
      )}
    </section>
  );
}