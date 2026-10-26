import { FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

// Academic years and their terms are real School master data (school_academic_years / school_terms), saved through
// the School API for the School industry only. New School quotations and orders are stamped automatically with the
// year and term that is running on the day they are created, which School-wise Sales & Collection then reports on.
type Term = { id: string; name: string; startDate: string; endDate: string };
type AcademicYear = { id: string; label: string; startDate: string; endDate: string; status: 'active' | 'closed'; terms: Term[] };
type ApiTerm = { id: string; name: string; start_date: string; end_date: string };
type ApiYear = { id: string; label: string; start_date: string; end_date: string; status: 'active' | 'closed'; terms: ApiTerm[] };

const fromApi = (y: ApiYear): AcademicYear => ({
  id: y.id, label: y.label, startDate: String(y.start_date).slice(0, 10), endDate: String(y.end_date).slice(0, 10), status: y.status,
  terms: (y.terms ?? []).map((t) => ({ id: t.id, name: t.name, startDate: String(t.start_date).slice(0, 10), endDate: String(t.end_date).slice(0, 10) })),
});
const dateLabel = (value: string) => (value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—');

type YearForm = { label: string; startDate: string; endDate: string; status: AcademicYear['status'] };
const blankYearForm: YearForm = { label: '', startDate: '', endDate: '', status: 'active' };

type TermForm = { name: string; startDate: string; endDate: string };
const blankTermForm: TermForm = { name: '', startDate: '', endDate: '' };

export function AcademicYearTermPage() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(false);
  const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);
  const [yearForm, setYearForm] = useState<YearForm>(blankYearForm);
  const [formError, setFormError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [termModal, setTermModal] = useState(false);
  const [termYearId, setTermYearId] = useState<string | null>(null);
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);
  const [termForm, setTermForm] = useState<TermForm>(blankTermForm);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ data: ApiYear[] }>('/school/academic-years');
      setYears((res.data ?? []).map(fromApi));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load academic years.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  // Runs a save, replaces the changed year with the server's copy, and shows the server's message when it is refused.
  async function run(action: () => Promise<{ data: ApiYear } | void>, onFail: (message: string) => void, onDone?: () => void) {
    setSaving(true);
    try {
      const res = await action();
      if (res && 'data' in res && res.data) {
        const saved = fromApi(res.data);
        setYears((current) => (current.some((y) => y.id === saved.id) ? current.map((y) => (y.id === saved.id ? saved : y)) : [saved, ...current]));
      }
      onDone?.();
    } catch (caught) {
      onFail(caught instanceof Error ? caught.message : 'Unable to save.');
    } finally {
      setSaving(false);
    }
  }

  function openCreateYear() {
    setEditingYear(null);
    setYearForm(blankYearForm);
    setFormError(null);
    setModal(true);
  }
  function openEditYear(year: AcademicYear) {
    setEditingYear(year);
    setYearForm({ label: year.label, startDate: year.startDate, endDate: year.endDate, status: year.status });
    setFormError(null);
    setModal(true);
  }
  function submitYear(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    void run(
      () => api<{ data: ApiYear }>(editingYear ? `/school/academic-years/${editingYear.id}` : '/school/academic-years', { method: editingYear ? 'PATCH' : 'POST', body: JSON.stringify(yearForm) }),
      setFormError,
      () => setModal(false),
    );
  }
  function removeYear(year: AcademicYear) {
    if (!window.confirm(`Delete academic year ${year.label} and its terms?`)) return;
    void run(async () => { await api(`/school/academic-years/${year.id}`, { method: 'DELETE' }); setYears((current) => current.filter((y) => y.id !== year.id)); }, setError);
  }
  function toggleYearStatus(year: AcademicYear) {
    void run(() => api<{ data: ApiYear }>(`/school/academic-years/${year.id}`, { method: 'PATCH', body: JSON.stringify({ status: year.status === 'active' ? 'closed' : 'active' }) }), setError);
  }

  function openCreateTerm(yearId: string) {
    setTermYearId(yearId);
    setEditingTerm(null);
    setTermForm(blankTermForm);
    setFormError(null);
    setTermModal(true);
  }
  function openEditTerm(yearId: string, term: Term) {
    setTermYearId(yearId);
    setEditingTerm(term);
    setTermForm({ name: term.name, startDate: term.startDate, endDate: term.endDate });
    setFormError(null);
    setTermModal(true);
  }
  function submitTerm(event: FormEvent) {
    event.preventDefault();
    if (!termYearId) return;
    setFormError(null);
    void run(
      () => api<{ data: ApiYear }>(editingTerm ? `/school/academic-years/${termYearId}/terms/${editingTerm.id}` : `/school/academic-years/${termYearId}/terms`, { method: editingTerm ? 'PATCH' : 'POST', body: JSON.stringify(termForm) }),
      setFormError,
      () => setTermModal(false),
    );
  }
  function removeTerm(yearId: string, term: Term) {
    if (!window.confirm(`Delete ${term.name}?`)) return;
    void run(() => api<{ data: ApiYear }>(`/school/academic-years/${yearId}/terms/${term.id}`, { method: 'DELETE' }), setError);
  }

  const displayYears = years;
  const activeYear = displayYears.find((y) => y.status === 'active');

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">SCHOOL · ACADEMIC YEAR &amp; TERM MANAGEMENT</p>
          <h2>Academic year &amp; term management</h2>
          <p>Define academic years and their terms so orders, pricing and reports can be scoped to the right session.</p>
        </div>
        <button className="primary-action" type="button" onClick={openCreateYear} disabled={loading}>
          + Add academic year
        </button>
      </div>

            <div className="kpi-grid">
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon">📅</div>
          <div><span>Academic years</span><strong>{displayYears.length}</strong><small>{displayYears.filter((y) => y.status === 'active').length} active</small></div>
        </div>
        <div className="kpi-card" data-tone="blue">
          <div className="kpi-icon">◎</div>
          <div><span>Current year</span><strong>{activeYear?.label ?? '—'}</strong><small>{activeYear ? `${dateLabel(activeYear.startDate)} – ${dateLabel(activeYear.endDate)}` : 'None marked active'}</small></div>
        </div>
        <div className="kpi-card" data-tone="amber">
          <div className="kpi-icon">▤</div>
          <div><span>Total terms</span><strong>{displayYears.reduce((sum, y) => sum + y.terms.length, 0)}</strong><small>across all years</small></div>
        </div>
      </div>  

      {error && <p role="alert" className="error">{error}</p>}
      {loading && <p>Loading academic years…</p>}

      <div className="data-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Academic year</th>
              <th>Duration</th>
              <th>Terms</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayYears.map((year) => {
              return (
              <>
                <tr key={year.id}>
                  <td><strong>{year.label}</strong></td>
                  <td>{dateLabel(year.startDate)} – {dateLabel(year.endDate)}</td>
                  <td>
                    <button type="button" className="link-button" onClick={() => setExpanded(expanded === year.id ? null : year.id)}>
                      {year.terms.length} term{year.terms.length === 1 ? '' : 's'} {expanded === year.id ? '▲' : '▼'}
                    </button>
                  </td>
                  <td><span className={`status-badge ${year.status === 'active' ? 'active' : 'inactive'}`}>{year.status}</span></td>
                                   <td className="master-actions">
                    {(
                      <>
                        <button type="button" className="icon-action" title="Edit year" aria-label={`Edit ${year.label}`} onClick={() => openEditYear(year)}>✎</button>
                        <button type="button" className="icon-action" title={year.status === 'active' ? 'Close year' : 'Reopen year'} aria-label={`Change status of ${year.label}`} onClick={() => toggleYearStatus(year)}>
                          {year.status === 'active' ? '⊘' : '✓'}
                        </button>
                        <button type="button" className="icon-action" title="Delete year" aria-label={`Delete ${year.label}`} onClick={() => removeYear(year)}>🗑</button>
                      </>
                    )}
                  </td>
                </tr>
                {expanded === year.id && (
                  <tr key={`${year.id}-terms`}>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <div className="data-table-wrap" style={{ margin: '.5rem 1rem 1rem' }}>
                        <div style={{ padding: '.5rem' }}><button type="button" className="primary-action" onClick={() => openCreateTerm(year.id)}>+ Add term</button></div>
                        <table>
                          <thead><tr><th>Term</th><th>Duration</th><th>Actions</th></tr></thead>
                          <tbody>
                            {year.terms.map((term) => (
                              <tr key={term.id}>
                                <td>{term.name}</td>
                                <td>{dateLabel(term.startDate)} – {dateLabel(term.endDate)}</td>
                                <td className="master-actions">
                                  {(
                                    <>
                                      <button type="button" className="icon-action" title="Edit term" aria-label={`Edit ${term.name}`} onClick={() => openEditTerm(year.id, term)}>✎</button>
                                      <button type="button" className="icon-action" title="Delete term" aria-label={`Delete ${term.name}`} onClick={() => removeTerm(year.id, term)}>🗑</button>
                                    </>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {year.terms.length === 0 && <tr><td colSpan={3} className="empty-row">No terms yet — add one.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </>
              );
            })}
            {!loading && displayYears.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-row">
                  <div className="empty-state">
                    <span className="empty-state-icon">📅</span>
                    <p>No academic years yet. Add your first one to get started.</p>
                    <button type="button" className="primary-action" onClick={openCreateYear}>+ Add academic year</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-backdrop" onMouseDown={() => setModal(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="year-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">ACADEMIC YEAR</p><h3 id="year-modal-title">{editingYear ? 'Edit academic year' : 'Add academic year'}</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={submitYear}>
              <label style={{ gridColumn: '1 / -1' }}>Label<input required placeholder="e.g. 2026–2027" value={yearForm.label} onChange={(e) => setYearForm({ ...yearForm, label: e.target.value })} /></label>
              <label>Start date<input type="date" required value={yearForm.startDate} onChange={(e) => setYearForm({ ...yearForm, startDate: e.target.value })} /></label>
              <label>End date<input type="date" required value={yearForm.endDate} onChange={(e) => setYearForm({ ...yearForm, endDate: e.target.value })} /></label>
              <label>Status<select value={yearForm.status} onChange={(e) => setYearForm({ ...yearForm, status: e.target.value as YearForm['status'] })}><option value="active">Active</option><option value="closed">Closed</option></select></label>
              {formError && <p role="alert" className="error" style={{ gridColumn: '1 / -1' }}>{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(false)}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving}>{editingYear ? 'Save changes' : 'Add year'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {termModal && (
        <div className="modal-backdrop" onMouseDown={() => setTermModal(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="term-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">TERM</p><h3 id="term-modal-title">{editingTerm ? 'Edit term' : 'Add term'}</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setTermModal(false)}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={submitTerm}>
              <label style={{ gridColumn: '1 / -1' }}>Term name<input required placeholder="e.g. Term 1" value={termForm.name} onChange={(e) => setTermForm({ ...termForm, name: e.target.value })} /></label>
              <label>Start date<input type="date" required value={termForm.startDate} onChange={(e) => setTermForm({ ...termForm, startDate: e.target.value })} /></label>
              <label>End date<input type="date" required value={termForm.endDate} onChange={(e) => setTermForm({ ...termForm, endDate: e.target.value })} /></label>
              {formError && <p role="alert" className="error" style={{ gridColumn: '1 / -1' }}>{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setTermModal(false)}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving}>{editingTerm ? 'Save changes' : 'Add term'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}