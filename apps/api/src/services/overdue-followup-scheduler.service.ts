// Background job: raises the automatic "Payment overdue" follow-up for every organization on a timer,
// so reps get reminders even when nobody opens the Follow-ups page. The raise logic itself is idempotent
// (one follow-up per order, ever), so running on several instances is safe.
import { logger } from '../lib/logger.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { syncOverdueCollectionFollowUps } from '../repositories/follow-ups.repository.js';

const INTERVAL_MS = Math.max(5, Number(process.env.OVERDUE_FOLLOWUP_MINUTES ?? 60)) * 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runOverdueFollowUps() {
  if (running) return; // never overlap two runs
  running = true;
  try {
    for (let from = 0; ; from += 200) {
      const { data, error } = await supabaseAdmin.from('organizations').select('id').order('id').range(from, from + 199);
      if (error) { logger.error({ err: error }, 'Overdue follow-up scheduler could not list organizations'); return; }
      for (const org of data ?? []) {
        try { await syncOverdueCollectionFollowUps(org.id as string); } catch (err) { logger.error({ err, org: org.id }, 'Overdue follow-up run failed for organization'); }
      }
      if ((data ?? []).length < 200) break;
    }
  } finally { running = false; }
}

export function startOverdueFollowUpScheduler() {
  if (timer) return;
  if (process.env.OVERDUE_FOLLOWUP_AUTOMATION === 'off') { logger.info('Overdue follow-up automation disabled.'); return; }
  logger.info({ everyMinutes: INTERVAL_MS / 60_000 }, 'Starting overdue follow-up automation');
  void runOverdueFollowUps();
  timer = setInterval(() => void runOverdueFollowUps(), INTERVAL_MS);
  timer.unref();
}