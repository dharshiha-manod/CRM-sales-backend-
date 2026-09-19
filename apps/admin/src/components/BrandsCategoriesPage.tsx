import { useState } from 'react';
import './MasterDataPages.css';
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

type ListSection = { key: string; title: string; description: string; placeholder: string };

function NameListEditor({ section }: { section: ListSection }) {
  const [items, setItems] = useState<string[]>(() => loadNameList(section.key));
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  function addItem() {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (items.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" already exists.`);
      return;
    }
    const next = [...items, trimmed].sort();
    setItems(next);
    saveNameList(section.key, next);
    setInput('');
    setError('');
  }

  function removeItem(name: string) {
    if (!window.confirm(`Remove "${name}"? Products already using it keep their existing value.`)) return;
    const next = items.filter((item) => item !== name);
    setItems(next);
    saveNameList(section.key, next);
  }

  return (
    <div className="page-panel master-page" style={{ marginBottom: '1.5rem' }}>
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">PRODUCT CATALOG</p>
          <h2>{section.title}</h2>
          <p>{section.description}</p>
        </div>
      </div>
      <div className="master-toolbar">
        <div className="master-search" style={{ gap: '.5rem' }}>
          <input
            placeholder={section.placeholder}
            value={input}
            onChange={(event) => { setInput(event.target.value); setError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem(); } }}
          />
          <button type="button" className="primary-action" onClick={addItem}>+ Add</button>
        </div>
      </div>
      {error && <p className="error-message">{error}</p>}
      {items.length === 0 ? (
        <div className="empty-state empty-state-lg">
          <div className="empty-state-icon">▣</div>
          <p><strong>No {section.title.toLowerCase()} yet</strong><br />Add one above to make it available on the Add Product form.</p>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead><tr><th>{section.title.slice(0, -1)} name</th><th>Actions</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item}>
                  <td>{item}</td>
                  <td className="master-actions">
                    <button type="button" className="quiet-button" onClick={() => removeItem(item)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
export function BrandsCategoriesPage() {
  const { activeIndustry } = useIndustry();
  const examples = PLACEHOLDER_EXAMPLES[activeIndustry];
  const sections: ListSection[] = [
    { key: brandListKey(activeIndustry), title: 'Brands', description: 'Manage the brand names available when adding a product.', placeholder: examples.brand },
    { key: categoryListKey(activeIndustry), title: 'Categories', description: 'Manage the categories available when adding a product.', placeholder: examples.category },
    { key: unitListKey(activeIndustry), title: 'Units', description: 'Manage the units of measure available when adding a product.', placeholder: examples.unit },
  ];
  return (
    <section>
      {sections.map((section) => (
        // key includes the industry (via section.key) so switching Industry
        // Type remounts each editor fresh, reloading that industry's own list
        // instead of showing stale items left over from the previous one.
        <NameListEditor key={section.key} section={section} />
      ))}
    </section>
  );
}
