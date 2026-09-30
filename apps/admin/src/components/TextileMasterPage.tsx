// FILE: admin/src/components/TextileMasterPage.tsx
import { CSSProperties, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
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

export type FieldType = 'text' | 'number' | 'select' | 'combo' | 'date' | 'textarea' | 'lookup' | 'multi-lookup' | 'file';
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
  /** small grey hint shown under the field in the Add/Edit form (not in the list or detail view) */
  helpText?: string;
  /** groups fields under a <fieldset> legend; omit for the ungrouped top section */
  group?: string;
  /** show this field as a column in the list table */
  listColumn?: boolean;
  /** format a value for table/detail display */
  format?: (value: unknown, record: TextileRecord) => string;
  /** optional rich cell for the list table only (badges, stacked text); falls back to `format` */
  render?: (value: unknown, record: TextileRecord) => ReactNode;
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
  /**
   * for type: 'lookup' — opt-in. Sends the active Industry Type with the lookup request so only that
   * industry's records are offered (already automatic for '/clients'). Use for '/products' lookups,
   * which otherwise return every industry's products to an admin login.
   */
  industryScoped?: boolean;
    /** for type: 'lookup' — which field on the looked-up record to show as the label */
  lookupLabelKey?: string;
  /**
   * for type: 'lookup' — an extra field on the looked-up record shown
   * alongside `lookupLabelKey`, e.g. the client's code next to their name
   * ("Dharshiha irons — CLI-2609-00038"), so two similarly-named records
   * are still easy to tell apart.
   */
  lookupSecondaryLabelKey?: string;
  /**
   * for type: 'multi-lookup' — keeps only the options that belong with the current form (e.g. only the
   * documents of the selected shipment). Runs on every render, so it follows the form as it changes.
   */
  lookupFilter?: (option: TextileRecord, form: Record<string, string>) => boolean;
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
   * for type: 'file' — the Supabase Storage bucket the file uploads into.
   * Must already exist (created once in the Supabase dashboard). The field's
   * stored value becomes the uploaded file's public URL.
   */
  fileBucket?: string;
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
  /** Optional, off by default. Wider Add/Edit panel with a multi-column grid so a short form fits on one screen. */
  wideForm?: boolean;
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
  /**
   * Optional, off by default. When set, the ⋮ menu gets a "Duplicate" item that opens the
   * Add form with the values returned here pre-filled. Auto-generated fields (e.g. the
   * enquiry number) are always re-generated fresh, never copied.
   */
  duplicateFrom?: (record: TextileRecord) => Record<string, string>;
  /**
   * Optional. Lets ONE save create several records: return one override object per
   * record to create (e.g. [{ supplier_name: 'A' }, { supplier_name: 'B' }]). The
   * auto-generated number is regenerated for each. `isEditing` is true when editing an
   * existing record — return a single item then. Throw an Error(message) to block the
   * save and show that message in the form.
   */
  submitVariants?: (form: Record<string, string>, isEditing: boolean) => Array<Record<string, string>>;
  /** extra buttons rendered in the list table's Actions cell, alongside View/Edit/Delete */
  rowActions?: (record: TextileRecord) => ReactNode;
  /**
   * Optional, off by default. Extra content shown directly in the Actions cell,
   * always visible next to the ⋮ menu (instead of hidden inside it).
   */
  inlineActions?: (record: TextileRecord) => ReactNode;
  /**
   * Optional, off by default. When true the list table shrinks to fit the screen
   * (headers wrap, tighter padding) so every column up to Actions is visible
   * without scrolling sideways.
   */
  fitToScreen?: boolean;
  /**
   * Optional, off by default. When true the View dialog decides which conditional fields
   * (those with `visibleIf`) to show from the opened record's own values. Without it the
   * dialog evaluates `visibleIf` against the Add/Edit form's leftover state, so fields that
   * depend on another field (e.g. Price List's rate type) can go missing.
   */
  detailVisibilityFromRecord?: boolean;
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

// Status colours. One shared function, so every module (Textile, Pharma, Trading) gets the same meaning:
//   green = finished / good, red = cancelled / bad, amber = needs attention,
//   blue = on the move, grey = not started yet (anything not listed here).
const GOOD_STATUSES = new Set(['active', 'in-stock', 'pass', 'approved', 'completed', 'in stock', 'delivered']);
const BAD_STATUSES = new Set(['inactive', 'damaged', 'fail', 'rejected', 'discontinued', 'reject', 'cancelled', 'canceled']);
const WATCH_STATUSES = new Set(['pending', 'issued', 'draft', 'revision-requested', 'sold', 'delayed', 'customs hold']);
const MOVING_STATUSES = new Set(['pickup scheduled', 'picked up', 'dispatched', 'in transit', 'at destination', 'out for delivery']);

function statusBadgeClass(status?: string): string {
  const s = (status ?? '').trim().toLowerCase();
  if (GOOD_STATUSES.has(s)) return 'status-badge status-completed';
  if (BAD_STATUSES.has(s)) return 'status-badge inactive';
  if (WATCH_STATUSES.has(s)) return 'status-badge status-quoted';
  if (MOVING_STATUSES.has(s)) return 'status-badge status-new';
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
        const needsIndustryScope = base.startsWith('/clients') || Boolean(f.industryScoped);
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

  function openCreate(prefill?: Record<string, string>) {
    setEditing(null);
    const blank = blankFormFrom(fields);
    const year = new Date().getFullYear();
    const seq = String(records.length + 1).padStart(4, '0');
    const sequenceLabel = `${year}-${seq}`;
    blank.__seq = sequenceLabel;
    for (const f of fields) {
      if (f.autoGenerate) blank[f.key] = resolveAutoGenerate(f, blank, sequenceLabel);
    }
    if (prefill) {
      for (const f of fields) {
        if (f.autoGenerate) continue; // numbers are always fresh
        const v = prefill[f.key];
        if (v != null && v !== '') blank[f.key] = v;
      }
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
      // Optional: a module can turn ONE save into several records (e.g. one Purchase
      // Enquiry per ticked supplier). Each variant overrides some form values; the
      // auto-generated number is re-generated for every extra record. Without the
      // hook this is a single record, exactly as before.
      let variants: Array<Record<string, string>> = [{}];
      if (config.submitVariants) {
        variants = config.submitVariants(form, Boolean(editing));
        if (!variants.length) variants = [{}];
      }
      const created: TextileRecord[] = [];
      const failures: string[] = [];
      let lastRes: { data: TextileRecord } | undefined;
      // Same running counter openCreate() used: records.length + 1 is the form's own number.
      let seqCursor = records.length + 1;
      for (let vi = 0; vi < variants.length; vi += 1) {
        const values: Record<string, string> = { ...form, ...variants[vi] };
        const generate = () => {
          const sequenceLabel = `${new Date().getFullYear()}-${String(seqCursor).padStart(4, '0')}`;
          for (const f of fields) {
            if (f.autoGenerate) values[f.key] = resolveAutoGenerate(f, values, sequenceLabel);
          }
        };
        if (vi > 0) { seqCursor += 1; generate(); }
        const payload: Record<string, unknown> = {};
        for (const f of fields) {
          const raw = values[f.key];
          if (raw === '' || raw == null) { payload[f.key] = null; continue; }
          payload[f.key] = f.type === 'number' ? Number(raw) : raw;
        }
        // Records are always created under the currently active industry —
        // never a user-editable field, so a locked user can't tag a record
        // into another industry even by tampering with the form payload.
        if (!editing && activeIndustryTypeId) payload.industry_type_id = activeIndustryTypeId;
        try {
          let res: { data: TextileRecord } | undefined;
          for (let attempt = 0; ; attempt += 1) {
            try {
              res = await api<{ data: TextileRecord }>(editing ? `${resource}/${editing.id}` : resource, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
              break;
            } catch (caught) {
              const code = (caught as { code?: string } | null)?.code;
              const canRetry = !editing && code === 'DUPLICATE_RECORD' && fields.some((f) => f.autoGenerate) && attempt < 3;
              if (!canRetry) throw caught;
              seqCursor += 1;
              generate();
              for (const f of fields) {
                if (f.autoGenerate) payload[f.key] = values[f.key];
              }
              if (variants.length === 1) setForm((prev) => ({ ...prev, ...Object.fromEntries(fields.filter((f) => f.autoGenerate).map((f) => [f.key, values[f.key]])) }));
            }
          }
          lastRes = res;
          created.push(res!.data);
        } catch (caught) {
          // A single save keeps the old behaviour: show the error in the form.
          if (variants.length === 1) throw caught;
          const who = variants[vi].supplier_name || `#${vi + 1}`;
          failures.push(`${who}: ${caught instanceof Error ? caught.message : 'failed'}`);
        }
      }
      if (variants.length > 1) {
        setModal(false);
        setMessage(
          failures.length
            ? `Created ${created.length} of ${variants.length} records. Not created — ${failures.join('; ')}`
            : `${created.length} ${title.toLowerCase()} records added successfully.`,
        );
        await load();
        for (const rec of created) afterSave?.(rec, load);
        return;
      }
      const res = lastRes;
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
const listColumns = fields.filter((f) => f.listColumn && !(f.key === 'status' && (inlineStatus || !hideStatusColumn)));

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
        <button className="primary-action" type="button" onClick={() => openCreate()}>
          + Add {title.toLowerCase().replace(/ management$/i, '')}
        </button>
      </div>

            {error && !usingDemoData && <p className="error-message">{error}</p>}
      {usingDemoData && <p className="demo-data-banner">Showing sample data for preview — this is a UI-only demo, nothing here is saved.</p>}
      {message && <p className={message.includes('successfully') ? 'success-message' : 'error-message'}>{message}</p>}
  {loading ? (
        <div className={`data-table-wrap${config.fitToScreen ? ' data-table-fit' : ''}`}>
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
        <div className={`data-table-wrap${config.fitToScreen ? ' data-table-fit' : ''}`}>
          <table>
            <thead><tr>{listColumns.map((c) => <th key={c.key}>{c.label}</th>)}{!hideStatusColumn && <th>Status</th>}<th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  {listColumns.map((c) => (
              <td key={c.key}>{c.render ? c.render(r[c.key], r) : c.format ? c.format(r[c.key], r) : (r[c.key] != null && r[c.key] !== '' ? String(r[c.key]) : '—')}</td>
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
                   <div className="master-actions-inner">
                    {config.inlineActions?.(r)}
                    <RowActionsMenu
                      label={String(r[nameField] ?? r[codeField] ?? '')}
                      onView={() => setViewing(r)}
                      onEdit={() => openEdit(r)}
                      onDuplicate={config.duplicateFrom ? () => openCreate(config.duplicateFrom!(r)) : undefined}
                      onDelete={() => { setDeleteError(''); setDeleting(r); }}
                      deleteDisabled={usingDemoData}
                      deleteTitle={usingDemoData ? 'Sample row — add a real record to enable delete' : 'Delete'}
                      extra={config.rowActions?.(r)}
                    />
                   </div>
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
                        <button type="button" className="primary-action" onClick={() => openCreate()}>+ Add {title.toLowerCase().replace(/ management$/i, '')}</button>
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
                <h3>{String(viewing[nameField] ?? viewing[codeField] ?? 'Record')}{viewing.status ? <span className={statusBadgeClass(viewing.status)}>{String(viewing.status)}</span> : null}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setViewing(null)}>×</button>
            </div>
            <div className="dd-body">
              {(() => {
                const isEmpty = (v: unknown) => v == null || v === '';
                const shown = (f: FieldDef) => f.format || f.required || f.listColumn || !isEmpty(viewing[f.key]);
                const valueOf = (f: FieldDef) => {
                  if (f.format) { try { return f.format(viewing[f.key], viewing); } catch { return '—'; } }
                  if (f.type === 'date') return dateLabel(viewing[f.key]);
                  return isEmpty(viewing[f.key]) ? '—' : String(viewing[f.key]);
                };
                const renderItems = (list: FieldDef[]) => list.filter(shown).map((f) => {
                  const v = valueOf(f);
                  return (
                    <div className="dd-item" key={f.key}>
                      <dt>{f.label}</dt>
                      <dd className={v === '—' ? 'dd-muted' : undefined}>{v}</dd>
                    </div>
                  );
                });
                // Default: same groups as the Add/Edit form. Opt-in (config.detailVisibilityFromRecord):
                // evaluate `visibleIf` against THIS record instead.
                let viewUngrouped = ungrouped;
                let viewGroups = groups;
                let viewGroupNames = groupNames;
                if (config.detailVisibilityFromRecord) {
                  const asForm: Record<string, string> = {};
                  for (const f of fields) asForm[f.key] = viewing[f.key] != null ? String(viewing[f.key]) : '';
                  const byGroup = new Map<string | undefined, FieldDef[]>();
                  for (const f of fields) {
                    if (f.visibleIf && !f.visibleIf(asForm)) continue;
                    if (!byGroup.has(f.group)) byGroup.set(f.group, []);
                    byGroup.get(f.group)!.push(f);
                  }
                  viewGroups = byGroup;
                  viewUngrouped = byGroup.get(undefined) ?? [];
                  viewGroupNames = [...byGroup.keys()].filter((k): k is string => Boolean(k));
                }
                return (
                  <>
                    <section className="dd-card">
                      <h4 className="dd-card-title">Overview</h4>
                      <dl className="dd-grid">
                        {renderItems(viewUngrouped)}
                        <div className="dd-item"><dt>Added on</dt><dd>{dateLabel(viewing.created_at)}</dd></div>
                      </dl>
                    </section>
                    {viewGroupNames.map((g) => {
                      const items = renderItems(viewGroups.get(g)!);
                      if (items.length === 0) return null;
                      return (
                        <section className="dd-card" key={g}>
                          <h4 className="dd-card-title">{g}</h4>
                          <dl className="dd-grid">{items}</dl>
                        </section>
                      );
                    })}
                  </>
                );
              })()}
              {config.detailExtra?.(viewing)}
            </div>
            <div className="modal-actions dd-footer">
              <button type="button" className="quiet-button" onClick={() => { const r = viewing; setViewing(null); openEdit(r); }}>Edit</button>
              {config.detailActions?.(viewing)}
              <button type="button" className="primary-action" onClick={() => setViewing(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setModal(false)}>
          <div className={`master-modal${config.wideForm ? ' master-modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="textile-modal-title" onMouseDown={(e) => e.stopPropagation()}>
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
                    {f.helpText && <small style={{ display: 'block', marginTop: 4, fontSize: 12, fontWeight: 400, color: '#64748b' }}>{f.helpText}</small>}
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
                        {f.helpText && <small style={{ display: 'block', marginTop: 4, fontSize: 12, fontWeight: 400, color: '#64748b' }}>{f.helpText}</small>}
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

/**
 * Compact 3-dot ("⋮") menu for a table row's actions — replaces what used
 * to be 3-4 separate icon buttons (View, Edit, Delete, plus any page-
 * specific extras like "Send" or "Generate document") sitting side by
 * side. Those buttons together made the Actions column wide enough that
 * many list pages needed horizontal scrolling just to see everything.
 * One narrow button here, with the same options inside a popup menu,
 * fixes that everywhere at once since every list page shares this file.
 * Same open/close-on-outside-click pattern as SearchableLookup above.
 */
// NEW
function RowActionsMenu({
  label,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
  deleteDisabled,
  deleteTitle,
  extra,
}: {
  label: string;
  onView: () => void;
  onEdit: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  deleteTitle?: string;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; openUpward: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleReposition() { setOpen(false); }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const estimatedMenuHeight = 160;
      const estimatedMenuWidth = 160;
      const openUpward = window.innerHeight - rect.bottom < estimatedMenuHeight && rect.top > window.innerHeight - rect.bottom;
      setCoords({
        top: openUpward ? rect.top - 4 : rect.bottom + 4,
        left: Math.max(4, rect.right - estimatedMenuWidth),
        openUpward,
      });
    }
    setOpen((prev) => !prev);
  };

  const itemStyle: CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 12px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    borderRadius: 4,
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-action"
        title="More actions"
        aria-label={`Actions for ${label}`}
        onClick={toggleOpen}
      >
        ⋮
      </button>
      {open && coords && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            zIndex: 1000,
            top: coords.openUpward ? undefined : coords.top,
            bottom: coords.openUpward ? window.innerHeight - coords.top : undefined,
            left: coords.left,
            minWidth: 160,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 6,
            boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
            padding: 4,
          }}
        >
          <button type="button" style={itemStyle} onClick={() => { setOpen(false); onView(); }}>◉ View</button>
          <button type="button" style={itemStyle} onClick={() => { setOpen(false); onEdit(); }}>✎ Edit</button>
          {onDuplicate && <button type="button" style={itemStyle} onClick={() => { setOpen(false); onDuplicate(); }}>⧉ Duplicate</button>}
            {extra && <div className="row-actions-menu-extra">{extra}</div>}
          {onDelete && (
            <button
              type="button"
              style={{ ...itemStyle, color: '#c0392b' }}
              disabled={deleteDisabled}
              title={deleteTitle}
              onClick={() => { setOpen(false); onDelete(); }}
            >
              🗑 Delete
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
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
  secondaryLabelKey,
  onChange,
}: {
  value: string;
  required?: boolean;
  options: TextileRecord[];
  valueKey?: string;
  labelKey?: string;
  secondaryLabelKey?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const getValue = (o: TextileRecord) => String(o[valueKey ?? 'id'] ?? o.id);
  // labelKey can be a nested path like 'user_profiles.display_name' for
  // lookups whose display name lives inside a joined record.
  const resolvePath = (o: TextileRecord, path: string) =>
    path.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), o);
  const getLabel = (o: TextileRecord) => {
    if (!labelKey) return getValue(o);
    const label = resolvePath(o, labelKey);
    const primary = label ? String(label) : getValue(o);
    if (!secondaryLabelKey) return primary;
    const secondary = resolvePath(o, secondaryLabelKey);
    return secondary ? `${primary} — ${String(secondary)}` : primary;
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

// Professional multi-select checklist (search, count, clear, tidy rows).
// Value is stored as a comma-separated string, same as before.
function MultiLookupField({ options, value, onChange, valueKey, labelKey, secondaryKey }: {
  options: TextileRecord[];
  value: string;
  onChange: (next: string) => void;
  valueKey: string;
  labelKey?: string;
  secondaryKey?: string;
}) {
  const [search, setSearch] = useState('');
  // Names are compared trimmed and case-insensitively, so a stray space or different
  // capital letter in a stored name can never make the tick, the "N selected" count and
  // the saved value disagree with each other.
  const norm = (text: string) => text.trim().toLowerCase();
  const selectedKeys = new Set(value.split(',').map(norm).filter(Boolean));

  // One row per stored value (some sources hold several rows with the same value).
  const seen = new Set<string>();
  const rows: { id: string; value: string; sub: string }[] = [];
  for (const o of options) {
    const rowValue = String(o[valueKey] ?? o.id).trim();
    if (!rowValue || seen.has(norm(rowValue))) continue;
    seen.add(norm(rowValue));
    const main = labelKey ? String(o[labelKey] ?? '') : '';
    const extra = secondaryKey ? String(o[secondaryKey] ?? '') : '';
    rows.push({ id: String(o.id), value: rowValue, sub: [extra, main].filter(Boolean).join(' · ') });
  }
  const tickedCount = rows.filter((r) => selectedKeys.has(norm(r.value))).length;

  const term = search.trim().toLowerCase();
  const visible = term ? rows.filter((r) => r.value.toLowerCase().includes(term) || r.sub.toLowerCase().includes(term)) : rows;

  const toggle = (v: string) => {
    const nextKeys = new Set(selectedKeys);
    if (nextKeys.has(norm(v))) nextKeys.delete(norm(v)); else nextKeys.add(norm(v));
    // Rebuilt from the visible list so the saved value only ever contains names that are ticked.
    onChange(rows.filter((r) => nextKeys.has(norm(r.value))).map((r) => r.value).join(', '));
  };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
        {rows.length > 5 && (
          <input
            type="search"
            value={search}
            placeholder="Search…"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}
            style={{ flex: 1, minWidth: 0, padding: '6px 10px', fontSize: 13 }}
          />
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
          {tickedCount} selected
        </span>
        {tickedCount > 0 && (
          <button type="button" onClick={() => onChange('')} style={{ border: 'none', background: 'none', color: '#2563eb', fontSize: 12, cursor: 'pointer', padding: 0 }}>
            Clear
          </button>
        )}
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', padding: 6 }}>
        {rows.length === 0 && <div style={{ padding: '14px 10px', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>No options available yet.</div>}
        {rows.length > 0 && visible.length === 0 && <div style={{ padding: '14px 10px', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>No matches.</div>}
        {visible.map((row) => {
          const isOn = selectedKeys.has(norm(row.value));
          // A div (not a <label>) because this list sits inside the form field's own <label>;
          // nested labels can fire a second click on the first checkbox. preventDefault stops that.
          return (
            <div
              key={row.id}
              role="checkbox"
              aria-checked={isOn}
              tabIndex={0}
              onClick={(event) => { event.preventDefault(); toggle(row.value); }}
              onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(row.value); } }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: isOn ? '#eef2ff' : 'transparent' }}
            >
              <input
                type="checkbox"
                checked={isOn}
                readOnly
                tabIndex={-1}
                aria-hidden="true"
                style={{ pointerEvents: 'none', width: 16, height: 16, flex: '0 0 16px', margin: 0, padding: 0, border: 'none', boxShadow: 'none', background: 'none', accentColor: '#1e293b' }}
              />
              <span style={{ fontSize: 14, fontWeight: isOn ? 600 : 500, color: '#0f172a' }}>{row.value}</span>
              {row.sub && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b', fontFamily: 'var(--font-mono, monospace)' }}>{row.sub}</span>}
            </div>
          );
        })}
      </div>
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
    // Computed fields (gross/net amount, margin...) are never stored, so their
    // form value is empty. When the field defines a `format`, show the live
    // computed value from the other fields in the form instead.
    let shown = value;
    if (f.format) {
      try {
        shown = f.format(value, form as unknown as TextileRecord);
      } catch {
        shown = value;
      }
    }
    return <input type="text" value={shown} readOnly disabled />;
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
    return (
      <MultiLookupField
        options={f.lookupFilter ? (lookupData[f.key] ?? []).filter((o) => f.lookupFilter!(o, form)) : (lookupData[f.key] ?? [])}
        value={value}
        onChange={onChange}
        valueKey={f.lookupValueKey ?? f.key}
        labelKey={f.lookupLabelKey}
        secondaryKey={f.lookupSecondaryLabelKey}
      />
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
        secondaryLabelKey={f.lookupSecondaryLabelKey}
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
 // NEW
  if (f.type === 'number') {
    return <input type="number" required={f.required} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  if (f.type === 'file') {
    return <FileUploadField value={value} required={f.required} bucket={f.fileBucket ?? 'trade-documents'} onChange={onChange} />;
  }
  return <input type="text" required={f.required} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function FileUploadField({
  value,
  required,
  bucket,
  onChange,
}: {
  value: string;
  required?: boolean;
  bucket: string;
  onChange: (v: string) => void;
}) {
  const { activeIndustry } = useIndustry();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!supabase) { setError('File storage is not configured for this environment.'); return; }
    setUploading(true);
    setError('');
    try {
      const orgId = (import.meta.env.VITE_ORGANIZATION_ID as string | undefined) ?? 'org';
      const path = `${orgId}/${activeIndustry}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      {value && (
        <div style={{ marginBottom: 6, fontSize: 13 }}>
          <a href={value} target="_blank" rel="noreferrer">View current file</a> — choose a file below to replace it.
        </div>
      )}
      <input
        type="file"
        required={required && !value}
        disabled={uploading}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {uploading && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Uploading…</div>}
      {error && <div style={{ fontSize: 12, color: '#c0392b', marginTop: 4 }}>{error}</div>}
    </div>
  );
}