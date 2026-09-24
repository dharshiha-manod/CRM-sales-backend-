// FILE: admin/src/components/TextileMasterPage.tsx
import { CSSProperties, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { useIndustry } from '../industry/IndustryContext';
import { consumeRecordFocus } from '../lib/recordFocus';
import './MasterDataPages.css';
/**
 * One config-driven page powers every Textile module (Design & Pattern,
 * Colour & Size, Fabric Roll, Textile Sample, Quality & Inspection).
 * Add a new module by adding a config in textileModules.ts — never
 * duplicate this file. Backed by real Postgres tables (see the
 * migration under apps/api), not localStorage or jsonb blobs.
 */

export type FieldType = 'text' | 'number' | 'select' | 'combo' | 'date' | 'textarea' | 'lookup' | 'multi-lookup';
export type DynamicSelectOption = { value: string; label: string };
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;

  options?: string[];
  /**
   * for type: 'combo' — default suggestions shown in the dropdown. The
   * user can still type anything else; whatever they type is merged with
   * this list (deduped) so it becomes a selectable suggestion from then on,
   * since it's picked up from the values already saved in existing records.
   */
  comboOptions?: string[];
  required?: boolean;
  placeholder?: string;
  /** groups fields under a <fieldset> legend; omit for the ungrouped top section */
  group?: string;
  /** show this field as a column in the list table */
  listColumn?: boolean;
  /** format a value for table/detail display */
  format?: (value: unknown, record: TextileRecord) => string;
  /** shown but not editable — pairs with autoGenerate */
  readOnly?: boolean;
  /**
   * prefix used to auto-generate this field's value on create, e.g. 'DSN' ->
   * DSN-2026-0007. Can also be a function of the in-progress form when the
   * prefix (or the whole value) depends on another field the user hasn't
   * necessarily filled in yet, e.g. a document's prefix depending on
   * `document_type`. Called once at create time and again whenever
   * `regenerateOn` fields change.
   */
  autoGenerate?: string | ((form: Record<string, string>, sequenceLabel: string) => string);
  /**
   * for fields with `autoGenerate` — when any of these OTHER field keys
   * change, recompute this field's value from `autoGenerate` again (keeping
   * the same running sequence number, just re-deriving the prefix/shape).
   * Omit for fields that only generate once, at create time.
   */
  regenerateOn?: string[];
  /** for type: 'lookup' — API resource to fetch options from, e.g. '/textile/designs' */
  lookupResource?: string;
  /** for type: 'lookup' — which field on the looked-up record to show as the label */
  lookupLabelKey?: string;
  /**
   * for type: 'lookup' — which field on the looked-up record supplies the
   * value that gets stored/matched against. Defaults to this field's own
   * `key` (works when the local field and the looked-up resource use the
   * same column name, e.g. supplier_name -> supplier_name). Set this when
   * they differ, e.g. a Deal's `customer_name` field looking up against
   * /clients, whose matching column is `client_name`.
   */
  lookupValueKey?: string;
  /**
   * for type: 'lookup' — when the user picks a value, copy fields from the
   * looked-up record into other fields on this form, so they don't have to
   * retype the customer/supplier/product/etc. Key = field name on the
   * looked-up record, value = field key on THIS form to fill.
   * e.g. { customer_name: 'customer_name', product_name: 'product_name' }
   */
  autoFillMap?: Record<string, string>;
  /**
   * for type: 'lookup' — optional extra async auto-fill step, beyond the
   * simple same-list copy that autoFillMap does. Fires after the user picks
   * a value (and after autoFillMap has already run). Receives the matched
   * looked-up record and a setForm updater; use it to fetch related data
   * (e.g. Trading > Deal's Customer field pulling in that customer's open
   * requirement/quotation to fill Product, Rates, etc.) and merge it into
   * the form. Optional — existing configs that don't set this are
   * unaffected.
   */
  onLookupChange?: (
    matched: TextileRecord,
    setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
    setDynamicOptions: (key: string, options: DynamicSelectOption[]) => void,
  ) => void;
  /** For type: 'select' — reads its { value, label } options from this runtime-populated bucket. */
  dynamicOptionsKey?: string;
  /**
   * For a dynamic select — field in the form that stores the option value.
   * This lets a picker drive another persisted field through its callbacks.
   */
  dynamicOptionsValueKey?: string;
  visibleIf?: (form: Record<string, string>) => boolean;
  onValueChange?: (value: string, form: Record<string, string>) => Record<string, string> | void;
  /**
   * Like `onValueChange`, but for work that has to be async (e.g. fetching
   * today's exchange rate from Currency Management before writing the
   * converted value back). Receives setForm instead of returning a patch,
   * since the update lands after the fetch resolves. Runs after the
   * synchronous `onValueChange` above. Optional — existing configs are
   * unaffected.
   */
  onValueChangeAsync?: (
    value: string,
    form: Record<string, string>,
    setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
  ) => void;
}

export interface KpiDef {
  icon: string;
  iconClass: 'kpi-icon-ink' | 'kpi-icon-amber' | 'kpi-icon-green' | 'kpi-icon-red' | 'kpi-icon-school';
  tone?: 'ink' | 'blue' | 'amber' | 'green' | 'red';
  label: string;
  value: (rows: TextileRecord[]) => string;
  sub?: (rows: TextileRecord[]) => string;
}

export type TextileRecord = Record<string, unknown> & { id: string; status?: string; created_at?: string };

export interface TextileModuleConfig {
  resource: string; // e.g. '/textile/designs'
  eyebrowModule: string; // e.g. 'DESIGN & PATTERN MANAGEMENT'
  title: string; // e.g. 'Design & pattern management'
  description: string;
  icon: string;
  emptyIcon: string;
  codeField: string; // primary identifying field, e.g. 'design_code'
  nameField: string; // human label field, e.g. 'design_name'
  statusOptions: string[];
  fields: FieldDef[];
  searchableKeys: string[];
  kpis: KpiDef[];
statusFilterable?: boolean;
  // Optional: hide the generic Status column entirely. Off by default for
  // every existing module. Use when a page has no manual `status` field
  // and shows its own computed status column instead (e.g. Price List's
  // live-derived "Validity" column) so the table doesn't show a permanently
  // empty/stale Status badge.
  hideStatusColumn?: boolean;
  /**
   * Optional, off by default. When true the list shows ONE Status column that is a
   * dropdown: picking a value saves it right away (same PATCH and same afterSave as
   * the Edit form), and a separate `status` list column is not repeated.
   */
  inlineStatus?: boolean;
  /** Optional extra fields to save together with an inline status change (e.g. a delivery date). */
  inlineStatusExtra?: (record: TextileRecord, nextStatus: string) => Record<string, unknown> | undefined;
  /**
   * Front-end-only preview rows shown when there's nothing real to display yet
   * (empty table, or the API/route isn't wired up). Never sent to the API —
   * View works, Edit is disabled. Give each an id starting with 'demo-'.
   */
  sampleRecords?: TextileRecord[];
  /** extra buttons rendered in the list table's Actions cell, alongside View/Edit/Delete */
  rowActions?: (record: TextileRecord) => ReactNode;
  /** extra buttons rendered in the View modal's action row, alongside Edit/Done */
  detailActions?: (record: TextileRecord) => ReactNode;
  /** extra content rendered inside the View modal, after the field list and before the action row */
  detailExtra?: (record: TextileRecord) => ReactNode;
  /** extra panel rendered between the KPI cards and the search/filter toolbar */
  renderInsights?: (rows: TextileRecord[]) => ReactNode;
  /**
   * Called after a create/update save succeeds, with the saved record and
   * a reload() to refresh the list afterwards. Optional — every existing
   * module leaves this unset and behaves exactly as before. Added for
   * Purchase Enquiry's "Converted to Deal" automation (Step 5 of the
   * Trading connectivity plan): when status is saved as that value, it
   * creates the matching Deal automatically instead of the dropdown
   * option silently doing nothing.
   */
  afterSave?: (saved: TextileRecord, reload: () => Promise<void>) => void;
  /**
   * Checked once, right after the first successful load — lets another page
   * hand this page a set of values to open the Add form pre-filled with
   * (e.g. "Generate document" from a Deal or Shipment). Return null when
   * there's nothing pending.
   */
  consumePendingDraft?: () => Record<string, string> | null;
  /** called every time `load()` finishes successfully, with the freshly-fetched rows */
  onRecordsLoaded?: (rows: TextileRecord[]) => void;
  /** handed this page's own `load()` so an outside action (e.g. a status-change button) can force a refresh after writing */
  registerReload?: (reload: () => void) => void;
}

const GOOD_STATUSES = new Set(['active', 'in-stock', 'pass', 'approved', 'completed', 'in stock']);
const BAD_STATUSES = new Set(['inactive', 'damaged', 'fail', 'rejected', 'discontinued', 'reject']);
const WATCH_STATUSES = new Set(['pending', 'issued', 'draft', 'revision-requested', 'sold']);

function statusBadgeClass(status?: string): string {
  const s = (status ?? '').toLowerCase();
  if (GOOD_STATUSES.has(s)) return 'status-badge status-completed';
  if (BAD_STATUSES.has(s)) return 'status-badge inactive';
  if (WATCH_STATUSES.has(s)) return 'status-badge status-quoted';
  return 'status-badge';
}

function blankFormFrom(fields: FieldDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.key] = '';
  return out;
}

function resolveAutoGenerate(f: FieldDef, form: Record<string, string>, sequenceLabel: string): string {
  if (typeof f.autoGenerate === 'function') return f.autoGenerate(form, sequenceLabel);
  return `${f.autoGenerate}-${sequenceLabel}`;
}

function applyRegenerateOn(changedKey: string, next: Record<string, string>, fields: FieldDef[]): void {
  for (const g of fields) {
    if (g.autoGenerate && g.regenerateOn?.includes(changedKey)) {
      next[g.key] = resolveAutoGenerate(g, next, next.__seq ?? '');
    }
  }
}

function dateLabel(value: unknown): string {
  if (!value || typeof value !== 'string') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

export function TextileMasterPage({ config }: { config: TextileModuleConfig }) {
 const { resource, eyebrowModule, title, description, icon, emptyIcon, codeField, nameField, statusOptions, fields, searchableKeys, kpis, statusFilterable = true, hideStatusColumn = false, inlineStatus = false, sampleRecords, afterSave } = config;
  const { activeIndustry, activeIndustryTypeId } = useIndustryScope();
  const { config: activeIndustryConfig } = useIndustry();
  const industryLabel = activeIndustryConfig.label.toUpperCase();

  const [records, setRecords] = useState<TextileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [viewing, setViewing] = useState<TextileRecord | null>(null);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<TextileRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>(blankFormFrom(fields));
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState('');
  const [formNotice, setFormNotice] = useState('');
  const [lookupData, setLookupData] = useState<Record<string, TextileRecord[]>>({});
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, DynamicSelectOption[]>>({});
  const [deleting, setDeleting] = useState<TextileRecord | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
 useEffect(() => {
    const lookupFields = fields.filter((f) => (f.type === 'lookup' || f.type === 'multi-lookup') && f.lookupResource);
    lookupFields.forEach(async (f) => {
      try {
        // Scope client/customer lookups (e.g. Trading's "Customer" field
        // pointing at /clients) to the active industry, exactly like the
        // main record load() below already does — otherwise every industry's
        // lookup dropdown shows every other industry's clients too.
        const base = f.lookupResource!;
        const needsIndustryScope = base.startsWith('/clients');
        const separator = base.includes('?') ? '&' : '?';
        const query = needsIndustryScope && activeIndustryTypeId ? `${separator}industryTypeId=${activeIndustryTypeId}` : '';
        const res = await api<{ data: TextileRecord[] }>(`${base}${query}`);
        setLookupData((prev) => ({ ...prev, [f.key]: res.data ?? [] }));
      } catch {
        // lookup options are a convenience — leave the field usable even if this fails
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, activeIndustryTypeId]);


  async function load() {
    setLoading(true);
    setError(null);
    try {
      const query = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
      const res = await api<{ data: TextileRecord[] }>(`${resource}${query}`);
      const rows = res.data ?? [];
      setRecords(rows);
      // Keep an already-open View modal in sync with the fresh data instead
      // of showing a stale snapshot after a status-change action refreshes.
      setViewing((prev) => (prev ? rows.find((row) => row.id === prev.id) ?? prev : prev));
      config.onRecordsLoaded?.(rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Unable to load ${title.toLowerCase()}.`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // Re-fetch whenever the active industry resolves or changes, same
    // convention as CallsPage — never leave stale cross-industry data
    // sitting in the table after a switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, activeIndustry, activeIndustryTypeId]);
  // Hand this page's own reload to the config every render, so a detail
  // action (e.g. a status-change button defined in the config) can refresh
  // the list after writing, without the engine needing to know about it.
  useEffect(() => {
    config.registerReload?.(load);
  });
  // One-time cross-page handoff: another page (e.g. a Deal or Shipment's
  // "Generate document" action) may have queued values for this page to
  // open its Add form pre-filled with. Checked once, after the first real
  // load, so the auto-generated fields below have real records to count.
  const draftHandledRef = useRef(false);
  useEffect(() => {
    if (loading || draftHandledRef.current) return;
    draftHandledRef.current = true;
    const draft = config.consumePendingDraft?.();
    if (!draft) return;
    openCreate();
    setForm((prev) => {
      let next: Record<string, string> = { ...prev, ...draft };
      for (const f of fields) {
        if (f.onValueChange && Object.prototype.hasOwnProperty.call(draft, f.key)) {
          const patch = f.onValueChange(draft[f.key], next);
          if (patch) next = { ...next, ...patch };
        }
      }
      for (const key of Object.keys(draft)) {
        applyRegenerateOn(key, next, fields);
      }
      return next;
    });
    setFormNotice('Pre-filled from the linked record — review and save.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  // Cross-module record links (LinkedRecords / DealLinkedRecords) hand over
  // a record to OPEN, not a draft to create — see lib/recordFocus.ts. This
  // is what makes "Open →" land on the actual record instead of dropping
  // the user on a list with the reference copied to their clipboard, which
  // is what it used to do. Runs after every load so a link followed while
  // already on this module still works.
  const focusHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const focus = consumeRecordFocus(resource);
    if (!focus || focusHandledRef.current === `${focus.field}:${focus.value}`) return;
    focusHandledRef.current = `${focus.field}:${focus.value}`;
    const match = records.find((r) => String(r[focus.field] ?? '') === focus.value);
    if (match) {
      setViewing(match);
    } else {
      // Not in this industry's records (or filtered out) — fall back to
      // surfacing it in the list rather than silently doing nothing.
      setSearch(focus.value);
      setStatusFilter('all');
      setMessage(`Showing results for ${focus.value}.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, records, resource]);
  // Only kicks in once loading is done and there's truly nothing real to show
  // (including when the API route errors out) — never masks real data.
  const usingDemoData = !loading && records.length === 0 && (sampleRecords?.length ?? 0) > 0;
  const displayRecords = usingDemoData ? sampleRecords! : records;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return displayRecords.filter((r) => {
      if (statusFilter !== 'all' && String(r.status ?? '').toLowerCase() !== statusFilter) return false;
      if (!q) return true;
      return searchableKeys.some((key) => String(r[key] ?? '').toLowerCase().includes(q));
    });
  }, [displayRecords, search, statusFilter, searchableKeys]);

  function openCreate() {
    setEditing(null);
    const blank = blankFormFrom(fields);
    const year = new Date().getFullYear();
    const seq = String(records.length + 1).padStart(4, '0');
    const sequenceLabel = `${year}-${seq}`;
    blank.__seq = sequenceLabel;
    for (const f of fields) {
      if (f.autoGenerate) blank[f.key] = resolveAutoGenerate(f, blank, sequenceLabel);
    }
    setForm(blank);
    setDynamicOptions({});
    setFormMessage('');
    setFormNotice('');
    setModal(true);
  }
  function openEdit(record: TextileRecord) {
    setEditing(record);
    const next: Record<string, string> = {};
    for (const f of fields) next[f.key] = record[f.key] != null ? String(record[f.key]) : '';
    setForm(next);
    setDynamicOptions({});
    setFormMessage('');
    setFormNotice('');
    setModal(true);
  }


  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormMessage('');
    setFormNotice('');
    try {
      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        const raw = form[f.key];
        if (raw === '' || raw == null) { payload[f.key] = null; continue; }
        payload[f.key] = f.type === 'number' ? Number(raw) : raw;
      }
      // Records are always created under the currently active industry —
      // never a user-editable field, so a locked user can't tag a record
      // into another industry even by tampering with the form payload.
      if (!editing && activeIndustryTypeId) payload.industry_type_id = activeIndustryTypeId;
      let res: { data: TextileRecord } | undefined;
      for (let attempt = 0; ; attempt += 1) {
        try {
          res = await api<{ data: TextileRecord }>(editing ? `${resource}/${editing.id}` : resource, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
          break;
        } catch (caught) {
          const code = (caught as { code?: string } | null)?.code;
          const canRetry = !editing && code === 'DUPLICATE_RECORD' && fields.some((f) => f.autoGenerate) && attempt < 3;
          if (!canRetry) throw caught;
          const year = new Date().getFullYear();
          const seq = String(records.length + 2 + attempt).padStart(4, '0');
          const sequenceLabel = `${year}-${seq}`;
          const regenerated: Record<string, string> = {};
          for (const f of fields) {
            if (f.autoGenerate) regenerated[f.key] = resolveAutoGenerate(f, form, sequenceLabel);
          }
          Object.assign(payload, regenerated);
          setForm((prev) => ({ ...prev, ...regenerated }));
        }
      }
      setModal(false);
      setMessage(editing ? `${title} record updated successfully.` : `${title} record added successfully.`);
      await load();
      afterSave?.(res!.data, load);
    } catch (caught) {
      setFormMessage(caught instanceof Error ? caught.message : 'Unable to save this record.');
    } finally {
      setSaving(false);
    }
  }
   // Inline status dropdown (opt-in via config.inlineStatus). Sends the same PATCH the
  // Edit form sends, then runs the same afterSave hook, so changing the status here
  // triggers exactly the same automation as saving the record.
  async function changeStatus(record: TextileRecord, next: string) {
    if (!next || next === record.status) return;
    setStatusBusyId(record.id);
    setMessage('');
    try {
      const body = { status: next, ...(config.inlineStatusExtra?.(record, next) ?? {}) };
      const res = await api<{ data: TextileRecord }>(`${resource}/${record.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMessage(`${title} status changed to ${next} successfully.`);
      await load();
      afterSave?.(res.data, load);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Unable to change the status.');
    } finally {
      setStatusBusyId(null);
    }
  }
  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await api(`${resource}/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      setMessage(`${title} record deleted.`);
      await load();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : 'Unable to delete this record.');
    } finally {
      setDeleteBusy(false);
    }
  }
 const formFields = useMemo(() => fields.filter((f) => !f.visibleIf || f.visibleIf(form)), [fields, form]);
  const groups = useMemo(() => {
    const map = new Map<string | undefined, FieldDef[]>();
    for (const f of formFields) {
      const key = f.group;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(f);
    }
    return map;
  }, [formFields]);
  const ungrouped = groups.get(undefined) ?? [];
  const groupNames = [...groups.keys()].filter((k): k is string => Boolean(k));
  const listColumns = fields.filter((f) => f.listColumn && !(inlineStatus && f.key === 'status'));

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
        <p className="eyebrow">{industryLabel} · {eyebrowModule}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

       {kpis.length > 0 && (
        <div className="kpi-grid" style={{ '--kpi-count': kpis.length } as CSSProperties}>
          {kpis.map((k) => (
            <div className="kpi-card" data-tone={k.tone ?? 'ink'} key={k.label}>
              <div className="kpi-icon">{k.icon}</div>
              <div>
                <span>{k.label}</span>
                <strong>{k.value(records)}</strong>
                {k.sub && <small>{k.sub(records)}</small>}
              </div>
            </div>
          ))}
        </div>
      )}

      {config.renderInsights?.(records)}

      <div className="master-toolbar">
        <div className="master-search">
          <input type="search" placeholder={`Search ${title.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
          {statusFilterable && (
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              {statusOptions.map((o) => <option key={o} value={o.toLowerCase()}>{o}</option>)}
            </select>
          )}
        </div>
        <button className="primary-action" type="button" onClick={openCreate}>
          + Add {title.toLowerCase().replace(/ management$/i, '')}
        </button>
      </div>

            {error && !usingDemoData && <p className="error-message">{error}</p>}
      {usingDemoData && <p className="demo-data-banner">Showing sample data for preview — this is a UI-only demo, nothing here is saved.</p>}
      {message && <p className={message.includes('successfully') ? 'success-message' : 'error-message'}>{message}</p>}
  {loading ? (
        <div className="data-table-wrap">
          <table>
            <thead><tr>{listColumns.map((c) => <th key={c.key}>{c.label}</th>)}{!hideStatusColumn && <th>Status</th>}<th>Actions</th></tr></thead>
            <tbody>
              {[0, 1, 2].map((i) => (
                <tr key={i} className="skeleton-row">
                  {listColumns.map((c) => <td key={c.key}><span className="skeleton-block" style={{ width: '60%' }} /></td>)}
                  {!hideStatusColumn && <td><span className="skeleton-block" style={{ width: '50%' }} /></td>}
                  <td><span className="skeleton-block" style={{ width: '40%' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead><tr>{listColumns.map((c) => <th key={c.key}>{c.label}</th>)}{!hideStatusColumn && <th>Status</th>}<th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  {listColumns.map((c) => (
                    <td key={c.key}>{c.format ? c.format(r[c.key], r) : (r[c.key] != null && r[c.key] !== '' ? String(r[c.key]) : '—')}</td>
                  ))}
                         {!hideStatusColumn && (
                    <td>
                      {inlineStatus && !usingDemoData ? (
                        <select
                          className={`${statusBadgeClass(r.status)} status-select`}
                          value={r.status ?? ''}
                          disabled={statusBusyId === r.id}
                          aria-label={`Change status of ${String(r[nameField] ?? r[codeField] ?? '')}`}
                          onChange={(e) => void changeStatus(r, e.target.value)}
                        >
                          {!r.status && <option value="">—</option>}
                          {r.status && !statusOptions.includes(r.status) && <option value={r.status}>{r.status}</option>}
                          {statusOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <span className={statusBadgeClass(r.status)}>{r.status ?? '—'}</span>
                      )}
                    </td>
                  )}
                  <td className="master-actions">
                    <button type="button" className="icon-action" title="View" aria-label={`View ${String(r[nameField] ?? r[codeField] ?? '')}`} onClick={() => setViewing(r)}>◉</button>
                    <button type="button" className="icon-action" title="Edit" aria-label={`Edit ${String(r[nameField] ?? r[codeField] ?? '')}`} onClick={() => openEdit(r)}>✎</button>
                    {config.rowActions?.(r)}
                    <button
                      type="button"
                      className="icon-action icon-action--danger"
                      title={usingDemoData ? 'Sample row — add a real record to enable delete' : 'Delete'}
                      aria-label={`Delete ${String(r[nameField] ?? r[codeField] ?? '')}`}
                      disabled={usingDemoData}
                      onClick={() => { setDeleteError(''); setDeleting(r); }}
                    >🗑</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={listColumns.length + 2} className="empty-row">
                    <div className="empty-state">
                      <span className="empty-state-icon">{emptyIcon}</span>
                      <p>
                        {records.length === 0
                          ? `No records yet. Add your first ${title.toLowerCase()} entry to get started.`
                          : 'No records match your search or filters.'}
                      </p>
                      {records.length === 0 && (
                        <button type="button" className="primary-action" onClick={openCreate}>+ Add {title.toLowerCase().replace(/ management$/i, '')}</button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <div className="modal-backdrop" onMouseDown={() => setViewing(null)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
               <div className="modal-heading">
              <div>
                <p className="eyebrow">{industryLabel} · {eyebrowModule}</p>
                <h3>{String(viewing[nameField] ?? viewing[codeField] ?? 'Record')}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setViewing(null)}>×</button>
            </div>
        <dl className="detail-dl">
              {fields.map((f) => (
                <div key={f.key} style={{ display: 'contents' }}>
                  <dt>{f.label}</dt>
                  <dd>{f.format ? f.format(viewing[f.key], viewing) : f.type === 'date' ? dateLabel(viewing[f.key]) : (viewing[f.key] != null && viewing[f.key] !== '' ? String(viewing[f.key]) : '—')}</dd>
                </div>
              ))}
              <dt>Status</dt>
              <dd><span className={statusBadgeClass(viewing.status)}>{String(viewing.status ?? '—')}</span></dd>
              <dt>Added on</dt>
              <dd>{dateLabel(viewing.created_at)}</dd>
            </dl>
            {config.detailExtra?.(viewing)}
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => { const r = viewing; setViewing(null); openEdit(r); }}>Edit</button>
              {config.detailActions?.(viewing)}
              <button type="button" className="primary-action" onClick={() => setViewing(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setModal(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="textile-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
           <p className="eyebrow">{industryLabel} · {eyebrowModule}</p>
                <h3 id="textile-modal-title">{editing ? `Edit ${title.toLowerCase().replace(/ management$/i, '')}` : `Add ${title.toLowerCase().replace(/ management$/i, '')}`}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setModal(false)}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={submit}>
              {formNotice && <p className="success-message">{formNotice}</p>}
              <div className="field-grid">
                          {ungrouped.map((f) => (
                  <label key={f.key}>
                    {f.label}{f.required ? ' *' : ''}

                    {renderInput(f, form, setForm, lookupData, fields, dynamicOptions, (key, options) => setDynamicOptions((prev) => ({ ...prev, [key]: options })), records)}
                  </label>
                ))}
              </div>
              {groupNames.map((g) => (
                <fieldset className="modal-fieldset" key={g}>
                  <legend>{g}</legend>
                  <div className="fieldset-grid">
                                 {groups.get(g)!.map((f) => (
                      <label key={f.key}>
                        {f.label}{f.required ? ' *' : ''}
                        {renderInput(f, form, setForm, lookupData, fields, dynamicOptions, (key, options) => setDynamicOptions((prev) => ({ ...prev, [key]: options })), records)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              {formMessage && <p role="alert" className="error">{formMessage}</p>}
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : `Add ${title.toLowerCase().replace(/ management$/i, '')}`}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleting && (
        <div className="modal-backdrop modal-backdrop--center" onMouseDown={() => !deleteBusy && setDeleting(null)}>
          <div className="master-modal master-modal--center" role="dialog" aria-modal="true" aria-labelledby="textile-delete-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
              <p className="eyebrow">{industryLabel} · {eyebrowModule}</p>
                <h3 id="textile-delete-title">Delete {title.toLowerCase().replace(/ management$/i, '')}?</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => !deleteBusy && setDeleting(null)}>×</button>
            </div>
            <div style={{ padding: '0 1.6rem 1.2rem' }}>
              <p>
                This will permanently delete{' '}
                <strong>{String(deleting[nameField] ?? deleting[codeField] ?? 'this record')}</strong>. This can't be undone.
              </p>
              {deleteError && <p role="alert" className="error">{deleteError}</p>}
            </div>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancel</button>
              <button type="button" className="primary-action icon-action--danger" onClick={confirmDelete} disabled={deleteBusy}>
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function dedupeByValue(rows: TextileRecord[], f: FieldDef): TextileRecord[] {
  const seen = new Set<string>();
  const out: TextileRecord[] = [];
  for (const r of rows) {
    const value = String(r[f.lookupValueKey ?? f.key] ?? r.id);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(r);
  }
  return out;
}
/**
 * Type-to-search dropdown for `type: 'lookup'` fields. Plain <select> lists
 * become unusable once a resource (Clients, Products, etc.) has 100+ rows —
 * this swaps the list for a text box that filters as you type, while a
 * visually-hidden mirror input keeps the same native `required` validation
 * the old <select> had (so "Save" still blocks and points at the field if
 * it's required and empty).
 */
function SearchableLookup({
  value,
  required,
  options,
  valueKey,
  labelKey,
  onChange,
}: {
  value: string;
  required?: boolean;
  options: TextileRecord[];
  valueKey?: string;
  labelKey?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const getValue = (o: TextileRecord) => String(o[valueKey ?? 'id'] ?? o.id);
  const getLabel = (o: TextileRecord) => {
    const v = getValue(o);
    return labelKey ? `${v} — ${String(o[labelKey] ?? '')}` : v;
  };

  const selected = options.find((o) => getValue(o) === value);
  const displayValue = open ? search : selected ? getLabel(selected) : '';
  const filtered = search.trim()
    ? options.filter((o) => getLabel(o).toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={displayValue}
        placeholder="Type to search…"
        onFocus={() => {
          setOpen(true);
          setSearch('');
        }}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
      />
      <input
        type="text"
        required={required}
        value={value}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        onChange={() => undefined}
        style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}
      />
      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            maxHeight: 220,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 6,
            boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
          }}
        >
          <div
            style={{ padding: '6px 10px', cursor: 'pointer', color: '#888' }}
            onMouseDown={(e) => {
              e.preventDefault();
              onChange('');
              setOpen(false);
              setSearch('');
            }}
          >
            Select…
          </div>
          {filtered.length === 0 && <div style={{ padding: '6px 10px', color: '#999', fontSize: 13 }}>No matches</div>}
          {filtered.map((o) => (
            <div
              key={String(o.id)}
              style={{ padding: '6px 10px', cursor: 'pointer' }}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(getValue(o));
                setOpen(false);
                setSearch('');
              }}
            >
              {getLabel(o)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderInput(
  f: FieldDef,
  form: Record<string, string>,
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
  lookupData: Record<string, TextileRecord[]> = {},
  fields: FieldDef[] = [],
  dynamicOptions: Record<string, DynamicSelectOption[]> = {},
  setDynamicOptions: (key: string, options: DynamicSelectOption[]) => void = () => undefined,
  records: TextileRecord[] = [],
) {
 const valueKey = f.dynamicOptionsValueKey ?? f.key;
 const value = form[valueKey] ?? '';
  const onChange = (v: string) => {
    setForm((prev) => {
      const next = { ...prev, [valueKey]: v };
      if (f.onValueChange) {
        const patch = f.onValueChange(v, next);
        if (patch) Object.assign(next, patch);
      }
      applyRegenerateOn(f.key, next, fields);
      return next;
    });
    // Kept outside the updater — updaters must stay synchronous and pure.
    f.onValueChangeAsync?.(v, form, setForm);
  };
  if (f.readOnly) {
    return <input type="text" value={value} readOnly disabled />;
  }
  if (f.type === 'combo') {
    // Dropdown of comboOptions defaults, merged with whatever values
    // already exist on saved records for this field — so once someone
    // types a new category and saves, it becomes a suggestion for
    // everyone else from then on. Still a plain text input underneath,
    // so typing something not in the list is always allowed.
    const existing = records.map((r) => String(r[f.key] ?? '').trim()).filter(Boolean);
    const merged = Array.from(new Set([...(f.comboOptions ?? []), ...existing]));
    const listId = `combo-${f.key}`;
    return (
      <>
        <input
          type="text"
          list={listId}
          required={f.required}
          value={value}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <datalist id={listId}>
          {merged.map((option) => <option key={option} value={option} />)}
        </datalist>
      </>
    );
  }
  if (f.type === 'multi-lookup') {
    const options = lookupData[f.key] ?? [];
    const selected = new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
    const toggle = (v: string) => {
      const next = new Set(selected);
      if (next.has(v)) next.delete(v); else next.add(v);
      onChange(Array.from(next).join(', '));
    };
    return (
      <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 6, padding: 8 }}>
        {options.length === 0 && <div style={{ opacity: 0.6, fontSize: 13 }}>No options available.</div>}
        {options.map((o) => {
          const optionValue = String(o[f.lookupValueKey ?? f.key] ?? o.id);
          const optionLabel = f.lookupLabelKey ? `${optionValue} — ${String(o[f.lookupLabelKey] ?? '')}` : optionValue;
          return (
            <label key={String(o.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
              <input type="checkbox" checked={selected.has(optionValue)} onChange={() => toggle(optionValue)} />
              {optionLabel}
            </label>
          );
        })}
      </div>
    );
  }
  if (f.type === 'lookup') {
    // De-duplicated by the stored value: a resource can legitimately hold
    // many rows sharing one code (Currency Management keeps a row per dated
    // rate, so USD appears once per rate change) and the dropdown should
    // still offer USD once.
    const options = dedupeByValue(lookupData[f.key] ?? [], f);
    const handleLookupChange = (v: string) => {
      let matchedForCallback: TextileRecord | undefined;
      setForm((prev) => {
        const next = { ...prev, [f.key]: v };
        const matched = options.find((o) => String(o[f.lookupValueKey ?? f.key] ?? o.id) === v);
        matchedForCallback = matched;
        if (f.autoFillMap && matched) {
          for (const [sourceKey, destKey] of Object.entries(f.autoFillMap)) {
            const sourceValue = matched[sourceKey];
            if (sourceValue !== undefined && sourceValue !== null && sourceValue !== '') next[destKey] = String(sourceValue);
          }
        }
        applyRegenerateOn(f.key, next, fields);
        return next;
      });
      // Runs after the synchronous autoFillMap copy above. Kept outside
      // setForm's updater since it may be async (e.g. an API call) and
      // updaters must stay synchronous and pure.
      if (f.onLookupChange && matchedForCallback) f.onLookupChange(matchedForCallback, setForm, setDynamicOptions);
      f.onValueChangeAsync?.(v, form, setForm);
    };
    return (
      <SearchableLookup
        value={value}
        required={f.required}
        options={options}
        valueKey={f.lookupValueKey ?? f.key}
        labelKey={f.lookupLabelKey}
        onChange={handleLookupChange}
      />
    );
  }
  if (f.type === 'select') {
    const options = f.dynamicOptionsKey ? dynamicOptions[f.dynamicOptionsKey] ?? [] : (f.options ?? []).map((option) => ({ value: option, label: option }));
    return (
      <select required={f.required} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }
  if (f.type === 'textarea') {
    return <textarea required={f.required} value={value} placeholder={f.placeholder} rows={3} onChange={(e) => onChange(e.target.value)} />;
  }
  if (f.type === 'date') {
    return <input type="date" required={f.required} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (f.type === 'number') {
    return <input type="number" required={f.required} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input type="text" required={f.required} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
}
