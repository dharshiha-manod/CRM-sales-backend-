import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Day = (typeof DAYS)[number];
const dayLabels: Record<Day, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const dayByJsIndex: Day[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const todayKey: Day = dayByJsIndex[new Date().getDay()];

type Client = { id: string; client_code: string; client_name: string; city?: string | null; status: string };
type Representative = { id: string; employee_code: string; status: string; user_profiles?: { display_name?: string | null } | null };
type Visit = { id: string; status: string; check_in_time: string; client_id?: string | null };

type Beat = { id: string; name: string; area: string; repId: string; days: Day[]; status: 'active' | 'inactive' };
type BeatForm = { name: string; area: string; repId: string; days: Day[]; status: Beat['status'] };
const blankForm: BeatForm = { name: '', area: '', repId: '', days: [], status: 'active' };

// Beats / routes and their outlet assignments have no backend table yet — persisted
// client-side in localStorage, same approach used for order meta and rep targets
// elsewhere in this app. Client, representative and visit data below are all real,
// live records pulled from the existing API.
const STORAGE_KEY = 'fs-route-beats';
type StoredState = { beats: Beat[]; assignments: Record<string, string[]> };
const blankStored: StoredState = { beats: [], assignments: {} };
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
    return `beat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

const AVATAR_PALETTE = ['#c6791f', '#3d5a80', '#8b5a83', '#2e7d6b', '#3f6b4a', '#a6402b'];
function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function RouteBeatPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [reps, setReps] = useState<Representative[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [beats, setBeats] = useState<Beat[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [dayFilter, setDayFilter] = useState<'all' | Day>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Beat['status']>('all');
  const [search, setSearch] = useState('');

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Beat | null>(null);
  const [form, setForm] = useState<BeatForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [managing, setManaging] = useState<Beat | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [clientsRes, repsRes, visitsRes] = await Promise.all([
        api<{ data: Client[] }>('/clients?status=active'),
        api<{ data: Representative[] }>('/sales-representatives'),
        api<{ data: Visit[] }>('/field-visits').catch(() => ({ data: [] })),
      ]);
      setClients(clientsRes.data ?? []);
      setReps(repsRes.data ?? []);
      setVisits(visitsRes.data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load route data.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const stored = loadStored();
    setBeats(stored.beats);
    setAssignments(stored.assignments);
  }, []);

  function persist(nextBeats: Beat[], nextAssignments: Record<string, string[]>) {
    setBeats(nextBeats);
    setAssignments(nextAssignments);
    saveStored({ beats: nextBeats, assignments: nextAssignments });
  }

  const repName = (id: string) => {
    const rep = reps.find((r) => r.id === id);
    return rep?.user_profiles?.display_name ?? rep?.employee_code ?? '—';
  };

  function coverage(beat: Beat) {
    const assigned = assignments[beat.id] ?? [];
    const visitedToday = new Set(visits.filter((v) => v.client_id && isToday(v.check_in_time)).map((v) => v.client_id));
    const done = assigned.filter((id) => visitedToday.has(id)).length;
    return { assigned: assigned.length, done };
  }

  const filteredBeats = useMemo(() => {
    const q = search.trim().toLowerCase();
    return beats.filter((b) => {
      if (dayFilter !== 'all' && !b.days.includes(dayFilter)) return false;
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (!q) return true;
      const rep = repName(b.repId).toLowerCase();
      return b.name.toLowerCase().includes(q) || b.area.toLowerCase().includes(q) || rep.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beats, dayFilter, statusFilter, search, reps]);

  const openVisitCount = visits.filter((v) => v.client_id && isToday(v.check_in_time)).length;

  function openCreate() {
    setEditing(null);
    setForm(blankForm);
    setMessage('');
    setModal(true);
  }
  function openEdit(beat: Beat) {
    setEditing(beat);
    setForm({ name: beat.name, area: beat.area, repId: beat.repId, days: beat.days, status: beat.status });
    setMessage('');
    setModal(true);
  }
  function toggleDay(day: Day) {
    setForm((f) => ({ ...f, days: f.days.includes(day) ? f.days.filter((d) => d !== day) : [...f.days, day] }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setMessage('Enter a beat / route name.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const next = beats.map((b) =>
          b.id === editing.id ? { ...b, name: form.name.trim(), area: form.area.trim(), repId: form.repId, days: form.days, status: form.status } : b
        );
        persist(next, assignments);
        setMessage('Beat updated successfully.');
      } else {
        const id = newId();
        const next = [...beats, { id, name: form.name.trim(), area: form.area.trim(), repId: form.repId, days: form.days, status: form.status }];
        persist(next, { ...assignments, [id]: [] });
        setMessage('Beat created successfully.');
      }
      setModal(false);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  function toggleStatus(beat: Beat) {
    const next = beats.map((b) => (b.id === beat.id ? { ...b, status: (b.status === 'active' ? 'inactive' : 'active') as Beat['status'] } : b));
    persist(next, assignments);
  }

  function removeBeat(beat: Beat) {
    if (!window.confirm(`Remove "${beat.name}"? This cannot be undone.`)) return;
    const next = beats.filter((b) => b.id !== beat.id);
    const restAssignments = { ...assignments };
    delete restAssignments[beat.id];
    persist(next, restAssignments);
  }
  function openManage(beat: Beat) {
    setManaging(beat);
    setClientSearch('');
  }
  function toggleMenu(event: React.MouseEvent<HTMLButtonElement>, beatId: string) {
    if (menuFor?.id === beatId) {
      setMenuFor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: beatId, top: rect.bottom + 6, left: Math.max(8, rect.right - 168) });
  }
  function toggleClientAssignment(clientId: string) {
    if (!managing) return;
    const current = assignments[managing.id] ?? [];
    const next = current.includes(clientId) ? current.filter((id) => id !== clientId) : [...current, clientId];
    persist(beats, { ...assignments, [managing.id]: next });
  }
  const manageableClients = clients.filter(
    (c) => !clientSearch || `${c.client_name} ${c.client_code} ${c.city ?? ''}`.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const activeBeats = beats.filter((b) => b.status === 'active').length;
  const totalAssigned = beats.reduce((sum, b) => sum + coverage(b).assigned, 0);
  const totalDoneToday = beats.filter((b) => b.days.includes(todayKey)).reduce((sum, b) => sum + coverage(b).done, 0);
  const totalPlannedToday = beats.filter((b) => b.days.includes(todayKey)).reduce((sum, b) => sum + coverage(b).assigned, 0);
  const coveragePct = totalPlannedToday > 0 ? Math.round((totalDoneToday / totalPlannedToday) * 100) : 0;

  return (
    <section className="page-panel master-page route-beat-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">FMCG · ROUTE / BEAT MANAGEMENT</p>
          <h2>Route / Beat management</h2>
          <p>Group outlets into beats, assign a representative and visit days, then track today's coverage against live field-visit data.</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon">⌖</div>
          <div>
            <span>Beats / routes</span>
            <strong>{beats.length}</strong>
            <small>{activeBeats} active</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="amber">
          <div className="kpi-icon">▤</div>
          <div>
            <span>Outlets assigned</span>
            <strong>{totalAssigned}</strong>
            <small>{clients.length} active outlets total</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="green">
          <div className="kpi-icon">✓</div>
          <div>
            <span>Covered today ({dayLabels[todayKey]})</span>
            <strong>
              {totalDoneToday} / {totalPlannedToday}
            </strong>
            <div className="kpi-progress"><div className="kpi-progress-fill" style={{ width: `${coveragePct}%` }} /></div>
          </div>
        </div>
        <div className="kpi-card" data-tone="blue">
          <div className="kpi-icon">◎</div>
          <div>
            <span>Check-ins today</span>
            <strong>{openVisitCount}</strong>
            <small>across all outlets</small>
          </div>
        </div>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input
            type="search"
            placeholder="Search beats, area or representative…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value as 'all' | Day)}>
            <option value="all">All days</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {dayLabels[d]}
                {d === todayKey ? ' (today)' : ''}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | Beat['status'])}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <button className="primary-action" type="button" onClick={openCreate}>
          + Add beat / route
        </button>
      </div>

      {error && <p className="error-message">{error}</p>}
      {message && <p className={message.includes('successfully') ? 'success-message' : 'error-message'}>{message}</p>}

      {loading ? (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Beat / route</th>
                <th>Area</th>
                <th>Representative</th>
                <th>Visit days</th>
                <th>Outlets</th>
                <th>Today's coverage</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map((i) => (
                <tr key={i} className="skeleton-row">
                  <td><span className="skeleton-block" style={{ width: '70%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '60%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '80%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '30%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '65%' }} /></td>
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
                <th>Beat / route</th>
                <th>Area</th>
                <th>Representative</th>
                <th>Visit days</th>
                <th>Outlets</th>
                <th>Today's coverage</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBeats.map((beat) => {
                const cov = coverage(beat);
                const scheduledToday = beat.days.includes(todayKey);
                const pct = cov.assigned > 0 ? Math.round((cov.done / cov.assigned) * 100) : 0;
                const rep = repName(beat.repId);
                return (
                  <tr key={beat.id}>
                    <td>
                      <strong>{beat.name}</strong>
                    </td>
                    <td>{beat.area || '—'}</td>
                    <td>
                      {beat.repId ? (
                        <div className="rep-cell">
                          <span className="rep-avatar" style={{ background: avatarColor(beat.repId) }}>{initials(rep)}</span>
                          <span>{rep}</span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {beat.days.length ? (
                        <div className="day-chip-row">
                          {beat.days.map((d) => (
                            <span key={d} className={`day-chip${d === todayKey ? ' day-chip-today' : ''}`}>{dayLabels[d]}</span>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{cov.assigned}</td>
                    <td>
                      {scheduledToday ? (
                        <div className="coverage-cell">
                          <div className="coverage-bar"><div className="coverage-bar-fill" style={{ width: `${pct}%` }} /></div>
                          <span className={`status-badge ${
                            cov.assigned > 0 && cov.done >= cov.assigned ? 'status-completed' : cov.done > 0 ? 'status-quoted' : 'status-pending'
                          }`}>
                            {cov.done} / {cov.assigned}
                          </span>
                        </div>
                      ) : (
                        <span className="status-badge">Not scheduled today</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${beat.status}`}>{beat.status}</span>
                    </td>
                                   <td className="master-actions">
                      <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label={`More actions on ${beat.name}`} onClick={(e) => toggleMenu(e, beat.id)}>
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
              {filteredBeats.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-row">
                    <div className="empty-state">
                      <span className="empty-state-icon">⌖</span>
                      <p>
                        {beats.length === 0
                          ? 'No beats or routes created yet.'
                          : 'No beats match your search or filters.'}
                      </p>
                      {beats.length === 0 && (
                        <button className="quiet-button" type="button" onClick={openCreate}>
                          + Add your first beat
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
              const beat = filteredBeats.find((b) => b.id === menuFor.id);
              if (!beat) return null;
              return (
                <>
                  <button type="button" title="Manage outlets" onClick={() => { setMenuFor(null); openManage(beat); }}>
                    <span>Manage outlets</span>
                  </button>
                  <button type="button" title="Edit beat" onClick={() => { setMenuFor(null); openEdit(beat); }}>
                    <span>Edit</span>
                  </button>
                  <button type="button" title={beat.status === 'active' ? 'Deactivate' : 'Activate'} onClick={() => { setMenuFor(null); toggleStatus(beat); }}>
                    <span>{beat.status === 'active' ? 'Deactivate' : 'Activate'}</span>
                  </button>
                               <button type="button" className="row-menu-danger" title="Delete beat" onClick={() => { setMenuFor(null); removeBeat(beat); }}>
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
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="beat-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">ROUTE / BEAT</p>
                <h3 id="beat-modal-title">{editing ? 'Edit beat / route' : 'Add beat / route'}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>
                ×
              </button>
            </div>
            <form className="master-modal-form" onSubmit={submit}>
              <label>
                Beat / route name
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Beat 1 — Anna Nagar Main" />
              </label>
              <label>
                Area
                <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="e.g. Anna Nagar, Chennai" />
              </label>
              <label>
                Representative
                <select value={form.repId} onChange={(e) => setForm({ ...form, repId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.user_profiles?.display_name ?? r.employee_code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Beat['status'] })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ margin: '0 0 .4rem', fontSize: '.86rem', fontWeight: 600, color: 'var(--text-muted)' }}>Visit days</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
                  {DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={form.days.includes(d) ? 'primary-action' : 'quiet-button'}
                      style={{ padding: '.4rem .75rem' }}
                      onClick={() => toggleDay(d)}
                    >
                      {dayLabels[d]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(false)} disabled={saving}>
                  Cancel
                </button>
                <button className="primary-action" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add beat'}
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
                <p className="eyebrow">OUTLETS ON THIS BEAT</p>
                <h3>{managing.name}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setManaging(null)}>
                ×
              </button>
            </div>
            <input
              value={clientSearch}
              placeholder="Search outlets by name, code or city"
              onChange={(e) => setClientSearch(e.target.value)}
              style={{ marginBottom: '.9rem', width: '100%', boxSizing: 'border-box' }}
            />
            <div className="data-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Code</th>
                    <th>Outlet</th>
                    <th>City</th>
                  </tr>
                </thead>
                <tbody>
                  {manageableClients.map((c) => {
                    const assigned = (assignments[managing.id] ?? []).includes(c.id);
                    return (
                      <tr key={c.id}>
                        <td>
                          <input type="checkbox" checked={assigned} onChange={() => toggleClientAssignment(c.id)} aria-label={`Assign ${c.client_name}`} />
                        </td>
                        <td>{c.client_code}</td>
                        <td>{c.client_name}</td>
                        <td>{c.city || '—'}</td>
                      </tr>
                    );
                  })}
                  {manageableClients.length === 0 && (
                    <tr>
                      <td colSpan={4} className="empty-row">
                        No outlets match this search.
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