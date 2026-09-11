import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const BASE_FLAGS = ['Yes', 'No'];
const STATUSES = ['Active', 'Upcoming', 'Expired'];

// Each record is one exchange-rate entry for a currency pair, kept as its
// own row so historical rates are never overwritten — a new rate is a new
// record, not an edit to the old one.
function rateStatus(r: Record<string, unknown>): string {
  const now = new Date();
  const from = r.effective_date ? new Date(r.effective_date as string) : null;
  const to = r.expiry_date ? new Date(r.expiry_date as string) : null;
  if (to && to < now) return 'Expired';
  if (from && from > now) return 'Upcoming';
  return 'Active';
}

const config: TradingModuleConfig = {
  resource: '/trading/currency-rates',
  eyebrowModule: 'CURRENCY MANAGEMENT',
  title: 'Currency management',
  description: 'Currencies and exchange rates used across deals, price lists, shipments and import/export values. Each rate change is a new dated record — history is preserved.',
  icon: '＄',
  emptyIcon: '＄',
  codeField: 'currency_code',
  nameField: 'currency_name',
  statusOptions: STATUSES,
  searchableKeys: ['currency_code', 'currency_name', 'base_currency', 'target_currency'],
  fields: [
    { key: 'currency_code', label: 'Currency code', type: 'text', required: true, listColumn: true, placeholder: 'e.g. INR' },
    { key: 'currency_name', label: 'Currency name', type: 'text', listColumn: true, placeholder: 'e.g. Indian Rupee' },
    { key: 'currency_symbol', label: 'Currency symbol', type: 'text', group: 'Currency' },
    { key: 'country_region', label: 'Country / region', type: 'text', group: 'Currency' },
    { key: 'decimal_places', label: 'Decimal places', type: 'number', group: 'Currency' },
    { key: 'is_base_currency', label: 'Base currency', type: 'select', options: BASE_FLAGS, group: 'Currency' },
    { key: 'base_currency', label: 'Base currency (for this rate)', type: 'text', listColumn: true, group: 'Exchange rate', placeholder: 'e.g. USD' },
    { key: 'target_currency', label: 'Target currency', type: 'text', listColumn: true, group: 'Exchange rate', placeholder: 'e.g. INR' },
    { key: 'exchange_rate', label: 'Exchange rate', type: 'number', listColumn: true, group: 'Exchange rate' },
    { key: 'effective_date', label: 'Effective date', type: 'date', group: 'Exchange rate' },
    { key: 'expiry_date', label: 'Expiry date', type: 'date', group: 'Exchange rate' },
    { key: 'rate_source', label: 'Rate source', type: 'text', group: 'Exchange rate' },
    {
      key: 'rate_status',
      label: 'Status',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => rateStatus(r),
      group: 'Exchange rate',
    },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Exchange rate' },
  ],
  kpis: [
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active exchange rates', value: (r) => String(r.filter((x) => rateStatus(x) === 'Active').length) },
    { icon: '◎', iconClass: 'kpi-icon-ink', label: 'Active currencies', value: (r) => String(new Set(r.filter((x) => rateStatus(x) === 'Active').map((x) => x.target_currency)).size) },
    {
      icon: '↗',
      iconClass: 'kpi-icon-amber',
      label: 'Recently updated (7 days)',
      value: (r) => String(r.filter((x) => x.effective_date && (Date.now() - new Date(x.effective_date as string).getTime()) / 86400000 <= 7).length),
    },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Expired rates', value: (r) => String(r.filter((x) => rateStatus(x) === 'Expired').length) },
  ],
  sampleRecords: [
    { id: 'demo-currency-1', currency_code: 'USD', currency_name: 'US Dollar', currency_symbol: '$', country_region: 'United States', decimal_places: 2, is_base_currency: 'No', base_currency: 'USD', target_currency: 'INR', exchange_rate: 83.4, effective_date: '2026-09-01', rate_source: 'RBI reference rate' },
    { id: 'demo-currency-2', currency_code: 'AED', currency_name: 'UAE Dirham', currency_symbol: 'د.إ', country_region: 'United Arab Emirates', decimal_places: 2, is_base_currency: 'No', base_currency: 'AED', target_currency: 'INR', exchange_rate: 22.7, effective_date: '2026-09-01', rate_source: 'Bank rate' },
  ],
};

export function CurrencyManagementPage() {
  return <TradingMasterPage config={config} />;
}