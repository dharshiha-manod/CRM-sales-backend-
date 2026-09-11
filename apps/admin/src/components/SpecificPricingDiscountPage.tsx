import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

// No backend table for school-specific pricing yet — persisted client-side in
// localStorage, same interim pattern as fs-schemes in SchemeDiscountPage.tsx.
// Swap for a real /pricing-rules API once the backend adds it.
const STORAGE_KEY = 'fs-school-pricing-rules';

type School = { id: string; client_code: string; client_name: string; client_type: string; status: string };
type Product = { id: string; product_code: string; product_name: string; category?: string | null; selling_price: number; status: string };

type DiscountType = 'percentage' | 'fixed_price';
const discountTypeLabels: Record<DiscountType, string> = { percentage: 'Percentage off', fixed_price: 'Fixed price' };

type PricingRule = {
  id: string;
  schoolId: string;
  productId: string;
  discountType: DiscountType;
  discountPercent: string;
  fixedPrice: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'inactive';
  notes: string;
};
type RuleForm = Omit<PricingRule, 'id'>;
const blankForm: RuleForm = { schoolId: '', productId: '', discountType: 'percentage', discountPercent: '', fixedPrice: '', startDate: '', endDate: '', status: 'active', notes: '' };

function loadRules(): PricingRule[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PricingRule[]) : [];
  } catch {
    return [];
  }
}
function saveRules(rules: PricingRule[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    /* best-effort */
  }
}
function newId() {
  return Math.random().toString(36).slice(2, 10);
}

// Denormalized (school/product name baked in) so these render correctly even
// when no real schools or products exist yet to look up by id.
const DEMO_RULES = [
  {
    id: 'demo-rule-1',
    schoolName: 'Sunrise Public School',
    schoolCode: 'SCH-0001',
    productName: 'School Uniform Set (Grade 1-5)',
    productCode: 'UNI-105',
    listPrice: 1450,
    discountType: 'percentage' as const,
    discountPercent: '12',
    fixedPrice: '',
    startDate: '2026-06-01',
    endDate: '2027-04-30',
    status: 'active' as const,
  },
  {
    id: 'demo-rule-2',
    schoolName: 'Greenfield Matriculation School',
    schoolCode: 'SCH-0002',
    productName: 'Note Book Set (200 pages, pack of 10)',
    productCode: 'NBK-210',
    listPrice: 620,
    discountType: 'fixed_price' as const,
    discountPercent: '',
    fixedPrice: '540',
    startDate: '2026-06-01',
    endDate: '2027-04-30',
    status: 'active' as const,
  },
];
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
const dateLabel = (value: string) => (value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—');

function isCurrentlyValid(rule: PricingRule): boolean {
  if (rule.status !== 'active') return false;
  const today = new Date().toISOString().slice(0, 10);
  if (rule.startDate && today < rule.startDate) return false;
  if (rule.endDate && today > rule.endDate) return false;
  return true;
}

export function SpecificPricingDiscountPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rules, setRules] = useState<PricingRule[]>(loadRules());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<PricingRule | null>(null);
  const [form, setForm] = useState<RuleForm>(blankForm);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [clientsRes, productsRes] = await Promise.all([
        api<{ data: School[] }>('/clients'),
        api<{ data: Product[] }>('/products?status=active'),
      ]);
      setSchools((clientsRes.data ?? []).filter((c) => (c.client_type ?? '').toLowerCase() === 'school'));
      setProducts(productsRes.data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load schools or products.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function persist(next: PricingRule[]) {
    setRules(next);
    saveRules(next);
  }

  const schoolById = useMemo(() => Object.fromEntries(schools.map((s) => [s.id, s])), [schools]);
  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  function openCreate() {
    setEditing(null);
    setForm(blankForm);
    setFormError(null);
    setModal(true);
  }
  function openEdit(rule: PricingRule) {
    setEditing(rule);
    setForm({ schoolId: rule.schoolId, productId: rule.productId, discountType: rule.discountType, discountPercent: rule.discountPercent, fixedPrice: rule.fixedPrice, startDate: rule.startDate, endDate: rule.endDate, status: rule.status, notes: rule.notes });
    setFormError(null);
    setModal(true);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.schoolId) return setFormError('Select a school.');
    if (!form.productId) return setFormError('Select a product.');
    if (form.discountType === 'percentage' && (!form.discountPercent || Number(form.discountPercent) <= 0)) return setFormError('Enter a discount percentage greater than zero.');
    if (form.discountType === 'fixed_price' && (!form.fixedPrice || Number(form.fixedPrice) <= 0)) return setFormError('Enter a fixed price greater than zero.');
    setFormError(null);
    if (editing) {
      persist(rules.map((r) => (r.id === editing.id ? { ...r, ...form } : r)));
    } else {
      persist([...rules, { id: newId(), ...form }]);
    }
    setModal(false);
  }
  function removeRule(id: string) {
    persist(rules.filter((r) => r.id !== id));
  }
  function toggleStatus(rule: PricingRule) {
    persist(rules.map((r) => (r.id === rule.id ? { ...r, status: r.status === 'active' ? 'inactive' : 'active' } : r)));
  }

  const usingDemoData = rules.length === 0;

  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (schoolFilter && r.schoolId !== schoolFilter) return false;
      if (!q) return true;
      const school = schoolById[r.schoolId];
      const product = productById[r.productId];
      const text = `${school?.client_name ?? ''} ${product?.product_name ?? ''} ${product?.product_code ?? ''}`.toLowerCase();
      return text.includes(q);
    });
  }, [rules, search, schoolFilter, schoolById, productById]);

  const activeCount = usingDemoData ? DEMO_RULES.length : rules.filter(isCurrentlyValid).length;
  const schoolsCovered = usingDemoData ? new Set(DEMO_RULES.map((r) => r.schoolCode)).size : new Set(rules.map((r) => r.schoolId)).size;

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">SCHOOL · SPECIFIC PRICING &amp; DISCOUNT MANAGEMENT</p>
          <h2>Specific pricing &amp; discount management</h2>
          <p>Negotiated pricing for a particular school on a particular product — a fixed price or a discount percentage, valid for a date range.</p>
        </div>
        <button className="primary-action" type="button" onClick={openCreate} disabled={loading}>
          + Add pricing rule
        </button>
      </div>

        <div className="kpi-grid">
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon">％</div>
          <div><span>Pricing rules</span><strong>{usingDemoData ? DEMO_RULES.length : rules.length}</strong><small>{activeCount} currently valid</small></div>
        </div>
        <div className="kpi-card" data-tone="blue">
          <div className="kpi-icon">◎</div>
          <div><span>Schools covered</span><strong>{schoolsCovered}</strong><small>with a special rate</small></div>
        </div>
      </div>

      {error && !usingDemoData && <p role="alert" className="error">{error}</p>}
      {usingDemoData && <p className="demo-data-banner">Showing sample data for preview — this is a UI-only demo, nothing here is saved.</p>}

      <div className="master-toolbar">
        <div className="master-search">
          <input value={search} placeholder="Search school or product" onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="master-filter-bar">
          <label>
            School
            <select value={schoolFilter} onChange={(e) => setSchoolFilter(e.target.value)}>
              <option value="">All schools</option>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.client_name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="data-table-wrap">
        <table>
          <thead>
            <tr>
              <th>School</th>
              <th>Product</th>
              <th>List price</th>
              <th>Special price</th>
              <th>Validity</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td><span className="skeleton-block" style={{ width: '70%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '60%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '50%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '50%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                </tr>
              ))
            ) : usingDemoData ? (
              DEMO_RULES.map((rule) => {
                const specialPrice = rule.discountType === 'fixed_price' ? Number(rule.fixedPrice) : rule.listPrice * (1 - Number(rule.discountPercent || 0) / 100);
                return (
                  <tr key={rule.id}>
                    <td><strong>{rule.schoolName}</strong><small>{rule.schoolCode}</small></td>
                    <td><strong>{rule.productName}</strong><small>{rule.productCode}</small></td>
                    <td>{money(rule.listPrice)}</td>
                    <td>
                      {money(specialPrice)}
                      <small style={{ display: 'block', color: 'var(--text-faint)' }}>{rule.discountType === 'percentage' ? `${rule.discountPercent}% off` : discountTypeLabels[rule.discountType]}</small>
                    </td>
                    <td>{dateLabel(rule.startDate)} – {dateLabel(rule.endDate)}</td>
                    <td><span className="status-badge active">valid now</span></td>
                    <td className="master-actions">
                      <button type="button" className="icon-action" title="Sample data — add a real rule to edit" aria-label="Edit pricing rule" disabled>✎</button>
                      <button type="button" className="icon-action" title="Sample data — add a real rule to toggle" aria-label="Toggle pricing rule status" disabled>⊘</button>
                      <button type="button" className="icon-action" title="Sample data — add a real rule to delete" aria-label="Delete pricing rule" disabled>🗑</button>
                    </td>
                  </tr>
                );
              })
            ) : (
              filteredRules.map((rule) => {
                const school = schoolById[rule.schoolId];
                const product = productById[rule.productId];
                const listPrice = product?.selling_price ?? 0;
                const specialPrice = rule.discountType === 'fixed_price' ? Number(rule.fixedPrice) : listPrice * (1 - Number(rule.discountPercent || 0) / 100);
                return (
                  <tr key={rule.id}>
                    <td>{school ? <><strong>{school.client_name}</strong><small>{school.client_code}</small></> : <span className="text-faint-inline">Unknown school</span>}</td>
                    <td>{product ? <><strong>{product.product_name}</strong><small>{product.product_code}</small></> : <span className="text-faint-inline">Unknown product</span>}</td>
                    <td>{money(listPrice)}</td>
                    <td>
                      {money(specialPrice)}
                      <small style={{ display: 'block', color: 'var(--text-faint)' }}>{rule.discountType === 'percentage' ? `${rule.discountPercent}% off` : discountTypeLabels[rule.discountType]}</small>
                    </td>
                    <td>{dateLabel(rule.startDate)} – {dateLabel(rule.endDate)}</td>
                    <td><span className={`status-badge ${isCurrentlyValid(rule) ? 'active' : 'inactive'}`}>{isCurrentlyValid(rule) ? 'valid now' : rule.status}</span></td>
                    <td className="master-actions">
                      <button type="button" className="icon-action" title="Edit rule" aria-label="Edit pricing rule" onClick={() => openEdit(rule)}>✎</button>
                      <button type="button" className="icon-action" title={rule.status === 'active' ? 'Deactivate' : 'Activate'} aria-label="Toggle pricing rule status" onClick={() => toggleStatus(rule)}>
                        {rule.status === 'active' ? '⊘' : '✓'}
                      </button>
                      <button type="button" className="icon-action" title="Delete rule" aria-label="Delete pricing rule" onClick={() => removeRule(rule.id)}>🗑</button>
                    </td>
                  </tr>
                );
              })
            )}
            {!loading && filteredRules.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-row">
                  <div className="empty-state">
                    <span className="empty-state-icon">％</span>
                    <p>{rules.length === 0 ? 'No pricing rules yet. Add your first one to get started.' : 'No pricing rules match your search or filters.'}</p>
                    {rules.length === 0 && <button type="button" className="primary-action" onClick={openCreate}>+ Add pricing rule</button>}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-backdrop" onMouseDown={() => setModal(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="pricing-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">PRICING RULE</p><h3 id="pricing-modal-title">{editing ? 'Edit pricing rule' : 'Add pricing rule'}</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={submit}>
              {formError && <p className="error-message" style={{ gridColumn: '1 / -1' }}>{formError}</p>}
              <label style={{ gridColumn: '1 / -1' }}>
                School
                <select required value={form.schoolId} onChange={(e) => setForm({ ...form, schoolId: e.target.value })}>
                  <option value="">Select a school</option>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.client_name} ({s.client_code})</option>)}
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Product
                <select required value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                  <option value="">Select a product</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.product_name} ({p.product_code}) — {money(p.selling_price)}</option>)}
                </select>
              </label>
              <label>
                Discount type
                <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as DiscountType })}>
                  {Object.entries(discountTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {form.discountType === 'percentage' ? (
                <label>Discount %<input type="number" min="0" max="100" step="0.01" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: e.target.value })} /></label>
              ) : (
                <label>Fixed price (₹)<input type="number" min="0" step="0.01" value={form.fixedPrice} onChange={(e) => setForm({ ...form, fixedPrice: e.target.value })} /></label>
              )}
              <label>Valid from<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
              <label>Valid till<input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
              <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RuleForm['status'] })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              <label style={{ gridColumn: '1 / -1' }}>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
                <button type="button" className="quiet-button" onClick={() => setModal(false)}>Cancel</button>
                <button className="primary-action" type="submit">{editing ? 'Save changes' : 'Add rule'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}