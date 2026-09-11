import { FormEvent, MouseEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

// Mirrors the SCHOOL entry in ClientsPage.tsx's INDUSTRY_FIELDS — keep both in sync
// (and apps/api/src/lib/industry-profile.ts, which re-validates on save).
const BOARD_OPTIONS = ['CBSE', 'ICSE', 'State Board', 'IB', 'Other'];
const ADVANCE_MODE_OPTIONS = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Other'];

type IndustryType = { id: string; code: string; name: string; status: string };

type SchoolForm = {
  clientCode: string;
  clientName: string;
  city: string;
  gstin: string;
  creditLimit: string;
  creditDays: string;
  boardAffiliation: string;
  udiseCode: string;
  studentStrength: string;
  advanceAmount: string;
  advancePaymentMode: string;
  advancePaymentDate: string;
  advanceReferenceNo: string;
  status: 'active' | 'inactive';
};
const blankForm: SchoolForm = { clientCode: '', clientName: '', city: '', gstin: '', creditLimit: '', creditDays: '', boardAffiliation: '', udiseCode: '', studentStrength: '', advanceAmount: '', advancePaymentMode: '', advancePaymentDate: '', advanceReferenceNo: '', status: 'active' };

type IndustryDetails = {
  boardAffiliation?: string;
  udiseCode?: string;
  studentStrength?: string | number;
  advanceAmount?: string | number;
  advancePaymentMode?: string;
  advancePaymentDate?: string;
  advanceReferenceNo?: string;
};

type Client = {
  id: string;
  client_code: string;
  client_name: string;
  client_type: string;
  status: 'active' | 'inactive';
  city?: string | null;
  gstin?: string | null;
  credit_limit?: number | null;
  credit_days?: number | null;
  industry_details?: IndustryDetails | null;
  sales_representative_client_assignments?: {
    id: string;
    status: string;
    sales_representatives?: { employee_code: string; user_profiles?: { display_name?: string | null } | null } | null;
  }[];
};
type Order = { id: string; order_number: string; status: string; total_amount: number; created_at: string; client_id?: string };
type Collection = { id: string; amount: number; mode: string; reference_no?: string | null; collected_at: string; client_id?: string };

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));

function activeRep(client: Client): string {
  const assignment = client.sales_representative_client_assignments?.find((a) => a.status === 'active') ?? client.sales_representative_client_assignments?.[0];
  return assignment?.sales_representatives?.user_profiles?.display_name ?? assignment?.sales_representatives?.employee_code ?? '';
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

function advanceAmountOf(client: Client): number {
  const raw = client.industry_details?.advanceAmount;
  return raw ? Number(raw) || 0 : 0;
}

const DEMO_SCHOOLS: Client[] = [
  {
    id: 'demo-school-1',
    client_code: 'SCH-0001',
    client_name: 'Sunrise Public School',
    client_type: 'School',
    status: 'active',
    city: 'Chennai',
    gstin: null,
    credit_limit: 200000,
    credit_days: 30,
    industry_details: {
      boardAffiliation: 'CBSE',
      udiseCode: '33010203401',
      studentStrength: 1200,
      advanceAmount: 50000,
      advancePaymentMode: 'Bank transfer',
      advancePaymentDate: '2026-06-15',
      advanceReferenceNo: 'TXN882145',
    },
    sales_representative_client_assignments: [],
  },
  {
    id: 'demo-school-2',
    client_code: 'SCH-0002',
    client_name: 'Greenfield Matriculation School',
    client_type: 'School',
    status: 'active',
    city: 'Coimbatore',
    gstin: null,
    credit_limit: 120000,
    credit_days: 15,
    industry_details: { boardAffiliation: 'State Board', udiseCode: '33020304502', studentStrength: 650 },
    sales_representative_client_assignments: [],
  },
];

export function SchoolManagementPage() {
  const [schools, setSchools] = useState<Client[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Client['status']>('all');
  const [advanceFilter, setAdvanceFilter] = useState<'all' | 'with_advance' | 'no_advance'>('all');

 const [viewing, setViewing] = useState<Client | null>(null);

  const [industryTypes, setIndustryTypes] = useState<IndustryType[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<SchoolForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState('');
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);

  const schoolIndustryTypeId = useMemo(() => industryTypes.find((it) => it.code === 'SCHOOL')?.id ?? '', [industryTypes]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [clientsRes, ordersRes, collectionsRes, industryTypesRes] = await Promise.all([
        api<{ data: Client[] }>('/clients'),
        api<{ data: Order[] }>('/orders').catch(() => ({ data: [] })),
        api<{ data: Collection[] }>('/collections').catch(() => ({ data: [] })),
        api<{ data: IndustryType[] }>('/industry-types?status=active').catch(() => ({ data: [] })),
      ]);
      setSchools((clientsRes.data ?? []).filter((c) => (c.client_type ?? '').toLowerCase() === 'school'));
      setOrders(ordersRes.data ?? []);
      setCollections(collectionsRes.data ?? []);
      setIndustryTypes(industryTypesRes.data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load school data.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(blankForm);
    setFormMessage('');
    setModal(true);
  }
  function openEdit(school: Client) {
    const d = school.industry_details ?? {};
    setEditing(school);
    setForm({
      clientCode: school.client_code,
      clientName: school.client_name,
      city: school.city ?? '',
      gstin: school.gstin ?? '',
      creditLimit: school.credit_limit != null ? String(school.credit_limit) : '',
      creditDays: school.credit_days != null ? String(school.credit_days) : '',
      boardAffiliation: String(d.boardAffiliation ?? ''),
      udiseCode: String(d.udiseCode ?? ''),
      studentStrength: d.studentStrength != null ? String(d.studentStrength) : '',
      advanceAmount: d.advanceAmount != null ? String(d.advanceAmount) : '',
      advancePaymentMode: String(d.advancePaymentMode ?? ''),
      advancePaymentDate: String(d.advancePaymentDate ?? ''),
      advanceReferenceNo: String(d.advanceReferenceNo ?? ''),
      status: school.status,
    });
    setFormMessage('');
    setModal(true);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormMessage('');
    try {
      const industryDetails = Object.fromEntries(
        Object.entries({
          boardAffiliation: form.boardAffiliation,
          udiseCode: form.udiseCode,
          studentStrength: form.studentStrength,
          advanceAmount: form.advanceAmount,
          advancePaymentMode: form.advancePaymentMode,
          advancePaymentDate: form.advancePaymentDate,
          advanceReferenceNo: form.advanceReferenceNo,
        }).filter(([, v]) => v !== '')
      );
      const payload = {
        clientCode: form.clientCode,
        clientName: form.clientName,
        clientType: 'School',
        industryTypeId: schoolIndustryTypeId || null,
        city: form.city || null,
        gstin: form.gstin ? form.gstin.toUpperCase() : null,
        creditLimit: form.creditLimit ? Number(form.creditLimit) : null,
        creditDays: form.creditDays ? Number(form.creditDays) : null,
        industryDetails,
        priority: 'normal',
        status: form.status,
      };
      await api(editing ? `/clients/${editing.id}` : '/clients', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setModal(false);
      setEditing(null);
      await load();
    } catch (caught) {
      setFormMessage(caught instanceof Error ? caught.message : 'Unable to save school.');
    } finally {
      setSaving(false);
    }
  }
  function ledger(clientId: string) {
    const clientOrders = orders.filter((o) => o.client_id === clientId && o.status !== 'cancelled');
    const clientCollections = collections.filter((c) => c.client_id === clientId);
    const totalSales = clientOrders.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);
    const totalCollected = clientCollections.reduce((sum, c) => sum + (c.amount ?? 0), 0);
    const outstanding = Math.max(0, totalSales - totalCollected);
    const lastOrder = clientOrders.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    return { orderCount: clientOrders.length, totalSales, totalCollected, outstanding, lastOrderDate: lastOrder?.created_at ?? null };
  }

  const rows = useMemo(() => {
    const usingDemoData = !loading && schools.length === 0;
    const source = usingDemoData ? DEMO_SCHOOLS : schools;
    return source.map((s) => ({ school: s, ...ledger(s.id), rep: activeRep(s), advance: advanceAmountOf(s) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schools, orders, collections, loading]);

  const usingDemoData = !loading && schools.length === 0;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.school.status !== statusFilter) return false;
      if (advanceFilter === 'with_advance' && r.advance <= 0) return false;
      if (advanceFilter === 'no_advance' && r.advance > 0) return false;
      if (!q) return true;
      return (
        r.school.client_name.toLowerCase().includes(q) ||
        r.school.client_code.toLowerCase().includes(q) ||
        (r.school.city ?? '').toLowerCase().includes(q) ||
        (r.school.industry_details?.udiseCode ?? '').toLowerCase().includes(q) ||
        r.rep.toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, advanceFilter]);
  function toggleMenu(event: MouseEvent<HTMLButtonElement>, schoolId: string) {
    if (menuFor?.id === schoolId) {
      setMenuFor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: schoolId, top: rect.bottom + 6, left: Math.max(8, rect.right - 168) });
  }

  async function toggleStatus(school: Client) {
    try {
      await api(`/clients/${school.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: school.status === 'active' ? 'inactive' : 'active' }) });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update status.');
    }
  }

  const totalSchools = rows.length;
  const activeSchools = rows.filter((r) => r.school.status === 'active').length;
  const totalAdvanceReceived = rows.reduce((sum, r) => sum + r.advance, 0);
  const schoolsWithAdvance = rows.filter((r) => r.advance > 0).length;
  const totalOutstanding = rows.reduce((sum, r) => sum + r.outstanding, 0);

  const viewingLedger = viewing ? ledger(viewing.id) : null;
  const viewingOrders = viewing ? orders.filter((o) => o.client_id === viewing.id).slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) : [];
  const viewingCollections = viewing ? collections.filter((c) => c.client_id === viewing.id).slice().sort((a, b) => new Date(b.collected_at).getTime() - new Date(a.collected_at).getTime()) : [];
  const viewingDetails = viewing?.industry_details ?? {};

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">SCHOOL · SCHOOL MANAGEMENT</p>
          <h2>School management</h2>
          <p>Directory of school clients — board affiliation, UDISE+ code, student strength, advance payments and sales ledger. Add or edit a school from the Clients directory with client type "School".</p>
        </div>
      </div>

        <div className="kpi-grid">
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon">◎</div>
          <div>
            <span>Schools</span>
            <strong>{totalSchools}</strong>
            <small>{activeSchools} active</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="green">
          <div className="kpi-icon">₹</div>
          <div>
            <span>Advance received</span>
            <strong>{money(totalAdvanceReceived)}</strong>
            <small>{schoolsWithAdvance} school{schoolsWithAdvance === 1 ? '' : 's'} with advance</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="amber">
          <div className="kpi-icon">◒</div>
          <div>
            <span>Outstanding</span>
            <strong>{money(totalOutstanding)}</strong>
            <small>across all schools</small>
          </div>
        </div>
      </div>

      {error && !usingDemoData && <p role="alert" className="error">{error}</p>}
      {usingDemoData && <p className="demo-data-banner">Showing sample data for preview — this is a UI-only demo, nothing here is saved.</p>}

     <div className="master-toolbar">
        <div className="master-search">
          <input value={search} placeholder="Search school name, code, UDISE+ code or rep" onChange={(e) => setSearch(e.target.value)} />
          <button className="quiet-button" type="button" onClick={() => setFiltersOpen(!filtersOpen)}>
            Filters{statusFilter !== 'all' || advanceFilter !== 'all' ? ' (active)' : ''}
          </button>
        </div>
        <button className="primary-action" type="button" onClick={openCreate}>
          + Add school
        </button>
      </div>
      {filtersOpen && (
        <div className="master-filter-bar">
          <label>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label>
            Advance
            <select value={advanceFilter} onChange={(e) => setAdvanceFilter(e.target.value as typeof advanceFilter)}>
              <option value="all">All schools</option>
              <option value="with_advance">Advance received</option>
              <option value="no_advance">No advance</option>
            </select>
          </label>
          <button
            type="button"
            className="link-button"
            onClick={() => { setStatusFilter('all'); setAdvanceFilter('all'); }}
            disabled={statusFilter === 'all' && advanceFilter === 'all'}
          >
            Clear filters
          </button>
        </div>
      )}

      {loading ? (
        <div className="data-table-wrap">
          <table>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td><span className="skeleton-block" style={{ width: '70%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '60%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '50%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '70%' }} /></td>
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
                <th>School</th>
                <th>Board / UDISE+</th>
                <th>Representative</th>
                <th>Advance received</th>
                <th>Outstanding</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ school, outstanding, rep, advance }) => {
                const details = school.industry_details ?? {};
                return (
                  <tr key={school.id}>
                    <td>
                      <strong>{school.client_name}</strong>
                      <small>{school.client_code}{school.city ? ` · ${school.city}` : ''}</small>
                    </td>
                    <td>
                      {details.boardAffiliation || '—'}
                      <small style={{ display: 'block', color: 'var(--text-faint)' }}>{details.udiseCode || 'No UDISE+ code'}</small>
                    </td>
                    <td>
                      {rep ? (
                        <div className="rep-cell">
                          <span className="rep-avatar" style={{ background: avatarColor(rep) }}>{initials(rep)}</span>
                          <span>{rep}</span>
                        </div>
                      ) : (
                        <span className="text-faint-inline">Unassigned</span>
                      )}
                    </td>
                    <td>
                      {advance > 0 ? (
                        <>
                          {money(advance)}
                          <small style={{ display: 'block', color: 'var(--text-faint)' }} className="capitalize">
                            {details.advancePaymentMode || ''}{details.advancePaymentDate ? ` · ${details.advancePaymentDate}` : ''}
                          </small>
                        </>
                      ) : (
                        <span className="text-faint-inline">No advance</span>
                      )}
                    </td>
                    <td className={outstanding > 0 ? 'text-warn' : ''}>{money(outstanding)}</td>
                    <td>
                      <span className={`status-badge ${school.status}`}>{school.status}</span>
                    </td>
                           <td className="master-actions">
                      <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label="More actions" onClick={(e) => toggleMenu(e, school.id)}>
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
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-row">
                    <div className="empty-state">
                      <span className="empty-state-icon">◎</span>
                 <p>
                        {rows.length === 0
                          ? 'No schools yet. Add your first one to get started.'
                          : 'No schools match your search or filters.'}
                      </p>
                      {rows.length === 0 && (
                        <button type="button" className="primary-action" onClick={openCreate}>
                          + Add school
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
              const row = filteredRows.find((r) => r.school.id === menuFor.id);
              if (!row) return null;
              const { school } = row;
              const isDemo = String(school.id).startsWith('demo-');
              return (
                <>
                  <button type="button" title="View" onClick={() => { setMenuFor(null); setViewing(school); }}>
                    <span>◉</span>
                    <span>View</span>
                  </button>
                  {!isDemo && (
                    <>
                      <button type="button" title="Edit" onClick={() => { setMenuFor(null); openEdit(school); }}>
                        <span>✎</span>
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        title={school.status === 'active' ? 'Deactivate' : 'Activate'}
                        onClick={() => { setMenuFor(null); void toggleStatus(school); }}
                      >
                        <span>{school.status === 'active' ? '⊘' : '✓'}</span>
                        <span>{school.status === 'active' ? 'Deactivate' : 'Activate'}</span>
                      </button>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </>
      )}

      {viewing && viewingLedger && (
        <div className="modal-backdrop" onMouseDown={() => setViewing(null)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">SCHOOL</p>
                <h3>{viewing.client_name}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setViewing(null)}>
                ×
              </button>
            </div>

            <dl className="detail-dl">
              <dt>Code</dt>
              <dd>{viewing.client_code}</dd>
              <dt>City</dt>
              <dd>{viewing.city || '—'}</dd>
              <dt>Board affiliation</dt>
              <dd>{viewingDetails.boardAffiliation || '—'}</dd>
              <dt>UDISE+ code</dt>
              <dd>{viewingDetails.udiseCode || '—'}</dd>
              <dt>Student strength</dt>
              <dd>{viewingDetails.studentStrength || '—'}</dd>
              <dt>Credit terms</dt>
              <dd>{viewing.credit_limit != null ? `${money(viewing.credit_limit)} · ${viewing.credit_days ?? 0} days` : '—'}</dd>
            </dl>

            <h5 className="ledger-heading">Advance details</h5>
            <dl className="detail-dl">
              <dt>Advance amount</dt>
              <dd>{viewingDetails.advanceAmount ? money(Number(viewingDetails.advanceAmount)) : '—'}</dd>
              <dt>Payment mode</dt>
              <dd className="capitalize">{viewingDetails.advancePaymentMode || '—'}</dd>
              <dt>Payment date</dt>
              <dd>{viewingDetails.advancePaymentDate || '—'}</dd>
              <dt>Reference no.</dt>
              <dd>{viewingDetails.advanceReferenceNo || '—'}</dd>
            </dl>

            <h5 className="ledger-heading">Recent orders</h5>
            <div className="data-table-wrap">
              <table>
                <thead><tr><th>Order no.</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead>
                <tbody>
                  {viewingOrders.slice(0, 8).map((o) => (
                    <tr key={o.id}>
                      <td>{o.order_number}</td>
                      <td><span className={`status-badge status-${o.status}`}>{o.status}</span></td>
                      <td>{money(o.total_amount)}</td>
                      <td>{dateLabel(o.created_at)}</td>
                    </tr>
                  ))}
                  {viewingOrders.length === 0 && <tr><td colSpan={4} className="empty-row">No orders recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>

            <h5 className="ledger-heading">Recent collections</h5>
            <div className="data-table-wrap">
              <table>
                <thead><tr><th>Amount</th><th>Mode</th><th>Date</th></tr></thead>
                <tbody>
                  {viewingCollections.slice(0, 8).map((c) => (
                    <tr key={c.id}>
                      <td>{money(c.amount)}</td>
                      <td className="capitalize">{c.mode}</td>
                      <td>{dateLabel(c.collected_at)}</td>
                    </tr>
                  ))}
                  {viewingCollections.length === 0 && <tr><td colSpan={3} className="empty-row">No collections recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>

       <div className="modal-actions">
              <button type="button" className="primary-action" onClick={() => setViewing(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setModal(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="school-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">SCHOOL DIRECTORY</p>
                <h3 id="school-modal-title">{editing ? 'Edit school' : 'Add school'}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>
                ×
              </button>
            </div>
            <form className="master-modal-form" onSubmit={submit}>
              <div className="field-grid">
                             <label>School code<input required value={form.clientCode} placeholder="Auto-generated — e.g. SCH-0003" onChange={(e) => setForm({ ...form, clientCode: e.target.value })} /></label>
                <label>School name<input required value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} /></label>
                <label>City<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
                <label>GSTIN<input value={form.gstin} maxLength={15} placeholder="22AAAAA0000A1Z5" onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} /></label>
                <label>Credit limit (₹)<input type="number" min="0" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></label>
                <label>Credit days<input type="number" min="0" max="365" value={form.creditDays} onChange={(e) => setForm({ ...form, creditDays: e.target.value })} /></label>
                <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SchoolForm['status'] })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              </div>

              <fieldset className="modal-fieldset">
                <legend>School details</legend>
                <div className="fieldset-grid">
                  <label>Board affiliation *<select required value={form.boardAffiliation} onChange={(e) => setForm({ ...form, boardAffiliation: e.target.value })}><option value="">Select…</option>{BOARD_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
                  <label>UDISE+ code<input value={form.udiseCode} placeholder="11 digits" onChange={(e) => setForm({ ...form, udiseCode: e.target.value })} /></label>
                  <label>Approx. student strength<input type="number" min="0" value={form.studentStrength} onChange={(e) => setForm({ ...form, studentStrength: e.target.value })} /></label>
                </div>
              </fieldset>

              <fieldset className="modal-fieldset">
                <legend>Advance details</legend>
                <div className="fieldset-grid">
                  <label>Advance amount received (₹)<input type="number" min="0" value={form.advanceAmount} onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })} /></label>
                  <label>Advance payment mode<select value={form.advancePaymentMode} onChange={(e) => setForm({ ...form, advancePaymentMode: e.target.value })}><option value="">Select…</option>{ADVANCE_MODE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
                  <label>Advance payment date<input type="date" value={form.advancePaymentDate} onChange={(e) => setForm({ ...form, advancePaymentDate: e.target.value })} /></label>
                  <label>Advance reference no.<input value={form.advanceReferenceNo} placeholder="Txn / cheque no." onChange={(e) => setForm({ ...form, advanceReferenceNo: e.target.value })} /></label>
                </div>
              </fieldset>

              {formMessage && <p role="alert" className="error">{formMessage}</p>}
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add school'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}