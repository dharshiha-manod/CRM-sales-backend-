// Background upkeep for Pharma. Batch expiry statuses, campaign statuses and product stock were only
// refreshed when someone opened a list. This runs them for every organization on a timer.
// Idempotent, so running on several instances is safe. Set PHARMA_AUTOMATION=off to disable.
import { logger } from '../lib/logger.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { runPharmaUpkeep } from '../routes/pharma.routes.js';

const INTERVAL_MS = Math.max(5, Number(process.env.PHARMA_UPKEEP_MINUTES ?? 360)) * 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runPharmaScheduler() {
  if (running) return;
  running = true;
  try {
    const orgs = new Set<string>();
    for (const table of ['pharma_batches', 'pharma_promotions']) {
      const { data, error } = await supabaseAdmin.from(table).select('organization_id').limit(5000);
      if (error) { if ((error as { code?: string }).code !== '42P01') logger.error({ err: error, table }, 'Pharma scheduler could not list organizations'); continue; }
      for (const r of data ?? []) orgs.add(r.organization_id as string);
    }
    for (const org of orgs) {
      try { await runPharmaUpkeep(org); } catch (err) { logger.error({ err, org }, 'Pharma upkeep failed for organization'); }
    }
  } finally { running = false; }
}

export function startPharmaScheduler() {
  if (timer) return;
  if (process.env.PHARMA_AUTOMATION === 'off') { logger.info('Pharma automation disabled.'); return; }
  logger.info({ everyMinutes: INTERVAL_MS / 60_000 }, 'Starting Pharma upkeep automation');
  setTimeout(() => void runPharmaScheduler(), 20_000).unref();
  timer = setInterval(() => void runPharmaScheduler(), INTERVAL_MS);
  timer.unref();
}