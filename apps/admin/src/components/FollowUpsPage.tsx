import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { useOrgSettings } from '../settings/useOrgSettings';
import './MasterDataPages.css';
import './FollowUpsPage.css';

type FollowUp = {
  id: string;
  title: string;
  due_at: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  notes?: string | null;
  reschedule_count?: number;
  outcome?: string | null;
  follow_up_type?: string | null;
  previous_follow_up_id?: string | null;
  created_at?: string | null;
  completion_note?: string | null;
  completed_at?: string | null;
  client_id?: string | null;
  lead_id?: string | null;
  clients?: { client_code?: string | null; client_name?: string | null } | null;
  leads?: { lead_code?: string | null; company_name?: string | null; industry_type_id?: string | null; notes?: string | null } | null;
  sales_representatives?: { employee_code?: string | null; user_profiles?: { display_name?: string | null } | null } | null;
};

type ClientOption = { id: string; code: string; name: string; representativeId: string | null };
type RepresentativeOption = { id: string; employee_code?: string; user_profiles?: { display_name?: string | null } | null };

type RescheduleEntry = { id: string; old_due_at: string; new_due_at: string; reason?: string | null; created_at: string };

const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const toLocalInput = (value: string) => {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};const FMCG_META_MARKER = '<<<FMCG_META>>>';

function displayFollowUpNotes(notes?: string | null): string | null {
  if (notes == null) return null;
  const markerIndex = notes.indexOf(FMCG_META_MARKER);
  return markerIndex === -1 ? notes : notes.slice(0, markerIndex).trimEnd();
}

const OUTCOMES: { value: string; label: string }[] = [
  { value: 'connected', label: 'Spoke to the customer' },
  { value: 'no_answer', label: 'No answer / not reachable' },
  { value: 'promised_payment', label: 'Customer promised payment' },
  { value: 'visit_needed', label: 'Needs another visit' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'other', label: 'Other' },
];
const outcomeLabel = (value?: string | null) => OUTCOMES.find((o) => o.value === value)?.label ?? value ?? '';

// Labels match the keys saved in Settings → Follow-up Configuration → types.
const TYPE_LIST: { value: string; label: string; icon: string }[] = [
  { value: 'call', label: 'Call', icon: '📞' },
  { value: 'visit', label: 'Visit', icon: '📍' },
  { value: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { value: 'email', label: 'Email', icon: '✉️' },
  { value: 'meeting', label: 'Meeting', icon: '👥' },
  { value: 'other', label: 'Other', icon: '•' },
];
const typeOf = (value?: string | null) => TYPE_LIST.find((t) => t.value === (value ?? 'call')) ?? TYPE_LIST[0];

type Tab = 'open' | 'overdue' | 'today' | 'upcoming' | 'completed' | 'all';
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
function relDue(item: { due_at: string; status: string; completed_at?: string | null }): string {
  if (['completed', 'cancelled'].includes(item.status)) return item.status === 'completed' && item.completed_at ? `Done ${dateLabel(item.completed_at)}` : '';
  const dayDiff = Math.round((startOfDay(new Date(item.due_at)) - startOfDay(new Date())) / 86400000);
  if (dayDiff < 0) return `${-dayDiff} day${dayDiff === -1 ? '' : 's'} overdue`;
  if (dayDiff === 0) return 'Due today';
  if (dayDiff === 1) return 'Due tomorrow';
  return `In ${dayDiff} days`;
}

export function FollowUpsPage() {
  const { clientMatchesActiveIndustry, matchesActiveIndustry } = useIndustryScope();
  const { settings: orgSettings } = useOrgSettings();
  const defaultNextDays = orgSettings?.followUp?.defaultDurationDays ?? 3;
  const enabledTypes = TYPE_LIST.filter((t) => orgSettings?.followUp?.types?.[t.label] !== false);

  const [items, setItems] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [tab, setTab] = useState<Tab>('open');

  const [selected, setSelected] = useState<FollowUp | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDueAt, setRescheduleDueAt] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleSaving, setRescheduleSaving] = useState(false);
  const [rescheduleError, setRescheduleError] = useState('');
  const [history, setHistory] = useState<RescheduleEntry[]>([]);

  // ── Complete dialog: outcome is mandatory, next follow-up is optional ──
  const [completing, setCompleting] = useState<FollowUp | null>(null);
  const [cOutcome, setCOutcome] = useState('');
  const [cNote, setCNote] = useState('');
  const [cScheduleNext, setCScheduleNext] = useState(false);
  const [cNextDue, setCNextDue] = useState('');
  const [cNextType, setCNextType] = useState('call');
  const [cSaving, setCSaving] = useState(false);
  const [cError, setCError] = useState('');  function viewLead(item: FollowUp) {
    if (!item.lead_id) return;
    sessionStorage.setItem('fs-focus-lead-id', item.lead_id);
    window.location.hash = 'leads';
  }

  // ── Add-follow-up modal ──
  const [showAdd, setShowAdd] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addClientCode, setAddClientCode] = useState('');
  const [addRepresentativeId, setAddRepresentativeId] = useState('');
  const [addDueAt, setAddDueAt] = useState('');
  const [addPriority, setAddPriority] = useState<FollowUp['priority']>('normal');
  const [addType, setAddType] = useState('call');
  const [addNotes, setAddNotes] = useState('');
  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [allRepresentatives, setAllRepresentatives] = useState<RepresentativeOption[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems((await api<{ data: FollowUp[] }>('/follow-ups')).data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load follow-ups.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);


  useEffect(() => {
    api<{ data: { id: string; client_code: string; client_name: string; sales_representative_client_assignments?: { status: string; sales_representative_id: string }[] }[] }>('/clients')
      .then((res) => setAllClients((res.data ?? []).map((c) => ({
        id: c.id,
        code: c.client_code,
        name: c.client_name,
        representativeId: c.sales_representative_client_assignments?.find((a) => a.status === 'active')?.sales_representative_id ?? null,
      }))))
      .catch(() => setAllClients([]));
    api<{ data: RepresentativeOption[] }>('/sales-representatives')
      .then((res) => setAllRepresentatives(res.data ?? []))
      .catch(() => setAllRepresentatives([]));
  }, []);

  // Start / cancel / reopen. Completing goes through the dialog below so an outcome is always recorded.
  async function updateStatus(id: string, status: FollowUp['status']) {
    setUpdatingId(id);
    setError(null);
    try {
      const response = await api<{ data: FollowUp }>(`/follow-ups/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...response.data } : item)));
      setSelected((current) => (current && current.id === id ? { ...current, ...response.data } : current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update follow-up.');
    } finally {
      setUpdatingId(null);
    }
  }

  function openComplete(item: FollowUp) {
    setCompleting(item);
    setCOutcome(''); setCNote(''); setCError('');
    setCScheduleNext(false);
    setCNextType(item.follow_up_type ?? 'call');
    setCNextDue(toLocalInput(new Date(Date.now() + defaultNextDays * 86400000).toISOString()));
  }

  async function submitComplete() {
    if (!completing) return;
    if (!cOutcome) { setCError('Choose what happened.'); return; }
    if (cOutcome === 'other' && cNote.trim().length < 3) { setCError('Add a short note describing the outcome.'); return; }
    let nextDueAt: string | null = null;
    if (cScheduleNext) {
      const next = new Date(cNextDue);
      if (!cNextDue || Number.isNaN(next.getTime()) || next.getTime() <= Date.now()) { setCError('Pick a next follow-up date in the future.'); return; }
      nextDueAt = next.toISOString();
    }
    const id = completing.id;
    setCSaving(true); setCError('');
    try {
      const response = await api<{ data: FollowUp }>(`/follow-ups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', outcome: cOutcome, completionNote: cNote.trim() || null, nextDueAt, nextType: nextDueAt ? cNextType : null }),
      });
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...response.data } : item)));
      setSelected((current) => (current && current.id === id ? { ...current, ...response.data } : current));
      setCompleting(null);
      if (nextDueAt) await load(); // the new follow-up should appear straight away
    } catch (caught) {
      setCError(caught instanceof Error ? caught.message : 'Unable to complete follow-up.');
    } finally {
      setCSaving(false);
    }
  }
  // Load the reschedule history whenever a follow-up is opened.
  useEffect(() => {
    setRescheduleOpen(false);
    setRescheduleError('');
    setRescheduleReason('');
    setHistory([]);
    if (!selected) return;
    let cancelled = false;
    api<{ data: RescheduleEntry[] }>(`/follow-ups/${selected.id}/history`)
      .then((res) => { if (!cancelled) setHistory(res.data ?? []); })
      .catch(() => { /* history is optional */ });
    return () => { cancelled = true; };
  }, [selected?.id]);

  function openReschedule() {
    if (!selected) return;
    setRescheduleDueAt(toLocalInput(selected.due_at));
    setRescheduleReason('');
    setRescheduleError('');
    setRescheduleOpen(true);
  }

  async function submitReschedule() {
    if (!selected) return;
    const newDue = new Date(rescheduleDueAt);
    if (!rescheduleDueAt || Number.isNaN(newDue.getTime())) { setRescheduleError('Choose the new date and time.'); return; }
    if (newDue.getTime() === new Date(selected.due_at).getTime()) { setRescheduleError('The new date is the same as the current one.'); return; }
    const id = selected.id;
    setRescheduleSaving(true);
    setRescheduleError('');
    if (rescheduleReason.trim().length < 3) {
      setRescheduleError('Add a short note explaining why the date is changing.');
      setRescheduleSaving(false);
      return;
    }
    try {
      const response = await api<{ data: FollowUp }>(`/follow-ups/${id}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify({ dueAt: newDue.toISOString(), reason: rescheduleReason.trim() }),
      });
      setItems((current) => current.map((item) => (item.id === id ? { ...item, due_at: response.data.due_at } : item)));
      setSelected((current) => (current && current.id === id ? { ...current, due_at: response.data.due_at } : current));
      setRescheduleOpen(false);
      const refreshed = await api<{ data: RescheduleEntry[] }>(`/follow-ups/${id}/history`).catch(() => null);
      if (refreshed) setHistory(refreshed.data ?? []);
    } catch (caught) {
      setRescheduleError(caught instanceof Error ? caught.message : 'Unable to reschedule follow-up.');
    } finally {
      setRescheduleSaving(false);
    }
  }

  function openAdd() {
    setAddTitle(''); setAddClientCode(''); setAddRepresentativeId(''); setAddDueAt(''); setAddPriority('normal'); setAddType(enabledTypes[0]?.value ?? 'call'); setAddNotes(''); setAddError('');
    setShowAdd(true);
  }

  async function submitAdd() {
    setAddError('');
    if (!addTitle.trim()) { setAddError('Enter what this follow-up is about.'); return; }
    if (!addClientCode) { setAddError('Select a client.'); return; }
    if (!addRepresentativeId) { setAddError('Select a representative.'); return; }
    if (!addDueAt) { setAddError('Pick a due date.'); return; }
    if (new Date(addDueAt).getTime() < Date.now() - 60000) { setAddError('The due date cannot be in the past.'); return; }
    const client = allClients.find((c) => c.code === addClientCode);
    if (!client) { setAddError('Select a client.'); return; }
    setAddSaving(true);
    try {
      await api('/follow-ups', {
        method: 'POST',
        body: JSON.stringify({
          clientId: client.id,
          representativeId: addRepresentativeId,
          title: addTitle.trim(),
          dueAt: new Date(addDueAt).toISOString(),
          priority: addPriority,
          followUpType: addType,
          notes: addNotes.trim() || null,
        }),
      });
      setShowAdd(false);
      await load();
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : 'Unable to create follow-up.');
    } finally {
      setAddSaving(false);
    }
  }

  function clearFilters() {
    setSearch(''); setClientFilter(''); setRepFilter(''); setPriorityFilter(''); setStatusFilter(''); setTypeFilter('');
  }
  const filtersActive = !!(search || clientFilter || repFilter || priorityFilter || statusFilter || typeFilter);

  // Same rule as the Leads page's isOverdue: an OPEN follow-up is overdue the moment its due time has passed.
  // "Today" means still to come later today (or any time today for finished items, which are never overdue).
  const dueBucket = (item: FollowUp): 'overdue' | 'today' | 'upcoming' => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endToday = new Date(startToday); endToday.setDate(endToday.getDate() + 1);
    const due = new Date(item.due_at);
    const closed = ['completed', 'cancelled'].includes(item.status);
    if (!closed && due.getTime() < now.getTime()) return 'overdue';
    if (due >= startToday && due < endToday) return 'today';
    return 'upcoming';
  };

  const scopedItems = useMemo(
    () => items.filter((item) => item.lead_id
      ? matchesActiveIndustry(item.leads?.industry_type_id)
      : clientMatchesActiveIndustry(item.clients?.client_code)),
    [items, clientMatchesActiveIndustry, matchesActiveIndustry],
  );

  const clientOptions = useMemo(
    () => [...new Set(scopedItems.map((i) => i.clients?.client_name).filter(Boolean))] as string[],
    [scopedItems],
  );
  const repOptions = useMemo(
    () => [...new Set(scopedItems.map((i) => i.sales_representatives?.user_profiles?.display_name ?? i.sales_representatives?.employee_code).filter(Boolean))] as string[],
    [scopedItems],
  );

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const nextOf = useMemo(() => {
    const map = new Map<string, FollowUp>();
    for (const i of items) if (i.previous_follow_up_id) map.set(i.previous_follow_up_id, i);
    return map;
  }, [items]);
  // 1 = first follow-up, 2 = the one created after completing it, and so on.
  const chainStep = (item: FollowUp) => {
    let step = 1; let cur = item; const seen = new Set<string>();
    while (cur.previous_follow_up_id && !seen.has(cur.id)) { seen.add(cur.id); step += 1; const prev = byId.get(cur.previous_follow_up_id); if (!prev) break; cur = prev; }
    return step;
  };
  const isOpenItem = (item: FollowUp) => !['completed', 'cancelled'].includes(item.status);

  const inTab = (item: FollowUp) => {
    const open = isOpenItem(item);
    if (tab === 'all') return true;
    if (tab === 'completed') return item.status === 'completed';
    if (!open) return false;
    if (tab === 'open') return true;
    return dueBucket(item) === tab;
  };

  const shown = useMemo(() => scopedItems.filter((item) => {
    const repLabel = item.sales_representatives?.user_profiles?.display_name ?? item.sales_representatives?.employee_code ?? '';
    const text = `${item.title} ${item.clients?.client_name ?? ''} ${item.leads?.company_name ?? ''} ${repLabel}`.toLowerCase();
    return (
      (!search || text.includes(search.toLowerCase())) &&
      (!clientFilter || item.clients?.client_name === clientFilter) &&
      (!repFilter || repLabel === repFilter) &&
      (!priorityFilter || item.priority === priorityFilter) &&
      (!statusFilter || item.status === statusFilter) &&
      (!typeFilter || (item.follow_up_type ?? 'call') === typeFilter) &&
      inTab(item)
    );
  }).sort((a, b) => {
    // Open work first (soonest / most overdue on top), finished work after, newest first.
    const ao = isOpenItem(a), bo = isOpenItem(b);
    if (ao !== bo) return ao ? -1 : 1;
    const ad = new Date(a.due_at).getTime(), bd = new Date(b.due_at).getTime();
    return ao ? ad - bd : bd - ad;
  }), [scopedItems, search, clientFilter, repFilter, priorityFilter, statusFilter, typeFilter, tab]);

  const openCount = scopedItems.filter(isOpenItem).length;
  const dueTodayCount = scopedItems.filter((i) => isOpenItem(i) && dueBucket(i) === 'today').length;
  const upcomingCount = scopedItems.filter((i) => isOpenItem(i) && dueBucket(i) === 'upcoming').length;
  const overdueCount = scopedItems.filter((i) => isOpenItem(i) && dueBucket(i) === 'overdue').length;
  const completedCount = scopedItems.filter((i) => i.status === 'completed').length;

  const kpi = (key: Tab, tone: string, icon: string, glyph: string, label: string, value: number) => (
    <div className="kpi-card" data-tone={tone} role="button" tabIndex={0} aria-pressed={tab === key}
      style={{ cursor: 'pointer', boxShadow: tab === key ? '0 0 0 2px var(--ink, #1a1a1a)' : undefined }}
      onClick={() => setTab(key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTab(key); } }}>
      <div className={`kpi-icon kpi-icon-${icon}`}>{glyph}</div><div><span>{label}</span><strong>{value}</strong></div>
    </div>
  );
  const emptyTitle = scopedItems.length === 0 ? 'No follow-ups yet' : tab === 'open' || tab === 'overdue' || tab === 'today' ? 'Nothing pending here — all caught up' : 'No follow-ups here';

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">TASK PIPELINE</p>
          <h2>Follow-ups</h2>
          <p>Manage customer follow-ups and stay on top of your sales activities.</p>
        </div>
        <button className="primary-action" type="button" onClick={openAdd}>+ Add Follow-up</button>
      </div>
      <div className="kpi-grid lead-kpi-grid">
        {kpi('open', 'ink', 'ink', '▤', 'Open', openCount)}
        {kpi('today', 'amber', 'amber', '◔', 'Due Today', dueTodayCount)}
        {kpi('upcoming', 'blue', 'blue', '●', 'Upcoming', upcomingCount)}
        {kpi('overdue', 'red', 'red', '⚠', 'Overdue', overdueCount)}
        {kpi('completed', 'green', 'green', '✓', 'Completed', completedCount)}
        {kpi('all', 'ink', 'ink', '☰', 'All (history)', scopedItems.length)}
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input value={search} placeholder="Search client or follow-up" onChange={(e) => setSearch(e.target.value)} />
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            <option value="">All clients</option>
            {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
            <option value="">All representatives</option>
            {repOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="">All priorities</option>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {TYPE_LIST.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button type="button" className="link-button" disabled={!filtersActive} onClick={clearFilters}>Clear Filters</button>
        </div>
      </div>


      {error && <p className="error-message">{error}</p>}

      {loading ? (
        <p>Loading follow-ups…</p>
      ) : (
          <div className="data-table-wrap fu-table-wrap">
          <table className="fu-table">
            <thead>
              <tr><th>Follow-up</th><th>Client</th><th>Representative</th><th>Due</th><th>Priority</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td className="empty-row" colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-state-icon">📋</div>
                      <h3>{emptyTitle}</h3>
                      {scopedItems.length === 0
                        ? <><p>Create a follow-up, or let leads, field visits and overdue payments create them automatically.</p><button className="primary-action" type="button" onClick={openAdd}>+ Add Follow-up</button></>
                        : <>{(filtersActive || tab !== 'open') && <button type="button" className="link-button" onClick={() => { clearFilters(); setTab('open'); }}>Show open follow-ups</button>}</>}
                    </div>
                  </td>
                </tr>
              )}
              {shown.map((item) => {
                const bucket = dueBucket(item);
                const isOpen = isOpenItem(item);
                const rowClass = bucket === 'overdue' && isOpen ? 'row-overdue' : bucket === 'today' && isOpen ? 'row-due-today' : '';
                const kind = typeOf(item.follow_up_type);
                       const noteText = displayFollowUpNotes(item.notes) ?? item.leads?.notes;
                return (
                  <tr key={item.id} className={rowClass}>
                    <td>
                      <strong><span className="fu-type" title={kind.label}>{kind.icon}</span> {item.title}</strong>
                      {item.lead_id && <small><span className="status-badge status-unqualified">From Lead</span> {item.leads?.lead_code ?? ''}</small>}
                      {item.previous_follow_up_id && <small className="fu-chain">↳ Follow-up #{chainStep(item)}</small>}
                      {item.status === 'completed' && item.outcome && <small className="fu-note-line"><span className="fu-outcome">{outcomeLabel(item.outcome)}</span> {item.completion_note ?? ''}</small>}
                      {noteText && <small className="fu-note-line" title={noteText}>{noteText}</small>}
                    </td>
                    <td>{item.lead_id ? (item.leads?.company_name ?? 'Lead') : (item.clients?.client_name ?? '—')}</td>
                    <td>{item.sales_representatives?.user_profiles?.display_name ?? item.sales_representatives?.employee_code ?? '—'}</td>
                    <td>
                                {dateLabel(item.due_at)}
                      <small className={bucket === 'overdue' && isOpen ? 'fu-due-overdue' : bucket === 'today' && isOpen ? 'fu-due-today' : undefined}>{relDue(item)}</small>
                      {(item.reschedule_count ?? 0) > 0 && <small>Rescheduled {item.reschedule_count}×</small>}
                    </td>
                    <td><span className={`priority-badge priority-${item.priority}`}>{item.priority}</span></td>
                    <td><span className={`status-badge status-${item.status}`}>{item.status.replace('_', ' ')}</span></td>
                    <td className="master-actions">
                      <button type="button" className="icon-action" title="View follow-up" aria-label="View follow-up" onClick={() => setSelected(item)}>◉</button>
                      {item.lead_id && <button type="button" className="quiet-button" onClick={() => viewLead(item)}>View Lead</button>}
                      {isOpen && (
                        <button type="button" className="icon-action" title="Log result & complete" aria-label="Complete follow-up" disabled={updatingId === item.id} onClick={() => openComplete(item)}>✓</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (() => {
        const bucket = dueBucket(selected);
        const isOpen = !['completed', 'cancelled'].includes(selected.status);
        return (
          <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
            <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-heading">
                <div>
                  <p className="eyebrow">FOLLOW-UP DETAILS</p>
                  <h3>{selected.title}</h3>
                </div>
                <button type="button" className="icon-action" aria-label="Close" onClick={() => setSelected(null)}>×</button>
              </div>

              <dl className="detail-dl">
                <dt>Type</dt>
                <dd>{typeOf(selected.follow_up_type).icon} {typeOf(selected.follow_up_type).label}</dd>
                <dt>Related client</dt>
                <dd>{selected.clients?.client_name ?? '—'} {selected.clients?.client_code && <span className="text-faint-inline">({selected.clients.client_code})</span>}</dd>
                {selected.lead_id && <><dt>Originating lead</dt><dd>{selected.leads?.lead_code ?? 'Lead'} {selected.leads?.company_name ?? ''} <button type="button" className="link-button" onClick={() => viewLead(selected)}>View Lead</button></dd></>}
                <dt>Representative</dt>
                <dd>{selected.sales_representatives?.user_profiles?.display_name ?? selected.sales_representatives?.employee_code ?? '—'}</dd>
                <dt>Due date/time</dt>
                <dd>
                  {dateLabel(selected.due_at)}
                  {bucket === 'overdue' && isOpen && <span className="due-flag due-flag-overdue">Overdue</span>}
                  {bucket === 'today' && isOpen && <span className="due-flag due-flag-today">Today</span>}
                </dd>
                <dt>Priority</dt>
                <dd><span className={`priority-badge priority-${selected.priority}`}>{selected.priority}</span></dd>
                <dt>Status</dt>
                <dd><span className={`status-badge status-${selected.status}`}>{selected.status.replace('_', ' ')}</span></dd>
                <dt>Notes</dt>
                           <dd>{displayFollowUpNotes(selected.notes) || (selected.leads?.notes ? <>{selected.leads.notes} <small>(from lead)</small></> : '—')}</dd>
                {selected.previous_follow_up_id && (() => { const p = byId.get(selected.previous_follow_up_id!); return <><dt>Previous follow-up</dt><dd>{p ? `${dateLabel(p.due_at)}${p.outcome ? ` · ${outcomeLabel(p.outcome)}` : ''}${p.completion_note ? ` — ${p.completion_note}` : ''}` : 'Earlier follow-up (not in this list)'}</dd></>; })()}
                {nextOf.get(selected.id) && <><dt>Next follow-up</dt><dd>{typeOf(nextOf.get(selected.id)!.follow_up_type).label} · {dateLabel(nextOf.get(selected.id)!.due_at)} <span className={`status-badge status-${nextOf.get(selected.id)!.status}`}>{nextOf.get(selected.id)!.status.replace('_', ' ')}</span></dd></>}
                {selected.status === 'completed' && <><dt>Outcome</dt><dd>{outcomeLabel(selected.outcome) || '—'}</dd></>}
                {selected.status === 'completed' && selected.completion_note && <><dt>Completion note</dt><dd>{selected.completion_note}</dd></>}
                {selected.status === 'completed' && selected.completed_at && <><dt>Completed on</dt><dd>{dateLabel(selected.completed_at)}</dd></>}
              </dl>

                              {(
                <div className="fu-section">
                  <h4 className="fu-section-title">
                    Reschedule history
                    <span className="fu-count">{history.length}</span>
                  </h4>
                  {history.length === 0 ? (
                    <p className="fu-empty">This follow-up has not been rescheduled.</p>
                  ) : (
                    <ul className="fu-timeline">
                      {history.map((entry) => (
                        <li key={entry.id}>
                          <div className="fu-change">
                            <span className="fu-old">{dateLabel(entry.old_due_at)}</span>
                            <span className="fu-arrow">→</span>
                            <span>{dateLabel(entry.new_due_at)}</span>
                          </div>
                          {entry.reason && <p className="fu-note">{entry.reason}</p>}
                          <p className="fu-meta">Changed on {dateLabel(entry.created_at)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {isOpen && rescheduleOpen && (
                <div className="fu-card">
                  <label>
                    New due date and time
                    <input type="datetime-local" value={rescheduleDueAt} onChange={(e) => setRescheduleDueAt(e.target.value)} />
                  </label>
                  <label>
                    <span>Note <span className="fu-hint">(required: what the customer said, why the date is changing)</span></span>
                    <textarea rows={3} maxLength={500} value={rescheduleReason} onChange={(e) => setRescheduleReason(e.target.value)} placeholder="e.g. Customer is travelling, asked us to call back after the 20th." />
                  </label>
                  {rescheduleError && <p role="alert" className="fu-error">{rescheduleError}</p>}
                  <div className="fu-card-actions">
                    <button type="button" className="quiet-button" onClick={() => setRescheduleOpen(false)} disabled={rescheduleSaving}>Cancel</button>
                    <button type="button" className="primary-action" onClick={() => void submitReschedule()} disabled={rescheduleSaving}>{rescheduleSaving ? 'Saving…' : 'Save new date'}</button>
                  </div>
                </div>
              )}

              {isOpen && !rescheduleOpen && (
                <div className="modal-actions">
                  <button type="button" className="quiet-button" disabled={updatingId === selected.id} onClick={() => void updateStatus(selected.id, 'cancelled')}>Cancel follow-up</button>
                  <button type="button" className="quiet-button" onClick={openReschedule}>Reschedule</button>
                  {selected.status === 'pending' && (
                    <button type="button" className="quiet-button" disabled={updatingId === selected.id} onClick={() => void updateStatus(selected.id, 'in_progress')}>Start</button>
                  )}
                  <button type="button" className="primary-action" disabled={updatingId === selected.id} onClick={() => openComplete(selected)}>✓ Complete</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {completing && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !cSaving && setCompleting(null)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="complete-followup-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">COMPLETE FOLLOW-UP</p><h3 id="complete-followup-title">{completing.title}</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => !cSaving && setCompleting(null)}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={(e) => { e.preventDefault(); void submitComplete(); }}>
              {cError && <p className="error-message" style={{ gridColumn: '1 / -1' }}>{cError}</p>}
              <label style={{ gridColumn: '1 / -1' }}>
                What happened
                <select value={cOutcome} onChange={(e) => setCOutcome(e.target.value)}>
                  <option value="">Select an outcome</option>
                  {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Note {cOutcome !== 'other' && <span className="fu-hint">(optional)</span>}
                <textarea rows={3} maxLength={2000} value={cNote} onChange={(e) => setCNote(e.target.value)} placeholder="e.g. Will pay half by Friday, rest next week." />
              </label>
              <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <input type="checkbox" checked={cScheduleNext} onChange={(e) => setCScheduleNext(e.target.checked)} style={{ width: 'auto' }} />
                Schedule the next follow-up
              </label>
              {cScheduleNext && (
                <>
                  <label>
                    Next follow-up type
                    <select value={cNextType} onChange={(e) => setCNextType(e.target.value)}>
                      {TYPE_LIST.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                    </select>
                  </label>
                  <label>
                    Next follow-up date
                    <input type="datetime-local" value={cNextDue} onChange={(e) => setCNextDue(e.target.value)} />
                  </label>
                </>
              )}
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setCompleting(null)} disabled={cSaving}>Cancel</button>
                <button type="submit" className="primary-action" disabled={cSaving}>{cSaving ? 'Saving…' : '✓ Mark complete'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !addSaving && setShowAdd(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="add-followup-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">TASK PIPELINE</p><h3 id="add-followup-title">Add Follow-up</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => !addSaving && setShowAdd(false)}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={(e) => { e.preventDefault(); submitAdd(); }}>
              {addError && <p className="error-message" style={{ gridColumn: '1 / -1' }}>{addError}</p>}
              <label style={{ gridColumn: '1 / -1' }}>
                What's this about
                <input value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="e.g. Call about renewal" />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Client
                <select value={addClientCode} onChange={(e) => {
                  const code = e.target.value;
                  setAddClientCode(code);
                  const client = allClients.find((c) => c.code === code);
                  if (client?.representativeId) setAddRepresentativeId(client.representativeId);
                }}>
                  <option value="">Select a client</option>
                  {allClients.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Representative
                <select value={addRepresentativeId} onChange={(e) => setAddRepresentativeId(e.target.value)}>
                  <option value="">Select a representative</option>
                  {allRepresentatives.map((r) => (
                    <option key={r.id} value={r.id}>{r.user_profiles?.display_name ?? r.employee_code ?? r.id}</option>
                  ))}
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Type
                <select value={addType} onChange={(e) => setAddType(e.target.value)}>
                  {enabledTypes.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                </select>
              </label>
              <label>
                Due date
                <input type="datetime-local" value={addDueAt} onChange={(e) => setAddDueAt(e.target.value)} />
              </label>
              <label>
                Priority
                <select value={addPriority} onChange={(e) => setAddPriority(e.target.value as FollowUp['priority'])}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Notes
                <textarea rows={2} value={addNotes} onChange={(e) => setAddNotes(e.target.value)} placeholder="Optional" />
              </label>
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setShowAdd(false)} disabled={addSaving}>Cancel</button>
                <button type="submit" className="primary-action" disabled={addSaving}>{addSaving ? 'Saving…' : 'Create Follow-up'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}