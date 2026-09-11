import type { IndustryKey } from './types';

// ---------------------------------------------------------------------------
// Centralized DEMO/MOCK report data.
//
// This file exists ONLY so the Reports page has something realistic to show
// on screen while the backend doesn't have enough real data yet. Nothing in
// here is wired to the API — it's pure static demo content, one dataset per
// industry, all shaped through `ReportMockDataset` below.
//
// TO REMOVE LATER: delete this file, delete the `usingMockData` branch in
// ReportsPage.tsx, and the page will fall back to its existing "polished
// empty state" behaviour automatically.
// ---------------------------------------------------------------------------

export interface ReportMockKpis {
  totalSales: number;
  totalOrders: number;
  collections: number;
  outstanding: number;
  avgOrderValue: number;
  deltaSales: number;
  deltaOrders: number;
  deltaCollections: number;
  deltaOutstanding: number;
  deltaAvgOrderValue: number;
}

export interface ReportMockProduct { name: string; orders: number; revenue: number; growth: number }
export interface ReportMockClient { name: string; orders: number; sales: number; collections: number; outstanding: number; growth: number }
export interface ReportMockRep { name: string; sales: number; orders: number; visits: number; followUps: number; targetPct: number; conversionRate: number; collections: number }
export interface ReportMockTargetRow { name: string; target: number; achieved: number }
export interface ReportMockTransaction {
  date: string; orderId: string; client: string; rep: string; product: string;
  orderValue: number; collection: number; outstanding: number;
  status: 'Confirmed' | 'Paid' | 'Partial' | 'Pending';
}

export interface ReportMockDataset {
  industryLabel: string;
  kpis: ReportMockKpis;
  months: string[];
  salesTrend: number[];
  salesTrendPrevious: number[];
  collectionsTrend: number[];
  products: ReportMockProduct[];
  clients: ReportMockClient[];
  target: { overall: number; achieved: number; reps: ReportMockTargetRow[] };
  reps: ReportMockRep[];
  fieldActivity: { total: number; completed: number; pending: number; cancelled: number; weeklyTrend: number[] };
  followUps: { overdue: number; pending: number; completed: number; trend: number[]; highPriority: number; upcoming: number };
  collection: { collected: number; outstanding: number; currentMonth: number; previousMonth: number; buckets: { label: string; value: number }[] };
  transactions: ReportMockTransaction[];
}

const REP_NAMES = ['Arun Kumar', 'Priya S', 'Karthik R', 'Meena P', 'Rahul M'];
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];

// Lakh-denominated helper so the per-industry tables below read the same way the brief does.
const L = (lakhs: number) => Math.round(lakhs * 100000);

function buildDataset(opts: {
  industryLabel: string;
  clients: string[];
  products: { name: string; revenueL: number; ordersBase: number; growth: number }[];
  salesTrendL: number[]; // 6 months, in lakhs
  collectionsRatio: number; // collections as a fraction of sales, per month
  overallTargetL: number;
}): ReportMockDataset {
  const salesTrend = opts.salesTrendL.map(L);
  // Deterministic "previous period" comparison line — a fixed 16-18% shrink per
  // month, so the chart stays stable across reloads instead of re-randomizing.
  const salesTrendPrevious = salesTrend.map((v, i) => Math.round(v * (0.82 + (i % 3) * 0.01)));
  const collectionsTrend = salesTrend.map((v) => Math.round(v * opts.collectionsRatio));

  const totalSales = salesTrend[salesTrend.length - 1];
  const prevTotalSales = salesTrendPrevious[salesTrendPrevious.length - 1];
  const totalCollections = collectionsTrend[collectionsTrend.length - 1];
  const totalOrders = Math.round(totalSales / 5179);
  const outstanding = Math.max(totalSales - totalCollections, Math.round(totalSales * 0.08));
  const avgOrderValue = Math.round(totalSales / Math.max(totalOrders, 1));

  const pct = (curr: number, prev: number) => (prev ? Math.round(((curr - prev) / prev) * 1000) / 10 : 0);

  const products: ReportMockProduct[] = opts.products.map((p, i) => ({
    name: p.name,
    orders: Math.round(p.ordersBase),
    revenue: L(p.revenueL),
    growth: p.growth,
  }));

  const clients: ReportMockClient[] = opts.clients.map((name, i) => {
    const sales = L(2.84 - i * 0.32 + (i % 2) * 0.06);
    const collections = Math.round(sales * (0.78 + (i % 4) * 0.035));
    return {
      name,
      orders: Math.round(42 - i * 4.8),
      sales,
      collections,
      outstanding: Math.max(sales - collections, 0),
      growth: Math.round((14 - i * 3.4) * 10) / 10,
    };
  });

  const repTargets = [3.5, 3.0, 3.0, 2.5, 3.0];
  const repAchieved = [3.2, 2.8, 2.4, 2.1, 2.35];
  const target = {
    overall: L(opts.overallTargetL),
    achieved: totalSales,
    reps: REP_NAMES.map((name, i) => ({ name, target: L(repTargets[i]), achieved: L(repAchieved[i]) })),
  };

  const reps: ReportMockRep[] = REP_NAMES.map((name, i) => ({
    name,
    sales: L(repAchieved[i]),
    orders: Math.round(64 - i * 6),
    visits: Math.round(42 - i * 3.5),
    followUps: Math.round(18 - i * 2),
    targetPct: Math.round((repAchieved[i] / repTargets[i]) * 100),
    conversionRate: Math.round((58 - i * 4.2) * 10) / 10,
    collections: Math.round(L(repAchieved[i]) * 0.82),
  }));

  const statusCycle: ReportMockTransaction['status'][] = ['Confirmed', 'Paid', 'Partial', 'Pending'];
  const transactions: ReportMockTransaction[] = Array.from({ length: 22 }, (_, i) => {
    const client = clients[i % clients.length]?.name ?? opts.clients[0];
    const rep = REP_NAMES[i % REP_NAMES.length];
    const product = products[i % products.length]?.name ?? opts.products[0].name;
    const orderValue = Math.round(8000 + ((i * 3671) % 42000));
    const status = statusCycle[i % statusCycle.length];
    const collection = status === 'Pending' ? 0 : status === 'Partial' ? Math.round(orderValue * 0.6) : orderValue;
    const day = 3 - Math.floor(i / 2);
    const date = new Date(2026, 8, Math.max(1, day - (i % 3)));
    return {
      date: date.toISOString().slice(0, 10),
      orderId: `ORD-${1024 - i}`,
      client,
      rep,
      product,
      orderValue,
      collection,
      outstanding: Math.max(orderValue - collection, 0),
      status,
    };
  });

  return {
    industryLabel: opts.industryLabel,
    kpis: {
      totalSales,
      totalOrders,
      collections: totalCollections,
      outstanding,
      avgOrderValue,
      deltaSales: pct(totalSales, prevTotalSales),
      deltaOrders: 12.4,
      deltaCollections: 15.8,
      deltaOutstanding: -6.2,
      deltaAvgOrderValue: 4.8,
    },
    months: MONTHS,
    salesTrend,
    salesTrendPrevious,
    collectionsTrend,
    products,
    clients,
    target,
    reps,
    fieldActivity: { total: 186, completed: 154, pending: 21, cancelled: 11, weeklyTrend: [22, 26, 31, 24, 29, 34, 20] },
    followUps: { overdue: 12, pending: 38, completed: 96, trend: [8, 11, 9, 14, 12, 10, 12], highPriority: 7, upcoming: 19 },
    collection: {
      collected: totalCollections,
      outstanding,
      currentMonth: totalCollections,
      previousMonth: Math.round(totalCollections * 0.91),
      buckets: [
        { label: '0\u201330 Days', value: Math.round(outstanding * 0.46) },
        { label: '31\u201360 Days', value: Math.round(outstanding * 0.28) },
        { label: '61\u201390 Days', value: Math.round(outstanding * 0.16) },
        { label: '90+ Days', value: Math.round(outstanding * 0.1) },
      ],
    },
    transactions,
  };
}

const DATASETS: Record<IndustryKey, ReportMockDataset> = {
  fmcg: buildDataset({
    industryLabel: 'FMCG',
    clients: ['ABC Distributors', 'Sri Lakshmi Stores', 'Kumar Agencies', 'Royal Traders', 'Metro Distributors'],
    products: [
      { name: 'Shampoo', revenueL: 3.42, ordersBase: 58, growth: 12.4 },
      { name: 'Soap', revenueL: 2.85, ordersBase: 51, growth: 8.1 },
      { name: 'Detergent', revenueL: 2.31, ordersBase: 44, growth: -3.2 },
      { name: 'Biscuits', revenueL: 1.94, ordersBase: 39, growth: 5.6 },
      { name: 'Beverages', revenueL: 1.42, ordersBase: 30, growth: 9.0 },
    ],
    salesTrendL: [7.8, 8.6, 9.4, 10.2, 11.6, 12.845],
    collectionsRatio: 0.75,
    overallTargetL: 15,
  }),
  pharma: buildDataset({
    industryLabel: 'Pharma',
    clients: ['City Care Pharmacy', 'Wellness Hospital Stores', 'MedPlus Distributors', 'Sunrise Pharma Agency', 'HealthFirst Retail'],
    products: [
      { name: 'Tablets', revenueL: 3.1, ordersBase: 60, growth: 10.2 },
      { name: 'Syrups', revenueL: 2.4, ordersBase: 46, growth: 6.4 },
      { name: 'Capsules', revenueL: 2.05, ordersBase: 41, growth: -1.8 },
      { name: 'Injections', revenueL: 1.6, ordersBase: 28, growth: 4.1 },
      { name: 'OTC Products', revenueL: 1.2, ordersBase: 33, growth: 7.9 },
    ],
    salesTrendL: [6.4, 7.1, 7.9, 8.8, 9.9, 10.9],
    collectionsRatio: 0.79,
    overallTargetL: 12.5,
  }),
  school: buildDataset({
    industryLabel: 'School',
    clients: ['St. Xavier Public School', 'Green Valley International', 'National Model School', 'Bright Future Academy', 'Sunrise Matriculation'],
    products: [
      { name: 'Uniform Sets', revenueL: 2.6, ordersBase: 48, growth: 11.1 },
      { name: 'Textbooks & Kits', revenueL: 2.2, ordersBase: 40, growth: 6.7 },
      { name: 'Stationery Kits', revenueL: 1.5, ordersBase: 55, growth: 3.4 },
      { name: 'Lab Equipment', revenueL: 1.1, ordersBase: 18, growth: -2.1 },
      { name: 'Sports Gear', revenueL: 0.8, ordersBase: 22, growth: 8.8 },
    ],
    salesTrendL: [4.8, 5.3, 6.0, 6.7, 7.4, 8.2],
    collectionsRatio: 0.7,
    overallTargetL: 10,
  }),
  textile: buildDataset({
    industryLabel: 'Textile',
    clients: ['Chennai Silk House', 'Nandhini Garments', 'Coimbatore Fabric Mart', 'Uniform World', 'Sri Textiles & Co'],
    products: [
      { name: 'Cotton Fabric', revenueL: 3.0, ordersBase: 52, growth: 9.6 },
      { name: 'Polyester Fabric', revenueL: 2.3, ordersBase: 44, growth: 4.2 },
      { name: 'Shirts', revenueL: 1.9, ordersBase: 61, growth: 12.9 },
      { name: 'Sarees', revenueL: 1.6, ordersBase: 24, growth: -4.5 },
      { name: 'Uniform Material', revenueL: 1.1, ordersBase: 30, growth: 6.3 },
    ],
    salesTrendL: [6.9, 7.6, 8.3, 9.1, 10.0, 11.0],
    collectionsRatio: 0.73,
    overallTargetL: 13,
  }),
   trading: {
    industryLabel: 'Trading',
    kpis: {
      totalSales: 0,
      totalOrders: 0,
      collections: 0,
      outstanding: 0,
      avgOrderValue: 0,
      deltaSales: 0,
      deltaOrders: 0,
      deltaCollections: 0,
      deltaOutstanding: 0,
      deltaAvgOrderValue: 0,
    },
    months: MONTHS,
    salesTrend: MONTHS.map(() => 0),
    salesTrendPrevious: MONTHS.map(() => 0),
    collectionsTrend: MONTHS.map(() => 0),
    products: [],
    clients: [],
    target: { overall: 0, achieved: 0, reps: [] },
    reps: [],
    fieldActivity: { total: 0, completed: 0, pending: 0, cancelled: 0, weeklyTrend: [0, 0, 0, 0, 0, 0, 0] },
    followUps: { overdue: 0, pending: 0, completed: 0, trend: [0, 0, 0, 0, 0, 0, 0], highPriority: 0, upcoming: 0 },
    collection: {
      collected: 0,
      outstanding: 0,
      currentMonth: 0,
      previousMonth: 0,
      buckets: [
        { label: '0–30 Days', value: 0 },
        { label: '31–60 Days', value: 0 },
        { label: '61–90 Days', value: 0 },
        { label: '90+ Days', value: 0 },
      ],
    },
    transactions: [],
  },
  vehicle: buildDataset({
    industryLabel: 'Vehicle',
    clients: ['Speedway Motors', 'Royal Auto Dealers', 'City Wheels Showroom', 'Highway Auto Care', 'Prime Vehicle Traders'],
    products: [
      { name: 'Two-Wheeler Sales', revenueL: 4.2, ordersBase: 22, growth: 10.8 },
      { name: 'Spare Parts', revenueL: 2.0, ordersBase: 65, growth: 6.1 },
      { name: 'Service Packages', revenueL: 1.6, ordersBase: 48, growth: 8.4 },
      { name: 'Accessories', revenueL: 1.1, ordersBase: 40, growth: 3.0 },
      { name: 'Extended Warranty', revenueL: 0.7, ordersBase: 15, growth: -2.6 },
    ],
    salesTrendL: [7.0, 7.8, 8.7, 9.6, 10.8, 12.0],
    collectionsRatio: 0.77,
    overallTargetL: 14,
  }),
};

/** Returns the demo dataset for an industry. Pure/static — no side effects. */
export function getReportMockData(industry: IndustryKey): ReportMockDataset {
  return DATASETS[industry];
}
