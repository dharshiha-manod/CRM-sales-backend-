// Vehicle after-sales automation (Step 3). Vehicle only: it runs only for industries whose code is 'vehicle',
// so FMCG / School / Textile / Pharma / Trading are never touched.
//  - First service is scheduled by itself after delivery; the next one after every completed periodic service.
//  - Follow-up calls are raised for: service due / missed, insurance expiring / expired, warranty ending.
//  - Insurance / warranty / scheme statuses are refreshed without anyone opening a page.
// Every reminder fires once (the vehicle_automation_log claim), so running it often is safe.
// Set VEHICLE_AUTOMATION=off to stop the background timer.
import { logger } from '../lib/logger.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { todayLocal } from '../lib/ist-date.js';
import { nextVehicleCode, ownerOfVin, representativeFor } from '../lib/vehicle-links.js';
import { enqueueCustomerMessage, processCustomerMessages } from '../lib/vehicle-notify.js';

type Row = Record<string, unknown>;
const has = (v: unknown) => v !== null && v !== undefined && v !== '';
const str = (v: unknown) => (typeof v === 'string' ? v : '');

const DEFAULT_SERVICE_MONTHS = Math.max(1, Number(process.env.VEHICLE_DEFAULT_SERVICE_MONTHS ?? 6));
const SERVICE_REMIND_DAYS = Math.max(1, Number(process.env.VEHICLE_SERVICE_REMIND_DAYS ?? 7));
const RENEWAL_REMIND_DAYS = Math.max(1, Number(process.env.VEHICLE_RENEWAL_REMIND_DAYS ?? 30));
const INTERVAL_MS = Math.max(5, Number(process.env.VEHICLE_AUTOMATION_MINUTES ?? 60)) * 60_000;
const PERIODIC = ['First Service', 'Periodic Service'];

export interface AftersalesResult {
  firstServicesScheduled: number; nextServicesScheduled: number; followUps: number; skippedNoRepresentative: number; statusesRefreshed: boolean;
}

// ---------------------------------------------------------------- date helpers (all dates are IST calendar dates, YYYY-MM-DD)
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const daysFromToday = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayLocal()}T00:00:00Z`)) / 86_400_000);
/** 10:00 IST on the given date, but never earlier than 5 minutes from now. */
const dueAt = (iso: string) => new Date(Math.max(Date.parse(`${iso}T10:00:00+05:30`), Date.now() + 5 * 60_000)).toISOString();

/** "10000 km / 12 months", "6 months", "1 year" -> { months, km } (months falls back to the default). */
function parseInterval(text: unknown): { months: number; km: number | null } {
  const t = str(text);
  const years = /(\d+(?:\.\d+)?)\s*(?:year|yr)/i.exec(t);
  const months = /(\d+(?:\.\d+)?)\s*(?:month|mo\b)/i.exec(t);
  const km = /(\d[\d,]*)\s*km/i.exec(t);
  const m = months ? Number(months[1]) : years ? Number(years[1]) * 12 : DEFAULT_SERVICE_MONTHS;
  return { months: Math.max(1, Math.round(m)), km: km ? Number((km[1] ?? '').replace(/,/g, '')) || null : null };
}

// ---------------------------------------------------------------- idempotency log
/** True only for the first caller of a key. Needs the vehicle_automation_log table (vehicle_step3_aftersales.sql). */
async function claim(org: string, key: string, kind: string, meta: Row): Promise<boolean> {
  const { error } = await supabaseAdmin.from('vehicle_automation_log').insert({ organization_id: org, key, kind, meta });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}
async function release(org: string, key: string) {
  await supabaseAdmin.from('vehicle_automation_log').delete().eq('organization_id', org).eq('key', key);
}

// ---------------------------------------------------------------- date-driven statuses
export async function refreshVehicleDateStatuses(org: string, ind: string): Promise<void> {
  const today = todayLocal();
  const soon = addDays(today, 30);
  const upd = (table: string, status: string, build: (q: any) => any) => build(supabaseAdmin.from(table).update({ status }).eq('organization_id', org).eq('industry_type_id', ind));
  await upd('vehicle_schemes', 'Expired', (q) => q.eq('status', 'Active').lt('end_date', today));
  for (const [table, col] of [['vehicle_insurance_policies', 'expiry_date'], ['vehicle_warranties', 'end_date']] as const) {
    await upd(table, 'Expired', (q) => q.in('status', ['Active', 'Expiring Soon']).lt(col, today));
    await upd(table, 'Expiring Soon', (q) => q.eq('status', 'Active').gte(col, today).lte(col, soon));
    await upd(table, 'Active', (q) => q.in('status', ['Expiring Soon', 'Expired']).gt(col, soon));
  }
}

// ---------------------------------------------------------------- service scheduling
interface VehicleInfo { months: number; km: number | null; model_name: string; registration_number: string | null }
async function infoForVins(org: string, ind: string, vins: string[]): Promise<Map<string, VehicleInfo>> {
  const out = new Map<string, VehicleInfo>();
  if (!vins.length) return out;
  const { data: units } = await supabaseAdmin.from('vehicle_units').select('vin, model_id, model_name, registration_number').eq('organization_id', org).eq('industry_type_id', ind).in('vin', vins);
  const modelIds = [...new Set(((units ?? []) as Row[]).map((u) => u.model_id).filter(has).map(String))];
  const { data: models } = modelIds.length ? await supabaseAdmin.from('vehicle_models').select('id, service_interval').eq('organization_id', org).in('id', modelIds) : { data: [] as Row[] };
  const interval = new Map(((models ?? []) as Row[]).map((m) => [String(m.id), parseInterval(m.service_interval)]));
  for (const u of (units ?? []) as Row[]) {
    const iv = interval.get(String(u.model_id)) ?? parseInterval('');
    out.set(String(u.vin), { months: iv.months, km: iv.km, model_name: str(u.model_name), registration_number: has(u.registration_number) ? String(u.registration_number) : null });
  }
  return out;
}

async function insertServiceRecord(org: string, ind: string, row: Row): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const service_number = await nextVehicleCode('vehicle_service_records', 'SRV', org, attempt);
    const { error } = await supabaseAdmin.from('vehicle_service_records').insert({ ...row, service_number, status: 'Scheduled', organization_id: org, industry_type_id: ind });
    if (!error) return true;
    if (error.code !== '23505') throw error;
  }
  return false;
}

/** A delivered vehicle with no service history gets its First Service scheduled (interval from the model). */
async function scheduleFirstServices(org: string, ind: string): Promise<number> {
  const { data: deliveries } = await supabaseAdmin.from('vehicle_deliveries').select('vin, client_id, client_name, delivery_date, created_at').eq('organization_id', org).eq('industry_type_id', ind).eq('status', 'Delivered').not('vin', 'is', null).order('created_at', { ascending: false }).limit(300);
  const list = (deliveries ?? []) as Row[];
  if (!list.length) return 0;
  const vins = [...new Set(list.map((d) => String(d.vin)))];
  const { data: existing } = await supabaseAdmin.from('vehicle_service_records').select('vin').eq('organization_id', org).eq('industry_type_id', ind).in('vin', vins);
  const serviced = new Set(((existing ?? []) as Row[]).map((r) => String(r.vin)));
  const info = await infoForVins(org, ind, vins);
  let created = 0;
  for (const d of list) {
    const vin = String(d.vin);
    if (serviced.has(vin)) continue;
    serviced.add(vin); // one per vehicle, even when it was delivered twice
    const iv = info.get(vin) ?? { months: DEFAULT_SERVICE_MONTHS, km: null, model_name: '', registration_number: null };
    const base = has(d.delivery_date) ? String(d.delivery_date).slice(0, 10) : String(d.created_at).slice(0, 10);
    const date = addMonths(base, iv.months);
    if (daysFromToday(date) < -30) continue; // long overdue history from before this feature: do not flood the workshop
    if (!(await claim(org, `first-service:${vin}`, 'first_service', { vin, date }))) continue;
    try {
      const ok = await insertServiceRecord(org, ind, {
        vin, client_id: d.client_id ?? null, client_name: d.client_name, registration_number: iv.registration_number, service_type: 'First Service', service_date: date,
        next_service_odometer: iv.km, complaint: 'Auto-scheduled: first service after delivery.',
      });
      if (ok) created += 1; else await release(org, `first-service:${vin}`);
    } catch (error) { await release(org, `first-service:${vin}`); throw error; }
  }
  return created;
}

/**
 * After a periodic service is completed, the next one is scheduled: on the date the workshop entered, otherwise
 * service date + the model's interval. Called right after a save (vehicle.routes.ts) and again by the scheduler.
 */
export async function scheduleNextService(org: string, ind: string, done: Row): Promise<boolean> {
  try {
    if (done.status !== 'Completed' || !has(done.vin)) return false;
    const explicit = has(done.next_service_date);
    if (!explicit && !PERIODIC.includes(str(done.service_type))) return false; // a repair does not reset the periodic cycle
    const vin = String(done.vin);
    const { data: open } = await supabaseAdmin.from('vehicle_service_records').select('id').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', vin).in('status', ['Scheduled', 'In Progress']).limit(1).maybeSingle();
    if (open) return false;
    const iv = (await infoForVins(org, ind, [vin])).get(vin) ?? { months: DEFAULT_SERVICE_MONTHS, km: null, model_name: '', registration_number: null };
    const from = has(done.service_date) ? String(done.service_date).slice(0, 10) : todayLocal();
    const date = explicit ? String(done.next_service_date).slice(0, 10) : addMonths(from, iv.months);
    if (daysFromToday(date) < -30) return false;
    const key = `next-service:${String(done.id)}`;
    if (!(await claim(org, key, 'next_service', { vin, date }))) return false;
    try {
      const ok = await insertServiceRecord(org, ind, {
        vin, client_id: done.client_id ?? null, client_name: done.client_name, registration_number: done.registration_number ?? iv.registration_number, service_type: 'Periodic Service',
        service_date: date, next_service_odometer: has(done.next_service_odometer) ? done.next_service_odometer : iv.km,
        complaint: `Auto-scheduled after service ${str(done.service_number)}.`,
      });
      if (!ok) await release(org, key);
      return ok;
    } catch (error) { await release(org, key); throw error; }
  } catch (error) {
    logger.error({ err: error }, 'vehicle after-sales: could not schedule the next service');
    return false;
  }
}

/** Completed periodic services whose next service was never scheduled (e.g. saved before this feature, or the API was down). */
async function scheduleMissingNextServices(org: string, ind: string): Promise<number> {
  const { data } = await supabaseAdmin.from('vehicle_service_records').select('*').eq('organization_id', org).eq('industry_type_id', ind).eq('status', 'Completed').not('vin', 'is', null).order('service_date', { ascending: false }).limit(400);
  const latest = new Map<string, Row>();
  for (const r of (data ?? []) as Row[]) if (!latest.has(String(r.vin))) latest.set(String(r.vin), r);
  let created = 0;
  for (const r of latest.values()) if (await scheduleNextService(org, ind, r)) created += 1;
  return created;
}

// ---------------------------------------------------------------- follow-up reminders
interface Raise { key: string; kind: string; table: string; record: Row; title: string; due: string; priority: 'normal' | 'high'; notes: string }
async function raise(org: string, ind: string, r: Raise, tally: AftersalesResult): Promise<void> {
  let clientId = has(r.record.client_id) ? String(r.record.client_id) : null;
  if (!clientId) { // the record only knows the VIN: the owner is whoever the vehicle was delivered to
    clientId = (await ownerOfVin(org, ind, r.record.vin)).client_id ?? null;
    if (clientId) await supabaseAdmin.from(r.table).update({ client_id: clientId }).eq('id', r.record.id as string);
  }
  if (!clientId) { tally.skippedNoRepresentative += 1; return; } // follow-ups need a real client
  // the customer is told even when no sales representative is assigned (the message is queued once per key)
  const who = str(r.record.client_name) || 'Customer';
  const veh = str(r.record.vin);
  const customerText: Record<string, [string, string]> = {
    service_due: ['Your vehicle service is coming up', `Dear ${who}, your vehicle ${veh} is due for service soon. Please call us to book a slot.`],
    service_missed: ['Your vehicle service is overdue', `Dear ${who}, the service for your vehicle ${veh} is overdue. Please call us to book a slot.`],
    insurance_renewal: ['Your vehicle insurance needs renewal', `Dear ${who}, the insurance for your vehicle ${veh} is expiring or has expired. Please contact us to renew it.`],
    warranty_ending: ['Your vehicle warranty is ending', `Dear ${who}, the warranty for your vehicle ${veh} is ending soon. Visit us for a free check-up and to ask about an extended warranty.`],
  };
  const msg = customerText[r.kind];
  if (msg) await enqueueCustomerMessage(org, ind, { key: r.key, kind: r.kind, clientId, subject: msg[0], body: msg[1] });
  const rep = await representativeFor(org, ind, clientId, null);
  if (!rep) { tally.skippedNoRepresentative += 1; return; } // not claimed, so it is retried once a representative is assigned
  if (!(await claim(org, r.key, r.kind, { record: r.record.id as string }))) return;
  const { error } = await supabaseAdmin.from('follow_ups').insert({ organization_id: org, representative_id: rep, client_id: clientId, title: r.title, due_at: r.due, priority: r.priority, follow_up_type: 'call', notes: r.notes });
  if (error) { await release(org, r.key); logger.error({ err: error, key: r.key }, 'vehicle after-sales: follow-up could not be created'); return; }
  tally.followUps += 1;
}

const label = (r: Row) => [str(r.client_name) || 'Customer', str(r.vin)].filter(Boolean).join(' - ');

async function remindServices(org: string, ind: string, tally: AftersalesResult) {
  const today = todayLocal();
  const { data } = await supabaseAdmin.from('vehicle_service_records').select('*').eq('organization_id', org).eq('industry_type_id', ind).eq('status', 'Scheduled').gte('service_date', addDays(today, -60)).lte('service_date', addDays(today, SERVICE_REMIND_DAYS)).limit(500);
  for (const s of (data ?? []) as Row[]) {
    if (!has(s.service_date)) continue;
    const date = String(s.service_date).slice(0, 10);
    const late = daysFromToday(date) < 0;
    await raise(org, ind, {
      key: `srv:${String(s.id)}:${late ? 'missed' : 'soon'}`, kind: late ? 'service_missed' : 'service_due', table: 'vehicle_service_records', record: s,
      title: late ? `Service overdue (${date}): ${label(s)}` : `Service due ${date}: ${label(s)}`,
      due: late ? new Date().toISOString() : dueAt(addDays(date, -2)), priority: late ? 'high' : 'normal',
      notes: `${str(s.service_type) || 'Service'} ${str(s.service_number)} is ${late ? 'overdue' : 'coming up'}. Call the customer to confirm a workshop slot.${has(s.next_service_odometer) ? ` Due at about ${String(s.next_service_odometer)} km.` : ''}`,
    }, tally);
  }
}

async function remindInsurance(org: string, ind: string, tally: AftersalesResult) {
  const today = todayLocal();
  const { data } = await supabaseAdmin.from('vehicle_insurance_policies').select('*').eq('organization_id', org).eq('industry_type_id', ind).in('status', ['Active', 'Expiring Soon', 'Expired']).gte('expiry_date', addDays(today, -30)).lte('expiry_date', addDays(today, RENEWAL_REMIND_DAYS)).limit(500);
  const list = (data ?? []) as Row[];
  const vins = [...new Set(list.map((p) => p.vin).filter(has).map(String))];
  const { data: later } = vins.length ? await supabaseAdmin.from('vehicle_insurance_policies').select('vin, expiry_date, status').eq('organization_id', org).eq('industry_type_id', ind).in('vin', vins).in('status', ['Active', 'Expiring Soon']) : { data: [] as Row[] };
  for (const p of list) {
    const expiry = String(p.expiry_date).slice(0, 10);
    // already renewed: another live policy for the same vehicle runs longer
    if (((later ?? []) as Row[]).some((o) => o.vin === p.vin && has(o.expiry_date) && String(o.expiry_date).slice(0, 10) > expiry)) continue;
    const days = daysFromToday(expiry);
    const stage = days < 0 ? 'expired' : days <= 7 ? '7' : '30';
    await raise(org, ind, {
      key: `ins:${String(p.id)}:${stage}`, kind: 'insurance_renewal', table: 'vehicle_insurance_policies', record: p,
      title: days < 0 ? `Insurance EXPIRED (${expiry}): ${label(p)}` : `Insurance renewal due ${expiry}: ${label(p)}`,
      due: days <= 7 ? new Date().toISOString() : dueAt(addDays(expiry, -14)), priority: days <= 7 ? 'high' : 'normal',
      notes: `Policy ${str(p.policy_number)}${has(p.provider) ? ` (${String(p.provider)})` : ''} ${days < 0 ? 'has expired' : `expires in ${days} day(s)`}. Call the customer to renew.`,
    }, tally);
  }
}

async function remindWarranties(org: string, ind: string, tally: AftersalesResult) {
  const today = todayLocal();
  const { data } = await supabaseAdmin.from('vehicle_warranties').select('*').eq('organization_id', org).eq('industry_type_id', ind).in('status', ['Active', 'Expiring Soon']).gte('end_date', today).lte('end_date', addDays(today, RENEWAL_REMIND_DAYS)).limit(500);
  for (const w of (data ?? []) as Row[]) {
    const end = String(w.end_date).slice(0, 10);
    await raise(org, ind, {
      key: `war:${String(w.id)}:30`, kind: 'warranty_ending', table: 'vehicle_warranties', record: w,
      title: `Warranty ends ${end}: ${label(w)}`, due: dueAt(addDays(end, -Math.min(daysFromToday(end), 14))), priority: 'normal',
      notes: `Warranty ${str(w.warranty_number)} ends in ${daysFromToday(end)} day(s). Offer a last free check-up and an extended warranty.`,
    }, tally);
  }
}

const REG_REMIND_DAYS = Math.max(1, Number(process.env.VEHICLE_REGISTRATION_REMIND_DAYS ?? 7));
async function remindRegistrations(org: string, ind: string, tally: AftersalesResult) {
  const before = new Date(Date.now() - REG_REMIND_DAYS * 86_400_000).toISOString();
  const { data } = await supabaseAdmin.from('vehicle_registrations').select('*').eq('organization_id', org).eq('industry_type_id', ind).in('status', ['Pending', 'Submitted', 'Under Process']).lte('created_at', before).limit(500);
  for (const g of (data ?? []) as Row[]) {
    await raise(org, ind, {
      key: `reg:${String(g.id)}:${REG_REMIND_DAYS}d`, kind: 'registration_pending', table: 'vehicle_registrations', record: g,
      title: `Registration still ${str(g.status).toLowerCase()} (${REG_REMIND_DAYS}+ days): ${label(g)}`, due: new Date().toISOString(), priority: 'normal',
      notes: `Registration of ${str(g.vin)} has been ${str(g.status).toLowerCase()} for over ${REG_REMIND_DAYS} days. Check the documents with the customer and the RTO.`,
    }, tally);
  }
}

// ---------------------------------------------------------------- runners
export async function runVehicleAftersales(org: string, ind: string): Promise<AftersalesResult> {
  const out: AftersalesResult = { firstServicesScheduled: 0, nextServicesScheduled: 0, followUps: 0, skippedNoRepresentative: 0, statusesRefreshed: false };
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (err) { logger.error({ err, org, ind }, `vehicle after-sales: ${name} failed`); } };
  await step('statuses', async () => { await refreshVehicleDateStatuses(org, ind); out.statusesRefreshed = true; });
  await step('first services', async () => { out.firstServicesScheduled = await scheduleFirstServices(org, ind); });
  await step('next services', async () => { out.nextServicesScheduled = await scheduleMissingNextServices(org, ind); });
  await step('service reminders', () => remindServices(org, ind, out));
  await step('insurance reminders', () => remindInsurance(org, ind, out));
  await step('warranty reminders', () => remindWarranties(org, ind, out));
  await step('registration reminders', () => remindRegistrations(org, ind, out));
  await step('customer messages', async () => { await processCustomerMessages(org); });
  return out;
}

let timer: NodeJS.Timeout | null = null;
let running = false;
export async function runVehicleAftersalesForAll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { data, error } = await supabaseAdmin.from('industry_types').select('id, organization_id').ilike('code', 'vehicle');
    if (error) { logger.error({ err: error }, 'vehicle after-sales: could not list Vehicle industries'); return; }
    for (const s of (data ?? []) as Row[]) await runVehicleAftersales(String(s.organization_id), String(s.id));
  } finally { running = false; }
}

export function startVehicleScheduler() {
  if (timer) return;
  if (process.env.VEHICLE_AUTOMATION === 'off') { logger.info('Vehicle after-sales automation disabled.'); return; }
  logger.info({ everyMinutes: INTERVAL_MS / 60_000 }, 'Starting Vehicle after-sales automation');
  setTimeout(() => void runVehicleAftersalesForAll(), 50_000).unref();
  timer = setInterval(() => void runVehicleAftersalesForAll(), INTERVAL_MS);
  timer.unref();
}