import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { targetTypesForIndustry, formatTargetValue, monthRange, customPeriodLabel, TARGET_TYPE_LABELS } from '../lib/targetTypes';
import './MasterDataPages.css';
import './RepresentativesPage.css';

type Representative = { id: string; employee_code: string; user_id: string; designation?: string | null; phone?: string | null; email?: string | null; status: 'active' | 'inactive'; user_profiles?: { display_name?: string | null } | null };
type OrganizationUser = { user_id: string; email?: string | null; status: string; user_profiles?: { display_name?: string | null } | null; roles?: { code?: string | null; name?: string | null } | null };
type RepresentativeForm = { userId: string; employeeCode: string; designation: string; status: 'active' | 'inactive' };
const blank: RepresentativeForm = { userId: '', employeeCode: '', designation: '', status: 'active' };

// Real targets for the rep, read from / written to the same /targets API the Targets page uses.
type RepTarget = { id: string; target_type: string; target_value: number; achieved_value: number; period_label: string; period_start: string; period_end: string };
type TargetDraft = { targetType: string; targetValue: string; periodStart: string; periodEnd: string };
const targetTypeName = (type: string) => TARGET_TYPE_LABELS[type] ?? type.replaceAll('_', ' ');
const progressTone = (pct: number) => (pct >= 100 ? 'good' : pct >= 40 ? 'warn' : pct > 0 ? 'bad' : 'idle');
function initialsOf(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'; }

// Dashboard data — reuses existing endpoints (/clients, /field-visits, /orders,
// /collections, /follow-ups) and matches rows to this rep via the nested
// sales_representatives.employee_code, since none of these types expose a raw rep FK.
type RepMatch = { sales_representatives?: { employee_code?: string } | null };
type RepClient = { id: string; client_name: string; client_code?: string | null; city?: string | null; sales_representative_client_assignments?: { status?: string; sales_representatives?: { employee_code?: string } | null }[] };
type RepVisit = RepMatch & { id: string; check_in_time: string; check_out_time?: string | null };
type RepOrder = RepMatch & { id: string; order_number: string; status: string; total_amount: number; created_at: string };
type RepCollection = RepMatch & { id: string; amount: number; collected_at: string };
type RepFollowUp = RepMatch & { id: string; title: string; status: string; due_at: string };
type RepDashboard = { clients: RepClient[]; visits: RepVisit[]; orders: RepOrder[]; collections: RepCollection[]; followUps: RepFollowUp[] };
const blankDashboard: RepDashboard = { clients: [], visits: [], orders: [], collections: [], followUps: [] };
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const isThisMonth = (iso: string) => { const d = new Date(iso); const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth(); };
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

// Lightweight per-representative summary (clients / visits today / orders today)
// used only for the table's extra columns and the KPI strip — derived from the
// same /clients, /field-visits and /orders endpoints the detail drawer already
// calls, just fetched once for the whole list instead of per-row.
type RepSummary = { clientCount: number; visitsToday: number; ordersToday: number; collectionsToday: number };
const blankSummary: RepSummary = { clientCount: 0, visitsToday: 0, ordersToday: 0, collectionsToday: 0 };

export function RepresentativesPage() {
  const { activeIndustry, activeIndustryTypeId, clientMatchesActiveIndustry } = useIndustryScope();
  const [items, setItems] = useState<Representative[]>([]);
  const [users, setUsers] = useState<OrganizationUser[]>([]);
  const [form, setForm] = useState<RepresentativeForm>(blank);
  const [search, setSearch] = useState('');
  const [designationFilter, setDesignationFilter] = useState('all');
  const [status, setStatus] = useState<'all' | Representative['status']>('all');
  const [editing, setEditing] = useState<Representative | null>(null);
  const [viewing, setViewing] = useState<Representative | null>(null);
  const [assigning, setAssigning] = useState<Representative | null>(null);
  const [assignBusy, setAssignBusy] = useState<string | null>(null);
  const [assignMessage, setAssignMessage] = useState('');
  const [modal, setModal] = useState(false);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<RepDashboard>(blankDashboard);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [repTargets, setRepTargets] = useState<RepTarget[]>([]);
  const [targetDraft, setTargetDraft] = useState<TargetDraft>({ targetType: '', targetValue: '', periodStart: '', periodEnd: '' });
  const [targetMsg, setTargetMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [targetSaving, setTargetSaving] = useState(false);
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);

  // List-wide summary rows(all clients/visits/orders/collections), scoped to
  // the active industry via the same client-scoping helper every other Core
  // Module uses, then bucketed per representative by employee_code.
  const [allClients, setAllClients] = useState<RepClient[]>([]);
  const [allVisits, setAllVisits] = useState<RepVisit[]>([]);
  const [allOrders, setAllOrders] = useState<RepOrder[]>([]);
  const [allCollections, setAllCollections] = useState<RepCollection[]>([]);

  const designations = useMemo(() => [...new Set(items.map((item) => item.designation).filter((item): item is string => Boolean(item)))].sort(), [items]);
  const availableUsers = users.filter((user) => user.status === 'active' && user.roles?.code === 'sales_representative' && !items.some((representative) => representative.user_id === user.user_id));

  const scopedClients = useMemo(() => allClients.filter((c) => clientMatchesActiveIndustry(c.client_code)), [allClients, clientMatchesActiveIndustry]);

  const summaryByCode = useMemo(() => {
    const map = new Map<string, RepSummary>();
    for (const item of items) {
      const code = item.employee_code;
      const clientCount = scopedClients.filter((c) => c.sales_representative_client_assignments?.some((a) => a.status === 'active' && a.sales_representatives?.employee_code === code)).length;
      const visitsToday = allVisits.filter((v) => v.sales_representatives?.employee_code === code && isToday(v.check_in_time)).length;
      const ordersToday = allOrders.filter((o) => o.sales_representatives?.employee_code === code && isToday(o.created_at)).length;
      const collectionsToday = allCollections.filter((c) => c.sales_representatives?.employee_code === code && isToday(c.collected_at)).reduce((sum, c) => sum + (c.amount ?? 0), 0);
      map.set(code, { clientCount, visitsToday, ordersToday, collectionsToday });
    }
    return map;
  }, [items, scopedClients, allVisits, allOrders, allCollections]);

  const filtered = items.filter((item) => {
    if (status !== 'all' && item.status !== status) return false;
    if (designationFilter !== 'all' && (item.designation ?? '') !== designationFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const name = item.user_profiles?.display_name?.toLowerCase() ?? '';
      const code = item.employee_code?.toLowerCase() ?? '';
      if (!name.includes(q) && !code.includes(q)) return false;
    }
    return true;
  });

  const filtersActive = status !== 'all' || designationFilter !== 'all' || search.trim() !== '';
  const clearFilters = () => { setStatus('all'); setDesignationFilter('all'); setSearch(''); };

  const totalReps = items.length;
  const activeReps = items.filter((i) => i.status === 'active').length;
  const inactiveReps = totalReps - activeReps;
  const visitsToday = [...summaryByCode.values()].reduce((sum, s) => sum + s.visitsToday, 0);
  const ordersToday = [...summaryByCode.values()].reduce((sum, s) => sum + s.ordersToday, 0);
  const collectionsToday = [...summaryByCode.values()].reduce((sum, s) => sum + s.collectionsToday, 0);

  async function load() {
    try {
      setLoading(true);
      setMessage('');
      const query = new URLSearchParams(search.trim() ? { search: search.trim() } : {});
      const [representatives, organizationUsers, clients, visits, orders, collections] = await Promise.all([
        api<{ data: Representative[] }>(`/sales-representatives?${query}`),
        api<{ data: OrganizationUser[] }>('/users'),
        api<{ data: RepClient[] }>('/clients').catch(() => ({ data: [] })),
        api<{ data: RepVisit[] }>('/field-visits').catch(() => ({ data: [] })),
        api<{ data: RepOrder[] }>('/orders').catch(() => ({ data: [] })),
        api<{ data: RepCollection[] }>('/collections').catch(() => ({ data: [] })),
      ]);
      setItems(representatives.data ?? []);
      setUsers(organizationUsers.data ?? []);
      setAllClients(clients.data ?? []);
      setAllVisits(visits.data ?? []);
      setAllOrders(orders.data ?? []);
      setAllCollections(collections.data ?? []);
    } catch (error) { setMessage((error as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  // Re-fetch when the operator switches industry so the list-level KPI strip
  // and per-row Clients/Visits/Orders columns reflect the active industry.
  useEffect(() => { void load(); }, [activeIndustry]);
  function nextEmployeeCode(): string {
    const numbers = items
      .map((r) => Number((r.employee_code.match(/(\d+)\s*$/) ?? [])[1]))
      .filter((n) => Number.isFinite(n));
    const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
    return `EMP-${String(next).padStart(3, '0')}`;
  }

  const openCreate = () => { setEditing(null); setForm({ ...blank, employeeCode: nextEmployeeCode() }); setMessage(''); setModal(true); };
  const openEdit = (item: Representative) => { setEditing(item); setForm({ userId: item.user_id, employeeCode: item.employee_code, designation: item.designation ?? '', status: item.status }); setMessage(''); setModal(true); };
  async function view(id: string) {
    try {
      const detail = (await api<{ data: Representative }>(`/sales-representatives/${id}`)).data;
      setViewing(detail);
      const month = monthRange();
      setTargetDraft({ targetType: '', targetValue: '', periodStart: month.start, periodEnd: month.end });
      setTargetMsg(null);
      setShowTargetForm(false);
      void fetchRepTargets(id);
      setDashboardLoading(true);
      const [clients, visits, orders, collections, followUps] = await Promise.all([
        api<{ data: RepClient[] }>('/clients').catch(() => ({ data: [] })),
        api<{ data: RepVisit[] }>('/field-visits').catch(() => ({ data: [] })),
        api<{ data: RepOrder[] }>('/orders').catch(() => ({ data: [] })),
        api<{ data: RepCollection[] }>('/collections').catch(() => ({ data: [] })),
        api<{ data: RepFollowUp[] }>('/follow-ups').catch(() => ({ data: [] })),
      ]);
      const mine = (row: RepMatch) => row.sales_representatives?.employee_code === detail.employee_code;
      setDashboard({
        clients: (clients.data ?? []).filter((c) => c.sales_representative_client_assignments?.some((a) => a.status === 'active' && a.sales_representatives?.employee_code === detail.employee_code)),
        visits: (visits.data ?? []).filter(mine),
        orders: (orders.data ?? []).filter(mine),
        collections: (collections.data ?? []).filter(mine),
        followUps: (followUps.data ?? []).filter(mine),
      });
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setDashboardLoading(false);
    }
  }
  async function fetchRepTargets(repId: string) {
    if (!activeIndustryTypeId) { setRepTargets([]); return; }
    const month = monthRange();
    const params = new URLSearchParams({ industryTypeId: activeIndustryTypeId, representativeId: repId, periodStart: month.start, periodEnd: month.end });
    try {
      const res = await api<{ data: RepTarget[] }>(`/targets?${params.toString()}`);
      setRepTargets(res.data ?? []);
    } catch {
      setRepTargets([]);
    }
  }
  async function addTarget(event: FormEvent) {
    event.preventDefault();
    if (!viewing || !activeIndustryTypeId) return;
    const { targetType, targetValue, periodStart, periodEnd } = targetDraft;
    if (periodEnd < periodStart) { setTargetMsg({ kind: 'error', text: 'End date cannot be before the start date.' }); return; }
    const month = monthRange();
    const isMonth = periodStart === month.start && periodEnd === month.end;
    setTargetSaving(true); setTargetMsg(null);
    try {
      await api('/targets', { method: 'POST', body: JSON.stringify({
        representativeId: viewing.id, industryTypeId: activeIndustryTypeId, targetType,
        periodStart, periodEnd, periodLabel: isMonth ? month.label : customPeriodLabel(periodStart, periodEnd),
        targetValue: Number(targetValue), priority: 'normal', remarks: null,
      }) });
      setTargetDraft({ ...targetDraft, targetType: '', targetValue: '' });
      setTargetMsg({ kind: 'ok', text: 'Target added.' });
      setShowTargetForm(false);
      await fetchRepTargets(viewing.id);
    } catch (error) {
      setTargetMsg({ kind: 'error', text: (error as Error).message });
    } finally { setTargetSaving(false); }
  }
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setMessage(''); try { await api(editing ? `/sales-representatives/${editing.id}` : '/sales-representatives', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(form) }); setModal(false); setEditing(null); setMessage(editing ? 'Sales representative updated successfully.' : 'Sales representative created successfully.'); await load(); } catch (error) { setMessage((error as Error).message); } finally { setSaving(false); } }
    async function toggle(item: Representative) { try { await api(`/sales-representatives/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: item.status === 'active' ? 'inactive' : 'active' }) }); setMessage('Sales representative status updated successfully.'); await load(); } catch (error) { setMessage((error as Error).message); } }
  function openAssign(item: Representative) { setAssigning(item); setAssignMessage(''); }
  async function toggleClientAssignment(client: RepClient, isAssigned: boolean) {
    if (!assigning) return;
    setAssignBusy(client.id); setAssignMessage('');
    try {
      await api(`/sales-representatives/${assigning.id}/clients/${client.id}`, { method: isAssigned ? 'DELETE' : 'POST' });
      await load();
    } catch (error) {
      setAssignMessage((error as Error).message);
    } finally {
      setAssignBusy(null);
    }
  }
  function toggleMenu(event: React.MouseEvent<HTMLButtonElement>, repId: string) {
    if (menuFor?.id === repId) {
      setMenuFor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: repId, top: rect.bottom + 6, left: Math.max(8, rect.right - 168) });
  }

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">FIELD TEAM</p>
          <h2>Sales Representatives</h2>
          <p>Manage your sales team, assignments and field performance.</p>
        </div>
        <button className="primary-action" type="button" onClick={openCreate}>+ Add Representative</button>
      </div>

          <div className="kpi-grid rep-kpi-grid">
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon kpi-icon-ink">◈</div><div><span>Total Representatives</span><strong>{totalReps}</strong></div></div>
        <div className="kpi-card" data-tone="green"><div className="kpi-icon kpi-icon-green">✓</div><div><span>Active</span><strong>{activeReps}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon kpi-icon-red">⊘</div><div><span>Inactive</span><strong>{inactiveReps}</strong></div></div>
        <div className="kpi-card" data-tone="blue"><div className="kpi-icon kpi-icon-blue">◔</div><div><span>Visits Today</span><strong>{visitsToday}</strong></div></div>
        <div className="kpi-card" data-tone="amber"><div className="kpi-icon kpi-icon-amber">▤</div><div><span>Orders Today</span><strong>{ordersToday}</strong></div></div>
        <div className="kpi-card" data-tone="green"><div className="kpi-icon kpi-icon-green">₹</div><div><span>Collections Today</span><strong>{money(collectionsToday)}</strong></div></div>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input value={search} placeholder="Search name or employee code" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(); }} />
          <select value={designationFilter} onChange={(event) => setDesignationFilter(event.target.value)}>
            <option value="all">All designations</option>
            {designations.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button type="button" className="link-button" disabled={!filtersActive} onClick={clearFilters}>Clear Filters</button>
        </div>
      </div>

      {message && <p role="status" className={message.includes('successfully') ? 'success' : 'error'}>{message}</p>}

      {loading ? (
        <p>Loading sales representatives…</p>
      ) : filtered.length === 0 && !filtersActive ? (
        <div className="empty-state empty-state-lg">
          <div className="empty-state-icon">◈</div>
          <h3>No sales representatives yet</h3>
          <p>Add a representative to start managing your field team.</p>
          <button className="primary-action" type="button" onClick={openCreate}>+ Add Representative</button>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Representative</th><th>Employee Code</th><th>Designation</th>
                <th>Clients</th><th>Visits</th><th>Orders</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const summary = summaryByCode.get(item.employee_code) ?? blankSummary;
                return (
                  <tr key={item.id}>
                    <td><strong>{item.user_profiles?.display_name ?? '—'}</strong></td>
                    <td>{item.employee_code}</td>
                    <td>{item.designation ?? '—'}</td>
                    <td>{summary.clientCount}</td>
                    <td>{summary.visitsToday}</td>
                    <td>{summary.ordersToday}</td>
                    <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
                                     <td className="master-actions">
                      <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label="More actions" onClick={(e) => toggleMenu(e, item.id)}>
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
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="empty-row">No representatives match these filters. <button type="button" className="link-button" onClick={clearFilters}>Clear filters</button></td></tr>
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
              const item = filtered.find((r) => r.id === menuFor.id);
              if (!item) return null;
              return (
                <>
                  <button type="button" title="View" onClick={() => { setMenuFor(null); void view(item.id); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span>View</span>
                  </button>
                  <button type="button" title="Edit" onClick={() => { setMenuFor(null); openEdit(item); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
                    </svg>
                    <span>Edit</span>
                  </button>
                                  <button type="button" title="Assign clients" onClick={() => { setMenuFor(null); openAssign(item); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="7" r="4" />
                      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
                      <path d="M19 8v6M22 11h-6" />
                    </svg>
                    <span>Assign clients</span>
                  </button>
                  <button
                    type="button"
                    title={item.status === 'active' ? 'Deactivate' : 'Activate'}
                    className={item.status === 'active' ? 'row-menu-danger' : undefined}
                    onClick={() => { setMenuFor(null); void toggle(item); }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M4.9 4.9l14.2 14.2" />
                    </svg>
                    <span>{item.status === 'active' ? 'Deactivate' : 'Activate'}</span>
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}

        {assigning && (() => {
              const assignedIds = new Set(
          scopedClients
            .filter((c) => c.sales_representative_client_assignments?.some((a) => a.status === 'active' && a.sales_representatives?.employee_code === assigning.employee_code))
            .map((c) => c.id)
        );
        // A client owned by another rep is hidden here until that rep is unassigned.
        const ownedByOtherRep = (c: RepClient) =>
          c.sales_representative_client_assignments?.some((a) => a.status === 'active' && a.sales_representatives?.employee_code !== assigning.employee_code);
        const visibleClients = scopedClients.filter((c) => assignedIds.has(c.id) || !ownedByOtherRep(c));
        return (
          <div className="modal-backdrop" onMouseDown={() => setAssigning(null)}>
            <div className="master-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
              <div className="modal-heading">
                <div>
                  <p className="eyebrow">FIELD TEAM</p>
                  <h3>Assign clients — {assigning.user_profiles?.display_name ?? assigning.employee_code}</h3>
                </div>
                <button className="icon-action" type="button" aria-label="Close" onClick={() => setAssigning(null)}>×</button>
              </div>
              {assignMessage && <p role="alert" className="error" style={{ margin: '0 1.6rem' }}>{assignMessage}</p>}
              <p style={{ margin: '0 1.6rem .8rem', fontSize: 13, opacity: 0.75 }}>
                {assignedIds.size} assigned to this rep · {visibleClients.length - assignedIds.size} available. Clients already owned by another rep are hidden. Assigned clients are the ones this rep can check in to from the mobile app.              </p>
              <div className="data-table-wrap" style={{ margin: '0 1.6rem 1rem', maxHeight: 420, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Client</th><th>City</th><th /></tr></thead>
                  <tbody>
                                      {visibleClients.map((client) => {
                      const isAssigned = assignedIds.has(client.id);
                      return (
                        <tr key={client.id}>
                          <td><strong>{client.client_name}</strong></td>
                          <td>{client.city ?? '—'}</td>
                          <td className="master-actions">
                            <button
                              type="button"
                              className={isAssigned ? 'quiet-button' : 'primary-action'}
                              disabled={assignBusy === client.id}
                              onClick={() => void toggleClientAssignment(client, isAssigned)}
                            >
                              {assignBusy === client.id ? 'Saving…' : isAssigned ? 'Unassign' : 'Assign'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {visibleClients.length === 0 && <tr><td colSpan={3} className="empty-row">No unassigned clients available.</td></tr>}                  </tbody>
                </table>
              </div>
              <div className="modal-actions">
                <button type="button" className="primary-action" onClick={() => setAssigning(null)}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}

      {modal && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setModal(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="representative-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">FIELD TEAM</p><h3 id="representative-modal-title">{editing ? 'Edit Sales Representative' : 'Add Sales Representative'}</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={submit}>
              {!editing && (
                <label>Sales representative user
                  <select required value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}>
                    <option value="">Select a user</option>
                    {availableUsers.map((user) => <option key={user.user_id} value={user.user_id}>{user.user_profiles?.display_name ?? user.email ?? user.user_id}{user.email ? ` — ${user.email}` : ''}</option>)}
                  </select>
                  <small>{availableUsers.length ? 'Only active users with the Sales Representative role are shown.' : 'Create a user with Sales Representative role first, under User management.'}</small>
                </label>
              )}
                <label>Employee code<input required readOnly value={form.employeeCode} title="Auto-generated from existing employee codes" /></label>
              <label>Designation
                <select value={form.designation} onChange={(event) => setForm({ ...form, designation: event.target.value })}>
                  <option value="">Select designation</option>
                  {[...new Set(['Sales Representative', 'Senior Sales Representative', 'Territory Sales Executive', ...designations])].map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label>Status
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Representative['status'] })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving || (!editing && !form.userId)}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add representative'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewing && (() => {
        const todaysVisits = dashboard.visits.filter((v) => isToday(v.check_in_time));
        const completedVisits = todaysVisits.filter((v) => v.check_out_time);
        const pendingVisits = todaysVisits.length - completedVisits.length;
        const ordersTodayList = dashboard.orders.filter((o) => isToday(o.created_at));
        const salesToday = ordersTodayList.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);
        const collectionsTodayValue = dashboard.collections.filter((c) => isToday(c.collected_at)).reduce((sum, c) => sum + (c.amount ?? 0), 0);
        const monthSales = dashboard.orders.filter((o) => isThisMonth(o.created_at)).reduce((sum, o) => sum + (o.total_amount ?? 0), 0);
        const nonCancelledOrders = dashboard.orders.filter((o) => o.status !== 'cancelled');
        const totalSales = nonCancelledOrders.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);
        const totalCollected = dashboard.collections.reduce((sum, c) => sum + (c.amount ?? 0), 0);
        const outstandingCollection = Math.max(0, totalSales - totalCollected);
        const pendingFollowUps = dashboard.followUps.filter((f) => f.status === 'pending');
        const areas = [...new Set(dashboard.clients.map((c) => c.city).filter((c): c is string => Boolean(c)))];
        const recentOrders = [...dashboard.orders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5);
        const recentVisits = [...dashboard.visits].sort((a, b) => new Date(b.check_in_time).getTime() - new Date(a.check_in_time).getTime()).slice(0, 5);
        const repName = viewing.user_profiles?.display_name ?? viewing.employee_code;
        const typeOptions = targetTypesForIndustry(activeIndustry);
        const shownClients = dashboard.clients.slice(0, 6);

        return (
          <div className="modal-backdrop" onMouseDown={() => setViewing(null)}>
            <div className="master-modal detail-panel rp-panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
              <div className="modal-heading">
                <div className="rp-identity">
                  <span className="rp-avatar">{initialsOf(repName)}</span>
                  <div>
                    <p className="eyebrow">REPRESENTATIVE PROFILE</p>
                    <h3>{repName}</h3>
                    <p className="rp-sub">{viewing.employee_code}{viewing.designation ? ` · ${viewing.designation}` : ''} <span className={`status-badge ${viewing.status}`}>{viewing.status}</span></p>
                  </div>
                </div>
                <button className="icon-action" type="button" aria-label="Close" onClick={() => setViewing(null)}>×</button>
              </div>

              <div className="rp-body">
                <section className="rp-section">
                  <h4 className="rp-title">Contact &amp; assignment</h4>
                  <dl className="rp-info">
                    <div><dt>Phone</dt><dd>{viewing.phone ?? '—'}</dd></div>
                    <div><dt>Email</dt><dd>{viewing.email ?? '—'}</dd></div>
                    <div><dt>Assigned areas</dt><dd>{areas.join(', ') || 'None recorded'}</dd></div>
                    <div>
                     <dt>Assigned clients ({dashboard.clients.length})</dt>
                      <dd>
                        {shownClients.length === 0 ? 'None' : (
                          <span className="rp-chips">
                            {shownClients.map((c) => <span key={c.id} className="rp-chip">{c.client_name}</span>)}
                            {dashboard.clients.length > shownClients.length && <span className="rp-chip rp-chip--more">+{dashboard.clients.length - shownClients.length} more</span>}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="rp-section">
                  <div className="rp-title-row">
                    <h4 className="rp-title">Targets · {monthRange().label}</h4>
                    {!showTargetForm && <button type="button" className="rp-add-btn" onClick={() => { setShowTargetForm(true); setTargetMsg(null); }}>+ Add target</button>}
                  </div>
                  {targetMsg?.kind === 'ok' && <p className="rp-msg rp-msg--ok" role="status" style={{ margin: '0 0 .7rem' }}>{targetMsg.text}</p>}

                  {repTargets.length === 0 ? (
                    <p className="rp-empty">No targets set for this month yet. Add one below.</p>
                  ) : (
                    <ul className="rp-target-list">
                      {repTargets.map((t) => {
                        const pct = t.target_value > 0 ? Math.round((t.achieved_value / t.target_value) * 100) : 0;
                        return (
                          <li key={t.id} className="rp-target">
                            <div className="rp-target-top">
                              <strong>{targetTypeName(t.target_type)}</strong>
                              <span className="rp-target-period">{t.period_label}</span>
                            </div>
                            <div className="rp-target-figures">
                              <span>{formatTargetValue(t.achieved_value, t.target_type)} <em>of</em> {formatTargetValue(t.target_value, t.target_type)}</span>
                              <b>{pct}%</b>
                            </div>
                            <div className="rp-bar"><span className={`rp-bar-fill rp-bar-fill--${progressTone(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {showTargetForm && (<form className="rp-target-form" onSubmit={(event) => void addTarget(event)}>
                    <p className="rp-form-title">Add a target</p>
                    <div className="rp-form-grid">
                      <label>Target type
                        <select required value={targetDraft.targetType} onChange={(e) => setTargetDraft({ ...targetDraft, targetType: e.target.value })}>
                          <option value="">Select…</option>
                          {typeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </label>
                      <label>Target value
                        <input type="number" required min={0} step="any" placeholder="e.g. 100000" value={targetDraft.targetValue} onChange={(e) => setTargetDraft({ ...targetDraft, targetValue: e.target.value })} />
                      </label>
                      <label>Period start
                        <input type="date" required value={targetDraft.periodStart} onChange={(e) => setTargetDraft({ ...targetDraft, periodStart: e.target.value })} />
                      </label>
                      <label>Period end
                        <input type="date" required value={targetDraft.periodEnd} onChange={(e) => setTargetDraft({ ...targetDraft, periodEnd: e.target.value })} />
                      </label>
                    </div>
                    <div className="rp-form-actions">
                      {targetMsg?.kind === 'error' && <span className="rp-msg rp-msg--error" role="alert">{targetMsg.text}</span>}
                      <button type="button" className="quiet-button" onClick={() => { setShowTargetForm(false); setTargetMsg(null); }} disabled={targetSaving}>Cancel</button>
                      <button type="submit" className="primary-action" disabled={targetSaving || !activeIndustryTypeId}>{targetSaving ? 'Saving…' : 'Add target'}</button>
                    </div>
                  </form>)}

                  <div className="rp-target-footer">
                    <span className="rp-empty" style={{ margin: 0 }}>Edit or delete targets, and compare all reps, in the Targets module.</span>
                    <a className="rp-link" href="#target">Open Targets →</a>
                  </div>
                </section>

                <section className="rp-section">
                  <h4 className="rp-title">Today</h4>
                  {dashboardLoading ? <p className="rp-empty">Loading today's activity…</p> : (
                    <div className="rp-stats">
                      <div className="rp-stat"><span>Visits</span><strong>{todaysVisits.length}</strong><small>{completedVisits.length} done · {pendingVisits} pending</small></div>
                      <div className="rp-stat"><span>Orders</span><strong>{ordersTodayList.length}</strong><small>{money(salesToday)} sales value</small></div>
                      <div className="rp-stat"><span>Collections</span><strong>{money(collectionsTodayValue)}</strong><small>collected today</small></div>
                    </div>
                  )}
                </section>

                <section className="rp-section">
                  <h4 className="rp-title">Overall</h4>
                  {dashboardLoading ? null : (
                    <div className="rp-stats">
                      <div className="rp-stat"><span>Sales this month</span><strong>{money(monthSales)}</strong></div>
                      <div className="rp-stat"><span>Outstanding collection</span><strong>{money(outstandingCollection)}</strong></div>
                      <div className="rp-stat"><span>Pending follow-ups</span><strong>{pendingFollowUps.length}</strong></div>
                    </div>
                  )}
                </section>

                <section className="rp-section">
                  <h4 className="rp-title">Recent activity</h4>
                  <div className="data-table-wrap">
                    <table>
                      <thead><tr><th>Type</th><th>Reference</th><th>When</th></tr></thead>
                      <tbody>
                        {recentOrders.map((o) => <tr key={`o-${o.id}`}><td>Order</td><td>{o.order_number} · {money(o.total_amount)}</td><td>{new Date(o.created_at).toLocaleString('en-IN')}</td></tr>)}
                        {recentVisits.map((v) => <tr key={`v-${v.id}`}><td>Visit</td><td>{v.check_out_time ? 'Completed' : 'Checked in'}</td><td>{new Date(v.check_in_time).toLocaleString('en-IN')}</td></tr>)}
                        {recentOrders.length === 0 && recentVisits.length === 0 && <tr><td colSpan={3} className="empty-row">No recent activity recorded yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <p className="rp-note">Use Field activity to check in, capture requirements, take orders, record collections, and check out.</p>
                </section>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}