// FILE: admin/src/components/RecalculateProfitButton.tsx
// "Recalculate" for a saved Trade Profitability record: re-reads every linked record and refreshes the costs, the
// revenue and the profit status. Nothing changes until this is pressed, so a past record is never re-priced by itself.
import { useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { buildChain, invalidateTradingChain, loadTradingTables } from '../lib/tradingChain';
import { buildRecalcPatch } from '../lib/Profitrecalc';

const str = (v: unknown): string => (v == null ? '' : String(v));

export function RecalculateProfitButton({ record, onDone }: { record: Record<string, unknown> & { id?: string }; onDone: () => void }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dealNumber = str(record.deal_number);
  if (!record.id || !dealNumber) return null;

  async function run() {
    const ok = window.confirm(
      'Recalculate this record from the linked Deal, Shipment, Logistics, Customs and Commission records?\n\n'
      + 'Revenue, costs and profit status will be replaced with the current figures. Insurance stays as entered.',
    );
    if (!ok) return;
    setBusy(true);
    setMessage('');
    try {
      invalidateTradingChain();
      const tables = await loadTradingTables(activeIndustryTypeId, true);
      const chain = buildChain(tables, {
        deal_number: dealNumber,
        order_number: str(record.order_number) || undefined,
        shipment_number: str(record.shipment_number) || undefined,
      });
      await api(`/trading/profitability/${record.id}`, { method: 'PATCH', body: JSON.stringify(buildRecalcPatch(record, chain)) });
      setMessage('Recalculated.');
      onDone();
    } catch (error) {
      const reason = error instanceof Error && error.message ? ` (${error.message})` : '';
      setMessage(`Could not recalculate${reason}. Please try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="quiet-button" disabled={busy} onClick={() => { void run(); }}>
        {busy ? 'Recalculating…' : 'Recalculate'}
      </button>
      {message && <span style={{ fontSize: '.78rem', opacity: 0.75 }}>{message}</span>}
    </>
  );
}