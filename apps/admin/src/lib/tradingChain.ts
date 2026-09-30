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
    // Step 4 of the Trading connectivity plan: Collections are recorded
    // against the core sales order, and that order's number is now saved
    // on the Deal (core_order_number) the moment the quotation is
    // approved. Match on that real link first; only deals approved before
    // this change (no core_order_number saved yet) fall back to the old
    // customer-name guess.
    collections: (() => {
      const coreOrderNumber = str(deal?.core_order_number);
      if (coreOrderNumber) {
        return tables.collections.filter((c) => {
          const order = (c.sale_orders as Record<string, unknown> | undefined) ?? {};
          return eq(order.order_number, coreOrderNumber);
        });
      }
      return customerName
        ? tables.collections.filter((c) => {
          const client = (c.clients as Record<string, unknown> | undefined) ?? {};
          return eq(client.client_name, customerName) || eq(c.client_name, customerName);
        })
        : [];
    })(),   
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

/**
 * Sum of `key` over rows that may each be saved in a DIFFERENT currency, returned in `currency`.
 * Logistics and Customs rows keep the currency they were paid in plus the rate used and the company currency, so a
 * USD 5,000 freight on an INR deal is counted as INR 4,82,500 - not as INR 5,000. A row with no usable rate keeps
 * its amount as entered (a number is never invented). Same rule as the API's profit snapshot (currency-sum.ts).
 */
const sumInCurrency = (rows: ChainRow[], key: string, currency: string): number | null => {
  const parts = rows
    .map((r) => {
      const value = num(r[key]);
      if (value == null) return null;
      const own = str(r.currency).trim();
      if (!own || own === currency) return value;
      const rate = num(r.exchange_rate);
      if (rate != null && rate > 0 && str(r.base_currency).trim() === currency) {
        // Freight also stores its converted value (base_value); the Logistics page shows it, so use it (same as the API).
        const base = key === 'freight_cost' ? num(r.base_value) : null;
        return base != null && base > 0 ? base : value * rate;
      }
      return value;
    })
    .filter((n): n is number => n != null);
  return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100 : null;
};

/**
 * Customs duty and port charges are levied in the COMPANY currency (the Customs page shows them that way), so they are
 * never multiplied by the record's own exchange rate. They only move into the deal's currency when that is not the
 * company currency, using the rate stored on the same customs record. Same rule as the API's profit snapshot.
 */
const sumCompanyCurrency = (rows: ChainRow[], key: string, currency: string): number | null => {
  const parts = rows
    .map((r) => {
      const value = num(r[key]);
      if (value == null) return null;
      const base = str(r.base_currency).trim();
      if (!base || base === currency) return value;
      const rate = num(r.exchange_rate);
      return str(r.currency).trim() === currency && rate != null && rate > 0 ? value / rate : value;
    })
    .filter((n): n is number => n != null);
  return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100 : null;
};

export interface CostLine {
  key: string;
  label: string;
  /** null means genuinely not recorded anywhere — never shown as zero. */
  amount: number | null;
  /** which module the figure came from, shown in the breakdown panel */
  source: string;
  /** Set (with the reason) when this cost can never exist for this deal - it is then not counted as missing. */
  na?: string;
}

/** The one place the stored "Cost sources" text is written, so the API, Recalculate and the form all agree. */
export function formatCostSources(lines: CostLine[]): string {
  return lines
    .map((l) => `${l.label}: ${l.amount == null ? (l.na ? `not applicable (${l.na})` : 'not recorded') : `${l.amount} (${l.source})`}`)
    .join('\n');
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

/** Cost line label -> key, so a stored "Cost sources" text can be read back (which lines were "not applicable"). */
export const COST_KEY_BY_LABEL: Record<string, string> = {
  'Purchase / product cost': 'purchase_cost', 'Freight / logistics': 'freight', 'Customs duty': 'customs_duty',
  'Port / clearance charges': 'port_charges', 'Insurance': 'insurance', 'Other trade costs': 'other_costs',
  'Trade finance charges': 'finance_charges', 'Commission': 'commission',
};

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
   // Revenue is ex-tax: the order's total_amount is tax-inclusive, so use qty x rate less discount first.
  const revQty = num(order?.quantity) ?? num(deal?.customer_quantity) ?? num(deal?.quantity);
  const revRate = num(order?.selling_rate) ?? num(deal?.selling_rate);
  const revDiscount = num(deal?.discount_percent) ?? 0;
  let revenue: number | null = revQty != null && revRate != null ? revQty * revRate * (1 - revDiscount / 100) : null;
  let revenueSource = revenue != null ? 'Sales Order · qty x rate (excl. tax)' : '';
  if (revenue == null) { revenue = num(order?.total_amount); revenueSource = 'Sales Order · total amount'; }
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
     const soldQty = num(deal.customer_quantity);
    const q = soldQty != null && soldQty > 0 ? soldQty : num(deal.quantity);
    const rate = num(deal.purchase_rate);
    const supplierDiscount = num(deal.purchase_discount_percent) ?? 0;
    if (q != null && rate != null) { purchaseCost = q * rate * (1 - supplierDiscount / 100); purchaseSource = supplierDiscount ? `Deal · qty x purchase rate less ${supplierDiscount}% supplier discount` : 'Deal · qty x purchase rate'; }
  }
  if (purchaseCost == null && enquiry) {
    const q = num(enquiry.quantity);
    const rate = num(enquiry.requested_rate);
    const enquiryDiscount = num(enquiry.discount_percent) ?? 0;
    if (q != null && rate != null) { purchaseCost = q * rate * (1 - enquiryDiscount / 100); purchaseSource = enquiryDiscount ? `Purchase Enquiry · requested rate less ${enquiryDiscount}% supplier discount` : 'Purchase Enquiry · requested rate'; }
  }

  // Freight: Logistics owns movement cost. Shipment's own freight_cost is
  // only the fallback for a shipment with no logistics record, so the same
  // freight is never counted twice.
  const logisticsFreight = sumInCurrency(chain.logistics, 'freight_cost', currency);
  const freight = logisticsFreight ?? sum(chain.shipments, 'freight_cost');
  const freightSource = logisticsFreight != null ? `Logistics · freight charges (in ${currency})` : (freight != null ? 'Shipment · freight cost' : '');

  const customsDuty = sumCompanyCurrency(chain.customs, 'customs_duty', currency);
  const customsCharges = sumCompanyCurrency(chain.customs, 'other_charges', currency);
  const logisticsOther = sumInCurrency(chain.logistics, 'other_charges', currency);

  const earnedCommission = chain.commissions.filter((c) => EARNED_COMMISSION_STATUSES.includes(str(c.status)));
  const commission = sum(earnedCommission, 'commission_amount');

  const financeCharges = sum(chain.finance, 'finance_charges');

  // "Not applicable": a cost that can never exist for this deal is not counted as missing.
  // Same rules and wording as syncProfitabilitySnapshot() in the API's trading.repository.ts.
  const isTradeDeal = chain.importExport.length > 0 || chain.customs.length > 0;
  const naTrade = isTradeDeal ? undefined : 'domestic deal, no import/export or customs record';
  const naFinance = chain.finance.length > 0 ? undefined : 'no trade finance record';
  const naCommission = chain.commissions.length > 0 || str(deal?.sales_rep).trim() ? undefined : 'no commission record or sales rep';

  const lines: CostLine[] = [
    { key: 'purchase_cost', label: 'Purchase / product cost', amount: purchaseCost, source: purchaseSource },
    { key: 'freight', label: 'Freight / logistics', amount: freight, source: freightSource },
    { key: 'customs_duty', label: 'Customs duty', amount: customsDuty, source: customsDuty != null ? 'Customs & Clearance' : '', na: customsDuty == null ? naTrade : undefined },
    { key: 'port_charges', label: 'Port / clearance charges', amount: customsCharges, source: customsCharges != null ? 'Customs & Clearance · other charges' : '', na: customsCharges == null ? naTrade : undefined },
    { key: 'insurance', label: 'Insurance', amount: null, source: '', na: 'optional, not entered' },
    { key: 'other_costs', label: 'Other trade costs', amount: logisticsOther, source: logisticsOther != null ? `Logistics · other charges (in ${currency})` : '', na: logisticsOther == null ? 'optional, none entered' : undefined },
    { key: 'finance_charges', label: 'Trade finance charges', amount: financeCharges, source: financeCharges != null ? 'Trade Finance' : '', na: financeCharges == null ? naFinance : undefined },
    { key: 'commission', label: 'Commission', amount: commission, source: commission != null ? 'Commission Management · earned' : '', na: commission == null ? naCommission : undefined },
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
    notRecorded: lines.filter((l) => l.amount == null && !l.na).map((l) => l.label),
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