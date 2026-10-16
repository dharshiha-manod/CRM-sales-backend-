// FMCG Distributor Management: primary vs secondary sales, stock at distributor, targets, credit health, alerts.
// Data comes from GET /fmcg/distributors (+ /:clientId detail). Distributors = clients with outlet type "Distributor".
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';
import './FmcgDistributorPage.css';

type Health = 'good' | 'watch' | 'risk';
type Row = {
  clientId: string; code: string; name: string; status: string; city: string | null; state: string | null; tier: string; territory: string | null;
  creditLimit: number | null; creditDays: number | null; outstanding: number; orderCount: number; primaryValue: number; primaryThisMonth: number;
  monthlyTarget: number | null; targetAchievement: number | null; secondaryValue: number; secondaryUnits: number; stockUnits: number; stockValue: number;
  sellThrough: number | null; lastOrderDate: string | null; lastOrderDays: number | null; agreementEnd: string | null; alerts: string[]; health: Health;
};
type StockRow = { productId: string; name: string; code: string; unit: string; primary: number; returned: number; secondary: number; adjusted: number; onHand: number; avgDaily: number; coverDays: number | null; suggestedOrder: number; value: number };
type Entry = { id: string; product_id: string; productName: string; entry_type: string; quantity: number; amount: number; entry_date: string; outlet_name: string | null; reason: string | null };
type Detail = Row & {
  profile: Record<string, unknown> | null; stock: StockRow[]; entries: Entry[];
  trend: Array<{ month: string; primary: number; secondary: number }>;
  recentOrders: Array<{ id: string; orderNumber: string; status: string; dispatchStatus: string; amount: number; createdAt: string }>;
};

const money = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0);
const qty = (v: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v || 0);
const date = (v: string | null) => (v ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(v)) : '—');
const TIERS: Record<string, string> = { super_stockist: 'Super stockist', distributor: 'Distributor', sub_distributor: 'Sub-distributor' };
const HEALTH_LABEL: Record<Health, string> = { good: 'Healthy', watch: 'Watch', risk: 'At risk' };
const num = (v: string) => (v.trim() === '' ? null : Number(v));
const todayStr = () => new Date().toISOString().slice(0, 10);
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function FmcgDistributorPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<'all' | Health>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setRows((await api<{ data: Row[] }>('/fmcg/distributors')).data ?? []); setError(''); }
    catch (e) { setError(errText(e, 'Unable to load distributors.')); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (healthFilter === 'all' || r.health === healthFilter) && (!q || [r.name, r.code, r.city, r.territory].some((v) => (v ?? '').toLowerCase().includes(q))));
  }, [rows, search, healthFilter]);

  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);
  const target = sum((r) => r.monthlyTarget ?? 0);
  const monthPrimary = sum((r) => (r.monthlyTarget ? r.primaryThisMonth : 0));
  const atRisk = rows.filter((r) => r.health === 'risk').length;

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">FMCG · DISTRIBUTOR MANAGEMENT</p>
          <h2>Distributor management</h2>
          <p>Primary sales (what you supplied), secondary sales (what the distributor sold on), stock at the distributor, targets and credit health. Distributors are clients with outlet type "Distributor".</p>
        </div>
      </div>

      <div className="dist-kpis">
        <div className="kpi-card" data-tone="ink"><div><span>Distributors</span><strong>{rows.length}</strong><small>{rows.filter((r) => r.status === 'active').length} active</small></div></div>
        <div className="kpi-card" data-tone="blue"><div><span>Primary this month</span><strong>{money(sum((r) => r.primaryThisMonth))}</strong><small>{target ? `${Math.round((monthPrimary / target) * 100)}% of ${money(target)} target` : 'no targets set'}</small></div></div>
        <div className="kpi-card" data-tone="green"><div><span>Secondary sales</span><strong>{money(sum((r) => r.secondaryValue))}</strong><small>sold on by distributors</small></div></div>
        <div className="kpi-card" data-tone="ink"><div><span>Stock at distributors</span><strong>{money(sum((r) => r.stockValue))}</strong><small>{qty(sum((r) => r.stockUnits))} units</small></div></div>
        <div className="kpi-card" data-tone="amber"><div><span>Outstanding</span><strong>{money(sum((r) => r.outstanding))}</strong><small>of {money(sum((r) => r.creditLimit ?? 0))} credit</small></div></div>
        <div className="kpi-card" data-tone={atRisk ? 'red' : 'green'}><div><span>At risk</span><strong>{atRisk}</strong><small>need attention</small></div></div>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input type="search" placeholder="Search distributor, city or territory" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value as 'all' | Health)}>
            <option value="all">All health</option><option value="good">Healthy</option><option value="watch">Watch</option><option value="risk">At risk</option>
          </select>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="data-table-wrap">
        <table>
          <thead><tr><th>Distributor</th><th>Territory</th><th>Monthly target</th><th>Primary / Secondary</th><th>Stock</th><th>Sell-through</th><th>Outstanding</th><th>Health</th><th>Actions</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="empty-row">Loading…</td></tr>}
            {!loading && filtered.map((r) => {
              const ach = r.targetAchievement;
              const credPct = r.creditLimit ? Math.min(100, Math.round((r.outstanding / r.creditLimit) * 100)) : 0;
              return (
                <tr key={r.clientId}>
                  <td><strong>{r.name}</strong><small style={{ display: 'block' }}>{r.code} · {TIERS[r.tier] ?? r.tier}</small></td>
                  <td>{r.territory || r.city || '—'}</td>
                  <td>{ach == null ? <span className="text-faint-inline">Not set</span> : (<><div className="dist-bar"><i className={ach >= 90 ? 'ok' : ach >= 50 ? 'warn' : 'bad'} style={{ width: `${Math.min(100, ach)}%` }} /></div>{ach}% <small>of {money(r.monthlyTarget ?? 0)}</small></>)}</td>
                  <td>{money(r.primaryValue)}<small style={{ display: 'block' }}>sold on {money(r.secondaryValue)}</small></td>
                  <td>{money(r.stockValue)}<small style={{ display: 'block' }}>{qty(r.stockUnits)} units</small></td>
                  <td>{r.sellThrough == null ? '—' : `${r.sellThrough}%`}</td>
                  <td>{r.creditLimit ? <div className="dist-bar"><i className={credPct >= 100 ? 'bad' : credPct >= 75 ? 'warn' : 'ok'} style={{ width: `${credPct}%` }} /></div> : null}{money(r.outstanding)}</td>
                  <td><span className={`dist-health ${r.health}`}>{HEALTH_LABEL[r.health]}</span>{r.alerts.length > 0 && <div className="dist-alerts">{r.alerts.slice(0, 2).map((a) => <span key={a}>{a}</span>)}{r.alerts.length > 2 && <span>+{r.alerts.length - 2}</span>}</div>}</td>
                  <td className="master-actions"><button type="button" className="icon-action" title="Open distributor" aria-label={`Open ${r.name}`} onClick={() => setOpenId(r.clientId)}>👁</button></td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && <tr><td colSpan={9} className="empty-row">{rows.length === 0 ? 'No distributors yet. Set a client\'s outlet type to "Distributor" in the Clients directory.' : 'No distributors match your filters.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {openId && <DistributorDrawer clientId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </section>
  );
}

function DistributorDrawer({ clientId, onClose, onChanged }: { clientId: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<'stock' | 'sales' | 'profile' | 'orders'>('stock');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    try { setD((await api<{ data: Detail }>(`/fmcg/distributors/${clientId}`)).data); setError(''); }
    catch (e) { setError(errText(e, 'Unable to load distributor.')); }
  }
  useEffect(() => { void load(); }, [clientId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { if (!msg) return; const t = window.setTimeout(() => setMsg(''), 4000); return () => window.clearTimeout(t); }, [msg]);
  async function refresh() { await load(); onChanged(); }

  const tabs = [['stock', 'Stock & reorder'], ['sales', 'Secondary sales'], ['orders', 'Primary orders'], ['profile', 'Agreement & target']] as const;
  const ach = d?.targetAchievement ?? null;
  const credPct = d?.creditLimit ? Math.min(100, Math.round((d.outstanding / d.creditLimit) * 100)) : 0;

  return (
    <div className="dist-overlay" onMouseDown={onClose}>
      <div className="dist-modal" role="dialog" aria-modal="true" aria-label="Distributor details" onMouseDown={(e) => e.stopPropagation()}>
        <header className="dist-head">
          <div className="dist-title">
            <span className="dist-avatar">{(d?.name ?? '?').slice(0, 2).toUpperCase()}</span>
            <div>
              <h3>{d?.name ?? 'Loading…'}</h3>
              {d && <p>{d.code} · {TIERS[d.tier] ?? d.tier}{d.city ? ` · ${d.city}` : ''}{d.territory ? ` · ${d.territory}` : ''}</p>}
            </div>
          </div>
          <div className="dist-head-right">
            {d && <span className={`dist-health ${d.health}`}>{HEALTH_LABEL[d.health]}</span>}
            <button className="dist-close" type="button" aria-label="Close" onClick={onClose}>✕</button>
          </div>
        </header>

        <div className="dist-body">
          {error && <p className="error-message">{error}</p>}
          {msg && <p className="success-message">{msg}</p>}
          {!d && !error && <p className="dist-muted">Loading distributor…</p>}
          {d && (
            <>
              {d.alerts.length > 0 && <div className="dist-alertbar">{d.alerts.map((a) => <span key={a}>⚠ {a}</span>)}</div>}

              <div className="dist-stats">
                <Stat label="Primary sales" value={money(d.primaryValue)} sub={`${d.orderCount} order(s) · last ${d.lastOrderDate ? date(d.lastOrderDate) : 'never'}`} />
                <Stat label="Secondary sales" value={money(d.secondaryValue)} sub={`${qty(d.secondaryUnits)} units sold on`} />
                <Stat label="Stock at distributor" value={money(d.stockValue)} sub={`${qty(d.stockUnits)} units`} />
                <Stat label="Sell-through" value={d.sellThrough == null ? '—' : `${d.sellThrough}%`} sub="sold on ÷ received" />
                <Stat label="This month" value={money(d.primaryThisMonth)} sub={d.monthlyTarget ? `${ach ?? 0}% of ${money(d.monthlyTarget)} target` : 'No target set'} bar={d.monthlyTarget ? { pct: Math.min(100, ach ?? 0), tone: (ach ?? 0) >= 90 ? 'ok' : (ach ?? 0) >= 50 ? 'warn' : 'bad' } : undefined} />
                <Stat label="Outstanding" value={money(d.outstanding)} sub={d.creditLimit ? `${credPct}% of ${money(d.creditLimit)} limit` : 'No credit limit'} bar={d.creditLimit ? { pct: credPct, tone: credPct >= 100 ? 'bad' : credPct >= 75 ? 'warn' : 'ok' } : undefined} />
              </div>

              <section className="dist-card">
                <div className="dist-card-head"><h4>Last 6 months</h4><div className="dist-legend"><span><b className="p" />Primary</span><span><b className="s" />Secondary</span></div></div>
                <Trend data={d.trend} />
              </section>

              <nav className="dist-tabs" role="tablist">
                {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
              </nav>

              {tab === 'stock' && <StockTab d={d} />}
              {tab === 'sales' && <SalesTab d={d} onDone={async (m) => { setMsg(m); await refresh(); }} setError={setError} />}
              {tab === 'orders' && (
                <div className="dist-table"><table><thead><tr><th>Order no.</th><th>Status</th><th>Delivery</th><th>Amount</th><th>Date</th></tr></thead><tbody>
                  {d.recentOrders.map((o) => <tr key={o.id}><td>{o.orderNumber}</td><td><span className={`status-badge status-${o.status}`}>{o.status}</span></td><td>{o.dispatchStatus.replace(/_/g, ' ')}</td><td>{money(o.amount)}</td><td>{date(o.createdAt)}</td></tr>)}
                  {d.recentOrders.length === 0 && <tr><td colSpan={5} className="dist-empty">No orders yet. Create and confirm a sales order for this distributor.</td></tr>}
                </tbody></table></div>
              )}
              {tab === 'profile' && <ProfileTab d={d} onDone={async (m) => { setMsg(m); await refresh(); }} setError={setError} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, bar }: { label: string; value: string; sub?: string; bar?: { pct: number; tone: string } }) {
  return (
    <div className="dist-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {bar && <div className="dist-bar"><i className={bar.tone} style={{ width: `${bar.pct}%` }} /></div>}
      {sub && <small>{sub}</small>}
    </div>
  );
}

function Trend({ data }: { data: Detail['trend'] }) {
  const max = Math.max(0, ...data.flatMap((m) => [m.primary, m.secondary]));
  if (max <= 0) return <p className="dist-muted dist-trend-empty">No sales in the last 6 months yet. Bars appear once orders or secondary sales are recorded.</p>;
  return (
    <div className="dist-trend">
      {data.map((m) => (
        <div key={m.month} className="col" title={`${m.month}\nPrimary ${money(m.primary)}\nSecondary ${money(m.secondary)}`}>
          <div className="pair"><i className="p" style={{ height: `${Math.max(2, (m.primary / max) * 100)}%` }} /><i className="s" style={{ height: `${Math.max(2, (m.secondary / max) * 100)}%` }} /></div>
          <small>{new Date(`${m.month}-01`).toLocaleString(undefined, { month: 'short' })}</small>
        </div>
      ))}
    </div>
  );
}

function StockTab({ d }: { d: Detail }) {
  const needs = d.stock.filter((s) => s.suggestedOrder > 0);
  return (
    <>
      {needs.length > 0 && <p className="success-message">Suggested reorder: {needs.map((s) => `${s.name} ×${qty(s.suggestedOrder)}`).join(' · ')}</p>}
      <div className="dist-table"><table>
        <thead><tr><th>Product</th><th>Received</th><th>Returned</th><th>Sold on</th><th>Adjusted</th><th>On hand</th><th>Avg/day (30d)</th><th>Cover</th><th>Suggest order</th><th>Value</th></tr></thead>
        <tbody>
          {d.stock.map((s) => (
            <tr key={s.productId}>
              <td><strong>{s.name}</strong><small style={{ display: 'block' }}>{s.code}</small></td>
              <td>{qty(s.primary)}</td><td>{qty(s.returned)}</td><td>{qty(s.secondary)}</td><td>{qty(s.adjusted)}</td>
              <td className={s.onHand < 0 ? 'neg' : ''}>{qty(s.onHand)} {s.unit}</td>
              <td>{qty(s.avgDaily)}</td>
              <td>{s.coverDays == null ? '—' : <span className={s.coverDays < 7 ? 'neg' : ''}>{s.coverDays} d</span>}</td>
              <td>{s.suggestedOrder > 0 ? <strong>{qty(s.suggestedOrder)}</strong> : '—'}</td>
              <td>{money(s.value)}</td>
            </tr>
          ))}
          {d.stock.length === 0 && <tr><td colSpan={10} className="dist-empty">No stock movement yet. Stock appears once this distributor has a confirmed order.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

function SalesTab({ d, onDone, setError }: { d: Detail; onDone: (m: string) => Promise<void>; setError: (e: string) => void }) {
  const [f, setF] = useState({ productId: '', entryType: 'secondary_sale', quantity: '', amount: '', entryDate: todayStr(), outletName: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const picked = d.stock.find((s) => s.productId === f.productId);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/fmcg/distributors/${d.clientId}/entries`, { method: 'POST', body: JSON.stringify({ productId: f.productId, entryType: f.entryType, quantity: Number(f.quantity), amount: f.entryType === 'adjustment' ? null : num(f.amount), entryDate: f.entryDate, outletName: f.outletName || null, reason: f.reason || null }) });
      setF((p) => ({ ...p, quantity: '', amount: '', outletName: '', reason: '' }));
      await onDone(f.entryType === 'adjustment' ? 'Stock adjustment recorded successfully.' : 'Secondary sale recorded successfully.');
    } catch (err) { setError(errText(err, 'Unable to save entry.')); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this entry? Stock at the distributor will be restored.')) return;
    try { await api(`/fmcg/distributor-entries/${id}`, { method: 'DELETE' }); await onDone('Entry deleted successfully.'); } catch (err) { setError(errText(err, 'Unable to delete.')); }
  }
  return (
    <>
      <form className="dist-form dist-form-inline" onSubmit={submit}>
        <label>Type<select value={f.entryType} onChange={(e) => set('entryType', e.target.value)}><option value="secondary_sale">Secondary sale (sold to outlet)</option><option value="adjustment">Stock adjustment (expiry / loss)</option></select></label>
        <label>Product *<select required value={f.productId} onChange={(e) => set('productId', e.target.value)}><option value="">Select…</option>{d.stock.filter((s) => s.onHand > 0).map((s) => <option key={s.productId} value={s.productId}>{s.name} ({qty(s.onHand)} on hand)</option>)}</select></label>
        <label>Quantity *<input required type="number" min="0" step="any" max={picked?.onHand} value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></label>
        {f.entryType === 'secondary_sale' && <label>Sale value (₹)<input type="number" min="0" step="any" placeholder="auto from price" value={f.amount} onChange={(e) => set('amount', e.target.value)} /></label>}
        <label>Date<input type="date" max={todayStr()} value={f.entryDate} onChange={(e) => set('entryDate', e.target.value)} /></label>
        {f.entryType === 'secondary_sale' ? <label>Outlet<input value={f.outletName} onChange={(e) => set('outletName', e.target.value)} /></label> : <label>Reason<input value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Expired, damaged…" /></label>}
        <button className="primary-action" disabled={busy || !f.productId || !f.quantity}>{busy ? 'Saving…' : 'Record'}</button>
      </form>
      <div className="dist-table" style={{ marginTop: '1rem' }}><table>
        <thead><tr><th>Date</th><th>Type</th><th>Product</th><th>Qty</th><th>Value</th><th>Outlet / reason</th><th /></tr></thead>
        <tbody>
          {d.entries.map((e) => <tr key={e.id}><td>{date(e.entry_date)}</td><td>{e.entry_type === 'adjustment' ? 'Adjustment' : 'Secondary sale'}</td><td>{e.productName}</td><td>{qty(e.quantity)}</td><td>{e.entry_type === 'adjustment' ? '—' : money(e.amount)}</td><td>{e.outlet_name || e.reason || '—'}</td><td className="master-actions"><button type="button" className="icon-action" title="Delete" onClick={() => void remove(e.id)}>🗑</button></td></tr>)}
          {d.entries.length === 0 && <tr><td colSpan={7} className="dist-empty">No secondary sales recorded yet.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

function ProfileTab({ d, onDone, setError }: { d: Detail; onDone: (m: string) => Promise<void>; setError: (e: string) => void }) {
  const p = (d.profile ?? {}) as Record<string, string | number | null>;
  const [f, setF] = useState({
    tier: String(p.tier ?? 'distributor'), territory: String(p.territory ?? ''), monthlyTarget: p.monthly_target == null ? '' : String(p.monthly_target),
    marginPercent: p.margin_percent == null ? '' : String(p.margin_percent), securityDeposit: p.security_deposit == null ? '' : String(p.security_deposit),
    agreementStart: String(p.agreement_start ?? ''), agreementEnd: String(p.agreement_end ?? ''), coverDays: String(p.cover_days ?? 30), notes: String(p.notes ?? ''),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/fmcg/distributors/${d.clientId}/profile`, { method: 'PUT', body: JSON.stringify({ tier: f.tier, territory: f.territory || null, monthlyTarget: num(f.monthlyTarget), marginPercent: num(f.marginPercent), securityDeposit: num(f.securityDeposit), agreementStart: f.agreementStart || null, agreementEnd: f.agreementEnd || null, coverDays: Number(f.coverDays) || 30, notes: f.notes || null }) });
      await onDone('Distributor profile saved successfully.');
    } catch (err) { setError(errText(err, 'Unable to save profile.')); } finally { setBusy(false); }
  }
  return (
    <form className="dist-form" onSubmit={submit}>
      <label>Tier<select value={f.tier} onChange={(e) => set('tier', e.target.value)}>{Object.entries(TIERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Territory<input value={f.territory} onChange={(e) => set('territory', e.target.value)} placeholder="e.g. Nagercoil + Kanyakumari" /></label>
      <label>Monthly primary target (₹)<input type="number" min="0" step="any" value={f.monthlyTarget} onChange={(e) => set('monthlyTarget', e.target.value)} /></label>
      <label>Margin %<input type="number" min="0" max="100" step="any" value={f.marginPercent} onChange={(e) => set('marginPercent', e.target.value)} /></label>
      <label>Security deposit (₹)<input type="number" min="0" step="any" value={f.securityDeposit} onChange={(e) => set('securityDeposit', e.target.value)} /></label>
      <label>Stock cover target (days)<input type="number" min="1" max="365" value={f.coverDays} onChange={(e) => set('coverDays', e.target.value)} /></label>
      <label>Agreement start<input type="date" value={f.agreementStart} onChange={(e) => set('agreementStart', e.target.value)} /></label>
      <label>Agreement end<input type="date" min={f.agreementStart || undefined} value={f.agreementEnd} onChange={(e) => set('agreementEnd', e.target.value)} /></label>
      <label className="full">Notes<textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      <div className="full"><button className="primary-action" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></div>
    </form>
  );
}