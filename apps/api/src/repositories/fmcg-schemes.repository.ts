// FMCG Scheme / Discount master data. Industry-scoped; every row belongs to ONE industry type and never leaks to another.
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

const COLS = 'id, name, description, scheme_type, discount_percent, discount_amount, buy_quantity, free_quantity, slabs, start_date, end_date, status, created_at, fmcg_scheme_products(product_id)';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.').nullable().optional();
const money = z.number().finite().nonnegative().max(1e9).nullable().optional();

export const schemeSchema = z.object({
  name: z.string().trim().min(1, 'Enter a scheme name.').max(160),
  description: z.string().trim().max(500).nullable().optional(),
  schemeType: z.enum(['percentage', 'flat_amount', 'buy_x_get_y', 'slab', 'slab_free', 'value_slab', 'special_price', 'pack_off']),
  discountPercent: z.number().finite().min(0).max(100).nullable().optional(),
  discountAmount: money,
  buyQuantity: money,
  freeQuantity: money,
  slabs: z.array(z.object({
    minQuantity: z.number().finite().positive().optional(), minValue: z.number().finite().positive().optional(),
    discountPercent: z.number().finite().min(0).max(100).optional(), freeQuantity: z.number().finite().positive().optional(),
  })).max(20).optional(),
  startDate: date,
  endDate: date,
  status: z.enum(['active', 'inactive']).optional(),
}).superRefine((v, ctx) => {
  const need = (ok: boolean, path: string, message: string) => { if (!ok) ctx.addIssue({ code: 'custom', path: [path], message }); };
  if (v.schemeType === 'percentage') need(Number(v.discountPercent) > 0, 'discountPercent', 'Enter the discount percentage.');
  if (v.schemeType === 'flat_amount') need(Number(v.discountAmount) > 0, 'discountAmount', 'Enter the flat amount off.');
  if (v.schemeType === 'special_price') need(Number(v.discountAmount) > 0, 'discountAmount', 'Enter the special price per unit.');
  if (v.schemeType === 'pack_off') { need(Number(v.buyQuantity) > 0, 'buyQuantity', 'Enter the pack size.'); need(Number(v.discountAmount) > 0, 'discountAmount', 'Enter the amount off per pack.'); }
  if (v.schemeType === 'slab_free') need((v.slabs ?? []).length > 0 && (v.slabs ?? []).every((s) => s.minQuantity && s.freeQuantity), 'slabs', 'Add at least one slab with a minimum quantity and free units.');
  if (v.schemeType === 'value_slab') need((v.slabs ?? []).length > 0 && (v.slabs ?? []).every((s) => s.minValue && s.discountPercent !== undefined), 'slabs', 'Add at least one slab with a minimum value and discount percent.');
  if (v.schemeType === 'buy_x_get_y') { need(Number(v.buyQuantity) > 0, 'buyQuantity', 'Enter the buy quantity.'); need(Number(v.freeQuantity) > 0, 'freeQuantity', 'Enter the free quantity.'); }
  if (v.schemeType === 'slab') need((v.slabs ?? []).length > 0 && (v.slabs ?? []).every((s) => s.minQuantity && s.discountPercent !== undefined), 'slabs', 'Add at least one quantity slab.');
  if (v.startDate && v.endDate) need(v.endDate >= v.startDate, 'endDate', 'End date cannot be before the start date.');
});
export type SchemeInput = z.infer<typeof schemeSchema>;

const row = (input: SchemeInput) => ({
  name: input.name, description: input.description || null, scheme_type: input.schemeType,
  discount_percent: input.schemeType === 'percentage' ? input.discountPercent ?? null : null,
  // discount_amount doubles as: flat_amount = INR off per unit, special_price = net INR rate per unit, pack_off = INR off per pack.
  discount_amount: ['flat_amount', 'special_price', 'pack_off'].includes(input.schemeType) ? input.discountAmount ?? null : null,
  buy_quantity: input.schemeType === 'buy_x_get_y' || input.schemeType === 'pack_off' ? input.buyQuantity ?? null : null,
  free_quantity: input.schemeType === 'buy_x_get_y' ? input.freeQuantity ?? null : null,
  slabs: ['slab', 'slab_free', 'value_slab'].includes(input.schemeType) ? input.slabs ?? [] : [],
  start_date: input.startDate || null, end_date: input.endDate || null,
  ...(input.status ? { status: input.status } : {}),
});
const shape = (r: Record<string, unknown>) => { const { fmcg_scheme_products, ...rest } = r as { fmcg_scheme_products?: { product_id: string }[] } & Record<string, unknown>; return { ...rest, product_ids: (fmcg_scheme_products ?? []).map((p) => p.product_id) }; };
const fail = (code: string, error: { message: string }) => { throw new AppError(500, code, error.message, error); };
const notFound = () => new AppError(404, 'SCHEME_NOT_FOUND', 'Scheme not found.');

export async function listSchemes(org: string, industryTypeId: string) {
  const { data, error } = await supabaseAdmin.from('fmcg_schemes').select(COLS).eq('organization_id', org).eq('industry_type_id', industryTypeId).order('created_at', { ascending: false });
  if (error) fail('SCHEMES_LIST_FAILED', error);
  return (data ?? []).map((r) => shape(r as Record<string, unknown>));
}
export async function createScheme(org: string, userId: string, industryTypeId: string, input: SchemeInput) {
  const { data, error } = await supabaseAdmin.from('fmcg_schemes').insert({ ...row(input), organization_id: org, industry_type_id: industryTypeId, created_by: userId }).select(COLS).single();
  if (error) fail('SCHEME_SAVE_FAILED', error);
  return shape(data as Record<string, unknown>);
}
export async function updateScheme(org: string, industryTypeId: string, id: string, input: SchemeInput | { status: 'active' | 'inactive' }) {
  const patch = 'schemeType' in input ? { ...row(input), updated_at: new Date().toISOString() } : { status: input.status, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin.from('fmcg_schemes').update(patch).eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).select(COLS).maybeSingle();
  if (error) fail('SCHEME_SAVE_FAILED', error);
  if (!data) throw notFound();
  return shape(data as Record<string, unknown>);
}
export async function setSchemeProducts(org: string, industryTypeId: string, id: string, productIds: string[]) {
  const { data: scheme, error } = await supabaseAdmin.from('fmcg_schemes').select('id').eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).maybeSingle();
  if (error) fail('SCHEME_SAVE_FAILED', error);
  if (!scheme) throw notFound();
  const ids = [...new Set(productIds)];
  if (ids.length) {
    const { data: found, error: productError } = await supabaseAdmin.from('products').select('id').eq('organization_id', org).in('id', ids);
    if (productError) fail('SCHEME_SAVE_FAILED', productError);
    if ((found ?? []).length !== ids.length) throw new AppError(422, 'INVALID_SCHEME_PRODUCT', 'One or more selected products were not found.');
  }
  const { error: deleteError } = await supabaseAdmin.from('fmcg_scheme_products').delete().eq('scheme_id', id).eq('organization_id', org);
  if (deleteError) fail('SCHEME_SAVE_FAILED', deleteError);
  if (ids.length) {
    const { error: insertError } = await supabaseAdmin.from('fmcg_scheme_products').insert(ids.map((product_id) => ({ scheme_id: id, product_id, organization_id: org })));
    if (insertError) fail('SCHEME_SAVE_FAILED', insertError);
  }
  return { id, product_ids: ids };
}
export async function deleteScheme(org: string, industryTypeId: string, id: string) {
  // Quotation/order lines keep the discount they were priced with; their scheme link is simply cleared (on delete set null).
  const { data, error } = await supabaseAdmin.from('fmcg_schemes').delete().eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).select('id');
  if (error) fail('SCHEME_DELETE_FAILED', error);
  if (!data || data.length === 0) throw notFound();
}