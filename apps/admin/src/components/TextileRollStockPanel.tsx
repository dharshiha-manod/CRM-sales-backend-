import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';

type Group = { label: string; rolls: number; meters: number };
type Summary = { total_rolls: number; total_meters: number; by_status: Group[]; by_grade: Group[]; by_fabric_type: Group[] };

const fmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n);

function GroupTable({ title, rows }: { title: string; rows: Group[] }) {
  return (
    <div style={{ minWidth: 220, flex: '1 1 220px' }}>
      <strong>{title}</strong>
      <table style={{ width: '100%', marginTop: 6, borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ textAlign: 'left' }}>&nbsp;</th><th style={{ textAlign: 'right' }}>Rolls</th><th style={{ textAlign: 'right' }}>Metres</th></tr></thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.label}><td>{g.label}</td><td style={{ textAlign: 'right' }}>{g.rolls}</td><td style={{ textAlign: 'right' }}>{fmt(g.meters)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Textile-only fabric roll stock summary, shown on Reports and Inventory when the Textile industry is active. */
export function TextileRollStockPanel() {
  const { activeIndustryTypeId } = useIndustryScope();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeIndustryTypeId) return;
    let cancelled = false;
    api<{ data: Summary }>(`/textile/fabric-rolls-summary?industryTypeId=${activeIndustryTypeId}`)
      .then((res) => { if (!cancelled) { setData(res.data); setError(''); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load roll stock.'); });
    return () => { cancelled = true; };
  }, [activeIndustryTypeId]);

  return (
    <section className="ops-panel">
      <header>
        <div><p className="eyebrow">Fabric rolls</p><h2>Roll stock summary</h2></div>
        {data && <span>{data.total_rolls} rolls · {fmt(data.total_meters)} m</span>}
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      {data && data.total_rolls === 0 && <div className="ops-empty"><strong>No fabric rolls yet</strong><p>Add rolls in Fabric Roll Management to see stock here.</p></div>}
      {data && data.total_rolls > 0 && (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <GroupTable title="By status" rows={data.by_status} />
          <GroupTable title="By grade" rows={data.by_grade} />
          <GroupTable title="By fabric type" rows={data.by_fabric_type} />
        </div>
      )}
    </section>
  );
}