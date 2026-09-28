import { useState } from 'react';
import './MasterDataPages.css';
import './BrandsCategoriesPage.css';
import { useIndustry } from '../industry/IndustryContext';
import type { IndustryKey } from '../industry/types';

// Example placeholder text shown in each list's input, per Industry Type —
// so Textile shows a fabric/textile-style example instead of the FMCG
// examples ("Nestle", "Beverages") that used to show for every industry.
const PLACEHOLDER_EXAMPLES: Record<IndustryKey, { brand: string; category: string; unit: string }> = {
  fmcg: { brand: 'e.g. Nestle', category: 'e.g. Beverages', unit: 'e.g. Carton' },
  school: { brand: 'e.g. Camlin', category: 'e.g. Stationery', unit: 'e.g. Set' },
  textile: { brand: 'e.g. Raymond', category: 'e.g. Fabric', unit: 'e.g. Meter' },
  pharma: { brand: 'e.g. Cipla', category: 'e.g. Tablets', unit: 'e.g. Strip' },
  trading: { brand: 'e.g. Tata Steel', category: 'e.g. Hardware', unit: 'e.g. Bundle' },
  vehicle: { brand: 'e.g. Maruti Suzuki', category: 'e.g. Sedan', unit: 'e.g. Unit' },
};

// Standalone master lists for Brand / Category / Unit — created here,
// independently of any product, so they can be picked from a dropdown on
// the Add Product form before any product uses them. Stored client-side
// (same localStorage pattern ProductsPage already uses for FMCG fields)
// until real backend tables exist for these.
//
// Each list is scoped per Industry Type (key includes the active industry)
// so switching Industry Type shows that industry's own brands/categories/
// units instead of one list shared — and leaking — across every industry.
const BRAND_LIST_BASE = 'fs-brand-list';
const CATEGORY_LIST_BASE = 'fs-category-list';
const UNIT_LIST_BASE = 'fs-unit-list';

// Pre-scoping keys. Data saved here was really FMCG data (the only industry
// this page supported at the time), so it's migrated into the 'fmcg' scoped
// key the first time that key is read, instead of being silently dropped.
const LEGACY_KEYS: Record<string, string> = {
  [BRAND_LIST_BASE]: 'fs-fmcg-brand-list',
  [CATEGORY_LIST_BASE]: 'fs-fmcg-category-list',
  [UNIT_LIST_BASE]: 'fs-fmcg-unit-list',
};

export function brandListKey(industry: string): string {
  return `${BRAND_LIST_BASE}:${industry}`;
}
export function categoryListKey(industry: string): string {
  return `${CATEGORY_LIST_BASE}:${industry}`;
}
export function unitListKey(industry: string): string {
  return `${UNIT_LIST_BASE}:${industry}`;
}

export function loadNameList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as string[];
    const [base, industry] = key.split(':');
    const legacyKey = LEGACY_KEYS[base];
    if (legacyKey && industry === 'fmcg') {
      const legacyRaw = window.localStorage.getItem(legacyKey);
      if (legacyRaw) {
        window.localStorage.setItem(key, legacyRaw);
        return JSON.parse(legacyRaw) as string[];
      }
    }
    return [];
  } catch {
    return [];
  }
}
export function saveNameList(key: string, list: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Best-effort.
  }
}

type ListKind = 'brand' | 'category' | 'unit';

const TABS: { kind: ListKind; title: string; singular: string; description: string }[] = [
  { kind: 'brand', title: 'Brands', singular: 'brand' },
  { kind: 'category', title: 'Categories', singular: 'category' },
  { kind: 'unit', title: 'Units', singular: 'unit' },
];

function keyFor(kind: ListKind, industry: string): string {
  if (kind === 'brand') return brandListKey(industry);
  if (kind === 'category') return categoryListKey(industry);
  return unitListKey(industry);
}

function BrandsCategoriesContent({ industry }: { industry: IndustryKey }) {
  const examples = PLACEHOLDER_EXAMPLES[industry];
  const [lists, setLists] = useState<Record<ListKind, string[]>>(() => ({
    brand: loadNameList(brandListKey(industry)),
    category: loadNameList(categoryListKey(industry)),
    unit: loadNameList(unitListKey(industry)),
  }));
  const [tab, setTab] = useState<ListKind>('brand');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const active = TABS.find((entry) => entry.kind === tab) ?? TABS[0];
  const items = lists[tab];

  function persist(kind: ListKind, next: string[]) {
    setLists((prev) => ({ ...prev, [kind]: next }));
    saveNameList(keyFor(kind, industry), next);
  }

  function selectTab(kind: ListKind) {
    setTab(kind);
    setInput('');
      setSearch('');
    setError('');
    setEditing(null);
    setEditValue('');
  }

  function addItem() {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (items.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" already exists.`);
      return;
    }
    persist(tab, [...items, trimmed].sort((a, b) => a.localeCompare(b)));
    setInput('');
    setError('');
  }

  function removeItem(name: string) {
    if (!window.confirm(`Remove "${name}"? Products already using it keep their existing value.`)) return;
    persist(tab, items.filter((item) => item !== name));
  }

  function startEdit(name: string) {
    setEditing(name);
    setEditValue(name);
    setError('');
  }

  function cancelEdit() {
    setEditing(null);
    setEditValue('');
    setError('');
  }

  function saveEdit() {
    if (editing === null) return;
    const trimmed = editValue.trim();
    if (!trimmed) { setError(`The ${active.singular} name can't be empty.`); return; }
    if (trimmed === editing) { cancelEdit(); return; }
    if (items.some((item) => item !== editing && item.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" already exists.`);
      return;
    }
    persist(tab, items.map((item) => (item === editing ? trimmed : item)).sort((a, b) => a.localeCompare(b)));
    cancelEdit();
  }

  const term = search.trim().toLowerCase();
  const visible = term ? items.filter((item) => item.toLowerCase().includes(term)) : items;

  return (
    <section className="bc-page">
      <div className="bc-header">
        <p className="bc-eyebrow">PRODUCT CATALOG</p>
        <h2>Brands, categories &amp; units</h2>
 
      </div>

      <div className="bc-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            role="tab"
            aria-selected={tab === entry.kind}
            className="bc-tab"
            onClick={() => selectTab(entry.kind)}
          >
            {entry.title}
            <span className="bc-tab-count">{lists[entry.kind].length}</span>
          </button>
        ))}
      </div>

      <div className="bc-section-head">
        <div>
          <h3>{active.title}</h3>
          <p>{active.description}</p>
        </div>
        <div className="bc-add">
          <input
            placeholder={examples[tab]}
            value={input}
            onChange={(event) => { setInput(event.target.value); setError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem(); } }}
          />
          <button type="button" onClick={addItem} disabled={!input.trim()}>+ Add {active.singular}</button>
        </div>
      </div>
      {error && <p className="bc-error">{error}</p>}

      {items.length === 0 ? (
        <div className="bc-empty">
          <strong>No {active.title.toLowerCase()} yet</strong>
          <span>Add your first {active.singular} above to use it on the Add Product form.</span>
        </div>
      ) : (
        <>
          {items.length > 6 && (
            <div className="bc-toolbar">
              <input
                type="search"
                className="bc-search"
                placeholder={`Search ${active.title.toLowerCase()}…`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <span className="bc-summary">Showing {visible.length} of {items.length}</span>
            </div>
          )}
          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead>
                <tr>
                  <th className="bc-col-index">#</th>
                  <th>{active.singular} name</th>
                  <th className="bc-col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item, index) => (
                              <tr key={item}>
                    <td className="bc-col-index">{index + 1}</td>
                    <td className="bc-col-name">
                      {editing === item ? (
                        <input
                          className="bc-edit-input"
                          autoFocus
                          value={editValue}
                          onChange={(event) => { setEditValue(event.target.value); setError(''); }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') { event.preventDefault(); saveEdit(); }
                            if (event.key === 'Escape') cancelEdit();
                          }}
                        />
                      ) : item}
                    </td>
                    <td className="bc-col-actions">
                      {editing === item ? (
                        <div className="bc-actions">
                          <button type="button" className="bc-save" onClick={saveEdit}>Save</button>
                          <button type="button" className="bc-edit" onClick={cancelEdit}>Cancel</button>
                        </div>
                      ) : (
                        <div className="bc-actions">
                          <button type="button" className="bc-edit" onClick={() => startEdit(item)}>Edit</button>
                          <button type="button" className="bc-remove" onClick={() => removeItem(item)}>Remove</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: '#8a8580' }}>No {active.title.toLowerCase()} match "{search}".</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function BrandsCategoriesPage() {
  const { activeIndustry } = useIndustry();
  // key = industry, so switching Industry Type remounts and reloads that
  // industry's own lists instead of showing stale items from the previous one.
  return <BrandsCategoriesContent key={activeIndustry} industry={activeIndustry} />;
}