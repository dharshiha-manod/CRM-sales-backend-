import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { useIndustry } from '../industry/IndustryContext';
import type { IndustryKey } from '../industry/types';
import { LeadPipelineStepper } from './LeadPipelineStepper';
import './MasterDataPages.css';

const PENDING_REQUIREMENT_CLIENT_KEY = 'fs-pending-requirement-client';
type IndustryOption = { id: string; code: string; name: string };
type RepresentativeOption = { id: string; employee_code?: string; user_profiles?: { display_name?: string | null } | null };
type ProductOption = { id: string; product_name: string; product_code?: string; selling_price: number; industry_type_id?: string | null };

type LeadActivity = {
  id: string;
  activity_type: 'created' | 'status_changed' | 'assigned' | 'note_added' | 'converted' | 'next_action_set';
  note?: string | null;
  previous_status?: string | null;
  new_status?: string | null;
  created_at: string;
  user_profiles?: { display_name?: string | null } | null;
};
  
type Lead = {
  id: string;
  lead_code: string;
  company_name: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  source: string;
  status: 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted' | 'lost';
  priority: 'low' | 'normal' | 'high' | 'critical';
  score: number;
  next_action?: string | null;
  next_action_due_at?: string | null;
  notes?: string | null;
  converted_client_id?: string | null;
  created_at: string;
  industry_types?: IndustryOption | null;
  sales_representatives?: RepresentativeOption | null;
  clients?: { id: string; client_code: string; client_name: string } | null;
};  

type LeadForm = {
  leadCode: string;
  industryTypeId: string;
  representativeId: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  source: string;
  priority: string;
  status: string;
  notes: string;
  // Extra CRM fields — not real DB columns, packed into `notes` (see packFmcgMeta below)
  areaRoute: string;
  shopType: string;
  customerType: string;
  interestedProduct: string;
  expectedOrderValue: string;
  nextFollowUp: string;
};

const blankForm: LeadForm = {
  leadCode: '',
  industryTypeId: '',
  representativeId: '',
  companyName: '',
  contactName: '',
  phone: '',
  email: '',
  city: '',
  state: '',
  source: 'other',
  priority: 'normal',
  status: 'new',
  notes: '',
  areaRoute: '',
  shopType: 'general_store',
  customerType: 'retailer',
  interestedProduct: '',
  expectedOrderValue: '',
  nextFollowUp: '',
};

const sourceLabels: Record<string, string> = {
  referral: 'Referral',
  cold_call: 'Cold call',
  walk_in: 'Walk-in',
  website: 'Website',
  exhibition: 'Exhibition',
  social_media: 'Social media',
  ivr: 'IVR / phone line',
  other: 'Other',
};

const priorityLabels: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', critical: 'Critical' };

// Shop type / Customer type are industry-specific concepts — each Industry Type
// gets its own field label and its own option list, so switching the active
// industry never leaks another industry's values (e.g. FMCG no longer offers
// "Pharmacy", School gets school-appropriate values instead of "Retailer").
type FieldOption = [value: string, label: string];
type FieldConfig = { fieldLabel: string; options: FieldOption[] };

const shopTypeConfig: Record<IndustryKey, FieldConfig> = {
  fmcg: {
    fieldLabel: 'Shop type',
    options: [
      ['general_store', 'General store'],
      ['supermarket', 'Supermarket'],
      ['kirana', 'Kirana store'],
      ['wholesale', 'Wholesale outlet'],
      ['distributor', 'Distributor'],
      ['institution', 'Institution (canteen / hostel)'],
      ['other', 'Other'],
    ],
  },
  pharma: {
    fieldLabel: 'Outlet type',
    options: [
      ['pharmacy', 'Pharmacy'],
      ['hospital', 'Hospital / Clinic'],
      ['wholesale', 'Pharma distributor'],
      ['institution', 'Institution'],
      ['other', 'Other'],
    ],
  },
  textile: {
    fieldLabel: 'Business type',
    options: [
      ['manufacturer', 'Manufacturer'],
      ['wholesale', 'Wholesale outlet'],
      ['general_store', 'Retail store'],
      ['institution', 'Export house'],
      ['other', 'Other'],
    ],
  },
  trading: {
    fieldLabel: 'Trade type',
    options: [
      ['wholesale', 'Import/Export trader'],
      ['general_store', 'Local trader'],
      ['institution', 'Corporate buyer'],
      ['other', 'Other'],
    ],
  },
  vehicle: {
    fieldLabel: 'Dealer type',
    options: [
      ['general_store', 'Showroom'],
      ['wholesale', 'Dealership'],
      ['institution', 'Fleet buyer'],
      ['other', 'Other'],
    ],
  },
  // School doesn't have a "shop" concept at all, so this field is hidden
  // entirely for School (see the form + table below) — no options needed.
  school: { fieldLabel: 'Shop type', options: [] },
};

const customerTypeConfig: Record<IndustryKey, FieldConfig> = {
  fmcg: {
    fieldLabel: 'Customer type',
    options: [
      ['retailer', 'Retailer'],
      ['distributor', 'Distributor'],
      ['wholesaler', 'Wholesaler'],
      ['institution', 'Institution (bulk buyer)'],
      ['other', 'Other'],
    ],
  },
  pharma: {
    fieldLabel: 'Customer type',
    options: [
      ['retailer', 'Retail pharmacy'],
      ['hospital', 'Hospital'],
      ['distributor', 'Distributor'],
      ['institution', 'Institution'],
      ['other', 'Other'],
    ],
  },
  textile: {
    fieldLabel: 'Customer type',
    options: [
      ['retailer', 'Retailer'],
      ['wholesaler', 'Wholesaler'],
      ['manufacturer', 'Manufacturer'],
      ['exporter', 'Exporter'],
      ['other', 'Other'],
    ],
  },
  trading: {
    fieldLabel: 'Customer type',
    options: [
      ['importer', 'Importer'],
      ['exporter', 'Exporter'],
      ['wholesaler', 'Wholesaler'],
      ['retailer', 'Retailer'],
      ['institution', 'Corporate buyer'],
      ['other', 'Other'],
    ],
  },
  vehicle: {
    fieldLabel: 'Customer type',
    options: [
      ['dealer', 'Dealer'],
      ['fleet', 'Fleet buyer'],
      ['individual', 'Individual buyer'],
      ['other', 'Other'],
    ],
  },
  school: {
    fieldLabel: 'School type',
    options: [
      ['government', 'Government school'],
      ['private', 'Private school'],
      ['international', 'International school'],
      ['college', 'College'],
      ['coaching', 'Coaching / Tuition center'],
      ['other', 'Other'],
    ],
  },
};

function fieldOptions(config: Record<IndustryKey, FieldConfig>, industry: IndustryKey): FieldOption[] {
  return config[industry]?.options ?? [];
}
function fieldLabelText(config: Record<IndustryKey, FieldConfig>, industry: IndustryKey): string {
  return config[industry]?.fieldLabel ?? 'Type';
}
function optionLabel(config: Record<IndustryKey, FieldConfig>, industry: IndustryKey, value?: string | null): string {
  return fieldOptions(config, industry).find(([v]) => v === value)?.[1] ?? '—';
}
function defaultOptionValue(config: Record<IndustryKey, FieldConfig>, industry: IndustryKey): string {
  return fieldOptions(config, industry)[0]?.[0] ?? '';
}

// DB status values are unchanged (new/contacted/qualified/unqualified/converted/lost) —
// 'unqualified' is relabeled to the "Follow-up" pipeline stage for display only.
const statusLabels: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  unqualified: 'Follow-up',
  converted: 'Converted',
  lost: 'Lost',
};

const PIPELINE_STAGES: { key: Lead['status']; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'unqualified', label: 'Follow-up' },
  { key: 'converted', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];

/**
 * ── Why this exists ──
 * The database's `leads` table doesn't have columns for Area/Route, Shop type,
 * Expected value, etc. Rather than change the database (not allowed for this
 * task), we hide that extra info as JSON text INSIDE the existing `notes`
 * column, after a marker string a human would never type. Think of it like
 * a sticky note folded behind the visible note — the visible part still shows
 * plain text, the folded part carries structured data only this app reads.
 *
 * NOTE: this used to be a null-byte marker ('\u0000FMCG_META\u0000'), but the
 * API strips null bytes from every string field before it reaches Postgres
 * (text columns reject \u0000 outright). That silently deleted the marker on
 * save, so the fold-back never matched and the raw JSON ended up displayed as
 * if it were the visible note. Switched to a plain text marker to survive
 * that — but a first attempt ('\n<<<FMCG_META>>>\n') reintroduced the same
 * class of bug: the API's validation schema also trims leading/trailing
 * whitespace off the whole `notes` string, and whenever the visible notes
 * text is empty the marker's own leading '\n' becomes the first character of
 * the string — and gets trimmed away too, breaking the exact-match lookup.
 * The marker must not start or end with anything `.trim()` would remove.
 */
const FMCG_META_MARKER = '<<<FMCG_META>>>';

type FmcgMeta = {
  areaRoute?: string;
  shopType?: string;
  customerType?: string;
  interestedProduct?: string;
  expectedOrderValue?: string;
  nextFollowUp?: string;
};

function packFmcgMeta(freeTextNotes: string, meta: FmcgMeta): string {
  const clean: FmcgMeta = {};
  (Object.keys(meta) as (keyof FmcgMeta)[]).forEach((key) => {
    if (meta[key]) clean[key] = meta[key];
  });
  if (Object.keys(clean).length === 0) return freeTextNotes;
  return `${freeTextNotes}${FMCG_META_MARKER}${JSON.stringify(clean)}`;
}

function unpackFmcgMeta(notes?: string | null): { text: string; meta: FmcgMeta } {
  if (!notes) return { text: '', meta: {} };
  const idx = notes.indexOf(FMCG_META_MARKER);
  if (idx === -1) return { text: notes, meta: {} };
  const text = notes.slice(0, idx);
  try {
    return { text, meta: JSON.parse(notes.slice(idx + FMCG_META_MARKER.length)) as FmcgMeta };
  } catch {
    return { text, meta: {} };
  }
}

const isOverdue = (lead: Lead) =>
  Boolean(lead.next_action_due_at) &&
  new Date(lead.next_action_due_at as string).getTime() < Date.now() &&
  lead.status !== 'converted' &&
  lead.status !== 'lost';

const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

type SortKey = 'newest' | 'oldest' | 'value' | 'followup';

export function LeadsPage() {
  const [items, setItems] = useState<Lead[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
// NEW — deleted entirely (the create-lead form's own `form.industryTypeId` is untouched — it still tags each new lead)
  const [priorityFilter, setPriorityFilter] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
 const { matchesActiveIndustry, activeIndustryTypeId } = useIndustryScope();
  const { activeIndustry, config } = useIndustry();

 const [industryOptions, setIndustryOptions] = useState<IndustryOption[]>([]);
  const [representativeOptions, setRepresentativeOptions] = useState<RepresentativeOption[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<LeadForm>(blankForm);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // instant lock — updates immediately, unlike React state
  const editingOriginalStatusRef = useRef<Lead['status'] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [confirmDespiteDuplicate, setConfirmDespiteDuplicate] = useState(false);

  const [selected, setSelected] = useState<Lead | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);


  const [convertOpen, setConvertOpen] = useState(false);
  const [convertForm, setConvertForm] = useState({ clientCode: '', clientType: '', address: '' });
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  // Auto-conversion: qualifying a lead automatically creates the client + a
  // quotation, with no manual "Convert" step. This currently runs client-side
  // (calling the existing /leads/:id/convert endpoint under the hood) until
  // the backend does this natively on status change — but there is no
  // separate on/off toggle or preview label; it always runs.
 const [autoConverted, setAutoConverted] = useState<Record<string, {
    clientCode: string;
    quotationNumber?: string;
    awaitingProduct: boolean;
  }>>({});

  const [nextActionDraft, setNextActionDraft] = useState('');
  const [nextActionDueDraft, setNextActionDueDraft] = useState('');
  const [savingNextAction, setSavingNextAction] = useState(false);
  const [suggestingRep, setSuggestingRep] = useState(false);

  // Row "⋯" menu — stores which lead's menu is open and where to draw it

  async function load() {
    setLoading(true);
    setError(null);
    try {
 const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      const query = params.toString();
      setItems((await api<{ data: Lead[] }>(`/leads${query ? `?${query}` : ''}`)).data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load leads.');
    } finally {
      setLoading(false);
    }
  }

  // Add-lead modal can open before the /industry-types fetch (in
  // useIndustryScope) has resolved — openCreate() only reads
  // activeIndustryTypeId once, at that instant. If it was still null then,
  // form.industryTypeId stayed '' for the rest of that modal session even
  // after activeIndustryTypeId loaded a moment later, so Save always failed
  // on "Select an industry." with nothing visible on the form to explain
  // why. This keeps the create form's industryTypeId synced to
  // activeIndustryTypeId as long as the field hasn't been set yet — it never
  // overwrites a value openEdit() set for an existing lead.
  useEffect(() => {
    if (!modalOpen || editingLeadId) return;
    if (form.industryTypeId || !activeIndustryTypeId) return;
    setForm((f) => (f.industryTypeId ? f : { ...f, industryTypeId: activeIndustryTypeId }));
  }, [modalOpen, editingLeadId, activeIndustryTypeId, form.industryTypeId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

 useEffect(() => {
    void (async () => {
      try {
        const [industriesRes, repsRes, productsRes] = await Promise.all([
          api<{ data: IndustryOption[] }>('/industry-types'),
          api<{ data: RepresentativeOption[] }>('/sales-representatives').catch(() => ({ data: [] })),
          api<{ data: ProductOption[] }>('/products').catch(() => ({ data: [] })),
        ]);
        setIndustryOptions(industriesRes.data ?? []);
        setRepresentativeOptions(repsRes.data ?? []);
        setProductOptions(productsRes.data ?? []);
      } catch {
        // Filters/dropdowns are best-effort; the list itself still loads.
      }
    })();
  }, []);

  // Step 1: respect the app's global "active industry" — same rule every other module follows.
  const industryScoped = useMemo(
    () => items.filter((lead) => matchesActiveIndustry(lead.industry_types?.id ?? null)),
    [items, matchesActiveIndustry],
  );

  // Step 3: client-side priority / representative filters (search/status/industry already go to the API in load()).
  const filtered = useMemo(
    () =>
      industryScoped.filter((lead) => {
        if (priorityFilter && lead.priority !== priorityFilter) return false;
        if (repFilter && lead.sales_representatives?.id !== repFilter) return false;
        return true;
      }),
    [industryScoped, priorityFilter, repFilter],
  );

  // Step 4: sort
  const shown = useMemo(() => {
    const arr = [...filtered];
    const value = (lead: Lead) => Number(unpackFmcgMeta(lead.notes).meta.expectedOrderValue) || 0;
    switch (sortKey) {
      case 'oldest':
        arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case 'value':
        arr.sort((a, b) => value(b) - value(a));
        break;
      case 'followup':
        arr.sort((a, b) => {
          if (!a.next_action_due_at) return 1;
          if (!b.next_action_due_at) return -1;
          return new Date(a.next_action_due_at).getTime() - new Date(b.next_action_due_at).getTime();
        });
        break;
      default:
        arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return arr;
  }, [filtered, sortKey]);

  // KPI cards + pipeline bar — computed from the industry-scoped set (not narrowed by priority/rep filters,
  // so the summary numbers stay stable while someone plays with the filter dropdowns).
  const kpis = useMemo(() => {
    const byStatus = (s: Lead['status']) => industryScoped.filter((l) => l.status === s).length;
    return {
      total: industryScoped.length,
      new: byStatus('new'),
      inProgress: byStatus('contacted'),
      qualified: byStatus('qualified'),
      converted: byStatus('converted'),
      followUpsDue: industryScoped.filter(isOverdue).length,
    };
  }, [industryScoped]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    PIPELINE_STAGES.forEach((stage) => {
      counts[stage.key] = industryScoped.filter((l) => l.status === stage.key).length;
    });
    return counts;
  }, [industryScoped]);

function openCreate() {
  setEditingLeadId(null);
  setForm({
    ...blankForm,
    industryTypeId: activeIndustryTypeId ?? '',
    shopType: defaultOptionValue(shopTypeConfig, activeIndustry),
    customerType: defaultOptionValue(customerTypeConfig, activeIndustry),
  }); // pre-filled, using this industry's own option set — not FMCG's
  setFormError(null);
    setDuplicateWarning(null);
    setConfirmDespiteDuplicate(false);
    setModalOpen(true);
  }

  function openEdit(lead: Lead) {
    setMenuFor(null);
    const { text, meta } = unpackFmcgMeta(lead.notes);
    setEditingLeadId(lead.id);
    editingOriginalStatusRef.current = lead.status ?? 'new';
    setForm({
      leadCode: lead.lead_code ?? '',
      industryTypeId: lead.industry_types?.id ?? '',
      representativeId: lead.sales_representatives?.id ?? '',
      companyName: lead.company_name ?? '',
      contactName: lead.contact_name ?? '',
      phone: lead.phone ?? '',
      email: lead.email ?? '',
      city: lead.city ?? '',
      state: lead.state ?? '',
        source: lead.source ?? 'other',
      priority: lead.priority ?? 'normal',
      status: lead.status ?? 'new',
      notes: text,
      areaRoute: meta.areaRoute ?? '',
      shopType: meta.shopType ?? defaultOptionValue(shopTypeConfig, activeIndustry),
      customerType: meta.customerType ?? defaultOptionValue(customerTypeConfig, activeIndustry),
      interestedProduct: meta.interestedProduct ?? '',
      expectedOrderValue: meta.expectedOrderValue ?? '',
      // Prefer the real next_action_due_at column (what the table/KPIs read)
      // and fall back to the legacy meta-only value for leads saved before
      // this field was wired to a real column.
 nextFollowUp: lead.next_action_due_at ? lead.next_action_due_at.slice(0, 16) : meta.nextFollowUp ?? '',
    });
    setFormError(null);
    setDuplicateWarning(null);
    setConfirmDespiteDuplicate(false);
    setModalOpen(true);
  }

  function closeModal(force = false) {
    if (saving && !force) return;
     setModalOpen(false);
    setEditingLeadId(null);
    editingOriginalStatusRef.current = null;
    setForm(blankForm);
    setFormError(null);
    setDuplicateWarning(null);
    setConfirmDespiteDuplicate(false);
  }

  async function handleDelete(lead: Lead) {
    setMenuFor(null);
    if (!window.confirm(`Delete lead "${lead.company_name}"? This can't be undone.`)) return;
    try {
      await api(`/leads/${lead.id}`, { method: 'DELETE' });
      setItems((current) => current.filter((item) => item.id !== lead.id));
      if (selected?.id === lead.id) setSelected(null);
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Unable to delete lead.');
    }
  }

  function toggleMenu(event: React.MouseEvent<HTMLButtonElement>, leadId: string) {
    if (menuFor?.id === leadId) {
      setMenuFor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: leadId, top: rect.bottom + 6, left: Math.max(8, rect.right - 168) });
  }

  async function checkDuplicatesNow() {
    if (!form.phone && !form.email) return;
    try {
      const params = new URLSearchParams();
      if (form.phone) params.set('phone', form.phone);
      if (form.email) params.set('email', form.email);
      if (form.companyName) params.set('companyName', form.companyName);
      const result = await api<{ data: Array<{ lead_code: string; company_name: string }> }>(`/leads/duplicates?${params.toString()}`);
      if (result.data?.length) {
        setDuplicateWarning(`Possible duplicate: ${result.data[0].lead_code} — ${result.data[0].company_name}. Review before saving.`);
      } else {
        setDuplicateWarning(null);
      }
    } catch {
      // Non-blocking: duplicate check failing shouldn't stop the user from working.
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();

    // Instant re-entry guard. React's `saving` state hasn't re-rendered the
    // disabled button yet when a second click/Enter lands within the same
    // tick, so this ref (updated synchronously, no render wait) blocks the
    // duplicate submit that was causing multiple POST /leads requests.
    if (savingRef.current) return;
    savingRef.current = true;

    setFormError(null);

    if (!form.industryTypeId) { savingRef.current = false; return setFormError('Select an industry.'); }
    if (!form.companyName.trim()) { savingRef.current = false; return setFormError('Enter a company name.'); }
    if (!form.phone.trim() && !form.email.trim()) { savingRef.current = false; return setFormError('Enter a phone number or an email address.'); }
    if (duplicateWarning && !confirmDespiteDuplicate) {
      savingRef.current = false;
      return setFormError('Confirm you want to create this lead despite the possible duplicate.');
    }

    setSaving(true);
    try {
     // NEW
      const payload = {
        leadCode: form.leadCode.trim() || undefined,
        industryTypeId: form.industryTypeId,
        representativeId: form.representativeId || null,
        companyName: form.companyName.trim(),
        contactName: form.contactName.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
               source: form.source,
        priority: form.priority,
        notes: packFmcgMeta(form.notes.trim(), { 
          areaRoute: form.areaRoute.trim(),
          shopType: form.shopType,
          customerType: form.customerType,
          interestedProduct: form.interestedProduct.trim(),
          expectedOrderValue: form.expectedOrderValue.trim(),
          nextFollowUp: form.nextFollowUp,
        }) || null,
        nextActionDueAt: form.nextFollowUp ? new Date(form.nextFollowUp).toISOString() : null,
      };
          if (editingLeadId) {
        const response = await api<{ data: Lead }>(`/leads/${editingLeadId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        let finalLead = response.data;

        if (form.status !== editingOriginalStatusRef.current) {
          const statusResponse = await api<{ data: Lead }>(`/leads/${editingLeadId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: form.status }),
          });
          finalLead = statusResponse.data;
        }

        setItems((current) => current.map((item) => (item.id === finalLead.id ? finalLead : item)));
        setSelected((current) => (current?.id === finalLead.id ? finalLead : current));
      } else {
        // New leads: create first, then apply the chosen status (create endpoint
        // doesn't accept status directly — it's set via the /status route,
        // same as edits do). Without this second call, a new lead saved as
        // "Qualified" always showed "New" until the next edit.
        const created = await api<{ data: Lead }>('/leads', { method: 'POST', body: JSON.stringify(payload) });
        if (form.status && form.status !== 'new') {
          await api<{ data: Lead }>(`/leads/${created.data.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: form.status }),
          });
        }
      }
      closeModal(true);
      await load();
    } catch (caught) {
      if (caught && typeof caught === 'object' && 'details' in caught) {
        setFormError((caught as Error).message);
      } else {
        setFormError(caught instanceof Error ? caught.message : 'Unable to save lead.');
      }
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  async function openDetail(lead: Lead) {
    setSelected(lead);
    setMenuFor(null);
    setDetailError(null);
    setNoteDraft('');
    setNextActionDraft(lead.next_action ?? '');
    setNextActionDueDraft(lead.next_action_due_at ? lead.next_action_due_at.slice(0, 16) : '');

    setActivitiesLoading(true);
    try {
      setActivities((await api<{ data: LeadActivity[] }>(`/leads/${lead.id}/activities`)).data ?? []);
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : 'Unable to load lead activity.');
    } finally {
      setActivitiesLoading(false);
    }
  }
async function changeStatus(newStatus: Lead['status']) {
    if (!selected) return;
    setStatusUpdating(true);
    setDetailError(null);
    try {
      // Lead -> Client -> Requirement -> Quotation now happens server-side
      // inside PATCH /leads/:id/status itself (see leads.repository.ts'
      // changeLeadStatus / autoConvertQualifiedLead) — it fires no matter
      // which client triggers the status change, not just this screen.
      // We just reflect whatever the backend already did.
      const response = await api<{ data: Lead }>(`/leads/${selected.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
      setSelected(response.data);
      setItems((current) => current.map((item) => (item.id === response.data.id ? response.data : item)));
      const refreshed = await api<{ data: LeadActivity[] }>(`/leads/${selected.id}/activities`);
      setActivities(refreshed.data ?? []);

      if (newStatus === 'qualified' && response.data.converted_client_id) {
        const generatedCode = `CLI-${response.data.lead_code.replace(/^LD-/, '')}`;
        let quotationNumber: string | undefined;
        try {
          const quotesRes = await api<{ data: Array<{ quotation_number: string; requirement_id: string | null }> }>(
            `/quotations?clientId=${response.data.converted_client_id}`,
          );
          quotationNumber = quotesRes.data?.[0]?.quotation_number;
        } catch {
          // Cosmetic only — banner just won't show a quotation number.
        }
        setAutoConverted((current) => ({
          ...current,
          [response.data.id]: { clientCode: generatedCode, quotationNumber, awaitingProduct: !quotationNumber },
        }));
      }
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : 'Unable to update lead status.');
    } finally {
      setStatusUpdating(false);
    }
  }
  async function addNote() {
    if (!selected || !noteDraft.trim()) return;
    setSavingNote(true);
    setDetailError(null);
    try {
      await api(`/leads/${selected.id}/notes`, { method: 'POST', body: JSON.stringify({ note: noteDraft.trim() }) });
      setNoteDraft('');
      const refreshed = await api<{ data: LeadActivity[] }>(`/leads/${selected.id}/activities`);
      setActivities(refreshed.data ?? []);
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : 'Unable to add note.');
    } finally {
      setSavingNote(false);
    }
  }

  async function saveNextAction() {
    if (!selected) return;
    setSavingNextAction(true);
    setDetailError(null);
    try {
      const response = await api<{ data: Lead }>(`/leads/${selected.id}/next-action`, {
        method: 'PATCH',
        body: JSON.stringify({
          nextAction: nextActionDraft.trim() || null,
          nextActionDueAt: nextActionDueDraft ? new Date(nextActionDueDraft).toISOString() : null,
        }),
      });
      setSelected(response.data);
      setItems((current) => current.map((item) => (item.id === response.data.id ? response.data : item)));
      const refreshed = await api<{ data: LeadActivity[] }>(`/leads/${selected.id}/activities`);
      setActivities(refreshed.data ?? []);
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : 'Unable to save next action.');
    } finally {
      setSavingNextAction(false);
    }
  }

  async function suggestRep() {
    if (!form.industryTypeId) return;
    setSuggestingRep(true);
    try {
      const result = await api<{ data: { id: string } | null }>(`/leads/suggest-representative?industryTypeId=${form.industryTypeId}`);
      if (result.data) setForm((current) => ({ ...current, representativeId: result.data!.id }));
    } catch {
      // Best-effort suggestion; user can still pick manually.
    } finally {
      setSuggestingRep(false);
    }
  }

  function openConvert() {
    if (!selected) return;
    setConvertForm({ clientCode: '', clientType: '', address: '' });
    setConvertError(null);
    setConvertOpen(true);
  }

  async function submitConvert(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setConvertError(null);
    if (!convertForm.clientCode.trim()) return setConvertError('Enter a client code.');
    if (!convertForm.clientType.trim()) return setConvertError('Enter a client type.');

    setConverting(true);
    try {
      const response = await api<{ data: Lead }>(`/leads/${selected.id}/convert`, {
        method: 'POST',
        body: JSON.stringify({
          clientCode: convertForm.clientCode.trim(),
          clientType: convertForm.clientType.trim(),
          address: convertForm.address.trim() || null,
        }),
      });
      setSelected(response.data);
      setItems((current) => current.map((item) => (item.id === response.data.id ? response.data : item)));
      setConvertOpen(false);
      await load();
    } catch (caught) {
      setConvertError(caught instanceof Error ? caught.message : 'Unable to convert lead.');
    } finally {
      setConverting(false);
    }
  }

  return (
    <section className="page-panel master-page lead-pipeline-page">
      <div className="page-panel-heading">
        <div>
         <p>Manage, track and convert your sales leads.</p>
        </div>
        <button className="primary-action" type="button" onClick={openCreate}>
          + Add Lead
        </button>
      </div>
      <div className="lead-management-banner">
        <h2>Lead Management</h2>
        <p>Manage all your sales leads — {kpis.total} total</p>
      </div>

        <div className="kpi-grid lead-kpi-grid">
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon">◧</div>
          <div>
            <span>Total Leads</span>
            <strong>{kpis.total}</strong>
          </div>
        </div>
        <div className="kpi-card" data-tone="blue">
          <div className="kpi-icon">●</div>
          <div>
            <span>New</span>
            <strong>{kpis.new}</strong>
          </div>
        </div>
        <div className="kpi-card" data-tone="amber">
          <div className="kpi-icon">◐</div>
          <div>
            <span>In Progress</span>
            <strong>{kpis.inProgress}</strong>
          </div>
        </div>
        <div className="kpi-card" data-tone="green">
          <div className="kpi-icon">◑</div>
          <div>
            <span>Qualified</span>
            <strong>{kpis.qualified}</strong>
          </div>
        </div>
        <div className="kpi-card" data-tone="green">
          <div className="kpi-icon">✓</div>
          <div>
            <span>Converted</span>
            <strong>{kpis.converted}</strong>
          </div>
        </div>
        <div className="kpi-card" data-tone="red">
          <div className="kpi-icon">!</div>
          <div>
            <span>Follow-ups Due</span>
            <strong>{kpis.followUpsDue}</strong>
          </div>
        </div>
      </div>
      <div className="master-toolbar">
        <div className="master-search">
          <input value={search} placeholder="Search company, lead code or contact" onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <button className="quiet-button" type="button" onClick={() => void load()}>
            Search
          </button>
          <button className="quiet-button" type="button" onClick={() => setFiltersOpen(!filtersOpen)}>
            Filters{status || priorityFilter || repFilter ? ' (active)' : ''}
          </button>
          <label className="sort-select">
            Sort
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="value">Highest value</option>
              <option value="followup">Next follow-up</option>
            </select>
          </label>
        </div>
      </div>

      {filtersOpen && (
        <div className="master-filter-bar">
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="unqualified">Follow-up</option>
              <option value="converted">Converted</option>
              <option value="lost">Lost</option>
            </select>
          </label>
          <label>
            Priority
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="">All priorities</option>
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Representative
            <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
              <option value="">All representatives</option>
              {representativeOptions.map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.user_profiles?.display_name ?? rep.employee_code ?? rep.id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="link-button"
         disabled={!status && !priorityFilter && !repFilter}
            onClick={() => {
             setStatus('');
              setPriorityFilter('');
              setRepFilter('');
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {error && <p className="error-message">{error}</p>}

      {loading ? (
        <div className="data-table-wrap leads-table-wrap">
          <table>
            <tbody>
              {[1, 2, 3, 4].map((i) => (
                <tr key={i} className="skeleton-row">
                  <td colSpan={10}>
                    <span className="skeleton-block" style={{ width: '70%' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="data-table-wrap leads-table-wrap">
          <table>
            <thead>
              <tr>
                          <th>Lead</th>
                {activeIndustry !== 'school' && <th>{fieldLabelText(shopTypeConfig, activeIndustry)}</th>}
                <th>Industry</th>
                <th>Representative</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Expected value</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Next follow-up</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((lead) => {
                const meta = unpackFmcgMeta(lead.notes).meta;
                return (
                  <tr key={lead.id}>
                                      <td>
                      <strong>{lead.company_name}</strong>
                      <small className="lead-code">{lead.lead_code}</small>
                    </td>
                                       {activeIndustry !== 'school' && <td>{optionLabel(shopTypeConfig, activeIndustry, meta.shopType)}</td>}
                    <td>{lead.industry_types?.name ?? '—'}</td>
                    <td>{lead.sales_representatives?.user_profiles?.display_name ?? lead.sales_representatives?.employee_code ?? 'Unassigned'}</td>
                    <td>
                      {lead.contact_name && <span>{lead.contact_name}</span>}
                      {lead.phone && <small>{lead.phone}</small>}
                    </td>
                    <td>{lead.email || <small className="lead-code">No email</small>}</td>
                    <td>{meta.expectedOrderValue ? `₹${meta.expectedOrderValue}` : '—'}</td>
                    <td>
                      <span className={`status-badge status-${lead.priority}`}>{priorityLabels[lead.priority] ?? lead.priority}</span>
                    </td>
                    <td>
                      <span className={`status-badge status-${lead.status}`}>{statusLabels[lead.status] ?? lead.status}</span>
                    </td>
                    <td>
                      {lead.next_action_due_at ? (
                        isOverdue(lead) ? (
                          <span className="text-warn followup-cell">
                            <strong>Overdue</strong>
                            <span>{new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(lead.next_action_due_at))}</span>
                          </span>
                        ) : (
                          <span>{new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(lead.next_action_due_at))}</span>
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="master-actions">
                      <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label="More actions" onClick={(e) => toggleMenu(e, lead.id)}>
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
              {shown.length === 0 && (
                <tr>
                  <td colSpan={11}>
                    <div className="empty-state">
                      <div className="empty-state-icon">◇</div>
                      <p>
                        <strong>No leads yet</strong>
                        <br />
                        Create your first lead to start building your sales pipeline.
                      </p>
                      <button type="button" className="primary-action" onClick={openCreate}>
                        + Add Lead
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
          <div className="row-menu row-menu--icons" style={{ top: menuFor.top, left: menuFor.left }}>
            {(() => {
              const lead = shown.find((l) => l.id === menuFor.id);
              if (!lead) return null;
              return (
                <>
                  <button type="button" title="View" onClick={() => void openDetail(lead)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span>View</span>
                  </button>
                  <button type="button" title="Edit" onClick={() => openEdit(lead)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
                    </svg>
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    className="row-menu-danger"
                    onClick={() => void handleDelete(lead)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                    <span>Delete</span>
                  </button>
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
                <p className="eyebrow">LEAD DETAIL</p>
                <h3>{selected.company_name}</h3>
              </div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            {detailError && <p className="error-message">{detailError}</p>}
            <p className="eyebrow" style={{ marginTop: '.5rem' }}>PIPELINE STAGE</p>
                        <LeadPipelineStepper leadStatus={selected.status} hasConvertedClient={Boolean(selected.converted_client_id)} />
            <dl className="detail-dl">
              <dt>Lead code</dt>
              <dd>{selected.lead_code}</dd>
              <dt>Industry</dt>
              <dd>{selected.industry_types?.name ?? '—'}</dd>
              <dt>Representative</dt>
              <dd>{selected.sales_representatives?.user_profiles?.display_name ?? selected.sales_representatives?.employee_code ?? 'Unassigned'}</dd>
              <dt>Area / Route</dt>
              <dd>{unpackFmcgMeta(selected.notes).meta.areaRoute || '—'}</dd>
              {activeIndustry !== 'school' && (
                <>
                  <dt>{fieldLabelText(shopTypeConfig, activeIndustry)}</dt>
                  <dd>{optionLabel(shopTypeConfig, activeIndustry, unpackFmcgMeta(selected.notes).meta.shopType)}</dd>
                </>
              )}
              <dt>Expected value</dt>
              <dd>{unpackFmcgMeta(selected.notes).meta.expectedOrderValue ? `₹${unpackFmcgMeta(selected.notes).meta.expectedOrderValue}` : '—'}</dd>
              <dt>Contact</dt>
              <dd>{selected.contact_name ?? '—'}</dd>
              <dt>Phone</dt>
              <dd>{selected.phone ?? '—'}</dd>
              <dt>Email</dt>
              <dd>{selected.email ?? '—'}</dd>
              <dt>Location</dt>
              <dd>{[selected.city, selected.state].filter(Boolean).join(', ') || '—'}</dd>
              <dt>Source</dt>
              <dd>{sourceLabels[selected.source] ?? selected.source}</dd>
              <dt>Status</dt>
              <dd>
                <span className={`status-badge status-${selected.status}`}>{statusLabels[selected.status] ?? selected.status}</span>
              </dd>
              <dt>Priority</dt>
              <dd>
                <span className={`status-badge status-${selected.priority}`}>{priorityLabels[selected.priority] ?? selected.priority}</span>
              </dd>
              <dt>Lead score</dt>
              <dd>{selected.score} / 100</dd>
                        <dt>Next follow-up</dt>
              <dd>
                {selected.next_action_due_at ? (
                  <span className={isOverdue(selected) ? 'text-warn' : undefined}>
                    {isOverdue(selected) ? 'Overdue: ' : ''}
                    {new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(selected.next_action_due_at))}
                  </span>
                ) : (
                  '—'
                )}
              </dd>
              {selected.clients && (
                <>
                  <dt>Converted client</dt>
                  <dd>
                    {selected.clients.client_name} ({selected.clients.client_code})
                    {' — '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        sessionStorage.setItem(PENDING_REQUIREMENT_CLIENT_KEY, JSON.stringify({ id: selected.clients!.id, name: selected.clients!.client_name }));
                        window.location.hash = 'requirements';
                      }}
                    >
                      Start requirement →
                    </button>
                  </dd>
                </>
              )}
              <dt>Notes</dt>
              <dd>{unpackFmcgMeta(selected.notes).text || '—'}</dd>
            </dl>

            {selected.status !== 'converted' && (
              <div className="master-filter-bar" style={{ marginTop: '1rem' }}>
                <label>
                  Move to
                  <select disabled={statusUpdating} value="" onChange={(e) => e.target.value && void changeStatus(e.target.value as Lead['status'])}>
                    <option value="">Change status…</option>
                    {(['new', 'contacted', 'qualified', 'unqualified', 'lost'] as const)
                      .filter((option) => option !== selected.status)
                      .map((option) => (
                        <option key={option} value={option}>
                          {statusLabels[option]}
                        </option>
                      ))}
                  </select>
                </label>
             {selected.status === 'qualified' && !selected.converted_client_id && !autoConverted[selected.id] && (
                  <button type="button" className="primary-action" onClick={openConvert}>
                    Convert to client
                  </button>
                )}  
              </div>
            )}

        {selected.status === 'qualified' && autoConverted[selected.id] && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  borderRadius: '10px',
                  background: '#f5f3ff',
                  border: '1px solid #ddd6fe',
                }}
              >
                <p style={{ margin: 0, fontWeight: 700, color: '#5b21b6' }}>Converted automatically</p>
                <p style={{ margin: '.35rem 0 0' }}>
                  Client: <strong>{selected.company_name}</strong> ({autoConverted[selected.id].clientCode})
                </p>
                <p style={{ margin: '.25rem 0 0' }}>Requirement created automatically from this lead.</p>
                {autoConverted[selected.id].quotationNumber ? (
                  <p style={{ margin: '.25rem 0 0' }}>
                    Quotation <strong>{autoConverted[selected.id].quotationNumber}</strong> generated — ready to send.
                  </p>
                ) : (
                  <p style={{ margin: '.25rem 0 0' }}>
                    Quotation not generated yet — the interested product didn't match your catalog. Open Requirements and pick the exact product to price it.
                  </p>
                )}
              </div>
            )}

            <p className="eyebrow" style={{ marginTop: '1.25rem' }}>
              NEXT ACTION / FOLLOW-UP
            </p>
            <div className="master-filter-bar" style={{ marginBottom: '0.75rem' }}>
              <label style={{ flex: 1 }}>
                Next action
                <input value={nextActionDraft} placeholder="e.g. Call to confirm budget" onChange={(e) => setNextActionDraft(e.target.value)} />
              </label>
              <label>
                Due
                <input type="datetime-local" value={nextActionDueDraft} onChange={(e) => setNextActionDueDraft(e.target.value)} />
              </label>
              <button type="button" className="quiet-button" disabled={savingNextAction} onClick={() => void saveNextAction()}>
                {savingNextAction ? 'Saving…' : 'Save'}
              </button>
            </div>

            <p className="eyebrow" style={{ marginTop: '1.25rem' }}>
              ACTIVITY & NOTES
            </p>
            <div className="master-filter-bar" style={{ marginBottom: '0.75rem' }}>
              <label style={{ flex: 1 }}>
                Add a note
                <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="e.g. Called, waiting on budget approval" />
              </label>
              <button type="button" className="quiet-button" disabled={savingNote || !noteDraft.trim()} onClick={() => void addNote()}>
                {savingNote ? 'Saving…' : 'Add note'}
              </button>
            </div>

            {/* Simple vertical activity timeline: Lead Created → Contacted → Follow-up → Status Changed → Converted */}
            {activitiesLoading ? (
              <p>Loading activity…</p>
            ) : (
              <ol className="lead-activity-timeline">
                {activities.map((activity) => (
                  <li key={activity.id}>
                    <span className="timeline-dot" />
                    <div>
                      <strong>
                        {activity.activity_type === 'status_changed' && `${statusLabels[activity.previous_status ?? ''] ?? activity.previous_status ?? '—'} → ${statusLabels[activity.new_status ?? ''] ?? activity.new_status ?? '—'}`}
                        {activity.activity_type === 'note_added' && 'Note added'}
                        {activity.activity_type === 'converted' && 'Converted to client'}
                        {activity.activity_type === 'created' && 'Lead created'}
                        {activity.activity_type === 'assigned' && 'Representative assigned'}
                        {activity.activity_type === 'next_action_set' && 'Follow-up updated'}
                      </strong>
                      {activity.activity_type === 'note_added' && activity.note && <p>{activity.note}</p>}
                      <small>
                        {dateLabel(activity.created_at)} · {activity.user_profiles?.display_name ?? '—'}
                      </small>
                    </div>
                  </li>
                ))}
                {activities.length === 0 && <p className="text-faint-inline">No activity yet.</p>}
              </ol>
            )}
          </div>
        </div>
      )}

      {convertOpen && selected && (
        <div className="modal-backdrop" onMouseDown={() => !converting && setConvertOpen(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="convert-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">LEAD PIPELINE</p>
                <h3 id="convert-modal-title">Convert to client</h3>
              </div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setConvertOpen(false)}>
                ×
              </button>
            </div>
            <form onSubmit={submitConvert} className="master-modal-form">
              {convertError && (
                <p className="error-message" style={{ gridColumn: '1 / -1' }}>
                  {convertError}
                </p>
              )}
              <label>
                Client code
                <input required value={convertForm.clientCode} onChange={(e) => setConvertForm({ ...convertForm, clientCode: e.target.value })} />
              </label>
              <label>
                Client type
                <input required placeholder="e.g. retailer, institution" value={convertForm.clientType} onChange={(e) => setConvertForm({ ...convertForm, clientType: e.target.value })} />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Address
                <input value={convertForm.address} onChange={(e) => setConvertForm({ ...convertForm, address: e.target.value })} />
              </label>
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setConvertOpen(false)} disabled={converting}>
                  Cancel
                </button>
                <button type="submit" className="primary-action" disabled={converting}>
                  {converting ? 'Converting…' : 'Convert lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop modal-backdrop--center" role="presentation" onMouseDown={() => closeModal()}>
          <div className="master-modal master-modal--center" role="dialog" aria-modal="true" aria-labelledby="lead-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">LEAD PIPELINE</p>
                <h3 id="lead-modal-title">{editingLeadId ? 'Edit lead' : 'Add lead'}</h3>
              </div>
              <button type="button" className="icon-action" aria-label="Close" title="Close" onClick={() => closeModal()}>
                ×
              </button>
            </div>
            <form onSubmit={submit} className="master-modal-form">
              {formError && (
                <p className="error-message" style={{ gridColumn: '1 / -1' }}>
                  {formError}
                </p>
              )}
              {duplicateWarning && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <p className="error-message">{duplicateWarning}</p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontWeight: 500 }}>
                    <input type="checkbox" checked={confirmDespiteDuplicate} onChange={(e) => setConfirmDespiteDuplicate(e.target.checked)} />
                    Create anyway
                  </label>
                </div>
              )}

                       <fieldset className="modal-fieldset">
                <legend>Lead information</legend>
                <div className="fieldset-grid">
                  <label>
                    Lead code (auto-generated if blank)
                    <input value={form.leadCode} placeholder="Auto" onChange={(e) => setForm({ ...form, leadCode: e.target.value })} />
                  </label>
                                      <label>
                    {{ school: 'School name', textile: 'Business name', trading: 'Company name', vehicle: 'Dealer name' }[activeIndustry] ?? 'Shop / Retailer name'}
                    <input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} onBlur={() => void checkDuplicatesNow()} />
                  </label>
                  <label>
                    Area / Route
                    <input placeholder="e.g. Route 4 - MG Road belt" value={form.areaRoute} onChange={(e) => setForm({ ...form, areaRoute: e.target.value })} />
                  </label>
                  {activeIndustry !== 'school' && (
                    <label>
                      {fieldLabelText(shopTypeConfig, activeIndustry)}
                      <select value={form.shopType} onChange={(e) => setForm({ ...form, shopType: e.target.value })}>
                        {fieldOptions(shopTypeConfig, activeIndustry).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </fieldset>

              <fieldset className="modal-fieldset">
                <legend>Contact</legend>
                <div className="fieldset-grid">
                  <label>
                    Contact person
                    <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
                  </label>
                  <label>
                    Mobile number
                    <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} onBlur={() => void checkDuplicatesNow()} />
                  </label>
                  <label>
                    Email
                    <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} onBlur={() => void checkDuplicatesNow()} />
                  </label>
                  <label>
                    City
                    <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                  </label>
                  <label>
                    State
                    <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                  </label>
                </div>
              </fieldset>
              <fieldset className="modal-fieldset">
                <legend>Sales</legend>
                <div className="fieldset-grid">
                                <label>
                    {fieldLabelText(customerTypeConfig, activeIndustry)}
                    <select value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>
                      {fieldOptions(customerTypeConfig, activeIndustry).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                                                     <label>
                    Interested product / category
                    <select
                      value={form.interestedProduct}
                      onChange={(e) => setForm({ ...form, interestedProduct: e.target.value })}
                    >
                      <option value="">Select a product</option>
                      {productOptions.map((product) => (
                        <option key={product.id} value={product.product_name}>
                          {product.product_name}{product.product_code ? ` (${product.product_code})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Expected order value (₹)
                    <input type="number" min="0" value={form.expectedOrderValue} onChange={(e) => setForm({ ...form, expectedOrderValue: e.target.value })} />
                  </label>
                            <label>
                    Priority
                    <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                      {Object.entries(priorityLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Status
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      {(['new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost'] as const).map((value) => (
                        <option key={value} value={value}>
                          {statusLabels[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Source
                    <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                      {Object.entries(sourceLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Representative (optional — auto/assisted if left blank)
                    <div style={{ display: 'flex', gap: '.5rem' }}>
                      <select style={{ flex: 1 }} value={form.representativeId} onChange={(e) => setForm({ ...form, representativeId: e.target.value })}>
                        <option value="">Unassigned (auto-assign on save)</option>
                        {representativeOptions.map((rep) => (
                          <option key={rep.id} value={rep.id}>
                            {rep.user_profiles?.display_name ?? rep.employee_code ?? rep.id}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="quiet-button" disabled={!form.industryTypeId || suggestingRep} onClick={() => void suggestRep()}>
                        {suggestingRep ? '…' : 'Suggest'}
                      </button>
                    </div>
                  </label>
                </div>
              </fieldset>

              <fieldset className="modal-fieldset">
                <legend>Follow-up</legend>
                <div className="fieldset-grid">
                  <label>
                    Next follow-up
                  <input type="datetime-local" value={form.nextFollowUp} onChange={(e) => setForm({ ...form, nextFollowUp: e.target.value })} />
                  </label>
                  <label style={{ gridColumn: '1 / -1' }}>
                    Notes
                    <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </label>
                </div>
              </fieldset>

              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => closeModal()} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="primary-action" disabled={saving}>
                  {saving ? 'Saving…' : editingLeadId ? 'Save changes' : 'Add lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}