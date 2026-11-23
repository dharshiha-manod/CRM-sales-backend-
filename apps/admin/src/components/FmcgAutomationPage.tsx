// FMCG Automation Center: what the system now does by itself (switches off ended schemes, drafts purchase orders for low stock)
// and the things a person still needs to look at (stale schemes, late purchase orders, expiring batches).
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

type Today = {
  date: string;
  schemes: { expired: number; ending_soon: number; stale: number; upcoming: number; ok: number; inactive: number };
  expiry: { expired: number; expiring: number; warningDays: number };
  lowStock: { count: number };
  reorder: { toOrder: number; noVendor: number; draftPos: number };
  latePos: number;
};
type SchemeItem = { id: string; name: string; scheme_type: string; status: string; start_date: string | null; end_date: string | null; health: string; reason: string };
type PlanItem = { product_id: string; product_name: string; stock: number; min_stock_level: number; on_order: number; quantity: number; vendor_name: string | null };
type Plan = { items: PlanItem[]; unassigned: PlanItem[] };
type LatePo = { id: string; po_number: string; vendor_name: string | null; status: string; expected_date: string | null; total_amount: number; days_late: number };
type RunResult = { schemesExpired: { id: string; name: string }[]; draftsCreated: { id: string; po_number: string }[]; productsWithoutVendor: number };

const go = (module: string) => { window.location.hash = `#industry:fmcg:${module}`; };
const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const money = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v || 0);
const dt = (v: string | null) => (v ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(v)) : '—');
const TONE: Record<string, string> = { expired: '#b91c1c', ending_soon: '#d97706', stale: '#9333ea', upcoming: '#2563eb', ok: '#15803d', inactive: '#64748b' };
const LABEL: Record<string, string> = { expired: 'Ended', ending_soon: 'Ending soon', stale: 'Stale', upcoming: 'Upcoming', ok: 'Running', inactive: 'Off' };
const Chip = ({ s }: { s: string }) => <span style={{ background: `${TONE[s] ?? '#64748b'}1a`, color: TONE[s] ?? '#64748b', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{LABEL[s] ?? s}</span>;

const card: CSSProperties = { background: 'var(--surface, #fff)', border: '1px solid rgba(100,116,139,.25)', borderRadius: 12, padding: 16, display: 'grid', gap: 10 };
const kpiGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 };
function Kpi({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: string; tone?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ ...card, textAlign: 'left', cursor: onClick ? 'pointer' : 'default', borderLeft: `4px solid ${tone ?? '#64748b'}`, font: 'inherit', color: 'inherit' }}>
      <span style={{ fontSize: 13, opacity: 0.75 }}>{label}</span><strong style={{ fontSize: 26 }}>{value}</strong>{sub && <small style={{ opacity: 0.7 }}>{sub}</small>}
    </button>
  );
}
const th: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(100,116,139,.25)' };
const td: CSSProperties = { padding: '6px 8px', fontSize: 14, borderBottom: '1px solid rgba(100,116,139,.12)' };

export function FmcgAutomationPage() {
  const [today, setToday] = useState<Today | null>(null);
  const [schemes, setSchemes] = useState<SchemeItem[]>([]);
  const [plan, setPlan] = useState<Plan>({ items: [], unassigned: [] });
  const [late, setLate] = useState<LatePo[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s, p, l] = await Promise.all([
        api<{ data: Today }>('/fmcg/automation/today'),
        api<{ data: { items: SchemeItem[] } }>('/fmcg/automation/schemes'),
        api<{ data: Plan }>('/fmcg/automation/reorder-plan'),
        api<{ data: LatePo[] }>('/fmcg/automation/late-pos'),
      ]);
      setToday(t.data); setSchemes(s.data.items ?? []); setPlan(p.data ?? { items: [], unassigned: [] }); setLate(l.data ?? []); setError('');
    } catch (e) { setError(errText(e, 'Unable to load the Automation Center.')); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(key: string, path: string, say: (d: never) => string) {
    setBusy(key); setError(''); setMsg('');
    try { const r = await api<{ data: never }>(path, { method: 'POST', body: JSON.stringify({}) }); setMsg(say(r.data)); await load(); }
    catch (e) { setError(errText(e, 'That action failed.')); } finally { setBusy(''); }
  }

  const flagged = schemes.filter((s) => ['expired', 'ending_soon', 'stale'].includes(s.health));
  return (
    <section className="page-panel master-page">
      <div className="master-heading">
        <div><p className="eyebrow">FMCG</p><h2>Automation Center</h2><p style={{ opacity: 0.75, margin: 0 }}>What the system does by itself, and what still needs a person. It runs every hour in the background; use Run now to do it immediately.</p></div>
        <button type="button" className="primary-action" disabled={busy !== ''} onClick={() => void act('all', '/fmcg/automation/run', (d: RunResult) => `Switched off ${d.schemesExpired.length} ended scheme(s) and created ${d.draftsCreated.length} draft purchase order(s).`)}>{busy === 'all' ? 'Running…' : 'Run now'}</button>
      </div>
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
      {msg && <p role="status" style={{ color: '#15803d' }}>{msg}</p>}
      {loading && !today ? <p>Loading…</p> : today && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={kpiGrid}>
            <Kpi label="Schemes ended (still on)" value={today.schemes.expired} sub="Run now switches them off" tone={TONE.expired} onClick={() => go('scheme-discount')} />
            <Kpi label="Schemes ending in 7 days" value={today.schemes.ending_soon} tone={TONE.ending_soon} onClick={() => go('scheme-discount')} />
            <Kpi label="Stale schemes" value={today.schemes.stale} sub="No end date, running too long" tone={TONE.stale} onClick={() => go('scheme-discount')} />
            <Kpi label="Low-stock products" value={today.lowStock.count} sub={`${today.reorder.toOrder} ready to order`} tone="#d97706" onClick={() => go('purchase-orders')} />
            <Kpi label="Draft purchase orders" value={today.reorder.draftPos} sub="Review and mark Ordered" tone="#2563eb" onClick={() => go('purchase-orders')} />
            <Kpi label="Late purchase orders" value={today.latePos} tone={TONE.expired} onClick={() => go('purchase-orders')} />
            <Kpi label="Batches expired" value={today.expiry.expired} tone={TONE.expired} onClick={() => go('batch-expiry')} />
            <Kpi label={`Expiring in ${today.expiry.warningDays} days`} value={today.expiry.expiring} tone={TONE.ending_soon} onClick={() => go('batch-expiry')} />
          </div>

          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Schemes that need attention</h3>
              <button type="button" disabled={busy !== '' || today.schemes.expired === 0} onClick={() => void act('exp', '/fmcg/automation/schemes/expire', (d: unknown[]) => `Switched off ${d.length} ended scheme(s).`)}>{busy === 'exp' ? 'Working…' : `Switch off ended schemes (${today.schemes.expired})`}</button>
            </div>
            {flagged.length === 0 ? <p style={{ opacity: 0.7, margin: 0 }}>All schemes are healthy.</p> : (
              <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Scheme</th><th style={th}>Status</th><th style={th}>Ends</th><th style={th}>Why</th></tr></thead>
                <tbody>{flagged.map((s) => <tr key={s.id}><td style={td}>{s.name}</td><td style={td}><Chip s={s.health} /></td><td style={td}>{dt(s.end_date)}</td><td style={td}>{s.reason}</td></tr>)}</tbody>
              </table></div>
            )}
            <small style={{ opacity: 0.7 }}>Ended schemes are switched off automatically. Stale schemes are only flagged: open Scheme / Discount Management to set an end date or switch them off.</small>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Low stock → draft purchase orders</h3>
              <button type="button" disabled={busy !== '' || plan.items.length === 0} onClick={() => void act('re', '/fmcg/automation/reorder/run', (d: { created: unknown[] }) => `Created ${d.created.length} draft purchase order(s). Nothing was sent to any vendor.`)}>{busy === 're' ? 'Working…' : `Create draft POs (${plan.items.length})`}</button>
            </div>
            {plan.items.length === 0 && plan.unassigned.length === 0 ? <p style={{ opacity: 0.7, margin: 0 }}>Nothing to reorder right now.</p> : (
              <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Product</th><th style={th}>Stock</th><th style={th}>Minimum</th><th style={th}>On order</th><th style={th}>Order qty</th><th style={th}>Vendor</th></tr></thead>
                <tbody>{[...plan.items, ...plan.unassigned].map((p) => <tr key={p.product_id}><td style={td}>{p.product_name}</td><td style={td}>{p.stock}</td><td style={td}>{p.min_stock_level}</td><td style={td}>{p.on_order}</td><td style={td}>{p.quantity}</td><td style={td}>{p.vendor_name ?? <span style={{ color: '#b91c1c' }}>No vendor yet</span>}</td></tr>)}</tbody>
              </table></div>
            )}
            {plan.unassigned.length > 0 && <small style={{ color: '#b91c1c' }}>{plan.unassigned.length} product(s) have no vendor because they were never ordered before. Create one purchase order for them manually and they will be included next time.</small>}
          </div>

          <div style={card}>
            <h3 style={{ margin: 0 }}>Late purchase orders</h3>
            {late.length === 0 ? <p style={{ opacity: 0.7, margin: 0 }}>No purchase order is past its expected date.</p> : (
              <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>PO</th><th style={th}>Vendor</th><th style={th}>Status</th><th style={th}>Expected</th><th style={th}>Days late</th><th style={th}>Value</th></tr></thead>
                <tbody>{late.map((p) => <tr key={p.id}><td style={td}>{p.po_number}</td><td style={td}>{p.vendor_name ?? '—'}</td><td style={td}>{p.status}</td><td style={td}>{dt(p.expected_date)}</td><td style={{ ...td, color: '#b91c1c', fontWeight: 600 }}>{p.days_late}</td><td style={td}>{money(p.total_amount)}</td></tr>)}</tbody>
              </table></div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}