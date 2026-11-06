// Vehicle only: applies a live Vehicle scheme (Schemes & Discounts) to Quotation / Sales order lines.
// loadVehicleSchemeEngine() returns null for every other industry (FMCG / School / Textile / Pharma / Trading),
// so those flows never touch this code. Any failure also returns null, so a scheme problem can never block a save.
import { supabaseAdmin } from './supabase.js';
import { industryCodeOf } from './fmcg-market.js';
import { todayLocal } from './ist-date.js';
import { logger } from './logger.js';

type Row = Record<string, unknown>;
const has = (v: unknown) => v !== null && v !== undefined && v !== '';
const num = (v: unknown) => (has(v) ? Number(String(v).replace(/[₹,\s]/g, '')) || 0 : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const str = (v: unknown) => (has(v) ? String(v) : '');

/** One scheme that gave money off a line. */
export type VehicleSchemePart = { schemeId: string; schemeName: string; amount: number };
/** schemeId is stored as |SCH-1|SCH-2| (so a scheme can be found with LIKE '%|SCH-1|%'); schemeName is the readable list. */
export type VehicleSchemeHit = { amount: number; schemeId: string; schemeName: string; parts: VehicleSchemePart[] };
export type VehicleSchemeEngine = {
  /** Scheme money off for one order line (null when no live scheme fits the product). */
  discountFor(productId: string, quantity: number, unitPrice: number): VehicleSchemeHit | null;
};
/** Who the order / quotation is for, and which order is being re-priced (so its own earlier lines are not counted as usage). */
export type VehicleSchemeContext = { clientId?: string | null; excludeOrderId?: string | null };

/** The value stored on a line to remember which scheme(s) gave the discount. */
export const schemeRefOf = (hit: VehicleSchemeHit) => hit.schemeId;
export const schemeRefsToIds = (ref: unknown) => str(ref).split('|').map((x) => x.trim()).filter(Boolean);
/** Columns written on a quotation / order line when a Vehicle scheme gave the discount (empty object otherwise). */
export const vehicleSchemeColumns = (hit: VehicleSchemeHit | null) => (hit ? { vehicle_scheme_ref: hit.schemeId, vehicle_scheme_name: hit.schemeName } : {});

// ---------------------------------------------------------------- customer type
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const TYPE_WORDS: Record<string, string[]> = {
  retail: ['retail', 'individual', 'consumer', 'walkin', 'private'],
  corporate: ['corporate', 'company', 'business', 'enterprise'],
  government: ['government', 'govt', 'publicsector', 'psu'],
  defencepolice: ['defence', 'defense', 'police', 'military', 'army'],
  fleet: ['fleet'],
  taxicommercial: ['taxi', 'commercial', 'cab', 'transport'],
  employee: ['employee', 'staff'],
  referral: ['referral'],
  farmer: ['farmer', 'agri'],
  student: ['student'],
  seniorcitizen: ['senior'],
  women: ['women', 'woman', 'lady'],
  doctorprofessional: ['doctor', 'professional'],
  dealerstaff: ['dealerstaff'],
};
/** Does a customer fit the scheme's "Customer type"? 'All customers' / blank always fits. Used by quotation, order and booking. */
export function schemeFitsCustomer(schemeType: unknown, clientType: unknown, isRepeat: boolean): boolean {
  const wanted = norm(schemeType);
  if (!wanted || wanted === 'allcustomers') return true;
  if (wanted === 'existingcustomerrepeat') return isRepeat || norm(clientType).includes('repeat') || norm(clientType).includes('existing');
  const have = norm(clientType);
  if (wanted === 'other') return !have || !Object.values(TYPE_WORDS).flat().some((w) => have.includes(w));
  if (!have) return false;
  if (have === wanted) return true;
  return (TYPE_WORDS[wanted] ?? [wanted]).some((w) => have.includes(w));
}
/** Client type + repeat flag for a client (booking validation uses this too). */
export async function customerFacts(org: string, clientId: unknown, excludeOrderId?: string | null): Promise<{ clientType: string; isRepeat: boolean } | null> {
  if (!has(clientId)) return null;
  const { data: client } = await supabaseAdmin.from('clients').select('client_type').eq('organization_id', org).eq('id', String(clientId)).maybeSingle();
  let q = supabaseAdmin.from('sale_orders').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('client_id', String(clientId)).neq('status', 'cancelled');
  if (excludeOrderId) q = q.neq('id', excludeOrderId);
  const { count } = await q;
  return { clientType: str((client as Row | null)?.client_type), isRepeat: (count ?? 0) > 0 };
}

// ---------------------------------------------------------------- credit
/** Money off one line: percentage of the line + fixed amount + per-vehicle amount x quantity + cash discount. Exchange bonus is not
 *  applied here (it depends on an exchange that does not exist yet). Never more than the line value. */
function lineCredit(scheme: Row, quantity: number, unitPrice: number): number {
  const gross = unitPrice * quantity;
  let credit = num(scheme.cash_discount);
  const value = num(scheme.discount_value);
  if (scheme.discount_type === 'Percentage') credit += (gross * value) / 100;
  else if (scheme.discount_type === 'Fixed Amount') credit += value;
  else if (scheme.discount_type === 'Per Vehicle') credit += value * quantity;
  return round2(Math.max(0, Math.min(credit, gross)));
}

// ---------------------------------------------------------------- usage (limits, budget, reports)
export type SchemeUsage = { orders: number; vehicles: number; discount: number };
/** Vehicles sold and discount given per scheme_id, from the lines of orders that are not cancelled. */
export async function vehicleSchemeUsage(org: string, excludeOrderId?: string | null): Promise<Map<string, SchemeUsage>> {
  const out = new Map<string, SchemeUsage>();
  const { data, error } = await supabaseAdmin.from('sale_order_items')
    .select('quantity, discount_amount, vehicle_scheme_ref, order_id, sale_orders!inner(organization_id, status)')
    .not('vehicle_scheme_ref', 'is', null).eq('sale_orders.organization_id', org).neq('sale_orders.status', 'cancelled');
  if (error) throw error;
  for (const line of (data ?? []) as unknown as Row[]) {
    if (excludeOrderId && String(line.order_id) === excludeOrderId) continue;
    const ids = schemeRefsToIds(line.vehicle_scheme_ref);
    for (const id of ids) {
      const u = out.get(id) ?? { orders: 0, vehicles: 0, discount: 0 };
      u.orders += 1; u.vehicles += num(line.quantity);
      // a stacked line is shared by its schemes; the full line discount is counted on each so budgets are never under-counted
      u.discount += num(line.discount_amount);
      out.set(id, u);
    }
  }
  return out;
}

export async function loadVehicleSchemeEngine(org: string, industryTypeId: string | null | undefined, productIds: string[], ctx: VehicleSchemeContext = {}): Promise<VehicleSchemeEngine | null> {
  try {
    if (!industryTypeId || !productIds.length) return null;
    if ((await industryCodeOf(org, industryTypeId)) !== 'vehicle') return null; // Vehicle only
    const why = (reason: string) => { logger.info({ productIds }, `vehicle-schemes: no scheme applied - ${reason}`); return null; };

    const today = todayLocal();
    const { data: schemeRows, error: schemeError } = await supabaseAdmin.from('vehicle_schemes').select('*').eq('organization_id', org).eq('industry_type_id', industryTypeId).eq('status', 'Active');
    if (schemeError) throw schemeError;
    const dated = ((schemeRows ?? []) as Row[]).filter((s) =>
      (!has(s.start_date) || String(s.start_date).slice(0, 10) <= today)
      && (!has(s.end_date) || String(s.end_date).slice(0, 10) >= today)
      && str(s.approval_required) !== 'Yes'); // a scheme that needs manager sign-off is never given automatically (a manager applies it on the booking)
    if (!dated.length) return why(`no Active scheme is valid today with approval not required (${(schemeRows ?? []).length} Active scheme(s) found)`);

    // customer type: who is buying decides which customer-specific schemes fit
    const needsCustomer = dated.some((s) => has(s.customer_type) && str(s.customer_type) !== 'All customers');
    const facts = needsCustomer ? await customerFacts(org, ctx.clientId, ctx.excludeOrderId) : null;
    // dealer / branch: a quotation or order has no branch of its own, so it takes the showroom's own Branch when there is exactly one (same rule as a booking)
    let branchId: string | null = null;
    if (dated.some((s) => has(s.dealer_id))) {
      const { data: branches } = await supabaseAdmin.from('vehicle_dealers').select('id').eq('organization_id', org).eq('industry_type_id', industryTypeId).eq('dealer_type', 'Branch').limit(2);
      if (branches && branches.length === 1) branchId = String((branches[0] as Row).id);
    }
    const live = dated.filter((s) =>
      (!has(s.dealer_id) || (branchId !== null && String(s.dealer_id) === branchId))
      && (!has(s.customer_type) || str(s.customer_type) === 'All customers' || (facts !== null && schemeFitsCustomer(s.customer_type, facts.clientType, facts.isRepeat))));
    if (!live.length) return why('the schemes do not fit this customer type / branch');

    const { data: modelRows, error: modelError } = await supabaseAdmin.from('vehicle_models').select('id, product_id').eq('organization_id', org).eq('industry_type_id', industryTypeId).in('product_id', productIds);
    if (modelError) throw modelError;
    const modelOfProduct = new Map(((modelRows ?? []) as Row[]).map((m) => [String(m.product_id), String(m.id)]));
    if (!modelOfProduct.size) return why('the product is not linked to a Vehicle Model (vehicle_models.product_id)'); // accessory-only order: no vehicle model, no scheme

    // usage limits / budget caps: only read the usage when some live scheme has one
    const limited = live.some((s) => num(s.usage_limit) > 0 || num(s.budget_cap) > 0);
    const used = limited ? await vehicleSchemeUsage(org, ctx.excludeOrderId) : new Map<string, SchemeUsage>();

    return {
      discountFor(productId, quantity, unitPrice) {
        const modelId = modelOfProduct.get(productId);
        if (!modelId || !(quantity > 0) || !(unitPrice > 0)) return null;
        const gross = unitPrice * quantity;
        const fits: VehicleSchemePart[] = [];
        let bestBase: VehicleSchemePart | null = null;
        const stackers: VehicleSchemePart[] = [];
        for (const s of live) {
          if (has(s.model_id) && String(s.model_id) !== modelId) continue;
          if (num(s.min_quantity) > quantity) continue;
          const key = str(s.scheme_id);
          const u = used.get(key) ?? { orders: 0, vehicles: 0, discount: 0 };
          if (num(s.usage_limit) > 0 && u.vehicles + quantity > num(s.usage_limit)) continue; // usage limit reached
          let amount = lineCredit(s, quantity, unitPrice);
          if (num(s.budget_cap) > 0) amount = Math.min(amount, round2(num(s.budget_cap) - u.discount)); // budget left
          if (!(amount > 0)) continue;
          const part = { schemeId: key, schemeName: str(s.scheme_name), amount };
          if (str(s.stackable) === 'Yes') stackers.push(part);
          else if (!bestBase || amount > bestBase.amount) bestBase = part;
        }
        if (bestBase) fits.push(bestBase);
        fits.push(...stackers.sort((a, b) => b.amount - a.amount));
        if (!fits.length) { logger.info({ productId, quantity }, 'vehicle-schemes: no scheme applied - scheme model / minimum quantity / limit did not fit this line'); return null; }
        let left = gross; // stacked schemes together never exceed the line value
        const parts = fits.map((p) => { const amount = round2(Math.min(p.amount, left)); left = round2(left - amount); return { ...p, amount }; }).filter((p) => p.amount > 0);
        if (!parts.length) return null;
        const hit = { amount: round2(parts.reduce((t, p) => t + p.amount, 0)), schemeId: `|${parts.map((p) => p.schemeId).join('|')}|`, schemeName: parts.map((p) => p.schemeName).join(' + '), parts };
        // keep a running tally so several lines of the same request cannot pass a limit together
        for (const p of parts) { const u = used.get(p.schemeId) ?? { orders: 0, vehicles: 0, discount: 0 }; u.vehicles += quantity; u.discount += p.amount; used.set(p.schemeId, u); }
        return hit;
      },
    };
  } catch (error) {
    logger.error({ err: error }, 'vehicle-schemes: could not load schemes - continuing without a scheme discount');
    return null;
  }
}