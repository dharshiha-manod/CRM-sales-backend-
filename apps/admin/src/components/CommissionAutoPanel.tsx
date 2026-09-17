// FILE: admin/src/components/CommissionAutoPanel.tsx
// This is what stops Commission Management being a data-entry page.
//
// It reads the real chain (Deal -> Order -> Shipment -> Invoice/Collection),
// finds every transaction that should have commission and doesn't, works
// out the amount from the configured rules, and writes the record. It also
// re-checks existing Pending records and moves them to Eligible the moment
// their qualifying event actually happens — which is the difference between
// "commission is calculated" and "somebody remembered to update a dropdown".
//
// It deliberately will not create a record for a transaction that hasn't
// qualified. Those are listed as "waiting", with the reason, so the pipeline
// is visible without anything being treated as earned early.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import {
  buildChain, chainFinancials, chainStatus, invalidateTradingChain,
  loadTradingTables, money, type ChainRow, type TradingChain,
} from '../lib/tradingChain';
import {
  computeCommission, hasQualified, invalidateCommissionRules,
  loadCommissionRules, qualifyingNote, resolveRule, type CommissionContext,
} from '../lib/commissionRules';

const str = (v: unknown): string => (v == null ? '' : String(v));

interface Candidate {
  dealNumber: string;
  chain: TradingChain;
  ctx: CommissionContext;
  rule?: ChainRow;
  amount: number | null;
  workingNote: string;
  rateApplied: number | null;
  qualified: boolean;
  note: string;
  existing?: ChainRow;
  currency: string;
}

const panelStyle: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 10, padding: '0.9rem 1rem' };
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.9rem', margin: '0 0 1.25rem' };
const listStyle: React.CSSProperties = { margin: 0, padding: 0, listStyle: 'none', fontSize: '.82rem', display: 'grid', gap: '.4rem' };

/** Deals that are still being negotiated never generate commission. */
const LIVE_DEAL_STATUSES = ['Confirmed', 'In Progress', 'Completed'];

export function CommissionAutoPanel({ commissions, onChanged }: { commissions: ChainRow[]; onChanged?: () => void }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const analyse = useCallback(async () => {
    try {
      const [tables, rules] = await Promise.all([
        loadTradingTables(activeIndustryTypeId, true),
        loadCommissionRules(activeIndustryTypeId, true),
      ]);

      // Period sales per rep, so Target Achievement rules have something
      // real to measure against instead of a single deal in isolation.
      const periodByRep = new Map<string, number>();
      for (const deal of tables.deals) {
        const rep = str(deal.sales_rep);
        if (!rep) continue;
        const chain = buildChain(tables, { deal_number: str(deal.deal_number) });
        const value = chainFinancials(chain).revenue;
        if (value != null) periodByRep.set(rep, (periodByRep.get(rep) ?? 0) + value);
      }

      const out: Candidate[] = [];
      for (const deal of tables.deals) {
        const dealNumber = str(deal.deal_number);
        if (!dealNumber) continue;
        if (!LIVE_DEAL_STATUSES.includes(str(deal.status))) continue;

        const chain = buildChain(tables, { deal_number: dealNumber });
        const financials = chainFinancials(chain);
        const status = chainStatus(chain);
        const ctx: CommissionContext = {
          sales_rep: str(deal.sales_rep),
          customer_name: str(deal.customer_name),
          product_name: str(deal.product_name),
          product_category: str(deal.product_category),
          deal_number: dealNumber,
          salesValue: financials.revenue,
          purchaseValue: financials.purchaseCost,
          quantity: financials.quantity,
          periodSalesValue: periodByRep.get(str(deal.sales_rep)) ?? null,
        };
        const rule = resolveRule(rules, ctx);
        const result = computeCommission(rule, ctx);
        out.push({
          dealNumber,
          chain,
          ctx,
          rule,
          amount: result.amount,
          workingNote: result.workingNote,
          rateApplied: result.rateApplied,
          qualified: hasQualified(rule, status),
          note: qualifyingNote(rule, status),
          existing: commissions.find((c) => str(c.deal_number) === dealNumber),
          currency: financials.currency,
        });
      }
      setCandidates(out);
    } catch {
      setCandidates([]);
    }
  }, [activeIndustryTypeId, commissions]);

  useEffect(() => { void analyse(); }, [analyse]);

  const missing = (candidates ?? []).filter((c) => !c.existing && c.qualified && c.amount != null);
  const waiting = (candidates ?? []).filter((c) => !c.existing && !c.qualified);
  const unpriced = (candidates ?? []).filter((c) => !c.existing && c.qualified && c.amount == null);
  const toPromote = (candidates ?? []).filter((c) => c.existing && c.qualified && str(c.existing.status) === 'Pending');

  async function generate(list: Candidate[]) {
    if (!list.length) return;
    setBusy(true);
    setMessage('');
    try {
      const year = new Date().getFullYear();
      let seq = commissions.length + 1;
      const today = new Date().toISOString().slice(0, 10);
      for (const c of list) {
        const status = chainStatus(c.chain);
        const financials = chainFinancials(c.chain);
        await api('/trading/commissions', {
          method: 'POST',
          body: JSON.stringify({
            commission_number: `COM-${year}-${String(seq++).padStart(4, '0')}`,
            deal_number: c.dealNumber,
            order_number: str(c.chain.order?.order_number ?? c.chain.deal?.order_number) || null,
            shipment_number: str(c.chain.shipments[0]?.shipment_number) || null,
            invoice_number: status.invoiceNumber || null,
            sales_rep: c.ctx.sales_rep || null,
            customer_name: c.ctx.customer_name || null,
            product_name: c.ctx.product_name || null,
            quantity: c.ctx.quantity,
            purchase_value: c.ctx.purchaseValue,
            selling_value: c.ctx.salesValue,
            currency: financials.currency,
            rule_code: str(c.rule?.rule_code) || null,
            commission_basis: str(c.rule?.commission_basis) || null,
            commission_rate: c.rateApplied,
            commission_amount: c.amount,
            calculation_note: c.workingNote,
            qualifying_event: str(c.rule?.qualifying_event) || null,
            delivery_status: status.deliveryStatus,
            payment_status: status.paymentStatus,
            calculation_date: today,
            eligible_date: today,
            status: 'Eligible',
            industry_type_id: activeIndustryTypeId ?? undefined,
          }),
        });
      }
      invalidateTradingChain();
      invalidateCommissionRules();
      setMessage(`${list.length} commission record${list.length > 1 ? 's' : ''} created from live transactions.`);
      onChanged?.();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Unable to create commission records.');
    } finally {
      setBusy(false);
    }
  }

  async function promote() {
    if (!toPromote.length) return;
    setBusy(true);
    setMessage('');
    try {
      const today = new Date().toISOString().slice(0, 10);
      for (const c of toPromote) {
        const status = chainStatus(c.chain);
        await api(`/trading/commissions/${c.existing!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'Eligible',
            eligible_date: today,
            delivery_status: status.deliveryStatus,
            payment_status: status.paymentStatus,
            // Re-price against the rule as it stands now, since the record
            // hadn't been earned yet — an already-Approved record is never
            // touched, so historical payouts keep their original terms.
            commission_amount: c.amount,
            commission_rate: c.rateApplied,
            calculation_note: c.workingNote,
          }),
        });
      }
      invalidateTradingChain();
      setMessage(`${toPromote.length} record${toPromote.length > 1 ? 's' : ''} moved to Eligible.`);
      onChanged?.();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Unable to update eligibility.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={gridStyle}>
      <div style={panelStyle}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '.78rem' }}>
          Ready to calculate ({missing.length})
        </p>
        {candidates === null ? (
          <p style={{ margin: 0, fontSize: '.82rem', opacity: 0.65 }}>Reading live transactions…</p>
        ) : missing.length === 0 ? (
          <p style={{ margin: 0, fontSize: '.82rem', opacity: 0.65 }}>Every qualified transaction already has a commission record.</p>
        ) : (
          <>
            <ul style={listStyle}>
              {missing.slice(0, 5).map((c) => (
                <li key={c.dealNumber} style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem' }}>
                  <span>{c.dealNumber} — {c.ctx.sales_rep || 'no rep'}</span>
                  <strong>{money(c.amount, c.currency)}</strong>
                </li>
              ))}
            </ul>
            <button type="button" className="primary-action" style={{ marginTop: '.6rem' }} disabled={busy} onClick={() => void generate(missing)}>
              {busy ? 'Working…' : `Calculate ${missing.length}`}
            </button>
          </>
        )}
      </div>

      <div style={panelStyle}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '.78rem' }}>
          Eligibility to update ({toPromote.length})
        </p>
        {toPromote.length === 0 ? (
          <p style={{ margin: 0, fontSize: '.82rem', opacity: 0.65 }}>No pending record has newly qualified.</p>
        ) : (
          <>
            <ul style={listStyle}>
              {toPromote.slice(0, 5).map((c) => (
                <li key={c.dealNumber}>{str(c.existing?.commission_number)} — {c.note}</li>
              ))}
            </ul>
            <button type="button" className="primary-action" style={{ marginTop: '.6rem' }} disabled={busy} onClick={() => void promote()}>
              {busy ? 'Working…' : `Mark ${toPromote.length} eligible`}
            </button>
          </>
        )}
      </div>

      <div style={panelStyle}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '.78rem' }}>
          Not yet earned ({waiting.length})
        </p>
        {waiting.length === 0 ? (
          <p style={{ margin: 0, fontSize: '.82rem', opacity: 0.65 }}>Nothing waiting on delivery or collection.</p>
        ) : (
          <ul style={listStyle}>
            {waiting.slice(0, 6).map((c) => (
              <li key={c.dealNumber}>
                <strong>{c.dealNumber}</strong> — <span style={{ opacity: 0.75 }}>{c.note}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {unpriced.length > 0 && (
        <div style={panelStyle}>
          <p style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '.78rem' }}>
            Qualified but not priced ({unpriced.length})
          </p>
          <ul style={listStyle}>
            {unpriced.slice(0, 6).map((c) => (
              <li key={c.dealNumber}>
                <strong>{c.dealNumber}</strong> — <span style={{ opacity: 0.75 }}>{c.workingNote}</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: '.5rem 0 0', fontSize: '.78rem', opacity: 0.65 }}>
            Add or correct a rule in Commission Rules — nothing is calculated on a guessed rate.
          </p>
        </div>
      )}

      {message && (
        <p className={message.includes('Unable') ? 'error-message' : 'success-message'} style={{ gridColumn: '1 / -1', margin: 0 }}>
          {message}
        </p>
      )}
    </div>
  );
}