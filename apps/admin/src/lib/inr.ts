// Dashboard, Reports and the Clients outstanding figures are INR (home currency) summaries.
// A foreign-currency order carries base_total (its INR value); a payment on it is converted
// with that order's exchange rate. Local / non-FMCG rows have neither and pass through unchanged.
export function ordersInInr<T extends { total_amount: number }>(res: { data: T[] }): { data: T[] } {
  // Approved returns / damage are credit notes: they lower what the order is worth (INR value in returns_credit_base).
  return { data: (res.data ?? []).map((o) => { const r = o as { base_total?: number | null; returns_credit_base?: number | null }; const credit = Number(r.returns_credit_base ?? 0); const base = r.base_total; if (base == null && credit === 0) return o; return { ...o, total_amount: Number(base ?? o.total_amount) - credit }; }) };
}
export function collectionsInInr<T extends { amount: number }>(res: { data: T[] }): { data: T[] } {
  return { data: (res.data ?? []).map((c) => { const rate = Number((c as { sale_orders?: { exchange_rate?: number | null } | null }).sale_orders?.exchange_rate ?? 1) || 1; return rate !== 1 ? { ...c, amount: Number(c.amount) * rate } : c; }) };
}