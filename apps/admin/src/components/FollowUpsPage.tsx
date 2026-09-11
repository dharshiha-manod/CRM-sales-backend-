import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import './MasterDataPages.css';

type FollowUp = {
  id: string;
  title: string;
  due_at: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  notes?: string | null;
  client_id?: string | null;
  clients?: { client_code?: string | null; client_name?: string | null } | null;
  sales_representatives?: { employee_code?: string | null; user_profiles?: { display_name?: string | null } | null } | null;
};

type ClientOption = { id: string; code: string; name: string; representativeId: string | null };
type RepresentativeOption = { id: string; employee_code?: string; user_profiles?: { display_name?: string | null } | null };

const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

// ── Locally-tracked follow-ups (auto-generated from overdue Collections +
// anything added manually here) — no backend field for either yet, so they
// live in localStorage, keyed by id prefix so we know how to update them. ──
const LOCAL_KEY = 'fs_local_followups_v1';
const isLocalId = (id: string) => id.startsWith('auto-') || id.startsWith('local-');

function loadLocalFollowUps(): FollowUp[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveLocalFollowUps(items: FollowUp[]) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

export function FollowUpsPage() {
  const { clientMatchesActiveIndustry } = useIndustryScope();

  const [items, setItems] = useState<FollowUp[]>([]);
  const [localItems, setLocalItems] = useState<FollowUp[]>(() => loadLocalFollowUps());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dueFilter, setDueFilter] = useState<'all' | 'overdue' | 'today' | 'upcoming'>('all');

  const [selected, setSelected] = useState<FollowUp | null>(null);

  // ── Add-follow-up modal ──
  const [showAdd, setShowAdd] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addClientCode, setAddClientCode] = useState('');
  const [addRepresentativeId, setAddRepresentativeId] = useState('');
  const [addDueAt, setAddDueAt] = useState('');
  const [addPriority, setAddPriority] = useState<FollowUp['priority']>('normal');
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

  // ── Automation: derive overdue-payment follow-ups from Sales Orders +
  // Collections (same data the Collections page itself uses) — no backend
  // field needed. Runs once on mount, merges into local storage, skips
  // anything already generated so it doesn't duplicate on every visit. ──
  useEffect(() => {
    (async () => {
      try {
        const [ordersRes, collectionsRes] = await Promise.all([
          api<{ data: any[] }>('/orders'),
          api<{ data: any[] }>('/collections').catch(() => ({ data: [] })),
        ]);
        const orders = ordersRes.data ?? [];
        const payments = collectionsRes.data ?? [];
        const CREDIT_DAYS = 30;
        const paidByOrder = new Map<string, number>();
        for (const p of payments) {
          const key = p.order_id ?? p.sale_orders?.id;
          if (!key) continue;
          paidByOrder.set(key, (paidByOrder.get(key) ?? 0) + Number(p.amount || 0));
        }
        const existingLocalIds = new Set(loadLocalFollowUps().map((f) => f.id));
        const generated: FollowUp[] = [];
        for (const order of orders) {
          if (order.status === 'cancelled') continue;
          const invoice = Number(order.total_amount || 0);
          const paid = paidByOrder.get(order.id) ?? 0;
          const balance = invoice - paid;
          if (balance <= 0.5) continue;
          const due = new Date(order.created_at);
          due.setDate(due.getDate() + CREDIT_DAYS);
          if (due >= new Date()) continue; // not overdue yet
          const id = `auto-${order.id}`;
          if (existingLocalIds.has(id)) continue;
          generated.push({
            id,
            title: `Overdue payment — ${order.clients?.client_name ?? order.clients?.client_code ?? 'Client'} (${order.order_number})`,
            due_at: due.toISOString(),
            priority: 'high',
            status: 'pending',
            notes: `Auto-created — balance outstanding ₹${balance.toFixed(0)}`,
            client_id: order.clients?.client_code ?? null,
            clients: { client_code: order.clients?.client_code, client_name: order.clients?.client_name },
            sales_representatives: order.sales_representatives,
          });
        }
        if (generated.length) {
          setLocalItems((cur) => {
            const merged = [...cur, ...generated];
            saveLocalFollowUps(merged);
            return merged;
          });
        }
      } catch {
        // silent — automation is best-effort, doesn't block the page
      }
    })();
  }, []);

  async function updateStatus(id: string, status: FollowUp['status']) {
    setUpdatingId(id);
    setError(null);
    if (isLocalId(id)) {
      setLocalItems((current) => {
        const updated = current.map((item) => (item.id === id ? { ...item, status } : item));
        saveLocalFollowUps(updated);
        return updated;
      });
      setSelected((current) => (current && current.id === id ? { ...current, status } : current));
      setUpdatingId(null);
      return;
    }
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

  function openAdd() {
    setAddTitle(''); setAddClientCode(''); setAddRepresentativeId(''); setAddDueAt(''); setAddPriority('normal'); setAddNotes(''); setAddError('');
    setShowAdd(true);
  }

  async function submitAdd() {
    setAddError('');
    if (!addTitle.trim()) { setAddError('Enter what this follow-up is about.'); return; }
    if (!addClientCode) { setAddError('Select a client.'); return; }
    if (!addRepresentativeId) { setAddError('Select a representative.'); return; }
    if (!addDueAt) { setAddError('Pick a due date.'); return; }
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
    setSearch(''); setClientFilter(''); setRepFilter(''); setPriorityFilter(''); setStatusFilter(''); setDueFilter('all');
  }
  const filtersActive = !!(search || clientFilter || repFilter || priorityFilter || statusFilter || dueFilter !== 'all');

  const dueBucket = (item: FollowUp): 'overdue' | 'today' | 'upcoming' => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endToday = new Date(startToday); endToday.setDate(endToday.getDate() + 1);
    const due = new Date(item.due_at);
    if (due < startToday && !['completed', 'cancelled'].includes(item.status)) return 'overdue';
    if (due >= startToday && due < endToday) return 'today';
    return 'upcoming';
  };

  const combinedItems = useMemo(() => {
    const apiIds = new Set(items.map((i) => i.id));
    return [...items, ...localItems.filter((l) => !apiIds.has(l.id))];
  }, [items, localItems]);

  const scopedItems = useMemo(
    () => combinedItems.filter((item) => clientMatchesActiveIndustry(item.clients?.client_code)),
    [combinedItems, clientMatchesActiveIndustry],
  );

  const clientOptions = useMemo(
    () => [...new Set(scopedItems.map((i) => i.clients?.client_name).filter(Boolean))] as string[],
    [scopedItems],
  );
  const repOptions = useMemo(
    () => [...new Set(scopedItems.map((i) => i.sales_representatives?.user_profiles?.display_name ?? i.sales_representatives?.employee_code).filter(Boolean))] as string[],
    [scopedItems],
  );

  const shown = useMemo(() => scopedItems.filter((item) => {
    const repLabel = item.sales_representatives?.user_profiles?.display_name ?? item.sales_representatives?.employee_code ?? '';
    const text = `${item.title} ${item.clients?.client_name ?? ''} ${repLabel}`.toLowerCase();
    return (
      (!search || text.includes(search.toLowerCase())) &&
      (!clientFilter || item.clients?.client_name === clientFilter) &&
      (!repFilter || repLabel === repFilter) &&
      (!priorityFilter || item.priority === priorityFilter) &&
      (!statusFilter || item.status === statusFilter) &&
      (dueFilter === 'all' || dueBucket(item) === dueFilter)
    );
  }), [scopedItems, search, clientFilter, repFilter, priorityFilter, statusFilter, dueFilter]);

  const totalCount = scopedItems.length;
  const dueTodayCount = scopedItems.filter((i) => dueBucket(i) === 'today' && !['completed', 'cancelled'].includes(i.status)).length;
  const upcomingCount = scopedItems.filter((i) => dueBucket(i) === 'upcoming' && !['completed', 'cancelled'].includes(i.status)).length;
  const overdueCount = scopedItems.filter((i) => dueBucket(i) === 'overdue').length;
  const completedCount = scopedItems.filter((i) => i.status === 'completed').length;

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
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon kpi-icon-ink">▤</div><div><span>Total Follow-ups</span><strong>{totalCount}</strong></div></div>
        <div className="kpi-card" data-tone="amber"><div className="kpi-icon kpi-icon-amber">◔</div><div><span>Due Today</span><strong>{dueTodayCount}</strong></div></div>
        <div className="kpi-card" data-tone="blue"><div className="kpi-icon kpi-icon-blue">●</div><div><span>Upcoming</span><strong>{upcomingCount}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon kpi-icon-red">⚠</div><div><span>Overdue</span><strong>{overdueCount}</strong></div></div>
        <div className="kpi-card" data-tone="green"><div className="kpi-icon kpi-icon-green">✓</div><div><span>Completed</span><strong>{completedCount}</strong></div></div>
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
          <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value as typeof dueFilter)}>
            <option value="all">All due dates</option>
            <option value="overdue">Overdue</option>
            <option value="today">Today</option>
            <option value="upcoming">Upcoming</option>
          </select>
          <button type="button" className="link-button" disabled={!filtersActive} onClick={clearFilters}>Clear Filters</button>
        </div>
      </div>


      {error && <p className="error-message">{error}</p>}

      {loading ? (
        <p>Loading follow-ups…</p>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr><th>Follow-up</th><th>Client</th><th>Representative</th><th>Due</th><th>Priority</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {scopedItems.length === 0 && (
                <tr>
                  <td className="empty-row" colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-state-icon">📋</div>
                      <h3>No follow-ups yet</h3>
                      <p>Create a follow-up to keep your customer activities on track, or let overdue payments and field visits create them automatically.</p>
                      <button className="primary-action" type="button" onClick={openAdd}>+ Add Follow-up</button>
                    </div>
                  </td>
                </tr>
              )}
              {scopedItems.length > 0 && shown.map((item) => {
                const bucket = dueBucket(item);
                const isOpen = !['completed', 'cancelled'].includes(item.status);
                const rowClass = bucket === 'overdue' && isOpen ? 'row-overdue' : bucket === 'today' && isOpen ? 'row-due-today' : '';
                return (
                  <tr key={item.id} className={rowClass}>
                    <td>
                      <strong>{item.title}</strong>
                      {item.notes && <small>{item.notes}</small>}
                    </td>
                    <td>{item.clients?.client_name ?? '—'}</td>
                    <td>{item.sales_representatives?.user_profiles?.display_name ?? item.sales_representatives?.employee_code ?? '—'}</td>
                    <td>
                      {dateLabel(item.due_at)}
                      {bucket === 'overdue' && isOpen && <span className="due-flag due-flag-overdue">Overdue</span>}
                      {bucket === 'today' && isOpen && <span className="due-flag due-flag-today">Today</span>}
                    </td>
                    <td><span className={`priority-badge priority-${item.priority}`}>{item.priority}</span></td>
                    <td><span className={`status-badge status-${item.status}`}>{item.status.replace('_', ' ')}</span></td>
                    <td className="master-actions">
                      <button type="button" className="icon-action" title="View follow-up" aria-label="View follow-up" onClick={() => setSelected(item)}>◉</button>
                      {isOpen && (
                        <button type="button" className="icon-action" title="Mark complete" aria-label="Mark follow-up complete" disabled={updatingId === item.id} onClick={() => void updateStatus(item.id, 'completed')}>✓</button>
                      )}
                    </td>
                  </tr>
                );
              })}
          {scopedItems.length > 0 && shown.length === 0 && (
                <tr><td className="empty-row" colSpan={7}>No follow-ups match these filters. <button type="button" className="link-button" onClick={clearFilters}>Clear filters</button></td></tr>
              )}
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
                <dt>Related client</dt>
                <dd>{selected.clients?.client_name ?? '—'} {selected.clients?.client_code && <span className="text-faint-inline">({selected.clients.client_code})</span>}</dd>
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
                <dd>{selected.notes ?? '—'}</dd>
              </dl>

              {isOpen && (
                <div className="modal-actions">
                  <button type="button" className="primary-action" disabled={updatingId === selected.id} onClick={() => void updateStatus(selected.id, 'completed')}>
                    {updatingId === selected.id ? 'Saving…' : '✓ Mark Complete'}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

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