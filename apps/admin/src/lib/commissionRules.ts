// FILE: admin/src/lib/commissionRules.ts
// Commission stopped being "a rate somebody typed on each record" here.
//
// The spec asks for configurable rules — percentage, fixed, product-based,
// customer/deal-based, rep-based and tier/target-based — and for commission
// to be calculated from the real transaction once it reaches a qualifying
// status. A rate typed per record can't express any of that, so rules are
// their own module (/trading/commission-rules) and this file is the engine
// that picks the right one and works out the amount.
//
// Rules are *referenced*, never copied: a commission record stores which
// rule fired (rule_code) plus the figures at the time it fired, so an
// historical payout keeps the terms it was actually earned under even if
// the rule is later edited — the same reasoning currencyLookup.ts uses for
// storing the exchange rate rather than re-deriving it.
import { api } from './api';
import type { ChainRow, ChainStatus } from './tradingChain';
import { num } from './tradingChain';

export const COMMISSION_BASES = [
  'Percentage of Sales Value',
  'Percentage of Gross Profit',
  'Fixed Amount per Unit',
  'Fixed Amount per Deal',
  'Tiered on Sales Value',
  'Target Achievement',
] as const;

/** What has to happen before commission is earned. Drives Pending -> Eligible. */
export const QUALIFYING_EVENTS = [
  'Deal Confirmed',
  'Order Confirmed',
  'Shipment Delivered',
  'Payment Collected',
] as const;

export const COMMISSION_STATUSES = ['Pending', 'Eligible', 'Approved', 'Paid', 'Rejected', 'Cancelled'] as const;

const str = (v: unknown): string => (v == null ? '' : String(v));

function isActive(rule: ChainRow, on = new Date()): boolean {
  if (str(rule.status) === 'Inactive') return false;
  const from = rule.effective_from ? new Date(str(rule.effective_from)) : null;
  const to = rule.effective_to ? new Date(str(rule.effective_to)) : null;
  if (from && from > on) return false;
  if (to && to < on) return false;
  return true;
}

export interface CommissionContext {
  sales_rep: string;
  customer_name: string;
  product_name: string;
  product_category: string;
  deal_number: string;
  salesValue: number | null;
  purchaseValue: number | null;
  quantity: number | null;
  /** the rep's total qualifying sales in the period, for Target Achievement */
  periodSalesValue?: number | null;
}

/** Empty scope field = "applies to everything", so a blank rule is the default. */
function matches(rule: ChainRow, ctx: CommissionContext): boolean {
  const scoped = (ruleValue: unknown, contextValue: string) => {
    const want = str(ruleValue);
    return !want || want === contextValue;
  };
  return scoped(rule.sales_rep, ctx.sales_rep)
    && scoped(rule.customer_name, ctx.customer_name)
    && scoped(rule.product_name, ctx.product_name)
    && scoped(rule.product_category, ctx.product_category)
    && scoped(rule.deal_number, ctx.deal_number);
}

/**
 * More specific wins. A rule naming both the rep and the product beats one
 * naming only the product, so a special arrangement for one rep doesn't
 * need every general rule disabled to take effect. `priority` on the rule
 * is the manual override for genuine ties.
 */
function specificity(rule: ChainRow): number {
  return (str(rule.deal_number) ? 16 : 0)
    + (str(rule.sales_rep) ? 8 : 0)
    + (str(rule.customer_name) ? 4 : 0)
    + (str(rule.product_name) ? 2 : 0)
    + (str(rule.product_category) ? 1 : 0);
}

export function resolveRule(rules: ChainRow[], ctx: CommissionContext, on = new Date()): ChainRow | undefined {
  return rules
    .filter((r) => isActive(r, on) && matches(r, ctx))
    .sort((a, b) => {
      const bySpecificity = specificity(b) - specificity(a);
      if (bySpecificity !== 0) return bySpecificity;
      const byPriority = (num(b.priority) ?? 0) - (num(a.priority) ?? 0);
      if (byPriority !== 0) return byPriority;
      return str(b.effective_from).localeCompare(str(a.effective_from));
    })[0];
}

export interface CommissionResult {
  amount: number | null;
  /** plain-language explanation shown on the record, so a payout is auditable */
  workingNote: string;
  rateApplied: number | null;
}

/** Three tiers cover real trading arrangements without a child table. */
function tieredRate(rule: ChainRow, salesValue: number): number | null {
  const t1Upto = num(rule.tier_1_upto);
  const t2Upto = num(rule.tier_2_upto);
  if (t1Upto != null && salesValue <= t1Upto) return num(rule.tier_1_rate);
  if (t2Upto != null && salesValue <= t2Upto) return num(rule.tier_2_rate);
  return num(rule.tier_3_rate) ?? num(rule.tier_2_rate) ?? num(rule.tier_1_rate);
}

export function computeCommission(rule: ChainRow | undefined, ctx: CommissionContext): CommissionResult {
  if (!rule) {
    return { amount: null, workingNote: 'No commission rule matches this transaction.', rateApplied: null };
  }
  const basis = str(rule.commission_basis);
  const rate = num(rule.commission_rate);
  const sales = ctx.salesValue;
  const purchase = ctx.purchaseValue;
  const qty = ctx.quantity;
  const code = str(rule.rule_code);

  const none = (why: string): CommissionResult => ({ amount: null, workingNote: why, rateApplied: null });

  switch (basis) {
    case 'Percentage of Sales Value': {
      if (rate == null) return none(`${code}: no rate set on the rule.`);
      if (sales == null) return none(`${code}: sales value not recorded on the linked order or deal.`);
      return { amount: sales * (rate / 100), workingNote: `${code}: ${rate}% of sales value ${sales.toLocaleString()}`, rateApplied: rate };
    }
    case 'Percentage of Gross Profit': {
      if (rate == null) return none(`${code}: no rate set on the rule.`);
      if (sales == null || purchase == null) return none(`${code}: gross profit needs both sales and purchase value — one is not recorded.`);
      const gp = sales - purchase;
      return { amount: gp * (rate / 100), workingNote: `${code}: ${rate}% of gross profit ${gp.toLocaleString()}`, rateApplied: rate };
    }
    case 'Fixed Amount per Unit': {
      if (rate == null) return none(`${code}: no per-unit amount set on the rule.`);
      if (qty == null) return none(`${code}: quantity not recorded on the linked order or deal.`);
      return { amount: rate * qty, workingNote: `${code}: ${rate} per unit x ${qty}`, rateApplied: rate };
    }
    case 'Fixed Amount per Deal': {
      if (rate == null) return none(`${code}: no fixed amount set on the rule.`);
      return { amount: rate, workingNote: `${code}: flat ${rate} per deal`, rateApplied: rate };
    }
    case 'Tiered on Sales Value': {
      if (sales == null) return none(`${code}: sales value not recorded, so no tier applies.`);
      const tier = tieredRate(rule, sales);
      if (tier == null) return none(`${code}: no tier rate configured for a sales value of ${sales.toLocaleString()}.`);
      return { amount: sales * (tier / 100), workingNote: `${code}: tier rate ${tier}% on sales value ${sales.toLocaleString()}`, rateApplied: tier };
    }
    case 'Target Achievement': {
      if (sales == null) return none(`${code}: sales value not recorded.`);
      const target = num(rule.target_amount);
      const achieved = ctx.periodSalesValue ?? sales;
      if (target == null) return none(`${code}: no target amount set on the rule.`);
      const hit = achieved >= target;
      const applied = hit ? num(rule.target_rate) : num(rule.below_target_rate);
      if (applied == null) return none(`${code}: no ${hit ? 'on-target' : 'below-target'} rate set on the rule.`);
      return {
        amount: sales * (applied / 100),
        workingNote: `${code}: ${achieved.toLocaleString()} against target ${target.toLocaleString()} — ${hit ? 'achieved' : 'below target'}, ${applied}% applied`,
        rateApplied: applied,
      };
    }
    default:
      return none(`${code}: commission basis "${basis || 'not set'}" is not configured.`);
  }
}

/**
 * Whether the transaction has reached the rule's qualifying event.
 * This is the rule the spec is firmest about: a draft deal existing is
 * never enough to treat commission as earned.
 */
export function hasQualified(rule: ChainRow | undefined, status: ChainStatus): boolean {
  const event = str(rule?.qualifying_event) || 'Payment Collected';
  switch (event) {
    case 'Deal Confirmed':
      return ['Confirmed', 'In Progress', 'Completed'].includes(status.dealStatus);
    case 'Order Confirmed':
      return Boolean(status.orderStatus) && status.orderStatus !== 'Cancelled';
    case 'Shipment Delivered':
      return status.delivered;
    case 'Payment Collected':
    default:
      return status.paid;
  }
}

export function qualifyingNote(rule: ChainRow | undefined, status: ChainStatus): string {
  const event = str(rule?.qualifying_event) || 'Payment Collected';
  if (hasQualified(rule, status)) return `Qualified — ${event.toLowerCase()}.`;
  switch (event) {
    case 'Deal Confirmed': return `Waiting on the deal to be confirmed (currently ${status.dealStatus || 'no status'}).`;
    case 'Order Confirmed': return 'Waiting on a sales order to be raised from this deal.';
    case 'Shipment Delivered': return `Waiting on delivery (currently ${status.deliveryStatus}).`;
    default: return `Waiting on collection (currently ${status.paymentStatus}).`;
  }
}

let rulesCache: { at: number; rows: ChainRow[] } | null = null;
const CACHE_MS = 30_000;

export function invalidateCommissionRules(): void {
  rulesCache = null;
}

export async function loadCommissionRules(industryTypeId?: string | null, force = false): Promise<ChainRow[]> {
  if (!force && rulesCache && Date.now() - rulesCache.at < CACHE_MS) return rulesCache.rows;
  try {
    const query = industryTypeId ? `?industryTypeId=${industryTypeId}` : '';
    const res = await api<{ data: ChainRow[] }>(`/trading/commission-rules${query}`);
    rulesCache = { at: Date.now(), rows: res.data ?? [] };
  } catch {
    // No rules configured yet, or the route isn't reachable — commission
    // simply stays uncalculated rather than guessing a rate.
    rulesCache = { at: Date.now(), rows: [] };
  }
  return rulesCache.rows;
}