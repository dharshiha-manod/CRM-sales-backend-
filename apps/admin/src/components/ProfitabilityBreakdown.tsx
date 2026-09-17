// FILE: admin/src/components/ProfitabilityBreakdown.tsx
// Shows where every figure on a profitability record actually came from,
// and — the part the spec is firm about — which costs are genuinely not
// recorded anywhere, rather than quietly treating a missing freight
// invoice as zero freight.
//
// The stored record keeps the numbers as they were when the analysis was
// run. This panel re-reads the live chain alongside them, so a cost that
// has since been recorded (a customs declaration filed after the fact)
// shows up as a difference instead of silently ageing.
import { useEffect, useState } from 'react';
import { useIndustryScope } from '../industry/useIndustryScope';
import {
  buildChain, chainFinancials, loadTradingTables, money, num,
  type ChainFinancials,
} from '../lib/tradingChain';

const str = (v: unknown): string => (v == null ? '' : String(v));

const boxStyle: React.CSSProperties = { margin: '1rem 0', padding: '0.9rem 1rem', border: '1px solid var(--line)', borderRadius: 10 };
const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '.8rem', padding: '.2rem 0', fontSize: '.84rem' };

export function ProfitabilityBreakdown({ record }: { record: Record<string, unknown> }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const [live, setLive] = useState<ChainFinancials | null>(null);
  const [loaded, setLoaded] = useState(false);
  const dealNumber = str(record.deal_number);

  useEffect(() => {
    let cancelled = false;
    if (!dealNumber) { setLoaded(true); return; }
    loadTradingTables(activeIndustryTypeId)
      .then((tables) => {
        if (cancelled) return;
        setLive(chainFinancials(buildChain(tables, {
          deal_number: dealNumber,
          order_number: str(record.order_number) || undefined,
          shipment_number: str(record.shipment_number) || undefined,
        })));
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealNumber, activeIndustryTypeId]);

  const currency = str(record.currency) || live?.currency || '';

  // Stored values, keyed to match the live line keys.
  const stored: Record<string, number | null> = {
    purchase_cost: num(record.purchase_cost),
    freight: num(record.freight),
    customs_duty: num(record.customs_duty),
    port_charges: num(record.port_charges),
    insurance: num(record.insurance),
    other_costs: num(record.other_costs),
    finance_charges: num(record.finance_charges),
    commission: num(record.commission),
  };

  const lines = live?.lines ?? Object.keys(stored).map((key) => ({ key, label: key, amount: stored[key], source: '' }));
  const notRecorded = lines.filter((l) => stored[l.key] == null && l.amount == null);

  return (
    <div style={boxStyle}>
      <p style={{ margin: '0 0 0.6rem', fontWeight: 700, fontSize: '.8rem', letterSpacing: '.02em' }}>
        Cost breakdown{dealNumber ? ` for ${dealNumber}` : ''}
      </p>

      {!loaded ? (
        <p style={{ margin: 0, fontSize: '.85rem', opacity: 0.7 }}>Reading linked records…</p>
      ) : (
        <>
          <div style={{ ...rowStyle, fontWeight: 700, borderBottom: '1px solid var(--line)', paddingBottom: '.35rem' }}>
            <span>Revenue</span>
            <span>{money(num(record.revenue) ?? live?.revenue ?? null, currency)}</span>
          </div>
          {live?.revenueSource && (
            <p style={{ margin: '.2rem 0 .6rem', fontSize: '.75rem', opacity: 0.6 }}>{live.revenueSource}</p>
          )}

          {lines.map((l) => {
            const storedValue = stored[l.key];
            const drifted = storedValue != null && l.amount != null && Math.abs(storedValue - l.amount) > 0.01;
            return (
              <div key={l.key} style={rowStyle}>
                <span>
                  {l.label}
                  {l.source && <span style={{ opacity: 0.55, fontSize: '.75rem' }}> · {l.source}</span>}
                  {!l.source && storedValue != null && <span style={{ opacity: 0.55, fontSize: '.75rem' }}> · entered here</span>}
                </span>
                <span style={{ color: storedValue == null && l.amount == null ? 'var(--red)' : undefined }}>
                  {money(storedValue ?? l.amount, currency)}
                  {drifted && (
                    <span style={{ opacity: 0.7, fontSize: '.75rem' }}> (now {money(l.amount, currency)})</span>
                  )}
                </span>
              </div>
            );
          })}

          <div style={{ ...rowStyle, fontWeight: 700, borderTop: '1px solid var(--line)', marginTop: '.4rem', paddingTop: '.35rem' }}>
            <span>Net profit</span>
            <span>{money(num(record.net_profit) ?? live?.netProfit ?? null, currency)}</span>
          </div>

          {notRecorded.length > 0 && (
            <p style={{ margin: '.7rem 0 0', fontSize: '.78rem', color: 'var(--red)' }}>
              ⚠ Not recorded anywhere: {notRecorded.map((l) => l.label).join(', ')}. These are excluded from the total rather than counted as zero, so net profit here is an upper bound.
            </p>
          )}
        </>
      )}
    </div>
  );
}