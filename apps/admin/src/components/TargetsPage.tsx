import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustry } from '../industry/IndustryContext';
import { useIndustryScope } from '../industry/useIndustryScope';
import './MasterDataPages.css';
import './TargetsPage.css';

type TargetApiRow = {
  id: string;
  representative_id: string;
  industry_type_id: string;
  target_type: string;
  period_start: string;
  period_end: string;
  period_label: string;
  target_value: number;
  achieved_value: number;
  priority: 'low' | 'normal' | 'high';
  lifecycle: 'active' | 'paused' | 'completed';
  client_id: string | null;
  product_id: string | null;
  remarks: string | null;
  adjustments: { id: string; previousValue: number; newValue: number; reason: string; date: string; updatedBy: string }[];
  created_at: string;
  sales_representatives?: { id: string; employee_code: string; designation?: string | null; user_profiles?: { display_name?: string | null } | null } | null;
  industry_types?: { id: string; code: string; name: string } | null;
  clients?: { id: string; client_code: string; client_name: string } | null;
  products?: { id: string; product_name: string } | null;
  activity: { orders: number; collections: number; visits: number; newCustomers: number };
};

type RepOption = { id: string; employee_code: string; designation?: string | null; user_profiles?: { display_name?: string | null } | null };

const TARGET_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'sales_amount', label: 'Sales Amount' },
  { value: 'order_value', label: 'Order Value' },
  { value: 'order_count', label: 'Order Count' },
  { value: 'collection_amount', label: 'Collection Amount' },
  { value: 'visit_count', label: 'Visit Count' },
  { value: 'new_customers', label: 'New Customers' },
  { value: 'product_quantity', label: 'Product Quantity' },
  { value: 'doctor_visits', label: 'Doctor Visits' },
  { value: 'pharmacy_visits', label: 'Pharmacy Visits' },
  { value: 'order_quantity', label: 'Order Quantity' },
  { value: 'meter_quantity', label: 'Meter Quantity' },
  { value: 'client_visits', label: 'Client Visits' },
  { value: 'quantity_sold', label: 'Quantity Sold' },
  { value: 'admission_target', label: 'Admission Target' },
  { value: 'fee_collection', label: 'Fee Collection' },
  { value: 'institution_visits', label: 'Institution Visits' },
  { value: 'student_enrollment', label: 'Student Enrollment' },
  { value: 'followups', label: 'Follow-ups' },
];
const CURRENCY_TYPES = new Set(['sales_amount', 'order_value', 'collection_amount', 'fee_collection']);

const PERIODS: { key: 'today' | 'week' | 'month' | 'quarter' | 'year'; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'year', label: 'This Year' },
];

const STATUS_LABEL: Record<string, string> = { not_started: 'Not Started', on_track: 'On Track', at_risk: 'At Risk', achieved: 'Achieved', exceeded: 'Exceeded' };
const STATUS_CLASS: Record<string, string> = { not_started: 'status-badge', on_track: 'status-badge status-quoted', at_risk: 'status-badge inactive', achieved: 'status-badge status-completed', exceeded: 'status-badge status-completed' };

const money = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(v || 0));
const plain = (v: number) => new Intl.NumberFormat('en-IN').format(Math.round(v || 0));
function formatByType(v: number, type: string) { return CURRENCY_TYPES.has(type) ? money(v) : plain(v); }
function repName(t: TargetApiRow) { return t.sales_representatives?.user_profiles?.display_name ?? t.sales_representatives?.employee_code ?? 'Unassigned'; }
function achievementPct(t: TargetApiRow) { return t.target_value > 0 ? Math.round((t.achieved_value / t.target_value) * 100) : 0; }
function computeStatus(t: TargetApiRow): 'not_started' | 'on_track' | 'at_risk' | 'achieved' | 'exceeded' {
  const pct = achievementPct(t);
  const now = new Date(); const end = new Date(t.period_end);
  if (t.achieved_value <= 0 && now < end) return 'not_started';
  if (pct >= 110) return 'exceeded';
  if (pct >= 100) return 'achieved';
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000);
  if (pct < 50 && daysLeft <= 10) return 'at_risk';
  if (pct < 40) return 'at_risk';
  return 'on_track';
}
function periodRange(period: 'today' | 'week' | 'month' | 'quarter' | 'year'): { start: string; end: string; label: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (period === 'today') return { start: iso(now), end: iso(now), label: 'Today' };
  if (period === 'week') { const d = new Date(now); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); const start = new Date(d); const end = new Date(d); end.setDate(end.getDate() + 6); return { start: iso(start), end: iso(end), label: 'This Week' }; }
  if (period === 'quarter') { const q = Math.floor(now.getMonth() / 3); const start = new Date(now.getFullYear(), q * 3, 1); const end = new Date(now.getFullYear(), q * 3 + 3, 0); return { start: iso(start), end: iso(end), label: 'This Quarter' }; }
  if (period === 'year') return { start: iso(new Date(now.getFullYear(), 0, 1)), end: iso(new Date(now.getFullYear(), 11, 31)), label: 'This Year' };
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: iso(start), end: iso(end), label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
}

export function TargetsPage() {
  const { config: industryConfig } = useIndustry();
  const { activeIndustryTypeId } = useIndustryScope();
  const industryLabel = industryConfig.label.toUpperCase();

  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'quarter' | 'year'>('month');
  const [targets, setTargets] = useState<TargetApiRow[]>([]);
  const [reps, setReps] = useState<RepOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<TargetApiRow | null>(null);
  const [viewing, setViewing] = useState<TargetApiRow | null>(null);
  const [deleting, setDeleting] = useState<TargetApiRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState('');

  const range = useMemo(() => periodRange(period), [period]);

  async function load() {
    if (!activeIndustryTypeId) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ industryTypeId: activeIndustryTypeId, periodStart: range.start, periodEnd: range.end });
      const [targetsRes, repsRes] = await Promise.all([
        api<{ data: TargetApiRow[] }>(`/targets?${params.toString()}`),
        api<{ data: RepOption[] }>(`/sales-representatives?industryTypeId=${activeIndustryTypeId}&status=active`),
      ]);
      setTargets(targetsRes.data ?? []);
      setReps(repsRes.data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load targets.');
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeIndustryTypeId, range.start, range.end]);

  const filtered = useMemo(() => targets.filter((t) => {
    if (search && !repName(t).toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && computeStatus(t) !== statusFilter) return false;
    return true;
  }), [targets, search, statusFilter]);

  const kpi = useMemo(() => {
    const totalTarget = filtered.reduce((s, t) => s + Number(t.target_value), 0);
    const achieved = filtered.reduce((s, t) => s + t.achieved_value, 0);
    const remaining = Math.max(0, totalTarget - achieved);
    const pct = totalTarget > 0 ? Math.round((achieved / totalTarget) * 100) : 0;
    const atRisk = filtered.filter((t) => computeStatus(t) === 'at_risk').length;
    return { totalTarget, achieved, remaining, pct, atRisk };
  }, [filtered]);

  const alerts = useMemo(() => filtered.filter((t) => computeStatus(t) === 'at_risk'), [filtered]);

  function openCreate() { setEditing(null); setFormMessage(''); setModal(true); }
  function openEdit(t: TargetApiRow) { setEditing(t); setFormMessage(''); setModal(true); }

  async function submitTarget(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeIndustryTypeId) return;
    const form = new FormData(e.currentTarget);
    const body = {
      representativeId: String(form.get('representativeId') || ''),
      industryTypeId: activeIndustryTypeId,
      targetType: String(form.get('targetType') || ''),
      periodStart: range.start,
      periodEnd: range.end,
      periodLabel: range.label,
      targetValue: Number(form.get('targetValue') || 0),
      priority: String(form.get('priority') || 'normal'),
      remarks: String(form.get('remarks') || '') || null,
    };
    setSaving(true); setFormMessage('');
    try {
      if (editing) await api(`/targets/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/targets', { method: 'POST', body: JSON.stringify(body) });
      setModal(false); setEditing(null);
      setMessage(editing ? 'Target updated.' : 'Target created.');
      await load();
    } catch (caught) {
      setFormMessage(caught instanceof Error ? caught.message : 'Unable to save this target.');
    } finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api(`/targets/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      if (viewing?.id === deleting.id) setViewing(null);
      setMessage('Target deleted.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete this target.');
    } finally { setDeleteBusy(false); }
  }

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">{industryLabel} · TARGETS</p>
          <h2>Targets</h2>
          <p>Track rep performance against real orders, collections, and visits.</p>
        </div>
        <button className="primary-action" type="button" onClick={openCreate}>+ Create Target</button>
      </div>

      <div className="kpi-grid" style={{ '--kpi-count': 4 } as React.CSSProperties}>
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon">▦</div><div><span>Total Target</span><strong>{money(kpi.totalTarget)}</strong></div></div>
        <div className="kpi-card" data-tone="green"><div className="kpi-icon">✓</div><div><span>Achieved</span><strong>{money(kpi.achieved)}</strong></div></div>
        <div className="kpi-card" data-tone="amber"><div className="kpi-icon">◔</div><div><span>Remaining</span><strong>{money(kpi.remaining)}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon">%</div><div><span>Achievement %</span><strong>{kpi.pct}%</strong></div></div>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" className={period === p.key ? 'chip chip-active' : 'chip'} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
          <input type="search" placeholder="Search sales rep…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}
      {message && <p className="success-message">{message}</p>}

      <div className="data-table-wrap">
        <table>
          <thead><tr><th>Sales Rep</th><th>Period</th><th>Target</th><th>Achieved</th><th>Remaining</th><th>Achievement %</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? (
              [0, 1, 2].map((i) => <tr key={i} className="skeleton-row"><td colSpan={8}><span className="skeleton-block" style={{ width: '100%' }} /></td></tr>)
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="empty-row"><div className="empty-state"><p>No targets for this period yet.</p><button type="button" className="primary-action" onClick={openCreate}>+ Create Target</button></div></td></tr>
            ) : filtered.map((t) => {
              const pct = achievementPct(t); const status = computeStatus(t);
              return (
                <tr key={t.id}>
                  <td>{repName(t)}</td>
                  <td>{t.period_label}</td>
                  <td>{formatByType(t.target_value, t.target_type)}</td>
                  <td>{formatByType(t.achieved_value, t.target_type)}</td>
                  <td>{formatByType(Math.max(0, t.target_value - t.achieved_value), t.target_type)}</td>
                  <td>{pct}%</td>
                  <td><span className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</span></td>
                  <td className="master-actions">
                    <button type="button" className="icon-action" title="View" onClick={() => setViewing(t)}>◉</button>
                    <button type="button" className="icon-action" title="Edit" onClick={() => openEdit(t)}>✎</button>
                    <button type="button" className="icon-action icon-action--danger" title="Delete" onClick={() => setDeleting(t)}>🗑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {alerts.length > 0 && (
        <>
          <h3>Alerts &amp; Attention Required</h3>
          {alerts.map((t) => <p key={t.id} className="error-message">{repName(t)} is below 60% achievement ({achievementPct(t)}%).</p>)}
        </>
      )}

      {modal && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setModal(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">{industryLabel} · TARGETS</p><h3>{editing ? 'Edit target' : 'Create target'}</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={submitTarget}>
              <div className="field-grid">
                <label>Sales Rep *
                  <select name="representativeId" required defaultValue={editing?.representative_id ?? ''}>
                    <option value="">Select…</option>
                    {reps.map((r) => <option key={r.id} value={r.id}>{r.user_profiles?.display_name ?? r.employee_code}</option>)}
                  </select>
                </label>
                <label>Target Type *
                  <select name="targetType" required defaultValue={editing?.target_type ?? ''}>
                    <option value="">Select…</option>
                    {TARGET_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label>Target Value *
                  <input type="number" name="targetValue" required min={0} step="any" defaultValue={editing?.target_value ?? ''} />
                </label>
                <label>Priority
                  <select name="priority" defaultValue={editing?.priority ?? 'normal'}>
                    <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
                  </select>
                </label>
                <label>Remarks
                  <textarea name="remarks" rows={3} defaultValue={editing?.remarks ?? ''} />
                </label>
              </div>
              <p style={{ fontSize: 13, opacity: 0.7 }}>Period: {range.label} ({range.start} to {range.end})</p>
              {formMessage && <p role="alert" className="error">{formMessage}</p>}
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create Target'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewing && (
        <div className="modal-backdrop" onMouseDown={() => setViewing(null)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">{industryLabel} · TARGETS</p><h3>{repName(viewing)}</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setViewing(null)}>×</button>
            </div>
            <dl className="detail-dl">
              <dt>Period</dt><dd>{viewing.period_label}</dd>
              <dt>Target</dt><dd>{formatByType(viewing.target_value, viewing.target_type)}</dd>
              <dt>Achieved</dt><dd>{formatByType(viewing.achieved_value, viewing.target_type)}</dd>
              <dt>Achievement</dt><dd>{achievementPct(viewing)}%</dd>
              <dt>Orders</dt><dd>{viewing.activity.orders}</dd>
              <dt>Collections</dt><dd>{money(viewing.activity.collections)}</dd>
              <dt>Visits</dt><dd>{viewing.activity.visits}</dd>
              <dt>New Customers</dt><dd>{viewing.activity.newCustomers}</dd>
              <dt>Remarks</dt><dd>{viewing.remarks || '—'}</dd>
            </dl>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => { const t = viewing; setViewing(null); openEdit(t); }}>Edit</button>
              <button type="button" className="primary-action" onClick={() => setViewing(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div className="modal-backdrop modal-backdrop--center" onMouseDown={() => !deleteBusy && setDeleting(null)}>
          <div className="master-modal master-modal--center" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">{industryLabel} · TARGETS</p><h3>Delete target?</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => !deleteBusy && setDeleting(null)}>×</button>
            </div>
            <div style={{ padding: '0 1.6rem 1.2rem' }}><p>This will permanently delete the target for <strong>{repName(deleting)}</strong>. This can't be undone.</p></div>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancel</button>
              <button type="button" className="primary-action icon-action--danger" onClick={confirmDelete} disabled={deleteBusy}>{deleteBusy ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}