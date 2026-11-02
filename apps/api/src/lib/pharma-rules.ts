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

/** Customer drug licence: a pharma customer whose licence has run out cannot be sold to. Returns a plain-words problem, or null when fine / not recorded. */
export const licenseProblem = (details: unknown, today = todayIso()): string | null => {
  const d = (details && typeof details === 'object' ? details : {}) as { drugLicenseNumber?: unknown; licenseValidTill?: unknown };
  const till = toDay(d.licenseValidTill);
  if (!till) return null; // validity date not recorded: cannot be judged
  if (till < today) return `Drug license ${String(d.drugLicenseNumber ?? '').trim() || '(no number)'} expired on ${till}. Update the license on the client before selling to them.`;
  return null;
};

/** Days until the customer's drug licence runs out (negative = already expired). null when no validity date is recorded. */
export const licenseDaysLeft = (details: unknown, today = todayIso()): number | null => {
  const d = (details && typeof details === 'object' ? details : {}) as { licenseValidTill?: unknown };
  const till = toDay(d.licenseValidTill);
  return till ? Math.round((Date.parse(till) - Date.parse(today)) / 86_400_000) : null;
};
/** Licences expiring within this many days raise an alert (so the customer can renew before sales are blocked). */
export const LICENSE_WARN_DAYS = 30;

/** Statuses a record can never leave (a closed recall, a completed campaign...). Keeps history honest: closed work is re-created, not re-opened. */
export const TERMINAL_STATUS: Record<string, string[]> = {
  pharma_recalls: ['Closed'],
  pharma_medicine_returns: ['Closed', 'Rejected'],
  pharma_promotions: ['Cancelled'], // 'Completed' is set by the calendar, so it stays editable
  pharma_hospital_engagements: ['Follow-up completed'],
  pharma_samples: ['Returned'],
};
/** Returns a problem message when the status change is not allowed, else null. */
export const statusMoveProblem = (table: string, from: unknown, to: unknown): string | null => {
  const a = String(from ?? ''); const b = String(to ?? '');
  if (!b || a === b) return null;
  if ((TERMINAL_STATUS[table] ?? []).includes(a)) return `This record is ${a} and cannot be moved to ${b}. Create a new record instead.`;
  return null;
};
