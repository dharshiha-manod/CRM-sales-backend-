// FMCG route / beat automation: auto-build beats, keep rep assignments in sync, plan each day,
// tick outlets off on check-in and mark the rest missed. Everything here is idempotent.
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';
import { supabaseAdmin } from '../lib/supabase.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WORK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const TZ = process.env.BEAT_TIMEZONE || 'Asia/Kolkata';
const PLAN_HOUR = Number(process.env.BEAT_PLAN_HOUR ?? 6);   // daily plan is created from this hour
const CLOSE_HOUR = Number(process.env.BEAT_CLOSE_HOUR ?? 21); // after this hour, today's open visits become missed
const CHUNK = 500;
const ID_CHUNK = 100; // ids per .in() filter (keeps the request URL short)

const fail = (error: unknown): never => { throw error; };

// ---------- time helpers ----------
export function localNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, day: get('weekday'), hour: Number(get('hour')) };
}
function startOfLocalDayIso(date: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(new Date(`${date}T12:00:00Z`)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  const minutes = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  return new Date(Date.parse(`${date}T00:00:00Z`) - minutes * 60000).toISOString();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
/** First day a beat runs that is after `after` and not before `notBefore` (both YYYY-MM-DD). */
export function nextVisitDate(days: string[], after: string, notBefore: string): string | null {
  const first = addDays(after, 1);
  const start = first > notBefore ? first : notBefore;
  for (let i = 0; i < 14; i += 1) {
    const candidate = addDays(start, i);
    if (days.includes(weekdayOf(candidate))) return candidate;
  }
  return null;
}

// ---------- geo ----------
const distance = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = (v: number) => (v * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
type Outlet = { id: string; client_name: string; city: string | null; postal_code: string | null; latitude: number | null; longitude: number | null };

/** Nearest-neighbour visiting order. Outlets without GPS go last, alphabetically. */
export function orderNearest(outlets: Outlet[]): Outlet[] {
  const withGps = outlets.filter((o) => o.latitude != null && o.longitude != null);
  const noGps = outlets.filter((o) => o.latitude == null || o.longitude == null).sort((a, b) => a.client_name.localeCompare(b.client_name));
  if (!withGps.length) return noGps;
  const left = [...withGps].sort((a, b) => Number(b.latitude) - Number(a.latitude) || Number(a.longitude) - Number(b.longitude));
  const route = [left.shift() as Outlet];
  while (left.length) {
    const last = route[route.length - 1];
    let best = 0; let bestD = Infinity;
    for (let i = 0; i < left.length; i += 1) {
      const d = distance(Number(last.latitude), Number(last.longitude), Number(left[i].latitude), Number(left[i].longitude));
      if (d < bestD) { bestD = d; best = i; }
    }
    route.push(left.splice(best, 1)[0]);
  }
  return [...route, ...noGps];
}

// ---------- paging helper (Supabase returns max 1000 rows per request) ----------
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) fail(error);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// ---------- assignments: a beat's rep must be assigned to its outlets or check-in is refused ----------
export async function syncAssignments(org: string, representativeId: string, clientIds: string[]) {
  const ids = [...new Set(clientIds)];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = ids.slice(i, i + CHUNK).map((client_id) => ({ organization_id: org, sales_representative_id: representativeId, client_id, status: 'active' }));
    const { error } = await supabaseAdmin.from('sales_representative_client_assignments').upsert(rows, { onConflict: 'organization_id,sales_representative_id,client_id' });
    if (error) fail(error);
  }
  // One owner per outlet: any other rep still actively assigned to these outlets is released,
  // so orders, beats and follow-ups all point to the same representative.
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { error } = await supabaseAdmin.from('sales_representative_client_assignments').update({ status: 'inactive' })
      .eq('organization_id', org).eq('status', 'active').neq('sales_representative_id', representativeId).in('client_id', ids.slice(i, i + ID_CHUNK));
    if (error) fail(error);
  }
}

// ---------- auto-generate beats ----------
export const autoGenerateSchema = z.object({
  maxOutlets: z.number().int().min(5).max(60).default(25),
  visitDaysPerBeat: z.number().int().min(1).max(6).default(1),
  representativeIds: z.array(z.string().uuid()).max(200).default([]),
  preview: z.boolean().default(true),
});
export type AutoGenerateInput = z.infer<typeof autoGenerateSchema>;

export async function autoGenerateBeats(org: string, userId: string, industryTypeId: string, input: AutoGenerateInput) {
  const [existing, clients] = await Promise.all([
    fetchAll<{ client_ids: string[] | null; days: string[] | null; representative_id: string | null }>((f, t) => supabaseAdmin.from('route_beats').select('client_ids, days, representative_id').eq('organization_id', org).eq('industry_type_id', industryTypeId).range(f, t)),
    fetchAll<Outlet>((f, t) => supabaseAdmin.from('clients').select('id, client_name, city, postal_code, latitude, longitude').eq('organization_id', org).eq('industry_type_id', industryTypeId).eq('status', 'active').order('id').range(f, t)),
  ]);

  const onBeat = new Set(existing.flatMap((b) => b.client_ids ?? []));
  const free = clients.filter((c) => !onBeat.has(c.id));

  let reps: string[] = [];
  if (input.representativeIds.length) {
    const { data, error } = await supabaseAdmin.from('sales_representatives').select('id').eq('organization_id', org).eq('status', 'active').in('id', input.representativeIds);
    if (error) fail(error);
    reps = (data ?? []).map((r) => r.id as string);
    if (!reps.length) throw new AppError(422, 'INVALID_REPRESENTATIVE', 'Select active sales representatives.');
  }

  // 1) group by pincode, else city; 2) order each group by nearest neighbour; 3) cut into evenly sized beats
  // A client that already belongs to a rep (set on its lead) stays with that rep: beats are cut per area AND per owner.
  const ownerOf = new Map<string, string>();
  for (let i = 0; i < free.length; i += 100) {
    const { data: owned, error: ownedError } = await supabaseAdmin.from('sales_representative_client_assignments')
      .select('client_id, sales_representative_id, sales_representatives!inner(status)')
      .eq('organization_id', org).eq('status', 'active').eq('sales_representatives.status', 'active')
      .in('client_id', free.slice(i, i + 100).map((c) => c.id));
    if (ownedError) fail(ownedError);
    for (const a of (owned ?? []) as Array<{ client_id: string; sales_representative_id: string }>) if (!ownerOf.has(a.client_id)) ownerOf.set(a.client_id, a.sales_representative_id);
  }

  const groups = new Map<string, Outlet[]>();
  for (const c of free) {
    const key = `${(c.postal_code?.trim() || c.city?.trim() || 'Unassigned').toLowerCase()}|${ownerOf.get(c.id) ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  type Planned = { name: string; area: string; outlets: Outlet[]; ownerRep: string | null };
  const planned: Planned[] = [];
  for (const list of groups.values()) {
    const area = list[0].city?.trim() || list[0].postal_code?.trim() || 'Unassigned';
    const ordered = orderNearest(list);
    const parts = Math.ceil(ordered.length / input.maxOutlets);
    const size = Math.ceil(ordered.length / parts);
    for (let i = 0; i < parts; i += 1) planned.push({ name: '', area, outlets: ordered.slice(i * size, (i + 1) * size), ownerRep: ownerOf.get(list[0].id) ?? null });
  }
  // Name beats per area: "Colachel Beat" when the area has one beat, "Colachel Beat 1, 2..." when it has several.
  const perArea = new Map<string, number>();
  for (const p of planned) perArea.set(p.area.toLowerCase(), (perArea.get(p.area.toLowerCase()) ?? 0) + 1);
  const seenArea = new Map<string, number>();
  for (const p of planned) {
    const k = p.area.toLowerCase();
    const n = (seenArea.get(k) ?? 0) + 1;
    seenArea.set(k, n);
    p.name = perArea.get(k) === 1 ? `${p.area} Beat` : `${p.area} Beat ${n}`;
  }

  // 4) balance visit days (and reps) so no weekday is overloaded; existing beats count towards the load
  const dayLoad: Record<string, number> = Object.fromEntries(WORK_DAYS.map((d) => [d, 0]));
  for (const b of existing) for (const d of b.days ?? []) if (d in dayLoad) dayLoad[d] += (b.client_ids ?? []).length;
  const repDay: Record<string, Record<string, number>> = Object.fromEntries(reps.map((r) => [r, Object.fromEntries(WORK_DAYS.map((d) => [d, 0]))]));
  for (const b of existing) if (b.representative_id && repDay[b.representative_id]) for (const d of b.days ?? []) if (d in repDay[b.representative_id]) repDay[b.representative_id][d] += (b.client_ids ?? []).length;

  const plan = planned.sort((a, b) => b.outlets.length - a.outlets.length).map((p) => {
    const days = [...WORK_DAYS].sort((a, b) => dayLoad[a] - dayLoad[b]).slice(0, input.visitDaysPerBeat);
    days.sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
    let representativeId: string | null = null;
    if (p.ownerRep) {
      // the outlets' own rep keeps them; only outlets with no owner are balanced across the selected reps
      representativeId = p.ownerRep;
      repDay[representativeId] ??= Object.fromEntries(WORK_DAYS.map((d) => [d, 0]));
      for (const d of days) repDay[representativeId][d] += p.outlets.length;
    } else if (reps.length) {
      const cost = (r: string) => days.reduce((s, d) => s + repDay[r][d], 0);
      representativeId = [...reps].sort((a, b) => cost(a) - cost(b))[0];
      for (const d of days) repDay[representativeId][d] += p.outlets.length;
    }
    for (const d of days) dayLoad[d] += p.outlets.length;
    return { name: p.name, area: p.area, days, representativeId, outletCount: p.outlets.length, clientIds: p.outlets.map((o) => o.id) };
  });

  const summary = plan.map((p) => ({ name: p.name, area: p.area, days: p.days, representativeId: p.representativeId, outletCount: p.outletCount }));
  if (input.preview || !plan.length) return { preview: true, beats: summary, outletsCovered: free.length, outletsAlreadyOnBeats: onBeat.size, created: 0 };

  const { data, error } = await supabaseAdmin.from('route_beats').insert(plan.map((p) => ({
    organization_id: org, industry_type_id: industryTypeId, created_by: userId, name: p.name, area: p.area,
    representative_id: p.representativeId, days: p.days, status: 'active', client_ids: p.clientIds,
  }))).select('id, organization_id, industry_type_id, representative_id, client_ids, days, status');
  if (error) fail(error);
  for (const p of plan) if (p.representativeId) await syncAssignments(org, p.representativeId, p.clientIds);
  for (const beat of data ?? []) await replanBeatToday(beat as BeatRow);
  return { preview: false, beats: summary, outletsCovered: free.length, outletsAlreadyOnBeats: onBeat.size, created: plan.length };
}

// ---------- daily plan ----------
export type BeatRow = { id: string; organization_id: string; industry_type_id: string; representative_id: string | null; client_ids: string[] | null; days: string[] | null; status: string };
const planRows = (b: BeatRow, date: string) => (b.client_ids ?? []).map((client_id, sequence) => ({
  organization_id: b.organization_id, industry_type_id: b.industry_type_id, beat_id: b.id, representative_id: b.representative_id as string,
  client_id, visit_date: date, sequence, status: 'planned',
}));
async function insertPlan(allRows: ReturnType<typeof planRows>) {
  // An outlet that was made inactive after it was put on a beat must not keep being planned.
  const ids = [...new Set(allRows.map((r) => r.client_id))];
  const active = new Set<string>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabaseAdmin.from('clients').select('id').eq('status', 'active').in('id', ids.slice(i, i + ID_CHUNK));
    if (error) fail(error);
    for (const c of (data ?? []) as { id: string }[]) active.add(c.id);
  }
  const rows = allRows.filter((r) => active.has(r.client_id));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabaseAdmin.from('beat_visits').upsert(rows.slice(i, i + CHUNK), { onConflict: 'beat_id,client_id,visit_date', ignoreDuplicates: true });
    if (error) fail(error);
  }
}

/** Creates today's visit list for every active beat scheduled today. Optionally limited to one org/industry. */
export async function generateDailyPlan(date: string, day: string, scope?: { org: string; industryTypeId: string }) {
  const beats = await fetchAll<BeatRow>((f, t) => {
    let q = supabaseAdmin.from('route_beats').select('id, organization_id, industry_type_id, representative_id, client_ids, days, status').eq('status', 'active').not('representative_id', 'is', null).order('id').range(f, t);
    if (scope) q = q.eq('organization_id', scope.org).eq('industry_type_id', scope.industryTypeId);
    return q;
  });
  const rows = beats.filter((b) => (b.days ?? []).includes(day)).flatMap((b) => planRows(b, date));
  await insertPlan(rows);
  if (rows.length) await reconcileVisited(date);
  return rows.length;
}

/** After a beat is saved: rebuild today's still-open rows for it (visited rows and carried-over flags are kept). Never blocks saving. */
export async function replanBeatToday(beat: BeatRow) {
  try {
    const { date, day } = localNow();
    const { data: carried, error: carriedError } = await supabaseAdmin.from('beat_visits').select('client_id, sequence').eq('beat_id', beat.id).eq('visit_date', date).eq('status', 'planned').eq('carried_over', true);
    if (carriedError) fail(carriedError);
    const { error } = await supabaseAdmin.from('beat_visits').delete().eq('beat_id', beat.id).eq('visit_date', date).eq('status', 'planned');
    if (error) fail(error);
    if (beat.status === 'active' && beat.representative_id && (beat.days ?? []).includes(day)) {
      await insertPlan(planRows(beat, date));
      for (const c of (carried ?? []) as { client_id: string; sequence: number }[]) {
        if (!(beat.client_ids ?? []).includes(c.client_id)) continue;
        const { error: flagError } = await supabaseAdmin.from('beat_visits').update({ carried_over: true, sequence: c.sequence }).eq('beat_id', beat.id).eq('client_id', c.client_id).eq('visit_date', date).eq('status', 'planned');
        if (flagError) fail(flagError);
      }
      await reconcileVisited(date);
    }
  } catch (error) { logger.warn({ err: error }, 'beat replan skipped (is the beat_visits migration applied?)'); }
}

/** Visits that happened before the plan existed (server restarted late, beat edited mid-day) still count. */
async function reconcileVisited(date: string) {
  const visits = await fetchAll<{ id: string; representative_id: string; client_id: string; check_in_time: string }>((f, t) => supabaseAdmin.from('field_visits').select('id, representative_id, client_id, check_in_time').gte('check_in_time', startOfLocalDayIso(date)).not('client_id', 'is', null).order('check_in_time').range(f, t));
  for (const v of visits) await markBeatVisitDone(null, v.representative_id, v.client_id, v.id, date, v.check_in_time);
}

/** Called from check-in. Marks the outlet visited on today's plan. Never throws. */
export async function markBeatVisitDone(org: string | null, representativeId: string, clientId: string, fieldVisitId: string, date = localNow().date, at = new Date().toISOString()) {
  try {
    let q = supabaseAdmin.from('beat_visits').update({ status: 'visited', field_visit_id: fieldVisitId, visited_at: at }).eq('representative_id', representativeId).eq('client_id', clientId).eq('visit_date', date).in('status', ['planned', 'missed']);
    if (org) q = q.eq('organization_id', org);
    const { error } = await q;
    if (error) fail(error);
  } catch (error) { logger.warn({ err: error }, 'beat visit tick skipped'); }
}

type MissedRow = { id: string; beat_id: string; client_id: string; visit_date: string; sequence: number; carried_over: boolean };

/** Anything still planned on an earlier day (or today, after closing time) becomes missed,
 *  then each missed outlet is moved to the beat's next visit day (once) and shown first there. */
export async function markMissed(date: string, includeToday: boolean) {
  const open = await fetchAll<MissedRow>((f, t) => {
    const q = supabaseAdmin.from('beat_visits').select('id, beat_id, client_id, visit_date, sequence, carried_over').eq('status', 'planned');
    return (includeToday ? q.lte('visit_date', date) : q.lt('visit_date', date)).order('id').range(f, t);
  });
  if (!open.length) return;
  const flipped: MissedRow[] = [];
  for (let i = 0; i < open.length; i += ID_CHUNK) {
    const part = open.slice(i, i + ID_CHUNK);
    const { data, error } = await supabaseAdmin.from('beat_visits').update({ status: 'missed' }).in('id', part.map((r) => r.id)).eq('status', 'planned').select('id');
    if (error) fail(error);
    const done = new Set((data ?? []).map((r) => r.id as string));
    flipped.push(...part.filter((r) => done.has(r.id)));
  }
  await carryOver(flipped.filter((r) => !r.carried_over)); // an outlet is carried over once, not forever
}

async function carryOver(rows: MissedRow[]) {
  if (!rows.length) return;
  const today = localNow().date;
  const beatIds = [...new Set(rows.map((r) => r.beat_id))];
  const beats = new Map<string, BeatRow>();
  for (let i = 0; i < beatIds.length; i += ID_CHUNK) {
    const { data, error } = await supabaseAdmin.from('route_beats').select('id, organization_id, industry_type_id, representative_id, client_ids, days, status').in('id', beatIds.slice(i, i + ID_CHUNK));
    if (error) fail(error);
    for (const b of (data ?? []) as BeatRow[]) beats.set(b.id, b);
  }
  const groups = new Map<string, { beat: BeatRow; date: string; clientIds: string[] }>();
  for (const r of [...rows].sort((a, b) => a.sequence - b.sequence)) {
    const beat = beats.get(r.beat_id);
    if (!beat || beat.status !== 'active' || !beat.representative_id || !(beat.client_ids ?? []).includes(r.client_id)) continue;
    const target = nextVisitDate(beat.days ?? [], r.visit_date, today);
    if (!target) continue;
    const key = `${beat.id}|${target}`;
    const group = groups.get(key) ?? { beat, date: target, clientIds: [] };
    if (!group.clientIds.includes(r.client_id)) group.clientIds.push(r.client_id);
    groups.set(key, group);
  }
  for (const g of groups.values()) {
    await insertPlan(planRows(g.beat, g.date).filter((r) => g.clientIds.includes(r.client_id))); // only the carried outlets; the normal plan adds the rest
    for (let i = 0; i < g.clientIds.length; i += 1) {
      const { error } = await supabaseAdmin.from('beat_visits').update({ carried_over: true, sequence: i - g.clientIds.length }).eq('beat_id', g.beat.id).eq('client_id', g.clientIds[i]).eq('visit_date', g.date).eq('status', 'planned');
      if (error) fail(error);
    }
  }
  logger.info({ outlets: rows.length, groups: groups.size }, 'Missed beat visits carried over');
}

// ---------- read models ----------
export async function beatSummary(org: string, industryTypeId: string, date?: string) {
  const day = date ?? localNow().date;
  const { data, error } = await supabaseAdmin.rpc('beat_day_summary', { p_org: org, p_industry: industryTypeId, p_date: day });
  if (error) fail(error);
  const beats: Record<string, { total: number; visited: number; missed: number; productive: number }> = {};
  const totals = { total: 0, visited: 0, missed: 0, productive: 0 };
  for (const r of (data ?? []) as { beat_id: string; total: number; visited: number; missed: number }[]) {
    beats[r.beat_id] = { total: r.total, visited: r.visited, missed: r.missed, productive: 0 };
    totals.total += r.total; totals.visited += r.visited; totals.missed += r.missed;
  }
  // Productive visit = the outlet was visited AND that rep took an order from it the same day (linked to Sales Orders).
  try {
    const { data: visited, error: visitedError } = await supabaseAdmin.from('beat_visits').select('beat_id, client_id, representative_id').eq('organization_id', org).eq('industry_type_id', industryTypeId).eq('visit_date', day).eq('status', 'visited');
    if (visitedError) fail(visitedError);
    const done = (visited ?? []) as { beat_id: string; client_id: string; representative_id: string }[];
    if (done.length) {
      const ordered = new Set<string>();
      const clientIds = [...new Set(done.map((v) => v.client_id))];
      for (let i = 0; i < clientIds.length; i += ID_CHUNK) {
        const { data: orders, error: ordersError } = await supabaseAdmin.from('sale_orders').select('representative_id, client_id').eq('organization_id', org).in('client_id', clientIds.slice(i, i + ID_CHUNK)).not('status', 'in', '(cancelled,rejected)').gte('created_at', startOfLocalDayIso(day)).lt('created_at', startOfLocalDayIso(addDays(day, 1)));
        if (ordersError) fail(ordersError);
        for (const o of (orders ?? []) as { representative_id: string | null; client_id: string }[]) ordered.add(`${o.representative_id}|${o.client_id}`);
      }
      for (const v of done) if (beats[v.beat_id] && ordered.has(`${v.representative_id}|${v.client_id}`)) { beats[v.beat_id].productive += 1; totals.productive += 1; }
    }
  } catch (error) { logger.warn({ err: error }, 'beat productive-visit count skipped'); }
  return { date: day, beats, totals };
}

/** The rep's own list for today, in visiting order (for the mobile app). */
export async function myBeatToday(org: string, representativeId: string) {
  const { data, error } = await supabaseAdmin.from('beat_visits')
    .select('id, beat_id, client_id, sequence, status, carried_over, visited_at, route_beats(name), clients(client_code, client_name, city, latitude, longitude, gps_radius_meters)')
    .eq('organization_id', org).eq('representative_id', representativeId).eq('visit_date', localNow().date).order('beat_id').order('sequence');
  if (error) fail(error);
  return data ?? [];
}

// ---------- scheduler ----------
let timer: NodeJS.Timeout | null = null;
let plannedFor = '';
export async function runBeatAutomation(now = new Date()) {
  const t = localNow(now);
  try {
    if (t.hour >= PLAN_HOUR && plannedFor !== t.date) {
      const n = await generateDailyPlan(t.date, t.day);
      plannedFor = t.date;
      logger.info({ date: t.date, day: t.day, visits: n }, 'Beat daily plan generated');
    }
    await markMissed(t.date, t.hour >= CLOSE_HOUR);
  } catch (error) { logger.error({ err: error }, 'Beat automation run failed'); }
}
/** Call once at startup. Set BEAT_AUTOMATION=off to disable. Safe on several instances (writes are idempotent). */
export function startBeatScheduler() {
  if (timer) return;
  if (process.env.BEAT_AUTOMATION === 'off') { logger.info('Beat automation disabled (BEAT_AUTOMATION=off).'); return; }
  logger.info({ tz: TZ, planHour: PLAN_HOUR, closeHour: CLOSE_HOUR }, 'Starting beat automation');
  void runBeatAutomation();
  timer = setInterval(() => void runBeatAutomation(), 10 * 60_000);
  timer.unref();
}