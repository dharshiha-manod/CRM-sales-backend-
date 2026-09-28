import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useIndustry } from '../industry/IndustryContext';
import { useIndustryScope } from '../industry/useIndustryScope';
import { TARGET_TYPE_OPTIONS, TARGET_TYPE_LABELS, CURRENCY_TYPES, COMMON_TARGET_TYPES, INDUSTRY_TARGET_TYPES } from '../lib/targetTypes';
import { useOrgSettings } from '../settings/useOrgSettings';           // ← NEW
import type { TargetConfig } from '../settings/types';                 // ← NEW
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

const TARGET_SOURCES: Record<string, string> = {
  sales_amount: 'Recorded collections', order_value: 'Confirmed sales orders', order_count: 'Confirmed sales orders',
  collection_amount: 'Recorded collections', fee_collection: 'Recorded collections',
  product_quantity: 'Order line quantities', order_quantity: 'Order line quantities', meter_quantity: 'Order line quantities', quantity_sold: 'Order line quantities',
  visit_count: 'Completed field visits', client_visits: 'Completed field visits', institution_visits: 'Completed field visits', doctor_visits: 'Completed field visits', pharmacy_visits: 'Completed field visits',
  new_customers: 'New client assignments', admission_target: 'New client assignments', student_enrollment: 'New client assignments', followups: 'Completed field visits',
};

const PERIODS: { key: 'today' | 'week' | 'month' | 'quarter' | 'year'; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'year', label: 'This Year' },
];

const STATUS_LABEL: Record<string, string> = { not_started: 'Not Started', on_track: 'On Track', at_risk: 'At Risk', achieved: 'Achieved', exceeded: 'Exceeded' };

const money = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(v || 0));
const plain = (v: number) => new Intl.NumberFormat('en-IN').format(Math.round(v || 0));
function formatByType(v: number, type: string) { return CURRENCY_TYPES.has(type) ? money(v) : plain(v); }
function targetTypeLabel(type: string) { return TARGET_TYPE_LABELS[type] ?? type.replaceAll('_', ' '); }
function targetSource(type: string) { return TARGET_SOURCES[type] ?? 'Live CRM activity'; }
function customPeriodLabel(start: string, end: string) {
  const fmt = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}
const ICON_PROPS = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const EyeIcon = () => <svg {...ICON_PROPS}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
const EditIcon = () => <svg {...ICON_PROPS}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>;
const TrashIcon = () => <svg {...ICON_PROPS}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>;
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'; }
function barTone(status: string) { return status === 'exceeded' || status === 'achieved' ? 'good' : status === 'at_risk' ? 'bad' : status === 'on_track' ? 'warn' : 'idle'; }
function repName(t: TargetApiRow) { return t.sales_representatives?.user_profiles?.display_name ?? t.sales_representatives?.employee_code ?? 'Unassigned'; }
function achievementPct(t: TargetApiRow) { return t.target_value > 0 ? Math.round((t.achieved_value / t.target_value) * 100) : 0; }
// ↓ CHANGED: thresholds now come from Settings → Target Configuration
// instead of fixed numbers (40 / 50 / 100 / 110) baked into the code.
function computeStatus(t: TargetApiRow, config: TargetConfig): 'not_started' | 'on_track' | 'at_risk' | 'achieved' | 'exceeded' {
  const pct = achievementPct(t);
  const now = new Date(); const end = new Date(t.period_end);
  if (t.achieved_value <= 0 && now < end) return 'not_started';
  if (pct >= config.achievedAtPercent + 10) return 'exceeded';
  if (pct >= config.achievedAtPercent) return 'achieved';
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000);
  if (pct < config.onTrackBelowPercent && daysLeft <= 10) return 'at_risk';
  if (pct < config.atRiskBelowPercent) return 'at_risk';
  return 'on_track';
}
function periodRange(period: 'today' | 'week' | 'month' | 'quarter' | 'year'): { start: string; end: string; label: string } {
  const now = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  const activeIndustryKey = industryConfig.key;
  const targetTypeOptions = useMemo(() => {
    const allowed = new Set(INDUSTRY_TARGET_TYPES[activeIndustryKey] ?? COMMON_TARGET_TYPES);
    return TARGET_TYPE_OPTIONS.filter((o) => allowed.has(o.value));
  }, [activeIndustryKey]);
  const { settings: orgSettings, loading: settingsLoading } = useOrgSettings(); // ← NEW

  // Settings → Target Configuration → Default period
  const DEFAULT_PERIOD_MAP: Record<TargetConfig['defaultPeriod'], 'week' | 'month' | 'quarter'> = { Weekly: 'week', Monthly: 'month', Quarterly: 'quarter' };
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'quarter' | 'year'>('month');
  const periodSeeded = useRef(false);
  useEffect(() => {
    if (periodSeeded.current || settingsLoading) return;
    periodSeeded.current = true;
    setPeriod(DEFAULT_PERIOD_MAP[orgSettings.target.defaultPeriod]);
  }, [settingsLoading, orgSettings]);
  const [targets, setTargets] = useState<TargetApiRow[]>([]);
  const [reps, setReps] = useState<RepOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);
  function toggleMenu(event: React.MouseEvent<HTMLButtonElement>, targetId: string) {
    if (menuFor?.id === targetId) { setMenuFor(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: targetId, top: rect.bottom + 4, left: Math.max(8, rect.right - 170) });
  }
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

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function load() {
    if (!activeIndustryTypeId) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ industryTypeId: activeIndustryTypeId, periodStart: range.start, periodEnd: range.end });
   const [targetsRes, repsRes] = await Promise.all([
  api<{ data: TargetApiRow[] }>(`/targets?${params.toString()}`),
  api<{ data: RepOption[] }>(`/sales-representatives?status=active`),
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
if (statusFilter && computeStatus(t, orgSettings.target) !== statusFilter) return false;
    return true;
}), [targets, search, statusFilter, orgSettings.target]);

  const kpi = useMemo(() => {
    const totalTarget = filtered.reduce((s, t) => s + Number(t.target_value), 0);
    const achieved = filtered.reduce((s, t) => s + t.achieved_value, 0);
    const remaining = Math.max(0, totalTarget - achieved);
    const pct = totalTarget > 0 ? Math.round((achieved / totalTarget) * 100) : 0;
   const atRisk = filtered.filter((t) => computeStatus(t, orgSettings.target) === 'at_risk').length;
return { totalTarget, achieved, remaining, pct, atRisk };
}, [filtered, orgSettings.target]);
  const metricTypes = useMemo(() => [...new Set(filtered.map((target) => target.target_type))], [filtered]);
  const oneMetricType = metricTypes.length === 1 ? metricTypes[0] : null;
  const kpiLabel = oneMetricType ? targetTypeLabel(oneMetricType) : 'Selected targets';
  const formatKpi = (value: number) => oneMetricType ? formatByType(value, oneMetricType) : '—';

const alerts = useMemo(() => filtered.filter((t) => computeStatus(t, orgSettings.target) === 'at_risk'), [filtered, orgSettings.target]);

  function openCreate() { setEditing(null); setFormMessage(''); setModal(true); }
  function openEdit(t: TargetApiRow) { setEditing(t); setFormMessage(''); setModal(true); }

  async function submitTarget(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeIndustryTypeId) return;
    const form = new FormData(e.currentTarget);
    const periodStart = String(form.get('periodStart') || range.start);
    const periodEnd = String(form.get('periodEnd') || range.end);
    if (periodEnd < periodStart) { setFormMessage('End date cannot be before the start date.'); return; }
    const isPreset = periodStart === range.start && periodEnd === range.end;
    const body = {
      representativeId: String(form.get('representativeId') || ''),
      industryTypeId: activeIndustryTypeId,
      targetType: String(form.get('targetType') || ''),
      periodStart,
      periodEnd,
      periodLabel: isPreset ? range.label : customPeriodLabel(periodStart, periodEnd),
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
    <section className="page-panel master-page targets-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">{industryLabel} · TARGETS</p>
          <h2>Targets</h2>
          <p>Track rep performance against real orders, collections, and visits.</p>
        </div>
        <button className="primary-action" type="button" onClick={openCreate}>+ Create Target</button>
      </div>

      <div className="kpi-grid" style={{ '--kpi-count': 4 } as React.CSSProperties}>
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon">▦</div><div><span>Total Target · {kpiLabel}</span><strong>{formatKpi(kpi.totalTarget)}</strong></div></div>
        <div className="kpi-card" data-tone="green"><div className="kpi-icon">✓</div><div><span>Achieved · {kpiLabel}</span><strong>{formatKpi(kpi.achieved)}</strong></div></div>
        <div className="kpi-card" data-tone="amber"><div className="kpi-icon">◔</div><div><span>Remaining · {kpiLabel}</span><strong>{formatKpi(kpi.remaining)}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon">%</div><div><span>Achievement %</span><strong>{oneMetricType ? `${kpi.pct}%` : '—'}</strong></div></div>
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
      {message && <p className="success-message tg-toast" role="status"><span>✓ {message}</span><button type="button" aria-label="Dismiss" onClick={() => setMessage('')}>×</button></p>}

      <div className="data-table-wrap">
        <table className="tg-table">
          <thead><tr><th>Sales Rep</th><th>Metric</th><th>Period</th><th className="tg-num">Target</th><th className="tg-num">Achieved</th><th className="tg-num">Remaining</th><th>Achievement</th><th>Status</th><th className="tg-actions-head">Actions</th></tr></thead>
          <tbody>
            {loading ? (
              [0, 1, 2].map((i) => <tr key={i} className="skeleton-row"><td colSpan={9}><span className="skeleton-block" style={{ width: '100%' }} /></td></tr>)
                 ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="empty-row"><div className="empty-state"><p>No targets for this period yet.</p><button type="button" className="primary-action" onClick={openCreate}>+ Create Target</button></div></td></tr>
            ) : filtered.map((t) => {
              const pct = achievementPct(t); const status = computeStatus(t, orgSettings.target);
              return (  
                <tr key={t.id}>
                  <td><div className="tg-rep"><span className="tg-avatar">{initials(repName(t))}</span><strong>{repName(t)}</strong></div></td>
                  <td><div className="tg-metric"><strong>{targetTypeLabel(t.target_type)}</strong><small>{targetSource(t.target_type)}</small></div></td>
                  <td><span className="tg-period">{t.period_label}</span></td>
                  <td className="tg-num">{formatByType(t.target_value, t.target_type)}</td>
                  <td className="tg-num">{formatByType(t.achieved_value, t.target_type)}</td>
                  <td className="tg-num">{formatByType(Math.max(0, t.target_value - t.achieved_value), t.target_type)}</td>
                  <td><div className="tg-achv"><div className="tg-bar"><span className={`tg-bar-fill tg-bar-fill--${barTone(status)}`} style={{ width: `${Math.min(100, pct)}%` }} /></div><b>{pct}%</b></div></td>
                  <td><span className={`tg-status tg-status--${status}`}><i />{STATUS_LABEL[status]}</span></td>
                  <td>
                    <div className="tg-actions">
                      <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label={`Actions for ${repName(t)}`} onClick={(event) => toggleMenu(event, t.id)}>⋯</button>
                    </div>
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
{alerts.map((t) => <p key={t.id} className="error-message">{repName(t)} is below {orgSettings.target.atRiskBelowPercent}% achievement ({achievementPct(t)}%).</p>)}        </>
      )}

      {menuFor && (
        <>
          <div className="row-menu-backdrop" onMouseDown={() => setMenuFor(null)} />
          <div className="row-menu row-menu--icons" style={{ top: menuFor.top, left: menuFor.left }}>
            {(() => {
              const item = filtered.find((row) => row.id === menuFor.id);
              if (!item) return null;
              return (
                <>
                  <button type="button" onClick={() => { setMenuFor(null); setViewing(item); }}><EyeIcon /><span>View</span></button>
                  <button type="button" onClick={() => { setMenuFor(null); openEdit(item); }}><EditIcon /><span>Edit</span></button>
                  <button type="button" className="row-menu-danger" onClick={() => { setMenuFor(null); setDeleting(item); }}><TrashIcon /><span>Delete</span></button>
                </>
              );
            })()}
          </div>
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
                    {(editing && !targetTypeOptions.some((o) => o.value === editing.target_type)
                      ? [...targetTypeOptions, { value: editing.target_type, label: targetTypeLabel(editing.target_type) }]
                      : targetTypeOptions
                    ).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                <label>Period Start *
                  <input type="date" name="periodStart" required defaultValue={editing?.period_start?.slice(0, 10) ?? range.start} />
                </label>
                <label>Period End *
                  <input type="date" name="periodEnd" required defaultValue={editing?.period_end?.slice(0, 10) ?? range.end} />
                </label>
                <p style={{ fontSize: 13, opacity: 0.7 }}>Defaults to the selected filter ({range.label}). Change the dates for a custom period.</p>
                <label>Remarks
                  <textarea name="remarks" rows={3} defaultValue={editing?.remarks ?? ''} />
                </label>
              </div>
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
              <dt>Metric</dt><dd>{targetTypeLabel(viewing.target_type)} · {targetSource(viewing.target_type)}</dd>
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