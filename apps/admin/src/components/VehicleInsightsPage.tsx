import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import './MasterDataPages.css';

type Check = { key: string; label: string; count: number; samples: string[]; fixable: boolean };
type Health = { checkedAt: string; ok: boolean; checks: Check[] };
type Repair = { fixed: Record<string, number>; health: Health };
type Overview = Record<string, unknown>;

const pretty = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function flatten(o: unknown, prefix = '', out: [string, string][] = []): [string, string][] {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) flatten(v, prefix ? `${prefix} / ${pretty(k)}` : pretty(k), out);
  } else if (typeof o === 'number' || typeof o === 'string') out.push([prefix, String(o)]);
  return out;
}

export function VehicleInsightsPage() {
  const { activeIndustryTypeId } = useIndustryScope();
  const q = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
  const [health, setHealth] = useState<Health | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true); setError(null);
    try {
      const [h, o] = await Promise.all([
        api<{ data: Health }>(`/vehicle/insights/health${q}`),
        api<{ data: Overview }>(`/vehicle/insights/overview${q}`).catch(() => ({ data: null })),
      ]);
      setHealth(h.data); setOverview(o.data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load insights'); }
    setBusy(false);
  }
  async function repair() {
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await api<{ data: Repair }>(`/vehicle/insights/repair${q}`, { method: 'POST' });
      const n = Object.values(r.data.fixed).reduce((a, b) => a + b, 0);
      setMsg(n ? `Repaired ${n} item(s): ${Object.entries(r.data.fixed).map(([k, v]) => `${pretty(k)} ${v}`).join(', ')}` : 'Nothing needed repair.');
      setHealth(r.data.health);
    } catch (e) { setError(e instanceof Error ? e.message : 'Repair failed'); }
    setBusy(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeIndustryTypeId]);

  return (
    <div style={{ padding: 24, display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Vehicle Insights &amp; Link Health</h2>
          <p style={{ margin: '4px 0 0', opacity: 0.7 }}>Checks the Lead → Test drive → Booking → Delivery → After-sales chain and repairs missed links.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={busy} onClick={() => void load()}>Re-check</button>
          <button type="button" disabled={busy || !health || health.ok} onClick={() => void repair()}>Repair broken links</button>
        </div>
      </div>
      {error && <div role="alert" style={{ color: '#b00020' }}>{error}</div>}
      {msg && <div role="status">{msg}</div>}
      {health && (
        <section>
          <h3>{health.ok ? 'All links healthy' : 'Issues found'} <small style={{ opacity: 0.6 }}>checked {new Date(health.checkedAt).toLocaleString()}</small></h3>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
            {health.checks.map((c) => (
              <li key={c.key} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10 }}>
                <strong>{c.count === 0 ? '✔' : '⚠'} {c.label}</strong>: {c.count}{!c.fixable && c.count > 0 ? ' (fix manually)' : ''}
                {c.count > 0 && <div style={{ fontSize: 12, opacity: 0.7 }}>{c.samples.join(", ")}{c.count > c.samples.length ? ` … +${c.count - c.samples.length}` : ""}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {overview && (
        <section>
          <h3>Overview (last 90 days)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
            {flatten(overview).slice(0, 60).map(([k, v]) => (
              <div key={k} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10 }}><div style={{ fontSize: 12, opacity: 0.7 }}>{k}</div><strong>{v}</strong></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
