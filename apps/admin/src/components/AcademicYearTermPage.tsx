import { FormEvent, useState } from 'react';
import './MasterDataPages.css';

// No backend table for this yet — persisted client-side in localStorage,
// same interim pattern as OrderMeta in OrdersPage.tsx. Swap for a real
// /academic-years API once the backend adds it.
const STORAGE_KEY = 'fs-academic-years';

type Term = { id: string; name: string; startDate: string; endDate: string };
type AcademicYear = { id: string; label: string; startDate: string; endDate: string; status: 'active' | 'closed'; terms: Term[] };

function loadYears(): AcademicYear[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AcademicYear[]) : [];
  } catch {
    return [];
  }
}
function saveYears(years: AcademicYear[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(years));
  } catch {
    /* best-effort */
  }
}
function newId() {
  return Math.random().toString(36).slice(2, 10);
}

const DEMO_YEARS: AcademicYear[] = [
  {
    id: 'demo-year-1',
    label: '2026–2027',
    startDate: '2026-06-01',
    endDate: '2027-04-30',
    status: 'active',
    terms: [
      { id: 'demo-term-1', name: 'Term 1', startDate: '2026-06-01', endDate: '2026-09-30' },
      { id: 'demo-term-2', name: 'Term 2', startDate: '2026-10-01', endDate: '2027-01-31' },
      { id: 'demo-term-3', name: 'Term 3', startDate: '2027-02-01', endDate: '2027-04-30' },
    ],
  },
  {
    id: 'demo-year-2',
    label: '2025–2026',
    startDate: '2025-06-01',
    endDate: '2026-04-30',
    status: 'closed',
    terms: [
      { id: 'demo-term-4', name: 'Term 1', startDate: '2025-06-01', endDate: '2025-09-30' },
      { id: 'demo-term-5', name: 'Term 2', startDate: '2025-10-01', endDate: '2026-01-31' },
    ],
  },
];
const dateLabel = (value: string) => (value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—');

type YearForm = { label: string; startDate: string; endDate: string; status: AcademicYear['status'] };
const blankYearForm: YearForm = { label: '', startDate: '', endDate: '', status: 'active' };

type TermForm = { name: string; startDate: string; endDate: string };
const blankTermForm: TermForm = { name: '', startDate: '', endDate: '' };

export function AcademicYearTermPage() {
  const [years, setYears] = useState<AcademicYear[]>(loadYears());
  const [modal, setModal] = useState(false);
  const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);
  const [yearForm, setYearForm] = useState<YearForm>(blankYearForm);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [termModal, setTermModal] = useState(false);
  const [termYearId, setTermYearId] = useState<string | null>(null);
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);
  const [termForm, setTermForm] = useState<TermForm>(blankTermForm);

  function persist(next: AcademicYear[]) {
    setYears(next);
    saveYears(next);
  }

  function openCreateYear() {
    setEditingYear(null);
    setYearForm(blankYearForm);
    setModal(true);
  }
  function openEditYear(year: AcademicYear) {
    setEditingYear(year);
    setYearForm({ label: year.label, startDate: year.startDate, endDate: year.endDate, status: year.status });
    setModal(true);
  }
  function submitYear(event: FormEvent) {
    event.preventDefault();
    if (editingYear) {
      persist(years.map((y) => (y.id === editingYear.id ? { ...y, ...yearForm } : y)));
    } else {
      persist([...years, { id: newId(), ...yearForm, terms: [] }]);
    }
    setModal(false);
  }
  function removeYear(id: string) {
    persist(years.filter((y) => y.id !== id));
  }
  function toggleYearStatus(year: AcademicYear) {
    persist(years.map((y) => (y.id === year.id ? { ...y, status: y.status === 'active' ? 'closed' : 'active' } : y)));
  }

  function openCreateTerm(yearId: string) {
    setTermYearId(yearId);
    setEditingTerm(null);
    setTermForm(blankTermForm);
    setTermModal(true);
  }
  function openEditTerm(yearId: string, term: Term) {
    setTermYearId(yearId);
    setEditingTerm(term);
    setTermForm({ name: term.name, startDate: term.startDate, endDate: term.endDate });
    setTermModal(true);
  }
  function submitTerm(event: FormEvent) {
    event.preventDefault();
    if (!termYearId) return;
    persist(
      years.map((y) => {
        if (y.id !== termYearId) return y;
        if (editingTerm) {
          return { ...y, terms: y.terms.map((t) => (t.id === editingTerm.id ? { ...t, ...termForm } : t)) };
        }
        return { ...y, terms: [...y.terms, { id: newId(), ...termForm }] };
      })
    );
    setTermModal(false);
  }
  function removeTerm(yearId: string, termId: string) {
    persist(years.map((y) => (y.id === yearId ? { ...y, terms: y.terms.filter((t) => t.id !== termId) } : y)));
  }

  const usingDemoData = years.length === 0;
  const displayYears = usingDemoData ? DEMO_YEARS : years;
  const activeYear = displayYears.find((y) => y.status === 'active');

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">SCHOOL · ACADEMIC YEAR &amp; TERM MANAGEMENT</p>
          <h2>Academic year &amp; term management</h2>
          <p>Define academic years and their terms so orders, pricing and reports can be scoped to the right session.</p>
        </div>
        <button className="primary-action" type="button" onClick={openCreateYear}>
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

      {usingDemoData && <p className="demo-data-banner">Showing sample data for preview — this is a UI-only demo, nothing here is saved.</p>}

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
              const isDemo = year.id.startsWith('demo-');
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
                    {!isDemo && (
                      <>
                        <button type="button" className="icon-action" title="Edit year" aria-label={`Edit ${year.label}`} onClick={() => openEditYear(year)}>✎</button>
                        <button type="button" className="icon-action" title={year.status === 'active' ? 'Close year' : 'Reopen year'} aria-label={`Change status of ${year.label}`} onClick={() => toggleYearStatus(year)}>
                          {year.status === 'active' ? '⊘' : '✓'}
                        </button>
                        <button type="button" className="icon-action" title="Delete year" aria-label={`Delete ${year.label}`} onClick={() => removeYear(year.id)}>🗑</button>
                      </>
                    )}
                  </td>
                </tr>
                {expanded === year.id && (
                  <tr key={`${year.id}-terms`}>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <div className="data-table-wrap" style={{ margin: '.5rem 1rem 1rem' }}>
                        <table>
                          <thead><tr><th>Term</th><th>Duration</th><th>Actions</th></tr></thead>
                          <tbody>
                            {year.terms.map((term) => (
                              <tr key={term.id}>
                                <td>{term.name}</td>
                                <td>{dateLabel(term.startDate)} – {dateLabel(term.endDate)}</td>
                                <td className="master-actions">
                                  {!isDemo && (
                                    <>
                                      <button type="button" className="icon-action" title="Edit term" aria-label={`Edit ${term.name}`} onClick={() => openEditTerm(year.id, term)}>✎</button>
                                      <button type="button" className="icon-action" title="Delete term" aria-label={`Delete ${term.name}`} onClick={() => removeTerm(year.id, term.id)}>🗑</button>
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
            {displayYears.length === 0 && (
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
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(false)}>Cancel</button>
                <button className="primary-action" type="submit">{editingYear ? 'Save changes' : 'Add year'}</button>
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
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setTermModal(false)}>Cancel</button>
                <button className="primary-action" type="submit">{editingTerm ? 'Save changes' : 'Add term'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}