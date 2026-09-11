import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useIndustry, INDUSTRY_ORDER } from '../industry/IndustryContext';
import { INDUSTRY_CONFIGS } from '../industry/mockData';
import type { IndustryKey } from '../industry/types';
import './MasterDataPages.css';
import './TargetsPage.css';

/* ────────────────────────────── Types ────────────────────────────── */

type TargetType =
  | 'sales_amount' | 'order_value' | 'order_count' | 'collection_amount' | 'visit_count' | 'new_customers'
  | 'product_quantity' | 'doctor_visits' | 'pharmacy_visits'
  | 'order_quantity' | 'meter_quantity' | 'client_visits'
  | 'quantity_sold'
  | 'admission_target' | 'fee_collection' | 'institution_visits' | 'student_enrollment' | 'followups';
type TargetStatus = 'not_started' | 'on_track' | 'at_risk' | 'achieved' | 'exceeded';
type PeriodKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
type Role = 'admin' | 'manager' | 'rep';
type TargetPriority = 'low' | 'normal' | 'high';
type TargetLifecycle = 'active' | 'paused' | 'completed';

interface Adjustment {
  id: string;
  previousValue: number;
  newValue: number;
  reason: string;
  date: string;
  updatedBy: string;
}

interface BreakdownPoint {
  label: string;
  target: number;
  actual: number;
}

interface LinkedActivity {
  orders: number;
  collections: number;
  newCustomers: number;
  visits: number;
}

interface SalesTarget {
  id: string;
  repName: string;
  industry: IndustryKey;
  manager: string;
  targetType: TargetType;
  periodLabel: string;
  startDate: string;
  endDate: string;
  targetValue: number;
  achievedValue: number;
  breakdown: BreakdownPoint[];
  activity: LinkedActivity;
  remarks?: string;
  createdAt: string;
  createdBy: string;
  adjustments: Adjustment[];
  archived?: boolean;
  client?: string;
  product?: string;
  priority: TargetPriority;
  lifecycle: TargetLifecycle;
  /** Set when this target was created as part of a team assignment, to group siblings in the UI. */
  groupId?: string;
}

/* ────────────────────────────── Static config ────────────────────────────── */

const TARGET_TYPE_META: Record<TargetType, { label: string; unit: 'currency' | 'count' }> = {
  sales_amount: { label: 'Sales Amount', unit: 'currency' },
  order_value: { label: 'Order Value', unit: 'currency' },
  order_count: { label: 'Order Count', unit: 'count' },
  collection_amount: { label: 'Collection Amount', unit: 'currency' },
  visit_count: { label: 'Visit Count', unit: 'count' },
  new_customers: { label: 'New Customers', unit: 'count' },
  product_quantity: { label: 'Product Quantity', unit: 'count' },
  doctor_visits: { label: 'Doctor Visits', unit: 'count' },
  pharmacy_visits: { label: 'Pharmacy Visits', unit: 'count' },
  order_quantity: { label: 'Order Quantity', unit: 'count' },
  meter_quantity: { label: 'Meter Quantity', unit: 'count' },
  client_visits: { label: 'Client Visits', unit: 'count' },
  quantity_sold: { label: 'Quantity Sold', unit: 'count' },
  admission_target: { label: 'Admission Target', unit: 'count' },
  fee_collection: { label: 'Fee Collection', unit: 'currency' },
  institution_visits: { label: 'Institution Visits', unit: 'count' },
  student_enrollment: { label: 'Student Enrollment', unit: 'count' },
  followups: { label: 'Follow-ups', unit: 'count' },
};

/** Which target types apply to each supported industry, in display order. Vehicle keeps the
 *  original generic set since it predates this spec and isn't one of the five named industries. */
const INDUSTRY_TARGET_TYPES: Record<IndustryKey, TargetType[]> = {
  fmcg: ['sales_amount', 'order_count', 'collection_amount', 'visit_count', 'order_value'],
  pharma: ['sales_amount', 'product_quantity', 'doctor_visits', 'pharmacy_visits', 'collection_amount'],
  textile: ['sales_amount', 'order_quantity', 'meter_quantity', 'client_visits'],
  trading: ['sales_amount', 'order_value', 'quantity_sold', 'collection_amount'],
  school: ['admission_target', 'fee_collection', 'institution_visits', 'student_enrollment', 'followups'],
  vehicle: ['sales_amount', 'order_value', 'order_count', 'collection_amount', 'visit_count', 'new_customers'],
};
function targetTypesFor(industry: IndustryKey): TargetType[] {
  return INDUSTRY_TARGET_TYPES[industry];
}

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'year', label: 'This Year' },
  { key: 'custom', label: 'Custom Period' },
];

const STATUS_LABEL: Record<TargetStatus, string> = {
  not_started: 'Not Started',
  on_track: 'On Track',
  at_risk: 'At Risk',
  achieved: 'Achieved',
  exceeded: 'Exceeded',
};
const STATUS_BADGE: Record<TargetStatus, string> = {
  not_started: 'status-badge status-low',
  on_track: 'status-badge status-normal',
  at_risk: 'status-badge status-critical',
  achieved: 'status-badge status-completed',
  exceeded: 'status-badge status-converted',
};

const PRIORITY_LABEL: Record<TargetPriority, string> = { low: 'Low', normal: 'Normal', high: 'High' };
const PRIORITY_BADGE: Record<TargetPriority, string> = { low: 'status-badge status-low', normal: 'status-badge status-normal', high: 'status-badge status-critical' };
const LIFECYCLE_LABEL: Record<TargetLifecycle, string> = { active: 'Active', paused: 'Paused', completed: 'Completed' };

const ACHIEVEMENT_BUCKETS: { key: string; label: string; test: (pct: number) => boolean }[] = [
  { key: '', label: 'All achievement', test: () => true },
  { key: '0-25', label: '0 – 25%', test: (p) => p < 25 },
  { key: '25-50', label: '25 – 50%', test: (p) => p >= 25 && p < 50 },
  { key: '50-75', label: '50 – 75%', test: (p) => p >= 50 && p < 75 },
  { key: '75-100', label: '75 – 100%', test: (p) => p >= 75 && p < 100 },
  { key: '100+', label: '100%+', test: (p) => p >= 100 },
];

const ROSTER: Record<IndustryKey, { name: string; manager: string }[]> = {
  fmcg: [
    { name: 'Arun Kumar', manager: 'Raj Manager' },
    { name: 'Divya Shankar', manager: 'Raj Manager' },
    { name: 'Karthik Rajan', manager: 'Meera Iyer' },
  ],
  school: [
    { name: 'Priya Menon', manager: 'Meera Iyer' },
    { name: 'Suresh Babu', manager: 'Meera Iyer' },
  ],
  pharma: [
    { name: 'Meena Pillai', manager: 'Anand Rao' },
    { name: 'Vikram Sethi', manager: 'Anand Rao' },
  ],
  trading: [{ name: 'Farhan Ali', manager: 'Anand Rao' }],
  textile: [{ name: 'Lakshmi Menon', manager: 'Raj Manager' }],
  vehicle: [{ name: 'Rohit Verma', manager: 'Anand Rao' }],
};

/* The rep the "Sales Representative" role views as, for the mock role demo. */
const REP_SELF = 'Arun Kumar';

/** Sample client/institution names per industry, used only to give mock targets a realistic
 *  Client field — this list is illustrative and not sourced from the live Clients module. */
const CLIENT_SAMPLES: Record<IndustryKey, string[]> = {
  fmcg: ['Big Bazaar - Anna Nagar', 'Metro Wholesale', 'Nilgiris Supermarket'],
  pharma: ['Apollo Pharmacy', 'City Hospital', 'MedPlus Chain'],
  textile: ['Chennai Silks', 'Nalli Textiles', 'Pothys'],
  trading: ['Sundaram Traders', 'Coastal Imports', 'Delta Trading Co'],
  school: ['St. Xavier School', 'DAV Public School', 'Sacred Heart School'],
  vehicle: ['Prime Motors', 'City Auto Hub'],
};
const PRODUCT_SAMPLES: Record<IndustryKey, string[]> = {
  fmcg: ['Snacks Range', 'Beverages Range', 'Personal Care'],
  pharma: ['Cardiac Care Line', 'Antibiotics Range', 'Wellness Line'],
  textile: ['Cotton Sarees', 'Silk Collection', 'Furnishing Fabric'],
  trading: ['Steel Products', 'Industrial Hardware'],
  school: ['Uniform Sales', 'Stationery & Books', 'Canteen / Food Supply'],
  vehicle: ['SUV Range', 'Sedan Range'],
};

/* ────────────────────────────── Formatting helpers ────────────────────────────── */

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(value || 0));
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
function formatByType(value: number, type: TargetType): string {
  return TARGET_TYPE_META[type].unit === 'currency' ? money(value) : `${Math.round(value)}`;
}
function achievementPct(t: SalesTarget): number {
  return t.targetValue > 0 ? Math.round((t.achievedValue / t.targetValue) * 100) : 0;
}
function computeStatus(t: SalesTarget): TargetStatus {
  const pct = achievementPct(t);
  const now = new Date();
  const end = new Date(t.endDate);
  if (t.achievedValue <= 0 && now < end) return 'not_started';
  if (pct >= 110) return 'exceeded';
  if (pct >= 100) return 'achieved';
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000);
  if (pct < 50 && daysLeft <= 10) return 'at_risk';
  if (pct < 40) return 'at_risk';
  return 'on_track';
}
/** Overdue is derived rather than stored: a target past its end date that never reached 100%. */
function isOverdue(t: SalesTarget): boolean {
  return t.lifecycle === 'active' && new Date(t.endDate) < new Date() && achievementPct(t) < 100;
}
function daysRemaining(t: SalesTarget): number {
  return Math.ceil((new Date(t.endDate).getTime() - Date.now()) / 86400000);
}
/** Which linked-activity figure "drives" a given target type, for the automation panel. */
function drivingActivity(t: SalesTarget): { label: string; value: number } {
  switch (t.targetType) {
    case 'sales_amount':
    case 'order_value':
      return { label: 'Orders / Sales', value: t.activity.orders };
    case 'order_count':
      return { label: 'Orders placed', value: t.activity.orders };
    case 'collection_amount':
      return { label: 'Collections', value: t.activity.collections };
    case 'visit_count':
      return { label: 'Visits', value: t.activity.visits };
    case 'new_customers':
      return { label: 'New customers', value: t.activity.newCustomers };
    default:
      return { label: 'Activity', value: 0 };
  }
}

/* ────────────────────────────── Mock data ────────────────────────────── */

let seedCounter = 0;
function nextId(prefix: string): string {
  seedCounter += 1;
  return `${prefix}-${seedCounter}`;
}

function buildBreakdown(target: number, achieved: number): BreakdownPoint[] {
  const weights = [0.22, 0.28, 0.24, 0.26];
  let remainingActual = achieved;
  return weights.map((w, i) => {
    const t = Math.round(target * w);
    const isLast = i === weights.length - 1;
    const a = isLast ? Math.max(0, remainingActual) : Math.round(achieved * w * (0.85 + (i % 2) * 0.3));
    remainingActual -= a;
    return { label: `Week ${i + 1}`, target: t, actual: Math.max(0, a) };
  });
}

function makeTarget(opts: {
  repName: string; industry: IndustryKey; manager: string; targetType: TargetType;
  periodLabel: string; startDate: string; endDate: string; targetValue: number; achievedPct: number;
  createdAt: string; remarks?: string; archived?: boolean; adjustments?: Adjustment[];
  client?: string; product?: string; priority?: TargetPriority; lifecycle?: TargetLifecycle; groupId?: string;
}): SalesTarget {
  const achievedValue = Math.round(opts.targetValue * (opts.achievedPct / 100));
  const activity: LinkedActivity = {
    orders: opts.targetType === 'sales_amount' || opts.targetType === 'order_value' ? achievedValue : Math.round(achievedValue * 0.9),
    collections: opts.targetType === 'collection_amount' ? achievedValue : Math.round(opts.targetValue * 0.6 * (opts.achievedPct / 100)),
    newCustomers: opts.targetType === 'new_customers' ? achievedValue : Math.max(1, Math.round(achievedValue / 40000) || Math.round(opts.achievedPct / 15)),
    visits: opts.targetType === 'visit_count' ? achievedValue : Math.round(15 + opts.achievedPct * 0.3),
  };
  return {
    id: nextId('tgt'),
    repName: opts.repName,
    industry: opts.industry,
    manager: opts.manager,
    targetType: opts.targetType,
    periodLabel: opts.periodLabel,
    startDate: opts.startDate,
    endDate: opts.endDate,
    targetValue: opts.targetValue,
    achievedValue,
    breakdown: buildBreakdown(opts.targetValue, achievedValue),
    activity,
    remarks: opts.remarks,
    createdAt: opts.createdAt,
    createdBy: 'Admin',
    adjustments: opts.adjustments ?? [],
    archived: opts.archived,
    client: opts.client,
    product: opts.product,
    priority: opts.priority ?? 'normal',
    lifecycle: opts.lifecycle ?? 'active',
    groupId: opts.groupId,
  };
}

const CURRENT_TARGETS: SalesTarget[] = [
  makeTarget({ repName: 'Arun Kumar', industry: 'fmcg', manager: 'Raj Manager', targetType: 'sales_amount', periodLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', targetValue: 500000, achievedPct: 76, createdAt: '2026-09-01', client: CLIENT_SAMPLES.fmcg[0], product: PRODUCT_SAMPLES.fmcg[0], priority: 'high' }),
  makeTarget({ repName: 'Divya Shankar', industry: 'fmcg', manager: 'Raj Manager', targetType: 'collection_amount', periodLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', targetValue: 300000, achievedPct: 34, createdAt: '2026-09-01', client: CLIENT_SAMPLES.fmcg[1], priority: 'high' }),
  makeTarget({ repName: 'Karthik Rajan', industry: 'fmcg', manager: 'Meera Iyer', targetType: 'order_count', periodLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', targetValue: 60, achievedPct: 100, createdAt: '2026-09-01', product: PRODUCT_SAMPLES.fmcg[1] }),
  makeTarget({ repName: 'Priya Menon', industry: 'school', manager: 'Meera Iyer', targetType: 'institution_visits', periodLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', targetValue: 40, achievedPct: 62, createdAt: '2026-09-01', client: CLIENT_SAMPLES.school[0] }),
  makeTarget({ repName: 'Suresh Babu', industry: 'school', manager: 'Meera Iyer', targetType: 'admission_target', periodLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', targetValue: 10, achievedPct: 118, createdAt: '2026-09-01', client: CLIENT_SAMPLES.school[1], product: PRODUCT_SAMPLES.school[0] }),
  makeTarget({ repName: 'Meena Pillai', industry: 'pharma', manager: 'Anand Rao', targetType: 'sales_amount', periodLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', targetValue: 420000, achievedPct: 118, createdAt: '2026-09-01', client: CLIENT_SAMPLES.pharma[0], product: PRODUCT_SAMPLES.pharma[0] }),
  makeTarget({ repName: 'Vikram Sethi', industry: 'pharma', manager: 'Anand Rao', targetType: 'doctor_visits', periodLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', targetValue: 350000, achievedPct: 0, createdAt: '2026-09-01', priority: 'high' }),
  makeTarget({ repName: 'Farhan Ali', industry: 'trading', manager: 'Anand Rao', targetType: 'sales_amount', periodLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', targetValue: 800000, achievedPct: 44, createdAt: '2026-09-01', client: CLIENT_SAMPLES.trading[0], priority: 'high' }),
  makeTarget({ repName: 'Lakshmi Menon', industry: 'textile', manager: 'Raj Manager', targetType: 'meter_quantity', periodLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', targetValue: 260000, achievedPct: 55, createdAt: '2026-09-01', product: PRODUCT_SAMPLES.textile[0] }),
  makeTarget({ repName: 'Rohit Verma', industry: 'vehicle', manager: 'Anand Rao', targetType: 'sales_amount', periodLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', targetValue: 1200000, achievedPct: 82, createdAt: '2026-09-01' }),
  makeTarget({ repName: 'Karthik Rajan', industry: 'fmcg', manager: 'Meera Iyer', targetType: 'visit_count', periodLabel: 'August 2026', startDate: '2026-08-01', endDate: '2026-08-31', targetValue: 45, achievedPct: 12, createdAt: '2026-08-01', lifecycle: 'paused', remarks: 'Paused while rep is on route change' }),
];

const HISTORY_TARGETS: SalesTarget[] = [
  makeTarget({ repName: 'Arun Kumar', industry: 'fmcg', manager: 'Raj Manager', targetType: 'sales_amount', periodLabel: 'August 2026', startDate: '2026-08-01', endDate: '2026-08-31', targetValue: 480000, achievedPct: 104, createdAt: '2026-08-01', archived: true }),
  makeTarget({ repName: 'Arun Kumar', industry: 'fmcg', manager: 'Raj Manager', targetType: 'sales_amount', periodLabel: 'July 2026', startDate: '2026-07-01', endDate: '2026-07-31', targetValue: 450000, achievedPct: 91, createdAt: '2026-07-01', archived: true }),
  makeTarget({ repName: 'Karthik Rajan', industry: 'fmcg', manager: 'Meera Iyer', targetType: 'order_count', periodLabel: 'August 2026', startDate: '2026-08-01', endDate: '2026-08-31', targetValue: 55, achievedPct: 71, createdAt: '2026-08-01', archived: true }),
  makeTarget({ repName: 'Meena Pillai', industry: 'pharma', manager: 'Anand Rao', targetType: 'sales_amount', periodLabel: 'August 2026', startDate: '2026-08-01', endDate: '2026-08-31', targetValue: 400000, achievedPct: 96, createdAt: '2026-08-01', archived: true }),
  makeTarget({ repName: 'Priya Menon', industry: 'school', manager: 'Meera Iyer', targetType: 'institution_visits', periodLabel: 'August 2026', startDate: '2026-08-01', endDate: '2026-08-31', targetValue: 38, achievedPct: 87, createdAt: '2026-08-01', archived: true }),
];

/* ────────────────────────────── Component ────────────────────────────── */

export function TargetsPage() {
  const { activeIndustry } = useIndustry();

  const [role, setRole] = useState<Role>('admin');
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [targetType, setTargetType] = useState<TargetType>(targetTypesFor(activeIndustry)[0]);

  /* Whenever the global Industry Type changes, snap the selected target type back to a valid
     one for that industry — the previous industry's type may not exist in the new one's list. */
  useEffect(() => {
    const validTypes = targetTypesFor(activeIndustry);
    if (!validTypes.includes(targetType)) setTargetType(validTypes[0]);
  }, [activeIndustry]); // eslint-disable-line react-hooks/exhaustive-deps

  const [search, setSearch] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [achvBucket, setAchvBucket] = useState('');
  const [clientFilter, setClientFilter] = useState('');

  const [targets, setTargets] = useState<SalesTarget[]>(CURRENT_TARGETS);
  const [history] = useState<SalesTarget[]>(HISTORY_TARGETS);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SalesTarget | null>(null);
  const [viewing, setViewing] = useState<SalesTarget | null>(null);
  const [adjusting, setAdjusting] = useState<SalesTarget | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleting, setDeleting] = useState<SalesTarget | null>(null);
  const [duplicateToast, setDuplicateToast] = useState<string | null>(null);
  const [moreMenuFor, setMoreMenuFor] = useState<string | null>(null);
  const [chartGroupBy, setChartGroupBy] = useState<'rep' | 'industry' | 'month' | 'manager'>('rep');

  const [historyYear, setHistoryYear] = useState('');
  const [historyRep, setHistoryRep] = useState('');
  const [historyType, setHistoryType] = useState('');

  const canManage = role === 'admin' || role === 'manager';
  const canExport = role === 'admin';

  /* ---- scoping: active industry + target type + role visibility ---- */
  const industryTargets = useMemo(() => {
    let list = targets.filter((t) => t.industry === activeIndustry && t.targetType === targetType);
    if (role === 'rep') list = list.filter((t) => t.repName === REP_SELF);
    return list;
  }, [targets, activeIndustry, targetType, role]);

  const repOptions = useMemo(() => [...new Set(industryTargets.map((t) => t.repName))], [industryTargets]);
  const managerOptions = useMemo(() => [...new Set((ROSTER[activeIndustry] ?? []).map((r) => r.manager))], [activeIndustry]);
  const clientOptions = useMemo(() => [...new Set(industryTargets.map((t) => t.client).filter((c): c is string => !!c))], [industryTargets]);

  const filtered = useMemo(() => {
    return industryTargets.filter((t) => {
      if (search && !t.repName.toLowerCase().includes(search.toLowerCase())) return false;
      if (managerFilter && t.manager !== managerFilter) return false;
      if (clientFilter && t.client !== clientFilter) return false;
      const status = computeStatus(t);
      if (statusFilter && status !== statusFilter) return false;
      const pct = achievementPct(t);
      const bucket = ACHIEVEMENT_BUCKETS.find((b) => b.key === achvBucket);
      if (bucket && !bucket.test(pct)) return false;
      return true;
    });
  }, [industryTargets, search, managerFilter, clientFilter, statusFilter, achvBucket]);

  /* Ranked rep list — one row per rep (their filtered target, or their most recent industry
     target if the current filters exclude them), sorted by achievement % for ranking. */
  const rankedReps = useMemo(() => {
    return repOptions
      .map((rep) => {
        const t = filtered.find((x) => x.repName === rep) ?? industryTargets.find((x) => x.repName === rep);
        return t ? { rep, target: t, pct: achievementPct(t) } : null;
      })
      .filter((r): r is { rep: string; target: SalesTarget; pct: number } => r !== null)
      .sort((a, b) => b.pct - a.pct);
  }, [repOptions, filtered, industryTargets]);
  const topPerformers = rankedReps.filter((r) => r.pct >= 90).slice(0, 5);
  const needsAttention = rankedReps.filter((r) => r.pct < 50).sort((a, b) => a.pct - b.pct).slice(0, 5);

  /* ---- KPI roll-up ---- */
  const kpi = useMemo(() => {
    const totalTarget = filtered.reduce((sum, t) => sum + t.targetValue, 0);
    const achieved = filtered.reduce((sum, t) => sum + t.achievedValue, 0);
    const remaining = Math.max(0, totalTarget - achieved);
    const pct = totalTarget > 0 ? Math.round((achieved / totalTarget) * 100) : 0;
    const atRisk = filtered.filter((t) => computeStatus(t) === 'at_risk').length;
    return { totalTarget, achieved, remaining, pct, atRisk };
  }, [filtered]);

  /* ---- alerts, generated from the filtered dataset ---- */
  const alerts = useMemo(() => {
    const items: { id: string; tone: 'warn' | 'good' | 'star'; text: string }[] = [];
    filtered.forEach((t) => {
      const pct = achievementPct(t);
      const left = daysRemaining(t);
      const status = computeStatus(t);
      if (pct < 60 && status !== 'not_started' && left >= 0) items.push({ id: `${t.id}-low`, tone: 'warn', text: `${t.repName} is below 60% achievement (${pct}%).` });
      if (left >= 0 && left <= 5 && pct < 100) items.push({ id: `${t.id}-days`, tone: 'warn', text: `${t.repName} has only ${left} day${left === 1 ? '' : 's'} remaining to achieve the target.` });
      if (status === 'achieved') items.push({ id: `${t.id}-done`, tone: 'good', text: `${t.repName} achieved 100% of the target.` });
      if (status === 'exceeded') items.push({ id: `${t.id}-star`, tone: 'star', text: `${t.repName} exceeded the ${period === 'month' ? 'monthly' : 'period'} target by ${pct - 100}%.` });
    });
    return items;
  }, [filtered, period]);

  /* ---- chart aggregation ---- */
  const chartData = useMemo(() => {
    const groups = new Map<string, { target: number; achieved: number }>();
    filtered.forEach((t) => {
      const key = chartGroupBy === 'rep' ? t.repName : chartGroupBy === 'manager' ? t.manager : chartGroupBy === 'industry' ? INDUSTRY_CONFIGS[t.industry].label : t.periodLabel;
      const row = groups.get(key) ?? { target: 0, achieved: 0 };
      row.target += t.targetValue;
      row.achieved += t.achievedValue;
      groups.set(key, row);
    });
    return [...groups.entries()].map(([label, v]) => ({ label, ...v }));
  }, [filtered, chartGroupBy]);
  const chartMax = Math.max(1, ...chartData.map((d) => Math.max(d.target, d.achieved)));

  /* ---- history filtering ---- */
  const historyFiltered = useMemo(() => {
    return history.filter((t) => {
      if (historyYear && !t.periodLabel.includes(historyYear)) return false;
      if (historyRep && t.repName !== historyRep) return false;
      if (historyType && t.targetType !== historyType) return false;
      return t.industry === activeIndustry;
    });
  }, [history, historyYear, historyRep, historyType, activeIndustry]);

  /* ---- actions ---- */
  function clearFilters() { setSearch(''); setManagerFilter(''); setClientFilter(''); setStatusFilter(''); setAchvBucket(''); }
  const filtersActive = !!(search || managerFilter || clientFilter || statusFilter || achvBucket);
  const formIndustry = activeIndustry;
  function openCreate() { setEditing(null); setCreateOpen(true); }
  function openEdit(t: SalesTarget) { setEditing(t); setCreateOpen(true); }

  function submitTarget(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const industry = (form.get('industry') as IndustryKey) || activeIndustry;
    const repName = String(form.get('rep') || '');
    const manager = String(form.get('manager') || '');
    const type = form.get('type') as TargetType;
    const start = String(form.get('start') || '');
    const end = String(form.get('end') || '');
    const value = Number(form.get('value') || 0);
    const remarks = String(form.get('remarks') || '') || undefined;
    const client = String(form.get('client') || '') || undefined;
    const product = String(form.get('product') || '') || undefined;
    const priority = (form.get('priority') as TargetPriority) || 'normal';
    const periodLabel = start && end ? `${dateLabel(start)} – ${dateLabel(end)}` : 'Custom period';

    if (editing) {
      setTargets((cur) => cur.map((t) => (t.id === editing.id ? { ...t, industry, repName, manager, targetType: type, startDate: start, endDate: end, targetValue: value, periodLabel, remarks, client, product, priority } : t)));
    } else {
      const created = makeTarget({ repName, industry, manager, targetType: type, periodLabel, startDate: start, endDate: end, targetValue: value, achievedPct: 0, createdAt: new Date().toISOString().slice(0, 10), remarks, client, product, priority });
      setTargets((cur) => [created, ...cur]);
    }
    setCreateOpen(false);
    setEditing(null);
  }

  function requestDelete(t: SalesTarget) { setDeleting(t); }
  function confirmDelete() {
    if (!deleting) return;
    setTargets((cur) => cur.filter((t) => t.id !== deleting.id));
    setDeleting(null);
    if (viewing?.id === deleting.id) setViewing(null);
  }

  function duplicateTarget(t: SalesTarget) {
    const copy = makeTarget({
      repName: t.repName, industry: t.industry, manager: t.manager, targetType: t.targetType,
      periodLabel: t.periodLabel, startDate: t.startDate, endDate: t.endDate, targetValue: t.targetValue,
      achievedPct: 0, createdAt: new Date().toISOString().slice(0, 10),
      remarks: t.remarks, client: t.client, product: t.product, priority: t.priority,
    });
    setTargets((cur) => [copy, ...cur]);
    setDuplicateToast(`Target duplicated for ${t.repName} — new target starts at 0% achievement.`);
    setTimeout(() => setDuplicateToast(null), 4000);
  }

  function togglePause(t: SalesTarget) {
    setTargets((cur) => cur.map((x) => (x.id === t.id ? { ...x, lifecycle: x.lifecycle === 'paused' ? 'active' : 'paused' } : x)));
  }

  function submitAssignment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const type = form.get('type') as TargetType;
    const start = String(form.get('start') || '');
    const end = String(form.get('end') || '');
    const totalValue = Number(form.get('total') || 0);
    const periodLabel = start && end ? `${dateLabel(start)} – ${dateLabel(end)}` : 'Custom period';
    const distribution = form.get('distribution') as 'equal' | 'manual';
    const selectedReps = (ROSTER[activeIndustry] ?? []).filter((r) => form.get(`rep-${r.name}`) === 'on');
    if (selectedReps.length === 0) return;

    const groupId = nextId('grp');
    const created: SalesTarget[] = selectedReps.map((r) => {
      const share = distribution === 'manual'
        ? Number(form.get(`value-${r.name}`) || 0)
        : Math.round(totalValue / selectedReps.length);
      return makeTarget({
        repName: r.name, industry: activeIndustry, manager: r.manager, targetType: type,
        periodLabel, startDate: start, endDate: end, targetValue: share, achievedPct: 0,
        createdAt: new Date().toISOString().slice(0, 10), groupId,
      });
    });
    setTargets((cur) => [...created, ...cur]);
    setAssignOpen(false);
  }

  function submitAdjustment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!adjusting) return;
    const form = new FormData(e.currentTarget);
    const newValue = Number(form.get('newValue') || 0);
    const reason = String(form.get('reason') || '');
    const entry: Adjustment = { id: nextId('adj'), previousValue: adjusting.targetValue, newValue, reason, date: new Date().toISOString().slice(0, 10), updatedBy: role === 'manager' ? 'Manager' : 'Admin' };
    setTargets((cur) => cur.map((t) => (t.id === adjusting.id ? { ...t, targetValue: newValue, adjustments: [entry, ...t.adjustments] } : t)));
    setAdjusting(null);
    setViewing((cur) => (cur && cur.id === adjusting.id ? { ...cur, targetValue: newValue, adjustments: [entry, ...cur.adjustments] } : cur));
  }

  const typeMeta = TARGET_TYPE_META[targetType];

  return (
    <section className="page-panel master-page targets-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">TARGETS</p>
          <h2>Targets</h2>
          <p>Set, assign, and monitor sales targets across teams, representatives, and industry types.</p>
        </div>
        <div className="master-actions">
          {!canManage && (
            <span className="role-pill" title="Viewing as">Viewing as: {role === 'rep' ? 'Sales Representative' : 'Manager'}</span>
          )}
          <label className="role-switch">
            <span>Viewing as</span>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="rep">Sales Representative</option>
            </select>
          </label>
          {canExport && <button type="button" className="quiet-button">Export</button>}
          <button type="button" className="quiet-button" onClick={() => setTargets((cur) => [...cur])}>Refresh</button>
          {canManage && <button type="button" className="quiet-button" onClick={() => setAssignOpen(true)}>Assign to Team</button>}
          {canManage && <button type="button" className="primary-action" onClick={openCreate}>+ Create Target</button>}
        </div>
      </div>

     

      <div className="kpi-grid targets-kpi-grid">
        <div className="kpi-card"><div className="kpi-icon kpi-icon-ink">◧</div><div><span>Total Target</span><strong>{formatByType(kpi.totalTarget, targetType)}</strong></div></div>
        <div className="kpi-card"><div className="kpi-icon kpi-icon-green">✓</div><div><span>Achieved</span><strong>{formatByType(kpi.achieved, targetType)}</strong></div></div>
        <div className="kpi-card"><div className="kpi-icon kpi-icon-amber">◐</div><div><span>Remaining</span><strong>{formatByType(kpi.remaining, targetType)}</strong></div></div>
        <div className="kpi-card"><div className="kpi-icon kpi-icon-blue">%</div><div><span>Achievement %</span><strong>{kpi.pct}%</strong><div className="kpi-progress"><div className="kpi-progress-fill" style={{ width: `${Math.min(100, kpi.pct)}%` }} /></div></div></div>
        <div className="kpi-card"><div className="kpi-icon kpi-icon-red">!</div><div><span>At Risk</span><strong>{kpi.atRisk}</strong></div></div>
      </div>

      <div className="period-type-bar">
        <div className="period-pills" role="tablist" aria-label="Target period">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" className={period === p.key ? 'period-pill active' : 'period-pill'} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
        <label className="target-type-select">
          <span>Target Type</span>
          <select value={targetType} onChange={(e) => setTargetType(e.target.value as TargetType)}>
            {targetTypesFor(activeIndustry).map((t) => <option key={t} value={t}>{TARGET_TYPE_META[t].label}</option>)}
          </select>
        </label>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input value={search} placeholder="Search sales rep" onChange={(e) => setSearch(e.target.value)} />
          <span className="industry-scope-pill" title="Set globally from the sidebar / top industry switcher">
            {INDUSTRY_CONFIGS[activeIndustry].label}
          </span>
          <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}>
            <option value="">All managers</option>
            {managerOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            <option value="">All clients / institutions</option>
            {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as TargetStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select value={achvBucket} onChange={(e) => setAchvBucket(e.target.value)}>
            {ACHIEVEMENT_BUCKETS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          {filtersActive && <button type="button" className="quiet-button" onClick={clearFilters}>Clear</button>}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state empty-state-lg">
          <div className="empty-state-icon">◧</div>
          <h3>No targets assigned</h3>
          <p>Create a target to start monitoring sales performance.</p>
          {canManage && <button type="button" className="primary-action" onClick={openCreate}>+ Create Target</button>}
        </div>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sales Rep</th><th>Industry</th><th>Manager</th><th>Period</th><th>Target</th><th>Achieved</th><th>Remaining</th><th>Achievement %</th><th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const pct = achievementPct(t);
                const status = computeStatus(t);
                const remaining = Math.max(0, t.targetValue - t.achievedValue);
                const overdue = isOverdue(t);
                return (
                  <tr key={t.id}>
                    <td>{t.repName}</td>
                    <td>{INDUSTRY_CONFIGS[t.industry].label}</td>
                    <td>{t.manager}</td>
                    <td>{t.periodLabel}</td>
                    <td>{formatByType(t.targetValue, t.targetType)}</td>
                    <td>{formatByType(t.achievedValue, t.targetType)}</td>
                    <td>{formatByType(remaining, t.targetType)}</td>
                    <td>
                      <div className="achv-cell">
                        <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: pct >= 100 ? 'var(--green)' : pct < 40 ? 'var(--red)' : 'var(--accent-blue)' }} /></div>
                        <span>{pct}%</span>
                      </div>
                    </td>
                    <td>
                      {t.lifecycle === 'paused' ? <span className="status-badge status-low">Paused</span>
                        : overdue ? <span className="status-badge status-critical">Overdue</span>
                        : <span className={STATUS_BADGE[status]}>{STATUS_LABEL[status]}</span>}
                    </td>
                    <td className="table-actions">
                  <div className="row-actions-group">
                    <button type="button" className="icon-action" title="View" aria-label="View" onClick={() => setViewing(t)}>👁</button>
                    <button type="button" className="icon-action" title="Edit" aria-label="Edit" onClick={() => openEdit(t)}>✎</button>
                    <button type="button" className="icon-action" title="Adjust" aria-label="Adjust" onClick={() => setAdjusting(t)}>⇅</button>
                <div className="row-actions-menu">
                      <button
                        type="button"
                        className="icon-action"
                        title="More actions"
                        aria-label="More actions"
                        onClick={() => setMoreMenuFor(moreMenuFor === t.id ? null : t.id)}
                      >⋯</button>
                      {moreMenuFor === t.id && (
                        <div className="row-menu-backdrop" onClick={() => setMoreMenuFor(null)} />
                      )}
                      {moreMenuFor === t.id && (
                        <div className="row-menu row-actions-dropdown">
                          <button type="button" onClick={() => { duplicateTarget(t); setMoreMenuFor(null); }}>Duplicate</button>
                          <button type="button" onClick={() => { togglePause(t); setMoreMenuFor(null); }}>{t.lifecycle === 'paused' ? 'Resume' : 'Pause'}</button>
                          <button type="button" className="danger" onClick={() => { requestDelete(t); setMoreMenuFor(null); }}>Delete</button>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="targets-section">
          <h3>Alerts &amp; Attention Required</h3>
          <ul className="alert-list">
            {alerts.map((a) => (
              <li key={a.id} className={`alert-item alert-${a.tone}`}>
                <span className="alert-icon">{a.tone === 'warn' ? '⚠' : a.tone === 'star' ? '★' : '✓'}</span>
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="targets-section">
        <div className="targets-section-head">
          <h3>Target vs Achievement</h3>
          <div className="chart-group-toggle">
            {(['rep', 'industry', 'month', 'manager'] as const).map((g) => (
              <button key={g} type="button" className={chartGroupBy === g ? 'period-pill active' : 'period-pill'} onClick={() => setChartGroupBy(g)}>{g === 'rep' ? 'Sales Rep' : g[0].toUpperCase() + g.slice(1)}</button>
            ))}
          </div>
        </div>
        <div className="group-chart">
          {chartData.map((d) => (
            <div className="group-chart-row" key={d.label}>
              <span className="group-chart-label">{d.label}</span>
              <div className="group-chart-bars">
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(d.target / chartMax) * 100}%`, background: 'var(--text-faint)' }} /></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(d.achieved / chartMax) * 100}%`, background: 'var(--accent-blue)' }} /></div>
              </div>
              <span className="group-chart-value">{formatByType(d.achieved, targetType)} / {formatByType(d.target, targetType)}</span>
            </div>
          ))}
        </div>
        <div className="chart-legend"><span><i className="legend-dot" style={{ background: 'var(--text-faint)' }} />Target</span><span><i className="legend-dot" style={{ background: 'var(--accent-blue)' }} />Achieved</span></div>
      </div>

      {role !== 'rep' && rankedReps.length > 0 && (
        <div className="targets-section">
          <h3>Sales Representative Ranking</h3>
          <div className="rank-columns">
            <div>
              <h4>Top Performers</h4>
              {topPerformers.length === 0 ? (
                <p className="rank-empty">No reps at 90%+ achievement yet.</p>
              ) : (
                <ol className="rank-list">
                  {topPerformers.map((r, i) => (
                    <li key={r.rep}><span className="rank-position">{i + 1}</span><span className="rank-name">{r.rep}</span><strong className="rank-pct rank-pct-good">{r.pct}%</strong></li>
                  ))}
                </ol>
              )}
            </div>
            <div>
              <h4>Needs Attention</h4>
              {needsAttention.length === 0 ? (
                <p className="rank-empty">No reps significantly below target.</p>
              ) : (
                <ol className="rank-list">
                  {needsAttention.map((r, i) => (
                    <li key={r.rep}><span className="rank-position">{i + 1}</span><span className="rank-name">{r.rep}</span><strong className="rank-pct rank-pct-bad">{r.pct}%</strong></li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {role !== 'rep' && (
        <div className="targets-section">
          <h3>Sales Representative Performance</h3>
          <div className="rep-perf-grid">
            {repOptions.map((rep) => {
              const t = filtered.find((x) => x.repName === rep) ?? industryTargets.find((x) => x.repName === rep);
              if (!t) return null;
              const pct = achievementPct(t);
              const status = computeStatus(t);
              return (
                <div className="rep-perf-card" key={rep}>
                  <div className="rep-perf-head"><strong>{rep}</strong><span className={STATUS_BADGE[status]}>{STATUS_LABEL[status]}</span></div>
                  <div className="rep-perf-row"><span>Target</span><strong>{formatByType(t.targetValue, t.targetType)}</strong></div>
                  <div className="rep-perf-row"><span>Achieved</span><strong>{formatByType(t.achievedValue, t.targetType)}</strong></div>
                  <div className="rep-perf-row"><span>Remaining</span><strong>{formatByType(Math.max(0, t.targetValue - t.achievedValue), t.targetType)}</strong></div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: pct >= 100 ? 'var(--green)' : pct < 40 ? 'var(--red)' : 'var(--accent-blue)' }} /></div>
                  <small>{pct}% achieved</small>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="targets-section">
        <div className="targets-section-head">
          <h3>Target History</h3>
        </div>
        <div className="master-toolbar">
          <div className="master-search">
            <select value={historyYear} onChange={(e) => setHistoryYear(e.target.value)}>
              <option value="">All years</option>
              <option value="2026">2026</option>
              <option value="2025">2025</option>
            </select>
            <select value={historyRep} onChange={(e) => setHistoryRep(e.target.value)}>
              <option value="">All representatives</option>
              {[...new Set(history.filter((h) => h.industry === activeIndustry).map((h) => h.repName))].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={historyType} onChange={(e) => setHistoryType(e.target.value)}>
              <option value="">All target types</option>
              {targetTypesFor(activeIndustry).map((t) => <option key={t} value={t}>{TARGET_TYPE_META[t].label}</option>)}
            </select>
          </div>
        </div>
        {historyFiltered.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">◧</div><p>No historical targets for this industry yet.</p></div>
        ) : (
          <div className="data-table-wrap">
            <table>
              <thead><tr><th>Sales Rep</th><th>Industry</th><th>Period</th><th>Target</th><th>Achieved</th><th>Achievement %</th><th>Status</th></tr></thead>
              <tbody>
                {historyFiltered.map((t) => {
                  const pct = achievementPct(t);
                  const status = computeStatus(t);
                  return (
                    <tr key={t.id}>
                      <td>{t.repName}</td>
                      <td>{INDUSTRY_CONFIGS[t.industry].label}</td>
                      <td>{t.periodLabel}</td>
                      <td>{formatByType(t.targetValue, t.targetType)}</td>
                      <td>{formatByType(t.achievedValue, t.targetType)}</td>
                      <td>{pct}%</td>
                      <td><span className={STATUS_BADGE[status]}>{STATUS_LABEL[status]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Target details / performance drawer */}
      {viewing && (
        <div className="modal-backdrop" onMouseDown={() => setViewing(null)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">TARGET DETAILS</p><h3>{viewing.repName}</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setViewing(null)}>×</button>
            </div>
            <dl className="detail-dl">
              <dt>Sales Representative</dt><dd>{viewing.repName}</dd>
              <dt>Industry Type</dt><dd>{INDUSTRY_CONFIGS[viewing.industry].label}</dd>
              <dt>Manager</dt><dd>{viewing.manager}</dd>
              <dt>Target Type</dt><dd>{TARGET_TYPE_META[viewing.targetType].label}</dd>
              <dt>Target Period</dt><dd>{viewing.periodLabel}</dd>
              <dt>Target Value</dt><dd>{formatByType(viewing.targetValue, viewing.targetType)}</dd>
              <dt>Priority</dt><dd><span className={PRIORITY_BADGE[viewing.priority]}>{PRIORITY_LABEL[viewing.priority]}</span></dd>
              <dt>Status</dt><dd>{viewing.lifecycle === 'paused' ? 'Paused' : isOverdue(viewing) ? 'Overdue' : LIFECYCLE_LABEL[viewing.lifecycle]}</dd>
              {viewing.client && (<><dt>Client / Institution</dt><dd>{viewing.client}</dd></>)}
              {viewing.product && (<><dt>Product / Service</dt><dd>{viewing.product}</dd></>)}
              <dt>Created</dt><dd>{dateLabel(viewing.createdAt)} by {viewing.createdBy}</dd>
              {viewing.remarks && (<><dt>Remarks</dt><dd>{viewing.remarks}</dd></>)}
            </dl>

            <div className="target-perf-summary">
              <div><span>Target</span><strong>{formatByType(viewing.targetValue, viewing.targetType)}</strong></div>
              <div><span>Achieved</span><strong>{formatByType(viewing.achievedValue, viewing.targetType)}</strong></div>
              <div><span>Remaining</span><strong>{formatByType(Math.max(0, viewing.targetValue - viewing.achievedValue), viewing.targetType)}</strong></div>
              <div><span>Achievement</span><strong>{achievementPct(viewing)}%</strong></div>
            </div>
            <div className="bar-track big"><div className="bar-fill" style={{ width: `${Math.min(100, achievementPct(viewing))}%`, background: achievementPct(viewing) >= 100 ? 'var(--green)' : achievementPct(viewing) < 40 ? 'var(--red)' : 'var(--accent-blue)' }} /></div>

            <h4>Performance Breakdown</h4>
            <div className="breakdown-list">
              {viewing.breakdown.map((b) => (
                <div className="breakdown-row" key={b.label}>
                  <span className="breakdown-label">{b.label}</span>
                  <div className="group-chart-bars">
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, (b.target / Math.max(1, viewing.targetValue) ) * 100 * viewing.breakdown.length)}%`, background: 'var(--text-faint)' }} /></div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, (b.actual / Math.max(1, viewing.targetValue)) * 100 * viewing.breakdown.length)}%`, background: 'var(--accent-blue)' }} /></div>
                  </div>
                  <span className="breakdown-value">{formatByType(b.actual, viewing.targetType)} / {formatByType(b.target, viewing.targetType)} <em className={b.actual >= b.target ? 'variance-pos' : 'variance-neg'}>({b.actual >= b.target ? '+' : ''}{formatByType(b.actual - b.target, viewing.targetType)})</em></span>
                </div>
              ))}
            </div>

            <h4>Target Automation</h4>
            <p className="automation-note">Achievement for this target is driven by <strong>{drivingActivity(viewing).label}</strong> recorded through field activity.</p>
            <div className="automation-grid">
              <div><span>Orders</span><strong>{money(viewing.activity.orders)}</strong></div>
              <div><span>Collections</span><strong>{money(viewing.activity.collections)}</strong></div>
              <div><span>New Customers</span><strong>{viewing.activity.newCustomers}</strong></div>
              <div><span>Visits</span><strong>{viewing.activity.visits}</strong></div>
            </div>

            {viewing.adjustments.length > 0 && (
              <>
                <h4>Adjustment History</h4>
                <div className="data-table-wrap">
                  <table>
                    <thead><tr><th>Previous</th><th>New</th><th>Reason</th><th>Date</th><th>Updated by</th></tr></thead>
                    <tbody>
                      {viewing.adjustments.map((a) => (
                        <tr key={a.id}><td>{formatByType(a.previousValue, viewing.targetType)}</td><td>{formatByType(a.newValue, viewing.targetType)}</td><td>{a.reason}</td><td>{dateLabel(a.date)}</td><td>{a.updatedBy}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {canManage && (
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => { openEdit(viewing); setViewing(null); }}>Edit Target</button>
                <button type="button" className="primary-action" onClick={() => { setAdjusting(viewing); setViewing(null); }}>Adjust Target</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create / edit target modal */}
      {createOpen && (
        <div className="modal-backdrop" onMouseDown={() => setCreateOpen(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="target-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">{editing ? 'EDIT TARGET' : 'NEW TARGET'}</p><h3 id="target-modal-title">{editing ? 'Edit target' : 'Create target'}</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setCreateOpen(false)}>×</button>
            </div>
            <form onSubmit={submitTarget} className="master-modal-form">
           <div className="field-grid">
                <input type="hidden" name="industry" value={activeIndustry} />
                <label>Sales Representative
                  <input name="rep" defaultValue={editing?.repName} placeholder="e.g. Arun Kumar" required />
                </label>
                <label>Manager
                  <input name="manager" defaultValue={editing?.manager} placeholder="e.g. Raj Manager" required />
                </label>
                <label>Target Type
                  <select name="type" defaultValue={editing?.targetType ?? targetTypesFor(formIndustry)[0]} key={formIndustry}>
                    {targetTypesFor(formIndustry).map((t) => <option key={t} value={t}>{TARGET_TYPE_META[t].label}</option>)}
                  </select>
                </label>
                <label>Start Date
                  <input type="date" name="start" defaultValue={editing?.startDate} required />
                </label>
                <label>End Date
                  <input type="date" name="end" defaultValue={editing?.endDate} required />
                </label>
                <label>Target Value
                  <input type="number" name="value" min="0" step="1" defaultValue={editing?.targetValue} placeholder="e.g. 500000" required />
                </label>
                <label>Unit
                  <input value={TARGET_TYPE_META[editing?.targetType ?? targetTypesFor(formIndustry)[0]].unit === 'currency' ? '₹ (currency)' : 'Count'} disabled />
                </label>
                                <label>Client / Institution
                  <input name="client" defaultValue={editing?.client} placeholder={`Optional — e.g. ${CLIENT_SAMPLES[formIndustry][0]}`} list="target-client-options" />
                  <datalist id="target-client-options">
                    {CLIENT_SAMPLES[formIndustry].map((c) => <option key={c} value={c} />)}
                  </datalist>
                </label>
                <label>Product / Service
                  <input name="product" defaultValue={editing?.product} placeholder={`Optional — e.g. ${PRODUCT_SAMPLES[formIndustry][0]}`} list="target-product-options" />
                  <datalist id="target-product-options">
                    {PRODUCT_SAMPLES[formIndustry].map((p) => <option key={p} value={p} />)}
                  </datalist>
                </label>
                <label>Priority
                  <select name="priority" defaultValue={editing?.priority ?? 'normal'}>
                    {(Object.keys(PRIORITY_LABEL) as TargetPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </select>
                </label>
                <label>Remarks
                  <textarea name="remarks" defaultValue={editing?.remarks} rows={3} placeholder="Optional notes for this target" />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setCreateOpen(false)}>Cancel</button>
                <button type="submit" className="primary-action">{editing ? 'Save changes' : 'Create Target'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust target modal */}
      {adjusting && (
        <div className="modal-backdrop" onMouseDown={() => setAdjusting(null)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="adjust-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">ADJUST TARGET</p><h3 id="adjust-modal-title">{adjusting.repName}</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setAdjusting(null)}>×</button>
            </div>
            <form onSubmit={submitAdjustment} className="master-modal-form">
              <div className="adjust-flow">
                <div><span>Current Target</span><strong>{formatByType(adjusting.targetValue, adjusting.targetType)}</strong></div>
                <span className="adjust-arrow">→</span>
                <div><span>New Target</span><input type="number" name="newValue" min="0" step="1" defaultValue={adjusting.targetValue} required /></div>
              </div>
              <div className="field-grid">
                <label>Reason
                  <textarea name="reason" rows={3} placeholder="Why is this target being adjusted?" required />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="quiet-button" onClick={() => setAdjusting(null)}>Cancel</button>
                <button type="submit" className="primary-action">Save Adjustment</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign target to team modal */}
      {assignOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAssignOpen(false)}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="assign-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">TEAM ASSIGNMENT</p><h3 id="assign-modal-title">Assign target to team</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setAssignOpen(false)}>×</button>
            </div>
            <AssignTeamForm industry={activeIndustry} onSubmit={submitAssignment} onCancel={() => setAssignOpen(false)} />
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleting && (
        <div className="modal-backdrop" onMouseDown={() => setDeleting(null)}>
          <div className="master-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">DELETE TARGET</p><h3 id="delete-modal-title">Delete this target?</h3></div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setDeleting(null)}>×</button>
            </div>
            <p style={{ padding: '0 1.6rem' }}>
              This will permanently remove the {formatByType(deleting.targetValue, deleting.targetType)} target
              assigned to <strong>{deleting.repName}</strong> for {deleting.periodLabel}. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setDeleting(null)}>Cancel</button>
              <button type="button" className="primary-action primary-action-danger" onClick={confirmDelete}>Delete Target</button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate confirmation toast */}
      {duplicateToast && (
        <div className="toast-notification" role="status">{duplicateToast}</div>
      )}
    </section>
  );
}

/* ────────────────────────────── Assign-to-team form ────────────────────────────── */

/** Standalone so its manual-value inputs can be locally controlled without touching page state
 *  on every keystroke of the parent Targets page. */
function AssignTeamForm({ industry, onSubmit, onCancel }: { industry: IndustryKey; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  const roster = ROSTER[industry] ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set(roster.map((r) => r.name)));
  const [distribution, setDistribution] = useState<'equal' | 'manual'>('equal');
  const [total, setTotal] = useState(0);
  const [manualValues, setManualValues] = useState<Record<string, number>>({});

  const equalShare = selected.size > 0 ? Math.round(total / selected.size) : 0;
  const manualSum = [...selected].reduce((sum, name) => sum + (manualValues[name] ?? 0), 0);
  const manualMismatch = distribution === 'manual' && total > 0 && manualSum !== total;

  function toggle(name: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  return (
    <form onSubmit={onSubmit} className="master-modal-form">
      <div className="field-grid">
        <label>Target Type
          <select name="type" defaultValue={targetTypesFor(industry)[0]}>
            {targetTypesFor(industry).map((t) => <option key={t} value={t}>{TARGET_TYPE_META[t].label}</option>)}
          </select>
        </label>
        <label>Start Date
          <input type="date" name="start" required />
        </label>
        <label>End Date
          <input type="date" name="end" required />
        </label>
        <label>Total Team Target
          <input type="number" name="total" min="0" step="1" value={total || ''} onChange={(e) => setTotal(Number(e.target.value || 0))} placeholder="e.g. 5000000" required />
        </label>
      </div>

      <h4>Assign to</h4>
      <div className="assign-rep-list">
        {roster.map((r) => (
          <label key={r.name} className="assign-rep-row">
            <input type="checkbox" name={`rep-${r.name}`} checked={selected.has(r.name)} onChange={() => toggle(r.name)} />
            <span>{r.name}</span>
            <span className="assign-rep-manager">{r.manager}</span>
            {distribution === 'equal' ? (
              <strong>{selected.has(r.name) ? money(equalShare) : '—'}</strong>
            ) : (
              <input
                type="number" name={`value-${r.name}`} min="0" step="1" disabled={!selected.has(r.name)}
                value={manualValues[r.name] ?? ''}
                onChange={(e) => setManualValues((cur) => ({ ...cur, [r.name]: Number(e.target.value || 0) }))}
                placeholder="0"
              />
            )}
          </label>
        ))}
        {roster.length === 0 && <p className="empty-state"><span>No sales representatives found for this industry yet.</span></p>}
      </div>

      <div className="field-grid">
        <label>Distribution
          <select value={distribution} onChange={(e) => setDistribution(e.target.value as 'equal' | 'manual')}>
            <option value="equal">Equal split across selected reps</option>
            <option value="manual">Manual — set each rep's value</option>
          </select>
        </label>
      </div>
      {manualMismatch && (
        <p className="form-warning">Manual values total {money(manualSum)}, which doesn't match the team target of {money(total)}. You can still save, but figures won't add up.</p>
      )}
      <input type="hidden" name="distribution" value={distribution} />

      <div className="modal-actions">
        <button type="button" className="quiet-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-action" disabled={selected.size === 0}>Assign Target</button>
      </div>
    </form>
  );
}