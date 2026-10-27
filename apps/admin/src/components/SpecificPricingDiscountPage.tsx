import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

// School-specific pricing rules are real School master data (school_pricing_rules), saved through the School API.
// Once a rule is active and inside its dates, new quotations and orders for that school pick it up automatically.
type School = { id: string; client_code: string; client_name: string; client_type: string; status: string; industry_details?: Record<string, unknown> | null };
type Product = { id: string; product_code: string; product_name: string; category?: string | null; selling_price: number; status: string };

type ApplyTo = 'school' | 'school_type' | 'all';
const applyToLabels: Record<ApplyTo, string> = { school: 'One school', school_type: 'All schools of one type', all: 'All schools' };
const SCHOOL_TYPE_LABELS: Record<string, string> = { government: 'Government schools', private: 'Private schools', international: 'International schools', college: 'Colleges', coaching: 'Coaching / Tuition centers' };
const schoolTypeOf = (s?: School) => String(s?.industry_details?.schoolType ?? '');

type DiscountType = 'percentage' | 'fixed_price';
const discountTypeLabels: Record<DiscountType, string> = { percentage: 'Percentage off', fixed_price: 'Fixed price' };

type PricingRule = {
  id: string;
  applyTo: ApplyTo;
  schoolType: string;
  schoolId: string;
  productId: string; // '' = all products
  discountType: DiscountType;
  discountPercent: string;
  fixedPrice: string;
  minQuantity: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'inactive';
  notes: string;
};
type RuleForm = Omit<PricingRule, 'id'>;
const blankForm: RuleForm = { applyTo: 'school', schoolType: '', schoolId: '', productId: '', discountType: 'percentage', discountPercent: '', fixedPrice: '', minQuantity: '', startDate: '', endDate: '', status: 'active', notes: '' };
type ApiRule = { id: string; apply_to?: ApplyTo; school_type?: string | null; client_id: string | null; product_id: string | null; discount_type: DiscountType; discount_percent: number | null; fixed_price: number | null; min_quantity: number | null; start_date: string | null; end_date: string | null; status: 'active' | 'inactive'; notes: string | null };
const fromApi = (r: ApiRule): PricingRule => ({
  id: r.id, applyTo: r.apply_to ?? 'school', schoolType: r.school_type ?? '', schoolId: r.client_id ?? '', productId: r.product_id ?? '', discountType: r.discount_type,
  discountPercent: r.discount_percent != null ? String(r.discount_percent) : '', fixedPrice: r.fixed_price != null ? String(r.fixed_price) : '',
  minQuantity: r.min_quantity ? String(r.min_quantity) : '', startDate: r.start_date ? String(r.start_date).slice(0, 10) : '', endDate: r.end_date ? String(r.end_date).slice(0, 10) : '',
  status: r.status, notes: r.notes ?? '',
});
const toPayload = (f: RuleForm) => ({
  applyTo: f.applyTo, clientId: f.applyTo === 'school' ? f.schoolId : null, schoolType: f.applyTo === 'school_type' ? f.schoolType : null,
  productId: f.productId || null, discountType: f.discountType,
  discountPercent: f.discountType === 'percentage' ? Number(f.discountPercent) : null,
  fixedPrice: f.discountType === 'fixed_price' ? Number(f.fixedPrice) : null,
  minQuantity: f.minQuantity ? Number(f.minQuantity) : 0,
  startDate: f.startDate || null, endDate: f.endDate || null, status: f.status, notes: f.notes.trim() || null,
});

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
const dateLabel = (value: string) => (value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—');

function appliesTo(rule: PricingRule, school: School): boolean {
  if (rule.applyTo === 'all') return true;
  if (rule.applyTo === 'school_type') return rule.schoolType !== '' && rule.schoolType === schoolTypeOf(school);
  return rule.schoolId === school.id;
}

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
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [saving, setSaving] = useState(false);
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
      // /clients and /products are already limited to the School industry by the API, so no client-side type filter is needed.
      const [clientsRes, productsRes, rulesRes] = await Promise.all([
        api<{ data: School[] }>('/clients'),
        api<{ data: Product[] }>('/products?status=active'),
        api<{ data: ApiRule[] }>('/school/pricing-rules'),
      ]);
      setSchools(clientsRes.data ?? []);
      setProducts(productsRes.data ?? []);
      setRules((rulesRes.data ?? []).map(fromApi));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load schools or products.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);


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
    setForm({ applyTo: rule.applyTo, schoolType: rule.schoolType, schoolId: rule.schoolId, productId: rule.productId, discountType: rule.discountType, discountPercent: rule.discountPercent, fixedPrice: rule.fixedPrice, minQuantity: rule.minQuantity, startDate: rule.startDate, endDate: rule.endDate, status: rule.status, notes: rule.notes });
    setFormError(null);
    setModal(true);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.applyTo === 'school' && !form.schoolId) return setFormError('Select a school.');
    if (form.applyTo === 'school_type' && !form.schoolType) return setFormError('Select the school type.');
    if (!form.productId && form.discountType === 'fixed_price') return setFormError('A fixed price needs one product. Choose a product, or use a percentage for all products.');
    if (form.discountType === 'percentage' && (!form.discountPercent || Number(form.discountPercent) <= 0)) return setFormError('Enter a discount percentage greater than zero.');
    if (form.discountType === 'fixed_price' && (!form.fixedPrice || Number(form.fixedPrice) <= 0)) return setFormError('Enter a fixed price greater than zero.');
    setFormError(null);
    setSaving(true);
    try {
      const res = await api<{ data: ApiRule }>(editing ? `/school/pricing-rules/${editing.id}` : '/school/pricing-rules', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(toPayload(form)) });
      const saved = fromApi(res.data);
      setRules((current) => (editing ? current.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...current]));
      setModal(false);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Unable to save this pricing rule.');
    } finally {
      setSaving(false);
    }
  }
  async function removeRule(id: string) {
    if (!window.confirm('Delete this pricing rule?')) return;
    try {
      await api(`/school/pricing-rules/${id}`, { method: 'DELETE' });
      setRules((current) => current.filter((r) => r.id !== id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete this pricing rule.');
    }
  }
  async function toggleStatus(rule: PricingRule) {
    try {
      const res = await api<{ data: ApiRule }>(`/school/pricing-rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ status: rule.status === 'active' ? 'inactive' : 'active' }) });
      const saved = fromApi(res.data);
      setRules((current) => current.map((r) => (r.id === saved.id ? saved : r)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to change the status.');
    }
  }

  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (schoolFilter) { const picked = schoolById[schoolFilter]; if (!picked || !appliesTo(r, picked)) return false; }
      if (!q) return true;
      const school = schoolById[r.schoolId];
      const product = productById[r.productId];
      const text = `${school?.client_name ?? ''} ${applyToLabels[r.applyTo]} ${SCHOOL_TYPE_LABELS[r.schoolType] ?? ''} ${product?.product_name ?? 'all products'} ${product?.product_code ?? ''}`.toLowerCase();
      return text.includes(q);
    });
  }, [rules, search, schoolFilter, schoolById, productById]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = rules.filter(isCurrentlyValid).length;
  const schoolsCovered = schools.filter((s) => rules.some((r) => appliesTo(r, s))).length;

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">SCHOOL · SPECIFIC PRICING &amp; DISCOUNT MANAGEMENT</p>
          <h2>Specific pricing &amp; discount management</h2>
          <p>Negotiated pricing for one school, every school of one type (e.g. all Government schools), or all schools — on one product or all products — as a discount or fixed price, valid for a date range. The most specific rule wins.</p>
        </div>
        <button className="primary-action" type="button" onClick={openCreate} disabled={loading}>
          + Add pricing rule
        </button>
      </div>

        <div className="kpi-grid">
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon">％</div>
          <div><span>Pricing rules</span><strong>{rules.length}</strong><small>{activeCount} currently valid</small></div>
        </div>
        <div className="kpi-card" data-tone="blue">
          <div className="kpi-icon">◎</div>
          <div><span>Schools covered</span><strong>{schoolsCovered}</strong><small>with a special rate</small></div>
        </div>
      </div>

      {error && <p role="alert" className="error">{error}</p>}

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
            ) : (
              filteredRules.map((rule) => {
                const school = schoolById[rule.schoolId];
                const product = productById[rule.productId];
                const listPrice = product?.selling_price ?? 0;
                const specialPrice = rule.discountType === 'fixed_price' ? Number(rule.fixedPrice) : listPrice * (1 - Number(rule.discountPercent || 0) / 100);
                return (
                  <tr key={rule.id}>
                    <td>
                      {rule.applyTo === 'all' ? <><strong>All schools</strong><small>Every school in this industry</small></>
                        : rule.applyTo === 'school_type' ? <><strong>{SCHOOL_TYPE_LABELS[rule.schoolType] ?? rule.schoolType}</strong><small>All schools of this type</small></>
                        : school ? <><strong>{school.client_name}</strong><small>{school.client_code}</small></> : <span className="text-faint-inline">Unknown school</span>}
                    </td>
                    <td>{!rule.productId ? <><strong>All products</strong><small>Every product</small></> : product ? <><strong>{product.product_name}</strong><small>{product.product_code}</small></> : <span className="text-faint-inline">Unknown product</span>}</td>
                    <td>{rule.productId ? money(listPrice) : '—'}</td>
                    <td>
                      {rule.productId ? money(specialPrice) : `${rule.discountPercent}% off`}
                      <small style={{ display: 'block', color: 'var(--text-faint)' }}>{rule.productId ? (rule.discountType === 'percentage' ? `${rule.discountPercent}% off` : discountTypeLabels[rule.discountType]) : 'on every product'}{Number(rule.minQuantity) > 0 ? ` · from ${rule.minQuantity} qty` : ''}</small>
                    </td>
                    <td>{dateLabel(rule.startDate)} – {dateLabel(rule.endDate)}</td>
                    <td><span className={`status-badge ${isCurrentlyValid(rule) ? 'active' : 'inactive'}`}>{isCurrentlyValid(rule) ? 'valid now' : rule.status}</span></td>
                    <td className="master-actions">
                      <button type="button" className="icon-action" title="Edit rule" aria-label="Edit pricing rule" onClick={() => openEdit(rule)}>✎</button>
                      <button type="button" className="icon-action" title={rule.status === 'active' ? 'Deactivate' : 'Activate'} aria-label="Toggle pricing rule status" onClick={() => void toggleStatus(rule)}>
                        {rule.status === 'active' ? '⊘' : '✓'}
                      </button>
                      <button type="button" className="icon-action" title="Delete rule" aria-label="Delete pricing rule" onClick={() => void removeRule(rule.id)}>🗑</button>
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
                Apply to
                <select value={form.applyTo} onChange={(e) => setForm({ ...form, applyTo: e.target.value as ApplyTo })}>
                  {Object.entries(applyToLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {form.applyTo === 'school' && (
                <label style={{ gridColumn: '1 / -1' }}>
                  School
                  <select value={form.schoolId} onChange={(e) => setForm({ ...form, schoolId: e.target.value })}>
                    <option value="">Select a school</option>
                    {schools.map((s) => <option key={s.id} value={s.id}>{s.client_name} ({s.client_code})</option>)}
                  </select>
                </label>
              )}
              {form.applyTo === 'school_type' && (
                <label style={{ gridColumn: '1 / -1' }}>
                  School type
                  <select value={form.schoolType} onChange={(e) => setForm({ ...form, schoolType: e.target.value })}>
                    <option value="">Select the school type</option>
                    {Object.entries(SCHOOL_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <small style={{ color: 'var(--text-faint)', fontWeight: 400 }}>Uses the "School type" saved on each school. A rule for one specific school always wins over this.</small>
                </label>
              )}
              <label style={{ gridColumn: '1 / -1' }}>
                Product
                <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value, ...(e.target.value === '' ? { discountType: 'percentage' as DiscountType } : {}) })}>
                  <option value="">All products (percentage only)</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.product_name} ({p.product_code}) — {money(p.selling_price)}</option>)}
                </select>
              </label>
              <label>
                Discount type
                <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as DiscountType })}>
                  {Object.entries(discountTypeLabels).filter(([value]) => value === 'percentage' || form.productId !== '').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {form.discountType === 'percentage' ? (
                <label>Discount %<input type="number" min="0" max="100" step="0.01" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: e.target.value })} /></label>
              ) : (
                <label>Fixed price (₹)<input type="number" min="0" step="0.01" value={form.fixedPrice} onChange={(e) => setForm({ ...form, fixedPrice: e.target.value })} /></label>
              )}
              <label>Minimum quantity<input type="number" min="0" step="1" placeholder="0 = any quantity" value={form.minQuantity} onChange={(e) => setForm({ ...form, minQuantity: e.target.value })} /></label>
              <label>Valid from<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
              <label>Valid till<input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
              <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RuleForm['status'] })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              <label style={{ gridColumn: '1 / -1' }}>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
                <button type="button" className="quiet-button" onClick={() => setModal(false)}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving}>{editing ? 'Save changes' : 'Add rule'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}