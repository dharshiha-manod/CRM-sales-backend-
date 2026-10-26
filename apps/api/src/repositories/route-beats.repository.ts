// FMCG route / beat plans: shared by every admin, visible to the assigned rep.
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { replanBeatToday, syncAssignments, type BeatRow } from '../services/beat-automation.service.js';

const fail = (error: unknown): never => { throw error; };
const COLS = '*, sales_representatives(employee_code, user_profiles(display_name))';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const beatSchema = z.object({
  name: z.string().trim().min(1, 'Enter a beat name.').max(120),
  area: z.string().trim().max(160).optional().nullable(),
  representativeId: z.string().uuid().optional().nullable(),
  days: z.array(z.enum(DAYS)).max(7).default([]),
  status: z.enum(['active', 'inactive']).default('active'),
  clientIds: z.array(z.string().uuid()).max(500).default([]),
});
export type BeatInput = z.infer<typeof beatSchema>;
const notFound = () => new AppError(404, 'BEAT_NOT_FOUND', 'Route / beat not found.');

async function validate(org: string, industryTypeId: string, input: BeatInput) {
  const ids = [...new Set(input.clientIds)];
  if (ids.length) {
    const { data, error } = await supabaseAdmin.from('clients').select('id').eq('organization_id', org).eq('industry_type_id', industryTypeId).in('id', ids);
    if (error) fail(error);
    if ((data ?? []).length !== ids.length) throw new AppError(422, 'INVALID_BEAT_CLIENT', 'Every outlet on a beat must be an FMCG client.');
  }
  if (input.representativeId) {
    const { data, error } = await supabaseAdmin.from('sales_representatives').select('id').eq('organization_id', org).eq('id', input.representativeId).eq('status', 'active').maybeSingle();
    if (error) fail(error);
    if (!data) throw new AppError(422, 'INVALID_REPRESENTATIVE', 'Select an active sales representative.');
  }
  return ids;
}
const row = (input: BeatInput, ids: string[]) => ({ name: input.name, area: input.area || null, representative_id: input.representativeId || null, days: input.days, status: input.status, client_ids: ids });

export async function listBeats(org: string, industryTypeId: string, representativeId?: string) {
  let query = supabaseAdmin.from('route_beats').select(COLS).eq('organization_id', org).eq('industry_type_id', industryTypeId).order('created_at', { ascending: false });
  if (representativeId) query = query.eq('representative_id', representativeId).eq('status', 'active');
  const { data, error } = await query;
  if (error) fail(error);
  return data ?? [];
}
export async function createBeat(org: string, userId: string, industryTypeId: string, input: BeatInput) {
  const ids = await validate(org, industryTypeId, input);
  const { data, error } = await supabaseAdmin.from('route_beats').insert({ ...row(input, ids), organization_id: org, industry_type_id: industryTypeId, created_by: userId }).select(COLS).single();
  if (error) return fail(error);
  if (input.representativeId && ids.length) await syncAssignments(org, input.representativeId, ids);
  await replanBeatToday(data as BeatRow);
  return data;
}
export async function updateBeat(org: string, industryTypeId: string, id: string, input: BeatInput) {
  const ids = await validate(org, industryTypeId, input);
  const { data, error } = await supabaseAdmin.from('route_beats').update({ ...row(input, ids), updated_at: new Date().toISOString() }).eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).select(COLS).maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound();
  if (input.representativeId && ids.length) await syncAssignments(org, input.representativeId, ids);
  await replanBeatToday(data as BeatRow);
  return data;
}
export async function deleteBeat(org: string, industryTypeId: string, id: string) {
  const { data, error } = await supabaseAdmin.from('route_beats').delete().eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).select('id');
  if (error) fail(error);
  if (!data || data.length === 0) throw notFound();
}

export type OutletOrderStatus = {
  lastOrder: { orderNumber: string; status: string; dispatchStatus: string | null; createdAt: string } | null;
  shipment: { shipmentNo: string; status: string; expectedArrival: string | null } | null;
};

/** For every outlet on an FMCG beat: its latest order and any shipment still on the way (packed / dispatched). Read-only. */
export async function outletOrderStatus(org: string, industryTypeId: string) {
  const { data: beats, error: beatsError } = await supabaseAdmin.from('route_beats').select('client_ids').eq('organization_id', org).eq('industry_type_id', industryTypeId);
  if (beatsError) fail(beatsError);
  const clientIds = [...new Set((beats ?? []).flatMap((b) => ((b as { client_ids: string[] | null }).client_ids ?? [])))];
  const result: Record<string, OutletOrderStatus> = Object.fromEntries(clientIds.map((id) => [id, { lastOrder: null, shipment: null }]));
  const clientByOrder = new Map<string, string>();

  for (let i = 0; i < clientIds.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('sale_orders')
      .select('id, order_number, client_id, status, dispatch_status, created_at')
      .eq('organization_id', org).in('client_id', clientIds.slice(i, i + 100)).not('status', 'in', '(cancelled,rejected)')
      .order('created_at', { ascending: false });
    if (error) fail(error);
    for (const o of (data ?? []) as Array<{ id: string; order_number: string; client_id: string; status: string; dispatch_status: string | null; created_at: string }>) {
      clientByOrder.set(o.id, o.client_id);
      if (!result[o.client_id].lastOrder) result[o.client_id].lastOrder = { orderNumber: o.order_number, status: o.status, dispatchStatus: o.dispatch_status, createdAt: o.created_at };
    }
  }

  const orderIds = [...clientByOrder.keys()];
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('fmcg_shipments')
      .select('order_id, shipment_no, status, expected_arrival')
      .eq('organization_id', org).in('order_id', orderIds.slice(i, i + 100)).in('status', ['packed', 'dispatched'])
      .order('created_at', { ascending: false });
    if (error) fail(error);
    for (const s of (data ?? []) as Array<{ order_id: string; shipment_no: string; status: string; expected_arrival: string | null }>) {
      const clientId = clientByOrder.get(s.order_id);
      if (clientId && !result[clientId].shipment) result[clientId].shipment = { shipmentNo: s.shipment_no, status: s.status, expectedArrival: s.expected_arrival };
    }
  }
  return result;
}