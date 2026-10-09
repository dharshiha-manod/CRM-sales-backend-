// Shared expiry maths for the FMCG Batch & Expiry page and the Products page.
// Uses the same UTC-date day count as the API (api/src/lib/stock.ts), so "blocked" means the same thing everywhere.

export type BatchLike = { product_id: string; expiry_date: string | null; quantity: number | string };

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Whole days until an expiry date (negative = already expired). */
export const daysLeft = (expiry: string) => Math.round((Date.parse(expiry.slice(0, 10)) - Date.parse(todayIso())) / 86_400_000);

/** True when a batch can no longer be sold: expired, or within "Block sale within (days) of expiry". */
export const isUnsellable = (expiryDate: string | null, blockDays: number) => {
  if (!expiryDate) return false;
  const days = daysLeft(expiryDate);
  return days < 0 || (blockDays > 0 && days <= blockDays);
};

/** Units per product that sit in expired / blocked batches. */
export function lockedUnitsByProduct(batches: BatchLike[], blockDays: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of batches) {
    if (!isUnsellable(b.expiry_date, blockDays)) continue;
    out[b.product_id] = (out[b.product_id] ?? 0) + Number(b.quantity || 0);
  }
  return out;
}

/** yyyy-mm-dd plus N days (UTC). Same maths as the API, so the form preview equals what gets saved. */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Preview of the number the API will give a batch left without one: <code>-<yymmdd of mfg>-<running no.>. */
export function previewBatchNo(productCode: string, mfgDate: string, existing: string[]): string {
  const day = (mfgDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '').slice(2);
  const prefix = `${productCode}-${day}`;
  const used = new Set(existing.map((n) => n.toLowerCase()));
  for (let n = 1; n < 1000; n += 1) {
    const candidate = `${prefix}-${String(n).padStart(2, '0')}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${prefix}-…`;
}
