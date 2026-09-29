// FILE: admin/src/components/TradingPriceRateListPage.tsx
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { localToday } from '../lib/priceListLookup';

const RATE_TYPES = ['Purchase Rate', 'Selling Rate', 'Wholesale Rate', 'Retail Rate', 'Customer-specific Rate', 'Supplier-specific Rate'];
const STATUSES = ['Active', 'Upcoming', 'Expired'];
// Same split the API uses (validatePriceList): these two types carry a purchase rate,
// every other type carries a selling rate.
const PURCHASE_SIDE_TYPES = ['Purchase Rate', 'Supplier-specific Rate'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function rateStatus(r: Record<string, unknown>): string {
  const today = localToday();
  const from = r.effective_from ? String(r.effective_from).slice(0, 10) : null;
  const to = r.effective_to ? String(r.effective_to).slice(0, 10) : null;
  if (to && to < today) return 'Expired';
  if (from && from > today) return 'Upcoming';
  return 'Active';
}

/** Whole days from today to a YYYY-MM-DD date (0 = today, negative = past). Null when there is no date. */
function daysUntil(value: unknown): number | null {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const [ty, tm, td] = localToday().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

/** "2026-09-30" -> "2026-10-01". Used so a copied rate starts the day after the old one ends. */
function nextDay(value: unknown): string {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

const STATUS_LABEL: Record<string, string> = { Active: '● Active', Upcoming: '◷ Upcoming', Expired: '○ Expired' };

function isPurchaseSide(r: Record<string, unknown>): boolean {
  return PURCHASE_SIDE_TYPES.includes(String(r.rate_type ?? ''));
}

/** 2026-09-29 -> "29 Sep 2026". Built by hand so it never shifts a day with the viewer's time zone. */
function dateText(value: unknown, empty = '—'): string {
  if (!value) return empty;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d || m > 12) return String(value);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

/** 300 -> "₹300" using the row's own currency, so a USD rate is never mistaken for a rupee rate. */
function moneyText(value: unknown, r: Record<string, unknown>): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const code = String(r.currency ?? '').trim().toUpperCase();
  if (!code) return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${code} ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
}

/** Two lines in one cell: "29 Sep 2026" then "→ 31 Mar 2027" (or "→ No end date"). Spaces are non-breaking so a date never splits. */
function periodText(r: Record<string, unknown>): string {
  const glue = (t: string) => t.replace(/ /g, '\u00A0');
  const from = r.effective_from ? glue(dateText(r.effective_from)) : 'No\u00A0start\u00A0date';
  const to = r.effective_to ? glue(dateText(r.effective_to)) : 'No\u00A0end\u00A0date';
  return `${from}\n→\u00A0${to}`;
}

function percentText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `${n}%` : '—';
}

/** One "Applies to" cell instead of separate Supplier and Customer columns (one of them is always empty). */
function appliesTo(r: Record<string, unknown>): string {
  const type = String(r.rate_type ?? '');
  if (type === 'Customer-specific Rate') return String(r.customer_name || '—');
  if (type === 'Supplier-specific Rate') return String(r.supplier_name || '—');
  return PURCHASE_SIDE_TYPES.includes(type) ? 'All suppliers' : 'All customers';
}

const config: TradingModuleConfig = {
  resource: '/trading/price-lists',
  eyebrowModule: 'PRICE LIST / RATE MANAGEMENT',
  title: 'Price list / rate management',
  description: 'Supplier purchase rates and customer selling rates, with an effective date range. Each change is a new record — history is kept, never overwritten.',
  icon: '₹',
  emptyIcon: '₹',
  codeField: 'product_code',
  nameField: 'product_name',
  statusOptions: STATUSES,
  statusFilterable: false,
  hideStatusColumn: true,
  // Every column, including Actions, fits the screen — no sideways scrolling.
  fitToScreen: true,
  // The View dialog decides which rate-type-specific fields to show from the opened record.
  detailVisibilityFromRecord: true,
  searchableKeys: ['product_name', 'product_code', 'supplier_name', 'customer_name'],
  // "Duplicate" in the row menu = copy as a NEW rate (history is kept, the old row is never touched).
  // The new rate starts the day after the old one ends; if the old one has no end date the start is left
  // blank and the API's overlap check will ask you to end the old rate first.
  duplicateFrom: (r) => ({
    product_name: String(r.product_name ?? ''),
    product_code: String(r.product_code ?? ''),
    rate_type: String(r.rate_type ?? ''),
    supplier_name: String(r.supplier_name ?? ''),
    customer_name: String(r.customer_name ?? ''),
    purchase_rate: String(r.purchase_rate ?? ''),
    selling_rate: String(r.selling_rate ?? ''),
    currency: String(r.currency ?? ''),
    unit: String(r.unit ?? ''),
    min_quantity: String(r.min_quantity ?? ''),
    tax: String(r.tax ?? ''),
    discount: String(r.discount ?? ''),
    notes: String(r.notes ?? ''),
    effective_from: r.effective_to ? nextDay(r.effective_to) : '',
  }),
  // Column order below is what the list shows, left to right. The CSS in MasterDataPages.css
  // (".price-list-page") styles the list by position, so keep the 10 list columns in this order:
  // 1 Product · 2 Code · 3 Rate type · 4 Applies to · 5 Purchase · 6 Selling · 7 Tax · 8 Discount
  // · 9 Effective period · 10 Validity (then Actions).
  fields: [
    { key: 'product_name', label: 'Product', type: 'lookup', required: true, lookupResource: '/products?status=active', industryScoped: true, lookupLabelKey: 'product_code', autoFillMap: { product_code: 'product_code', unit: 'unit', cost_price: 'purchase_rate', selling_price: 'selling_rate' }, listColumn: true },
    { key: 'product_code', label: 'Product code', type: 'text', readOnly: true, listColumn: true },
    { key: 'rate_type', label: 'Rate type', type: 'select', options: RATE_TYPES, required: true, listColumn: true, group: 'Rate' },
    // The two fields below only appear in the form for the matching rate type (visibleIf), so their
    // labels stay short. They are not list columns — "Applies to" further down replaces both.
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', group: 'Rate', visibleIf: (f) => f.rate_type === 'Supplier-specific Rate' },
    { key: 'customer_name', label: 'Customer', type: 'lookup', lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_code', group: 'Rate', visibleIf: (f) => f.rate_type === 'Customer-specific Rate' },
    // Display-only list column. Never shown in the form or dialog (visibleIf false) and never saved:
    // the API only keeps real table columns, same as the computed "Validity" column below.
    { key: 'applies_to', label: 'Applies to', type: 'text', readOnly: true, listColumn: true, visibleIf: () => false, format: (_v, r) => appliesTo(r) },
    { key: 'purchase_rate', label: 'Purchase rate', type: 'number', listColumn: true, group: 'Rate', visibleIf: (f) => f.rate_type === 'Purchase Rate' || f.rate_type === 'Supplier-specific Rate', format: (v, r) => (isPurchaseSide(r) ? moneyText(v, r) : '—') },
    { key: 'selling_rate', label: 'Selling rate', type: 'number', listColumn: true, group: 'Rate', visibleIf: (f) => !f.rate_type || f.rate_type === 'Selling Rate' || f.rate_type === 'Wholesale Rate' || f.rate_type === 'Retail Rate' || f.rate_type === 'Customer-specific Rate', format: (v, r) => (isPurchaseSide(r) ? '—' : moneyText(v, r)) },
    { key: 'currency', label: 'Currency', type: 'lookup', lookupResource: '/trading/currency-rates', lookupValueKey: 'currency_code', lookupLabelKey: 'currency_name', group: 'Rate' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Rate' },
    { key: 'min_quantity', label: 'Minimum quantity (rate applies from this quantity)', type: 'number', group: 'Rate', placeholder: 'e.g. 500 - leave blank for all quantities' },
    { key: 'tax', label: 'Tax (%)', type: 'number', listColumn: true, group: 'Rate', placeholder: 'e.g. 10 means 10%', format: (v) => percentText(v) },
    { key: 'discount', label: 'Discount (%)', type: 'number', listColumn: true, group: 'Rate', placeholder: 'e.g. 10 means 10%', format: (v) => percentText(v) },
    // One two-line list column replaces the separate Effective from / Effective to columns. Display-only, like "Applies to".
    { key: 'effective_period', label: 'Effective period', type: 'text', readOnly: true, listColumn: true, visibleIf: () => false, format: (_v, r) => periodText(r) },
    { key: 'effective_from', label: 'Effective from', type: 'date', group: 'Validity', format: (v) => dateText(v) },
    { key: 'effective_to', label: 'Effective to', type: 'date', group: 'Validity', format: (v) => dateText(v, 'No end date') },
    {
      key: 'validity',
      label: 'Validity',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => STATUS_LABEL[rateStatus(r)] ?? rateStatus(r),
      group: 'Validity',
    },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Validity' },
  ],
  kpis: [
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active price lists', value: (r) => String(r.filter((x) => rateStatus(x) === 'Active').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Expired rates', value: (r) => String(r.filter((x) => rateStatus(x) === 'Expired').length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Upcoming rate changes', value: (r) => String(r.filter((x) => rateStatus(x) === 'Upcoming').length) },
    { icon: '⚠', iconClass: 'kpi-icon-amber', label: 'Ending in 7 days', value: (r) => String(r.filter((x) => { const left = rateStatus(x) === 'Active' ? daysUntil(x.effective_to) : null; return left != null && left <= 7; }).length) },
    { icon: '₹', iconClass: 'kpi-icon-ink', label: 'Total price records', value: (r) => String(r.length) },
  ],
};

export function TradingPriceRateListPage() {
  // The wrapper only carries the CSS scope for this page's table (display: contents = no layout effect).
  return (
    <div className="price-list-page">
      <TradingMasterPage config={config} />
    </div>
  );
}