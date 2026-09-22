import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useIndustryScope } from '../industry/useIndustryScope';
import './MasterDataPages.css';


const PENDING_REQUIREMENT_CLIENT_KEY = 'fs-pending-requirement-client';
const PENDING_QUOTATION_REQUIREMENT_KEY = 'fs-pending-quotation-requirement';

type RequirementItem = {
  quantity: number;
  free_text_item?: string | null;
  notes?: string | null;
  products?: { product_code?: string; product_name?: string } | null;
};
type Requirement = {
  id: string;
  title: string;
  description?: string | null;
  urgency: 'low' | 'normal' | 'high';
  status: 'open' | 'quoted' | 'converted' | 'dropped';
  target_date?: string | null;
  created_at: string;
  clients?: { client_name?: string; client_code?: string } | null;
  sales_representatives?: { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null;
  requirement_items?: RequirementItem[];
};

type ClientOption = { id: string; client_name: string; client_code?: string; sales_representative_client_assignments?: { status: string; sales_representative_id: string }[] };
type RepresentativeOption = { id: string; user_id?: string | null; employee_code?: string; user_profiles?: { display_name?: string | null } | null };
type ProductOption = { id: string; product_name: string; product_code?: string; industry_type_id?: string | null };

type ItemRow = {
  mode: 'catalog' | 'custom';
  productId: string;
  freeTextItem: string;
  quantity: string;
  notes: string;
};

type RequirementForm = {
  clientMode: 'existing' | 'outside';
  clientId: string;
  clientName: string;
  representativeId: string;
  title: string;
  description: string;
  urgency: 'low' | 'normal' | 'high';
  targetDate: string;
  items: ItemRow[];
};

const blankItem: ItemRow = { mode: 'catalog', productId: '', freeTextItem: '', quantity: '1', notes: '' };
const blankForm: RequirementForm = {
  clientMode: 'existing',
  clientId: '',
  clientName: '',
  representativeId: '',
  title: '',
  description: '',
  urgency: 'normal',
  targetDate: '',
  items: [{ ...blankItem }],
};
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
const statusLabels: Record<Requirement['status'], string> = { open: 'New', quoted: 'Quoted', converted: 'Completed', dropped: 'Dropped' };

export function RequirementsPage() {
  const { clientMatchesActiveIndustry, matchesActiveIndustry, activeIndustryTypeId } = useIndustryScope();
  const [items, setItems] = useState<Requirement[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');
  const [targetDateFilter, setTargetDateFilter] = useState('');
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);
  const [selected, setSelected] = useState<Requirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<RequirementForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
  const [representativeOptions, setRepresentativeOptions] = useState<RepresentativeOption[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems((await api<{ data: Requirement[] }>('/requirements')).data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load requirements.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const [clientsRes, repsRes] = await Promise.all([
          api<{ data: ClientOption[] }>('/clients'),
          api<{ data: RepresentativeOption[] }>('/sales-representatives'),
        ]);
        setClientOptions(clientsRes.data ?? []);
        setRepresentativeOptions(repsRes.data ?? []);
      } catch {
        /* non-fatal: Client/Representative filters just won't populate options */
      }
    })();
  }, []); 
  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_REQUIREMENT_CLIENT_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_REQUIREMENT_CLIENT_KEY);
    try {
      const pending = JSON.parse(raw) as { id: string; name: string; description?: string; freeTextItem?: string; quantity?: string };
      void openCreate().then(() => {
        setForm((current) => ({
          ...current,
          clientId: pending.id,
          title: current.title || `Requirement for ${pending.name}`,
          description: pending.description || current.description,
          items: pending.freeTextItem
            ? [{ productId: '', freeTextItem: pending.freeTextItem, quantity: pending.quantity || '1', notes: '' }]
            : current.items,
        }));
      });
    } catch {
      // Malformed handoff payload — ignore and let the user open "Add requirement" manually.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function updateStatus(id: string, nextStatus: Requirement['status']) {
    setUpdatingId(id);
    setError(null);
    try {
      const response = await api<{ data: Requirement }>(`/requirements/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...response.data } : item)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update requirement.');
    } finally {
      setUpdatingId(null);
    }
  }
  function toggleMenu(event: React.MouseEvent<HTMLButtonElement>, id: string) {
    if (menuFor?.id === id) { setMenuFor(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id, top: rect.bottom + 4, left: Math.max(8, rect.right - 170) });
  }
  const scopedItems = useMemo(
    () => items.filter((item) => clientMatchesActiveIndustry(item.clients?.client_code)),
    [items, clientMatchesActiveIndustry],
  );
  const scopedClientOptions = useMemo(
    () => clientOptions.filter((client) => clientMatchesActiveIndustry(client.client_code)),
    [clientOptions, clientMatchesActiveIndustry],
  );
  const scopedProductOptions = useMemo(
    () => productOptions.filter((product) => matchesActiveIndustry(product.industry_type_id)),
    [productOptions, matchesActiveIndustry],
  );
  const shown = useMemo(
    () =>
      scopedItems.filter((item) => {
        const repLabel = item.sales_representatives?.user_profiles?.display_name ?? item.sales_representatives?.employee_code ?? '';
        const text = `${item.title} ${item.clients?.client_name ?? ''} ${repLabel}`.toLowerCase();
        return (
          (!search || text.includes(search.toLowerCase())) &&
          (!status || item.status === status) &&
          (!clientFilter || item.clients?.client_name === clientFilter) &&
          (!repFilter || repLabel === repFilter) &&
          (!urgencyFilter || item.urgency === urgencyFilter) &&
          (!targetDateFilter || item.target_date?.slice(0, 10) === targetDateFilter)
        );
      }),
    [scopedItems, search, status, clientFilter, repFilter, urgencyFilter, targetDateFilter],
  );
  const totalCount = scopedItems.length;
  const newCount = scopedItems.filter((item) => item.status === 'open').length;
  const quotedCount = scopedItems.filter((item) => item.status === 'quoted').length;
  const completedCount = scopedItems.filter((item) => item.status === 'converted').length;
  const droppedCount = scopedItems.filter((item) => item.status === 'dropped').length;
  const urgentCount = scopedItems.filter((item) => item.urgency === 'high').length;
  function clearFilters() {
    setStatus(''); setClientFilter(''); setRepFilter(''); setUrgencyFilter(''); setTargetDateFilter('');
  } 

  async function openCreate() {
    setForm(blankForm);
    setFormError(null);
    setModalOpen(true);
    setOptionsLoading(true);
    try {
      const [clientsRes, repsRes, productsRes] = await Promise.all([
        api<{ data: ClientOption[] }>('/clients'),
        api<{ data: RepresentativeOption[] }>('/sales-representatives'),
        api<{ data: ProductOption[] }>('/products'),
      ]);
      setClientOptions(clientsRes.data ?? []);
      setRepresentativeOptions(repsRes.data ?? []);
      setProductOptions(productsRes.data ?? []);
      // Reduce manual work: if the signed-in user is themselves a sales
      // representative, default the field to them instead of making every
      // requirement start with an empty "Select a representative" click —
      // still overridable for an admin logging one on someone else's behalf.
      const { data: sessionData } = await supabase!.auth.getSession();
      const currentUserId = sessionData.session?.user.id;
      const own = currentUserId ? (repsRes.data ?? []).find((rep) => rep.user_id === currentUserId) : undefined;
      if (own) setForm((current) => (current.representativeId ? current : { ...current, representativeId: own.id }));
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Unable to load clients, representatives or products.');
    } finally {
      setOptionsLoading(false);
    }
  }

  function closeModal(force = false) {
    if (saving && !force) return;
    setModalOpen(false);
    setForm(blankForm);
    setFormError(null);
  }

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  function addItemRow() {
    setForm((current) => ({ ...current, items: [...current.items, { ...blankItem }] }));
  }

  function removeItemRow(index: number) {
    setForm((current) => ({ ...current, items: current.items.filter((_, i) => i !== index) }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (form.clientMode === 'existing' && !form.clientId) return setFormError('Select a client.');
    if (form.clientMode === 'outside' && !form.clientName.trim()) return setFormError('Enter the client name.');
    if (form.clientMode === 'outside' && !activeIndustryTypeId) {
      return setFormError('Industry Type context is still loading — wait a moment and try again.');
    }
    if (!form.representativeId) return setFormError('Select a representative.');
    if (!form.title.trim()) return setFormError('Enter a requirement title.');
    for (const row of form.items) {
      if (!row.productId && !row.freeTextItem.trim()) {
        return setFormError(row.mode === 'catalog' ? 'Select a product for each item.' : 'Describe each custom item.');
      }
      if (!row.quantity || Number(row.quantity) <= 0) {
        return setFormError('Each item needs a quantity greater than zero.');
      }
    }

    setSaving(true);
    try {
      // "Outside client" has no real client row yet — the requirements API
      // requires a real clientId (a walk-in name alone was never a valid
      // payload, so it always 400'd). Create the client first, scoped to the
      // active Industry Type so it shows up everywhere downstream, then use
      // its id like any CRM client.
      let clientId = form.clientId;
      if (form.clientMode === 'outside') {
        const created = await api<{ data: { id: string } }>('/clients', {
          method: 'POST',
          body: JSON.stringify({
            clientCode: `CLI-${Date.now().toString(36).toUpperCase()}`,
            clientName: form.clientName.trim(),
            clientType: 'Other',
            industryTypeId: activeIndustryTypeId,
          }),
        });
        clientId = created.data.id;
      }
      await api('/requirements', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          representativeId: form.representativeId,
          title: form.title.trim(),
          description: form.description.trim() || null,
          urgency: form.urgency,
          targetDate: form.targetDate || null,
          items: form.items.map((row) => ({
            productId: row.productId || null,
            freeTextItem: row.productId ? null : row.freeTextItem.trim(),
            quantity: Number(row.quantity),
            notes: row.notes.trim() || null,
          })),
        }),
      });
      closeModal(true);
      await load();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Unable to save requirement.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">REQUIREMENTS</p>
          <h2>Requirements</h2>
          <p>Track customer requirements and move them towards fulfilment.</p>
        </div>
        <button className="primary-action" type="button" onClick={() => void openCreate()}>
          + Add Requirement
        </button>
      </div>

      <div className="kpi-grid lead-kpi-grid">
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon">◧</div><div><span>Total Requirements</span><strong>{totalCount}</strong></div></div>
        <div className="kpi-card" data-tone="blue"><div className="kpi-icon">●</div><div><span>New</span><strong>{newCount}</strong></div></div>
        <div className="kpi-card" data-tone="amber"><div className="kpi-icon">◐</div><div><span>Quoted</span><strong>{quotedCount}</strong></div></div>
        <div className="kpi-card" data-tone="green"><div className="kpi-icon">✓</div><div><span>Completed</span><strong>{completedCount}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon">✕</div><div><span>Dropped</span><strong>{droppedCount}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon">!</div><div><span>Urgent</span><strong>{urgentCount}</strong></div></div>
      </div>

        <div className="master-toolbar">
        <div className="master-search">
          <input value={search} placeholder="Search requirement, client or representative" onChange={(e) => setSearch(e.target.value)} />
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            <option value="">All clients</option>
            {scopedClientOptions.map((client) => <option key={client.id} value={client.client_name}>{client.client_name}</option>)}
          </select>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
            <option value="">All representatives</option>
            {representativeOptions.map((rep) => {
              const label = rep.user_profiles?.display_name ?? rep.employee_code ?? rep.id;
              return <option key={rep.id} value={label}>{label}</option>;
            })}
          </select>
          <select value={urgencyFilter} onChange={(e) => setUrgencyFilter(e.target.value)}>
            <option value="">All urgencies</option>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="open">New</option>
            <option value="quoted">Quoted</option>
            <option value="converted">Completed</option>
            <option value="dropped">Dropped</option>
          </select>
          <input type="date" value={targetDateFilter} onChange={(e) => setTargetDateFilter(e.target.value)} aria-label="Target date" />
          <button type="button" className="link-button" disabled={!status && !clientFilter && !repFilter && !urgencyFilter && !targetDateFilter} onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      </div>
      {error && <p className="error-message">{error}</p>}
      {loading ? (
        <p>Loading requirements…</p>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Requirement</th>
                <th>Client</th>
                <th>Representative</th>
                <th>Urgency</th>
                <th>Target date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.id}>
               <td>
                    <strong>{item.title}</strong>
                    <small className={`origin-tag ${item.description?.startsWith('Auto-created when lead') ? 'origin-auto' : 'origin-manual'}`}>
                      {item.description?.startsWith('Auto-created when lead') ? 'Auto' : 'Manual'}
                    </small>
                  </td>
                  <td>{item.clients?.client_name ?? '—'}</td>
                  <td>{item.sales_representatives?.user_profiles?.display_name ?? item.sales_representatives?.employee_code ?? '—'}</td>
                                   <td>
                    <span className={`status-badge status-${item.urgency === 'high' ? 'critical' : item.urgency}`}>{item.urgency === 'high' ? 'Urgent' : item.urgency}</span>
                  </td>
                  <td>{item.target_date ? dateLabel(item.target_date) : '—'}</td>
                  <td>
                    <span className={`status-badge status-${item.status}`}>{statusLabels[item.status]}</span>
                  </td>
                                 <td className="master-actions">
                    <button type="button" className="icon-action" title="View requirement" aria-label="View requirement" onClick={() => setSelected(item)}>
                      ◉
                    </button>
                    <button type="button" className="icon-action row-menu-trigger" title="Update status" aria-label="Update status" disabled={updatingId === item.id} onClick={(e) => toggleMenu(e, item.id)}>
                      ⋯
                    </button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-state-icon">◇</div>
                      <p>
                        <strong>No requirements yet</strong>
                        <br />
                        Create a requirement to start tracking customer needs.
                      </p>
                      <button type="button" className="primary-action" onClick={() => void openCreate()}>
                        + Add Requirement
                      </button>
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
          <div className="row-menu" style={{ top: menuFor.top, left: menuFor.left }}>
            {(() => {
              const item = shown.find((r) => r.id === menuFor.id);
              if (!item) return null;
            // "Quoted" and "Completed" are never set by hand — they only ever
              // happen as a side effect of creating a Quotation / accepting one.
              // The only real manual decisions on a requirement are reopening it
              // or dropping it (the client isn't interested / it's off).
              return (
                <>
                  {item.status === 'open' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuFor(null);
                        sessionStorage.setItem(PENDING_QUOTATION_REQUIREMENT_KEY, item.id);
                        window.location.hash = 'quotations';
                      }}
                    >
                      Create Quotation →
                    </button>
                  )}
                  {item.status !== 'open' && (
                    <button type="button" onClick={() => { setMenuFor(null); void updateStatus(item.id, 'open'); }}>
                      Reopen as New
                    </button>
                  )}
                  {item.status !== 'dropped' && (
                    <button type="button" onClick={() => { setMenuFor(null); void updateStatus(item.id, 'dropped'); }}>
                      Mark as Dropped
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </>
      )}
      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">REQUIREMENT DETAILS</p>
                <h3>{selected.title}</h3>
              </div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            <dl className="detail-dl">
              <dt>Client</dt>
              <dd>{selected.clients?.client_name ?? '—'}</dd>
              <dt>Representative</dt>
              <dd>{selected.sales_representatives?.user_profiles?.display_name ?? selected.sales_representatives?.employee_code ?? '—'}</dd>
              <dt>Urgency</dt>
              <dd><span className={`status-badge status-${selected.urgency === 'high' ? 'critical' : selected.urgency}`}>{selected.urgency === 'high' ? 'Urgent' : selected.urgency}</span></dd>
              <dt>Status</dt>
              <dd><span className={`status-badge status-${selected.status}`}>{statusLabels[selected.status]}</span></dd>
              <dt>Target date</dt>
              <dd>{selected.target_date ? dateLabel(selected.target_date) : '—'}</dd>
           <dt>Notes</dt>
              <dd>{selected.description ?? '—'}</dd>
            </dl>
            {selected.status === 'open' && (
              <div className="modal-actions" style={{ margin: '0 1.6rem 1rem' }}>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => {
                    sessionStorage.setItem(PENDING_QUOTATION_REQUIREMENT_KEY, selected.id);
                    window.location.hash = 'quotations';
                  }}
                >
                  Create Quotation →
                </button>
              </div>
            )}
            
            <p className="eyebrow" style={{ margin: '0 1.6rem .6rem' }}>ITEMS</p>
            <div className="data-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Quantity</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.requirement_items?.map((line, index) => (
                    <tr key={index}>
                      <td>{line.products?.product_name ?? line.free_text_item ?? 'Item'}</td>
                      <td>{line.quantity}</td>
                      <td>{line.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => closeModal()}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="requirement-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
                          <div>
                <p className="eyebrow">REQUIREMENTS</p>
                <h3 id="requirement-modal-title">Add requirement</h3>
              </div>
              <button type="button" className="icon-action" aria-label="Close" title="Close" onClick={() => closeModal()}>
                ×
              </button>
            </div>
            {optionsLoading ? (
              <p>Loading clients, representatives and products…</p>
            ) : (
              <form onSubmit={submit} className="master-modal-form">
                {formError && <p className="error-message" style={{ gridColumn: '1 / -1' }}>{formError}</p>}
                             <label style={{ gridColumn: '1 / -1' }}>
                  Client
                  <div className="segmented-toggle" role="group" aria-label="Client source">
                    <button
                      type="button"
                      className={form.clientMode === 'existing' ? 'segmented-toggle-active' : ''}
                      onClick={() => setForm({ ...form, clientMode: 'existing', clientName: '' })}
                    >
                      From CRM
                    </button>
                    <button
                      type="button"
                      className={form.clientMode === 'outside' ? 'segmented-toggle-active' : ''}
                      onClick={() => setForm({ ...form, clientMode: 'outside', clientId: '' })}
                    >
                      Outside client (type name)
                    </button>
                  </div>
                </label>
                {form.clientMode === 'existing' ? (
                  <label>
                    Select client
                   <select
                      required
                      value={form.clientId}
                      onChange={(e) => {
                        const clientId = e.target.value;
                        const picked = scopedClientOptions.find((client) => client.id === clientId);
                        const assignedRepId = picked?.sales_representative_client_assignments?.find((a) => a.status === 'active')?.sales_representative_id;
                        setForm((current) => ({ ...current, clientId, representativeId: assignedRepId ?? current.representativeId }));
                      }}
                    >
                      <option value="">Select a client</option>
                      {scopedClientOptions.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.client_name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    Client name
                    <input required value={form.clientName} placeholder="Type the client's name" onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
                  </label>
                )}
                <label>
                  Representative
                  <select required value={form.representativeId} onChange={(e) => setForm({ ...form, representativeId: e.target.value })}>
                    <option value="">Select a representative</option>
                    {representativeOptions.map((rep) => (
                      <option key={rep.id} value={rep.id}>
                        {rep.user_profiles?.display_name ?? rep.employee_code ?? rep.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Title
                  <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>
                <label>
                  Description
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </label>
                <label>
                  Urgency
                  <select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value as RequirementForm['urgency'] })}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>
                  Target date
                  <input type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
                </label>

                <p className="eyebrow" style={{ marginTop: '1rem', gridColumn: '1 / -1' }}>
                  ITEMS
                </p>
                {form.items.map((row, index) => (
                  <div key={index} className="master-filter-bar" style={{ marginBottom: '0.5rem', gridColumn: '1 / -1' }}>
                    <label style={{ gridColumn: '1 / -1' }}>
                      Item source
                      <div className="segmented-toggle" role="group" aria-label="Item source">
                        <button
                          type="button"
                          className={row.mode === 'catalog' ? 'segmented-toggle-active' : ''}
                          onClick={() => updateItem(index, { mode: 'catalog', freeTextItem: '' })}
                        >
                          From product catalog
                        </button>
                        <button
                          type="button"
                          className={row.mode === 'custom' ? 'segmented-toggle-active' : ''}
                          onClick={() => updateItem(index, { mode: 'custom', productId: '' })}
                        >
                          Custom item (not in catalog)
                        </button>
                      </div>
                    </label>
                    {row.mode === 'catalog' ? (
                      <label>
                        Product
                        <select required value={row.productId} onChange={(e) => updateItem(index, { productId: e.target.value })}>
                          <option value="">Select a product</option>
                          {scopedProductOptions.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.product_name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label>
                        Item description
                        <input required value={row.freeTextItem} placeholder="Describe the item" onChange={(e) => updateItem(index, { freeTextItem: e.target.value })} />
                      </label>
                    )}
                    <label>
                      Quantity
                      <input type="number" min="0.01" step="0.01" value={row.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} />
                    </label>
                    <label>
                      Notes
                      <input value={row.notes} onChange={(e) => updateItem(index, { notes: e.target.value })} />
                    </label>
                    {form.items.length > 1 && (
                      <button type="button" className="link-button" onClick={() => removeItemRow(index)}>
                        Remove item
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="quiet-button" onClick={addItemRow} style={{ gridColumn: '1 / -1', justifySelf: 'start' }}>
                  + Add another item
                </button>

                <div className="modal-actions">
                  <button type="button" className="quiet-button" onClick={() => closeModal()} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-action" disabled={saving}>
                    {saving ? 'Saving…' : 'Add requirement'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}