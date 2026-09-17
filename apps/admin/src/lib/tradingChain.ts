// FILE: admin/src/lib/tradingChain.ts
// The backbone for Commission, Profitability, Compliance and Trade Finance.
//
// Those four modules are the *consumers* of the Trading chain, not new
// sources of data. Every figure they need already exists somewhere:
//
//   Deal -> Sales Order -> Shipment -> Logistics -> Import/Export
//        -> Customs -> Trade Documents -> Trade Finance / Collections
//
// This file resolves that whole chain from any single anchor (a deal
// number, an order number or a shipment number) and hands back one object
// the pages read from. Same convention as priceListLookup.ts and
// currencyLookup.ts: one shared function the module configs call, never
// duplicated per page, and always best-effort — a failed fetch leaves the
// user's own figures alone rather than blocking a save.
//
// Nothing here ever invents a value. A cost that isn't recorded anywhere
// comes back as `null`, and the pages render that as "Not recorded".
import { api } from './api';

export type ChainRow = Record<string, unknown> & { id?: string };

/** Every Trading resource this chain reads. Keys mirror the module names. */
export interface ChainTables {
  deals: ChainRow[];
  orders: ChainRow[];
  enquiries: ChainRow[];
  shipments: ChainRow[];
  logistics: ChainRow[];
  importExport: ChainRow[];
  customs: ChainRow[];
  documents: ChainRow[];
  claims: ChainRow[];
  commissions: ChainRow[];
  finance: ChainRow[];
  collections: ChainRow[];
}

const EMPTY_TABLES: ChainTables = {
  deals: [], orders: [], enquiries: [], shipments: [], logistics: [],
  importExport: [], customs: [], documents: [], claims: [],
  commissions: [], finance: [], collections: [],
};

const SOURCES: Array<[keyof ChainTables, string]> = [
  ['deals', '/trading/deals'],
  ['orders', '/trading/sales-orders'],
  ['enquiries', '/trading/purchase-enquiries'],
  ['shipments', '/trading/shipments'],
  ['logistics', '/trading/logistics'],
  ['importExport', '/trading/import-export'],
  ['customs', '/trading/customs'],
  ['documents', '/trading/documents'],
  ['claims', '/trading/claims'],
  ['commissions', '/trading/commissions'],
  ['finance', '/trading/trade-finance'],
  // Existing Collections/payment records — read, never written to from
  // here. The spec is explicit that Trade Finance must not become a
  // second Collections system.
  ['collections', '/collections'],
];

let cache: { key: string; at: number; tables: ChainTables } | null = null;
const CACHE_MS = 30_000;

/** Call after any write that the chain should see immediately. */
export function invalidateTradingChain(): void {
  cache = null;
}

/**
 * Fetches every module in the chain once, in parallel. Industry scoping is
 * applied the same way the LinkedRecords panel does it: the query param is
 * passed when the caller knows the active industry, and the API enforces
 * the lock server-side regardless.
 */
export async function loadTradingTables(industryTypeId?: string | null, force = false): Promise<ChainTables> {
  const key = industryTypeId ?? 'all';
  if (!force && cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.tables;

  const query = industryTypeId ? `?industryTypeId=${industryTypeId}` : '';
  const results = await Promise.all(
    SOURCES.map(([, resource]) =>
      api<{ data: ChainRow[] }>(`${resource}${query}`)
        .then((res) => res.data ?? [])
        // One missing module must not blank the whole chain — an org that
        // hasn't started using Import/Export yet still gets profitability.
        .catch(() => [] as ChainRow[]),
    ),
  );

  const tables = { ...EMPTY_TABLES };
  SOURCES.forEach(([name], i) => { (tables as Record<string, ChainRow[]>)[name as string] = results[i]; });
  cache = { key, at: Date.now(), tables };
  return tables;
}

// ---------------------------------------------------------------------------
// Chain resolution
// ---------------------------------------------------------------------------

export interface ChainAnchor {
  deal_number?: string;
  order_number?: string;
  shipment_number?: string;
}

export interface TradingChain {
  anchor: ChainAnchor;
  deal?: ChainRow;
  order?: ChainRow;
  enquiry?: ChainRow;
  shipments: ChainRow[];
  logistics: ChainRow[];
  importExport: ChainRow[];
  customs: ChainRow[];
  documents: ChainRow[];
  claims: ChainRow[];
  commissions: ChainRow[];
  finance: ChainRow[];
  collections: ChainRow[];
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const eq = (a: unknown, b: string): boolean => Boolean(b) && str(a) === b;

/**
 * Resolves the chain outward from whichever anchor the caller has.
 * Given only a shipment we walk back to its deal; given only a deal we walk
 * forward to everything raised against it.
 */
export function buildChain(tables: ChainTables, anchor: ChainAnchor): TradingChain {
  let dealNumber = str(anchor.deal_number);
  let orderNumber = str(anchor.order_number);
  const shipmentNumber = str(anchor.shipment_number);

  // Walk backwards first, so a shipment-anchored call still finds the deal.
  if (!dealNumber && shipmentNumber) {
    const shipment = tables.shipments.find((s) => eq(s.shipment_number, shipmentNumber));
    dealNumber = str(shipment?.deal_number);
  }
  if (!dealNumber && orderNumber) {
    const order = tables.orders.find((o) => eq(o.order_number, orderNumber));
    dealNumber = str(order?.deal_number);
  }

  const deal = dealNumber ? tables.deals.find((d) => eq(d.deal_number, dealNumber)) : undefined;
  if (!orderNumber) {
    orderNumber = str(deal?.order_number)
      || str(tables.orders.find((o) => eq(o.deal_number, dealNumber))?.order_number);
  }
  const order = orderNumber ? tables.orders.find((o) => eq(o.order_number, orderNumber)) : undefined;
  const enquiry = dealNumber ? tables.enquiries.find((e) => eq(e.deal_number, dealNumber)) : undefined;

  // Shipments: the named one when the caller anchored on a shipment,
  // otherwise every shipment raised against the deal.
  const shipments = shipmentNumber
    ? tables.shipments.filter((s) => eq(s.shipment_number, shipmentNumber))
    : tables.shipments.filter((s) => eq(s.deal_number, dealNumber));
  const shipmentNumbers = new Set(shipments.map((s) => str(s.shipment_number)).filter(Boolean));

  const byShipmentOrDeal = (rows: ChainRow[]) =>
    rows.filter((r) => shipmentNumbers.has(str(r.shipment_number)) || (dealNumber && eq(r.deal_number, dealNumber)));

  const customerName = str(deal?.customer_name ?? order?.customer_name);

  return {
    anchor,
    deal,
    order,
    enquiry,
    shipments,
    logistics: byShipmentOrDeal(tables.logistics),
    importExport: byShipmentOrDeal(tables.importExport),
    customs: tables.customs.filter((c) => shipmentNumbers.has(str(c.shipment_number))
      || tables.importExport.some((t) => eq(t.transaction_number, str(c.transaction_number)) && eq(t.deal_number, dealNumber))),
    documents: byShipmentOrDeal(tables.documents),
    claims: byShipmentOrDeal(tables.claims),
    commissions: dealNumber ? tables.commissions.filter((c) => eq(c.deal_number, dealNumber)) : [],
    finance: byShipmentOrDeal(tables.finance),
    // Collections have no trading order link, so they're matched on the
    // customer — enough to answer "has this customer paid", without
    // pretending a per-order link exists that the schema doesn't have.
    collections: customerName
      ? tables.collections.filter((c) => {
        const client = (c.clients as Record<string, unknown> | undefined) ?? {};
        return eq(client.client_name, customerName) || eq(c.client_name, customerName);
      })
      : [],
  };
}

export async function loadChain(anchor: ChainAnchor, industryTypeId?: string | null): Promise<TradingChain> {
  const tables = await loadTradingTables(industryTypeId);
  return buildChain(tables, anchor);
}

// ---------------------------------------------------------------------------
// Financial rollup
// ---------------------------------------------------------------------------

export const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const sum = (rows: ChainRow[], key: string): number | null => {
  const values = rows.map((r) => num(r[key])).filter((n): n is number => n != null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};

export interface CostLine {
  key: string;
  label: string;
  /** null means genuinely not recorded anywhere — never shown as zero. */
  amount: number | null;
  /** which module the figure came from, shown in the breakdown panel */
  source: string;
}

export interface ChainFinancials {
  currency: string;
  quantity: number | null;
  revenue: number | null;
  revenueSource: string;
  purchaseCost: number | null;
  purchaseSource: string;
  lines: CostLine[];
  /** direct product cost only */
  grossProfit: number | null;
  grossMargin: number | null;
  /** every recorded cost, including trade expenses and commission */
  totalCost: number | null;
  netProfit: number | null;
  netMargin: number | null;
  /** labels of costs with no source record — surfaced, not zero-filled */
  notRecorded: string[];
}

/** Commission only counts against profit once it is actually owed. */
export const EARNED_COMMISSION_STATUSES = ['Eligible', 'Approved', 'Payable', 'Paid'];

/**
 * Turns a resolved chain into the profitability figures. Every number comes
 * from a real record; anything with no source stays null so the UI can say
 * "not recorded" instead of quietly treating a missing freight invoice as
 * free freight.
 */
export function chainFinancials(chain: TradingChain): ChainFinancials {
  const { deal, order, enquiry } = chain;
  const currency = str(deal?.currency ?? order?.currency ?? enquiry?.currency) || 'INR';
  const quantity = num(order?.quantity) ?? num(deal?.quantity);

  // Revenue: the order is the committed figure, the deal the expected one.
  let revenue = num(order?.total_amount);
  let revenueSource = 'Sales Order · total amount';
  if (revenue == null && order) {
    const q = num(order.quantity);
    const rate = num(order.selling_rate);
    if (q != null && rate != null) { revenue = q * rate; revenueSource = 'Sales Order · qty x rate'; }
  }
  if (revenue == null && deal) {
    const q = num(deal.quantity);
    const rate = num(deal.selling_rate);
    if (q != null && rate != null) { revenue = q * rate; revenueSource = 'Deal · qty x selling rate'; }
  }
  if (revenue == null) revenueSource = '';

  // Direct product cost.
  let purchaseCost: number | null = null;
  let purchaseSource = '';
  if (deal) {
    const q = num(deal.quantity);
    const rate = num(deal.purchase_rate);
    if (q != null && rate != null) { purchaseCost = q * rate; purchaseSource = 'Deal · qty x purchase rate'; }
  }
  if (purchaseCost == null && enquiry) {
    const q = num(enquiry.quantity);
    const rate = num(enquiry.requested_rate);
    if (q != null && rate != null) { purchaseCost = q * rate; purchaseSource = 'Purchase Enquiry · requested rate'; }
  }

  // Freight: Logistics owns movement cost. Shipment's own freight_cost is
  // only the fallback for a shipment with no logistics record, so the same
  // freight is never counted twice.
  const logisticsFreight = sum(chain.logistics, 'freight_cost');
  const freight = logisticsFreight ?? sum(chain.shipments, 'freight_cost');
  const freightSource = logisticsFreight != null ? 'Logistics · freight charges' : (freight != null ? 'Shipment · freight cost' : '');

  const customsDuty = sum(chain.customs, 'customs_duty');
  const customsCharges = sum(chain.customs, 'other_charges');
  const logisticsOther = sum(chain.logistics, 'other_charges');

  const earnedCommission = chain.commissions.filter((c) => EARNED_COMMISSION_STATUSES.includes(str(c.status)));
  const commission = sum(earnedCommission, 'commission_amount');

  const financeCharges = sum(chain.finance, 'finance_charges');

  const lines: CostLine[] = [
    { key: 'purchase_cost', label: 'Purchase / product cost', amount: purchaseCost, source: purchaseSource },
    { key: 'freight', label: 'Freight / logistics', amount: freight, source: freightSource },
    { key: 'customs_duty', label: 'Customs duty', amount: customsDuty, source: customsDuty != null ? 'Customs & Clearance' : '' },
    { key: 'port_charges', label: 'Port / clearance charges', amount: customsCharges, source: customsCharges != null ? 'Customs & Clearance · other charges' : '' },
    { key: 'insurance', label: 'Insurance', amount: null, source: '' },
    { key: 'other_costs', label: 'Other trade costs', amount: logisticsOther, source: logisticsOther != null ? 'Logistics · other charges' : '' },
    { key: 'finance_charges', label: 'Trade finance charges', amount: financeCharges, source: financeCharges != null ? 'Trade Finance' : '' },
    { key: 'commission', label: 'Commission', amount: commission, source: commission != null ? 'Commission Management · earned' : '' },
  ];

  const recorded = lines.map((l) => l.amount).filter((n): n is number => n != null);
  const totalCost = recorded.length ? recorded.reduce((a, b) => a + b, 0) : null;

  const grossProfit = revenue != null && purchaseCost != null ? revenue - purchaseCost : null;
  const grossMargin = grossProfit != null && revenue ? (grossProfit / revenue) * 100 : null;
  const netProfit = revenue != null && totalCost != null ? revenue - totalCost : null;
  const netMargin = netProfit != null && revenue ? (netProfit / revenue) * 100 : null;

  return {
    currency,
    quantity,
    revenue,
    revenueSource,
    purchaseCost,
    purchaseSource,
    lines,
    grossProfit,
    grossMargin,
    totalCost,
    netProfit,
    netMargin,
    notRecorded: lines.filter((l) => l.amount == null).map((l) => l.label),
  };
}

// ---------------------------------------------------------------------------
// Chain status — used by Commission eligibility and Compliance
// ---------------------------------------------------------------------------

export const DELIVERED_STATUSES = ['Delivered', 'Completed'];
export const PAID_FINANCE_STATUSES = ['Paid', 'Closed'];

export interface ChainStatus {
  dealStatus: string;
  orderStatus: string;
  /** Delivered / In Transit / Not shipped */
  deliveryStatus: string;
  delivered: boolean;
  /** Paid / Partially Paid / Pending — read from Trade Finance + Collections */
  paymentStatus: string;
  paid: boolean;
  collectedAmount: number | null;
  invoiceNumber: string;
}

export function chainStatus(chain: TradingChain): ChainStatus {
  const dealStatus = str(chain.deal?.status);
  const orderStatus = str(chain.order?.status);

  const shipmentStatuses = chain.shipments.map((s) => str(s.status));
  const logisticsStatuses = chain.logistics.map((l) => str(l.status));
  const allMovement = [...shipmentStatuses, ...logisticsStatuses];
  const delivered = allMovement.length > 0 && allMovement.every((s) => DELIVERED_STATUSES.includes(s) || s === '');
  const deliveryStatus = allMovement.length === 0
    ? 'Not shipped'
    : delivered ? 'Delivered'
      : allMovement.some((s) => ['In Transit', 'Dispatched', 'Out for Delivery', 'At Destination'].includes(s)) ? 'In Transit'
        : allMovement.some((s) => s === 'Delayed') ? 'Delayed' : 'Planned';

  const financePaid = chain.finance.length > 0
    && chain.finance.every((f) => PAID_FINANCE_STATUSES.includes(str(f.status)) || str(f.payment_status) === 'Paid');
  const collectedAmount = sum(chain.collections, 'amount');
  const financials = chainFinancials(chain);
  const fullyCollected = collectedAmount != null && financials.revenue != null
    && collectedAmount + 0.00001 >= financials.revenue;

  const paid = financePaid || fullyCollected;
  const paymentStatus = paid
    ? 'Paid'
    : collectedAmount != null && collectedAmount > 0 ? 'Partially Paid'
      : chain.finance.some((f) => str(f.status) === 'Payment Pending') ? 'Payment Pending' : 'Pending';

  const invoice = chain.documents.find((d) => str(d.document_type).includes('Invoice'));

  return {
    dealStatus,
    orderStatus,
    deliveryStatus,
    delivered,
    paymentStatus,
    paid,
    collectedAmount,
    invoiceNumber: str(invoice?.document_number),
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** The one place "not recorded" is worded, so every module says it the same way. */
export function money(amount: number | null | undefined, currency = ''): string {
  if (amount == null) return 'Not recorded';
  return `${currency ? `${currency} ` : ''}${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function percent(value: number | null | undefined): string {
  if (value == null) return 'Not recorded';
  return `${value.toFixed(2)}%`;
}

/** Flattens a chain into form values, for a lookup field's onLookupChange. */
export function chainFormValues(chain: TradingChain): Record<string, string> {
  const { deal, order } = chain;
  const financials = chainFinancials(chain);
  const status = chainStatus(chain);
  const shipment = chain.shipments[0];
  const trade = chain.importExport[0];

  const out: Record<string, string> = {};
  const put = (key: string, value: unknown) => { if (value != null && value !== '') out[key] = String(value); };

  put('deal_number', deal?.deal_number);
  put('order_number', order?.order_number ?? deal?.order_number);
  put('customer_name', deal?.customer_name ?? order?.customer_name);
  put('supplier_name', deal?.supplier_name);
  put('product_name', deal?.product_name ?? order?.product_name);
  put('quantity', financials.quantity);
  put('unit', deal?.unit ?? order?.unit);
  put('currency', financials.currency);
  put('sales_rep', deal?.sales_rep);
  put('shipment_number', shipment?.shipment_number);
  put('transaction_number', trade?.transaction_number);
  put('payment_terms', deal?.payment_terms ?? order?.payment_terms);
  put('invoice_number', status.invoiceNumber);
  put('delivery_status', status.deliveryStatus);
  put('payment_status', status.paymentStatus);
  return out;
}