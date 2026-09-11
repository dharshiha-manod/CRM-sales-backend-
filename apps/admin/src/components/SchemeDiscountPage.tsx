import { FormEvent, MouseEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

type Product = { id: string; product_code: string; product_name: string; category?: string | null; selling_price: number; status: string };

type SchemeType = 'percentage' | 'flat_amount' | 'buy_x_get_y' | 'slab';
const schemeTypeLabels: Record<SchemeType, string> = {
  percentage: 'Percentage discount',
  flat_amount: 'Flat amount off',
  buy_x_get_y: 'Buy X get Y free',
  slab: 'Quantity slab discount',
};
const schemeTypeIcons: Record<SchemeType, string> = {
  percentage: '％',
  flat_amount: '₹',
  buy_x_get_y: '🎁',
  slab: '⏱',
};

type Slab = { minQuantity: string; discountPercent: string };
const blankSlab: Slab = { minQuantity: '', discountPercent: '' };

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

// Schemes / discounts and their product assignments have no backend table yet —
// persisted client-side in localStorage, same approach used for route/beat plans
// and order meta elsewhere in this app. Product data below is real, live from the API.
const STORAGE_KEY = 'fs-schemes';
type StoredState = { schemes: Scheme[]; assignments: Record<string, string[]> };
const blankStored: StoredState = { schemes: [], assignments: {} };
function loadStored(): StoredState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...blankStored, ...JSON.parse(raw) } : blankStored;
  } catch {
    return blankStored;
  }
}
function saveStored(state: StoredState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* best-effort */
  }
}
function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `scheme-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
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
  switch (scheme.schemeType) {
    case 'percentage':
      return scheme.discountPercent ? `${scheme.discountPercent}% off` : '—';
    case 'flat_amount':
      return scheme.discountAmount ? `₹${scheme.discountAmount} off` : '—';
    case 'buy_x_get_y':
      return scheme.buyQuantity && scheme.freeQuantity ? `Buy ${scheme.buyQuantity}, get ${scheme.freeQuantity} free` : '—';
    case 'slab': {
      const valid = scheme.slabs.filter((s) => s.minQuantity && s.discountPercent);
      if (!valid.length) return '—';
      return valid.map((s) => `${s.minQuantity}+ → ${s.discountPercent}%`).join(', ');
    }
    default:
      return '—';
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
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const productsRes = await api<{ data: Product[] }>('/products?status=active');
      setProducts(productsRes.data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load products.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const stored = loadStored();
    setSchemes(stored.schemes);
    setAssignments(stored.assignments);
  }, []);

  function persist(nextSchemes: Scheme[], nextAssignments: Record<string, string[]>) {
    setSchemes(nextSchemes);
    setAssignments(nextAssignments);
    saveStored({ schemes: nextSchemes, assignments: nextAssignments });
  }

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

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setMessage('Enter a scheme name.');
      return;
    }
    if (form.endDate && form.startDate && new Date(form.endDate) < new Date(form.startDate)) {
      setMessage('End date cannot be before the start date.');
      return;
    }
    setSaving(true);
    try {
      const cleaned: SchemeForm = { ...form, name: form.name.trim(), description: form.description.trim(), slabs: form.slabs.filter((s) => s.minQuantity || s.discountPercent) };
      if (editing) {
        const next = schemes.map((s) => (s.id === editing.id ? { ...s, ...cleaned } : s));
        persist(next, assignments);
        setMessage('Scheme updated successfully.');
      } else {
        const id = newId();
        const next = [...schemes, { id, ...cleaned }];
        persist(next, { ...assignments, [id]: [] });
        setMessage('Scheme created successfully.');
      }
      setModal(false);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  function toggleStatus(scheme: Scheme) {
    const next = schemes.map((s) => (s.id === scheme.id ? { ...s, status: (s.status === 'active' ? 'inactive' : 'active') as Scheme['status'] } : s));
    persist(next, assignments);
  }

  function removeScheme(scheme: Scheme) {
    if (!window.confirm(`Remove "${scheme.name}"? This cannot be undone.`)) return;
    const next = schemes.filter((s) => s.id !== scheme.id);
    const restAssignments = { ...assignments };
    delete restAssignments[scheme.id];
    persist(next, restAssignments);
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
  function toggleProductAssignment(productId: string) {
    if (!managing) return;
    const current = assignments[managing.id] ?? [];
    const next = current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId];
    persist(schemes, { ...assignments, [managing.id]: next });
  }

  const manageableProducts = products.filter(
    (p) => !productSearch || `${p.product_name} ${p.product_code} ${p.category ?? ''}`.toLowerCase().includes(productSearch.toLowerCase())
  );

  const liveCount = schemes.filter((s) => lifecycle(s) === 'live').length;
  const expiringSoon = schemes.filter((s) => {
    if (lifecycle(s) !== 'live' || !s.endDate) return false;
    const days = Math.ceil((new Date(s.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 7;
  }).length;
  const productsCovered = new Set(Object.values(assignments).flat()).size;

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">FMCG · SCHEME / DISCOUNT MANAGEMENT</p>
          <h2>Scheme / Discount management</h2>
          <p>Create promotional schemes — percentage off, flat amount, buy-X-get-Y, or quantity slabs — set a validity window and assign them to products.</p>
        </div>
      </div>
      <div className="kpi-grid scheme-kpi-grid">
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon">≡</div>
          <div>
            <span>Total schemes</span>
            <strong>{schemes.length}</strong>
            <small>{schemes.filter((s) => s.status === 'active').length} active</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="green">
          <div className="kpi-icon">✓</div>
          <div>
            <span>Live now</span>
            <strong>{liveCount}</strong>
            <small>running today</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="amber">
          <div className="kpi-icon">⏱</div>
          <div>
            <span>Expiring within 7 days</span>
            <strong>{expiringSoon}</strong>
            <small>needs renewal review</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="blue">
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
        <div className="modal-backdrop" onMouseDown={() => !saving && setModal(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="scheme-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">SCHEME / DISCOUNT</p>
                <h3 id="scheme-modal-title">{editing ? 'Edit scheme' : 'Add scheme'}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>
                ×
              </button>
            </div>
            <form className="master-modal-form" onSubmit={submit}>
              <label>
                Scheme name
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Diwali festive discount" />
              </label>
              <label>
                Scheme type
                <select value={form.schemeType} onChange={(e) => setForm({ ...form, schemeType: e.target.value as SchemeType })}>
                  {(Object.keys(schemeTypeLabels) as SchemeType[]).map((t) => (
                    <option key={t} value={t}>
                      {schemeTypeLabels[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Description
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional notes for the sales team" />
              </label>

              {form.schemeType === 'percentage' && (
                <label>
                  Discount percent
                  <input type="number" min="0" max="100" step="0.01" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: e.target.value })} />
                </label>
              )}
              {form.schemeType === 'flat_amount' && (
                <label>
                  Discount amount (₹)
                  <input type="number" min="0" step="0.01" value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: e.target.value })} />
                </label>
              )}
              {form.schemeType === 'buy_x_get_y' && (
                <>
                  <label>
                    Buy quantity
                    <input type="number" min="1" step="1" value={form.buyQuantity} onChange={(e) => setForm({ ...form, buyQuantity: e.target.value })} />
                  </label>
                  <label>
                    Free quantity
                    <input type="number" min="1" step="1" value={form.freeQuantity} onChange={(e) => setForm({ ...form, freeQuantity: e.target.value })} />
                  </label>
                </>
              )}
              {form.schemeType === 'slab' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <p style={{ margin: '0 0 .4rem', fontSize: '.86rem', fontWeight: 600, color: 'var(--text-muted)' }}>Quantity slabs</p>
                  {form.slabs.map((slab, index) => (
                    <div key={index} style={{ display: 'flex', gap: '.6rem', marginBottom: '.5rem', alignItems: 'center' }}>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Min quantity"
                        value={slab.minQuantity}
                        onChange={(e) => updateSlab(index, { minQuantity: e.target.value })}
                        style={{ flex: 1 }}
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="Discount %"
                        value={slab.discountPercent}
                        onChange={(e) => updateSlab(index, { discountPercent: e.target.value })}
                        style={{ flex: 1 }}
                      />
                      {form.slabs.length > 1 && (
                        <button type="button" className="icon-action" aria-label="Remove slab" onClick={() => removeSlab(index)}>
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="quiet-button" onClick={addSlab}>
                    + Add slab
                  </button>
                </div>
              )}

              <label>
                Start date
                <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </label>
              <label>
                End date
                <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </label>
              <label>
                Status
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Scheme['status'] })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>

              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(false)} disabled={saving}>
                  Cancel
                </button>
                <button className="primary-action" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add scheme'}
                </button>
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
    </section>
  );
}