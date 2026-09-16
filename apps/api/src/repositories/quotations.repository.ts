import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';  

const fail = (error: unknown): never => {
  throw error;
};

type QuotationItemInput = { productId: string; quantity: number; discountPercent: number };
type QuotationCreateInput = { items: QuotationItemInput[]; validUntil?: string | null; notes?: string | null };
const SELECT_WITH_RELATIONS =
  '*, clients(id, client_code, client_name, industry_type_id), sales_representatives(employee_code, user_profiles(display_name)), quotation_items(*, products(product_code, product_name, category, cost_price, selling_price))';
function priceLines(items: QuotationItemInput[], productById: Map<string, { id: string; selling_price: number }>) {
  const lines = items.map((item) => {
    const product = productById.get(item.productId)!;
    const unitPrice = Number(product.selling_price);
    const gross = unitPrice * item.quantity;
    const discountAmount = Math.round(gross * item.discountPercent) / 100;
    return {
      product_id: product.id,
      quantity: item.quantity,
      unit_price: unitPrice,
      discount_percent: item.discountPercent,
      discount_amount: discountAmount,
      subtotal: gross - discountAmount,
    };
  });
  const totalAmount = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const discountAmount = lines.reduce((sum, line) => sum + line.discount_amount, 0);
  return { lines, totalAmount, discountAmount };
}

export async function createFromRequirement(
  organizationId: string,
  representativeId: string,
  requirementId: string,
  input: QuotationCreateInput,
) {
  const { data: requirement, error: requirementError } = await supabaseAdmin
    .from('requirements')
    .select('id, client_id, status')
    .eq('id', requirementId)
    .eq('organization_id', organizationId)
    .eq('representative_id', representativeId)
    .maybeSingle();
  if (requirementError) fail(requirementError);
  if (!requirement) throw new AppError(404, 'REQUIREMENT_NOT_FOUND', 'Requirement not found in this organization.');
  if (requirement.status !== 'open') {
    throw new AppError(422, 'REQUIREMENT_NOT_OPEN', 'A quotation can only be built from an open requirement.');
  }

  const productIds = input.items.map((item) => item.productId);
  const { data: products, error: productError } = await supabaseAdmin
    .from('products')
    .select('id, selling_price')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .in('id', productIds);
  if (productError) fail(productError);
  if ((products ?? []).length !== productIds.length) {
    throw new AppError(422, 'INVALID_QUOTATION_PRODUCT', 'One or more selected products are unavailable.');
  }
  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const { lines, totalAmount, discountAmount } = priceLines(input.items, productById);

  const quotationNumber = `QT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: quotation, error: quotationError } = await supabaseAdmin
    .from('quotations')
    .insert({
      organization_id: organizationId,
      quotation_number: quotationNumber,
      client_id: requirement.client_id,
      representative_id: representativeId,
      requirement_id: requirement.id,
      valid_until: input.validUntil ?? null,
      discount_amount: discountAmount,
      total_amount: totalAmount,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (quotationError) fail(quotationError);

  const { error: itemsError } = await supabaseAdmin
    .from('quotation_items')
    .insert(lines.map((line) => ({ ...line, quotation_id: quotation.id })));
  if (itemsError) {
    await supabaseAdmin.from('quotations').delete().eq('id', quotation.id);
    fail(itemsError);
  }

  await supabaseAdmin
    .from('requirements')
    .update({ status: 'quoted' })
    .eq('id', requirement.id)
    .eq('organization_id', organizationId);

  return getQuotation(organizationId, quotation.id);
}

export async function getQuotation(organizationId: string, id: string, scope?: IndustryScope) {
  const { data, error } = await supabaseAdmin
    .from('quotations')
    .select(SELECT_WITH_RELATIONS)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.');
  if (scope) {
    const clientIndustryTypeId = (data.clients as { industry_type_id?: string | null } | null)?.industry_type_id;
    assertRecordInScope(scope, clientIndustryTypeId, new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.'));
  }
  return data;
}
export async function listQuotations(
  organizationId: string,
  filters: { representativeId?: string; status?: string; clientId?: string; industryTypeId?: string } = {},
) {
  const select = filters.industryTypeId
    ? '*, clients!inner(client_code, client_name, industry_type_id), sales_representatives(employee_code, user_profiles(display_name)), quotation_items(*, products(product_code, product_name))'
    : SELECT_WITH_RELATIONS;
  let query = supabaseAdmin
    .from('quotations')
    .select(select)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (filters.representativeId) query = query.eq('representative_id', filters.representativeId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.clientId) query = query.eq('client_id', filters.clientId);
  if (filters.industryTypeId) query = query.eq('clients.industry_type_id', filters.industryTypeId);
  const { data, error } = await query;
  return error ? fail(error) : data;
}

export async function updateQuotation(
  organizationId: string,
  representativeId: string | null,
  id: string,
  input: { status: string; notes?: string | null },
  scope?: IndustryScope,
) {
  let existingQuery = supabaseAdmin
    .from('quotations')
    .select('id, status, clients(industry_type_id)')
    .eq('id', id)
    .eq('organization_id', organizationId);
  // A sales rep can only touch their own quotations; admins/managers act on
  // any quotation in the organization, so no ownership filter for them.
  if (representativeId) existingQuery = existingQuery.eq('representative_id', representativeId);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) fail(existingError);
  if (!existing) throw new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.');
  if (scope) {
    const clientIndustryTypeId = (existing.clients as { industry_type_id?: string | null } | null)?.industry_type_id;
    assertRecordInScope(scope, clientIndustryTypeId, new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.'));
  }
  if (existing.status === 'converted') {
    throw new AppError(422, 'QUOTATION_ALREADY_CONVERTED', 'A converted quotation cannot change status.');
  }

   const update: Record<string, unknown> = { status: input.status };
  if (input.notes !== undefined) update.notes = input.notes;
  const { data, error } = await supabaseAdmin
    .from('quotations')
    .update(update)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.');

  // NEW — automation: the moment a quotation is accepted, auto-create the
  // Trading deal from it, so the rep never has to manually re-pick the
  // same customer/product/quantity that's already sitting on this
  // quotation. Manual "Add deal" stays available for deals with no prior
  // quotation (walk-in/phone deals).
  if (input.status === 'accepted') {
    const full = await getQuotation(organizationId, id);
    const client = (full as { clients?: { client_name?: string } }).clients;
    const items = (full as { quotation_items?: Array<{ quantity: number; unit_price: number; products?: { product_name?: string; category?: string; cost_price?: number } }> }).quotation_items ?? [];
    const item = items[0];
       if (client?.client_name && item) {
      const dealNumber = `DEAL-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const clientRecord = client as { client_name?: string; id?: string; industry_type_id?: string | null };
      const { error: dealError } = await supabaseAdmin.from('trading_deals').insert({
        organization_id: organizationId,
        deal_number: dealNumber,
        deal_name: `Deal — ${client.client_name}`,
        customer_name: client.client_name,
        customer_id: clientRecord.id ?? null,
        industry_type_id: clientRecord.industry_type_id ?? null,
        product_name: item.products?.product_name ?? null,
        product_category: item.products?.category ?? null,
        product_id: item.product_id ?? null,
        quantity: item.quantity,
        purchase_rate: item.products?.cost_price ?? null,
        selling_rate: item.unit_price,
        status: 'Confirmed',
      });
      if (dealError) console.error('[updateQuotation] failed to auto-create trading deal:', dealError);
    }
  }

  return data;
}
export async function convertToOrder(organizationId: string, representativeId: string | null, id: string, scope?: IndustryScope) {
  let quotationQuery = supabaseAdmin
    .from('quotations')
    .select('*, quotation_items(product_id, quantity, unit_price, discount_amount, subtotal), clients(industry_type_id)')
    .eq('id', id)
    .eq('organization_id', organizationId);
  // Same ownership rule as updateQuotation above — reps are scoped to their
  // own quotations, admins/managers can convert any quotation.
  if (representativeId) quotationQuery = quotationQuery.eq('representative_id', representativeId);
  const { data: quotation, error: quotationError } = await quotationQuery.maybeSingle();
  if (quotationError) fail(quotationError);
  if (!quotation) throw new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.');
  if (scope) {
    const clientIndustryTypeId = (quotation.clients as { industry_type_id?: string | null } | null)?.industry_type_id;
    assertRecordInScope(scope, clientIndustryTypeId, new AppError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in this organization.'));
  }
  if (quotation.status !== 'accepted') {
    throw new AppError(422, 'QUOTATION_NOT_ACCEPTED', 'Only an accepted quotation can be converted into an order.');
  }

  const orderNumber = `FS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: order, error: orderError } = await supabaseAdmin
    .from('sale_orders')
    .insert({
      organization_id: organizationId,
      order_number: orderNumber,
      client_id: quotation.client_id,
      // Attribute the order to whoever the quotation itself belongs to, not
      // to the admin/manager who happened to click "accept" — representativeId
      // here may be null when an admin/manager performed the conversion.
      representative_id: quotation.representative_id,
      discount_amount: quotation.discount_amount,
      tax_amount: quotation.tax_amount,
      total_amount: quotation.total_amount,
      notes: `Converted from quotation ${quotation.quotation_number}`,
      status: 'confirmed',
    })
    .select()
    .single();
  if (orderError) fail(orderError);

  const items = (quotation.quotation_items as Array<Record<string, unknown>>).map((item) => ({
    order_id: order.id,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: item.unit_price,
    discount_amount: item.discount_amount,
    subtotal: item.subtotal,
  }));
  const { error: itemsError } = await supabaseAdmin.from('sale_order_items').insert(items);
  if (itemsError) {
    await supabaseAdmin.from('sale_orders').delete().eq('id', order.id).eq('organization_id', organizationId);
    fail(itemsError);
  }

  const { error: updateError } = await supabaseAdmin
    .from('quotations')
    .update({ status: 'converted', converted_order_id: order.id })
    .eq('id', quotation.id)
    .eq('organization_id', organizationId);
  if (updateError) fail(updateError);

  if (quotation.requirement_id) {
    await supabaseAdmin
      .from('requirements')
      .update({ status: 'converted' })
      .eq('id', quotation.requirement_id)
      .eq('organization_id', organizationId);
  }

  return getQuotation(organizationId, quotation.id);
}