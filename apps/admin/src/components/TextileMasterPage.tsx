import { CSSProperties, FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { useIndustry } from '../industry/IndustryContext';
import './MasterDataPages.css';
/**
 * One config-driven page powers every Textile module (Design & Pattern,
 * Colour & Size, Fabric Roll, Textile Sample, Quality & Inspection).
 * Add a new module by adding a config in textileModules.ts — never
 * duplicate this file. Backed by real Postgres tables (see the
 * migration under apps/api), not localStorage or jsonb blobs.
 */

export type FieldType = 'text' | 'number' | 'select' | 'date' | 'textarea' | 'lookup' | 'multi-lookup';
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
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
  /** prefix used to auto-generate this field's value on create, e.g. 'DSN' -> DSN-2026-0007 */
  autoGenerate?: string;
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
onLookupChange?: (matched: TextileRecord, setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void) => void;
  visibleIf?: (form: Record<string, string>) => boolean;
  onValueChange?: (value: string, form: Record<string, string>) => Record<string, string> | void;
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
  /**
   * Front-end-only preview rows shown when there's nothing real to display yet
   * (empty table, or the API/route isn't wired up). Never sent to the API —
   * View works, Edit is disabled. Give each an id starting with 'demo-'.
   */
  sampleRecords?: TextileRecord[];
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

function dateLabel(value: unknown): string {
  if (!value || typeof value !== 'string') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

export function TextileMasterPage({ config }: { config: TextileModuleConfig }) {
  const { resource, eyebrowModule, title, description, icon, emptyIcon, codeField, nameField, statusOptions, fields, searchableKeys, kpis, statusFilterable = true, sampleRecords } = config;
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
  const [lookupData, setLookupData] = useState<Record<string, TextileRecord[]>>({});
  const [deleting, setDeleting] = useState<TextileRecord | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
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
      setRecords(res.data ?? []);
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
    for (const f of fields) {
      if (f.autoGenerate) {
        const year = new Date().getFullYear();
        const seq = String(records.length + 1).padStart(4, '0');
        blank[f.key] = `${f.autoGenerate}-${year}-${seq}`;
      }
    }
    setForm(blank);
    setFormMessage('');
    setModal(true);
  }
  function openEdit(record: TextileRecord) {
    setEditing(record);
    const next: Record<string, string> = {};
    for (const f of fields) next[f.key] = record[f.key] != null ? String(record[f.key]) : '';
    setForm(next);
    setFormMessage('');
    setModal(true);
  }

// NEW
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormMessage('');
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
      await api(editing ? `${resource}/${editing.id}` : resource, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setModal(false);
      setMessage(editing ? `${title} record updated successfully.` : `${title} record added successfully.`);
      await load();
    } catch (caught) {
      setFormMessage(caught instanceof Error ? caught.message : 'Unable to save this record.');
    } finally {
      setSaving(false);
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

  const listColumns = fields.filter((f) => f.listColumn);

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
            <thead><tr>{listColumns.map((c) => <th key={c.key}>{c.label}</th>)}<th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {[0, 1, 2].map((i) => (
                <tr key={i} className="skeleton-row">
                  {listColumns.map((c) => <td key={c.key}><span className="skeleton-block" style={{ width: '60%' }} /></td>)}
                  <td><span className="skeleton-block" style={{ width: '50%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '40%' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead><tr>{listColumns.map((c) => <th key={c.key}>{c.label}</th>)}<th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  {listColumns.map((c) => (
                    <td key={c.key}>{c.format ? c.format(r[c.key], r) : (r[c.key] != null && r[c.key] !== '' ? String(r[c.key]) : '—')}</td>
                  ))}
                  <td><span className={statusBadgeClass(r.status)}>{r.status ?? '—'}</span></td>
                  <td className="master-actions">
                    <button type="button" className="icon-action" title="View" aria-label={`View ${String(r[nameField] ?? r[codeField] ?? '')}`} onClick={() => setViewing(r)}>◉</button>
                    <button type="button" className="icon-action" title="Edit" aria-label={`Edit ${String(r[nameField] ?? r[codeField] ?? '')}`} onClick={() => openEdit(r)}>✎</button>
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
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => { const r = viewing; setViewing(null); openEdit(r); }}>Edit</button>
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
              <div className="field-grid">
                          {ungrouped.map((f) => (
                  <label key={f.key}>
                    {f.label}{f.required ? ' *' : ''}
                    {renderInput(f, form, setForm, lookupData)}
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
                        {renderInput(f, form, setForm, lookupData)}
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

function renderInput(f: FieldDef, form: Record<string, string>, setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void, lookupData: Record<string, TextileRecord[]> = {}) {
 const value = form[f.key] ?? '';
  const onChange = (v: string) => setForm((prev) => {
    const next = { ...prev, [f.key]: v };
    if (f.onValueChange) {
      const patch = f.onValueChange(v, next);
      if (patch) Object.assign(next, patch);
    }
    return next;
  });
  if (f.readOnly) {
    return <input type="text" value={value} readOnly disabled />;
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
    const options = lookupData[f.key] ?? [];
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
        return next;
      });
      // Runs after the synchronous autoFillMap copy above. Kept outside
      // setForm's updater since it may be async (e.g. an API call) and
      // updaters must stay synchronous and pure.
      if (f.onLookupChange && matchedForCallback) f.onLookupChange(matchedForCallback, setForm);
    };
    return (
      <select required={f.required} value={value} onChange={(e) => handleLookupChange(e.target.value)}>
        <option value="">Select…</option>
        {options.map((o) => {
                  const optionValue = String(o[f.lookupValueKey ?? f.key] ?? o.id);
          const optionLabel = f.lookupLabelKey ? `${optionValue} — ${String(o[f.lookupLabelKey] ?? '')}` : optionValue;
          return <option key={String(o.id)} value={optionValue}>{optionLabel}</option>;
        })}
      </select>
    );
  }
  if (f.type === 'select') {
    return (
      <select required={f.required} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
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