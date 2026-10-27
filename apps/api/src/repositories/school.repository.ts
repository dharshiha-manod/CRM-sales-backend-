// School industry master data: academic years + terms, school-specific pricing rules, and the School-wise
// sales & collection summary. Every query is filtered by the School industry_type_id, so rows never mix with
// another industry. Callers must have already proven the request is for the School industry (see school.routes.ts).
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { completeOrderIfSettled } from '../lib/order-completion.js';
import { releaseStockForOrder, takeStockForOrder } from '../lib/stock.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { createReturn, decideReturn, deleteReturn, type ReturnInput } from './sales-returns.repository.js';
import { createRefund, type RefundInput } from './fmcg-refunds.repository.js';

const fail = (code: string, error: { message: string }): never => { throw new AppError(500, code, error.message, error); };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.');
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.').nullable().optional().or(z.literal('').transform(() => null));

// ---------------------------------------------------------------- Academic years & terms
export const yearSchema = z.object({
  label: z.string().trim().min(1, 'Enter the academic year label, e.g. 2026-2027.').max(40),
  startDate: date,
  endDate: date,
  status: z.enum(['active', 'closed']).optional(),
}).refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'End date cannot be before the start date.' });
export const termSchema = z.object({
  name: z.string().trim().min(1, 'Enter the term name.').max(60),
  startDate: date,
  endDate: date,
}).refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'End date cannot be before the start date.' });
export type YearInput = z.infer<typeof yearSchema>;
export type TermInput = z.infer<typeof termSchema>;

const YEAR_COLS = 'id, label, start_date, end_date, status, created_at, school_terms(id, name, start_date, end_date)';
const shapeYear = (row: Record<string, unknown>) => {
  const { school_terms, ...rest } = row as { school_terms?: Array<Record<string, unknown>> } & Record<string, unknown>;
  return { ...rest, terms: [...(school_terms ?? [])].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))) };
};
const yearNotFound = () => new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found.');
const duplicate = (error: { code?: string; message: string }, message: string) => { if (error.code === '23505') throw new AppError(409, 'SCHOOL_DUPLICATE', message); };

export async function listAcademicYears(org: string, industryTypeId: string) {
  const { data, error } = await supabaseAdmin.from('school_academic_years').select(YEAR_COLS)
    .eq('organization_id', org).eq('industry_type_id', industryTypeId).order('start_date', { ascending: false });
  if (error) fail('ACADEMIC_YEARS_LIST_FAILED', error);
  return (data ?? []).map((r) => shapeYear(r as Record<string, unknown>));
}
async function getYear(org: string, industryTypeId: string, id: string) {
  const { data, error } = await supabaseAdmin.from('school_academic_years').select(YEAR_COLS)
    .eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).maybeSingle();
  if (error) fail('ACADEMIC_YEAR_LOAD_FAILED', error);
  if (!data) throw yearNotFound();
  return data as Record<string, unknown>;
}
export async function createAcademicYear(org: string, userId: string, industryTypeId: string, input: YearInput) {
  const { data, error } = await supabaseAdmin.from('school_academic_years').insert({
    organization_id: org, industry_type_id: industryTypeId, label: input.label, start_date: input.startDate, end_date: input.endDate,
    status: input.status ?? 'active', created_by: userId,
  }).select(YEAR_COLS).single();
  if (error) { duplicate(error, `Academic year "${input.label}" already exists.`); fail('ACADEMIC_YEAR_SAVE_FAILED', error); }
  return shapeYear(data as Record<string, unknown>);
}
export async function updateAcademicYear(org: string, industryTypeId: string, id: string, input: YearInput | { status: 'active' | 'closed' }) {
  const current = await getYear(org, industryTypeId, id);
  const patch = 'label' in input
    ? { label: input.label, start_date: input.startDate, end_date: input.endDate, ...(input.status ? { status: input.status } : {}), updated_at: new Date().toISOString() }
    : { status: input.status, updated_at: new Date().toISOString() };
  if ('label' in input) {
    // Existing terms must still sit inside the (possibly changed) year.
    const outside = ((current.school_terms ?? []) as Array<{ name: string; start_date: string; end_date: string }>).find((t) => t.start_date < input.startDate || t.end_date > input.endDate);
    if (outside) throw new AppError(422, 'TERM_OUTSIDE_YEAR', `Term "${outside.name}" would fall outside the new year dates. Change that term first.`);
  }
  const { data, error } = await supabaseAdmin.from('school_academic_years').update(patch)
    .eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).select(YEAR_COLS).maybeSingle();
  if (error) { duplicate(error, 'An academic year with this label already exists.'); fail('ACADEMIC_YEAR_SAVE_FAILED', error); }
  if (!data) throw yearNotFound();
  return shapeYear(data as Record<string, unknown>);
}
export async function deleteAcademicYear(org: string, industryTypeId: string, id: string) {
  await getYear(org, industryTypeId, id);
  const { count, error: usedError } = await supabaseAdmin.from('sale_orders').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('academic_year_id', id);
  if (usedError) fail('ACADEMIC_YEAR_DELETE_FAILED', usedError);
  if ((count ?? 0) > 0) throw new AppError(422, 'ACADEMIC_YEAR_IN_USE', 'This academic year already has orders recorded against it, so it cannot be deleted. Close it instead.');
  const { error } = await supabaseAdmin.from('school_academic_years').delete().eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId);
  if (error) fail('ACADEMIC_YEAR_DELETE_FAILED', error);
}

async function assertTermInsideYear(org: string, industryTypeId: string, yearId: string, input: TermInput, exceptTermId?: string) {
  const year = await getYear(org, industryTypeId, yearId);
  if (input.startDate < String(year.start_date) || input.endDate > String(year.end_date)) {
    throw new AppError(422, 'TERM_OUTSIDE_YEAR', `A term must fall inside its academic year (${year.start_date} to ${year.end_date}).`);
  }
  const clash = ((year.school_terms ?? []) as Array<{ id: string; name: string; start_date: string; end_date: string }>)
    .find((t) => t.id !== exceptTermId && input.startDate <= t.end_date && input.endDate >= t.start_date);
  if (clash) throw new AppError(422, 'TERM_OVERLAP', `These dates overlap "${clash.name}". Terms in one academic year cannot overlap.`);
}
export async function createTerm(org: string, industryTypeId: string, yearId: string, input: TermInput) {
  await assertTermInsideYear(org, industryTypeId, yearId, input);
  const { error } = await supabaseAdmin.from('school_terms').insert({ organization_id: org, industry_type_id: industryTypeId, academic_year_id: yearId, name: input.name, start_date: input.startDate, end_date: input.endDate });
  if (error) { duplicate(error, `"${input.name}" already exists in this academic year.`); fail('TERM_SAVE_FAILED', error); }
  return shapeYear(await getYear(org, industryTypeId, yearId));
}
export async function updateTerm(org: string, industryTypeId: string, yearId: string, termId: string, input: TermInput) {
  await assertTermInsideYear(org, industryTypeId, yearId, input, termId);
  const { data, error } = await supabaseAdmin.from('school_terms').update({ name: input.name, start_date: input.startDate, end_date: input.endDate, updated_at: new Date().toISOString() })
    .eq('id', termId).eq('academic_year_id', yearId).eq('organization_id', org).eq('industry_type_id', industryTypeId).select('id').maybeSingle();
  if (error) { duplicate(error, `"${input.name}" already exists in this academic year.`); fail('TERM_SAVE_FAILED', error); }
  if (!data) throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found.');
  return shapeYear(await getYear(org, industryTypeId, yearId));
}
export async function deleteTerm(org: string, industryTypeId: string, yearId: string, termId: string) {
  const { count, error: usedError } = await supabaseAdmin.from('sale_orders').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('term_id', termId);
  if (usedError) fail('TERM_DELETE_FAILED', usedError);
  if ((count ?? 0) > 0) throw new AppError(422, 'TERM_IN_USE', 'This term already has orders recorded against it, so it cannot be deleted.');
  const { error } = await supabaseAdmin.from('school_terms').delete().eq('id', termId).eq('academic_year_id', yearId).eq('organization_id', org).eq('industry_type_id', industryTypeId);
  if (error) fail('TERM_DELETE_FAILED', error);
  return shapeYear(await getYear(org, industryTypeId, yearId));
}

// ---------------------------------------------------------------- Pricing rules
export const SCHOOL_TYPES = ['government', 'private', 'international', 'college', 'coaching'] as const;
export const ruleSchema = z.object({
  applyTo: z.enum(['school', 'school_type', 'all']).default('school'),
  clientId: z.string().uuid('Select a school.').nullable().optional(),
  schoolType: z.enum(SCHOOL_TYPES).nullable().optional(),
  productId: z.string().uuid('Select a product.').nullable().optional(),
  discountType: z.enum(['percentage', 'fixed_price']),
  discountPercent: z.number().finite().min(0).max(100).nullable().optional(),
  fixedPrice: z.number().finite().min(0).max(1e9).nullable().optional(),
  minQuantity: z.number().finite().min(0).max(1e9).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.applyTo === 'school' && !v.clientId) ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'Select a school.' });
  if (v.applyTo === 'school_type' && !v.schoolType) ctx.addIssue({ code: 'custom', path: ['schoolType'], message: 'Select the school type.' });
  if (!v.productId && v.discountType === 'fixed_price') ctx.addIssue({ code: 'custom', path: ['productId'], message: 'A fixed price needs one product. Choose a product, or use a percentage for all products.' });
  if (v.discountType === 'percentage' && !(Number(v.discountPercent) > 0)) ctx.addIssue({ code: 'custom', path: ['discountPercent'], message: 'Enter a discount percentage greater than zero.' });
  if (v.discountType === 'fixed_price' && !(Number(v.fixedPrice) > 0)) ctx.addIssue({ code: 'custom', path: ['fixedPrice'], message: 'Enter a fixed price greater than zero.' });
  if (v.startDate && v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date cannot be before the start date.' });
});
export type RuleInput = z.infer<typeof ruleSchema>;

const RULE_COLS = 'id, apply_to, school_type, client_id, product_id, discount_type, discount_percent, fixed_price, min_quantity, start_date, end_date, status, notes, created_at';
const ruleNotFound = () => new AppError(404, 'PRICING_RULE_NOT_FOUND', 'Pricing rule not found.');
const ruleRow = (input: RuleInput) => ({
  apply_to: input.applyTo, client_id: input.applyTo === 'school' ? input.clientId ?? null : null, school_type: input.applyTo === 'school_type' ? input.schoolType ?? null : null,
  product_id: input.productId || null, discount_type: input.discountType,
  discount_percent: input.discountType === 'percentage' ? input.discountPercent ?? null : null,
  fixed_price: input.discountType === 'fixed_price' ? input.fixedPrice ?? null : null,
  min_quantity: input.minQuantity ?? 0, start_date: input.startDate || null, end_date: input.endDate || null,
  notes: input.notes || null, ...(input.status ? { status: input.status } : {}),
});
async function assertSchoolClientAndProduct(org: string, industryTypeId: string, clientId: string | null | undefined, productId: string | null | undefined) {
  const [{ data: client, error: clientError }, { data: product, error: productError }] = await Promise.all([
    clientId ? supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', org).eq('industry_type_id', industryTypeId).maybeSingle() : Promise.resolve({ data: { id: null }, error: null }),
    productId ? supabaseAdmin.from('products').select('id').eq('id', productId).eq('organization_id', org).maybeSingle() : Promise.resolve({ data: { id: null }, error: null }),
  ]);
  if (clientError) fail('PRICING_RULE_SAVE_FAILED', clientError);
  if (productError) fail('PRICING_RULE_SAVE_FAILED', productError);
  if (!client) throw new AppError(422, 'NOT_A_SCHOOL_CLIENT', 'Select a school from the School industry.');
  if (!product) throw new AppError(422, 'INVALID_PRICING_PRODUCT', 'The selected product was not found.');
}
export async function listPricingRules(org: string, industryTypeId: string) {
  const { data, error } = await supabaseAdmin.from('school_pricing_rules').select(RULE_COLS)
    .eq('organization_id', org).eq('industry_type_id', industryTypeId).order('created_at', { ascending: false });
  if (error) fail('PRICING_RULES_LIST_FAILED', error);
  return data ?? [];
}
export async function createPricingRule(org: string, userId: string, industryTypeId: string, input: RuleInput) {
  await assertSchoolClientAndProduct(org, industryTypeId, input.applyTo === 'school' ? input.clientId : null, input.productId);
  const { data, error } = await supabaseAdmin.from('school_pricing_rules').insert({ ...ruleRow(input), organization_id: org, industry_type_id: industryTypeId, created_by: userId }).select(RULE_COLS).single();
  if (error) fail('PRICING_RULE_SAVE_FAILED', error);
  return data;
}
export async function updatePricingRule(org: string, industryTypeId: string, id: string, input: RuleInput | { status: 'active' | 'inactive' }) {
  if ('discountType' in input) await assertSchoolClientAndProduct(org, industryTypeId, input.applyTo === 'school' ? input.clientId : null, input.productId);
  const patch = 'discountType' in input ? { ...ruleRow(input), updated_at: new Date().toISOString() } : { status: input.status, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin.from('school_pricing_rules').update(patch).eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).select(RULE_COLS).maybeSingle();
  if (error) fail('PRICING_RULE_SAVE_FAILED', error);
  if (!data) throw ruleNotFound();
  return data;
}
export async function deletePricingRule(org: string, industryTypeId: string, id: string) {
  const { data, error } = await supabaseAdmin.from('school_pricing_rules').delete().eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).select('id').maybeSingle();
  if (error) fail('PRICING_RULE_DELETE_FAILED', error);
  if (!data) throw ruleNotFound();
}

// ---------------------------------------------------------------- School-wise sales & collection
async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>, code: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) fail(code, error);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

export type SchoolSummaryFilters = { academicYearId?: string | null; termId?: string | null };
export async function schoolSalesSummary(org: string, industryTypeId: string, filters: SchoolSummaryFilters = {}) {
  const schools = await pageAll<Record<string, unknown>>((from, to) => supabaseAdmin.from('clients')
    .select('id, client_code, client_name, status, city, credit_limit, credit_days, industry_details')
    .eq('organization_id', org).eq('industry_type_id', industryTypeId).order('client_name').range(from, to), 'SCHOOL_SUMMARY_FAILED');
  const orders = await pageAll<Record<string, unknown>>((from, to) => {
    let q = supabaseAdmin.from('sale_orders')
      .select('id, client_id, status, total_amount, base_total, created_at, academic_year_id, term_id, clients!inner(industry_type_id)')
      .eq('organization_id', org).eq('clients.industry_type_id', industryTypeId).order('created_at', { ascending: false });
    if (filters.academicYearId) q = q.eq('academic_year_id', filters.academicYearId);
    if (filters.termId) q = q.eq('term_id', filters.termId);
    return q.range(from, to);
  }, 'SCHOOL_SUMMARY_FAILED');
  const collections = await pageAll<Record<string, unknown>>((from, to) => supabaseAdmin.from('sales_collections')
    .select('id, client_id, sale_order_id, amount, collected_at, clients!inner(industry_type_id), sale_orders(academic_year_id, term_id, status)')
    .eq('organization_id', org).eq('clients.industry_type_id', industryTypeId).range(from, to), 'SCHOOL_SUMMARY_FAILED');
  // Approved returns / damage are credit notes: the school owes that much less (the table may not exist yet -> no credits).
  let returns: Array<Record<string, unknown>> = [];
  try {
    returns = await pageAll<Record<string, unknown>>((from, to) => supabaseAdmin.from('sales_returns')
      .select('order_id, client_id, credit_amount, base_credit, clients!inner(industry_type_id), sale_orders(academic_year_id, term_id)')
      .eq('organization_id', org).eq('status', 'approved').eq('clients.industry_type_id', industryTypeId).range(from, to), 'SCHOOL_SUMMARY_FAILED');
  } catch { returns = []; }
  // Money paid back to a school (refunds) is not collected money any more (the table may not exist yet -> none).
  let refunds: Array<Record<string, unknown>> = [];
  try {
    refunds = await pageAll<Record<string, unknown>>((from, to) => supabaseAdmin.from('sales_refunds')
      .select('order_id, client_id, amount, base_amount, clients!inner(industry_type_id), sale_orders(academic_year_id, term_id)')
      .eq('organization_id', org).eq('clients.industry_type_id', industryTypeId).range(from, to), 'SCHOOL_SUMMARY_FAILED');
  } catch { refunds = []; }

  const inPeriod = (c: Record<string, unknown>) => {
    if (!filters.academicYearId && !filters.termId) return true;
    const order = c.sale_orders as { academic_year_id?: string | null; term_id?: string | null } | null;
    if (filters.academicYearId && order?.academic_year_id !== filters.academicYearId) return false;
    if (filters.termId && order?.term_id !== filters.termId) return false;
    return true;
  };
  // Cancelled / rejected / still-waiting orders are not sales, so money recorded on them is not counted against sales either.
  const NOT_LIVE = ['cancelled', 'rejected', 'pending_approval'];
  const live = orders.filter((o) => !NOT_LIVE.includes(String(o.status)));
  const countsAsCollected = (c: Record<string, unknown>) => { const status = (c.sale_orders as { status?: string | null } | null)?.status; return !status || !NOT_LIVE.includes(status); };
  const rows = schools.map((school) => {
    const own = live.filter((o) => o.client_id === school.id);
    const mine = collections.filter((c) => c.client_id === school.id && inPeriod(c));
    const paid = mine.filter(countsAsCollected);
    const unappliedCollected = mine.filter((c) => !countsAsCollected(c)).reduce((sum, c) => sum + Number(c.amount ?? 0), 0);
    const returnsCredit = returns.filter((r) => r.client_id === school.id && inPeriod(r)).reduce((sum, r) => sum + Number(r.base_credit ?? r.credit_amount ?? 0), 0);
    const totalSales = own.reduce((sum, o) => sum + Number(o.base_total ?? o.total_amount ?? 0), 0);
    const refunded = refunds.filter((r) => r.client_id === school.id && inPeriod(r)).reduce((sum, r) => sum + Number(r.base_amount ?? r.amount ?? 0), 0);
    const totalCollected = paid.reduce((sum, c) => sum + Number(c.amount ?? 0), 0) - refunded; // net of money paid back
    const details = (school.industry_details ?? {}) as { advanceAmount?: unknown };
    return {
      school, orderCount: own.length, totalSales, totalCollected,
      outstanding: totalSales - returnsCredit - totalCollected < 1 ? 0 : Math.round((totalSales - returnsCredit - totalCollected) * 100) / 100, // under Rs 1 is round-off
      returnsCredit, unappliedCollected, refunded,
      lastOrderDate: own[0]?.created_at ?? null,
      advance: Number(details.advanceAmount ?? 0) || 0,
    };
  });
  return { rows, filters: { academicYearId: filters.academicYearId ?? null, termId: filters.termId ?? null } };
}

/** One school's own orders (with what is still unpaid on each) and payments, newest first - for the ledger drawer. */
export async function schoolLedger(org: string, industryTypeId: string, clientId: string, filters: SchoolSummaryFilters = {}) {
  const { data: school, error: schoolError } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', org).eq('industry_type_id', industryTypeId).maybeSingle();
  if (schoolError) fail('SCHOOL_LEDGER_FAILED', schoolError);
  if (!school) throw new AppError(404, 'CLIENT_NOT_FOUND', 'School not found.');
  let orderQuery = supabaseAdmin.from('sale_orders').select('id, order_number, status, total_amount, base_total, created_at, academic_year_id, term_id, school_academic_years(label), school_terms(name)')
    .eq('organization_id', org).eq('client_id', clientId).order('created_at', { ascending: false }).limit(500);
  if (filters.academicYearId) orderQuery = orderQuery.eq('academic_year_id', filters.academicYearId);
  if (filters.termId) orderQuery = orderQuery.eq('term_id', filters.termId);
  const [{ data: orders, error: ordersError }, { data: collections, error: collectionsError }] = await Promise.all([
    orderQuery,
    supabaseAdmin.from('sales_collections').select('id, sale_order_id, amount, mode, reference_no, collected_at, sale_orders(order_number)').eq('organization_id', org).eq('client_id', clientId).order('collected_at', { ascending: false }).limit(500),
  ]);
  if (ordersError) fail('SCHOOL_LEDGER_FAILED', ordersError);
  if (collectionsError) fail('SCHOOL_LEDGER_FAILED', collectionsError);
  const paidByOrder = new Map<string, number>();
  for (const c of collections ?? []) if (c.sale_order_id) paidByOrder.set(String(c.sale_order_id), (paidByOrder.get(String(c.sale_order_id)) ?? 0) + Number(c.amount ?? 0));
  const creditByOrder = new Map<string, number>();
  const { data: creditRows } = await supabaseAdmin.from('sales_returns').select('order_id, credit_amount').eq('organization_id', org).eq('client_id', clientId).eq('status', 'approved');
  for (const r of creditRows ?? []) creditByOrder.set(String(r.order_id), (creditByOrder.get(String(r.order_id)) ?? 0) + Number(r.credit_amount ?? 0));
  const refundedByOrderId = new Map<string, number>();
  const { data: refundRows } = await supabaseAdmin.from('sales_refunds').select('order_id, amount').eq('organization_id', org).eq('client_id', clientId);
  for (const r of refundRows ?? []) refundedByOrderId.set(String(r.order_id), (refundedByOrderId.get(String(r.order_id)) ?? 0) + Number(r.amount ?? 0));
  const orderIds = new Set((orders ?? []).map((o) => String(o.id)));
  return {
    orders: (orders ?? []).map((o) => {
      const paid = paidByOrder.get(String(o.id)) ?? 0;
      const credit = creditByOrder.get(String(o.id)) ?? 0;
      const refunded = refundedByOrderId.get(String(o.id)) ?? 0;
      const due = Number(o.total_amount ?? 0) - credit - paid + refunded; // money paid back is no longer paid
      const dead = o.status === 'cancelled' || o.status === 'rejected'; // nothing is owed on these
      return { ...o, paid, returns_credit: credit, refunded, balance: dead || due < 1 ? 0 : Math.round(due * 100) / 100 }; // under Rs 1 is round-off
    }),
    collections: (filters.academicYearId || filters.termId) ? (collections ?? []).filter((c) => c.sale_order_id && orderIds.has(String(c.sale_order_id))) : collections ?? [],
  };
}

// ---------------------------------------------------------------- Delivery (School orders only)
export const deliverySchema = z.object({
  status: z.enum(['pending', 'dispatched', 'delivered']),
  receivedBy: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type DeliveryInput = z.infer<typeof deliverySchema>;

/**
 * Pending -> Dispatched -> Delivered for one School order. Stock is taken when the order is DISPATCHED (and given
 * back if the dispatch is undone). Delivered needs the name of the person who received the goods.
 */
export async function updateSchoolDelivery(org: string, industryTypeId: string, orderId: string, input: DeliveryInput) {
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, status, dispatch_status, clients!inner(industry_type_id)')
    .eq('id', orderId).eq('organization_id', org).maybeSingle();
  if (error) fail('SCHOOL_DELIVERY_FAILED', error);
  const industryOf = ((order?.clients as unknown as { industry_type_id?: string | null } | null)?.industry_type_id) ?? null;
  if (!order || industryOf !== industryTypeId) throw new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  if (order.status !== 'confirmed') throw new AppError(422, 'ORDER_NOT_CONFIRMED', 'Only a confirmed order can be dispatched or delivered.');
  const current = String(order.dispatch_status ?? 'pending');
  const target = input.status;
  if (current === target) return order;
  const allowed: Record<string, string[]> = { pending: ['dispatched'], dispatched: ['delivered', 'pending'], delivered: [] };
  if (!(allowed[current] ?? []).includes(target)) {
    throw new AppError(422, 'INVALID_DELIVERY_STEP', current === 'delivered' ? 'A delivered order cannot be changed. Record a sales return instead.' : `An order cannot go from ${current} to ${target}.`);
  }
  const note = input.note?.trim() || null;
  const nowIso = new Date().toISOString();
  if (target === 'delivered' && !input.receivedBy?.trim()) throw new AppError(422, 'RECEIVER_REQUIRED', 'Enter the name of the person at the school who received the goods.');
  // Claim the step first: only one request can move the order out of its current state, so a double click or two users
  // can never take (or give back) the stock twice.
  const previous = (order.dispatch_status ?? null) as string | null;
  const claimBase = supabaseAdmin.from('sale_orders').update({ dispatch_status: target }).eq('id', orderId).eq('organization_id', org);
  const { data: claimed, error: claimError } = await (previous === null ? claimBase.is('dispatch_status', null) : claimBase.eq('dispatch_status', previous)).select('id');
  if (claimError) fail('SCHOOL_DELIVERY_FAILED', claimError);
  if (!claimed || claimed.length === 0) throw new AppError(409, 'DELIVERY_CHANGED', 'This order was just updated by someone else. Refresh and try again.');
  const unclaim = async () => { await supabaseAdmin.from('sale_orders').update({ dispatch_status: previous }).eq('id', orderId).eq('organization_id', org); };
  let patch: Record<string, unknown>;
  if (target === 'dispatched') {
    try { await takeStockForOrder(org, orderId); } catch (stockError) { await unclaim(); throw stockError; } // throws INSUFFICIENT_STOCK (nothing changed) when the shelf is short
    patch = { dispatch_status: 'dispatched', school_dispatched_at: nowIso, school_delivery_note: note };
  } else if (target === 'delivered') {
    const receivedBy = input.receivedBy?.trim();
    if (!receivedBy) throw new AppError(422, 'RECEIVER_REQUIRED', 'Enter the name of the person at the school who received the goods.');
    patch = { dispatch_status: 'delivered', school_delivered_at: nowIso, school_received_by: receivedBy, ...(note ? { school_delivery_note: note } : {}) };
  } else {
    try { await releaseStockForOrder(org, orderId); } catch (stockError) { await unclaim(); throw stockError; }
    patch = { dispatch_status: 'pending', school_dispatched_at: null, school_delivered_at: null, school_received_by: null, school_delivery_note: note };
  }
  const { data: saved, error: saveError } = await supabaseAdmin.from('sale_orders').update(patch).eq('id', orderId).eq('organization_id', org).select().single();
  if (saveError) {
    if (target === 'dispatched') await releaseStockForOrder(org, orderId).catch(() => undefined);
    if (target === 'pending') await takeStockForOrder(org, orderId).catch(() => undefined);
    await unclaim();
    fail('SCHOOL_DELIVERY_FAILED', saveError);
  }
  if (target === 'delivered') await completeOrderIfSettled(org, orderId); // delivered + fully paid -> completed
  return saved;
}

// ---------------------------------------------------------------- Returns & damage (School orders only)
// Same return / damage + approval flow as FMCG (sales-returns.repository). An approved entry is a credit note on the order.
async function assertSchoolOrder(org: string, industryTypeId: string, orderId: string) {
  const { data, error } = await supabaseAdmin.from('sale_orders').select('id, clients!inner(industry_type_id)').eq('id', orderId).eq('organization_id', org).maybeSingle();
  if (error) fail('SCHOOL_RETURNS_FAILED', error);
  if (!data || (data.clients as unknown as { industry_type_id?: string | null } | null)?.industry_type_id !== industryTypeId) throw new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
}
async function assertSchoolReturn(org: string, industryTypeId: string, returnId: string) {
  const { data, error } = await supabaseAdmin.from('sales_returns').select('order_id').eq('id', returnId).eq('organization_id', org).maybeSingle();
  if (error) fail('SCHOOL_RETURNS_FAILED', error);
  if (!data) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return / damage entry not found.');
  await assertSchoolOrder(org, industryTypeId, String(data.order_id));
}
export async function listSchoolOrderReturns(org: string, industryTypeId: string, orderId: string) {
  await assertSchoolOrder(org, industryTypeId, orderId);
  const { data, error } = await supabaseAdmin.from('sales_returns').select('*, products(product_code, product_name)').eq('organization_id', org).eq('order_id', orderId).order('created_at', { ascending: false });
  if (error) fail('SCHOOL_RETURNS_FAILED', error);
  return data ?? [];
}
export async function createSchoolReturn(org: string, userId: string, scope: IndustryScope, industryTypeId: string, input: ReturnInput) {
  await assertSchoolOrder(org, industryTypeId, input.orderId);
  return createReturn(org, userId, scope, input);
}
export async function decideSchoolReturn(org: string, userId: string, scope: IndustryScope, industryTypeId: string, id: string, status: 'approved' | 'rejected') {
  await assertSchoolReturn(org, industryTypeId, id);
  return decideReturn(org, userId, scope, id, status);
}
export async function deleteSchoolReturn(org: string, scope: IndustryScope, industryTypeId: string, id: string) {
  await assertSchoolReturn(org, industryTypeId, id);
  return deleteReturn(org, scope, id);
}

// ---------------------------------------------------------------- Refunds (School orders only)
// When approved return credits leave a school having paid MORE than the order is worth, the extra is money owed back.
// Same rules and table as FMCG refunds (fmcg-refunds.repository).
const money2 = (v: number) => Math.round(v * 100) / 100;
export async function schoolOrderRefunds(org: string, industryTypeId: string, orderId: string) {
  await assertSchoolOrder(org, industryTypeId, orderId);
  const [order, paid, credits, refunds] = await Promise.all([
    supabaseAdmin.from('sale_orders').select('total_amount, status').eq('id', orderId).eq('organization_id', org).maybeSingle(),
    supabaseAdmin.from('sales_collections').select('amount').eq('organization_id', org).eq('sale_order_id', orderId),
    supabaseAdmin.from('sales_returns').select('credit_amount').eq('organization_id', org).eq('order_id', orderId).eq('status', 'approved'),
    supabaseAdmin.from('sales_refunds').select('*').eq('organization_id', org).eq('order_id', orderId).order('created_at', { ascending: false }),
  ]);
  if (order.error) fail('SCHOOL_REFUNDS_FAILED', order.error);
  if (paid.error) fail('SCHOOL_REFUNDS_FAILED', paid.error);
  if (credits.error) fail('SCHOOL_REFUNDS_FAILED', credits.error);
  if (refunds.error && !/sales_refunds/.test(refunds.error.message)) fail('SCHOOL_REFUNDS_FAILED', refunds.error); // table missing = nothing refunded
  const refundRows = refunds.error ? [] : (refunds.data ?? []);
  const sum = (rows: Array<Record<string, unknown>> | null, key: string) => (rows ?? []).reduce((s, r) => s + (Number(r[key] ?? 0) || 0), 0);
  const collected = sum(paid.data, 'amount');
  const credited = sum(credits.data, 'credit_amount');
  const refunded = sum(refundRows, 'amount');
  const due = money2(collected - refunded + credited - Number(order.data?.total_amount ?? 0)); // overpaid and not yet paid back
  return { refunds: refundRows, due: due > 0.005 ? due : 0, orderTotal: money2(Number(order.data?.total_amount ?? 0)), collected: money2(collected), credited: money2(credited), refunded: money2(refunded), orderStatus: order.data?.status ?? null };
}
export async function createSchoolRefund(org: string, userId: string, scope: IndustryScope, industryTypeId: string, input: RefundInput) {
  await assertSchoolOrder(org, industryTypeId, input.orderId);
  return createRefund(org, userId, scope, input);
}