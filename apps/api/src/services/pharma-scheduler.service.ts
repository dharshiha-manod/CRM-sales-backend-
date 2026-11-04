// Background upkeep for Pharma. Batch expiry statuses, campaign statuses and product stock were only
// refreshed when someone opened a list. This runs them for every organization on a timer, and then the
// distributor automation (auto-reorder drafts, auto-invoices, payment reminders, recall notices).
// Idempotent, so running on several instances is safe. Set PHARMA_AUTOMATION=off to disable.
import { logger } from '../lib/logger.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { runPharmaUpkeep } from '../routes/pharma.routes.js';
import { listScopes, runAutomationForScope } from './pharma-automation.service.js';
import { runPlusForScope } from './pharma-automation-plus.service.js';

const INTERVAL_MS = Math.max(5, Number(process.env.PHARMA_UPKEEP_MINUTES ?? 360)) * 60_000;
// Distributor automation (reminders, invoices) runs more often than the 6-hourly upkeep.
const AUTOMATION_MS = Math.max(5, Number(process.env.PHARMA_AUTOMATION_MINUTES ?? 60)) * 60_000;
let timer: NodeJS.Timeout | null = null;
let autoTimer: NodeJS.Timeout | null = null;
let running = false;
let autoRunning = false;

export async function runPharmaScheduler() {
  if (running) return;
  running = true;
  try {
    const orgs = new Set<string>();
    for (const table of ['pharma_company_profile', 'pharma_suppliers', 'pharma_batches', 'pharma_promotions']) {
      // Page through every row: a fixed "first 5000" would hide small organizations behind one big one's batches.
      for (let from = 0; from < 200_000; from += 1000) {
        const { data, error } = await supabaseAdmin.from(table).select('organization_id').order('organization_id').range(from, from + 999);
        if (error) { if ((error as { code?: string }).code !== '42P01') logger.error({ err: error, table }, 'Pharma scheduler could not list organizations'); break; }
        for (const r of data ?? []) orgs.add(r.organization_id as string);
        if (!data || data.length < 1000) break;
      }
    }
    for (const org of orgs) {
      try { await runPharmaUpkeep(org); } catch (err) { logger.error({ err, org }, 'Pharma upkeep failed for organization'); }
    }
  } finally { running = false; }
}

export async function runPharmaAutomation() {
  if (autoRunning) return;
  autoRunning = true;
  try {
    for (const s of await listScopes()) {
      try { await runAutomationForScope(s.org, s.it); await runPlusForScope(s.org, s.it); } catch (err) { logger.error({ err, ...s }, 'Pharma automation failed for scope'); }
    }
  } finally { autoRunning = false; }
}

export function startPharmaScheduler() {
  if (timer) return;
  if (process.env.PHARMA_AUTOMATION === 'off') { logger.info('Pharma automation disabled.'); return; }
  logger.info({ everyMinutes: INTERVAL_MS / 60_000, automationEveryMinutes: AUTOMATION_MS / 60_000 }, 'Starting Pharma upkeep automation');
  setTimeout(() => void runPharmaScheduler(), 20_000).unref();
  setTimeout(() => void runPharmaAutomation(), 40_000).unref();
  timer = setInterval(() => void runPharmaScheduler(), INTERVAL_MS);
  timer.unref();
  autoTimer = setInterval(() => void runPharmaAutomation(), AUTOMATION_MS);
  autoTimer.unref();
}
