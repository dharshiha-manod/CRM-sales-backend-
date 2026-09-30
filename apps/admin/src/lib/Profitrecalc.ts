// Recalculates a saved Trade Profitability record from the records it is built from (Deal, Sales Order, Shipment,
// Logistics, Customs, Commission, Trade Finance).
//
// Why: the automatic record is a photo taken at one moment (when the deal completes). A cost entered later - freight
// typed into Logistics after the deal was completed, a customs bill that arrives after delivery - is not in that
// photo. This builds the up-to-date figures so the record can be refreshed on request.
//
// Insurance has no module of its own: it is typed by hand on the record, so it is kept and still counted.
import { chainFinancials, formatCostSources, num, type CostLine, type TradingChain } from './tradingChain';

const NON_CURRENCY_SKIP = 'insurance';

/** Same thresholds as the Trade Profitability page and the API. */
export function profitStatusFor(netMargin: number | null): string {
  if (netMargin == null) return 'Incomplete';
  if (netMargin < 0) return 'Loss';
  if (netMargin === 0) return 'Break-even';
  if (netMargin < 10) return 'Low Margin';
  if (netMargin < 20) return 'Profitable';
  return 'Highly Profitable';
}

export function buildRecalcPatch(record: Record<string, unknown>, chain: TradingChain, today = new Date().toISOString().slice(0, 10)): Record<string, unknown> {
  const f = chainFinancials(chain);
  // Insurance has no module: the figure typed on the record is kept, and named as such in the cost sources.
  const insurance = num(record.insurance);
  const lines: CostLine[] = f.lines.map((l) => (l.key === NON_CURRENCY_SKIP
    ? { ...l, amount: insurance, source: insurance != null ? 'Entered manually' : '', na: insurance == null ? 'optional, not entered' : undefined }
    : l));
  const patch: Record<string, unknown> = {
    analysis_date: today,
    revenue_source: f.revenueSource || null,
    cost_sources: formatCostSources(lines),
  };
  if (f.currency) patch.currency = f.currency;
  if (f.quantity != null) patch.quantity = f.quantity;
  if (f.revenue != null) patch.revenue = f.revenue;
  // A cost with no source now is cleared (null) so an old wrong figure cannot linger; insurance is never touched.
  for (const line of f.lines) if (line.key !== NON_CURRENCY_SKIP) patch[line.key] = line.amount;

  const costs = [...f.lines.filter((l) => l.key !== NON_CURRENCY_SKIP).map((l) => l.amount), num(record.insurance)]
    .filter((n): n is number => n != null);
  const totalCost = costs.length ? costs.reduce((a, b) => a + b, 0) : null;
  const revenue = f.revenue ?? num(record.revenue);
  const net = revenue != null && totalCost != null ? revenue - totalCost : null;
  const margin = net != null && revenue ? (net / revenue) * 100 : null;
  patch.status = profitStatusFor(margin);
  return patch;
}