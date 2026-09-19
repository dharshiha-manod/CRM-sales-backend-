import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { sendQuotationEmail } from '../services/quotation-email.service.js';
import { getQuotationEmailTemplate } from './quotation-email-templates.repository.js';

const fail = (error: unknown): never => { throw error; };
type ItemInput = { productId: string; quantity: number; discountPercent: number };
type CreateInput = { items: ItemInput[]; validUntil?: string | null; notes?: string | null };
type PublicDecision = { decision: 'accepted' | 'rejected'; reason?: string };
const FULL = '*, clients(id, client_code, client_name, email, industry_type_id), organizations(name), sales_representatives(employee_code, user_profiles(display_name)), quotation_items(*, products(product_code, product_name, category, cost_price, selling_price))';
const PUBLIC = 'id, organization_id, quotation_number, status, valid_until, total_amount, created_at, clients(client_name, industry_type_id), organizations(name), quotation_items(quantity, unit_price, discount_amount, subtotal, products(product_code, product_name))';

function scopeCheck(scope: IndustryScope | undefined, client: unknown) {
  if (scope) assertRecordInScope(scope, (client as { industry_type_id?: string | null } | null)?.industry_type_id, new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.'));
}

export async function createFromRequirement(organizationId: string, representativeId: string, requirementId: string, input: CreateInput) {
  const { data: requirement, error: requirementError } = await supabaseAdmin.from('requirements').select('id, client_id, status').eq('id', requirementId).eq('organization_id', organizationId).eq('representative_id', representativeId).maybeSingle();
  if (requirementError) fail(requirementError);
  if (!requirement) throw new AppError(404, 'REQUIREMENT_NOT_FOUND', 'Requirement not found in this organization.');
  if (requirement.status !== 'open') throw new AppError(422, 'REQUIREMENT_NOT_OPEN', 'A quotation can only be built from an open requirement.');
  const ids = input.items.map((item) => item.productId);
  const { data: products, error: productsError } = await supabaseAdmin.from('products').select('id, selling_price').eq('organization_id', organizationId).eq('status', 'active').in('id', ids);
  if (productsError) fail(productsError);
  if ((products ?? []).length !== ids.length) throw new AppError(422, 'INVALID_QUOTATION_PRODUCT', 'One or more selected products are unavailable.');
  const byId = new Map((products ?? []).map((product) => [product.id, product]));
  const lines = input.items.map((item) => { const product = byId.get(item.productId)!; const gross = Number(product.selling_price) * item.quantity; const discount_amount = Math.round(gross * item.discountPercent) / 100; return { product_id: product.id, quantity: item.quantity, unit_price: Number(product.selling_price), discount_percent: item.discountPercent, discount_amount, subtotal: gross - discount_amount }; });
  const quotationNumber = `QT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: quotation, error } = await supabaseAdmin.from('quotations').insert({ organization_id: organizationId, quotation_number: quotationNumber, client_id: requirement.client_id, representative_id: representativeId, requirement_id: requirement.id, valid_until: input.validUntil ?? null, discount_amount: lines.reduce((sum, line) => sum + line.discount_amount, 0), total_amount: lines.reduce((sum, line) => sum + line.subtotal, 0), notes: input.notes ?? null }).select().single();
  if (error) fail(error);
  const { error: itemError } = await supabaseAdmin.from('quotation_items').insert(lines.map((line) => ({ ...line, quotation_id: quotation.id })));
  if (itemError) { await supabaseAdmin.from('quotations').delete().eq('id', quotation.id); fail(itemError); }
  await supabaseAdmin.from('requirements').update({ status: 'quoted' }).eq('id', requirement.id).eq('organization_id', organizationId);
  return getQuotation(organizationId, quotation.id);
}

export async function getQuotation(organizationId: string, id: string, scope?: IndustryScope) {
  const { data, error } = await supabaseAdmin.from('quotations').select(FULL).eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.');
  scopeCheck(scope, data.clients); return data;
}
export async function listQuotations(organizationId: string, filters: { representativeId?: string; status?: string; clientId?: string; industryTypeId?: string } = {}) {
  const select = filters.industryTypeId ? '*, clients!inner(client_code, client_name, industry_type_id), sales_representatives(employee_code, user_profiles(display_name)), quotation_items(*, products(product_code, product_name))' : FULL;
  let query = supabaseAdmin.from('quotations').select(select).eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(200);
  if (filters.representativeId) query = query.eq('representative_id', filters.representativeId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.clientId) query = query.eq('client_id', filters.clientId);
  if (filters.industryTypeId) query = query.eq('clients.industry_type_id', filters.industryTypeId);
  const { data, error } = await query; return error ? fail(error) : data;
}
export async function updateQuotation(organizationId: string, representativeId: string | null, decidedBy: string, id: string, input: { status: 'rejected'; notes?: string | null }, scope?: IndustryScope) {
  const quotation = await getQuotation(organizationId, id, scope);
  if (representativeId && quotation.representative_id !== representativeId) throw new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.');
  if (!['draft', 'sent'].includes(quotation.status)) throw new AppError(422, 'INVALID_QUOTATION_STATUS', 'Only a draft or sent quotation can be decided manually.');
  const update = { status: input.status, decision_source: 'manual_rep', decided_at: new Date().toISOString(), decided_by: decidedBy, ...(input.status === 'rejected' ? { rejection_reason: input.notes ?? null } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}) };
  const { error } = await supabaseAdmin.from('quotations').update(update).eq('id', id).eq('organization_id', organizationId); if (error) fail(error);
  return getQuotation(organizationId, id, scope);
}
export async function convertToOrder(organizationId: string, representativeId: string | null, id: string, scope?: IndustryScope) {
  const quotation = await getQuotation(organizationId, id, scope);
  if (representativeId && quotation.representative_id !== representativeId) throw new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.');
  if (quotation.converted_order_id) return quotation;
  if (quotation.status !== 'accepted' || !quotation.approved_at) throw new AppError(422, 'QUOTATION_NOT_APPROVED', 'Only a manager-approved quotation can be converted into an order.');
  const number = `FS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: order, error } = await supabaseAdmin.from('sale_orders').insert({ organization_id: organizationId, order_number: number, client_id: quotation.client_id, representative_id: quotation.representative_id, discount_amount: quotation.discount_amount, tax_amount: quotation.tax_amount, total_amount: quotation.total_amount, notes: `Converted from quotation ${quotation.quotation_number}`, status: 'confirmed' }).select().single();
  if (error) fail(error);
  const items = (quotation.quotation_items as Array<Record<string, unknown>>).map((item) => ({ order_id: order.id, product_id: item.product_id, quantity: item.quantity, unit_price: item.unit_price, discount_amount: item.discount_amount, subtotal: item.subtotal }));
  const { error: itemError } = await supabaseAdmin.from('sale_order_items').insert(items);
  if (itemError) { await supabaseAdmin.from('sale_orders').delete().eq('id', order.id).eq('organization_id', organizationId); fail(itemError); }
  const { error: updateError } = await supabaseAdmin.from('quotations').update({ status: 'accepted', converted_order_id: order.id }).eq('id', id).eq('organization_id', organizationId); if (updateError) fail(updateError);
  if (quotation.requirement_id) await supabaseAdmin.from('requirements').update({ status: 'converted' }).eq('id', quotation.requirement_id).eq('organization_id', organizationId);
  return getQuotation(organizationId, id, scope);
}
export async function sendQuotation(organizationId: string, representativeId: string | null, id: string, publicAppUrl: string, scope?: IndustryScope) {
  const quotation = await getQuotation(organizationId, id, scope);
  if (representativeId && quotation.representative_id !== representativeId) throw new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.');
  if (!['draft', 'sent'].includes(quotation.status)) throw new AppError(422, 'INVALID_QUOTATION_STATUS', 'Only a draft or sent quotation can be shared.');
  const token = quotation.public_token ?? crypto.randomUUID();
  const publicLink = `${publicAppUrl.replace(/\/$/, '')}/quote/${token}`;
  // Deliver first. A failed SMTP attempt must not make a draft look sent.
  const template = quotation.clients?.industry_type_id ? await getQuotationEmailTemplate(organizationId, quotation.clients.industry_type_id, scope) : null;
  await sendQuotationEmail(quotation, publicLink, template);
  const update = quotation.public_token ? { status: 'sent' } : { status: 'sent', public_token: token, token_expires_at: new Date(Date.now() + 2_592_000_000).toISOString() };
  const { error } = await supabaseAdmin.from('quotations').update(update).eq('id', id).eq('organization_id', organizationId); if (error) fail(error);
  return getQuotation(organizationId, id, scope);
}
async function publicQuotation(token: string) { const { data, error } = await supabaseAdmin.from('quotations').select(`${PUBLIC}, public_token, token_expires_at`).eq('public_token', token).maybeSingle(); if (error) fail(error); if (!data || !data.token_expires_at || new Date(data.token_expires_at).getTime() < Date.now()) throw new AppError(404, 'QUOTATION_LINK_NOT_FOUND', 'This quotation link is invalid or has expired.'); return data; }
export async function getPublicQuotation(token: string) { const { public_token: _token, token_expires_at: _expiry, organization_id, clients, ...quotation } = await publicQuotation(token); const industryTypeId = (clients as { industry_type_id?: string | null } | null)?.industry_type_id; const template = industryTypeId ? await getQuotationEmailTemplate(organization_id, industryTypeId) : null; return { ...quotation, clients: clients ? { client_name: (clients as { client_name?: string }).client_name } : null, company_logo_url: template?.logo_url ?? null }; }
export async function recordPublicDecision(token: string, input: PublicDecision) { const quotation = await publicQuotation(token); if (quotation.status !== 'sent') throw new AppError(409, 'QUOTATION_ALREADY_DECIDED', 'This quotation has already been decided.'); const update = input.decision === 'accepted' ? { status: 'client_accepted', decision_source: 'client_portal', decided_at: new Date().toISOString(), decided_by: null } : { status: 'rejected', decision_source: 'client_portal', decided_at: new Date().toISOString(), decided_by: null, rejection_reason: input.reason?.trim() ?? null }; const { data, error } = await supabaseAdmin.from('quotations').update(update).eq('id', quotation.id).eq('status', 'sent').select(PUBLIC).maybeSingle(); if (error) fail(error); if (!data) throw new AppError(409, 'QUOTATION_ALREADY_DECIDED', 'This quotation has already been decided.'); return data; }
export async function approveQuotation(organizationId: string, managerUserId: string, id: string, scope?: IndustryScope) { const quotation = await getQuotation(organizationId, id, scope); if (quotation.status !== 'client_accepted') throw new AppError(422, 'QUOTATION_NOT_AWAITING_APPROVAL', 'Only a client-accepted quotation can be approved.'); const { error } = await supabaseAdmin.from('quotations').update({ status: 'accepted', approved_at: new Date().toISOString(), approved_by: managerUserId }).eq('id', id).eq('organization_id', organizationId).eq('status', 'client_accepted'); if (error) fail(error); return convertToOrder(organizationId, null, id, scope); }
export async function denyQuotation(organizationId: string, managerUserId: string, id: string, reason: string, scope?: IndustryScope) { const quotation = await getQuotation(organizationId, id, scope); if (quotation.status !== 'client_accepted') throw new AppError(422, 'QUOTATION_NOT_AWAITING_APPROVAL', 'Only a client-accepted quotation can be denied.'); const { data, error } = await supabaseAdmin.from('quotations').update({ status: 'rejected', approved_by: managerUserId, rejection_reason: reason }).eq('id', id).eq('organization_id', organizationId).eq('status', 'client_accepted').select().maybeSingle(); if (error) fail(error); if (!data) throw new AppError(409, 'QUOTATION_NOT_AWAITING_APPROVAL', 'This quotation is no longer awaiting approval.'); return data; }
