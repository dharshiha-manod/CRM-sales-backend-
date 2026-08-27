import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';

const fail = (error: unknown): never => { throw error; };
const distanceMeters = (latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) => {
  const radians = (value: number) => value * Math.PI / 180;
  const a = Math.sin(radians(latitudeB - latitudeA) / 2) ** 2 + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(radians(longitudeB - longitudeA) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export async function findCurrentRepresentative(organizationId: string, userId: string) {
  const { data, error } = await supabaseAdmin.from('sales_representatives').select('id, employee_code, user_profiles(display_name)').eq('organization_id', organizationId).eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (error) fail(error);
  if (!data) throw new AppError(403, 'REPRESENTATIVE_PROFILE_REQUIRED', 'An active sales representative profile is required to record field activity.');
  return data;
}

export async function listAssignedClients(organizationId: string, representativeId: string) {
  const { data, error } = await supabaseAdmin.from('sales_representative_client_assignments').select('clients(id, client_code, client_name, city)').eq('organization_id', organizationId).eq('sales_representative_id', representativeId).eq('status', 'active').order('assigned_at', { ascending: false });
  return error ? fail(error) : (data ?? []).map((row) => row.clients).filter(Boolean);
}

export async function listNearbyAssignedClients(organizationId: string, representativeId: string, latitude: number, longitude: number, radiusMeters: number) {
  const { data, error } = await supabaseAdmin.from('sales_representative_client_assignments').select('clients(id, client_code, client_name, city, latitude, longitude, gps_radius_meters)').eq('organization_id', organizationId).eq('sales_representative_id', representativeId).eq('status', 'active');
  if (error) fail(error);
  type NearbyClient = { id: string; client_code: string; client_name: string; city?: string | null; latitude: number | null; longitude: number | null; gps_radius_meters?: number | null };
  return (data ?? []).flatMap((row) => {
    const related = row.clients as unknown;
    const client = (Array.isArray(related) ? related[0] : related) as NearbyClient | null;
    if (!client || client.latitude == null || client.longitude == null) return [];
    return [{ ...client, distanceMeters: Math.round(distanceMeters(latitude, longitude, Number(client.latitude), Number(client.longitude))) }];
  }).filter((client) => client.distanceMeters <= radiusMeters).sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export async function checkIn(organizationId: string, representativeId: string, input: Record<string, unknown>) {
  const location = input.location as { latitude: number; longitude: number; accuracyMeters?: number | null };
  let distance: number | null = null; let withinGeofence: boolean | null = null;
  if (input.clientId) {
    const { data: client, error: clientError } = await supabaseAdmin.from('clients').select('latitude, longitude, gps_radius_meters').eq('id', input.clientId as string).eq('organization_id', organizationId).maybeSingle();
    if (clientError) fail(clientError);
    if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'The selected client was not found.');
    if (client.latitude != null && client.longitude != null) { distance = Math.round(distanceMeters(location.latitude, location.longitude, Number(client.latitude), Number(client.longitude))); withinGeofence = distance <= Number(client.gps_radius_meters ?? 150); }
  }
  const { data, error } = await supabaseAdmin.from('field_visits').insert({ organization_id: organizationId, representative_id: representativeId, client_id: input.clientId, unlisted_client_name: input.unlistedClientName, notes: input.notes, check_in_lat: location.latitude, check_in_lng: location.longitude, check_in_accuracy_meters: location.accuracyMeters, check_in_distance_meters: distance, check_in_within_geofence: withinGeofence, status: 'checked_in' }).select('*, clients(client_code, client_name), sales_representatives(employee_code, user_profiles(display_name))').single();
  return error ? fail(error) : data;
}

export async function addPing(organizationId: string, representativeId: string, visitId: string, input: Record<string, unknown>) {
  const { data: visit, error: visitError } = await supabaseAdmin.from('field_visits').select('id').eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).in('status', ['checked_in', 'in_progress']).maybeSingle();
  if (visitError) fail(visitError); if (!visit) throw new AppError(404, 'ACTIVE_VISIT_NOT_FOUND', 'An active visit was not found.');
  const location = input.location as { latitude: number; longitude: number; accuracyMeters?: number | null };
  const { data, error } = await supabaseAdmin.from('field_activity_pings').insert({ organization_id: organizationId, visit_id: visitId, representative_id: representativeId, latitude: location.latitude, longitude: location.longitude, accuracy_meters: location.accuracyMeters }).select().single();
  return error ? fail(error) : data;
}

export async function checkOut(organizationId: string, representativeId: string, visitId: string, input: Record<string, unknown>) {
  const location = input.location as { latitude: number; longitude: number; accuracyMeters?: number | null };
  const { data: activeVisit, error: visitError } = await supabaseAdmin.from('field_visits').select('id, clients(latitude, longitude, gps_radius_meters)').eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).in('status', ['checked_in', 'in_progress']).maybeSingle();
  if (visitError) fail(visitError); if (!activeVisit) throw new AppError(404, 'ACTIVE_VISIT_NOT_FOUND', 'An active visit was not found.');
  const client = activeVisit.clients as { latitude?: number | null; longitude?: number | null; gps_radius_meters?: number | null } | null;
  const distance = client?.latitude != null && client.longitude != null ? Math.round(distanceMeters(location.latitude, location.longitude, Number(client.latitude), Number(client.longitude))) : null;
  const withinGeofence = distance === null ? null : distance <= Number(client?.gps_radius_meters ?? 150);
  const { data, error } = await supabaseAdmin.from('field_visits').update({ check_out_lat: location.latitude, check_out_lng: location.longitude, check_out_accuracy_meters: location.accuracyMeters, check_out_distance_meters: distance, check_out_within_geofence: withinGeofence, check_out_time: new Date().toISOString(), notes: input.notes, outcome: input.outcome, status: 'checked_out' }).eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).in('status', ['checked_in', 'in_progress']).select('*, clients(client_code, client_name)').maybeSingle();
  if (error) fail(error); if (!data) throw new AppError(404, 'ACTIVE_VISIT_NOT_FOUND', 'An active visit was not found.'); return data;
}

export async function listVisits(organizationId: string, representativeId?: string) {
  let query = supabaseAdmin.from('field_visits').select('*, clients(client_code, client_name), sales_representatives(employee_code, user_profiles(display_name))').eq('organization_id', organizationId).order('check_in_time', { ascending: false }).limit(100);
  if (representativeId) query = query.eq('representative_id', representativeId);
  const { data, error } = await query; return error ? fail(error) : data;
}

export async function listVisitActivities(organizationId: string, visitId: string, representativeId?: string) {
  let query = supabaseAdmin.from('visit_activities').select('*').eq('organization_id', organizationId).eq('visit_id', visitId).order('created_at', { ascending: false });
  if (representativeId) query = query.eq('representative_id', representativeId);
  const { data, error } = await query; return error ? fail(error) : data;
}

export async function createVisitActivity(organizationId: string, representativeId: string, visitId: string, input: Record<string, unknown>) {
  const map = { personMet: 'person_met', expectedQuantity: 'expected_quantity', expectedValue: 'expected_value', photoUrl: 'photo_url' } as Record<string, string>;
  const payload = Object.fromEntries(Object.entries(input).map(([key, value]) => [map[key] ?? key, value]));
  const { data, error } = await supabaseAdmin.from('visit_activities').insert({ ...payload, organization_id: organizationId, representative_id: representativeId, visit_id: visitId }).select().single();
  return error ? fail(error) : data;
}

export async function listLiveVisits(organizationId: string) {
  const { data: visits, error } = await supabaseAdmin.from('field_visits').select('id, status, check_in_time, check_in_lat, check_in_lng, clients(client_code, client_name), sales_representatives(employee_code, user_profiles(display_name))').eq('organization_id', organizationId).in('status', ['checked_in', 'in_progress']).order('check_in_time', { ascending: false });
  if (error) fail(error);
  const ids = (visits ?? []).map((visit) => visit.id);
  if (!ids.length) return [];
  const { data: pings, error: pingError } = await supabaseAdmin.from('field_activity_pings').select('visit_id, latitude, longitude, accuracy_meters, captured_at').in('visit_id', ids).order('captured_at', { ascending: false });
  if (pingError) fail(pingError);
  const latest = new Map<string, unknown>(); for (const ping of pings ?? []) if (!latest.has(ping.visit_id)) latest.set(ping.visit_id, ping);
  return (visits ?? []).map((visit) => ({ ...visit, latest_ping: latest.get(visit.id) ?? null }));
}
