// Pure Pharma rules (no database) so routes, stock engine, jobs and tests all share one definition.
export const BATCH_BLOCKED = ['Expired', 'Recalled', 'Quarantined'];
/** Batches closer to expiry than this many days are not picked for orders. 0 = only expired stock is blocked. Override with PHARMA_BLOCK_SALE_DAYS. */
export const PHARMA_BLOCK_SALE_DAYS = Math.max(0, Number(process.env.PHARMA_BLOCK_SALE_DAYS ?? 0) || 0);
const toDay = (v: unknown) => String(v ?? '').slice(0, 10);
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const daysLeft = (expiry: unknown, today = todayIso()): number | null => {
  const d = toDay(expiry); if (!d) return null;
  return Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
};
export const expiryStatus = (expiry: unknown, today = todayIso()): string => {
  const days = daysLeft(expiry, today); if (days === null) return 'Valid';
  if (days < 0) return 'Expired'; if (days <= 30) return 'Critical Expiry'; if (days <= 90) return 'Expiring Soon'; return 'Valid';
};
export const isBatchBlocked = (b: { status?: unknown; expiry_date?: unknown }, today = todayIso()) =>
  BATCH_BLOCKED.includes(String(b.status)) || expiryStatus(b.expiry_date, today) === 'Expired';
/** Can this batch be sold? Blocked statuses and (optionally) too-close-to-expiry batches cannot. */
export const isSellable = (b: { status?: unknown; expiry_date?: unknown }, today = todayIso(), minDays = PHARMA_BLOCK_SALE_DAYS) => {
  if (isBatchBlocked(b, today)) return false;
  const d = daysLeft(b.expiry_date, today);
  return d === null || d > minDays;
};