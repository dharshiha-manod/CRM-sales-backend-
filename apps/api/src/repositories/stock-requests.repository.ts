import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

const fail = (error: unknown): never => { throw error; };

export type StockRequestInput = {
  productId: string; quantity: number; reason?: string | null; requiredDate?: string | null; remarks?: string | null; requestedTo?: string | null;
};

export async function representativeForUser(org: string, userId: string) {
  const { data, error } = await supabaseAdmin.from('sales_representatives').select('id, employee_code, user_profiles(display_name)').eq('organization_id', org).eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(403, 'REPRESENTATIVE_PROFILE_REQUIRED', 'An active sales representative profile is required');
  return data as { id: string; employee_code: string };
}

export async function createStockRequest(org: string, userId: string, input: StockRequestInput) {
  const rep = await representativeForUser(org, userId);
  const { data: product, error: productError } = await supabaseAdmin.from('products').select('id').eq('organization_id', org).eq('id', input.productId).eq('status', 'active').maybeSingle();
  if (productError) fail(productError);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
  const { data, error } = await supabaseAdmin.from('stock_requests').insert({
    organization_id: org, product_id: input.productId, representative_id: rep.id, quantity: input.quantity,
    reason: input.reason || null, required_date: input.requiredDate || null, remarks: input.remarks || null, requested_to: input.requestedTo || null, status: 'pending',
  }).select().single();
  if (error) fail(error);
  return data;
}

// Managers/admins see every request (optionally limited to one industry); a rep sees only their own.
export async function listStockRequests(org: string, opts: { representativeId?: string; industryTypeId?: string | null }) {
  let productIds: string[] | null = null;
  if (opts.industryTypeId) {
    const { data: tags, error: tagError } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', org).eq('industry_type_id', opts.industryTypeId);
    if (tagError) fail(tagError);
    productIds = (tags ?? []).map((t) => t.product_id as string);
    if (productIds.length === 0) return [];
  }
  let query = supabaseAdmin.from('stock_requests')
    .select('*, products(product_name, product_code), sales_representatives(employee_code, user_profiles(display_name))')
    .eq('organization_id', org).order('created_at', { ascending: false }).limit(200);
  if (opts.representativeId) query = query.eq('representative_id', opts.representativeId);
  if (productIds) query = query.in('product_id', productIds);
  const { data, error } = await query;
  if (error) fail(error);
  return data ?? [];
}

export async function decideStockRequest(org: string, userId: string, id: string, status: 'approved' | 'rejected', note?: string | null) {
  const { data: current, error } = await supabaseAdmin.from('stock_requests').select('id, status').eq('organization_id', org).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!current) throw new AppError(404, 'REQUEST_NOT_FOUND', 'Stock request was not found.');
  if (current.status !== 'pending') throw new AppError(422, 'REQUEST_NOT_PENDING', `This request is already ${current.status}.`);
  const { data, error: updateError } = await supabaseAdmin.from('stock_requests')
    .update({ status, decided_by: userId, decided_at: new Date().toISOString(), decision_note: note || null })
    .eq('organization_id', org).eq('id', id).eq('status', 'pending').select().maybeSingle();
  if (updateError) fail(updateError);
  if (!data) throw new AppError(409, 'REQUEST_CHANGED', 'This request was just changed by someone else. Refresh and try again.');
  return data;
}

// Used by "assign": the request must be approved and match the rep and product being assigned.
export async function assertApprovedRequest(org: string, requestId: string, representativeId: string, productId: string) {
  const { data, error } = await supabaseAdmin.from('stock_requests').select('id, status, representative_id, product_id').eq('organization_id', org).eq('id', requestId).maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(404, 'REQUEST_NOT_FOUND', 'Stock request was not found.');
  if (data.status !== 'approved') throw new AppError(422, 'REQUEST_NOT_APPROVED', `This request is ${data.status}, so it cannot be fulfilled.`);
  if (data.representative_id !== representativeId || data.product_id !== productId) throw new AppError(422, 'REQUEST_MISMATCH', 'The rep or product does not match this request.');
}

export async function markRequestFulfilled(org: string, requestId: string, movementId: string) {
  const { error } = await supabaseAdmin.from('stock_requests').update({ status: 'fulfilled', fulfilled_movement_id: movementId }).eq('organization_id', org).eq('id', requestId).eq('status', 'approved');
  if (error) fail(error);
}