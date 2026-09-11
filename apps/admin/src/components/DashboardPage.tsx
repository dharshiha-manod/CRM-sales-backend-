import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import './DashboardPage.css';
type RecentVisit = { id: string; status: string; check_in_time: string; outcome?: string | null; clients?: { client_code?: string; client_name?: string } | null; sales_representatives?: { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null };
type Data = { totalClients: number; totalRepresentatives: number; activeRepresentatives: number; visitsToday: number; completedVisitsToday: number; activeVisits: number; ordersToday: number; salesToday: number; collectionsToday: number; recentVisits: RecentVisit[] };
type LiveVisit = { id: string; check_in_time: string; check_in_lat: number; check_in_lng: number; clients?: { client_code?: string; client_name?: string } | null; sales_representatives?: { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null; latest_ping?: { latitude: number; longitude: number } | null };
type Lead = { id: string; company_name?: string; contact_name?: string | null; source?: string; status: 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted' | 'lost'; created_at?: string; industry_types?: { id: string } | null };
type ClientRecord = { id: string; status: 'active' | 'inactive'; industry_type_id?: string | null };
type FollowUpRecord = { id: string; due_at: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; title?: string; clients?: { client_code?: string; client_name?: string } | null };
type OrderRecord = { id: string; order_number: string; total_amount: number; created_at: string; clients?: { client_code?: string } | null; sales_representatives?: { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null };
type CollectionRecord = { amount: number; clients?: { client_code?: string } | null; sale_orders?: { order_number?: string } | null };
type Call = { id: string; direction: string; phone_number: string; status: string; started_at?: string | null; clients?: { client_code?: string; client_name?: string | null } | null };
type TradingDeal = { id: string; deal_number: string; deal_name?: string; status: string; quantity?: number | string | null; purchase_rate?: number | string | null; selling_rate?: number | string | null; industry_type_id?: string | null };
type Extra = { leads: Lead[]; clients: ClientRecord[]; followUps: FollowUpRecord[]; orders: OrderRecord[]; collections: CollectionRecord[]; calls: Call[]; tradingDeals: TradingDeal[] };
const empty: Data = { totalClients: 0, totalRepresentatives: 0, activeRepresentatives: 0, visitsToday: 0, completedVisitsToday: 0, activeVisits: 0, ordersToday: 0, salesToday: 0, collectionsToday: 0, recentVisits: [] };
const emptyExtra: Extra = { leads: [], clients: [], followUps: [], orders: [], collections: [], calls: [], tradingDeals: [] };
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const timeLabel = (value?: string | null) => (value ? new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(value)) : '—');
const dateLabel = (value?: string | null) => (value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(value)) : '—');
function isToday(value?: string | null) { if (!value) return false; const d = new Date(value); const now = new Date(); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate(); }
const sourceLabels: Record<string, string> = { referral: 'Referral', cold_call: 'Cold call', walk_in: 'Walk-in', website: 'Website', exhibition: 'Exhibition', social_media: 'Social media', ivr: 'IVR / phone line', other: 'Other' };
const sourceColors: Record<string, string> = { referral: 'var(--accent-teal)', cold_call: 'var(--amber)', walk_in: 'var(--accent-violet)', website: 'var(--accent-blue)', exhibition: 'var(--ind-textile)', social_media: 'var(--accent-coral)', ivr: 'var(--green)', other: 'var(--text-faint)' };

type RangeKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'year', label: 'This Year' },
  { key: 'custom', label: 'Custom Date' },
];
function rangeBounds(key: RangeKey, customFrom: string, customTo: string): [Date, Date] {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(startOfDay(now).getTime()); end.setDate(end.getDate() + 1);
  if (key === 'today') return [startOfDay(now), end];
  if (key === 'week') { const s = startOfDay(now); s.setDate(s.getDate() - s.getDay()); return [s, end]; }
  if (key === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), end];
  if (key === 'quarter') { const q = Math.floor(now.getMonth() / 3); return [new Date(now.getFullYear(), q * 3, 1), end]; }
  if (key === 'year') return [new Date(now.getFullYear(), 0, 1), end];
  const from = customFrom ? new Date(customFrom) : startOfDay(now);
  const to = customTo ? new Date(new Date(customTo).getTime() + 86400000) : end;
  return [from, to];
}

export function DashboardPage() {
  const { matchesActiveIndustry, clientMatchesActiveIndustry, activeIndustry } = useIndustryScope();
  const [data, setData] = useState<Data>(empty); const [live, setLive] = useState<LiveVisit[]>([]); const [extra, setExtra] = useState<Extra>(emptyExtra); const [error, setError] = useState('');  
  const [range, setRange] = useState<RangeKey>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  useEffect(() => {
    const load = () => void Promise.all([
      api<{ data: Data }>('/dashboard'),
      api<{ data: LiveVisit[] }>('/field-visits/live'),
      api<{ data: Lead[] }>('/leads').catch(() => ({ data: [] })),
      api<{ data: ClientRecord[] }>('/clients').catch(() => ({ data: [] })),
      api<{ data: FollowUpRecord[] }>('/follow-ups').catch(() => ({ data: [] })),
      api<{ data: OrderRecord[] }>('/orders').catch(() => ({ data: [] })),
      api<{ data: CollectionRecord[] }>('/collections').catch(() => ({ data: [] })),
      api<{ data: Call[] }>('/telephony/calls').catch(() => ({ data: [] })),
      api<{ data: TradingDeal[] }>('/trading/deals').catch(() => ({ data: [] })),
    ]).then(([dashboard, activity, leads, clients, followUps, orders, collections, calls, tradingDeals]) => {
      setData({ ...empty, ...dashboard.data });
      setLive(activity.data);
      setExtra({ leads: leads.data ?? [], clients: clients.data ?? [], followUps: followUps.data ?? [], orders: orders.data ?? [], collections: collections.data ?? [], calls: calls.data ?? [], tradingDeals: tradingDeals.data ?? [] });
      setError('');
    }).catch((reason) => setError((reason as Error).message));
    load();
    const timer = window.setInterval(load, 20000);
    return () => window.clearInterval(timer);
  }, []);

  const [rangeStart, rangeEnd] = useMemo(() => rangeBounds(range, customFrom, customTo), [range, customFrom, customTo]);

  // Trading pipeline snapshot for the dashboard's Trading section — reuses
  // the same margin math as TradingDealPage.tsx so the numbers always agree.
  const tradingDealsInScope = useMemo(() => extra.tradingDeals.filter((d) => matchesActiveIndustry(d.industry_type_id)), [extra.tradingDeals, matchesActiveIndustry]);
  const tradingStats = useMemo(() => {
    const openStatuses = ['Completed', 'Cancelled', 'Lost'];
    const sellingValue = (d: TradingDeal) => (Number(d.selling_rate) || 0) * (Number(d.quantity) || 0);
    const purchaseValue = (d: TradingDeal) => (Number(d.purchase_rate) || 0) * (Number(d.quantity) || 0);
    const open = tradingDealsInScope.filter((d) => !openStatuses.includes(d.status));
    const dealValue = tradingDealsInScope.reduce((sum, d) => sum + sellingValue(d), 0);
    const expectedMargin = tradingDealsInScope.reduce((sum, d) => sum + (sellingValue(d) - purchaseValue(d)), 0);
    return { total: tradingDealsInScope.length, open: open.length, dealValue, expectedMargin };
  }, [tradingDealsInScope]);
  const inRange = (value?: string | null) => { if (!value) return false; const d = new Date(value); return d >= rangeStart && d < rangeEnd; };

  const rangeLeads = useMemo(() => extra.leads.filter((l) => inRange(l.created_at)), [extra.leads, rangeStart, rangeEnd]);

  const leadStats = (() => {
    const total = extra.leads.length;
    const converted = extra.leads.filter((l) => l.status === 'converted').length;
    const lost = extra.leads.filter((l) => l.status === 'lost').length;
    const open = total - converted - lost;
    const conversionRate = total ? Math.round((converted / total) * 100) : 0;
    return { total, open, converted, conversionRate };
  })();

  const activeClients = extra.clients.filter((c) => c.status === 'active').length;

  const followUpStats = (() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endToday = new Date(startToday);
    endToday.setDate(endToday.getDate() + 1);
    let overdue = 0, dueToday = 0, upcoming = 0;
    extra.followUps.forEach((f) => {
      if (f.status === 'completed' || f.status === 'cancelled') return;
      const due = new Date(f.due_at);
      if (due < startToday) overdue += 1;
      else if (due < endToday) dueToday += 1;
      else upcoming += 1;
    });
    return { overdue, dueToday, upcoming, pending: overdue + dueToday + upcoming };
  })();

  const pendingPayments = (() => {
    const collectedByOrder: Record<string, number> = {};
    extra.collections.forEach((c) => {
      const key = c.sale_orders?.order_number;
      if (!key) return;
      collectedByOrder[key] = (collectedByOrder[key] ?? 0) + Number(c.amount || 0);
    });
    return extra.orders.reduce((sum, o) => {
      const paid = collectedByOrder[o.order_number] ?? 0;
      return sum + Math.max(Number(o.total_amount) - paid, 0);
    }, 0);
  })();

  const kpis: { label: string; value: string | number; note: string; icon: string }[] = [
    { label: 'Visits today', value: data.visitsToday, note: `${data.completedVisitsToday} completed`, icon: '📍' },
    { label: 'Active field visits', value: live.length, note: live.length ? 'GPS reporting active' : 'No one checked in', icon: '🛰️' },
    { label: 'Orders today', value: data.ordersToday, note: money(data.salesToday), icon: '🧾' },
    { label: 'Collections today', value: money(data.collectionsToday), note: 'Recorded receipts', icon: '💰' },
    { label: 'Leads', value: leadStats.total, note: `${leadStats.open} open · ${leadStats.conversionRate}% converted`, icon: '🎯' },
    { label: 'Active clients', value: activeClients, note: `of ${extra.clients.length} total clients`, icon: '🏢' },
    { label: 'Follow-ups due', value: followUpStats.pending, note: `${followUpStats.overdue} overdue · ${followUpStats.dueToday} today`, icon: '⏰' },
    { label: 'Pending payments', value: money(pendingPayments), note: 'Outstanding across all orders', icon: '⚠️' },
  ];

  const repPerformance = (() => {
    const byRep: Record<string, { name: string; orders: number; revenue: number }> = {};
    extra.orders.forEach((o) => {
      const key = o.sales_representatives?.employee_code ?? 'unassigned';
      const name = o.sales_representatives?.user_profiles?.display_name ?? o.sales_representatives?.employee_code ?? 'Unassigned';
      if (!byRep[key]) byRep[key] = { name, orders: 0, revenue: 0 };
      byRep[key].orders += 1;
      byRep[key].revenue += Number(o.total_amount || 0);
    });
    return Object.values(byRep).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  })();

  const callsToday = extra.calls.filter((c) => isToday(c.started_at));
  const callStats = { total: callsToday.length, inbound: callsToday.filter((c) => c.direction === 'inbound').length, outbound: callsToday.filter((c) => c.direction === 'outbound').length, missed: callsToday.filter((c) => c.status === 'missed' || c.status === 'no_answer').length };

  const leadBreakdown = (() => {
    const statuses: { key: Lead['status']; label: string; color: string }[] = [
      { key: 'new', label: 'New', color: 'var(--amber)' },
      { key: 'contacted', label: 'Contacted', color: 'var(--ind-school)' },
      { key: 'qualified', label: 'Qualified', color: 'var(--ind-textile)' },
      { key: 'converted', label: 'Converted', color: 'var(--green)' },
      { key: 'unqualified', label: 'Unqualified', color: 'var(--text-faint)' },
      { key: 'lost', label: 'Lost', color: 'var(--red)' },
    ];
    const counts = statuses.map((s) => ({ ...s, value: extra.leads.filter((l) => l.status === s.key).length }));
    return { counts, max: Math.max(1, ...counts.map((c) => c.value)) };
  })();

  const leadSourceBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    rangeLeads.forEach((l) => { const key = l.source ?? 'other'; counts[key] = (counts[key] ?? 0) + 1; });
    const total = rangeLeads.length;
    return { entries: Object.entries(counts).sort((a, b) => b[1] - a[1]), total };
  }, [rangeLeads]);

  const revenueTrend = (() => {
    const days: { label: string; value: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const value = extra.orders.filter((o) => { const c = new Date(o.created_at); return c >= dayStart && c < dayEnd; }).reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
      days.push({ label: dayStart.toLocaleDateString(undefined, { weekday: 'short' }), value });
    }
    return { days, max: Math.max(1, ...days.map((d) => d.value)) };
  })();

  const followUpDonut = (() => {
    const total = followUpStats.pending;
    if (!total) return null;
    const overduePct = (followUpStats.overdue / total) * 100;
    const todayPct = (followUpStats.dueToday / total) * 100;
    return { overduePct, todayPct, total };
  })();

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear(); const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i += 1) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [calendarMonth]);

  const followUpsByDay = useMemo(() => {
    const map: Record<string, number> = {};
    extra.followUps.forEach((f) => { if (f.status === 'completed' || f.status === 'cancelled') return; const d = new Date(f.due_at); const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; map[key] = (map[key] ?? 0) + 1; });
    return map;
  }, [extra.followUps]);

  const scheduleDay = selectedDay ?? new Date();
  const scheduleFollowUps = useMemo(() => extra.followUps.filter((f) => { if (f.status === 'completed' || f.status === 'cancelled') return false; const d = new Date(f.due_at); return d.getFullYear() === scheduleDay.getFullYear() && d.getMonth() === scheduleDay.getMonth() && d.getDate() === scheduleDay.getDate(); }), [extra.followUps, scheduleDay]);

  const recentLeads = useMemo(() => [...rangeLeads].sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()).slice(0, 6), [rangeLeads]);

  const today = new Date();
  const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  return <>
    <section className="ops-hero">
      <div><p className="eyebrow">Sales CRM</p><h2>Dashboard</h2><p>Overview of your sales pipeline, field activity, and collections</p></div>
      <div className="ops-date"><span>Today</span><strong>{new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date())}</strong><small>{data.activeRepresentatives} active representatives</small></div>
    </section>

    <div className="range-bar">
      {RANGES.map((r) => <button key={r.key} className={`range-pill ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)}>{r.label}</button>)}
      {range === 'custom' && (
        <span className="range-custom">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <span>to</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </span>
      )}
      <span className="range-showing">Showing: {RANGES.find((r) => r.key === range)?.label}{range === 'custom' && customFrom && customTo ? ` (${dateLabel(customFrom)} – ${dateLabel(customTo)})` : ''}</span>
    </div>

    {error ? <section className="access-card"><h2>Dashboard data is unavailable</h2><p>{error}</p></section> : <>
       <div className="ops-metrics">
        {kpis.map((k, index) => (
          <section className={`ops-metric tone-${index}`} key={k.label}>
            <div className="ops-metric-icon">{k.icon}</div>
            <p>{k.label}</p>
            <strong>{k.value}</strong>
            <small>{k.note}</small>
          </section>
        ))}
       </div>

      {activeIndustry === 'trading' && (
        <section className="ops-panel">
          <header><div><p className="eyebrow">TRADING</p><h2>Deal pipeline</h2></div></header>
          <div className="ops-metrics">
            <section className="ops-metric tone-0">
              <div className="ops-metric-icon">◆</div>
              <p>Total deals</p>
              <strong>{tradingStats.total}</strong>
            </section>
            <section className="ops-metric tone-1">
              <div className="ops-metric-icon">◷</div>
              <p>Open deals</p>
              <strong>{tradingStats.open}</strong>
            </section>
            <section className="ops-metric tone-2">
              <div className="ops-metric-icon">₹</div>
              <p>Deal value</p>
              <strong>{money(tradingStats.dealValue)}</strong>
            </section>
            <section className="ops-metric tone-3">
              <div className="ops-metric-icon">↗</div>
              <p>Expected margin</p>
              <strong>{money(tradingStats.expectedMargin)}</strong>
            </section>
          </div>
        </section>
      )}

      <div className="chart-grid">
        <section className="ops-panel chart-panel">
          <header><div><p className="eyebrow">Pipeline</p><h2>Leads by stage</h2></div></header>
          <div className="bar-chart">
            {leadBreakdown.counts.map((c) => (
              <div className="bar-row" key={c.label}>
                <span className="bar-label">{c.label}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(c.value / leadBreakdown.max) * 100}%`, background: c.color }} /></div>
                <span className="bar-value">{c.value}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="ops-panel chart-panel">
          <header><div><p className="eyebrow">Last 7 days</p><h2>Revenue trend</h2></div></header>
          <div className="trend-chart">
            {revenueTrend.days.map((d, index) => (
              <div className="trend-col" key={index}>
                <span className="trend-value">{d.value ? money(d.value) : ''}</span>
                <div className="trend-bar" style={{ height: `${Math.max(4, (d.value / revenueTrend.max) * 100)}%` }} title={`${d.label}: ${money(d.value)}`} />
                <span className="trend-label">{d.label}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="ops-panel chart-panel">
          <header><div><p className="eyebrow">{RANGES.find((r) => r.key === range)?.label}</p><h2>Lead source</h2></div></header>
          {leadSourceBreakdown.total ? (
            <ul className="source-list">
              {leadSourceBreakdown.entries.map(([key, count]) => (
                <li key={key}>
                  <i style={{ background: sourceColors[key] ?? 'var(--text-faint)' }} />
                  <span>{sourceLabels[key] ?? key}</span>
                  <div className="source-track"><div className="source-fill" style={{ width: `${(count / leadSourceBreakdown.total) * 100}%`, background: sourceColors[key] ?? 'var(--text-faint)' }} /></div>
                  <b>{count}</b>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ops-empty"><strong>No source data</strong><p>No leads created in this date range yet.</p></div>
          )}
        </section>
      </div>

      <div className="ops-grid">
        <section className="ops-panel chart-panel donut-panel">
          <header><div><p className="eyebrow">Follow-ups</p><h2>Due breakdown</h2></div></header>
          {followUpDonut ? (
            <div className="donut-wrap">
              <div className="donut" style={{ background: `conic-gradient(var(--red) 0 ${followUpDonut.overduePct}%, var(--amber) ${followUpDonut.overduePct}% ${followUpDonut.overduePct + followUpDonut.todayPct}%, var(--green) ${followUpDonut.overduePct + followUpDonut.todayPct}% 100%)` }}>
                <div className="donut-hole"><strong>{followUpDonut.total}</strong><span>pending</span></div>
              </div>
              <ul className="donut-legend">
                <li><i style={{ background: 'var(--red)' }} />Overdue · {followUpStats.overdue}</li>
                <li><i style={{ background: 'var(--amber)' }} />Due today · {followUpStats.dueToday}</li>
                <li><i style={{ background: 'var(--green)' }} />Upcoming · {followUpStats.upcoming}</li>
              </ul>
            </div>
          ) : (
            <div className="ops-empty"><strong>All caught up</strong><p>No pending follow-ups right now.</p></div>
          )}
        </section>
        <section className="ops-panel">
          <header>
            <div><p className="eyebrow">Field locations</p><h2>Reps currently checked in</h2></div>
            {live.length > 0 && <span>{live.length} live</span>}
          </header>
          {live.length ? (
            <div className="live-list">
              {live.map((visit) => {
                const lat = visit.latest_ping?.latitude ?? visit.check_in_lat;
                const lng = visit.latest_ping?.longitude ?? visit.check_in_lng;
                return (
                  <article key={visit.id}>
                    <i />
                    <div>
                      <strong>{visit.sales_representatives?.user_profiles?.display_name ?? visit.sales_representatives?.employee_code ?? 'Unassigned rep'}</strong>
                      <p>{visit.clients?.client_name ?? 'Unknown client'} · {lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'No GPS ping yet'}</p>
                    </div>
                    <time>Since {timeLabel(visit.check_in_time)}</time>
                    {lat != null && lng != null && <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">Map</a>}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="ops-empty"><strong>No one is checked in</strong><p>Live GPS-verified visit locations appear here as soon as a representative checks in from the mobile app.</p></div>
          )}
        </section>
      </div>

      <div className="ops-grid">
        <section className="ops-panel">
          <header><div><p className="eyebrow">Pipeline</p><h2>Recent leads</h2></div><span>{rangeLeads.length} in range</span></header>
          {recentLeads.length ? (
            <div className="recent-leads-list">
              {recentLeads.map((lead) => (
                <article key={lead.id}>
                  <div>
                    <strong>{lead.company_name ?? lead.contact_name ?? 'Untitled lead'}</strong>
                    <p>{sourceLabels[lead.source ?? 'other'] ?? lead.source} · {lead.status.replace('_', ' ')}</p>
                  </div>
                  <time>{dateLabel(lead.created_at)}</time>
                </article>
              ))}
            </div>
          ) : (
            <div className="ops-empty"><strong>No leads for this date range</strong><p>Leads created in the selected period will appear here.</p></div>
          )}
        </section>
        <section className="ops-panel calendar-panel">
          <header>
            <div><p className="eyebrow">Follow-ups</p><h2>Today's schedule</h2></div>
            <span>Open</span>
          </header>
          <div className="calendar-head">
            <button onClick={() => setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>‹</button>
            <strong>{calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
            <button onClick={() => setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>›</button>
          </div>
          <div className="calendar-grid">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span className="calendar-dow" key={i}>{d}</span>)}
            {calendarDays.map((d, i) => {
              if (!d) return <span key={i} />;
              const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
              const has = followUpsByDay[key] > 0;
              const isTodayCell = isSameDay(d, today);
              const isSelected = selectedDay ? isSameDay(d, selectedDay) : isTodayCell;
              return (
                <button key={i} className={`calendar-cell ${isSelected ? 'selected' : ''} ${isTodayCell && !isSelected ? 'today' : ''}`} onClick={() => setSelectedDay(d)}>
                  {d.getDate()}
                  {has && <i className="calendar-dot" />}
                </button>
              );
            })}
          </div>
          <div className="calendar-schedule">
            {scheduleFollowUps.length ? scheduleFollowUps.map((f) => (
              <div className="calendar-item" key={f.id}><strong>{f.title ?? 'Follow-up'}</strong><span>{f.clients?.client_name ?? ''} · {timeLabel(f.due_at)}</span></div>
            )) : <p className="ops-empty-inline">No follow-ups scheduled for this date range</p>}
          </div>
        </section>
      </div>

      <div className="ops-grid">
        <section className="ops-panel">
          <header><div><p className="eyebrow">Recent</p><h2>Latest field visits</h2></div></header>
          {data.recentVisits.length ? (
            <div className="timeline">
              {data.recentVisits.map((visit) => (
                <article key={visit.id}>
                  <i className={visit.status} />
                  <div>
                    <strong>{visit.clients?.client_name ?? 'Unknown client'}</strong>
                    <p>{visit.sales_representatives?.user_profiles?.display_name ?? visit.sales_representatives?.employee_code ?? 'Unassigned'} · {visit.outcome ?? visit.status.replace('_', ' ')}</p>
                  </div>
                  <time>{timeLabel(visit.check_in_time)}</time>
                </article>
              ))}
            </div>
          ) : (
            <div className="ops-empty"><strong>No visits recorded yet</strong><p>Field visit check-ins and check-outs will show up here as they happen.</p></div>
          )}
        </section>
        <section className="sales-today ops-panel">
          <p className="eyebrow">Today</p>
          <h2>{money(data.salesToday)}</h2>
          <div><span>Orders today</span><b>{data.ordersToday}</b></div>
          <div><span>Collections today</span><b>{money(data.collectionsToday)}</b></div>
          <div><span>Pending across all orders</span><b>{money(pendingPayments)}</b></div>
        </section>
      </div>
      <div className="ops-grid">
        <section className="ops-panel">
          <header><div><p className="eyebrow">Team</p><h2>Top representatives by order value</h2></div></header>
          {repPerformance.length ? (
            <div className="rep-performance-list">
              {repPerformance.map((rep, index) => (
                <article key={rep.name}>
                  <span className="rep-rank">#{index + 1}</span>
                  <div><strong>{rep.name}</strong><p>{rep.orders} order{rep.orders === 1 ? '' : 's'}</p></div>
                  <b>{money(rep.revenue)}</b>
                </article>
              ))}
            </div>
          ) : (
            <div className="ops-empty"><strong>No orders yet</strong><p>Rep performance ranks by total order value once orders come in.</p></div>
          )}
        </section>
        <section className="ops-readiness">
          <p className="eyebrow">Health</p>
          <h2>Leads &amp; follow-ups</h2>
          <div><span className={leadStats.total ? 'done' : ''}>{leadStats.total ? '✓' : '○'}</span><p><strong>Lead conversion</strong><small>{leadStats.converted} of {leadStats.total} leads converted ({leadStats.conversionRate}%)</small></p></div>
          <div><span className={followUpStats.overdue === 0 && followUpStats.pending > 0 ? 'done' : ''}>{followUpStats.overdue === 0 ? '✓' : '○'}</span><p><strong>Follow-up discipline</strong><small>{followUpStats.overdue ? `${followUpStats.overdue} overdue follow-up(s) need attention` : `${followUpStats.pending} pending, none overdue`}</small></p></div>
          <div><span>○</span><p><strong>Sales target vs achievement</strong><small>Not available yet — connect a targets endpoint to track this here</small></p></div>
        </section>
      </div>
      <div className="ops-grid">
        <section className="ops-panel">
          <header><div><p className="eyebrow">Support</p><h2>Calls today</h2></div></header>
          <div className="ops-readiness" style={{ background: 'transparent', padding: 0 }}>
            <div><span className={callStats.total ? 'done' : ''}>{callStats.total ? '✓' : '○'}</span><p><strong>{callStats.total} call{callStats.total === 1 ? '' : 's'} today</strong><small>{callStats.inbound} inbound · {callStats.outbound} outbound</small></p></div>
            <div><span className={callStats.missed === 0 && callStats.total > 0 ? 'done' : ''}>{callStats.missed === 0 ? '✓' : '○'}</span><p><strong>Missed / unanswered</strong><small>{callStats.missed ? `${callStats.missed} call(s) need follow-up` : 'None missed today'}</small></p></div>
            <div><span>○</span><p><strong>Recent callers</strong><small>{callsToday.slice(0, 3).map((c) => c.clients?.client_name ?? c.phone_number).join(', ') || 'No calls logged yet today'}</small></p></div>
          </div>
        </section>
        <section className="ops-readiness">
          <p className="eyebrow">Team</p>
          <h2>Rep coverage</h2>
          <div><span className="done">✓</span><p><strong>{data.totalRepresentatives} representatives total</strong><small>{data.activeRepresentatives} active today</small></p></div>
          <div><span className={activeClients ? 'done' : ''}>{activeClients ? '✓' : '○'}</span><p><strong>{activeClients} active clients</strong><small>of {extra.clients.length} total on record</small></p></div>
        </section>
      </div>
    </>}
  </>;
}