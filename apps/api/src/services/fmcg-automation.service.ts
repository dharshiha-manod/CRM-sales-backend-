/* eslint-disable @typescript-eslint/no-explicit-any */
// FMCG Automation Center: the upkeep the system does by itself for the FMCG industry.
//  1. Schemes whose end date has passed are switched off (stale ones are only flagged, never touched).
//  2. Low-stock products get Draft purchase orders (drafts only: nothing is ever sent to a vendor automatically).
//  3. Late purchase orders and near-expiry / expired batches are surfaced on one screen.
// Uses existing tables only. Idempotent, so running on several instances is safe.
import { logger } from '../lib/logger.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { todayLocal } from '../lib/ist-date.js';
import { getFmcgAlerts } from '../lib/fmcg-alerts.js';
import { classifyScheme, poLateDays, type SchemeHealth } from '../lib/fmcg-automation-rules.js';
import { createReorderDrafts, reorderPlan } from '../routes/fmcg-purchase.routes.js';

type Row = Record<string, any>;

async function pageAll(build: () => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Every (organization, FMCG industry) pair. */
export async function listFmcgScopes(): Promise<{ org: string; it: string }[]> {
  const rows = await pageAll(() => supabaseAdmin.from('industry_types').select('id, organization_id, code').ilike('code', 'fmcg').order('id'));
  return rows.map((r) => ({ org: String(r.organization_id), it: String(r.id) }));
}

export async function schemeHealth(org: string, it: string, today = todayLocal()) {
  const rows = await pageAll(() => supabaseAdmin.from('fmcg_schemes').select('id, name, scheme_type, status, start_date, end_date, created_at').eq('organization_id', org).eq('industry_type_id', it).order('created_at', { ascending: false }));
  const items = rows.map((s) => ({ id: s.id as string, name: s.name as string, scheme_type: s.scheme_type as string, start_date: s.start_date ?? null, end_date: s.end_date ?? null, status: s.status as string, ...classifyScheme(s, today) }));
  const count = (h: SchemeHealth) => items.filter((i) => i.health === h).length;
  return { items, counts: { expired: count('expired'), ending_soon: count('ending_soon'), stale: count('stale'), upcoming: count('upcoming'), ok: count('ok'), inactive: count('inactive') } };
}

/** Switches off every active scheme whose end date is before today. Returns the schemes it switched off. */
export async function expireSchemes(org: string, it: string, today = todayLocal()): Promise<{ id: string; name: string; end_date: string }[]> {
  const { data, error } = await supabaseAdmin.from('fmcg_schemes').update({ status: 'inactive', updated_at: new Date().toISOString() })
    .eq('organization_id', org).eq('industry_type_id', it).eq('status', 'active').not('end_date', 'is', null).lt('end_date', today).select('id, name, end_date');
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), name: String(r.name), end_date: String(r.end_date).slice(0, 10) }));
}

export async function latePurchaseOrders(org: string, it: string, today = todayLocal()) {
  const rows = await pageAll(() => supabaseAdmin.from('fmcg_purchase_orders').select('id, po_number, status, expected_date, total_amount, fmcg_vendors(vendor_name)').eq('organization_id', org).eq('industry_type_id', it).in('status', ['Ordered', 'Partially Received']).order('expected_date'));
  return rows.map((p) => ({ id: p.id as string, po_number: p.po_number as string, vendor_name: ((Array.isArray(p.fmcg_vendors) ? p.fmcg_vendors[0] : p.fmcg_vendors) as Row | null)?.vendor_name ?? null, status: p.status as string, expected_date: p.expected_date ?? null, total_amount: Number(p.total_amount ?? 0), days_late: poLateDays(p, today) })).filter((p) => p.days_late > 0).sort((a, b) => b.days_late - a.days_late);
}

export async function todaySummary(org: string, it: string) {
  const today = todayLocal();
  const [schemes, alerts, plan, late, drafts] = await Promise.all([
    schemeHealth(org, it, today), getFmcgAlerts(org, it, today), reorderPlan(org, it), latePurchaseOrders(org, it, today),
    supabaseAdmin.from('fmcg_purchase_orders').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('industry_type_id', it).eq('status', 'Draft'),
  ]);
  return {
    date: today,
    schemes: schemes.counts,
    expiry: { expired: alerts.expiry.filter((e) => e.level === 'expired').length, expiring: alerts.expiry.filter((e) => e.level === 'expiring').length, warningDays: alerts.warningDays },
    lowStock: { count: alerts.lowStock.length },
    reorder: { toOrder: plan.items.length, noVendor: plan.unassigned.length, draftPos: drafts.count ?? 0 },
    latePos: late.length,
  };
}

/** What the background job (and the "Run now" button) does for one FMCG industry. */
export async function runAutomationForScope(org: string, it: string, actor: string | null = null) {
  const expired = await expireSchemes(org, it);
  const reorder = await createReorderDrafts(org, it, actor, 'Auto-drafted by Automation Center (low stock)');
  return { schemesExpired: expired, draftsCreated: reorder.created.map((p) => ({ id: p.id, po_number: p.po_number })), productsWithoutVendor: reorder.unassigned.length };
}

let running = false;
export async function runFmcgAutomation() {
  if (running) return;
  running = true;
  try {
    for (const s of await listFmcgScopes()) {
      try {
        const r = await runAutomationForScope(s.org, s.it);
        if (r.schemesExpired.length || r.draftsCreated.length) logger.info({ ...s, expired: r.schemesExpired.length, drafts: r.draftsCreated.length }, 'FMCG automation ran');
      } catch (err) { logger.error({ err, ...s }, 'FMCG automation failed for scope'); }
    }
  } finally { running = false; }
}

const INTERVAL_MS = Math.max(5, Number(process.env.FMCG_AUTOMATION_MINUTES ?? 60)) * 60_000;
let timer: NodeJS.Timeout | null = null;
export function startFmcgScheduler() {
  if (timer) return;
  if (process.env.FMCG_AUTOMATION === 'off') { logger.info('FMCG automation disabled.'); return; }
  logger.info({ everyMinutes: INTERVAL_MS / 60_000 }, 'Starting FMCG automation');
  setTimeout(() => void runFmcgAutomation(), 50_000).unref();
  timer = setInterval(() => void runFmcgAutomation(), INTERVAL_MS);
  timer.unref();
}