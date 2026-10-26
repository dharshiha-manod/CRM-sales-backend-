// School industry master data: academic years + terms, school-specific pricing rules, and the School-wise
// sales & collection summary. Every query is filtered by the School industry_type_id, so rows never mix with
// another industry. Callers must have already proven the request is for the School industry (see school.routes.ts).
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

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
export const ruleSchema = z.object({
  clientId: z.string().uuid('Select a school.'),
  productId: z.string().uuid('Select a product.'),
  discountType: z.enum(['percentage', 'fixed_price']),
  discountPercent: z.number().finite().min(0).max(100).nullable().optional(),
  fixedPrice: z.number().finite().min(0).max(1e9).nullable().optional(),
  minQuantity: z.number().finite().min(0).max(1e9).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.discountType === 'percentage' && !(Number(v.discountPercent) > 0)) ctx.addIssue({ code: 'custom', path: ['discountPercent'], message: 'Enter a discount percentage greater than zero.' });
  if (v.discountType === 'fixed_price' && !(Number(v.fixedPrice) > 0)) ctx.addIssue({ code: 'custom', path: ['fixedPrice'], message: 'Enter a fixed price greater than zero.' });
  if (v.startDate && v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date cannot be before the start date.' });
});
export type RuleInput = z.infer<typeof ruleSchema>;

const RULE_COLS = 'id, client_id, product_id, discount_type, discount_percent, fixed_price, min_quantity, start_date, end_date, status, notes, created_at';
const ruleNotFound = () => new AppError(404, 'PRICING_RULE_NOT_FOUND', 'Pricing rule not found.');
const ruleRow = (input: RuleInput) => ({
  client_id: input.clientId, product_id: input.productId, discount_type: input.discountType,
  discount_percent: input.discountType === 'percentage' ? input.discountPercent ?? null : null,
  fixed_price: input.discountType === 'fixed_price' ? input.fixedPrice ?? null : null,
  min_quantity: input.minQuantity ?? 0, start_date: input.startDate || null, end_date: input.endDate || null,
  notes: input.notes || null, ...(input.status ? { status: input.status } : {}),
});
async function assertSchoolClientAndProduct(org: string, industryTypeId: string, clientId: string, productId: string) {
  const [{ data: client, error: clientError }, { data: product, error: productError }] = await Promise.all([
    supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', org).eq('industry_type_id', industryTypeId).maybeSingle(),
    supabaseAdmin.from('products').select('id').eq('id', productId).eq('organization_id', org).maybeSingle(),
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
  await assertSchoolClientAndProduct(org, industryTypeId, input.clientId, input.productId);
  const { data, error } = await supabaseAdmin.from('school_pricing_rules').insert({ ...ruleRow(input), organization_id: org, industry_type_id: industryTypeId, created_by: userId }).select(RULE_COLS).single();
  if (error) fail('PRICING_RULE_SAVE_FAILED', error);
  return data;
}
export async function updatePricingRule(org: string, industryTypeId: string, id: string, input: RuleInput | { status: 'active' | 'inactive' }) {
  if ('clientId' in input) await assertSchoolClientAndProduct(org, industryTypeId, input.clientId, input.productId);
  const patch = 'clientId' in input ? { ...ruleRow(input), updated_at: new Date().toISOString() } : { status: input.status, updated_at: new Date().toISOString() };
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
    .select('id, client_id, sale_order_id, amount, collected_at, clients!inner(industry_type_id), sale_orders(academic_year_id, term_id)')
    .eq('organization_id', org).eq('clients.industry_type_id', industryTypeId).range(from, to), 'SCHOOL_SUMMARY_FAILED');

  const inPeriod = (c: Record<string, unknown>) => {
    if (!filters.academicYearId && !filters.termId) return true;
    const order = c.sale_orders as { academic_year_id?: string | null; term_id?: string | null } | null;
    if (filters.academicYearId && order?.academic_year_id !== filters.academicYearId) return false;
    if (filters.termId && order?.term_id !== filters.termId) return false;
    return true;
  };
  const live = orders.filter((o) => o.status !== 'cancelled');
  const rows = schools.map((school) => {
    const own = live.filter((o) => o.client_id === school.id);
    const paid = collections.filter((c) => c.client_id === school.id && inPeriod(c));
    const totalSales = own.reduce((sum, o) => sum + Number(o.base_total ?? o.total_amount ?? 0), 0);
    const totalCollected = paid.reduce((sum, c) => sum + Number(c.amount ?? 0), 0);
    const details = (school.industry_details ?? {}) as { advanceAmount?: unknown };
    return {
      school, orderCount: own.length, totalSales, totalCollected,
      outstanding: Math.max(0, totalSales - totalCollected),
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
  const orderIds = new Set((orders ?? []).map((o) => String(o.id)));
  return {
    orders: (orders ?? []).map((o) => ({ ...o, paid: paidByOrder.get(String(o.id)) ?? 0, balance: Math.max(0, Number(o.total_amount ?? 0) - (paidByOrder.get(String(o.id)) ?? 0)) })),
    collections: (filters.academicYearId || filters.termId) ? (collections ?? []).filter((c) => c.sale_order_id && orderIds.has(String(c.sale_order_id))) : collections ?? [],
  };
}
