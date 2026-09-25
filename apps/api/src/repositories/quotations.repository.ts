import { AppError } from '../errors/app-error.js';
import { getOrderConfig, getSalesConfig } from '../lib/settings.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { formatOrderNumber } from './orders.repository.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import { logger } from '../lib/logger.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { sendQuotationEmail } from '../services/quotation-email.service.js';
import { getQuotationEmailTemplate } from './quotation-email-templates.repository.js';

const fail = (error: unknown): never => { throw error; };
type ItemInput = { productId: string; quantity: number; discountPercent: number };
type CreateInput = { items: ItemInput[]; validUntil?: string | null; notes?: string | null };
type PublicDecision = { decision: 'accepted' | 'rejected'; reason?: string };
const FULL = '*, clients(id, client_code, client_name, email, industry_type_id), organizations(name), sales_representatives(employee_code, user_profiles(display_name)), quotation_items(*, products(product_code, product_name, category, cost_price, selling_price))';
const PUBLIC = 'id, organization_id, quotation_number, status, valid_until, total_amount, tax_amount, created_at, clients(client_name, industry_type_id), organizations(name), quotation_items(quantity, unit_price, discount_amount, subtotal, tax_percent, tax_amount, products(product_code, product_name))';

function scopeCheck(scope: IndustryScope | undefined, client: unknown) {
  if (scope) assertRecordInScope(scope, (client as { industry_type_id?: string | null } | null)?.industry_type_id, new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.'));
}

export async function createFromRequirement(organizationId: string, representativeId: string, requirementId: string, input: CreateInput) {
  const { data: requirement, error: requirementError } = await supabaseAdmin.from('requirements').select('id, client_id, status').eq('id', requirementId).eq('organization_id', organizationId).eq('representative_id', representativeId).maybeSingle();
  if (requirementError) fail(requirementError);
  if (!requirement) throw new AppError(404, 'REQUIREMENT_NOT_FOUND', 'Requirement not found in this organization.');
  if (requirement.status !== 'open') throw new AppError(422, 'REQUIREMENT_NOT_OPEN', 'A quotation can only be built from an open requirement.');
  const ids = input.items.map((item) => item.productId);
  const { data: products, error: productsError } = await supabaseAdmin.from('products').select('id, selling_price, tax_percent').eq('organization_id', organizationId).eq('status', 'active').in('id', ids);
  if (productsError) fail(productsError);
  if ((products ?? []).length !== ids.length) throw new AppError(422, 'INVALID_QUOTATION_PRODUCT', 'One or more selected products are unavailable.');
  const byId = new Map((products ?? []).map((product) => [product.id, product]));
  const lines = input.items.map((item) => {
    const product = byId.get(item.productId)!;
    const gross = Number(product.selling_price) * item.quantity;
    const discount_amount = Math.round(gross * item.discountPercent) / 100;
    const subtotal = gross - discount_amount;
    const tax_percent = Number(product.tax_percent ?? 0);
    const tax_amount = Math.round(subtotal * tax_percent) / 100;
    return { product_id: product.id, quantity: item.quantity, unit_price: Number(product.selling_price), discount_percent: item.discountPercent, discount_amount, subtotal, tax_percent, tax_amount };
  });
  const quotationNumber = `QT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const subtotalSum = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const taxSum = lines.reduce((sum, line) => sum + line.tax_amount, 0);
  const { data: quotation, error } = await supabaseAdmin.from('quotations').insert({ organization_id: organizationId, quotation_number: quotationNumber, client_id: requirement.client_id, representative_id: representativeId, requirement_id: requirement.id, valid_until: input.validUntil ?? null, discount_amount: lines.reduce((sum, line) => sum + line.discount_amount, 0), tax_amount: taxSum, total_amount: subtotalSum + taxSum, notes: input.notes ?? null }).select().single();
  if (error) fail(error);
  const { error: itemError } = await supabaseAdmin.from('quotation_items').insert(lines.map((line) => ({ ...line, quotation_id: quotation.id })));
  if (itemError) { await supabaseAdmin.from('quotations').delete().eq('id', quotation.id); fail(itemError); }
  await supabaseAdmin.from('requirements').update({ status: 'quoted' }).eq('id', requirement.id).eq('organization_id', organizationId);

  const { data: possibleDuplicates } = await supabaseAdmin
    .from('quotations')
    .select('id, quotation_number, total_amount')
    .eq('organization_id', organizationId)
    .eq('client_id', requirement.client_id)
    .eq('status', 'draft')
    .eq('notes', 'Auto-generated when lead was qualified.')
    .neq('id', quotation.id);

  const created = await getQuotation(organizationId, quotation.id);
  return { ...created, possibleDuplicates: possibleDuplicates ?? [] };
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
   const orderConfig = await getOrderConfig(organizationId);
  const number = formatOrderNumber(orderConfig.numberingFormat);
  // quotation_id must be set here so the Orders page can correctly show
  // this as "converted from a quotation" instead of "Manual entry" — the
  // notes text alone isn't enough, the frontend only trusts quotation_id.
  const { data: order, error } = await supabaseAdmin.from('sale_orders').insert({ organization_id: organizationId, order_number: number, client_id: quotation.client_id, representative_id: quotation.representative_id, discount_amount: quotation.discount_amount, tax_amount: quotation.tax_amount, total_amount: quotation.total_amount, notes: `Converted from quotation ${quotation.quotation_number}`, status: 'confirmed', quotation_id: quotation.id }).select().single();
  if (error) fail(error);
  const items = (quotation.quotation_items as Array<Record<string, unknown>>).map((item) => ({ order_id: order.id, product_id: item.product_id, quantity: item.quantity, unit_price: item.unit_price, discount_amount: item.discount_amount, subtotal: item.subtotal, tax_percent: item.tax_percent ?? 0, tax_amount: item.tax_amount ?? 0 }));
  const { error: itemError } = await supabaseAdmin.from('sale_order_items').insert(items);
  if (itemError) { await supabaseAdmin.from('sale_orders').delete().eq('id', order.id).eq('organization_id', organizationId); fail(itemError); }
  // Conversion is automatic after approval. Mark it explicitly so every
  // consumer can present this quotation as completed rather than actionable.
  const { error: updateError } = await supabaseAdmin.from('quotations').update({ status: 'converted', converted_order_id: order.id }).eq('id', id).eq('organization_id', organizationId); if (updateError) fail(updateError);
  if (quotation.requirement_id) await supabaseAdmin.from('requirements').update({ status: 'converted' }).eq('id', quotation.requirement_id).eq('organization_id', organizationId);
  return getQuotation(organizationId, id, scope);
}
export async function sendQuotation(organizationId: string, representativeId: string | null, id: string, publicAppUrl: string, scope?: IndustryScope) {
  const quotation = await getQuotation(organizationId, id, scope);
  if (representativeId && quotation.representative_id !== representativeId) throw new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.');
  if (!['draft', 'sent'].includes(quotation.status)) throw new AppError(422, 'INVALID_QUOTATION_STATUS', 'Only a draft or sent quotation can be shared.');

  if (quotation.requirement_id) {
    const { data: requirement } = await supabaseAdmin
      .from('requirements')
      .select('status')
      .eq('id', quotation.requirement_id)
      .maybeSingle();
    if (requirement?.status === 'dropped') {
      throw new AppError(422, 'REQUIREMENT_DROPPED', 'This quotation\'s requirement is marked Dropped. Reopen it before sending.');
    }
  }

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
export async function recordPublicDecision(token: string, input: PublicDecision) {
  const quotation = await publicQuotation(token);
  if (quotation.status !== 'sent') throw new AppError(409, 'QUOTATION_ALREADY_DECIDED', 'This quotation has already been decided.');
  const update = input.decision === 'accepted'
    ? { status: 'client_accepted', decision_source: 'client_portal', decided_at: new Date().toISOString(), decided_by: null }
    : { status: 'rejected', decision_source: 'client_portal', decided_at: new Date().toISOString(), decided_by: null, rejection_reason: input.reason?.trim() ?? null };
  const { data, error } = await supabaseAdmin.from('quotations').update(update).eq('id', quotation.id).eq('status', 'sent').select(PUBLIC).maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(409, 'QUOTATION_ALREADY_DECIDED', 'This quotation has already been decided.');

  // ↓ NEW: small quotations skip the manual manager-approval step entirely
  if (input.decision === 'accepted') {
    const salesConfig = await getSalesConfig(quotation.organization_id);
    if (Number(data.total_amount) < salesConfig.approvalRequiredAboveValue) {
      const { error: approveError } = await supabaseAdmin.from('quotations').update({ status: 'accepted', approved_at: new Date().toISOString(), approved_by: null }).eq('id', data.id).eq('organization_id', quotation.organization_id).eq('status', 'client_accepted');
      if (approveError) fail(approveError);
      await finalizeApprovedQuotation(quotation.organization_id, data.id);
      const { data: refreshed, error: refreshError } = await supabaseAdmin.from('quotations').select(PUBLIC).eq('id', data.id).maybeSingle();
      if (refreshError) fail(refreshError);
      return refreshed ?? data;
    }
  }
  return data;
}

// NEW
async function createDealFromApprovedQuotation(quotation: Awaited<ReturnType<typeof getQuotation>>) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('trading_deals')
    .select('*')
    .eq('organization_id', quotation.organization_id)
    .eq('quotation_id', quotation.id)
    .maybeSingle();
  if (existingError) fail(existingError);
  if (existing) return existing;

  const item = (quotation.quotation_items as Array<Record<string, unknown>> | null)?.[0];
  const product = item?.products as { product_name?: string | null; category?: string | null; cost_price?: number | null } | null | undefined;
  const client = quotation.clients as { id?: string; client_name?: string | null; industry_type_id?: string | null } | null;
  const dealNumber = `DEAL-${quotation.quotation_number.replace(/^QT-/, '')}`;
  const payload = {
    organization_id: quotation.organization_id,
    industry_type_id: client?.industry_type_id ?? null,
    quotation_id: quotation.id,
    requirement_id: quotation.requirement_id ?? null,
    deal_number: dealNumber,
    deal_name: `Deal — ${quotation.quotation_number}`,
    customer_id: quotation.client_id,
    customer_name: client?.client_name ?? 'Customer',
    product_name: product?.product_name ?? null,
    product_category: product?.category ?? null,
    quantity: item?.quantity ?? null,
    purchase_rate: product?.cost_price ?? null,
    // Use the quotation's tax-inclusive total_amount (not the item's
    // pre-tax subtotal) so the deal's selling_rate × quantity matches
    // what the Trading Sales Order and Collections modules show —
    // ensureTradingSalesOrder() below already uses quotation.total_amount.
    selling_rate: item?.quantity ? Number(quotation.total_amount) / Number(item.quantity) : item?.unit_price ?? null,
    sales_rep: (quotation.sales_representatives as { user_profiles?: { display_name?: string | null } | null } | null)?.user_profiles?.display_name ?? null,
    currency: 'INR',
    deal_date: new Date().toISOString().slice(0, 10),
    priority: 'Medium',
    status: 'Confirmed',
    notes: `Automatically created from approved quotation ${quotation.quotation_number}.`,
  };
  const { data, error } = await supabaseAdmin.from('trading_deals').insert(payload).select().single();
  if (error) {
    // A concurrent approval retry may win the unique quotation link race.
    if (error.code === '23505') {
      const { data: duplicate, error: duplicateError } = await supabaseAdmin.from('trading_deals').select('*').eq('organization_id', quotation.organization_id).eq('quotation_id', quotation.id).maybeSingle();
      if (duplicateError) fail(duplicateError);
      if (duplicate) return duplicate;
    }
    fail(error);
  }
  return data;
}
// Deal Management only exists in the Trading workspace, so only Trading
// quotations get a Deal + Trading Sales Order. Matched on code, ignoring case,
// because industry_types can hold both 'TRADING' and 'trading'.
async function isTradingIndustry(industryTypeId?: string | null): Promise<boolean> {
  if (!industryTypeId) return false;
  const { data, error } = await supabaseAdmin.from('industry_types').select('code').eq('id', industryTypeId).maybeSingle();
  if (error) fail(error);
  return String(data?.code ?? '').toLowerCase() === 'trading';
}

// Deal -> Sales Order (Trading > Sales Order Management). The number comes from
// the quotation number, so a retry can never create a second order for the deal.
async function ensureTradingSalesOrder(quotation: Awaited<ReturnType<typeof getQuotation>>, deal: Record<string, any>) {
  if (deal.order_number) return null;
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('trading_sales_orders').select('*')
    .eq('organization_id', quotation.organization_id).eq('deal_number', deal.deal_number).limit(1).maybeSingle();
  if (existingError) fail(existingError);
  let order = existing;
  if (!order) {
    const { data, error } = await supabaseAdmin.from('trading_sales_orders').insert({
      organization_id: quotation.organization_id,
      industry_type_id: deal.industry_type_id,
      order_number: `SO-${quotation.quotation_number.replace(/^QT-/, '')}`,
      deal_number: deal.deal_number,
      customer_name: deal.customer_name,
      product_name: deal.product_name,
      quantity: deal.quantity,
      unit: deal.unit ?? null,
      currency: deal.currency,
      selling_rate: deal.selling_rate,
      total_amount: quotation.total_amount,
      order_date: new Date().toISOString().slice(0, 10),
      expected_delivery_date: deal.expected_delivery_date ?? null,
      payment_terms: deal.payment_terms ?? null,
      delivery_terms: deal.delivery_terms ?? null,
      status: 'Confirmed',
      notes: `Automatically created from deal ${deal.deal_number} (quotation ${quotation.quotation_number}).`,
    }).select().single();
    if (error) {
      if (error.code !== '23505') fail(error);
      const { data: duplicate, error: duplicateError } = await supabaseAdmin
        .from('trading_sales_orders').select('*')
        .eq('organization_id', quotation.organization_id).eq('deal_number', deal.deal_number).limit(1).maybeSingle();
      if (duplicateError) fail(duplicateError);
      if (!duplicate) fail(error);
      order = duplicate;
    } else {
      order = data;
    }
  }
  // Link back. Deal page shows its sales order, and the Deal page's own
  // "Confirmed -> create sales order" trigger sees order_number and skips.
  const { error: linkError } = await supabaseAdmin.from('trading_deals').update({ order_number: order!.order_number }).eq('id', deal.id).eq('organization_id', quotation.organization_id);
   if (linkError) fail(linkError);
  return order;
}
// Quotation -> Deal -> Sales Order for Trading. Never throws: a problem here
// must not block the manager's approval or the standard sales order below.
// Sales Order -> Shipment (Trading > Shipment Management). Numbered from the
// quotation number and looked up by order number first, so a retry can never
// create a second shipment for the same order.
async function ensureTradingShipment(quotation: Awaited<ReturnType<typeof getQuotation>>, order: Record<string, any>, deal: Record<string, any>) {
  if (order.shipment_number) return;
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('trading_shipments').select('*')
    .eq('organization_id', quotation.organization_id).eq('order_number', order.order_number).limit(1).maybeSingle();
  if (existingError) fail(existingError);
  let shipment = existing;
  if (!shipment) {
    const { data, error } = await supabaseAdmin.from('trading_shipments').insert({
      organization_id: quotation.organization_id,
      industry_type_id: order.industry_type_id,
      shipment_number: `SHP-${quotation.quotation_number.replace(/^QT-/, '')}`,
      deal_number: order.deal_number,
      order_number: order.order_number,
      customer_name: order.customer_name,
      supplier_name: deal.supplier_name ?? null,
      product_name: order.product_name,
      quantity: order.quantity,
      unit: order.unit ?? null,
      shipment_date: new Date().toISOString().slice(0, 10),
      expected_delivery_date: order.expected_delivery_date ?? null,
      status: 'Planned',
      notes: `Automatically created from sales order ${order.order_number}.`,
    }).select().single();
    if (error) {
      if (error.code !== '23505') fail(error);
      const { data: duplicate, error: duplicateError } = await supabaseAdmin
        .from('trading_shipments').select('*')
        .eq('organization_id', quotation.organization_id).eq('order_number', order.order_number).limit(1).maybeSingle();
      if (duplicateError) fail(duplicateError);
      if (!duplicate) fail(error);
      shipment = duplicate;
    } else {
      shipment = data;
    }
  }
  // Link back so the Sales Order page shows its shipment and its own
  // "Confirmed -> create shipment" trigger sees shipment_number and skips.
  const { error: linkError } = await supabaseAdmin.from('trading_sales_orders').update({ shipment_number: shipment!.shipment_number }).eq('id', order.id).eq('organization_id', quotation.organization_id);
  if (linkError) fail(linkError);
}
async function runTradingChain(quotation: Awaited<ReturnType<typeof getQuotation>>) {
  try {
    if (!(await isTradingIndustry(quotation.clients?.industry_type_id))) return null;
    const deal = await createDealFromApprovedQuotation(quotation);
    const order = await ensureTradingSalesOrder(quotation, deal);
    if (order) await ensureTradingShipment(quotation, order, deal);
    return deal;
  } catch (error) {
    logger.error({ err: error, quotationNumber: quotation.quotation_number }, 'Trading deal / sales order automation failed');
    return null;
  }
}

// Step 4 of the Trading connectivity plan: Collections are only ever
// recorded against the standard core sales order (sale_orders, FS-...),
// never against the Trading Sales Order (trading_sales_orders, SO-...).
// The two numbers share no naming convention, so the only reliable link
// is the one made right here, at the moment both orders exist for the
// same approved quotation. Never blocks approval.
async function linkCoreOrderToDeal(organizationId: string, deal: Record<string, any> | null, coreOrder: { id: string; order_number: string } | null) {
  if (!deal || !coreOrder) return;
  try {
    const { error } = await supabaseAdmin.from('trading_deals').update({ core_order_id: coreOrder.id, core_order_number: coreOrder.order_number }).eq('id', deal.id).eq('organization_id', organizationId);
    if (error) throw error;
  } catch (error) {
    logger.error({ err: error, dealNumber: deal.deal_number }, 'Linking core sales order to Trading deal failed');
  }
}

// Shared by both approveQuotation (manager clicks "Approve") and
// recordPublicDecision's auto-approval path below — same finishing steps
// either way, so we only maintain this logic in one place.
async function finalizeApprovedQuotation(organizationId: string, id: string, scope?: IndustryScope) {
  const quotation = await getQuotation(organizationId, id, scope);
  const tradingDeal = await runTradingChain(quotation);
  const converted = await convertToOrder(organizationId, null, id, scope);
  if (tradingDeal && converted.converted_order_id) {
    const { data: coreOrder } = await supabaseAdmin.from('sale_orders').select('id, order_number').eq('id', converted.converted_order_id).eq('organization_id', organizationId).maybeSingle();
    if (coreOrder) await linkCoreOrderToDeal(organizationId, tradingDeal, coreOrder);
  }
  return converted;
}

export async function approveQuotation(organizationId: string, managerUserId: string, id: string, scope?: IndustryScope) {
  const quotation = await getQuotation(organizationId, id, scope);
  if (quotation.status !== 'client_accepted') throw new AppError(422, 'QUOTATION_NOT_AWAITING_APPROVAL', 'Only a client-accepted quotation can be approved.');
  const { error } = await supabaseAdmin.from('quotations').update({ status: 'accepted', approved_at: new Date().toISOString(), approved_by: managerUserId }).eq('id', id).eq('organization_id', organizationId).eq('status', 'client_accepted');
  if (error) fail(error);
  return finalizeApprovedQuotation(organizationId, id, scope);
}
export async function denyQuotation(organizationId: string, managerUserId: string, id: string, reason: string, scope?: IndustryScope) { const quotation = await getQuotation(organizationId, id, scope); if (quotation.status !== 'client_accepted') throw new AppError(422, 'QUOTATION_NOT_AWAITING_APPROVAL', 'Only a client-accepted quotation can be denied.'); const { data, error } = await supabaseAdmin.from('quotations').update({ status: 'rejected', approved_by: managerUserId, rejection_reason: reason }).eq('id', id).eq('organization_id', organizationId).eq('status', 'client_accepted').select().maybeSingle(); if (error) fail(error); if (!data) throw new AppError(409, 'QUOTATION_NOT_AWAITING_APPROVAL', 'This quotation is no longer awaiting approval.'); return data; }
