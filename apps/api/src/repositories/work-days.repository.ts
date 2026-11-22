import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { localNow, startOfLocalDayIso } from '../services/beat-automation.service.js';

// A work day that is still open after this many hours, or after midnight (BEAT_TIMEZONE), is closed
// automatically so a rep who forgets "End day" is not tracked forever.
const MAX_DAY_HOURS = 14;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const VISIT_GRACE_MS = 10 * 60 * 1000;
const COLS = 'id, representative_id, started_at, ended_at, end_reason';

type Gps = { latitude: number; longitude: number; accuracyMeters?: number | null };
type WorkDay = { id: string; representative_id: string; started_at: string; ended_at: string | null; end_reason: string | null };

const isStale = (session: WorkDay) =>
  new Date(session.started_at).getTime() < new Date(startOfLocalDayIso(localNow().date)).getTime()
  || Date.now() - new Date(session.started_at).getTime() > MAX_DAY_HOURS * 3600 * 1000;

async function findActive(organizationId: string, representativeId: string): Promise<WorkDay | null> {
  const { data, error } = await supabaseAdmin.from('work_day_sessions').select(COLS)
    .eq('organization_id', organizationId).eq('representative_id', representativeId).is('ended_at', null).maybeSingle();
  if (error) throw error;
  return data as WorkDay | null;
}

async function endSession(organizationId: string, session: WorkDay, reason: 'manual' | 'auto', location?: Gps | null): Promise<WorkDay | null> {
  let endedAt = new Date().toISOString();
  if (reason === 'auto') {
    // Closed on the rep's behalf: the day ends at the last point we received (or its start).
    const { data: last } = await supabaseAdmin.from('field_activity_pings').select('captured_at')
      .eq('work_day_id', session.id).order('captured_at', { ascending: false }).limit(1).maybeSingle();
    endedAt = (last?.captured_at as string | undefined) ?? session.started_at;
  }
  const { data, error } = await supabaseAdmin.from('work_day_sessions').update({
    ended_at: endedAt,
    end_reason: reason,
    end_lat: location?.latitude ?? null,
    end_lng: location?.longitude ?? null,
    end_accuracy_meters: location?.accuracyMeters ?? null,
  }).eq('id', session.id).eq('organization_id', organizationId).is('ended_at', null).select(COLS).maybeSingle();
  if (error) throw error;
  return data as WorkDay | null;
}

/** The rep's open work day, or null. A stale open day is closed first. */
export async function getActiveWorkDay(organizationId: string, representativeId: string): Promise<WorkDay | null> {
  const session = await findActive(organizationId, representativeId);
  if (!session) return null;
  if (isStale(session)) { await endSession(organizationId, session, 'auto'); return null; }
  return session;
}

export async function startWorkDay(organizationId: string, representativeId: string, location: Gps): Promise<WorkDay> {
  const existing = await getActiveWorkDay(organizationId, representativeId);
  if (existing) return existing; // starting twice is harmless
  const { data, error } = await supabaseAdmin.from('work_day_sessions').insert({
    organization_id: organizationId,
    representative_id: representativeId,
    start_lat: location.latitude,
    start_lng: location.longitude,
    start_accuracy_meters: location.accuracyMeters ?? null,
  }).select(COLS).single();
  if (error) {
    // Two requests raced: the unique "one open day per rep" index rejected the second one.
    if ((error as { code?: string }).code === '23505') {
      const raced = await findActive(organizationId, representativeId);
      if (raced) return raced;
    }
    throw error;
  }
  return data as WorkDay;
}

export async function endWorkDay(organizationId: string, representativeId: string, location?: Gps | null): Promise<WorkDay> {
  const session = await getActiveWorkDay(organizationId, representativeId);
  if (!session) throw new AppError(404, 'NO_ACTIVE_WORK_DAY', 'You have not started your work day.');
  const { data: openVisit, error: visitError } = await supabaseAdmin.from('field_visits').select('id')
    .eq('organization_id', organizationId).eq('representative_id', representativeId).in('status', ['checked_in', 'in_progress']).limit(1).maybeSingle();
  if (visitError) throw visitError;
  if (openVisit) throw new AppError(422, 'VISIT_STILL_OPEN', 'Check out of your current visit before ending the day.');
  const ended = await endSession(organizationId, session, 'manual', location);
  if (!ended) throw new AppError(409, 'WORK_DAY_ALREADY_ENDED', 'This work day was already ended.');
  return ended;
}

type PingInput = { latitude: number; longitude: number; accuracyMeters?: number | null; capturedAt: string; mocked?: boolean; visitId?: string | null };

/**
 * Saves a batch of GPS points from the phone. Safe to send twice (each point has a unique
 * client_ping_id), and accepts late points for a day that has already ended (offline queue).
 */
export async function addWorkDayPings(organizationId: string, representativeId: string, workDayId: string, points: PingInput[]) {
  const { data: found, error } = await supabaseAdmin.from('work_day_sessions').select(COLS)
    .eq('id', workDayId).eq('organization_id', organizationId).eq('representative_id', representativeId).maybeSingle();
  if (error) throw error;
  let session = found as WorkDay | null;
  if (!session) throw new AppError(404, 'WORK_DAY_NOT_FOUND', 'Work day not found.');
  if (!session.ended_at && isStale(session)) {
    await endSession(organizationId, session, 'auto');
    const { data: refreshed } = await supabaseAdmin.from('work_day_sessions').select(COLS).eq('id', workDayId).maybeSingle();
    session = (refreshed as WorkDay | null) ?? session;
  }

  const earliest = new Date(session.started_at).getTime() - CLOCK_SKEW_MS;
  // A day the rep ended by hand is closed at that moment. A day closed automatically (forgot "End day", or the phone
  // was offline all day) still accepts the points the phone queued while offline, up to the maximum length of a day.
  const closedAt = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
  const autoWindowEnd = new Date(session.started_at).getTime() + MAX_DAY_HOURS * 3600 * 1000;
  const latest = (session.end_reason === 'auto' ? Math.max(closedAt, autoWindowEnd) : closedAt) + CLOCK_SKEW_MS;
  const accepted = points.filter((point) => {
    const at = new Date(point.capturedAt).getTime();
    return Number.isFinite(at) && at >= earliest && at <= latest;
  });

  // Only keep visit ids that really belong to this rep.
  const visitIds = [...new Set(accepted.map((point) => point.visitId).filter((id): id is string => Boolean(id)))];
  const validVisitIds = new Set<string>();
  if (visitIds.length) {
    const { data: visits, error: visitsError } = await supabaseAdmin.from('field_visits').select('id')
      .eq('organization_id', organizationId).eq('representative_id', representativeId).in('id', visitIds);
    if (visitsError) throw visitsError;
    for (const visit of visits ?? []) validVisitIds.add(visit.id as string);
  }

  if (accepted.length) {
    const rows = accepted.map((point) => {
      const capturedAt = new Date(point.capturedAt).toISOString();
      return {
        organization_id: organizationId,
        representative_id: representativeId,
        work_day_id: workDayId,
        visit_id: point.visitId && validVisitIds.has(point.visitId) ? point.visitId : null,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy_meters: point.accuracyMeters ?? null,
        captured_at: capturedAt,
        client_ping_id: `${workDayId}:${capturedAt}`,
        is_mocked: point.mocked === true,
      };
    });
    const { error: insertError } = await supabaseAdmin.from('field_activity_pings').upsert(rows, { onConflict: 'client_ping_id', ignoreDuplicates: true });
    if (insertError) throw insertError;
    if (session.end_reason === 'auto' && session.ended_at) {
      const newest = Math.max(...accepted.map((point) => new Date(point.capturedAt).getTime()));
      if (newest > new Date(session.ended_at).getTime()) {
        await supabaseAdmin.from('work_day_sessions').update({ ended_at: new Date(newest).toISOString() })
          .eq('id', workDayId).eq('organization_id', organizationId).eq('end_reason', 'auto');
      }
    }
  }
  return { saved: accepted.length, skipped: points.length - accepted.length, dayActive: !session.ended_at };
}

// ───────────────────────── Admin side (Phase 3): live status + route trail ─────────────────────────
const PAGE_SIZE = 1000; // Supabase returns at most 1000 rows per request, so we page through.
const ONLINE_WITHIN_MS = 5 * 60 * 1000; // a point in the last 5 minutes = rep is online
const MAX_USEFUL_ACCURACY_M = 100; // ignore very inaccurate points when adding up distance
const MIN_SEGMENT_M = 10; // ignore tiny moves (GPS jitter while standing still)
const MAX_SPEED_KMH = 150; // ignore GPS "jumps" that would mean an impossible speed

type PingRow = { latitude: number; longitude: number; accuracy_meters: number | null; captured_at: string; visit_id: string | null; is_mocked: boolean | null };

async function fetchPings(organizationId: string, workDayId: string): Promise<PingRow[]> {
  const all: PingRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin.from('field_activity_pings')
      .select('latitude, longitude, accuracy_meters, captured_at, visit_id, is_mocked')
      .eq('organization_id', organizationId).eq('work_day_id', workDayId)
      .order('captured_at', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as PingRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Distance travelled (km) along the points, ignoring bad accuracy, jitter and impossible jumps. */
function distanceKm(points: PingRow[]): number {
  let meters = 0;
  let last: PingRow | null = null;
  for (const point of points) {
    if (point.is_mocked === true) continue; // fake-GPS points must never add to the distance
    if (point.accuracy_meters != null && point.accuracy_meters > MAX_USEFUL_ACCURACY_M) continue;
    if (!last) { last = point; continue; }
    const segment = haversineMeters(last, point);
    const seconds = (new Date(point.captured_at).getTime() - new Date(last.captured_at).getTime()) / 1000;
    if (segment < MIN_SEGMENT_M) continue;
    if (seconds > 0 && (segment / seconds) * 3.6 > MAX_SPEED_KMH) continue;
    meters += segment;
    last = point;
  }
  return Math.round(meters) / 1000;
}

type RepInfo = { employee_code: string | null; user_profiles: { display_name: string | null } | null };
async function loadReps(organizationId: string, ids: string[]): Promise<Map<string, { employeeCode: string; name: string }>> {
  const map = new Map<string, { employeeCode: string; name: string }>();
  if (ids.length === 0) return map;
  const { data, error } = await supabaseAdmin.from('sales_representatives')
    .select('id, employee_code, user_profiles(display_name)').eq('organization_id', organizationId).in('id', ids);
  if (error) throw error;
  for (const row of (data ?? []) as unknown as (RepInfo & { id: string })[]) {
    map.set(row.id, { employeeCode: row.employee_code ?? '', name: row.user_profiles?.display_name ?? row.employee_code ?? 'Sales rep' });
  }
  return map;
}

/** Reps whose membership is locked to this industry (a rep belongs to the industry of their membership). */
async function repIdsForIndustry(organizationId: string, industryTypeId: string): Promise<Set<string>> {
  const { data: reps, error } = await supabaseAdmin.from('sales_representatives').select('id, user_id').eq('organization_id', organizationId);
  if (error) throw error;
  const userIds = (reps ?? []).map((rep) => rep.user_id as string).filter(Boolean);
  if (userIds.length === 0) return new Set();
  const { data: members, error: memberError } = await supabaseAdmin.from('organization_memberships')
    .select('user_id').eq('organization_id', organizationId).eq('industry_type_id', industryTypeId).in('user_id', userIds);
  if (memberError) throw memberError;
  const allowed = new Set((members ?? []).map((member) => member.user_id as string));
  return new Set((reps ?? []).filter((rep) => allowed.has(rep.user_id as string)).map((rep) => rep.id as string));
}

export type WorkDayStatus = 'online' | 'signal_lost' | 'ended';

/** Every rep's work day for one calendar day (BEAT_TIMEZONE): last seen, points, distance travelled. */
export async function listWorkDayOverview(organizationId: string, date?: string, industryTypeId?: string | null) {
  const day = date ?? localNow().date;
  const from = startOfLocalDayIso(day);
  const to = new Date(Date.parse(from) + 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin.from('work_day_sessions').select(COLS)
    .eq('organization_id', organizationId).gte('started_at', from).lt('started_at', to).order('started_at', { ascending: false });
  if (error) throw error;
  const allSessions = (data ?? []) as WorkDay[];
  const allowedReps = industryTypeId ? await repIdsForIndustry(organizationId, industryTypeId) : null;
  const sessions = allowedReps ? allSessions.filter((session) => allowedReps.has(session.representative_id)) : allSessions;
  const reps = await loadReps(organizationId, [...new Set(sessions.map((session) => session.representative_id))]);

  const rows = await Promise.all(sessions.map(async (session) => {
    const pings = await fetchPings(organizationId, session.id);
    const last = pings.length ? pings[pings.length - 1] : null;
    const lastSeenAt = last?.captured_at ?? session.started_at;
    const status: WorkDayStatus = session.ended_at ? 'ended'
      : Date.now() - new Date(lastSeenAt).getTime() <= ONLINE_WITHIN_MS ? 'online' : 'signal_lost';
    const rep = reps.get(session.representative_id);
    return {
      id: session.id,
      representativeId: session.representative_id,
      employeeCode: rep?.employeeCode ?? '',
      repName: rep?.name ?? 'Sales rep',
      startedAt: session.started_at,
      endedAt: session.ended_at,
      endReason: session.end_reason,
      status,
      pointCount: pings.length,
      distanceKm: distanceKm(pings),
      lastSeenAt: last ? last.captured_at : null,
      lastLatitude: last?.latitude ?? null,
      lastLongitude: last?.longitude ?? null,
      lastAccuracyMeters: last?.accuracy_meters ?? null,
      mockedPoints: pings.filter((point) => point.is_mocked === true).length,
    };
  }));
  return { date: day, rows };
}

// ───────────── Admin: Tracking History (several days, one row per rep per day) ─────────────
const HISTORY_MAX_DAYS = 31;
const HISTORY_CHUNK = 6; // work days summarised in parallel
// A finished day does not change, so its distance is remembered until its GPS point count changes.
const historyCache = new Map<string, { count: number; distanceKm: number; mockedPoints: number; lastSeenAt: string | null }>();

async function countPings(organizationId: string, workDayId: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from('field_activity_pings').select('captured_at', { count: 'exact', head: true })
    .eq('organization_id', organizationId).eq('work_day_id', workDayId);
  if (error) throw error;
  return count ?? 0;
}

/** Every rep's work days for the last N calendar days (BEAT_TIMEZONE), newest first, with real GPS distance. */
export async function listWorkDayHistory(organizationId: string, days = 14, industryTypeId?: string | null) {
  const span = Math.min(Math.max(Math.floor(days) || 1, 1), HISTORY_MAX_DAYS);
  const today = localNow().date;
  const firstDay = new Date(Date.parse(`${today}T00:00:00Z`) - (span - 1) * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin.from('work_day_sessions').select(COLS)
    .eq('organization_id', organizationId).gte('started_at', startOfLocalDayIso(firstDay)).order('started_at', { ascending: false }).limit(1000);
  if (error) throw error;
  const allowedReps = industryTypeId ? await repIdsForIndustry(organizationId, industryTypeId) : null;
  const sessions = ((data ?? []) as WorkDay[]).filter((session) => !allowedReps || allowedReps.has(session.representative_id));
  const reps = await loadReps(organizationId, [...new Set(sessions.map((session) => session.representative_id))]);
  if (historyCache.size > 3000) historyCache.clear();

  const rows: Awaited<ReturnType<typeof summarise>>[] = [];
  async function summarise(session: WorkDay) {
    const cacheKey = `${session.id}|${session.ended_at ?? 'open'}`;
    let summary: { count: number; distanceKm: number; mockedPoints: number; lastSeenAt: string | null } | undefined;
    if (session.ended_at) {
      const cached = historyCache.get(cacheKey);
      if (cached && cached.count === await countPings(organizationId, session.id)) summary = cached;
    }
    if (!summary) {
      const pings = await fetchPings(organizationId, session.id);
      summary = {
        count: pings.length,
        distanceKm: distanceKm(pings),
        mockedPoints: pings.filter((point) => point.is_mocked === true).length,
        lastSeenAt: pings.length ? pings[pings.length - 1].captured_at : null,
      };
      if (session.ended_at) historyCache.set(cacheKey, summary);
    }
    const lastSeenAt = summary.lastSeenAt ?? session.started_at;
    const status: WorkDayStatus = session.ended_at ? 'ended'
      : Date.now() - new Date(lastSeenAt).getTime() <= ONLINE_WITHIN_MS ? 'online' : 'signal_lost';
    const rep = reps.get(session.representative_id);
    return {
      id: session.id,
      representativeId: session.representative_id,
      employeeCode: rep?.employeeCode ?? '',
      repName: rep?.name ?? 'Sales rep',
      date: localNow(new Date(session.started_at)).date,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      endReason: session.end_reason,
      status,
      pointCount: summary.count,
      distanceKm: summary.distanceKm,
      mockedPoints: summary.mockedPoints,
      lastSeenAt: summary.lastSeenAt,
    };
  }
  for (let index = 0; index < sessions.length; index += HISTORY_CHUNK) {
    rows.push(...await Promise.all(sessions.slice(index, index + HISTORY_CHUNK).map(summarise)));
  }
  return { days: span, rows };
}

/** One work day's full route: GPS points in order, plus the visits done during that day. */
export async function getWorkDayRoute(organizationId: string, workDayId: string, industryTypeId?: string | null) {
  const { data, error } = await supabaseAdmin.from('work_day_sessions').select(COLS)
    .eq('id', workDayId).eq('organization_id', organizationId).maybeSingle();
  if (error) throw error;
  const session = data as WorkDay | null;
  if (!session) throw new AppError(404, 'WORK_DAY_NOT_FOUND', 'Work day not found.');
  // Out-of-industry work day = 404 (same as other scoped endpoints)
  if (industryTypeId && !(await repIdsForIndustry(organizationId, industryTypeId)).has(session.representative_id)) {
    throw new AppError(404, 'WORK_DAY_NOT_FOUND', 'Work day not found.');
  }

  const pings = await fetchPings(organizationId, workDayId);
  const reps = await loadReps(organizationId, [session.representative_id]);
  const rep = reps.get(session.representative_id);

  const { data: visits, error: visitsError } = await supabaseAdmin.from('field_visits')
    .select('id, status, check_in_time, check_out_time, check_in_lat, check_in_lng, check_out_lat, check_out_lng, check_in_within_geofence, outcome, unlisted_client_name, clients(client_code, client_name)')
    .eq('organization_id', organizationId).eq('representative_id', session.representative_id)
    // The phone starts the work day right after the first check-in, so allow a few minutes before started_at.
    .gte('check_in_time', new Date(new Date(session.started_at).getTime() - VISIT_GRACE_MS).toISOString())
    .lte('check_in_time', new Date(new Date(session.ended_at ?? new Date().toISOString()).getTime() + VISIT_GRACE_MS).toISOString())
    .order('check_in_time', { ascending: true });
  if (visitsError) throw visitsError;

  return {
    session: { ...session, repName: rep?.name ?? 'Sales rep', employeeCode: rep?.employeeCode ?? '' },
    distanceKm: distanceKm(pings),
    points: pings.map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude,
      accuracyMeters: point.accuracy_meters,
      capturedAt: point.captured_at,
      visitId: point.visit_id,
      mocked: point.is_mocked === true,
    })),
    visits: visits ?? [],
  };
}