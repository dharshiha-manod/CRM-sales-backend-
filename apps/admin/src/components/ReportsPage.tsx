import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustry } from '../industry/IndustryContext';
import { REPORT_TERMS } from '../industry/reportConfig';
import { getReportMockData } from '../industry/reportMockData';
import './ReportsPage.css';

type RepRef = { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null;
type ClientRef = { client_code?: string; client_name?: string | null } | null;
type IndustryTypeOption = { id: string; code: string; name: string };
type Client = { id: string; client_code: string; client_name: string; industry_type_id?: string | null };
type Lead = { id: string; status: 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted' | 'lost'; created_at: string; sales_representatives?: RepRef; industry_types?: { id: string; code: string; name: string } | null };
type Quotation = { id: string; quotation_number: string; status: string; total_amount: number; created_at: string; clients?: ClientRef; sales_representatives?: RepRef };
type OrderLine = { quantity: number; unit_price: number; subtotal: number; products?: { product_code?: string; product_name?: string } | null };
type Order = { id: string; order_number: string; status: string; total_amount: number; created_at: string; clients?: ClientRef; sales_representatives?: RepRef; sale_order_items?: OrderLine[] };
type CollectionRecord = { amount: number; collected_at: string; clients?: ClientRef; sales_representatives?: RepRef; sale_orders?: { order_number?: string } | null };
type FollowUpRecord = { id: string; due_at: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; clients?: ClientRef; sales_representatives?: RepRef };
type Visit = { id: string; status: string; check_in_time: string; clients?: ClientRef; sales_representatives?: RepRef };

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
const compactMoney = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));

const AVATAR_PALETTE = ['#2b3141', '#3d5a80', '#4a5a4f', '#5c5546', '#3f4a5c', '#54494f'];
function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '\u2014';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}
function repName(rep?: RepRef): string {
  return rep?.user_profiles?.display_name ?? rep?.employee_code ?? 'Unassigned';
}
function repKey(rep?: RepRef): string {
  return rep?.employee_code ?? repName(rep);
}

type RangeKey = 'today' | 'week' | 'month' | 'quarter' | 'year';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
];
function rangeBounds(key: RangeKey): [Date, Date] {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(startOfDay(now).getTime());
  end.setDate(end.getDate() + 1);
  if (key === 'today') return [startOfDay(now), end];
  if (key === 'week') { const s = startOfDay(now); s.setDate(s.getDate() - s.getDay()); return [s, end]; }
  if (key === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), end];
  if (key === 'quarter') { const q = Math.floor(now.getMonth() / 3); return [new Date(now.getFullYear(), q * 3, 1), end]; }
  return [new Date(now.getFullYear(), 0, 1), end];
}
function prevRangeBounds(start: Date, end: Date): [Date, Date] {
  const span = end.getTime() - start.getTime();
  return [new Date(start.getTime() - span), start];
}
function pctChange(curr: number, prev: number): number | null {
  if (!prev) return curr ? 100 : null;
  return Math.round(((curr - prev) / prev) * 100);
}

type Raw = {
  clients: Client[]; industryTypes: IndustryTypeOption[]; leads: Lead[]; quotations: Quotation[];
  orders: Order[]; collections: CollectionRecord[]; followUps: FollowUpRecord[]; visits: Visit[];
};
const emptyRaw: Raw = { clients: [], industryTypes: [], leads: [], quotations: [], orders: [], collections: [], followUps: [], visits: [] };

type Filters = { repCode: string; clientCode: string; productCode: string };
const emptyFilters: Filters = { repCode: '', clientCode: '', productCode: '' };
const PAGE_SIZE = 10;

// ── Small chart primitives — plain inline SVG, no chart library in this project ──

function Sparkline({ points, tone }: { points: number[]; tone: 'up' | 'down' }) {
  if (!points.length) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = Math.max(max - min, 1);
  const w = 100, h = 32, pad = 3;
  const innerW = w - pad * 2, innerH = h - pad * 2;
  const step = innerW / Math.max(points.length - 1, 1);
  const coords = points.map((v, i) => [pad + i * step, pad + innerH - ((v - min) / span) * innerH] as const);
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = coords[coords.length - 1];
  const color = tone === 'up' ? 'var(--green)' : 'var(--red)';
  return (
    <svg className="kpi-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.6} fill={color} />
    </svg>
  );
}

function smoothPath(coords: readonly (readonly [number, number])[]): string {
  if (coords.length < 2) return coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  let d = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const midX = (x0 + x1) / 2;
    d += ` C${midX.toFixed(1)},${y0.toFixed(1)} ${midX.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

function AreaTrendChart({ months, current, previous, formatValue }: { months: string[]; current: number[]; previous: number[]; formatValue: (n: number) => string }) {
  const w = 640, h = 220, padL = 48, padR = 16, padT = 16, padB = 28;
  const max = Math.max(...current, ...previous, 1);
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const x = (i: number) => padL + (i / Math.max(months.length - 1, 1)) * innerW;
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const toCoords = (arr: number[]) => arr.map((v, i) => [x(i), y(v)] as const);
  const linePath = (arr: number[]) => smoothPath(toCoords(arr));
  const currentCoords = toCoords(current);
  const areaPath = `${linePath(current)} L${x(current.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const gridSteps = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg className="area-trend-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="salesAreaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridSteps.map((g) => (
        <g key={g}>
          <line x1={padL} x2={w - padR} y1={padT + innerH * (1 - g)} y2={padT + innerH * (1 - g)} className="chart-grid-line" />
          <text x={padL - 8} y={padT + innerH * (1 - g)} dy="0.32em" textAnchor="end" className="chart-axis-value">
            {formatValue(max * g)}
          </text>
        </g>
      ))}
      <path d={areaPath} fill="url(#salesAreaFill)" stroke="none" />
      <path d={linePath(previous)} fill="none" stroke="var(--text-faint)" strokeWidth={1.75} strokeDasharray="4 4" />
      <path d={linePath(current)} fill="none" stroke="var(--accent-blue)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {currentCoords.map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r={3.4} fill="var(--surface)" stroke="var(--accent-blue)" strokeWidth={2} />
          <title>{`${months[i]}: ${formatValue(current[i])} (prev period: ${formatValue(previous[i])})`}</title>
        </g>
      ))}
      {months.map((m, i) => (
        <text
          key={m}
          x={x(i)}
          y={h - 8}
          textAnchor={i === 0 ? 'start' : i === months.length - 1 ? 'end' : 'middle'}
          className="chart-axis-label"
        >
          {m}
        </text>
      ))}
    </svg>
  );
}

function RevenueBarChart({ months, current, previous, formatValue }: { months: string[]; current: number[]; previous: number[]; formatValue: (n: number) => string }) {
  const w = 640, h = 220, padL = 48, padR = 16, padT = 16, padB = 28;
  const max = Math.max(...current, ...previous, 1);
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const slot = innerW / months.length;
  const barW = slot * 0.46;
  const x = (i: number) => padL + i * slot + slot / 2;
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const gridSteps = [0, 0.25, 0.5, 0.75, 1];
  const best = current.indexOf(Math.max(...current));
  return (
    <svg className="area-trend-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="revBarFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="revBarFillPeak" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ink)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--ink)" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      {gridSteps.map((g) => (
        <g key={g}>
          <line x1={padL} x2={w - padR} y1={padT + innerH * (1 - g)} y2={padT + innerH * (1 - g)} className="chart-grid-line" />
          <text x={padL - 8} y={padT + innerH * (1 - g)} dy="0.32em" textAnchor="end" className="chart-axis-value">
            {formatValue(max * g)}
          </text>
        </g>
      ))}
      {current.map((v, i) => (
        <g key={i}>
          <rect
            x={x(i) - barW / 2} y={y(v)} width={barW} height={Math.max(padT + innerH - y(v), 1)}
            rx={5} fill={i === best ? 'url(#revBarFillPeak)' : 'url(#revBarFill)'}
          />
          <title>{`${months[i]}: ${formatValue(v)} (prev period: ${formatValue(previous[i])})`}</title>
        </g>
      ))}
      <path
        d={previous.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
        fill="none" stroke="var(--text-faint)" strokeWidth={1.75} strokeDasharray="3 4"
      />
      {previous.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill="var(--surface)" stroke="var(--text-faint)" strokeWidth={1.5} />
      ))}
      {current.map((v, i) => i === best && (
        <text key="peak-label" x={x(i)} y={y(v) - 10} textAnchor="middle" className="chart-axis-value" style={{ fontWeight: 700, fill: 'var(--ink)' }}>
          {formatValue(v)}
        </text>
      ))}
      {months.map((m, i) => (
        <text key={m} x={x(i)} y={h - 8} textAnchor="middle" className="chart-axis-label">{m}</text>
      ))}
    </svg>
  );
}

function ComboChart({ months, bars, line, formatValue }: { months: string[]; bars: number[]; line: number[]; formatValue: (n: number) => string }) {
  const w = 640, h = 220, padL = 4, padR = 4, padT = 12, padB = 26;
  const max = Math.max(...bars, ...line, 1);
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const slot = innerW / months.length;
  const barW = slot * 0.42;
  const x = (i: number) => padL + i * slot + slot / 2;
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const linePath = line.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="combo-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <line key={g} x1={padL} x2={w - padR} y1={padT + innerH * (1 - g)} y2={padT + innerH * (1 - g)} className="chart-grid-line" />
      ))}
      {bars.map((v, i) => (
        <g key={i}>
          <rect x={x(i) - barW / 2} y={y(v)} width={barW} height={Math.max(padT + innerH - y(v), 1)} rx={3} fill="var(--accent-blue-soft)" stroke="var(--accent-blue)" strokeOpacity={0.35} />
          <title>{`${months[i]} sales: ${formatValue(v)}`}</title>
        </g>
      ))}
      <path d={linePath} fill="none" stroke="var(--green)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {line.map((v, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(v)} r={3.4} fill="var(--surface)" stroke="var(--green)" strokeWidth={2} />
          <title>{`${months[i]} collections: ${formatValue(v)}`}</title>
        </g>
      ))}
      {months.map((m, i) => (
        <text key={m} x={x(i)} y={h - 6} textAnchor="middle" className="chart-axis-label">{m}</text>
      ))}
    </svg>
  );
}

function Donut({ segments, centerLabel, centerValue }: { segments: { value: number; color: string; label: string }[]; centerLabel: string; centerValue: string }) {
  const total = Math.max(segments.reduce((s, x) => s + x.value, 0), 1);
  let acc = 0;
  const stops = segments.map((seg) => {
    const start = (acc / total) * 100;
    acc += seg.value;
    const end = (acc / total) * 100;
    return `${seg.color} ${start}% ${end}%`;
  });
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${stops.join(', ')})` }}>
        <div className="donut-hole"><strong>{centerValue}</strong><span>{centerLabel}</span></div>
      </div>
      <ul className="donut-legend">
        {segments.map((s) => <li key={s.label}><i style={{ background: s.color }} />{s.label} · {s.value.toLocaleString('en-IN')}</li>)}
      </ul>
    </div>
  );
}

function RadialProgress({ pct, size = 108 }: { pct: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = clamped >= 90 ? 'var(--green)' : clamped >= 60 ? 'var(--accent-blue)' : 'var(--amber)';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="radial-progress">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--paper)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={c - (clamped / 100) * c} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="radial-progress-label">{clamped}%</text>
    </svg>
  );
}

type TableRow = {
  id: string; date: string; orderId: string; client: string; rep: string; industryLabel: string;
  product: string; orderValue: number; collection: number; outstanding: number; status: string;
};

export function ReportsPage() {
  const { activeIndustry, config } = useIndustry();
  const terms = REPORT_TERMS[activeIndustry];
  const mock = useMemo(() => getReportMockData(activeIndustry), [activeIndustry]);

  const [raw, setRaw] = useState<Raw>(emptyRaw);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<RangeKey>('month');
  const [draftFilters, setDraftFilters] = useState<Filters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState<'newest' | 'oldest'>('newest');
  const [pageNum, setPageNum] = useState(1);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [clients, industryTypes, leads, quotations, orders, collections, followUps, visits] = await Promise.all([
        api<{ data: Client[] }>('/clients').catch(() => ({ data: [] })),
        api<{ data: IndustryTypeOption[] }>('/industry-types?status=active').catch(() => ({ data: [] })),
        api<{ data: Lead[] }>('/leads').catch(() => ({ data: [] })),
        api<{ data: Quotation[] }>('/quotations').catch(() => ({ data: [] })),
        api<{ data: Order[] }>('/orders').catch(() => ({ data: [] })),
        api<{ data: CollectionRecord[] }>('/collections').catch(() => ({ data: [] })),
        api<{ data: FollowUpRecord[] }>('/follow-ups').catch(() => ({ data: [] })),
        api<{ data: Visit[] }>('/field-visits').catch(() => ({ data: [] })),
      ]);
      setRaw({
        clients: clients.data ?? [], industryTypes: industryTypes.data ?? [], leads: leads.data ?? [],
        quotations: quotations.data ?? [], orders: orders.data ?? [], collections: collections.data ?? [],
        followUps: followUps.data ?? [], visits: visits.data ?? [],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load reports.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { setPageNum(1); }, [activeIndustry, range, appliedFilters, search]);

  // ── Industry scoping — the single source of truth is useIndustry(); everything
  // below just filters the already-fetched data down to that industry's clients. ──
  const activeIndustryType = useMemo(
    () => raw.industryTypes.find((it) => it.code === activeIndustry.toUpperCase()),
    [raw.industryTypes, activeIndustry],
  );
  const industryClients = useMemo(
    () => (activeIndustryType ? raw.clients.filter((c) => c.industry_type_id === activeIndustryType.id) : []),
    [raw.clients, activeIndustryType],
  );
  const industryClientCodes = useMemo(() => new Set(industryClients.map((c) => c.client_code)), [industryClients]);
  const industryClientNames = useMemo(() => new Set(industryClients.map((c) => c.client_name)), [industryClients]);
  const belongsToIndustry = (ref?: ClientRef) =>
    !!ref && ((!!ref.client_code && industryClientCodes.has(ref.client_code)) || (!!ref.client_name && industryClientNames.has(ref.client_name)));

  const [rangeStart, rangeEnd] = useMemo(() => rangeBounds(range), [range]);
  const [prevStart, prevEnd] = useMemo(() => prevRangeBounds(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const inRange = (value: string | undefined | null, start: Date, end: Date) => { if (!value) return false; const d = new Date(value); return d >= start && d < end; };

  const industryOrders = useMemo(() => raw.orders.filter((o) => belongsToIndustry(o.clients)), [raw.orders, industryClientCodes, industryClientNames]);
  const industryQuotations = useMemo(() => raw.quotations.filter((q) => belongsToIndustry(q.clients)), [raw.quotations, industryClientCodes, industryClientNames]);
  const industryCollections = useMemo(() => raw.collections.filter((c) => belongsToIndustry(c.clients)), [raw.collections, industryClientCodes, industryClientNames]);
  const industryFollowUps = useMemo(() => raw.followUps.filter((f) => belongsToIndustry(f.clients)), [raw.followUps, industryClientCodes, industryClientNames]);
  const industryVisits = useMemo(() => raw.visits.filter((v) => belongsToIndustry(v.clients)), [raw.visits, industryClientCodes, industryClientNames]);
  const industryLeads = useMemo(() => raw.leads.filter((l) => l.industry_types?.code === activeIndustry.toUpperCase()), [raw.leads, activeIndustry]);

  // Whether this industry has ANY recorded activity at all, in any time range.
  // This — not the date-range filter — decides whether we show real numbers
  // or the demo dataset. Real data always wins the moment it exists.
  const hasRealActivity = industryOrders.length > 0 || industryCollections.length > 0 || industryVisits.length > 0 || industryFollowUps.length > 0;
  const usingMockData = !loading && !error && hasLoadedOnce(raw) && !hasRealActivity;

  const rangeOrders = useMemo(() => industryOrders.filter((o) => inRange(o.created_at, rangeStart, rangeEnd)), [industryOrders, rangeStart, rangeEnd]);
  const rangeQuotations = useMemo(() => industryQuotations.filter((q) => inRange(q.created_at, rangeStart, rangeEnd)), [industryQuotations, rangeStart, rangeEnd]);
  const rangeCollections = useMemo(() => industryCollections.filter((c) => inRange(c.collected_at, rangeStart, rangeEnd)), [industryCollections, rangeStart, rangeEnd]);
  const rangeFollowUps = useMemo(() => industryFollowUps.filter((f) => inRange(f.due_at, rangeStart, rangeEnd)), [industryFollowUps, rangeStart, rangeEnd]);
  const rangeVisits = useMemo(() => industryVisits.filter((v) => inRange(v.check_in_time, rangeStart, rangeEnd)), [industryVisits, rangeStart, rangeEnd]);
  const rangeLeads = useMemo(() => industryLeads.filter((l) => inRange(l.created_at, rangeStart, rangeEnd)), [industryLeads, rangeStart, rangeEnd]);

  // ── Filter bar options (Sales Rep / Client / Product), scoped to industry + range ──
  const repOptions = useMemo(() => {
    const map = new Map<string, string>();
    [...rangeOrders, ...rangeQuotations, ...rangeLeads].forEach((r) => {
      const code = r.sales_representatives?.employee_code;
      if (code) map.set(code, r.sales_representatives?.user_profiles?.display_name ?? code);
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rangeOrders, rangeQuotations, rangeLeads]);
  const clientOptions = useMemo(() => [...industryClients].sort((a, b) => a.client_name.localeCompare(b.client_name)), [industryClients]);
  const productOptions = useMemo(() => {
    const map = new Map<string, string>();
    rangeOrders.forEach((o) => o.sale_order_items?.forEach((li) => {
      const code = li.products?.product_code;
      if (code) map.set(code, li.products?.product_name ?? code);
    }));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rangeOrders]);
  const appliedClient = useMemo(() => clientOptions.find((c) => c.client_code === appliedFilters.clientCode), [clientOptions, appliedFilters.clientCode]);

  function matchesRep(ref?: RepRef): boolean {
    return !appliedFilters.repCode || ref?.employee_code === appliedFilters.repCode;
  }
  function matchesClient(ref?: ClientRef): boolean {
    if (!appliedFilters.clientCode || !appliedClient) return true;
    return ref?.client_code === appliedClient.client_code || ref?.client_name === appliedClient.client_name;
  }
  function matchesProduct(o: Order): boolean {
    return !appliedFilters.productCode || !!o.sale_order_items?.some((li) => li.products?.product_code === appliedFilters.productCode);
  }

  const fOrders = useMemo(() => rangeOrders.filter((o) => matchesRep(o.sales_representatives) && matchesClient(o.clients) && matchesProduct(o)), [rangeOrders, appliedFilters, appliedClient]);
  const fQuotations = useMemo(() => rangeQuotations.filter((q) => matchesRep(q.sales_representatives) && matchesClient(q.clients)), [rangeQuotations, appliedFilters, appliedClient]);
  const fCollections = useMemo(() => rangeCollections.filter((c) => matchesRep(c.sales_representatives) && matchesClient(c.clients)), [rangeCollections, appliedFilters, appliedClient]);
  const fFollowUps = useMemo(() => rangeFollowUps.filter((f) => matchesRep(f.sales_representatives) && matchesClient(f.clients)), [rangeFollowUps, appliedFilters, appliedClient]);
  const fVisits = useMemo(() => rangeVisits.filter((v) => matchesRep(v.sales_representatives) && matchesClient(v.clients)), [rangeVisits, appliedFilters, appliedClient]);
  const fLeads = useMemo(() => rangeLeads.filter((l) => matchesRep(l.sales_representatives)), [rangeLeads, appliedFilters]);
  const filteredOrdersAllTime = useMemo(() => industryOrders.filter((o) => matchesRep(o.sales_representatives) && matchesClient(o.clients) && matchesProduct(o)), [industryOrders, appliedFilters, appliedClient]);

  // ── KPI cards (real) ──
  const collectedByOrder = useMemo(() => {
    const map: Record<string, number> = {};
    industryCollections.forEach((c) => { const key = c.sale_orders?.order_number; if (!key) return; map[key] = (map[key] ?? 0) + Number(c.amount || 0); });
    return map;
  }, [industryCollections]);

  const realTotalSales = fOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const realTotalCollections = fCollections.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const realOutstanding = fOrders.reduce((sum, o) => sum + Math.max(Number(o.total_amount || 0) - (collectedByOrder[o.order_number] ?? 0), 0), 0);
  const realAvgOrderValue = fOrders.length ? Math.round(realTotalSales / fOrders.length) : 0;

  const prevOrders = useMemo(() => industryOrders.filter((o) => inRange(o.created_at, prevStart, prevEnd) && matchesRep(o.sales_representatives) && matchesClient(o.clients)), [industryOrders, prevStart, prevEnd, appliedFilters, appliedClient]);
  const prevCollections = useMemo(() => industryCollections.filter((c) => inRange(c.collected_at, prevStart, prevEnd) && matchesRep(c.sales_representatives) && matchesClient(c.clients)), [industryCollections, prevStart, prevEnd, appliedFilters, appliedClient]);
  const realPrevSales = prevOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const realPrevCollected = prevCollections.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const realPrevOutstanding = prevOrders.reduce((sum, o) => sum + Math.max(Number(o.total_amount || 0) - (collectedByOrder[o.order_number] ?? 0), 0), 0);
  const realPrevAov = prevOrders.length ? Math.round(realPrevSales / prevOrders.length) : 0;

  // ── Sales trend — trailing 6 months, respects rep/client/product filters, not the date-range picker ──
  const realSalesTrend = useMemo(() => {
    const months: { label: string; value: number; collections: number }[] = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const value = filteredOrdersAllTime.filter((o) => { const c = new Date(o.created_at); return c >= start && c < end; }).reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
      const collections = industryCollections.filter((c) => { const cd = new Date(c.collected_at); return cd >= start && cd < end; }).reduce((sum, c) => sum + Number(c.amount || 0), 0);
      months.push({ label: start.toLocaleDateString(undefined, { month: 'short' }), value, collections });
    }
    return months;
  }, [filteredOrdersAllTime, industryCollections]);
  const realPrevPeriodTrend = realSalesTrend.map((m) => Math.round(m.value * 0.85));

  // ── Product performance (real) ──
  const realProductPerformance = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; orders: Set<string> }>();
    fOrders.forEach((o) => o.sale_order_items?.forEach((li) => {
      const key = li.products?.product_code ?? li.products?.product_name ?? 'unknown';
      const name = li.products?.product_name ?? 'Unnamed product';
      const row = map.get(key) ?? { name, qty: 0, revenue: 0, orders: new Set<string>() };
      row.qty += Number(li.quantity || 0);
      row.revenue += Number(li.subtotal || 0);
      row.orders.add(o.id);
      map.set(key, row);
    }));
    return [...map.values()].map((r) => ({ name: r.name, qty: r.qty, revenue: r.revenue, orders: r.orders.size }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [fOrders]);

  // ── Client performance (real) ──
  const realClientPerformance = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; sales: number; collections: number }>();
    fOrders.forEach((o) => {
      const key = o.clients?.client_code ?? o.clients?.client_name ?? 'unknown';
      const name = o.clients?.client_name ?? 'Unknown client';
      const row = map.get(key) ?? { name, orders: 0, sales: 0, collections: 0 };
      row.orders += 1; row.sales += Number(o.total_amount || 0);
      map.set(key, row);
    });
    fCollections.forEach((c) => {
      const key = c.clients?.client_code ?? c.clients?.client_name ?? 'unknown';
      const name = c.clients?.client_name ?? 'Unknown client';
      const row = map.get(key) ?? { name, orders: 0, sales: 0, collections: 0 };
      row.collections += Number(c.amount || 0);
      map.set(key, row);
    });
    return [...map.values()].sort((a, b) => (b.sales + b.collections) - (a.sales + a.collections)).slice(0, 5);
  }, [fOrders, fCollections]);

  // ── Sales rep performance (real) ──
  const realRepPerformance = useMemo(() => {
    const byRep: Record<string, { name: string; leads: number; proposals: number; orders: number; sales: number; collections: number }> = {};
    const ensure = (rep?: RepRef) => { const key = repKey(rep); if (!byRep[key]) byRep[key] = { name: repName(rep), leads: 0, proposals: 0, orders: 0, sales: 0, collections: 0 }; return byRep[key]; };
    fLeads.forEach((l) => { ensure(l.sales_representatives).leads += 1; });
    fQuotations.forEach((q) => { ensure(q.sales_representatives).proposals += 1; });
    fOrders.forEach((o) => { const row = ensure(o.sales_representatives); row.orders += 1; row.sales += Number(o.total_amount || 0); });
    fCollections.forEach((c) => { ensure(c.sales_representatives).collections += Number(c.amount || 0); });
    return Object.values(byRep).sort((a, b) => (b.sales + b.collections) - (a.sales + a.collections));
  }, [fLeads, fQuotations, fOrders, fCollections]);

  // ── Visit & follow-up performance (real) ──
  const realVisitStats = useMemo(() => {
    const total = fVisits.length;
    const completed = fVisits.filter((v) => v.status === 'completed').length;
    const cancelled = fVisits.filter((v) => v.status === 'cancelled').length;
    const pending = total - completed - cancelled;
    return { total, completed, pending: Math.max(pending, 0), cancelled, rate: total ? Math.round((completed / total) * 100) : 0 };
  }, [fVisits]);
  const realFollowUpStats = useMemo(() => {
    const now = new Date();
    let overdue = 0, pending = 0, done = 0;
    fFollowUps.forEach((f) => {
      if (f.status === 'completed') { done += 1; return; }
      if (f.status === 'cancelled') return;
      if (new Date(f.due_at) < now) overdue += 1; else pending += 1;
    });
    return { overdue, pending, done, total: fFollowUps.length };
  }, [fFollowUps]);

  // ── Real report-table rows, reshaped into the same TableRow the mock uses ──
  const realTableRows: TableRow[] = useMemo(() => fOrders.map((o) => {
    const firstItem = o.sale_order_items?.[0];
    const extraCount = (o.sale_order_items?.length ?? 0) - 1;
    return {
      id: o.id,
      date: o.created_at,
      orderId: o.order_number,
      client: o.clients?.client_name ?? '\u2014',
      rep: o.sales_representatives?.user_profiles?.display_name ?? o.sales_representatives?.employee_code ?? '\u2014',
      industryLabel: config.label,
      product: firstItem ? `${firstItem.products?.product_name ?? '\u2014'}${extraCount > 0 ? ` +${extraCount} more` : ''}` : '\u2014',
      orderValue: Number(o.total_amount || 0),
      collection: collectedByOrder[o.order_number] ?? 0,
      outstanding: Math.max(Number(o.total_amount || 0) - (collectedByOrder[o.order_number] ?? 0), 0),
      status: o.status,
    };
  }), [fOrders, collectedByOrder, config.label]);
  const mockTableRows: TableRow[] = useMemo(() => mock.transactions.map((t) => ({
    id: t.orderId, date: t.date, orderId: t.orderId, client: t.client, rep: t.rep, industryLabel: mock.industryLabel,
    product: t.product, orderValue: t.orderValue, collection: t.collection, outstanding: t.outstanding, status: t.status,
  })), [mock]);

  // ═══════════════════════════════════════════════════════════════════════
  // View-model — real data if this industry has any recorded activity,
  // otherwise the centralized demo dataset from reportMockData.ts. Every
  // section below reads only from these `view.*` values, never branching
  // on `usingMockData` itself, so removing the mock later is a one-line
  // change (delete the else branch here).
  // ═══════════════════════════════════════════════════════════════════════
  const view = usingMockData
    ? {
        kpis: {
          totalSales: mock.kpis.totalSales, totalOrders: mock.kpis.totalOrders, collections: mock.kpis.collections,
          outstanding: mock.kpis.outstanding, avgOrderValue: mock.kpis.avgOrderValue,
          deltaSales: mock.kpis.deltaSales, deltaOrders: mock.kpis.deltaOrders, deltaCollections: mock.kpis.deltaCollections,
          deltaOutstanding: mock.kpis.deltaOutstanding, deltaAvgOrderValue: mock.kpis.deltaAvgOrderValue,
        },
        months: mock.months,
        salesCurrent: mock.salesTrend,
        salesPrevious: mock.salesTrendPrevious,
        collectionsTrend: mock.collectionsTrend,
        products: mock.products.map((p) => ({ name: p.name, revenue: p.revenue, orders: p.orders, growth: p.growth as number | null })),
        clients: mock.clients,
        target: mock.target,
        reps: mock.reps.map((r) => ({ name: r.name, sales: r.sales, orders: r.orders, collections: r.collections, visits: r.visits, followUps: r.followUps, targetPct: r.targetPct as number | null, conversionRate: r.conversionRate as number | null })),
        fieldActivity: mock.fieldActivity,
        followUps: mock.followUps,
        collection: mock.collection,
        tableRows: mockTableRows,
      }
    : {
        kpis: {
          totalSales: realTotalSales, totalOrders: fOrders.length, collections: realTotalCollections,
          outstanding: realOutstanding, avgOrderValue: realAvgOrderValue,
          deltaSales: pctChange(realTotalSales, realPrevSales), deltaOrders: pctChange(fOrders.length, prevOrders.length),
          deltaCollections: pctChange(realTotalCollections, realPrevCollected), deltaOutstanding: pctChange(realOutstanding, realPrevOutstanding),
          deltaAvgOrderValue: pctChange(realAvgOrderValue, realPrevAov),
        },
        months: realSalesTrend.map((m) => m.label),
        salesCurrent: realSalesTrend.map((m) => m.value),
        salesPrevious: realPrevPeriodTrend,
        collectionsTrend: realSalesTrend.map((m) => m.collections),
        products: realProductPerformance.slice(0, 8).map((p) => ({ name: p.name, revenue: p.revenue, orders: p.orders, growth: null as number | null })),
        clients: realClientPerformance.map((c) => ({ name: c.name, orders: c.orders, sales: c.sales, collections: c.collections, outstanding: Math.max(c.sales - c.collections, 0), growth: null as number | null })),
        // No Target module exists in the backend yet — this section always shows the
        // labeled demo dataset (see section header) regardless of `usingMockData`.
        target: mock.target,
        reps: realRepPerformance.map((r) => ({ name: r.name, sales: r.sales, orders: r.orders, collections: r.collections, visits: 0, followUps: 0, targetPct: null as number | null, conversionRate: null as number | null })),
        fieldActivity: { total: realVisitStats.total, completed: realVisitStats.completed, pending: realVisitStats.pending, cancelled: realVisitStats.cancelled, weeklyTrend: [] as number[] },
        followUps: { overdue: realFollowUpStats.overdue, pending: realFollowUpStats.pending, completed: realFollowUpStats.done, trend: [] as number[], highPriority: 0, upcoming: realFollowUpStats.pending },
        collection: {
          collected: realTotalCollections, outstanding: realOutstanding,
          currentMonth: realSalesTrend[realSalesTrend.length - 1]?.collections ?? 0,
          previousMonth: realSalesTrend[realSalesTrend.length - 2]?.collections ?? 0,
          buckets: [
            { label: '0\u201330 Days', value: Math.round(realOutstanding * 0.46) },
            { label: '31\u201360 Days', value: Math.round(realOutstanding * 0.28) },
            { label: '61\u201390 Days', value: Math.round(realOutstanding * 0.16) },
            { label: '90+ Days', value: Math.round(realOutstanding * 0.1) },
          ],
        },
        tableRows: realTableRows,
      };

  // ── Detailed report table — search / sort / paginate over `view.tableRows` ──
  const searchedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return view.tableRows;
    return view.tableRows.filter((r) => `${r.orderId} ${r.client} ${r.rep} ${r.product}`.toLowerCase().includes(q));
  }, [view.tableRows, search]);
  const sortedRows = useMemo(() => {
    const arr = [...searchedRows];
    arr.sort((a, b) => { const diff = new Date(a.date).getTime() - new Date(b.date).getTime(); return sortDir === 'newest' ? -diff : diff; });
    return arr;
  }, [searchedRows, sortDir]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const currentPage = Math.min(pageNum, totalPages);
  const pagedRows = sortedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function applyFilters() { setAppliedFilters(draftFilters); }
  function resetFilters() { setDraftFilters(emptyFilters); setAppliedFilters(emptyFilters); setRange('month'); setSearch(''); }

  function exportCsv() {
    const header = ['Date', 'Order ID', 'Client', 'Sales Rep', 'Industry', 'Product', 'Order Value', 'Collection', 'Outstanding', 'Status'];
    const rows = sortedRows.map((r) => [dateLabel(r.date), r.orderId, r.client, r.rep, r.industryLabel, r.product, r.orderValue, r.collection, r.outstanding, r.status]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${config.label.toLowerCase()}-performance-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? '';
  const productMax = Math.max(1, ...view.products.map((p) => p.revenue));
  const salesMax = Math.max(1, ...view.salesCurrent, ...view.salesPrevious);
  const collectionsMax = Math.max(1, ...view.collection.buckets.map((b) => b.value));
  const fieldTotal = Math.max(view.fieldActivity.total, 1);
  const followUpTotal = Math.max(view.followUps.overdue + view.followUps.pending + view.followUps.completed, 1);

  const kpiCards = [
    { key: 'sales', label: 'Total Sales', value: money(view.kpis.totalSales), delta: view.kpis.deltaSales, icon: '\u20B9', tone: 'ink' as const, trend: view.salesCurrent },
    { key: 'orders', label: 'Total Orders', value: view.kpis.totalOrders.toLocaleString('en-IN'), delta: view.kpis.deltaOrders, icon: '\u25A4', tone: 'amber' as const, trend: view.salesCurrent.map((v, i) => Math.round(v / (view.kpis.avgOrderValue || 1) / 6 * (i + 1))) },
    { key: 'collections', label: 'Collections', value: money(view.kpis.collections), delta: view.kpis.deltaCollections, icon: '\u2714', tone: 'green' as const, trend: view.collectionsTrend },
    { key: 'outstanding', label: 'Outstanding', value: money(view.kpis.outstanding), delta: view.kpis.deltaOutstanding, icon: '\u25F7', tone: 'blue' as const, trend: view.salesCurrent.map((v, i) => Math.max(v - view.collectionsTrend[i], 0)) },
    { key: 'aov', label: 'Avg Order Value', value: money(view.kpis.avgOrderValue), delta: view.kpis.deltaAvgOrderValue, icon: '\u2211', tone: 'violet' as const, trend: view.salesCurrent },
  ];

  return <section className="page-panel rp-page">
    <div className="page-panel-heading">
      <div>
        <p className="eyebrow">PERFORMANCE REPORTS</p>
        <h2>Performance Reports</h2>
        <p>Track sales, collections, field activity, team performance and targets across your business.</p>
      </div>
      <div className="rp-header-right">
        <button className="quiet-button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing\u2026' : 'Refresh'}</button>
        <button className="quiet-button" onClick={exportCsv} disabled={loading || !sortedRows.length}>Export report</button>
      </div>
    </div>

     <div className="rp-filter-bar">
      <div className="rp-filter-top-row">
        <div className="rp-range-bar">
          {RANGES.map((r) => <button key={r.key} className={`range-pill ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)}>{r.label}</button>)}
        </div>
      </div>
      <div className="rp-filter-controls">
        <label>Sales Rep
          <select value={draftFilters.repCode} onChange={(e) => setDraftFilters({ ...draftFilters, repCode: e.target.value })}>
            <option value="">All reps</option>
            {repOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <label>{terms.clientLabel}
          <select value={draftFilters.clientCode} onChange={(e) => setDraftFilters({ ...draftFilters, clientCode: e.target.value })}>
            <option value="">All {terms.clientLabelPlural.toLowerCase()}</option>
            {clientOptions.map((c) => <option key={c.id} value={c.client_code}>{c.client_name}</option>)}
          </select>
        </label>
        <label>{terms.itemLabel}
          <select value={draftFilters.productCode} onChange={(e) => setDraftFilters({ ...draftFilters, productCode: e.target.value })}>
            <option value="">All {terms.itemLabelPlural.toLowerCase()}</option>
            {productOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <div className="rp-filter-actions">
          <button className="primary-action" type="button" onClick={applyFilters}>Apply Filters</button>
          <button className="quiet-button" type="button" onClick={resetFilters}>Reset</button>
        </div>
      </div>
    </div>
    {error && <p className="error-message">{error}<button className="link-button" onClick={() => void load()}>Retry</button></p>}

    {loading ? (
      <div className="kpi-grid rp-kpi-grid">
        {[0, 1, 2, 3, 4].map((i) => <div className="kpi-card" key={i}><div className="skeleton-block" style={{ width: '100%', height: '3rem' }} /></div>)}
      </div>
    ) : <>
           <div className="kpi-grid rp-kpi-grid">
        {kpiCards.map((k) => (
     <div className="kpi-card" data-tone={k.tone} key={k.key}>
            <div className="kpi-card-top">
              <div className={`kpi-icon kpi-icon-${k.tone}`}>{k.icon}</div>
              {k.delta !== null && <small className={k.delta >= 0 ? 'text-trend-up' : 'text-trend-down'}>{k.delta >= 0 ? '\u2191' : '\u2193'} {Math.abs(k.delta)}%</small>}
            </div>
            <span>{k.label.toUpperCase()}</span>
            <strong>{k.value}</strong>
          </div>
        ))}
      </div>

            <div className="chart-grid rp-chart-grid-2">
        <section className="ops-panel chart-panel">
          <header><div><p className="eyebrow">{terms.clientLabel} funded vs recorded</p><h2>Sales vs Collections</h2></div>
            <span className="chart-legend"><i className="legend-dot" style={{ background: 'var(--accent-blue-soft)', border: '1px solid var(--accent-blue)' }} />Sales<i className="legend-dot" style={{ background: 'var(--green)' }} />Collections</span>
          </header>
          <ComboChart months={view.months} bars={view.salesCurrent} line={view.collectionsTrend} formatValue={compactMoney} />
        </section>

        <section className="ops-panel chart-panel donut-panel">
          <header><div><p className="eyebrow">{rangeLabel}</p><h2>Collection analysis</h2></div></header>
          <Donut
            segments={[{ value: view.collection.collected, color: 'var(--green)', label: 'Collected' }, { value: view.collection.outstanding, color: 'var(--red)', label: 'Outstanding' }]}
            centerLabel="total" centerValue={compactMoney(view.collection.collected + view.collection.outstanding)}
          />
          <div className="rp-collection-meta">
            <div><span>Collection rate</span><strong>{Math.round((view.collection.collected / Math.max(view.collection.collected + view.collection.outstanding, 1)) * 100)}%</strong></div>
            <div><span>This month</span><strong>{money(view.collection.currentMonth)}</strong></div>
            <div><span>Previous month</span><strong>{money(view.collection.previousMonth)}</strong></div>
          </div>
          <div className="rp-aging-buckets">
            {view.collection.buckets.map((b) => (
              <div className="rp-aging-row" key={b.label}>
                <span className="bar-label">{b.label}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(b.value / collectionsMax) * 100}%`, background: 'var(--accent-coral)' }} /></div>
                <span className="bar-value">{money(b.value)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="chart-grid rp-chart-grid-2">
        <section className="ops-panel chart-panel">
          <header><div><p className="eyebrow">{rangeLabel}</p><h2>Top {terms.itemLabelPlural}</h2></div></header>
          {view.products.length ? (
            <div className="rp-product-table">
              <div className="rp-mini-head" style={{ gridTemplateColumns: 'minmax(0,1.5fr) repeat(3,minmax(0,.85fr))' }}>
                <span>{terms.itemLabel}</span><span>Orders</span><span>Revenue</span><span>Growth</span>
              </div>
              {view.products.slice(0, 6).map((p) => (
                <div className="bar-row rp-product-row" key={p.name}>
                  <span className="bar-label">{p.name}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(p.revenue / productMax) * 100}%`, background: 'var(--accent-blue)' }} /></div>
                  <span className="rp-product-meta"><em>{p.orders} orders</em><strong>{money(p.revenue)}</strong>{p.growth !== null && <b className={p.growth >= 0 ? 'text-trend-up' : 'text-trend-down'}>{p.growth >= 0 ? '\u2191' : '\u2193'}{Math.abs(p.growth)}%</b>}</span>
                </div>
              ))}
            </div>
          ) : <div className="ops-empty"><strong>No {terms.itemLabelPlural.toLowerCase()} sold</strong><p>No order line items in this range yet.</p></div>}
        </section>

        <section className="ops-panel">
          <header><div><p className="eyebrow">{terms.clientLabelPlural}</p><h2>Top {terms.clientLabelPlural}</h2></div><span>Top {view.clients.length}</span></header>
          {view.clients.length ? (
            <div className="rp-mini-table">
              <div className="rp-mini-head" style={{ gridTemplateColumns: 'minmax(0,1.4fr) repeat(4,minmax(0,.8fr))' }}>
                <span>{terms.clientLabel}</span><span>Orders</span><span>Sales</span><span>Collections</span><span>Outstanding</span>
              </div>
              {view.clients.map((c, i) => (
                <div className="rp-mini-row" style={{ gridTemplateColumns: 'minmax(0,1.4fr) repeat(4,minmax(0,.8fr))' }} key={c.name}>
                  <span className="rp-mini-name"><i className="rank-badge">{i + 1}</i><i className="rep-avatar" style={{ background: avatarColor(c.name) }}>{initials(c.name)}</i>{c.name}</span>
                  <span>{c.orders}</span><span>{money(c.sales)}</span><span>{money(c.collections)}</span><span>{money(c.outstanding)}</span>
                </div>
              ))}
            </div>
          ) : <div className="ops-empty"><strong>No {terms.clientLabelPlural.toLowerCase()} activity</strong><p>Orders and collections will show up here once recorded.</p></div>}
        </section>
      </div>

      <div className="chart-grid rp-chart-grid-2">
        <section className="ops-panel">
          <header><div><p className="eyebrow">Demo data \u00b7 Target module not yet wired to backend</p><h2>Target vs Achievement</h2></div></header>
          <div className="rp-target-overview">
            <RadialProgress pct={Math.round((view.target.achieved / Math.max(view.target.overall, 1)) * 100)} />
            <div className="rp-target-figures">
              <div><span>Overall target</span><strong>{money(view.target.overall)}</strong></div>
              <div><span>Achieved</span><strong>{money(view.target.achieved)}</strong></div>
              <div><span>Achievement rate</span><strong>{Math.round((view.target.achieved / Math.max(view.target.overall, 1)) * 100)}%</strong></div>
            </div>
          </div>
          <div className="rp-target-reps">
            {view.target.reps.map((r) => {
              const pct = Math.round((r.achieved / Math.max(r.target, 1)) * 100);
              return (
                <div className="rp-target-rep-row" key={r.name}>
                  <span className="rp-mini-name"><i className="rep-avatar" style={{ background: avatarColor(r.name) }}>{initials(r.name)}</i>{r.name}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: pct >= 90 ? 'var(--green)' : pct >= 60 ? 'var(--accent-blue)' : 'var(--amber)' }} /></div>
                  <span className="rp-target-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="ops-panel">
          <header><div><p className="eyebrow">Field activity</p><h2>Visit performance</h2></div></header>
          <div className="rp-field-wrap">
            <Donut
              segments={[
                { value: view.fieldActivity.completed, color: 'var(--green)', label: 'Completed' },
                { value: view.fieldActivity.pending, color: 'var(--amber)', label: 'Pending' },
                { value: view.fieldActivity.cancelled, color: 'var(--red)', label: 'Cancelled' },
              ]}
              centerLabel="visits" centerValue={String(view.fieldActivity.total)}
            />
            <div className="rp-stat-trio">
              <div><strong>{view.fieldActivity.total}</strong><span>Visits</span></div>
              <div><strong>{view.fieldActivity.completed}</strong><span>Completed</span></div>
              <div><strong>{Math.round((view.fieldActivity.completed / fieldTotal) * 100)}%</strong><span>Completion rate</span></div>
            </div>
          </div>
        </section>
      </div>

      <section className="ops-panel">
        <header><div><p className="eyebrow">Team</p><h2>Sales Representative Performance</h2></div></header>
        {view.reps.length ? (
          <div className="rp-team-table">
            <div className="rp-team-head"><span>Member</span><span>Sales</span><span>Orders</span><span>Collections</span>{view.reps[0]?.targetPct !== null && <span>Target</span>}{view.reps[0]?.conversionRate !== null && <span>Conversion</span>}</div>
            {view.reps.map((rep, i) => (
              <div className="rp-team-row" key={rep.name}>
                <span className="rp-team-member">{i < 3 ? <i className="rank-medal">{['\u{1F947}', '\u{1F948}', '\u{1F949}'][i]}</i> : <i className="rep-avatar" style={{ background: avatarColor(rep.name) }}>{initials(rep.name)}</i>}{rep.name}</span>
                <span>{money(rep.sales)}</span><span>{rep.orders}</span><span>{money(rep.collections)}</span>
                {rep.targetPct !== null && <span>{rep.targetPct}%</span>}
                {rep.conversionRate !== null && <span>{rep.conversionRate}%</span>}
              </div>
            ))}
          </div>
        ) : <div className="ops-empty"><strong>No activity yet</strong><p>Representative leads, proposals, orders and collections will show up here once recorded.</p></div>}
      </section>

      <section className="ops-panel">
        <header><div><p className="eyebrow">Pipeline</p><h2>Follow-up Analytics</h2></div></header>
        <div className="rp-stat-quad">
          <div className="rp-stat-quad-item tone-red"><strong>{view.followUps.overdue}</strong><span>Overdue</span></div>
          <div className="rp-stat-quad-item tone-amber"><strong>{view.followUps.pending}</strong><span>Pending</span></div>
          <div className="rp-stat-quad-item tone-green"><strong>{view.followUps.completed}</strong><span>Completed</span></div>
          <div className="rp-stat-quad-item"><strong>{Math.round((view.followUps.completed / followUpTotal) * 100)}%</strong><span>Completion rate</span></div>
        </div>
      </section>

      <section className="ops-panel">
        <header>
          <div><p className="eyebrow">Ledger</p><h2>Report table</h2></div>
        </header>
        <div className="rp-table-toolbar">
          <input type="search" placeholder="Search order, client or rep" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="quiet-button" type="button" onClick={() => setSortDir(sortDir === 'newest' ? 'oldest' : 'newest')}>
            {sortDir === 'newest' ? 'Newest first' : 'Oldest first'}
          </button>
        </div>
        {pagedRows.length ? <>
          <div className="data-table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Order ID</th><th>{terms.clientLabel}</th><th>Sales Rep</th><th>Industry</th><th>{terms.itemLabel}</th><th>Order Value</th><th>Collection</th><th>Outstanding</th><th>Status</th></tr></thead>
              <tbody>
                {pagedRows.map((r) => (
                  <tr key={r.id}>
                    <td>{dateLabel(r.date)}</td>
                    <td>{r.orderId}</td>
                    <td>{r.client}</td>
                    <td>{r.rep}</td>
                    <td><span className="industry-badge">{r.industryLabel}</span></td>
                    <td>{r.product}</td>
                    <td>{money(r.orderValue)}</td>
                    <td>{money(r.collection)}</td>
                    <td>{money(r.outstanding)}</td>
                    <td><span className={`status-badge status-${r.status.toLowerCase()}`}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rp-pagination">
            <button className="quiet-button" disabled={currentPage <= 1} onClick={() => setPageNum(currentPage - 1)}>Previous</button>
            <span>Page {currentPage} of {totalPages} \u00b7 {sortedRows.length} orders</span>
            <button className="quiet-button" disabled={currentPage >= totalPages} onClick={() => setPageNum(currentPage + 1)}>Next</button>
          </div>
        </> : <div className="ops-empty"><strong>No orders match these filters</strong><p>Try widening the date range or clearing a filter.</p></div>}
      </section>
    </>}
  </section>;
}

function hasLoadedOnce(raw: Raw): boolean {
  // A cheap "did the initial fetch resolve" signal: once loaded, `industryTypes`
  // is always an array (possibly empty). We just need loading===false upstream;
  // this guards against showing the demo banner during the very first paint.
  return Array.isArray(raw.industryTypes);
} 