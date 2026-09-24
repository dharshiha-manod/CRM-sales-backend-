import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { getVisitConfig, getTrackingRulesConfig, getGpsConfig, getCheckInOutConfig } from '../lib/settings.js';
const fail = (error: unknown): never => { throw error; };
// Settings → GPS & Location → "Verification enabled" + "Minimum accuracy (meters)"
async function assertGpsAccuracy(organizationId: string, accuracyMeters?: number | null) {
  const gpsConfig = await getGpsConfig(organizationId);
  if (!gpsConfig.verificationEnabled || accuracyMeters == null) return;
  if (accuracyMeters > gpsConfig.minAccuracyMeters) {
    throw new AppError(422, 'GPS_ACCURACY_TOO_LOW', `GPS accuracy is ${Math.round(accuracyMeters)} m, but at least ${gpsConfig.minAccuracyMeters} m is required. Move to open sky and try again.`);
  }
}
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
  const visitConfig = await getVisitConfig(organizationId);
  const location = input.location as { latitude: number; longitude: number; accuracyMeters?: number | null };
  await assertGpsAccuracy(organizationId, location.accuracyMeters);
  let distance: number | null = null; let withinGeofence: boolean | null = null;
  if (input.clientId) {
    const { data: client, error: clientError } = await supabaseAdmin.from('clients').select('latitude, longitude, gps_radius_meters').eq('id', input.clientId as string).eq('organization_id', organizationId).maybeSingle();
    if (clientError) fail(clientError);
    if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'The selected client was not found.');
    if (client.latitude != null && client.longitude != null) { distance = Math.round(distanceMeters(location.latitude, location.longitude, Number(client.latitude), Number(client.longitude))); withinGeofence = distance <= Number(client.gps_radius_meters ?? visitConfig.radiusMeters); }
    // Settings → Visit Configuration → Mandatory GPS verification
    if (visitConfig.mandatoryGpsVerification && withinGeofence === false) throw new AppError(422, 'OUTSIDE_GEOFENCE', `You are ${distance} m from the client, outside the allowed ${client.gps_radius_meters ?? visitConfig.radiusMeters} m radius. Move closer to check in.`);
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
  const visitConfig = await getVisitConfig(organizationId);
  const location = input.location as { latitude: number; longitude: number; accuracyMeters?: number | null };
  await assertGpsAccuracy(organizationId, location.accuracyMeters);
  const notes = input.notes as string | null | undefined;
  const { data: activeVisit, error: visitError } = await supabaseAdmin.from('field_visits').select('id, check_in_time, clients(latitude, longitude, gps_radius_meters)').eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).in('status', ['checked_in', 'in_progress']).maybeSingle();
  if (visitError) fail(visitError); if (!activeVisit) throw new AppError(404, 'ACTIVE_VISIT_NOT_FOUND', 'An active visit was not found.');
  // Settings → Visit Configuration → Minimum visit duration
  if (activeVisit.check_in_time) {
    const elapsedMinutes = (Date.now() - new Date(activeVisit.check_in_time).getTime()) / 60000;
    if (elapsedMinutes < visitConfig.minDurationMinutes) throw new AppError(422, 'VISIT_TOO_SHORT', `This visit must last at least ${visitConfig.minDurationMinutes} minute(s) before checking out.`);
  }
  // Settings → Visit Configuration → Require notes
  if (visitConfig.requireNotes && !(notes && notes.trim())) throw new AppError(422, 'VISIT_NOTES_REQUIRED', 'Notes are required to check out of this visit.');
  const client = activeVisit.clients as { latitude?: number | null; longitude?: number | null; gps_radius_meters?: number | null } | null;
  const distance = client?.latitude != null && client.longitude != null ? Math.round(distanceMeters(location.latitude, location.longitude, Number(client.latitude), Number(client.longitude))) : null;
  const withinGeofence = distance === null ? null : distance <= Number(client?.gps_radius_meters ?? visitConfig.radiusMeters);
  // Settings → Visit Configuration → Mandatory GPS verification
  if (visitConfig.mandatoryGpsVerification && withinGeofence === false) throw new AppError(422, 'OUTSIDE_GEOFENCE', `You are ${distance} m from the client, outside the allowed ${client?.gps_radius_meters ?? visitConfig.radiusMeters} m radius. Move closer to check out.`);
  const { data, error } = await supabaseAdmin.from('field_visits').update({check_out_lat: location.latitude, check_out_lng: location.longitude, check_out_accuracy_meters: location.accuracyMeters, check_out_distance_meters: distance, check_out_within_geofence: withinGeofence, check_out_time: new Date().toISOString(), notes: input.notes, outcome: input.outcome, status: 'checked_out' }).eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', representativeId).in('status', ['checked_in', 'in_progress']).select('*, clients(client_code, client_name)').maybeSingle();
  if (error) fail(error); if (!data) throw new AppError(404, 'ACTIVE_VISIT_NOT_FOUND', 'An active visit was not found.');
  // Automatic follow-up: only when the rep explicitly flagged the visit as
  // needing one, and only if this visit doesn't already have one (avoids
  // duplicates if checkout is ever retried).
  if (data.outcome === 'follow_up_needed' && data.client_id) {
    const { data: existingFollowUp } = await supabaseAdmin.from('follow_ups').select('id').eq('visit_id', visitId).eq('organization_id', organizationId).maybeSingle();
    if (!existingFollowUp) {
      const clientName = (data.clients as { client_name?: string } | null)?.client_name ?? 'client';
      const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      const { error: followUpError } = await supabaseAdmin.from('follow_ups').insert({ organization_id: organizationId, representative_id: representativeId, client_id: data.client_id, visit_id: visitId, title: `Follow up with ${clientName}`, due_at: dueAt, priority: 'high', notes: input.notes ?? null });
      if (followUpError) console.error('Auto follow-up creation failed for visit', visitId, followUpError);
    }
  }
  return data;
}

// Settings → Check-in/Check-out Configuration → Auto checkout (minutes).
// This codebase has no background job runner (see syncOverdueCollectionFollowUps
// in follow-ups.repository.ts for the same constraint), so this runs
// opportunistically on read instead of on a schedule: any visit still
// "checked_in"/"in_progress" past the threshold gets force-checked-out the
// next time a visit list is fetched, by admin or by the rep's own app.
async function sweepStaleCheckIns(organizationId: string) {
  const checkInOutConfig = await getCheckInOutConfig(organizationId);
  if (!checkInOutConfig.autoCheckoutAfterMinutes || checkInOutConfig.autoCheckoutAfterMinutes <= 0) return;
  const cutoff = new Date(Date.now() - checkInOutConfig.autoCheckoutAfterMinutes * 60000).toISOString();
  const { data: stale, error } = await supabaseAdmin.from('field_visits').select('id, notes').eq('organization_id', organizationId).in('status', ['checked_in', 'in_progress']).lt('check_in_time', cutoff);
  if (error) { console.error('Auto checkout sweep failed', error); return; }
  for (const visit of stale ?? []) {
    const notes = `${visit.notes ? visit.notes + '\n' : ''}Auto checked-out by system after ${checkInOutConfig.autoCheckoutAfterMinutes} minute(s) with no check-out.`;
    const { error: updateError } = await supabaseAdmin.from('field_visits').update({ status: 'checked_out', check_out_time: new Date().toISOString(), notes }).eq('id', visit.id).eq('organization_id', organizationId).in('status', ['checked_in', 'in_progress']);
    if (updateError) console.error('Auto checkout failed for visit', visit.id, updateError);
  }
}

export async function listVisits(organizationId: string, representativeId?: string, industryTypeId?: string | null) {
  await sweepStaleCheckIns(organizationId);
  const select = industryTypeId
    ? '*, clients!inner(client_code, client_name, industry_type_id), sales_representatives(employee_code, user_profiles(display_name))'
    : '*, clients(client_code, client_name), sales_representatives(employee_code, user_profiles(display_name))';
  let query = supabaseAdmin.from('field_visits').select(select).eq('organization_id', organizationId).order('check_in_time', { ascending: false }).limit(100);
  if (representativeId) query = query.eq('representative_id', representativeId);
  if (industryTypeId) query = query.eq('clients.industry_type_id', industryTypeId);
  const { data, error } = await query; return error ? fail(error) : data;
}
export async function listVisitActivities(organizationId: string, visitId: string, representativeId?: string, scope?: IndustryScope) {
  if (scope) {
    const { data: visit, error: visitError } = await supabaseAdmin.from('field_visits').select('id, clients(industry_type_id)').eq('id', visitId).eq('organization_id', organizationId).maybeSingle();
    if (visitError) fail(visitError);
    if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Visit not found in this organization.');
    const clientIndustryTypeId = (visit.clients as { industry_type_id?: string | null } | null)?.industry_type_id;
    assertRecordInScope(scope, clientIndustryTypeId, new AppError(404, 'VISIT_NOT_FOUND', 'Visit not found in this organization.'));
  }
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

export async function listLiveVisits(organizationId: string, industryTypeId?: string | null) {
  await sweepStaleCheckIns(organizationId);
  const trackingConfig = await getTrackingRulesConfig(organizationId);
  const select = industryTypeId
    ? 'id, status, check_in_time, check_in_lat, check_in_lng, clients!inner(client_code, client_name, industry_type_id), sales_representatives(employee_code, user_profiles(display_name))'
    : 'id, status, check_in_time, check_in_lat, check_in_lng, clients(client_code, client_name), sales_representatives(employee_code, user_profiles(display_name))';
  let query = supabaseAdmin.from('field_visits').select(select).eq('organization_id', organizationId).in('status', ['checked_in', 'in_progress']).order('check_in_time', { ascending: false });
  if (industryTypeId) query = query.eq('clients.industry_type_id', industryTypeId);
  const { data: visits, error } = await query;
  if (error) fail(error);
  const ids = (visits ?? []).map((visit) => visit.id);
  if (!ids.length) return [];
  const { data: pings, error: pingError } = await supabaseAdmin.from('field_activity_pings').select('visit_id, latitude, longitude, accuracy_meters, captured_at').in('visit_id', ids).order('captured_at', { ascending: false });
  if (pingError) fail(pingError);
  const latest = new Map<string, unknown>(); for (const ping of pings ?? []) if (!latest.has(ping.visit_id)) latest.set(ping.visit_id, ping);
  // Settings → Tracking Rules → "Idle alert after (minutes)": flags a visit
  // whose last known location (latest ping, or check-in if no ping yet) is
  // older than the configured threshold. Informational only — never blocks
  // or changes the visit itself.
  return (visits ?? []).map((visit) => {
    const lastPing = latest.get(visit.id) as { captured_at: string } | undefined;
    const lastSeenAt = lastPing?.captured_at ?? visit.check_in_time;
    const minutesSinceLastSeen = lastSeenAt ? (Date.now() - new Date(lastSeenAt).getTime()) / 60000 : null;
    const idle = minutesSinceLastSeen !== null && minutesSinceLastSeen >= trackingConfig.idleAlertAfterMinutes;
    return { ...visit, latest_ping: lastPing ?? null, idle };
  });
}