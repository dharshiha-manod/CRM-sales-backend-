// Pure rules for the FMCG Automation Center (no database), so they can be tested on their own.
// A scheme is judged by its dates only; the status column is what the person (or the automation) switches on / off.
import { daysUntilExpiry } from './stock.js';

export type SchemeHealth = 'expired' | 'ending_soon' | 'stale' | 'upcoming' | 'ok' | 'inactive';
export type SchemeLike = { status?: string | null; start_date?: string | null; end_date?: string | null; created_at?: string | null; name?: string | null };

export const ENDING_SOON_DAYS = 7;
export const STALE_AFTER_DAYS = 90;
export const SEASONAL_STALE_AFTER_DAYS = 45;
// Festival / season words: a scheme named like this with no end date is almost certainly left over.
const SEASONAL = /\b(diwali|deepavali|holi|pongal|onam|navratri|dussehra|eid|christmas|new\s*year|summer|monsoon|festival|festive|season)\b/i;

const day = (v?: string | null) => (v ? String(v).slice(0, 10) : null);

/** expired = active but its end date is before today (the automation switches these off). */
export function classifyScheme(s: SchemeLike, today: string): { health: SchemeHealth; daysLeft: number | null; reason: string } {
  const end = day(s.end_date); const start = day(s.start_date);
  if (s.status && s.status !== 'active') return { health: 'inactive', daysLeft: null, reason: 'Switched off' };
  if (end && end < today) return { health: 'expired', daysLeft: daysUntilExpiry(end, today), reason: `Ended on ${end}` };
  if (start && start > today) return { health: 'upcoming', daysLeft: null, reason: `Starts on ${start}` };
  if (end) {
    const left = daysUntilExpiry(end, today);
    if (left <= ENDING_SOON_DAYS) return { health: 'ending_soon', daysLeft: left, reason: left === 0 ? 'Ends today' : `Ends in ${left} day${left === 1 ? '' : 's'}` };
    return { health: 'ok', daysLeft: left, reason: `Runs until ${end}` };
  }
  // No end date: judge by age.
  const created = day(s.created_at);
  const age = created ? -daysUntilExpiry(created, today) : 0;
  const limit = SEASONAL.test(String(s.name ?? '')) ? SEASONAL_STALE_AFTER_DAYS : STALE_AFTER_DAYS;
  if (age > limit) return { health: 'stale', daysLeft: null, reason: `No end date and running for ${age} days. Set an end date or switch it off.` };
  return { health: 'ok', daysLeft: null, reason: 'No end date' };
}

/** A PO is late when its expected date has passed and goods are still due. */
export function poLateDays(po: { status?: string | null; expected_date?: string | null }, today: string): number {
  if (!['Ordered', 'Partially Received'].includes(String(po.status ?? ''))) return 0;
  const exp = day(po.expected_date);
  if (!exp || exp >= today) return 0;
  return -daysUntilExpiry(exp, today);
}