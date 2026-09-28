import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import type { TradingResource } from '../lib/trading-resources.js';
import { resolveIndustryTypeId, assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { logger } from '../lib/logger.js';
import { sendPurchaseEnquiryEmail } from '../services/purchase-enquiry-email.service.js';

const fail = (error: unknown): never => { throw error; };

// Step 2 of the Trading connectivity plan: a Shipment's status flows
// forward to its Sales Order and back to its Deal. Keyed by shipment
// status; each entry says what the order (and optionally the deal)
// should become. Planned / Delayed / Cancelled are deliberately absent —
// they cause no change downstream.
const SHIPMENT_STATUS_CASCADE: Record<string, { order: string; deal?: string }> = {
  'Ready to Ship': { order: 'Ready to Ship' },
  'Dispatched': { order: 'Shipped', deal: 'In Progress' },
  'In Transit': { order: 'Shipped', deal: 'In Progress' },
  'At Destination': { order: 'Shipped', deal: 'In Progress' },
  'Delivered': { order: 'Completed', deal: 'Completed' },
};

// Never throws — a cascade problem must not block the shipment save
// itself (same convention as runTradingChain in quotations.repository.ts).
async function cascadeShipmentStatus(org: string, shipment: Record<string, unknown>) {
  try {
    const status = typeof shipment.status === 'string' ? shipment.status : undefined;
    const mapping = status ? SHIPMENT_STATUS_CASCADE[status] : undefined;
    if (!mapping) return;
    const orderNumber = typeof shipment.order_number === 'string' ? shipment.order_number : undefined;
    const dealNumber = typeof shipment.deal_number === 'string' ? shipment.deal_number : undefined;
    if (orderNumber) {
      const { error } = await supabaseAdmin.from('trading_sales_orders').update({ status: mapping.order }).eq('organization_id', org).eq('order_number', orderNumber);
      if (error) throw error;
    }
    if (mapping.deal && dealNumber) {
      const { error } = await supabaseAdmin.from('trading_deals').update({ status: mapping.deal }).eq('organization_id', org).eq('deal_number', dealNumber);
      if (!error && mapping.deal === 'Completed') await autoCreateProfitabilitySnapshot(org, dealNumber, true);      if (error) throw error;
    }
  } catch (error) {
    logger.error({ err: error, shipmentNumber: shipment.shipment_number }, 'Shipment status cascade to order/deal failed');
  }
}

// Step 3 of the Trading connectivity plan: once a Shipment is packed and
// ready to leave (or any later stage — a skipped status must not skip
// creation), the paperwork that should already exist before goods move
// is created automatically. Same field mapping as the manual "Generate
// document" button (buildDraftFromShipment in tradeDocumentHandoff.ts),
// so an automatic document looks identical to a hand-created one.
const DOCUMENT_TRIGGER_STATUSES = new Set(['Ready to Ship', 'Dispatched', 'In Transit', 'At Destination', 'Delivered']);
const DOCUMENT_TYPE_PREFIX: Record<string, string> = {
  'Packing List': 'PL',
  'Commercial Invoice': 'CI',
};

async function autoCreateShipmentDocuments(org: string, shipment: Record<string, unknown>) {
  try {
    const shipmentNumber = typeof shipment.shipment_number === 'string' ? shipment.shipment_number : undefined;
    if (!shipmentNumber) return;
    const types = Object.keys(DOCUMENT_TYPE_PREFIX);
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('trading_documents').select('document_type')
      .eq('organization_id', org).eq('shipment_number', shipmentNumber).in('document_type', types);
    if (existingError) throw existingError;
    const already = new Set((existing ?? []).map((d) => d.document_type as string));
    const suffix = shipmentNumber.replace(/^SHP-/, '');
    const today = new Date().toISOString().slice(0, 10);
    for (const type of types) {
      if (already.has(type)) continue;
      const code = `${DOCUMENT_TYPE_PREFIX[type]}-${suffix}`;
      const { error } = await supabaseAdmin.from('trading_documents').insert({
        organization_id: org,
        industry_type_id: shipment.industry_type_id ?? null,
        document_id: code,
        document_number: code,
        document_type: type,
        shipment_number: shipmentNumber,
        deal_number: shipment.deal_number ?? null,
        customer_name: shipment.customer_name ?? null,
        supplier_name: shipment.supplier_name ?? null,
        product_name: shipment.product_name ?? null,
        reference_number: shipmentNumber,
        quantity: shipment.quantity ?? null,
        unit: shipment.unit ?? null,
        expected_delivery_date: shipment.expected_delivery_date ?? null,
        shipping_mode: shipment.shipping_mode ?? null,
        transporter: shipment.transporter ?? null,
        tracking_number: shipment.tracking_number ?? null,
        issue_date: today,
        status: 'Draft',
        generated_from: 'shipment',
        notes: `Automatically created from shipment ${shipmentNumber}.`,
      });
      if (error && error.code !== '23505') throw error;
    }
  } catch (error) {
    logger.error({ err: error, shipmentNumber: shipment.shipment_number }, 'Automatic trade document creation failed');
  }
}

// Logistics tracks movement that has actually started, so it's only
// created once the shipment has left (Dispatched or later).
const LOGISTICS_TRIGGER_STATUSES = new Set(['Dispatched', 'In Transit', 'At Destination', 'Delivered']);

async function autoCreateShipmentLogistics(org: string, shipment: Record<string, unknown>) {
  try {
    const shipmentNumber = typeof shipment.shipment_number === 'string' ? shipment.shipment_number : undefined;
    if (!shipmentNumber) return;
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('trading_logistics').select('id')
      .eq('organization_id', org).eq('shipment_number', shipmentNumber).limit(1).maybeSingle();
    if (existingError) throw existingError;
       if (existing) {
      if (shipment.status === 'Delivered') {
        await supabaseAdmin.from('trading_logistics')
          .update({ status: 'Delivered', actual_delivery_date: shipment.actual_delivery_date ?? new Date().toISOString().slice(0, 10) })
          .eq('organization_id', org).eq('shipment_number', shipmentNumber).neq('status', 'Delivered');
      }
      return;
    }
    const suffix = shipmentNumber.replace(/^SHP-/, '');
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabaseAdmin.from('trading_logistics').insert({
      organization_id: org,
      industry_type_id: shipment.industry_type_id ?? null,
      logistics_number: `LOG-${suffix}`,
      shipment_number: shipmentNumber,
      deal_number: shipment.deal_number ?? null,
      customer_name: shipment.customer_name ?? null,
      supplier_name: shipment.supplier_name ?? null,
      product_name: shipment.product_name ?? null,
      quantity: shipment.quantity ?? null,
      unit: shipment.unit ?? null,
      origin: shipment.origin ?? null,
      destination: shipment.destination ?? null,
      carrier: shipment.transporter ?? null,
      shipping_mode: shipment.shipping_mode ?? null,
      tracking_number: shipment.tracking_number ?? null,
      vehicle_container_number: shipment.vehicle_container_number ?? null,
      estimated_arrival_date: shipment.expected_delivery_date ?? null,
      actual_departure_date: today,
      freight_cost: shipment.freight_cost ?? null,
      status: shipment.status === 'Delivered' ? 'Delivered' : 'Dispatched',
      actual_delivery_date: shipment.status === 'Delivered' ? (shipment.actual_delivery_date ?? today) : null,
      notes: `Automatically created from shipment ${shipmentNumber}.`,
    });
// NEW
    if (error && error.code !== '23505') throw error;
  } catch (error) {
    logger.error({ err: error, shipmentNumber: shipment.shipment_number }, 'Automatic logistics creation failed');
  }
}

// Goods physically arrive when a shipment reaches "Delivered" — that's
// the moment stock should increase, matched to the product by name.
// Only ever called on the actual transition INTO Delivered (see the
// previousStatus check in updateTradingRecord below), so re-saving an
// already-delivered shipment can never double-count the stock.
async function autoUpdateInventoryOnDelivery(org: string, shipment: Record<string, unknown>) {
  try {
    const productName = typeof shipment.product_name === 'string' ? shipment.product_name.trim() : '';
    if (!productName) return;
    const quantity = Number(shipment.quantity) || 0;
    if (quantity <= 0) return;
    const { data: product, error: productError } = await supabaseAdmin
      .from('products').select('id, stock_quantity')
      .eq('organization_id', org).ilike('product_name', productName).limit(1).maybeSingle();
    if (productError) throw productError;
    if (!product) return; // no matching product in the catalog — nothing to update
    // 'outbound' = goods leaving to a customer (from a Sales Order) —
    // stock goes down. Anything else ('inbound', or missing on an older
    // row) = goods arriving from a supplier — stock goes up, same as before.
    const direction = typeof shipment.direction === 'string' ? shipment.direction : 'inbound';
    const currentStock = Number(product.stock_quantity) || 0;
    const nextStock = direction === 'outbound' ? currentStock - quantity : currentStock + quantity;
    const { error } = await supabaseAdmin.from('products').update({ stock_quantity: nextStock }).eq('id', product.id).eq('organization_id', org);
    if (error) throw error;
  } catch (error) {
    logger.error({ err: error, shipmentNumber: shipment.shipment_number }, 'Automatic inventory update on delivery failed');
  }
}
// Step 8 of the Trading connectivity plan: a Deal reaching "Confirmed" by
// ANY route — not just the automated Lead→Quotation→Deal chain — must end
// up with both a Trading Sales Order (SO-..., what the rest of Trading
// reads) and a core Sales Order (FS-..., what Collections reads). Before
// this, only quotations.repository.ts's approveQuotation() created the
// core order, so a Deal created by hand ("+ Add Deal") or converted from a
// Purchase Enquiry got a Trading SO but never an FS- order — its money
// never reached Collections. Numbers are derived from the deal number
// itself, never counted, so re-saving an already-converted Deal can never
// create a duplicate of either order.
async function convertConfirmedDealToOrders(org: string, deal: Record<string, unknown>) {
  try {
    const dealNumber = typeof deal.deal_number === 'string' ? deal.deal_number : undefined;
    if (!dealNumber) return;
    const suffix = dealNumber.replace(/^DEAL-/, '');
    const orderNumber = `SO-${suffix}`;
    // The customer only gets what they actually ordered, not the whole
    // purchased quantity — falls back to the full quantity for older
    // deals or deals that never set this (same behaviour as before).
    const quantity = Number(deal.customer_quantity ?? deal.quantity) || 0;
    const sellingRate = Number(deal.selling_rate) || 0;
    // Discount/tax come from the Price List row that filled this deal's
    // rate (see admin/src/lib/priceListLookup.ts) — previously typed into
    // the deal but never actually carried into the real order (both were
    // hardcoded to 0 below), so an "offer" never reached the customer's
    // invoice. Standard trading-CRM order: discount off the gross, then
    // tax on top of the discounted amount.
    const discountPercent = Number(deal.discount_percent) || 0;
    const taxPercent = Number(deal.tax_percent) || 0;
    const grossAmount = quantity * sellingRate;
    const discountAmount = grossAmount * (discountPercent / 100);
    const taxAmount = (grossAmount - discountAmount) * (taxPercent / 100);
    const totalAmount = grossAmount - discountAmount + taxAmount;

    const { data: existingSO } = await supabaseAdmin.from('trading_sales_orders').select('id').eq('organization_id', org).eq('order_number', orderNumber).limit(1).maybeSingle();
    if (!existingSO) {
      const { error } = await supabaseAdmin.from('trading_sales_orders').insert({
        organization_id: org,
        industry_type_id: deal.industry_type_id ?? null,
        order_number: orderNumber,
        deal_number: dealNumber,
        customer_name: deal.customer_name ?? null,
        product_name: deal.product_name ?? null,
        quantity: quantity || null,
        unit: deal.unit ?? null,
        currency: deal.currency ?? null,
        selling_rate: deal.selling_rate ?? null,
        total_amount: totalAmount || null,
        order_date: new Date().toISOString().slice(0, 10),
        expected_delivery_date: deal.expected_delivery_date ?? null,
        payment_terms: deal.payment_terms ?? null,
        delivery_terms: deal.delivery_terms ?? null,
             status: 'Confirmed',
      notes: `Automatically created from deal ${dealNumber}.`,
    });
    if (error && error.code !== '23505') throw error;
  }
  await autoCreateShipmentForConfirmedOrder(org, orderNumber, deal);

    const customerId = typeof deal.customer_id === 'string' ? deal.customer_id : undefined;
    const productName = typeof deal.product_name === 'string' ? deal.product_name : undefined;
    if (customerId && productName && !deal.core_order_number) {
      const { data: product } = await supabaseAdmin.from('products').select('id').eq('organization_id', org).eq('product_name', productName).limit(1).maybeSingle();
      if (product) {
        const coreOrderNumber = `FS-${suffix}`;
        const { data: existingCore } = await supabaseAdmin.from('sale_orders').select('id, order_number').eq('organization_id', org).eq('order_number', coreOrderNumber).limit(1).maybeSingle();
        let coreOrder = existingCore;
             if (!coreOrder) {
          // quotation_id carries through only if this Deal itself came from
          // an approved quotation (createDealFromApprovedQuotation sets it
          // on trading_deals) — same fix as convertToOrder() in
          // quotations.repository.ts, so the Orders page shows the right
          // "converted from quotation" source instead of "Manual entry"
          // whenever that link genuinely exists. A Deal built from a
          // Purchase Enquiry has no quotation_id, so this stays null there.
          const { data: inserted, error: coreError } = await supabaseAdmin.from('sale_orders').insert({
            organization_id: org,
            order_number: coreOrderNumber,
            client_id: customerId,
            representative_id: null,
            discount_amount: discountAmount,
            tax_amount: taxAmount,
            total_amount: totalAmount,
            notes: `Automatically created from Trading deal ${dealNumber}.`,
            status: 'confirmed',
            quotation_id: (deal.quotation_id as string | null | undefined) ?? null,
          }).select('id, order_number').single();
          if (coreError) throw coreError;
          coreOrder = inserted;
          const { error: itemError } = await supabaseAdmin.from('sale_order_items').insert({
            order_id: coreOrder!.id,
            product_id: product.id,
            quantity: quantity || 0,
            unit_price: deal.selling_rate ?? 0,
            discount_amount: discountAmount,
            subtotal: totalAmount,
          });
          if (itemError) throw itemError;
        }
        if (coreOrder) {
          const { error: linkError } = await supabaseAdmin.from('trading_deals').update({ core_order_id: coreOrder.id, core_order_number: coreOrder.order_number }).eq('id', deal.id).eq('organization_id', org);
          if (linkError) throw linkError;
        }
      }
    }

    if (!deal.order_number) {
      const { error } = await supabaseAdmin.from('trading_deals').update({ order_number: orderNumber }).eq('id', deal.id).eq('organization_id', org);
      if (error) throw error;
    }
  } catch (error) {
    logger.error({ err: error, dealNumber: deal.deal_number }, 'Confirmed-deal to sales order conversion failed');
  }
}
// Auto Profitability snapshot: when a Deal is Completed, save one Deal-level
// analysis row. Same formulas as chainFinancials() in admin/src/lib/tradingChain.ts.
// Missing costs stay null (never 0). Skips if a Deal-level analysis already exists.
// Never throws, so it can never block a deal / shipment save.
type Row = Record<string, unknown>;
const EARNED_COMMISSION_STATUSES = ['Eligible', 'Approved', 'Payable', 'Paid'];
const toNum = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const sumOf = (rows: Row[], key: string): number | null => {
  const values = rows.map((r) => toNum(r[key])).filter((n): n is number => n != null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};
const mergeRows = (...lists: Row[][]): Row[] => {
  const seen = new Map<string, Row>();
  for (const list of lists) for (const row of list) seen.set(String(row.id ?? `${seen.size}`), row);
  return [...seen.values()];
};

async function autoCreateProfitabilitySnapshot(org: string, dealNumber: string, requireDelivered = false) {
  try {
    const { data: already, error: alreadyError } = await supabaseAdmin.from('trading_profitability').select('id')
      .eq('organization_id', org).eq('deal_number', dealNumber).eq('analysis_level', 'Deal').limit(1).maybeSingle();
    if (alreadyError) throw alreadyError;
    if (already) return;

    const { data: deal, error: dealError } = await supabaseAdmin.from('trading_deals').select('*')
      .eq('organization_id', org).eq('deal_number', dealNumber).maybeSingle();
    if (dealError) throw dealError;
    if (!deal) return;

    const byColumn = async (table: string, column: string, values: string[]): Promise<Row[]> => {
      if (!values.length) return [];
      const { data, error } = await supabaseAdmin.from(table).select('*').eq('organization_id', org).in(column, values);
      if (error) throw error;
      return (data ?? []) as Row[];
    };

    const [orders, enquiries, shipments, tradeRows, commissions] = await Promise.all([
      byColumn('trading_sales_orders', 'deal_number', [dealNumber]),
      byColumn('trading_purchase_enquiries', 'deal_number', [dealNumber]),
      byColumn('trading_shipments', 'deal_number', [dealNumber]),
      byColumn('trading_import_export', 'deal_number', [dealNumber]),
      byColumn('trading_commissions', 'deal_number', [dealNumber]),
    ]);

    // Shipment-driven completion: wait until every shipment of the deal is delivered.
    if (requireDelivered && shipments.some((s) => !['Delivered', 'Completed', 'Cancelled'].includes(String(s.status ?? '')))) return;

    const shipmentNumbers = shipments.map((s) => String(s.shipment_number ?? '')).filter(Boolean);
    const transactionNumbers = tradeRows.map((t) => String(t.transaction_number ?? '')).filter(Boolean);
    const [logistics, finance, customs] = await Promise.all([
      Promise.all([byColumn('trading_logistics', 'deal_number', [dealNumber]), byColumn('trading_logistics', 'shipment_number', shipmentNumbers)]).then((l) => mergeRows(...l)),
      Promise.all([byColumn('trading_trade_finance', 'deal_number', [dealNumber]), byColumn('trading_trade_finance', 'shipment_number', shipmentNumbers)]).then((l) => mergeRows(...l)),
      Promise.all([byColumn('trading_customs', 'shipment_number', shipmentNumbers), byColumn('trading_customs', 'transaction_number', transactionNumbers)]).then((l) => mergeRows(...l)),
    ]);

    const dealRow = deal as Row;
    const order = orders.find((o) => o.order_number === dealRow.order_number) ?? orders[0];
    const enquiry = enquiries[0];
    const currency = String(dealRow.currency ?? order?.currency ?? enquiry?.currency ?? '') || 'INR';
    const quantity = toNum(order?.quantity) ?? toNum(dealRow.quantity);

    const revQty = toNum(order?.quantity) ?? toNum(dealRow.customer_quantity) ?? toNum(dealRow.quantity);
    const revRate = toNum(order?.selling_rate) ?? toNum(dealRow.selling_rate);
    const revDiscount = toNum(dealRow.discount_percent) ?? 0;
    let revenue: number | null = revQty != null && revRate != null ? revQty * revRate * (1 - revDiscount / 100) : null;
    let revenueSource = revenue != null ? 'Sales Order · qty x rate (excl. tax)' : '';
    if (revenue == null) { revenue = toNum(order?.total_amount); revenueSource = 'Sales Order · total amount'; }
    if (revenue == null && order) {
      const q = toNum(order.quantity); const rate = toNum(order.selling_rate);
      if (q != null && rate != null) { revenue = q * rate; revenueSource = 'Sales Order · qty x rate'; }
    }
    if (revenue == null) {
      const q = toNum(dealRow.quantity); const rate = toNum(dealRow.selling_rate);
      if (q != null && rate != null) { revenue = q * rate; revenueSource = 'Deal · qty x selling rate'; }
    }
    if (revenue == null) revenueSource = '';

    let purchaseCost: number | null = null;
    let purchaseSource = '';
    {
      const q = toNum(dealRow.quantity); const rate = toNum(dealRow.purchase_rate);
      if (q != null && rate != null) { purchaseCost = q * rate; purchaseSource = 'Deal · qty x purchase rate'; }
    }
    if (purchaseCost == null && enquiry) {
      const q = toNum(enquiry.quantity); const rate = toNum(enquiry.requested_rate);
      if (q != null && rate != null) { purchaseCost = q * rate; purchaseSource = 'Purchase Enquiry · requested rate'; }
    }

    const logisticsFreight = sumOf(logistics, 'freight_cost');
    const freight = logisticsFreight ?? sumOf(shipments, 'freight_cost');
    const freightSource = logisticsFreight != null ? 'Logistics · freight charges' : (freight != null ? 'Shipment · freight cost' : '');
    const customsDuty = sumOf(customs, 'customs_duty');
    const portCharges = sumOf(customs, 'other_charges');
    const otherCosts = sumOf(logistics, 'other_charges');
    const financeCharges = sumOf(finance, 'finance_charges');
    const commission = sumOf(commissions.filter((c) => EARNED_COMMISSION_STATUSES.includes(String(c.status ?? ''))), 'commission_amount');

    const lines: Array<{ key: string; label: string; amount: number | null; source: string }> = [
      { key: 'purchase_cost', label: 'Purchase / product cost', amount: purchaseCost, source: purchaseSource },
      { key: 'freight', label: 'Freight / logistics', amount: freight, source: freightSource },
      { key: 'customs_duty', label: 'Customs duty', amount: customsDuty, source: customsDuty != null ? 'Customs & Clearance' : '' },
      { key: 'port_charges', label: 'Port / clearance charges', amount: portCharges, source: portCharges != null ? 'Customs & Clearance · other charges' : '' },
      { key: 'insurance', label: 'Insurance', amount: null, source: '' },
      { key: 'other_costs', label: 'Other trade costs', amount: otherCosts, source: otherCosts != null ? 'Logistics · other charges' : '' },
      { key: 'finance_charges', label: 'Trade finance charges', amount: financeCharges, source: financeCharges != null ? 'Trade Finance' : '' },
      { key: 'commission', label: 'Commission', amount: commission, source: commission != null ? 'Commission Management · earned' : '' },
    ];

    const recorded = lines.map((l) => l.amount).filter((n): n is number => n != null);
    const totalCost = recorded.length ? recorded.reduce((a, b) => a + b, 0) : null;
    const netProfit = revenue != null && totalCost != null ? revenue - totalCost : null;
    const netMargin = netProfit != null && revenue ? (netProfit / revenue) * 100 : null;
    // Same thresholds as profitStatus() in TradeProfitabilityPage.tsx
    const profitStatus = netMargin == null ? 'Incomplete'
      : netMargin < 0 ? 'Loss'
        : netMargin === 0 ? 'Break-even'
          : netMargin < 10 ? 'Low Margin'
            : netMargin < 20 ? 'Profitable' : 'Highly Profitable';

    const record: Row = {
      organization_id: org,
      industry_type_id: dealRow.industry_type_id ?? null,
      deal_number: dealNumber,
      order_number: order?.order_number ?? dealRow.order_number ?? null,
      shipment_number: shipmentNumbers[0] ?? null,
      analysis_level: 'Deal',
      analysis_date: new Date().toISOString().slice(0, 10),
      customer_name: dealRow.customer_name ?? order?.customer_name ?? null,
      supplier_name: dealRow.supplier_name ?? null,
      product_name: dealRow.product_name ?? order?.product_name ?? null,
      quantity,
      currency,
      revenue,
      revenue_source: revenueSource || null,
      cost_sources: lines.map((l) => `${l.label}: ${l.amount == null ? 'not recorded' : `${l.amount} (${l.source})`}`).join('\n'),
      status: profitStatus,
      notes: `Automatically created when deal ${dealNumber} was completed.`,
    };
    for (const line of lines) record[line.key] = line.amount;

    const { error } = await supabaseAdmin.from('trading_profitability').insert(record);
    if (error && error.code !== '23505') throw error;
  } catch (error) {
    logger.error({ err: error, dealNumber }, 'Automatic profitability snapshot failed');
  }
}

function sanitizePayload(resource: TradingResource, input: Record<string, unknown>): Record<string, unknown> {  const allowed = new Set([...resource.columns, 'status']);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key)) out[key] = value === '' ? null : value;
  }
  return out;
}

export async function listTradingRecords(resource: TradingResource, org: string, scope: IndustryScope, requestedIndustryTypeId?: string) {
  const industryTypeId = resolveIndustryTypeId(scope, requestedIndustryTypeId);
  let query = supabaseAdmin.from(resource.table).select('*').eq('organization_id', org).order('created_at', { ascending: false });
  if (industryTypeId) query = query.eq('industry_type_id', industryTypeId);
  const { data, error } = await query;
  return error ? fail(error) : data;
}

export async function getTradingRecord(resource: TradingResource, org: string, id: string, scope: IndustryScope) {
  const { data, error } = await supabaseAdmin.from(resource.table).select('*').eq('organization_id', org).eq('id', id).maybeSingle();
  if (error) fail(error);
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', `${resource.path} record was not found.`);
  if (!data) throw notFound;
  assertRecordInScope(scope, (data as { industry_type_id?: string | null }).industry_type_id, notFound);
  return data;
}

export async function createTradingRecord(resource: TradingResource, org: string, input: Record<string, unknown>, scope: IndustryScope) {
  const payload = sanitizePayload(resource, input);
  if (!scope || !('role' in scope)) throw new AppError(400, 'VALIDATION_ERROR', 'Industry scope is required.');
  const industryTypeId = resolveIndustryTypeId(scope, typeof payload.industry_type_id === 'string' ? payload.industry_type_id : undefined);
  if (!industryTypeId) throw new AppError(400, 'VALIDATION_ERROR', 'industry_type_id is required.');
  const { data, error } = await supabaseAdmin.from(resource.table).insert({ ...payload, industry_type_id: industryTypeId, organization_id: org }).select().single();
  if (error) {
    if (error.code === '23505') throw new AppError(409, 'DUPLICATE_RECORD', `A ${resource.path} record with that value already exists.`);
    fail(error);
  }
  return data;
}

export async function updateTradingRecord(resource: TradingResource, org: string, id: string, input: Record<string, unknown>, scope: IndustryScope) {
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', `${resource.path} record was not found.`);
  const { data: existing, error: existingError } = await supabaseAdmin.from(resource.table).select('industry_type_id, status').eq('organization_id', org).eq('id', id).maybeSingle();
  if (existingError) fail(existingError);
  if (!existing) throw notFound;
  assertRecordInScope(scope, (existing as { industry_type_id?: string | null }).industry_type_id, notFound);
  const payload = sanitizePayload(resource, input);
  delete payload.industry_type_id; // never allow moving a record across industries via update
  const { data, error } = await supabaseAdmin.from(resource.table).update(payload).eq('organization_id', org).eq('id', id).select().maybeSingle();
  if (error) {
    if (error.code === '23505') throw new AppError(409, 'DUPLICATE_RECORD', `A ${resource.path} record with that value already exists.`);
    fail(error);
  }
   if (!data) throw notFound;
  // Step 2 & 3 of the Trading connectivity plan: a shipment's status
  // flows forward to its Sales Order/Deal, and reaching the right stage
  // auto-creates the Trade Documents and Logistics record that should
  // exist by then. Only fires for the Shipments table; every other
  // Trading module saves unchanged.
   if (resource.table === 'trading_shipments') {
    const shipment = data as Record<string, unknown>;
    const previousStatus = typeof (existing as { status?: string | null }).status === 'string' ? (existing as { status?: string | null }).status : '';
    await cascadeShipmentStatus(org, shipment);
    const status = typeof shipment.status === 'string' ? shipment.status : '';
    if (DOCUMENT_TRIGGER_STATUSES.has(status)) await autoCreateShipmentDocuments(org, shipment);
    if (LOGISTICS_TRIGGER_STATUSES.has(status)) await autoCreateShipmentLogistics(org, shipment);
    // Only on the actual transition INTO Delivered — never re-fires on a
    // later, unrelated save of an already-delivered shipment.
    if (status === 'Delivered' && previousStatus !== 'Delivered') await autoUpdateInventoryOnDelivery(org, shipment);
  }
  if (resource.table === 'trading_deals') {
    const deal = data as Record<string, unknown>;
    if (deal.status === 'Confirmed' && !deal.order_number) await convertConfirmedDealToOrders(org, deal);
    if (deal.status === 'Completed' && (existing as { status?: string | null }).status !== 'Completed' && typeof deal.deal_number === 'string') await autoCreateProfitabilitySnapshot(org, deal.deal_number);  }
  return data;
}
async function autoCreateShipmentForConfirmedOrder(org: string, orderNumber: string, deal: Record<string, unknown>) {
  try {
    const { data: existingShipment } = await supabaseAdmin.from('trading_shipments').select('id').eq('organization_id', org).eq('order_number', orderNumber).limit(1).maybeSingle();
    if (existingShipment) return;
    const shipmentNumber = `SHP-${orderNumber.replace(/^SO-/, '')}`;
    const { error } = await supabaseAdmin.from('trading_shipments').insert({
      organization_id: org,
      industry_type_id: deal.industry_type_id ?? null,
      shipment_number: shipmentNumber,
      order_number: orderNumber,
      deal_number: deal.deal_number ?? null,
      customer_name: deal.customer_name ?? null,
      product_name: deal.product_name ?? null,
      quantity: deal.customer_quantity ?? deal.quantity ?? null,
      unit: deal.unit ?? null,
      shipment_date: new Date().toISOString().slice(0, 10),
      status: 'Ready to Ship',
      direction: 'outbound',
      notes: `Automatically created from order ${orderNumber}.`,
    });
    if (error && error.code !== '23505') throw error;
    await supabaseAdmin.from('trading_sales_orders').update({ shipment_number: shipmentNumber }).eq('organization_id', org).eq('order_number', orderNumber);
    await autoCreateShipmentDocuments(org, {
      shipment_number: shipmentNumber,
      deal_number: deal.deal_number,
      customer_name: deal.customer_name,
      product_name: deal.product_name,
      quantity: deal.customer_quantity ?? deal.quantity,
      unit: deal.unit,
      industry_type_id: deal.industry_type_id,
    });  } catch (error) {
    logger.error({ err: error, orderNumber }, 'Automatic shipment creation for confirmed order failed');
  }
}
// NEW (end of file)
export async function deleteTradingRecord(resource: TradingResource, org: string, id: string, scope: IndustryScope) {
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', `${resource.path} record was not found.`);
  const { data: existing, error: existingError } = await supabaseAdmin.from(resource.table).select('industry_type_id').eq('organization_id', org).eq('id', id).maybeSingle();
  if (existingError) fail(existingError);
  if (!existing) throw notFound;
  assertRecordInScope(scope, (existing as { industry_type_id?: string | null }).industry_type_id, notFound);
  const { data, error } = await supabaseAdmin.from(resource.table).delete().eq('organization_id', org).eq('id', id).select().maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound;
  return data;
}

// Real "Send to supplier" for Purchase Enquiry — actually emails the
// supplier (unlike the status dropdown alone, which was just a label).
// Looks the supplier up by name to get their saved email, sends via SMTP,
// then flips status to 'Sent' only after the mail server accepts it —
// so a failed send never falsely marks the enquiry as sent.
export async function sendPurchaseEnquiry(org: string, id: string, scope: IndustryScope) {
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', 'Purchase enquiry record was not found.');
  const { data: enquiry, error } = await supabaseAdmin
    .from('trading_purchase_enquiries').select('*')
    .eq('organization_id', org).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!enquiry) throw notFound;
  assertRecordInScope(scope, (enquiry as { industry_type_id?: string | null }).industry_type_id, notFound);

  const supplierName = typeof enquiry.supplier_name === 'string' ? enquiry.supplier_name.trim() : '';
  if (!supplierName) throw new AppError(422, 'SUPPLIER_REQUIRED', 'Pick a supplier on this enquiry before sending it.');

  const { data: supplier, error: supplierError } = await supabaseAdmin
    .from('trading_suppliers').select('supplier_name, email')
    .eq('organization_id', org).eq('supplier_name', supplierName).limit(1).maybeSingle();
  if (supplierError) fail(supplierError);
  if (!supplier?.email) throw new AppError(422, 'SUPPLIER_EMAIL_REQUIRED', 'This supplier has no saved email address. Add one in Supplier / Vendor Management before sending.');

  const { data: organization } = await supabaseAdmin.from('organizations').select('name').eq('id', org).maybeSingle();
  const companyName = organization?.name ?? 'Our company';

  await sendPurchaseEnquiryEmail(enquiry as Record<string, unknown> as Parameters<typeof sendPurchaseEnquiryEmail>[0], supplier.supplier_name ?? supplierName, supplier.email, companyName);

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('trading_purchase_enquiries').update({ status: 'Sent' })
    .eq('organization_id', org).eq('id', id).select().maybeSingle();
  if (updateError) fail(updateError);
  if (!updated) throw notFound;
  return updated;
}