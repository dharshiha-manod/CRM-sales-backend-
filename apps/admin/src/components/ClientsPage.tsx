import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustry } from '../industry/IndustryContext';
import './MasterDataPages.css';

const PENDING_REQUIREMENT_CLIENT_KEY = 'fs-pending-requirement-client';
const PENDING_QUOTATION_REQUIREMENT_KEY = 'fs-pending-quotation-requirement';

type IndustryField = { key: string; label: string; type: 'text' | 'number' | 'select'; required?: boolean; options?: string[]; hint?: string };
const INDUSTRY_FIELDS: Record<string, IndustryField[]> = {
  FMCG: [
    { key: 'fssaiNumber', label: 'FSSAI license number', type: 'text', hint: '14 digits' },
    { key: 'outletCategory', label: 'Outlet category', type: 'select', options: ['General trade', 'Modern trade', 'HoReCa', 'Institutional'] }
  ],
  SCHOOL: [
    { key: 'boardAffiliation', label: 'Board affiliation', type: 'select', required: true, options: ['CBSE', 'ICSE', 'State Board', 'IB', 'Other'] },
    { key: 'udiseCode', label: 'UDISE+ code', type: 'text', hint: '11 digits' },
    { key: 'studentStrength', label: 'Approx. student strength', type: 'number' }
  ],
  TEXTILE: [
    { key: 'unitType', label: 'Unit type', type: 'select', required: true, options: ['Powerloom', 'Handloom', 'Composite mill', 'Garment unit', 'Trader'] },
    { key: 'iecCode', label: 'Import Export Code (IEC)', type: 'text', hint: '10 digits' }
  ],
  PHARMA: [
    { key: 'drugLicenseNumber', label: 'Drug license number', type: 'text', required: true },
    { key: 'licenseValidTill', label: 'License valid till', type: 'text', hint: 'YYYY-MM-DD' }
  ],
  TRADING: [
    { key: 'iecCode', label: 'Import Export Code (IEC)', type: 'text', hint: '10 digits' }
  ]
};
const OUTLET_TYPES = [['wholesaler', 'Wholesaler'], ['retailer', 'Retailer'], ['distributor', 'Distributor'], ['super_stockist', 'Super stockist'], ['institution', 'Institution'], ['manufacturer', 'Manufacturer'], ['other', 'Other']] as const;

type IndustryType = { id: string; code: string; name: string; status: string };
type Contact = { id: string; name: string; designation?: string | null; is_primary: boolean; email?: string | null; phone?: string | null };
type Assignment = { id: string; status: string; sales_representatives?: { employee_code: string; user_profiles?: { display_name?: string | null } | null } | null };
type Client = { id: string; client_name: string; client_code: string; status: 'active' | 'inactive'; priority: 'low' | 'normal' | 'high' | 'critical'; current_stage?: string | null; created_at?: string | null; address?: string | null; city?: string | null; state?: string | null; latitude?: number | null; longitude?: number | null; gstin?: string | null; pan?: string | null; outlet_type?: string | null; credit_limit?: number | null; credit_days?: number | null; industry_type_id?: string | null; industry_details?: Record<string, unknown> | null; industry_types?: { id: string; code: string; name: string } | null; client_contacts?: Contact[]; sales_representative_client_assignments?: Assignment[]; client_type: string };
type ClientForm = { clientCode: string; clientName: string; clientType: string; industryTypeId: string; outletType: string; gstin: string; pan: string; creditLimit: string; creditDays: string; streetAddress: string; city: string; state: string; industryDetails: Record<string, string>; priority: Client['priority']; status: Client['status'] };
const blank: ClientForm = { clientCode: '', clientName: '', clientType: 'School', industryTypeId: '', outletType: '', gstin: '', pan: '', creditLimit: '', creditDays: '', streetAddress: '', city: '', state: '', industryDetails: {}, priority: 'normal', status: 'active' };
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

type TabOrder = { id: string; order_number: string; status: string; total_amount: number; created_at: string; client_id?: string };
type TabVisit = { id: string; status: string; check_in_time: string; check_out_time?: string | null; outcome?: string | null; client_id?: string };
type TabCollection = { id: string; amount: number; mode: string; collected_at: string; sale_orders?: { order_number?: string } | null; client_id?: string };
type TabFollowUp = { id: string; title: string; due_at: string; status: string; priority: string; client_id?: string };
type TabRequirement = { id: string; title?: string; status: string; created_at?: string; client_id?: string };
type TabQuotation = { id: string; quotation_number?: string; status: string; total_amount?: number; created_at?: string; client_id?: string };
type ClientTabData = { orders: TabOrder[]; visits: TabVisit[]; collections: TabCollection[]; followUps: TabFollowUp[]; requirements: TabRequirement[]; quotations: TabQuotation[] };
const blankTabData: ClientTabData = { orders: [], visits: [], collections: [], followUps: [], requirements: [], quotations: [] };
type ClientTab = 'overview' | 'orders' | 'visits' | 'collections' | 'followUps' | 'requirements' | 'quotations' | 'activity';
const clientTabs: { key: ClientTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'orders', label: 'Orders' },
  { key: 'visits', label: 'Visits' },
  { key: 'collections', label: 'Collections' },
  { key: 'followUps', label: 'Follow-ups' },
  { key: 'requirements', label: 'Requirements' },
  { key: 'quotations', label: 'Quotations' },
  { key: 'activity', label: 'Activity History' },
];
export function ClientsPage() {
  const { activeIndustry, config } = useIndustry();

  const [items, setItems] = useState<Client[]>([]); const [industryTypes, setIndustryTypes] = useState<IndustryType[]>([]); const [form, setForm] = useState<ClientForm>(blank); const [search, setSearch] = useState(''); const [type, setType] = useState(''); const [priority, setPriority] = useState<'' | Client['priority']>(''); const [status, setStatus] = useState<'all' | Client['status']>('all'); const [editing, setEditing] = useState<Client | null>(null); const [viewing, setViewing] = useState<Client | null>(null); const [modal, setModal] = useState(false); const [message, setMessage] = useState(''); const [saving, setSaving] = useState(false); const [syncingAddress, setSyncingAddress] = useState(false); const [leadAddressOutOfSync, setLeadAddressOutOfSync] = useState(false);
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);
  const [allOrders, setAllOrders] = useState<TabOrder[]>([]); const [allCollections, setAllCollections] = useState<TabCollection[]>([]);
  const [allRequirements, setAllRequirements] = useState<TabRequirement[]>([]); const [allQuotations, setAllQuotations] = useState<TabQuotation[]>([]);
  const [allFollowUps, setAllFollowUps] = useState<TabFollowUp[]>([]);
  const [activeTab, setActiveTab] = useState<ClientTab>('overview'); const [tabData, setTabData] = useState<ClientTabData>(blankTabData); const [tabLoading, setTabLoading] = useState(false);
  const clientTypes = useMemo(() => [...new Set(items.map((item) => item.client_type).filter(Boolean))].sort(), [items]);
  const activeIndustryType = useMemo(() => industryTypes.find((it) => it.code === activeIndustry.toUpperCase()), [industryTypes, activeIndustry]);
  const industryScoped = items.filter((item) => item.industry_type_id === activeIndustryType?.id);
  const filtered = industryScoped.filter((item) => (!type || item.client_type === type) && (status === 'all' || item.status === status) && (!priority || item.priority === priority));
  const activeCount = industryScoped.filter((item) => item.status === 'active').length;
  const buyersCount = industryScoped.filter((item) => item.client_type?.toLowerCase() === 'buyer').length;
  const suppliersCount = industryScoped.filter((item) => item.client_type?.toLowerCase() === 'supplier').length;
  const nextFollowUpOf = (clientId: string): string | null => {
    const upcoming = allFollowUps.filter((f) => f.client_id === clientId && f.status === 'pending').sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0];
    return upcoming ? upcoming.due_at : null;
  };
// NEW — stage is always derived live from real activity (requirements,
// quotations, orders). No manual field can freeze or override it anymore.
const stageOf = (clientId: string): string => {
  const orderCount = allOrders.filter((o) => o.client_id === clientId && o.status !== 'cancelled').length;
  if (orderCount > 1) return 'Repeat';
  if (orderCount === 1) return 'Order';
  if (allQuotations.some((q) => q.client_id === clientId)) return 'Quotation';
  if (allRequirements.some((r) => r.client_id === clientId)) return 'Requirement';
  return 'New';
};
  const totalOutstanding = useMemo(() => {
    const sales: Record<string, number> = {}; const collected: Record<string, number> = {};
    allOrders.filter((o) => o.status !== 'cancelled').forEach((o) => { if (o.client_id) sales[o.client_id] = (sales[o.client_id] ?? 0) + (o.total_amount ?? 0); });
    allCollections.forEach((c) => { if (c.client_id) collected[c.client_id] = (collected[c.client_id] ?? 0) + (c.amount ?? 0); });
    return industryScoped.reduce((sum, item) => sum + Math.max(0, (sales[item.id] ?? 0) - (collected[item.id] ?? 0)), 0);
  }, [industryScoped, allOrders, allCollections]);
  const selectedIndustryCode = useMemo(() => industryTypes.find((it) => it.id === form.industryTypeId)?.code ?? null, [industryTypes, form.industryTypeId]);
  const industryFields = selectedIndustryCode ? INDUSTRY_FIELDS[selectedIndustryCode] ?? [] : [];
  const load = async () => { try { setMessage(''); const query = new URLSearchParams(search.trim() ? { search: search.trim() } : {}); setItems((await api<{ data: Client[] }>(`/clients?${query}`)).data ?? []); } catch (e) { setMessage((e as Error).message); } };
  const loadIndustryTypes = async () => { try { setIndustryTypes((await api<{ data: IndustryType[] }>('/industry-types?status=active')).data ?? []); } catch { /* non-fatal */ } };
  const loadFinancials = async () => {
    try {
      const [orders, collections, requirements, quotations, followUps] = await Promise.all([
        api<{ data: TabOrder[] }>('/orders').catch(() => ({ data: [] })),
        api<{ data: TabCollection[] }>('/collections').catch(() => ({ data: [] })),
        api<{ data: TabRequirement[] }>('/requirements').catch(() => ({ data: [] })),
        api<{ data: TabQuotation[] }>('/quotations').catch(() => ({ data: [] })),
        api<{ data: TabFollowUp[] }>('/follow-ups').catch(() => ({ data: [] })),
      ]);
      setAllOrders(orders.data ?? []); setAllCollections(collections.data ?? []);
      setAllRequirements(requirements.data ?? []); setAllQuotations(quotations.data ?? []);
      setAllFollowUps(followUps.data ?? []);
    } catch { /* non-fatal */ }
  };
  useEffect(() => { void load(); void loadIndustryTypes(); void loadFinancials(); }, []);
   const openEdit = async (item: Client) => { setEditing(item); setForm({ clientCode: item.client_code, clientName: item.client_name, clientType: item.client_type, industryTypeId: item.industry_type_id ?? '', outletType: item.outlet_type ?? '', gstin: item.gstin ?? '', pan: item.pan ?? '', creditLimit: item.credit_limit != null ? String(item.credit_limit) : '', creditDays: item.credit_days != null ? String(item.credit_days) : '', streetAddress: item.address ?? '', city: item.city ?? '', state: item.state ?? '', industryDetails: Object.fromEntries(Object.entries(item.industry_details ?? {}).map(([k, v]) => [k, String(v)])), priority: item.priority, status: item.status }); setLeadAddressOutOfSync(false); setMessage(''); setModal(true); try { const status = await api<{ data: { differs: boolean } }>(`/clients/${item.id}/address-sync-status`); setLeadAddressOutOfSync(status.data.differs); } catch { /* The edit form remains usable if sync-status lookup is unavailable. */ } };
  const view = async (id: string) => {
    try {
      setViewing((await api<{ data: Client }>(`/clients/${id}`)).data);
      setActiveTab('overview');
      setTabLoading(true);
      const [orders, visits, collections, followUps, requirements, quotations] = await Promise.all([
        api<{ data: TabOrder[] }>('/orders').catch(() => ({ data: [] })),
        api<{ data: TabVisit[] }>('/field-visits').catch(() => ({ data: [] })),
        api<{ data: TabCollection[] }>('/collections').catch(() => ({ data: [] })),
        api<{ data: TabFollowUp[] }>('/follow-ups').catch(() => ({ data: [] })),
        api<{ data: TabRequirement[] }>('/requirements').catch(() => ({ data: [] })),
        api<{ data: TabQuotation[] }>('/quotations').catch(() => ({ data: [] })),
      ]);
      setTabData({
        orders: (orders.data ?? []).filter((o) => o.client_id === id),
        visits: (visits.data ?? []).filter((v) => v.client_id === id),
        collections: (collections.data ?? []).filter((c) => c.client_id === id),
        followUps: (followUps.data ?? []).filter((f) => f.client_id === id),
        requirements: (requirements.data ?? []).filter((r) => r.client_id === id),
        quotations: (quotations.data ?? []).filter((q) => q.client_id === id),
      });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setTabLoading(false);
    }
  };
  const setDetail = (key: string, value: string) => setForm((f) => ({ ...f, industryDetails: { ...f.industryDetails, [key]: value } }));
  const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const missing = industryFields.filter((f) => f.required && !form.industryDetails[f.key]);
    if (missing.length > 0) { setMessage(`${missing.map((f) => f.label).join(', ')} ${missing.length > 1 ? 'are' : 'is'} required.`); return; }
    const gstinValue = form.gstin.trim().toUpperCase();
    const panValue = form.pan.trim().toUpperCase();
    if (gstinValue && !GSTIN_RE.test(gstinValue)) { setMessage('GSTIN must be a valid 15-character GSTIN, or left blank.'); return; }
    if (panValue && !PAN_RE.test(panValue)) { setMessage('PAN must be a valid 10-character PAN, or left blank.'); return; }
    setSaving(true); setMessage('');
    try {
// NEW — only send industryTypeId on edit if it actually changed, so the
// server doesn't needlessly re-run industry resolution/validation on every
// unrelated field edit (this is what was tripping the 500).
          const payload = { clientCode: form.clientCode, clientName: form.clientName, clientType: form.clientType, ...(editing && form.industryTypeId === (editing.industry_type_id ?? '') ? {} : { industryTypeId: form.industryTypeId || null }), outletType: form.outletType || null, gstin: gstinValue || null, pan: panValue || null, address: form.streetAddress.trim() || null, city: form.city.trim() || null, state: form.state.trim() || null, creditLimit: form.creditLimit ? Number(form.creditLimit) : null, creditDays: form.creditDays ? Number(form.creditDays) : null, industryDetails: Object.fromEntries(Object.entries(form.industryDetails).filter(([, v]) => v !== '')), priority: form.priority, status: form.status };
       await api(editing ? `/clients/${editing.id}` : '/clients', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });      setModal(false); setEditing(null); setMessage(editing ? 'Client updated successfully.' : 'Client created successfully.'); await load();
    } catch (e) {
      const err = e as Error & { details?: { fieldErrors?: Record<string, string[]> } };
      const fieldErrors = err.details?.fieldErrors;
      const specific = fieldErrors && Object.entries(fieldErrors).filter(([, msgs]) => msgs?.length).map(([field, msgs]) => `${field}: ${msgs![0]}`).join('; ');
      setMessage(specific || err.message);
    } finally { setSaving(false); }
  }
  async function toggle(item: Client) { try { await api(`/clients/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: item.status === 'active' ? 'inactive' : 'active' }) }); setMessage('Client status updated successfully.'); await load(); } catch (e) { setMessage((e as Error).message); } }
  async function syncAddressFromLead() {
    if (!editing) return;
    setSyncingAddress(true); setMessage('');
    try {
      const synced = (await api<{ data: Client }>(`/clients/${editing.id}/sync-address-from-lead`, { method: 'PATCH' })).data;
      setForm((current) => ({ ...current, streetAddress: synced.address ?? '', city: synced.city ?? '', state: synced.state ?? '' }));
      setEditing(synced);
      setLeadAddressOutOfSync(false);
      setMessage('Address synchronized from the original lead.');
      await load();
    } catch (e) { setMessage((e as Error).message); } finally { setSyncingAddress(false); }
  }
  const clearFilters = () => { setType(''); setStatus('all'); setPriority(''); };
  function toggleMenu(event: React.MouseEvent<HTMLButtonElement>, clientId: string) {
    if (menuFor?.id === clientId) { setMenuFor(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: clientId, top: rect.bottom + 4, left: Math.max(8, rect.right - 170) });
  }
  return <section className="page-panel master-page">
    <div className="page-panel-heading">
      <div>
        <p className="eyebrow">{config.label.toUpperCase()} · {config.terms.partyLabelPlural.toUpperCase()}</p>
        <h2>{config.terms.partyLabelPlural}</h2>
        <p>Manage your business relationships</p>
      </div>
    </div>
    <div className="kpi-grid client-kpi-grid">
      <div className="kpi-card" data-tone="ink"><div className="kpi-icon kpi-icon-ink">◧</div><div><span>Total Clients</span><strong>{industryScoped.length}</strong></div></div>
      <div className="kpi-card" data-tone="green"><div className="kpi-icon kpi-icon-green">✓</div><div><span>Active</span><strong>{activeCount}</strong></div></div>
      <div className="kpi-card" data-tone="blue"><div className="kpi-icon kpi-icon-school">◐</div><div><span>Buyers</span><strong>{buyersCount}</strong></div></div>
      <div className="kpi-card" data-tone="amber"><div className="kpi-icon kpi-icon-amber">◑</div><div><span>Suppliers</span><strong>{suppliersCount}</strong></div></div>
      <div className="kpi-card" data-tone="red"><div className="kpi-icon kpi-icon-red">₹</div><div><span>Outstanding</span><strong>{money(totalOutstanding)}</strong></div></div>
    </div>

    <div className="master-toolbar">
      <div className="master-search">
        <input value={search} placeholder="Search client, code or GSTIN" onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} />
        <button className="quiet-button" type="button" onClick={() => void load()}>Search</button>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {clientTypes.map((value) => <option key={value}>{value}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
          <option value="">All priorities</option>
          <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
        <button type="button" className="link-button" onClick={clearFilters} disabled={!type && status === 'all' && !priority}>Clear filters</button>
      </div>
    </div>
    {!modal && message && <p role="status" className={message.includes('successfully') ? 'success-message' : 'error-message'}>{message}</p>}
    <div className="clients-page data-table-wrap">
      <table>
        <thead>
          <tr><th>Client / Company</th><th>Industry</th><th>Type</th><th>Stage</th><th>Contact</th><th>Added</th><th>Follow-up</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {filtered.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.client_name}</strong><br /><small className="lead-code">{item.client_code}</small></td>
              <td>{item.industry_types?.name ?? <span className="empty-row">Not set</span>}</td>
              <td>{item.client_type}</td>
              <td><span className={`status-badge stage-${stageOf(item.id).toLowerCase()}`}>{stageOf(item.id)}</span></td>
              <td>{item.client_contacts?.find((c) => c.is_primary)?.email || item.client_contacts?.[0]?.email || <small className="lead-code">No email</small>}<br /><small className="lead-code">{item.client_contacts?.find((c) => c.is_primary)?.phone || item.client_contacts?.[0]?.phone || '—'}</small></td>
              <td>{item.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(item.created_at)) : '—'}</td>
              <td>{nextFollowUpOf(item.id) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(nextFollowUpOf(item.id)!)) : '—'}</td>
              <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
              <td className="master-actions">
                <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label={`Actions for ${item.client_name}`} onClick={(e) => toggleMenu(e, item.id)}>⋯</button>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={9}>
                <div className="empty-state">
                  <div className="empty-state-icon">◇</div>
                  <p><strong>No clients yet</strong><br />Clients appear here automatically once a lead is marked "Qualified" — no manual entry needed.</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>

    {menuFor && (
      <>
        <div className="row-menu-backdrop" onMouseDown={() => setMenuFor(null)} />
        <div className="row-menu row-menu--icons" style={{ top: menuFor.top, left: menuFor.left }}>
          {(() => {
            const item = filtered.find((c) => c.id === menuFor.id);
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
                <button
                  type="button"
                  title={item.status === 'active' ? 'Deactivate' : 'Activate'}
                  className={item.status === 'active' ? 'row-menu-danger' : undefined}
                  onClick={() => { setMenuFor(null); void toggle(item); }}
                >
                  {item.status === 'active' ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M4.9 4.9l14.2 14.2" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                  <span>{item.status === 'active' ? 'Deactivate' : 'Activate'}</span>
                </button>
              </>
            );
          })()}
        </div>
      </>
    )}
    {modal && <div className="modal-backdrop" onMouseDown={() => !saving && setModal(false)}><div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="client-modal-title" onMouseDown={(e) => e.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">CLIENT DIRECTORY</p><h3 id="client-modal-title">{editing ? 'Edit client' : 'Add client'}</h3></div><button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>×</button></div>
      <form className="master-modal-form" onSubmit={submit}>
        {message && <p role="status" className={message.includes('successfully') ? 'success-message' : 'error-message'} style={{ margin: '0 1.6rem 1rem' }}>{message}</p>}
        <div className="field-grid">
          <label>Client code<input required value={form.clientCode} onChange={(e) => setForm({ ...form, clientCode: e.target.value })} /></label>
          <label>Client name<input required value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} /></label>
          <label>Street Address<input placeholder="Door number, street, landmark" value={form.streetAddress} onChange={(e) => setForm({ ...form, streetAddress: e.target.value })} /></label>
          {editing && leadAddressOutOfSync && (
            <aside className="lead-address-sync-card" role="status" aria-label="A newer address is available from the original lead">
              <span className="lead-address-sync-icon" aria-hidden="true">↻</span>
              <div className="lead-address-sync-copy">
                <strong>Address update available</strong>
                <span>The original lead has a newer address.</span>
              </div>
              <button type="button" className="lead-address-sync-action" onClick={() => void syncAddressFromLead()} disabled={saving || syncingAddress}>
                {syncingAddress ? 'Syncing…' : 'Sync from lead'}
              </button>
            </aside>
          )}
          <label>City<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <label>State<input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></label>
          <label>Industry<select value={form.industryTypeId} onChange={(e) => setForm({ ...form, industryTypeId: e.target.value, industryDetails: {} })}><option value="">Not set</option>{industryTypes.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</select></label>
          <label>Client type<select value={form.clientType} onChange={(e) => setForm({ ...form, clientType: e.target.value })}>{[...new Set(['School', ...clientTypes])].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>GSTIN<input value={form.gstin} maxLength={15} placeholder="22AAAAA0000A1Z5" onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
            {form.gstin.trim() && !GSTIN_RE.test(form.gstin.trim()) && <small className="field-hint field-hint-error">Enter a full 15-character GSTIN, or clear this field.</small>}
          </label>
          <label>PAN<input value={form.pan} maxLength={10} placeholder="AAAAA0000A" onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} />
            {form.pan.trim() && !PAN_RE.test(form.pan.trim()) && <small className="field-hint field-hint-error">Enter a full 10-character PAN, or clear this field.</small>}
          </label>
          <label>Credit limit (₹)<input type="number" min="0" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></label>
          <label>Credit days<input type="number" min="0" max="365" value={form.creditDays} onChange={(e) => setForm({ ...form, creditDays: e.target.value })} /></label>
          <label>Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Client['priority'] })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>


          <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Client['status'] })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        </div>
        <fieldset className="modal-fieldset">
          <legend>{industryFields.length > 0 ? `${(industryTypes.find((it) => it.id === form.industryTypeId)?.name ?? '').toUpperCase()} DETAILS` : 'OUTLET DETAILS'}</legend>
          <div className="fieldset-grid">
  {selectedIndustryCode !== 'TRADING' && (
              <label>Outlet type<select value={form.outletType} onChange={(e) => setForm({ ...form, outletType: e.target.value })}><option value="">Not set</option>{OUTLET_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            )}
            {industryFields.map((field) => (
              <label key={field.key}>
                {field.label}{field.required ? ' *' : ''}
                {field.type === 'select'
                  ? <select value={form.industryDetails[field.key] ?? ''} onChange={(e) => setDetail(field.key, e.target.value)}><option value="">Select…</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                  : <input type={field.type === 'number' ? 'number' : 'text'} value={form.industryDetails[field.key] ?? ''} placeholder={field.hint} onChange={(e) => setDetail(field.key, e.target.value)} />}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setModal(false)} disabled={saving}>Cancel</button><button className="primary-action" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add client'}</button></div>
      </form>
    </div></div>}
    {viewing && (() => {
      const nonCancelledOrders = tabData.orders.filter((o) => o.status !== 'cancelled');
      const totalSales = nonCancelledOrders.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);
      const totalCollected = tabData.collections.reduce((sum, c) => sum + (c.amount ?? 0), 0);
      const outstanding = Math.max(0, totalSales - totalCollected);
      const lastOrder = [...tabData.orders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      const lastVisit = [...tabData.visits].sort((a, b) => new Date(b.check_in_time).getTime() - new Date(a.check_in_time).getTime())[0];
      const overdueFollowUps = tabData.followUps.filter((f) => f.status === 'pending' && new Date(f.due_at).getTime() < Date.now());
     // NEW — a client with no orders at all has nothing to be "Paid" against;
// only call it Paid once there was actual sales activity that's now settled.
      // FIX — delete everything after the first semicolon on that last line
      const paymentStatus = nonCancelledOrders.length === 0
        ? 'No orders'
        : outstanding <= 0
        ? 'Paid'
        : overdueFollowUps.some((f) => f.title.toLowerCase().includes('payment'))
        ? 'Overdue'
        : viewing.credit_limit != null && outstanding > viewing.credit_limit
        ? 'Over credit limit'
        : 'Pending';
      const activity = [
        ...tabData.orders.map((o) => ({ time: o.created_at, text: `Order ${o.order_number} — ${money(o.total_amount)}` })),
        ...tabData.visits.map((v) => ({ time: v.check_in_time, text: `Visit ${v.check_out_time ? 'completed' : 'checked in'}${v.outcome ? ` — ${v.outcome}` : ''}` })),
        ...tabData.collections.map((c) => ({ time: c.collected_at, text: `Collection ${money(c.amount)} via ${c.mode}${c.sale_orders?.order_number ? ` (${c.sale_orders.order_number})` : ''}` })),
      ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      return (
        <div className="modal-backdrop" onMouseDown={() => setViewing(null)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">CLIENT PROFILE</p><h3>{viewing.client_name}</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setViewing(null)}>×</button>
            </div>
            <div className="master-tab-bar" role="tablist">
              {clientTabs.map((tab) => (
                <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} className={`master-tab-bar-item${activeTab === tab.key ? ' active' : ''}`} onClick={() => setActiveTab(tab.key)}>
                  {tab.label}
                </button>
              ))}
            </div>
            {tabLoading ? <p>Loading client activity…</p> : (
              <>
                {activeTab === 'overview' && (
                  <dl className="detail-dl">
                    <dt>Client code</dt><dd>{viewing.client_code}</dd>
                    <dt>Industry</dt><dd>{viewing.industry_types?.name ?? 'Not set'}</dd>
                    <dt>Type</dt><dd>{viewing.client_type}</dd>
                 {viewing.industry_types?.code !== 'TRADING' && (
                      <>
                        <dt>Outlet type</dt><dd>{OUTLET_TYPES.find(([value]) => value === viewing.outlet_type)?.[1] ?? 'Not set'}</dd>
                      </>
                    )}
                    <dt>GSTIN</dt><dd>{viewing.gstin || 'Not recorded'}</dd>
                    <dt>PAN</dt><dd>{viewing.pan || 'Not recorded'}</dd>
                    <dt>Credit terms</dt><dd>{viewing.credit_limit != null ? `${money(viewing.credit_limit)} limit · ${viewing.credit_days ?? 0} days` : 'Not set'}</dd>
                    <dt>Priority</dt><dd>{viewing.priority}</dd>
                    <dt>Current stage</dt><dd><span className={`status-badge stage-${stageOf(viewing.id).toLowerCase()}`}>{stageOf(viewing.id)}</span></dd>
                    <dt>Status</dt><dd><span className={`status-badge ${viewing.status}`}>{viewing.status}</span></dd>
                    <dt>Location</dt><dd>{viewing.address || viewing.city || 'Not recorded'}</dd>
                    <dt>GPS</dt><dd>{viewing.latitude != null ? `${viewing.latitude}, ${viewing.longitude}` : 'Not recorded'}</dd>
                    {viewing.industry_types && (INDUSTRY_FIELDS[viewing.industry_types.code] ?? []).map((field) => <div key={field.key} style={{ display: 'contents' }}><dt>{field.label}</dt><dd>{String(viewing.industry_details?.[field.key] ?? 'Not recorded')}</dd></div>)}
                    <dt>Contacts</dt><dd>{viewing.client_contacts?.map((contact) => `${contact.name}${contact.is_primary ? ' (primary)' : ''}`).join(', ') || 'None'}</dd>
                    <dt>Email</dt><dd>{viewing.client_contacts?.find((c) => c.is_primary)?.email || viewing.client_contacts?.[0]?.email || '—'}</dd>
                    <dt>Phone</dt><dd>{viewing.client_contacts?.find((c) => c.is_primary)?.phone || viewing.client_contacts?.[0]?.phone || '—'}</dd>
                    <dt>Added on</dt><dd>{viewing.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(viewing.created_at)) : '—'}</dd>
                    <dt>Next follow-up</dt><dd>{nextFollowUpOf(viewing.id) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(nextFollowUpOf(viewing.id)!)) : 'None scheduled'}</dd>
                    <dt>Assigned representatives</dt><dd>{viewing.sales_representative_client_assignments?.map((assignment) => assignment.sales_representatives?.user_profiles?.display_name ?? assignment.sales_representatives?.employee_code).join(', ') || 'None'}</dd>
                    <dt>Total sales</dt><dd>{money(totalSales)}</dd>
                    <dt>Outstanding amount</dt><dd>{money(outstanding)}</dd>
                    <dt>Payment status</dt><dd><span className={`status-badge status-${paymentStatus.toLowerCase().replace(/\s+/g, '_')}`}>{paymentStatus}</span></dd>
                    <dt>Last order</dt><dd>{lastOrder ? `${lastOrder.order_number} — ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(lastOrder.created_at))}` : 'No orders yet'}</dd>
                    <dt>Last visit</dt><dd>{lastVisit ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastVisit.check_in_time)) : 'No visits yet'}</dd>
                  </dl>
                )}
                {activeTab === 'orders' && (
                  <div className="data-table-wrap"><table><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead><tbody>
                    {tabData.orders.map((o) => <tr key={o.id}><td>{o.order_number}</td><td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(o.created_at))}</td><td><span className={`status-badge status-${o.status}`}>{o.status}</span></td><td>{money(o.total_amount)}</td></tr>)}
                    {tabData.orders.length === 0 && <tr><td className="empty-row" colSpan={4}>No orders yet.</td></tr>}
                  </tbody></table></div>
                )}
                {activeTab === 'visits' && (
                  <div className="data-table-wrap"><table><thead><tr><th>Check-in</th><th>Check-out</th><th>Status</th><th>Outcome</th></tr></thead><tbody>
                    {tabData.visits.map((v) => <tr key={v.id}><td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v.check_in_time))}</td><td>{v.check_out_time ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v.check_out_time)) : '—'}</td><td><span className={`status-badge status-${v.status}`}>{v.status}</span></td><td>{v.outcome || '—'}</td></tr>)}
                    {tabData.visits.length === 0 && <tr><td className="empty-row" colSpan={4}>No visits yet.</td></tr>}
                  </tbody></table></div>
                )}
                {activeTab === 'collections' && (
                  <div className="data-table-wrap"><table><thead><tr><th>Date</th><th>Order</th><th>Amount</th><th>Mode</th></tr></thead><tbody>
                    {tabData.collections.map((c) => <tr key={c.id}><td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(c.collected_at))}</td><td>{c.sale_orders?.order_number ?? '—'}</td><td>{money(c.amount)}</td><td>{c.mode}</td></tr>)}
                    {tabData.collections.length === 0 && <tr><td className="empty-row" colSpan={4}>No collections yet.</td></tr>}
                  </tbody></table></div>
                )}
                {activeTab === 'followUps' && (
                  <div className="data-table-wrap"><table><thead><tr><th>Title</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead><tbody>
                    {tabData.followUps.map((f) => <tr key={f.id}><td>{f.title}</td><td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(f.due_at))}</td><td>{f.priority}</td><td><span className={`status-badge status-${f.status}`}>{f.status}</span></td></tr>)}
                    {tabData.followUps.length === 0 && <tr><td className="empty-row" colSpan={4}>No follow-ups yet.</td></tr>}
                  </tbody></table></div>
                )}
                {activeTab === 'requirements' && (
                  <>
                    <div className="master-toolbar" style={{ justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
                      <button
                        type="button"
                        className="primary-action"
                        onClick={() => {
                          sessionStorage.setItem(PENDING_REQUIREMENT_CLIENT_KEY, JSON.stringify({ id: viewing.id, name: viewing.client_name }));
                          window.location.hash = 'requirements';
                        }}
                      >
                        + Add requirement
                      </button>
                    </div>
                    <div className="data-table-wrap"><table><thead><tr><th>Requirement</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>
                      {tabData.requirements.map((r) => (
                        <tr key={r.id}>
                          <td>{r.title ?? r.id}</td>
                          <td><span className={`status-badge status-${r.status}`}>{r.status}</span></td>
                          <td>{r.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(r.created_at)) : '—'}</td>
                          <td>
                            {r.status === 'open' && (
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => {
                                  sessionStorage.setItem(PENDING_QUOTATION_REQUIREMENT_KEY, r.id);
                                  window.location.hash = 'quotations';
                                }}
                              >
                                Create quotation
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {tabData.requirements.length === 0 && <tr><td className="empty-row" colSpan={4}>No requirements captured yet.</td></tr>}
                    </tbody></table></div>
                  </>
                )}
                {activeTab === 'quotations' && (
                  <div className="data-table-wrap"><table><thead><tr><th>Quotation</th><th>Status</th><th>Amount</th><th>Created</th></tr></thead><tbody>
                    {tabData.quotations.map((q) => <tr key={q.id}><td>{q.quotation_number ?? q.id}</td><td><span className={`status-badge status-${q.status}`}>{q.status}</span></td><td>{q.total_amount != null ? money(q.total_amount) : '—'}</td><td>{q.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(q.created_at)) : '—'}</td></tr>)}
                    {tabData.quotations.length === 0 && <tr><td className="empty-row" colSpan={4}>No quotations yet.</td></tr>}
                  </tbody></table></div>
                )}
                {activeTab === 'activity' && (
                  <div className="data-table-wrap"><table><thead><tr><th>When</th><th>Event</th></tr></thead><tbody>
                    {activity.map((a, i) => <tr key={i}><td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(a.time))}</td><td>{a.text}</td></tr>)}
                    {activity.length === 0 && <tr><td className="empty-row" colSpan={2}>No activity recorded yet.</td></tr>}
                  </tbody></table></div>
                )}
              </>
            )}
          </div>
        </div>
      );
    })()}
  </section>;
}
