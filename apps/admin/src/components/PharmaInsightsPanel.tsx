import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Summary = {
  batches: { total: number; expired: number; critical: number; expiringSoon: number; unitsAtRisk: number; list: { batch_number: string; product_name: string; quantity: number; expiry_date: string; days_left: number | null }[] };
  recalls: { open: number; critical: number; list: { recall_code: string; product_name: string; batch_number: string; status: string }[] };
  samples: { unitsIssued: number; unitsRemaining: number; distributed: number };
  promotions: { active: number; total: number };
  returns: { awaitingInspection: number; total: number };
  engagements: { followUpsDue: number; total: number };
};

/** Dashboard block for the Pharma industry: expiry risk, open recalls, samples, campaigns, returns and follow-ups due. Real data from GET /pharma/summary. */
export function PharmaInsightsPanel({ industryTypeId }: { industryTypeId: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => api<{ data: Summary }>(`/pharma/summary?industryTypeId=${encodeURIComponent(industryTypeId)}`)
      .then((r) => { if (live) { setData(r.data); setError(''); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load Pharma insights.'); });
    void load();
    const t = window.setInterval(load, 120_000);
    return () => { live = false; window.clearInterval(t); };
  }, [industryTypeId]);

  if (error) return <section className="ops-panel"><h3>Pharma insights</h3><p>{error}</p></section>;
  if (!data) return <section className="ops-panel"><h3>Pharma insights</h3><p>Loading…</p></section>;
  const cards: [string, string | number, string][] = [
    ['Expired batches', data.batches.expired, 'in stock'],
    ['Critical expiry (≤30 days)', data.batches.critical, `${data.batches.unitsAtRisk} units at risk`],
    ['Expiring soon (≤90 days)', data.batches.expiringSoon, 'batches'],
    ['Open recalls', data.recalls.open, `${data.recalls.critical} critical / high`],
    ['Sample units issued', data.samples.unitsIssued, `${data.samples.unitsRemaining} remaining`],
    ['Active campaigns', data.promotions.active, `of ${data.promotions.total}`],
    ['Returns to inspect', data.returns.awaitingInspection, `of ${data.returns.total}`],
    ['Follow-ups due', data.engagements.followUpsDue, 'hospital visits'],
  ];
  return (
    <section className="ops-panel">
      <h3>Pharma insights</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
        {cards.map(([label, value, hint]) => (
          <div key={label} className="ops-metric tone-0"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>
        ))}
      </div>
      {data.batches.list.length > 0 && (
        <div style={{ marginTop: 16, overflowX: 'auto' }}>
          <h4>Batches needing attention</h4>
          <table className="master-table">
            <thead><tr><th>Product</th><th>Batch</th><th>Units</th><th>Expiry</th><th>Days left</th></tr></thead>
            <tbody>
              {data.batches.list.map((b) => (
                <tr key={b.batch_number}><td>{b.product_name}</td><td>{b.batch_number}</td><td>{b.quantity}</td><td>{String(b.expiry_date).slice(0, 10)}</td>
                  <td style={{ color: (b.days_left ?? 0) < 0 ? '#c0392b' : (b.days_left ?? 0) <= 30 ? '#d68910' : undefined }}>{b.days_left}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.recalls.list.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4>Open recalls</h4>
          <ul>{data.recalls.list.map((r) => <li key={r.recall_code}>{r.recall_code} — {r.product_name} · batch {r.batch_number} ({r.status})</li>)}</ul>
        </div>
      )}
    </section>
  );
}