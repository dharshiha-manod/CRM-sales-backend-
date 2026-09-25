// FILE: admin/src/components/CommissionRulesPage.tsx
// The configuration behind Commission Management. Rules live here so a
// commission record never has to carry a hand-typed rate: the rule decides
// the basis, the rate (or tier/target), and — importantly — what has to
// happen before commission counts as earned.
//
// Scope fields are deliberately optional. A rule with nothing scoped is the
// house default; adding a rep, customer, product or deal narrows it, and
// the most specific matching rule wins (see lib/commissionRules.ts).
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { COMMISSION_BASES, QUALIFYING_EVENTS } from '../lib/commissionRules';

const STATUSES = ['Active', 'Inactive'];

const config: TradingModuleConfig = {
  resource: '/trading/commission-rules',
  eyebrowModule: 'COMMISSION RULES',
  title: 'Commission rules',
  description: 'How commission is calculated and when it becomes earned. Leave a scope field blank to apply the rule to everything; fill one in to narrow it to a rep, customer, product or deal. The most specific active rule wins.',
  icon: '⚙',
  emptyIcon: '⚙',
  codeField: 'rule_code',
  nameField: 'rule_name',
  statusOptions: STATUSES,
  searchableKeys: ['rule_code', 'rule_name', 'sales_rep', 'customer_name', 'product_name', 'product_category'],
  fields: [
    { key: 'rule_code', label: 'Rule code', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'CMR' },
    { key: 'rule_name', label: 'Rule name', type: 'text', required: true, listColumn: true, placeholder: 'e.g. Standard export commission' },
    {
      key: 'commission_basis', label: 'Commission basis', type: 'select', options: [...COMMISSION_BASES],
      required: true, listColumn: true,
    },
    {
      key: 'qualifying_event', label: 'Earned when', type: 'select', options: [...QUALIFYING_EVENTS],
      required: true, listColumn: true,
      placeholder: 'What has to happen before commission is payable',
    },

    // Scope — all optional. Blank means "applies to everything".
       // Free text, not a constrained lookup: the Deal (and every other Trading
    // record) stores sales_rep as whatever the user typed there — see
    // TradingDealPage.tsx. This field used to be a lookup against
    // /sales-representatives storing an employee_code ("EMP-2026-0007"),
    // which could never equal that free text, so a rep-scoped rule silently
    // never matched (see matches() in commissionRules.ts) and commission
    // quietly fell back to a more generic rule instead of the intended one.
    {
      key: 'sales_rep', label: 'Sales representative', type: 'text', group: 'Scope (leave blank for all)',
      placeholder: 'Type it exactly as it appears on the Deal (see the Sales representative column)',
    },
    {
      key: 'customer_name', label: 'Customer', type: 'lookup', group: 'Scope (leave blank for all)',
      lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_code',
    },
    {
      key: 'product_name', label: 'Product', type: 'lookup', group: 'Scope (leave blank for all)',
      lookupResource: '/products?status=active', lookupLabelKey: 'product_code',
    },
    { key: 'product_category', label: 'Product category', type: 'text', group: 'Scope (leave blank for all)' },
    {
      key: 'deal_number', label: 'Specific deal', type: 'lookup', group: 'Scope (leave blank for all)',
      lookupResource: '/trading/deals', lookupLabelKey: 'deal_name',
      placeholder: 'One-off arrangement for a single deal',
    },

    {
      key: 'commission_rate', label: 'Rate (% or fixed amount)', type: 'number', listColumn: true, group: 'Rate',
      visibleIf: (f) => !['Tiered on Sales Value', 'Target Achievement'].includes(f.commission_basis ?? ''),
    },
    {
      key: 'currency', label: 'Currency', type: 'lookup', group: 'Rate',
      lookupResource: '/trading/currency-rates', lookupValueKey: 'currency_code', lookupLabelKey: 'currency_name',
      placeholder: 'Only needed for fixed-amount bases',
    },

    // Tiers — a flat three-band ladder. Enough for real trading terms
    // without a child table, and it keeps the whole rule on one row.
    { key: 'tier_1_upto', label: 'Tier 1 — sales value up to', type: 'number', group: 'Tiers', visibleIf: (f) => f.commission_basis === 'Tiered on Sales Value' },
    { key: 'tier_1_rate', label: 'Tier 1 rate %', type: 'number', group: 'Tiers', visibleIf: (f) => f.commission_basis === 'Tiered on Sales Value' },
    { key: 'tier_2_upto', label: 'Tier 2 — sales value up to', type: 'number', group: 'Tiers', visibleIf: (f) => f.commission_basis === 'Tiered on Sales Value' },
    { key: 'tier_2_rate', label: 'Tier 2 rate %', type: 'number', group: 'Tiers', visibleIf: (f) => f.commission_basis === 'Tiered on Sales Value' },
    { key: 'tier_3_rate', label: 'Above tier 2 — rate %', type: 'number', group: 'Tiers', visibleIf: (f) => f.commission_basis === 'Tiered on Sales Value' },

    { key: 'target_amount', label: 'Target sales value', type: 'number', group: 'Target', visibleIf: (f) => f.commission_basis === 'Target Achievement' },
    { key: 'target_rate', label: 'Rate % when target met', type: 'number', group: 'Target', visibleIf: (f) => f.commission_basis === 'Target Achievement' },
    { key: 'below_target_rate', label: 'Rate % below target', type: 'number', group: 'Target', visibleIf: (f) => f.commission_basis === 'Target Achievement' },

    { key: 'priority', label: 'Priority', type: 'number', group: 'Validity', placeholder: 'Higher wins when two rules are equally specific' },
    { key: 'effective_from', label: 'Effective from', type: 'date', listColumn: true, group: 'Validity' },
    { key: 'effective_to', label: 'Effective to', type: 'date', group: 'Validity' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Validity' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Validity' },
  ],
  kpis: [
    { icon: '⚙', iconClass: 'kpi-icon-ink', label: 'Active rules', value: (r) => String(r.filter((x) => x.status !== 'Inactive').length) },
    { icon: '◎', iconClass: 'kpi-icon-school', label: 'Default rules', value: (r) => String(r.filter((x) => !x.sales_rep && !x.customer_name && !x.product_name && !x.product_category && !x.deal_number).length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Paid on collection', value: (r) => String(r.filter((x) => x.qualifying_event === 'Payment Collected').length) },
    { icon: '↗', iconClass: 'kpi-icon-green', label: 'Tier / target rules', value: (r) => String(r.filter((x) => ['Tiered on Sales Value', 'Target Achievement'].includes(String(x.commission_basis))).length) },
  ],
};

export function CommissionRulesPage() {
  return <TradingMasterPage config={config} />;
}