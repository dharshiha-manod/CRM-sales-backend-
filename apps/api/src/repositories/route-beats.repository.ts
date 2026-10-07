// FMCG route / beat plans: shared by every admin, visible to the assigned rep.
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

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
  return error ? fail(error) : data;
}
export async function updateBeat(org: string, industryTypeId: string, id: string, input: BeatInput) {
  const ids = await validate(org, industryTypeId, input);
  const { data, error } = await supabaseAdmin.from('route_beats').update({ ...row(input, ids), updated_at: new Date().toISOString() }).eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).select(COLS).maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound();
  return data;
}
export async function deleteBeat(org: string, industryTypeId: string, id: string) {
  const { data, error } = await supabaseAdmin.from('route_beats').delete().eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).select('id');
  if (error) fail(error);
  if (!data || data.length === 0) throw notFound();
}
