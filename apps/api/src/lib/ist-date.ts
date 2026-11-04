// Pharma runs on Indian dates. new Date().toISOString() is UTC, which is 5h30m behind India: between 00:00 and 05:30 IST it still says "yesterday".
// Override with PHARMA_TZ_OFFSET_MIN (minutes east of UTC) if you operate in another timezone.
const OFFSET_MIN = Number.isFinite(Number(process.env.PHARMA_TZ_OFFSET_MIN)) && process.env.PHARMA_TZ_OFFSET_MIN ? Number(process.env.PHARMA_TZ_OFFSET_MIN) : 330;

/** Today's date (YYYY-MM-DD) in the business timezone. */
export const todayLocal = (now: number = Date.now()): string => new Date(now + OFFSET_MIN * 60_000).toISOString().slice(0, 10);

/** Indian financial year label for a date: Apr 2026 - Mar 2027 -> "2026-27". GST invoice / credit note series restart each financial year. */
export const financialYear = (isoDate: string): string => {
  const y = Number(isoDate.slice(0, 4)); const m = Number(isoDate.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};