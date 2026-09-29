import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import type { TradingResource } from '../lib/trading-resources.js';
import { TRADING_RESOURCES } from '../lib/trading-resources.js';
import {
  MOVING_LOGISTICS_STATUSES, MOVING_SHIPMENT_STATUSES, STARTED_LOGISTICS_STATUSES, STARTED_SHIPMENT_STATUSES,
  assertPlanReady, ensureLogisticsPlan, nextShipmentStatus, syncLogisticsFromShipment,
} from '../lib/logistics-plan.js';
import { resolveIndustryTypeId, assertRecordInScope } from '../lib/industry-scope.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { logger } from '../lib/logger.js';
import { sendPurchaseEnquiryEmail } from '../services/purchase-enquiry-email.service.js';
import { promoteEnquiriesToComparison } from '../services/purchase-enquiry-comparison.service.js';

const fail = (error: unknown): never => { throw error; };

// Currency: the rate that turns an amount in `currency` into the company's own currency (the row flagged
// is_base_currency in Currency Management, INR when none is). Same rule as findRate() in
// admin/src/lib/currencyLookup.ts: the newest rate in force today, a direct pair or its inverse.
// rate === null means "no usable rate", which callers must treat as an error, never as 1.
async function baseRateFor(org: string, industryTypeId: unknown, currency: string): Promise<{ base: string; rate: number | null }> {
  let query = supabaseAdmin.from('trading_currency_rates').select('*').eq('organization_id', org);
  if (typeof industryTypeId === 'string' && industryTypeId) query = query.eq('industry_type_id', industryTypeId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const base = String(rows.find((r) => String(r.is_base_currency).toLowerCase() === 'yes')?.currency_code ?? 'INR').toUpperCase();
  const code = currency.trim().toUpperCase();
  if (!code || code === base) return { base, rate: 1 };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const active = rows
    .filter((r) => Number(r.exchange_rate) > 0
      && (!r.effective_date || String(r.effective_date).slice(0, 10) <= today)
      && (!r.expiry_date || String(r.expiry_date).slice(0, 10) >= today))
    .sort((a, b) => String(b.effective_date ?? '').localeCompare(String(a.effective_date ?? '')));
  const same = (value: unknown, wanted: string) => String(value ?? '').trim().toUpperCase() === wanted;
  const direct = active.find((r) => same(r.base_currency, code) && same(r.target_currency, base));
  if (direct) return { base, rate: Number(direct.exchange_rate) };
  const inverse = active.find((r) => same(r.base_currency, base) && same(r.target_currency, code));
  return { base, rate: inverse ? 1 / Number(inverse.exchange_rate) : null };
}

// A foreign-currency deal cannot be Confirmed without a rate: the core FS- order that Collections reads is
// in the company currency, so without a rate dollar amounts would land there as rupees.
async function assertDealHasRate(org: string, industryTypeId: string | null | undefined, dealId: string, payloadCurrency: unknown) {
  let currency = typeof payloadCurrency === 'string' ? payloadCurrency : '';
  if (payloadCurrency === undefined) {
    const { data } = await supabaseAdmin.from('trading_deals').select('currency').eq('organization_id', org).eq('id', dealId).maybeSingle();
    currency = String((data as { currency?: string | null } | null)?.currency ?? '');
  }
  const fx = await baseRateFor(org, industryTypeId, currency);
  if (fx.rate == null) {
    throw new AppError(422, 'NO_EXCHANGE_RATE', `There is no active ${currency.trim().toUpperCase()} to ${fx.base} exchange rate in Currency Management. Add one, then confirm the deal again.`);
  }
}

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

// When an inbound shipment made from a purchase enquiry (SHP-IN-2026-0008) is marked Delivered,
// the enquiry it came from (ENQ-2026-0008) is finished: Approved -> Closed.
// Enquiries that became a Deal are not "Approved", so they are left alone.
async function autoCloseEnquiryOnInboundDelivery(org: string, shipment: Record<string, unknown>) {
  try {
    const shipmentNumber = typeof shipment.shipment_number === 'string' ? shipment.shipment_number : '';
    if (!shipmentNumber.startsWith('SHP-IN-')) return;
    const enquiryNumber = `ENQ-${shipmentNumber.replace(/^SHP-IN-/, '')}`;
    const { error } = await supabaseAdmin
      .from('trading_purchase_enquiries')
      .update({ status: 'Closed' })
      .eq('organization_id', org).eq('enquiry_number', enquiryNumber).eq('status', 'Approved');
    if (error) throw error;
    logger.info({ shipmentNumber, enquiryNumber }, 'Purchase enquiry closed - inbound shipment delivered');
  } catch (error) {
    logger.error({ err: error, shipmentNumber: shipment.shipment_number }, 'Closing purchase enquiry after delivery failed');
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
    // The Trading Sales Order keeps the deal's own currency. The core FS- order (what Collections reads) is
    // in the company currency, so a foreign deal is converted once, here, at today's rate.
    const fx = await baseRateFor(org, deal.industry_type_id, String(deal.currency ?? ''));
    const inBase = (n: number) => Math.round(n * (fx.rate ?? 1) * 100) / 100;
    const fxNote = fx.rate != null && fx.rate !== 1 ? ` Converted from ${String(deal.currency).toUpperCase()} ${Math.round(totalAmount * 100) / 100} at ${Number(fx.rate.toFixed(6))}.` : '';

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
    if (customerId && productName && !deal.core_order_number && fx.rate == null) {
      logger.error({ dealNumber, currency: deal.currency }, 'Core order NOT created: no exchange rate to the company currency. Add the rate in Currency Management.');
    } else if (customerId && productName && !deal.core_order_number) {
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
            discount_amount: inBase(discountAmount),
            tax_amount: inBase(taxAmount),
            total_amount: inBase(totalAmount),
            notes: `Automatically created from Trading deal ${dealNumber}.${fxNote}`,
            status: 'confirmed',
            quotation_id: (deal.quotation_id as string | null | undefined) ?? null,
          }).select('id, order_number').single();
          if (coreError) throw coreError;
          coreOrder = inserted;
          const { error: itemError } = await supabaseAdmin.from('sale_order_items').insert({
            order_id: coreOrder!.id,
            product_id: product.id,
            quantity: quantity || 0,
            unit_price: inBase(sellingRate),
            discount_amount: inBase(discountAmount),
            // Before tax, like every other order line (quantity x unit price - discount). Tax lives on the order header.
            subtotal: inBase(grossAmount - discountAmount),
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
// Goods coming IN from the supplier. Whenever we BUY stock (e.g. 100), an INBOUND shipment is
// created for the full purchased quantity, so when it is marked Delivered the stock goes UP.
// Two things lead here:
//   1. a Deal built from a purchase enquiry is Confirmed (customer takes part, e.g. 21; the rest
//      stays as our stock). The customer's part gets its own outbound shipment separately.
//   2. a purchase enquiry with NO customer is Approved: we are buying purely for our own inventory.
//
// The shipment is deliberately NOT linked to any deal or sales order (no deal_number /
// order_number): a shipment that carries those makes cascadeShipmentStatus() mark the deal
// "Completed" the moment it is delivered, which would close the deal before the customer has
// received anything.
// The shipment number comes from the enquiry number (ENQ-2026-0004 -> SHP-IN-2026-0004), so both
// routes above produce the SAME number and it can only ever be created once, however often this runs.
async function autoCreateInboundShipmentFromEnquiry(org: string, enquiry: Record<string, unknown>, dealIndustryTypeId?: unknown) {
  try {
    const enquiryNumber = typeof enquiry.enquiry_number === 'string' ? enquiry.enquiry_number : undefined;
    if (!enquiryNumber) return;
       const quantity = Number(enquiry.quantity) || 0;
    if (quantity <= 0) {
      logger.warn({ enquiryNumber }, 'Inbound shipment NOT created: enquiry has no quantity. Enter a quantity and save again.');
      return;
    }
    const shipmentNumber = `SHP-IN-${enquiryNumber.replace(/^ENQ-/, '')}`;
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('trading_shipments').select('id')
      .eq('organization_id', org).eq('shipment_number', shipmentNumber).limit(1).maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      logger.info({ shipmentNumber, enquiryNumber }, 'Inbound shipment already exists for this enquiry - nothing to create');
      return;
    }
    const { error } = await supabaseAdmin.from('trading_shipments').insert({
      organization_id: org,
      industry_type_id: dealIndustryTypeId ?? enquiry.industry_type_id ?? null,
      shipment_number: shipmentNumber,
      supplier_name: enquiry.supplier_name ?? null,
      product_name: enquiry.product_name ?? null,
      quantity,
      unit: enquiry.unit ?? null,
      status: 'Planned',
      direction: 'inbound',
      notes: `Incoming stock from ${String(enquiry.supplier_name ?? 'supplier')} for purchase enquiry ${enquiryNumber}. Mark Delivered when the goods arrive.`,
    });
    if (error && error.code !== '23505') throw error;
    await ensureLogisticsPlan(org, { shipment_number: shipmentNumber, industry_type_id: dealIndustryTypeId ?? enquiry.industry_type_id ?? null, supplier_name: enquiry.supplier_name, product_name: enquiry.product_name, quantity, unit: enquiry.unit });
    logger.info({ shipmentNumber, enquiryNumber, quantity }, 'Inbound shipment created from purchase enquiry');
  } catch (error) {
    logger.error({ err: error, enquiryNumber: enquiry.enquiry_number }, 'Automatic inbound shipment creation failed');
  }
}

// Route 1: a Confirmed Deal that came from a purchase enquiry (found by its deal_number).
async function autoCreateInboundShipmentForDeal(org: string, deal: Record<string, unknown>) {
  try {
    const dealNumber = typeof deal.deal_number === 'string' ? deal.deal_number : undefined;
    if (!dealNumber) return;
    const { data: enquiry, error } = await supabaseAdmin
      .from('trading_purchase_enquiries')
      .select('enquiry_number, supplier_name, product_name, quantity, unit, industry_type_id')
      .eq('organization_id', org).eq('deal_number', dealNumber).limit(1).maybeSingle();
    if (error) throw error;
    if (!enquiry) return; // deal did not come from a purchase enquiry — leave it alone
    await autoCreateInboundShipmentFromEnquiry(org, enquiry as Record<string, unknown>, deal.industry_type_id);
  } catch (error) {
    logger.error({ err: error, dealNumber: deal.deal_number }, 'Automatic inbound shipment lookup for deal failed');
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
      const supplierDiscount = toNum(dealRow.purchase_discount_percent) ?? 0;
      if (q != null && rate != null) { purchaseCost = q * rate * (1 - supplierDiscount / 100); purchaseSource = supplierDiscount ? `Deal · qty x purchase rate less ${supplierDiscount}% supplier discount` : 'Deal · qty x purchase rate'; }
    }
    if (purchaseCost == null && enquiry) {
      const q = toNum(enquiry.quantity); const rate = toNum(enquiry.requested_rate);
      const enquiryDiscount = toNum(enquiry.discount_percent) ?? 0;
      if (q != null && rate != null) { purchaseCost = q * rate * (1 - enquiryDiscount / 100); purchaseSource = enquiryDiscount ? `Purchase Enquiry · requested rate less ${enquiryDiscount}% supplier discount` : 'Purchase Enquiry · requested rate'; }
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

// Says WHICH columns collided (e.g. "organization_id, enquiry_number") without echoing any values,
// so a "already exists" message is actionable instead of a guess.
function duplicateColumns(error: { details?: string | null }): string {
  const match = /Key \(([^)]+)\)/.exec(error.details ?? '');
  return match ? ` (same: ${match[1]})` : '';
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

const PRICE_RATE_TYPES = ['Purchase Rate', 'Selling Rate', 'Wholesale Rate', 'Retail Rate', 'Customer-specific Rate', 'Supplier-specific Rate'];
const PURCHASE_SIDE_RATE_TYPES = ['Purchase Rate', 'Supplier-specific Rate'];

// Server-side rules for a Price List row (the form alone can be bypassed and never checked these).
// Also clears the columns that do not belong to the chosen rate type, because the form hides them but
// still keeps values auto-filled from the product - a hidden purchase rate on a customer row would
// otherwise be picked up as a general purchase rate.
async function validatePriceList(org: string, industryTypeId: string | null | undefined, payload: Record<string, unknown>, id?: string) {
  const bad = (message: string): never => { throw new AppError(422, 'VALIDATION_ERROR', message); };
  let existing: Record<string, unknown> = {};
  if (id) {
    const { data } = await supabaseAdmin.from('trading_price_lists').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
    existing = (data as Record<string, unknown> | null) ?? {};
  }
  const row: Record<string, unknown> = { ...existing, ...payload };
  const numOf = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

  const type = String(row.rate_type ?? '');
  if (!PRICE_RATE_TYPES.includes(type)) bad('Choose a rate type.');
  if (!row.product_name) bad('Product is required.');
  const purchaseSide = PURCHASE_SIDE_RATE_TYPES.includes(type);

  const purchaseRate = numOf(row.purchase_rate);
  const sellingRate = numOf(row.selling_rate);
  const minQty = numOf(row.min_quantity);
  const tax = numOf(row.tax);
  const discount = numOf(row.discount);
  for (const [label, value] of [['Purchase rate', purchaseRate], ['Selling rate', sellingRate], ['Minimum quantity', minQty], ['Tax', tax], ['Discount', discount]] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) bad(`${label} must be a number, zero or more.`);
  }
  if ((tax !== null && tax > 100) || (discount !== null && discount > 100)) bad('Tax and discount cannot be more than 100%.');
  if (purchaseSide && purchaseRate === null) bad('Enter the purchase rate.');
  if (!purchaseSide && sellingRate === null) bad('Enter the selling rate.');
  if (type === 'Customer-specific Rate' && !row.customer_name) bad('Pick the customer for a customer-specific rate.');
  if (type === 'Supplier-specific Rate' && !row.supplier_name) bad('Pick the supplier for a supplier-specific rate.');

  const from = row.effective_from ? String(row.effective_from).slice(0, 10) : null;
  const to = row.effective_to ? String(row.effective_to).slice(0, 10) : null;
  if (from && to && to < from) bad('Effective to cannot be before effective from.');

  // Drop what does not belong to this rate type.
  if (type !== 'Customer-specific Rate') payload.customer_name = null;
  if (type !== 'Supplier-specific Rate') payload.supplier_name = null;
  if (purchaseSide) payload.selling_rate = null; else payload.purchase_rate = null;
  // "0" and blank both mean "no minimum quantity" - store them the same way so they can never coexist.
  if (minQty === 0) payload.min_quantity = null;

  // No two rates for the same product / type / customer / supplier / minimum quantity may overlap in time.
  let query = supabaseAdmin.from('trading_price_lists')
    .select('id, effective_from, effective_to')
    .eq('organization_id', org).eq('product_name', String(row.product_name)).eq('rate_type', type);
  const same = (column: string, value: unknown) => (value === null || value === undefined || value === '' ? query.is(column, null) : query.eq(column, value as string | number));
  query = same('customer_name', type === 'Customer-specific Rate' ? row.customer_name : null);
  query = same('supplier_name', type === 'Supplier-specific Rate' ? row.supplier_name : null);
  // Blank and 0 minimum quantity are the same tier (rows saved before this rule may still hold 0).
  if (!minQty) query = query.or('min_quantity.is.null,min_quantity.eq.0'); else query = query.eq('min_quantity', minQty);
  // The same product can carry one rate per currency (INR and USD at the same time is fine).
  // A blank currency is treated as INR, which is what the rest of the app assumes.
  const currencyCode = String(row.currency ?? '').trim().toUpperCase();
  if (!currencyCode || currencyCode === 'INR') query = query.or('currency.is.null,currency.eq.INR'); else query = query.eq('currency', currencyCode);
  if (industryTypeId) query = query.eq('industry_type_id', industryTypeId);
  if (id) query = query.neq('id', id);
  const { data: others, error } = await query;
  if (error) fail(error);
  const start = from ?? '0000-01-01';
  const end = to ?? '9999-12-31';
  const clash = (others ?? []).find((o) => {
    const oStart = o.effective_from ? String(o.effective_from).slice(0, 10) : '0000-01-01';
    const oEnd = o.effective_to ? String(o.effective_to).slice(0, 10) : '9999-12-31';
    return start <= oEnd && oStart <= end;
  });
  if (clash) {
    throw new AppError(409, 'OVERLAPPING_RATE', `A rate for the same product, type, customer/supplier and minimum quantity already covers ${clash.effective_from ?? 'the start'} to ${clash.effective_to ?? 'no end date'}. Change its dates or edit that rate instead.`);
  }
}

export async function createTradingRecord(resource: TradingResource, org: string, input: Record<string, unknown>, scope: IndustryScope) {
  const payload = sanitizePayload(resource, input);
  if (!scope || !('role' in scope)) throw new AppError(400, 'VALIDATION_ERROR', 'Industry scope is required.');
  const industryTypeId = resolveIndustryTypeId(scope, typeof payload.industry_type_id === 'string' ? payload.industry_type_id : undefined);
  if (!industryTypeId) throw new AppError(400, 'VALIDATION_ERROR', 'industry_type_id is required.');
  if (resource.table === 'trading_price_lists') await validatePriceList(org, industryTypeId, payload);
  // Purchase enquiries get their ENQ number from the browser, which guesses it from the rows
  // it can currently see (filtered by industry). That guess can land on a number that already
  // exists, so on an enquiry_number clash we pick the next truly free number and retry.
  const isEnquiry = resource.table === 'trading_purchase_enquiries';
  for (let attempt = 0; ; attempt += 1) {
    const { data, error } = await supabaseAdmin.from(resource.table).insert({ ...payload, industry_type_id: industryTypeId, organization_id: org }).select().single();
    if (!error) {
      if (resource.table === 'trading_shipments') await ensureLogisticsPlan(org, data as Record<string, unknown>);
      return data;
    }
    const clashOnNumber = error.code === '23505' && /enquiry_number/.test(error.details ?? error.message ?? '');
    if (isEnquiry && clashOnNumber && attempt < 5) {
      payload.enquiry_number = await nextEnquiryNumber(org);
      continue;
    }
    if (error.code === '23505') throw new AppError(409, 'DUPLICATE_RECORD', `A ${resource.path} record with that value already exists${duplicateColumns(error)}.`);
    fail(error);
  }
}

// Next free ENQ-<year>-<0001> across the WHOLE organization (every industry), because the
// database's unique rule (organization_id + enquiry_number) counts all of them.
async function nextEnquiryNumber(org: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ENQ-${year}-`;
  const { data, error } = await supabaseAdmin
    .from('trading_purchase_enquiries').select('enquiry_number')
    .eq('organization_id', org).like('enquiry_number', `${prefix}%`);
  if (error) fail(error);
  let max = 0;
  for (const row of (data ?? []) as Array<{ enquiry_number: string | null }>) {
    const n = Number((row.enquiry_number ?? '').slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// Logistics events move the shipment: Picked Up / Dispatched -> Dispatched, In Transit -> In Transit,
// At Destination / Out for Delivery -> At Destination, Delivered -> Delivered (forward only). It goes through
// updateTradingRecord so the shipment's own follow-ups (order/deal status, documents, stock on delivery) run once,
// exactly as if the shipment had been changed by hand. Never throws - the logistics save has already succeeded.
// Logistics owns the route, so its values are copied onto the shipment (read-only there). Documents, customs and
// reports that still read the shipment's own columns keep working, and nobody types the route twice.
const ROUTE_LOGISTICS_TO_SHIPMENT: Array<[string, string]> = [
  ['origin', 'origin'], ['destination', 'destination'], ['carrier', 'transporter'], ['shipping_mode', 'shipping_mode'],
  ['tracking_number', 'tracking_number'], ['vehicle_container_number', 'vehicle_container_number'], ['freight_cost', 'freight_cost'],
];

async function syncShipmentFromLogistics(org: string, logistics: Record<string, unknown>, scope: IndustryScope) {
  try {
    const shipmentNumber = typeof logistics.shipment_number === 'string' ? logistics.shipment_number : '';
    const logisticsStatus = typeof logistics.status === 'string' ? logistics.status : '';
    if (!shipmentNumber) return;
    const { data: shipment, error } = await supabaseAdmin
      .from('trading_shipments').select('id, status, actual_delivery_date, origin, destination, transporter, shipping_mode, tracking_number, vehicle_container_number, freight_cost')
      .eq('organization_id', org).eq('shipment_number', shipmentNumber).limit(1).maybeSingle();
    if (error) throw error;
    if (!shipment) return;
    const current = shipment as Record<string, unknown>;

    // 1) Route / carrier / freight: copy what the plan holds (only non-blank values that differ).
    const routePatch: Record<string, unknown> = {};
    for (const [from, to] of ROUTE_LOGISTICS_TO_SHIPMENT) {
      const value = logistics[from];
      if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) continue;
      if (String(current[to] ?? '') !== String(value)) routePatch[to] = value;
    }
    if (Object.keys(routePatch).length > 0) {
      const { error: routeError } = await supabaseAdmin.from('trading_shipments').update(routePatch).eq('organization_id', org).eq('id', current.id as string);
      if (routeError) throw routeError;
    }

    // 2) Status: forward only.
    if (!logisticsStatus) return;
    const next = nextShipmentStatus(String(current.status ?? ''), logisticsStatus);
    if (!next) return;
    const shipmentResource = TRADING_RESOURCES.find((r) => r.table === 'trading_shipments');
    if (!shipmentResource) return;
    const patch: Record<string, unknown> = { status: next };
    if (next === 'Delivered') patch.actual_delivery_date = current.actual_delivery_date ?? logistics.actual_delivery_date ?? new Date().toISOString().slice(0, 10);
    await updateTradingRecord(shipmentResource, org, current.id as string, patch, scope);
  } catch (error) {
    logger.error({ err: error, shipmentNumber: logistics.shipment_number }, 'Syncing the shipment from logistics failed');
  }
}

export async function updateTradingRecord(resource: TradingResource, org: string, id: string, input: Record<string, unknown>, scope: IndustryScope) {
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', `${resource.path} record was not found.`);
  const { data: existing, error: existingError } = await supabaseAdmin.from(resource.table).select('industry_type_id, status').eq('organization_id', org).eq('id', id).maybeSingle();
  if (existingError) fail(existingError);
  if (!existing) throw notFound;
  assertRecordInScope(scope, (existing as { industry_type_id?: string | null }).industry_type_id, notFound);
    const payload = sanitizePayload(resource, input);
  delete payload.industry_type_id; // never allow moving a record across industries via update
  if (resource.table === 'trading_price_lists') await validatePriceList(org, (existing as { industry_type_id?: string | null }).industry_type_id, payload, id);
  if (resource.table === 'trading_deals' && payload.status === 'Confirmed' && (existing as { status?: string | null }).status !== 'Confirmed') {
    await assertDealHasRate(org, (existing as { industry_type_id?: string | null }).industry_type_id, id, payload.currency);
  }
  // A shipment (or its Logistics record) cannot start moving until the Logistics plan is complete.
  const previousStatusBefore = String((existing as { status?: string | null }).status ?? '');
  if (resource.table === 'trading_shipments' && typeof payload.status === 'string' && MOVING_SHIPMENT_STATUSES.has(payload.status) && !STARTED_SHIPMENT_STATUSES.has(previousStatusBefore)) {
    const { data: current, error: currentError } = await supabaseAdmin.from('trading_shipments').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
    if (currentError) fail(currentError);
    const merged = { ...(current as Record<string, unknown> | null), ...payload };
    // The shipment's own route fields fill any blank in the plan first, then the plan is checked.
    const plan = await ensureLogisticsPlan(org, merged);
    assertPlanReady(plan, String(merged.shipment_number ?? ''));
  }
  if (resource.table === 'trading_logistics' && typeof payload.status === 'string' && MOVING_LOGISTICS_STATUSES.has(payload.status) && !STARTED_LOGISTICS_STATUSES.has(previousStatusBefore)) {
    const { data: current, error: currentError } = await supabaseAdmin.from('trading_logistics').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
    if (currentError) fail(currentError);
    const merged = { ...(current as Record<string, unknown> | null), ...payload };
    assertPlanReady(merged, String(merged.shipment_number ?? ''));
  }
  // The Customer ID is a hidden field. If the visible Customer name is empty, drop the ID too,
  // otherwise a stale ID makes the enquiry look like it has a customer.
  if (resource.table === 'trading_purchase_enquiries' && 'customer_name' in payload && !payload.customer_name) {
    payload.customer_id = null;
  }
  const { data, error } = await supabaseAdmin.from(resource.table).update(payload).eq('organization_id', org).eq('id', id).select().maybeSingle();
  if (error) {
    if (error.code === '23505') throw new AppError(409, 'DUPLICATE_RECORD', `A ${resource.path} record with that value already exists${duplicateColumns(error)}.`);
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
    // Every shipment has a Logistics plan; keep its status/dates in step with the shipment.
    await syncLogisticsFromShipment(org, shipment);
    // Only on the actual transition INTO Delivered — never re-fires on a
    // later, unrelated save of an already-delivered shipment.
    if (status === 'Delivered' && previousStatus !== 'Delivered') {
      await autoUpdateInventoryOnDelivery(org, shipment);
      await autoCloseEnquiryOnInboundDelivery(org, shipment);
    }
  }
  if (resource.table === 'trading_logistics') await syncShipmentFromLogistics(org, data as Record<string, unknown>, scope);
  if (resource.table === 'trading_deals') {
    const deal = data as Record<string, unknown>;
    if (deal.status === 'Confirmed' && !deal.order_number) await convertConfirmedDealToOrders(org, deal);
    if (deal.status === 'Confirmed') await autoCreateInboundShipmentForDeal(org, deal);
    if (deal.status === 'Completed' && (existing as { status?: string | null }).status !== 'Completed' && typeof deal.deal_number === 'string') await autoCreateProfitabilitySnapshot(org, deal.deal_number);  }
  // Purchase Enquiry: when a supplier's status BECOMES "Supplier Responded" (typed in by
  // hand) and another supplier has also responded for the same product, move them to
  // "Under Comparison". Same rule the reply-mailbox poller applies.
  if (resource.table === 'trading_purchase_enquiries') {
    const enquiry = data as Record<string, unknown>;
    if (enquiry.status === 'Supplier Responded' && (existing as { status?: string | null }).status !== 'Supplier Responded') {
      const moved = await promoteEnquiriesToComparison(org, enquiry);
      if (moved.includes(String(enquiry.id))) return { ...enquiry, status: 'Under Comparison' };
    }
    // Route 2: an Approved enquiry with no customer is stock bought for our own inventory.
    // (With a customer, the inbound shipment is made when its Deal is Confirmed instead.)
    if (enquiry.status === 'Approved') {
      if (!enquiry.customer_name) {
        await autoCreateInboundShipmentFromEnquiry(org, enquiry);
      } else {
        logger.info({ enquiryNumber: enquiry.enquiry_number }, 'Approved enquiry has a customer - inbound shipment is created when its Deal is Confirmed');
      }
    }
  }
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
    await ensureLogisticsPlan(org, { shipment_number: shipmentNumber, industry_type_id: deal.industry_type_id ?? null, deal_number: deal.deal_number, customer_name: deal.customer_name, product_name: deal.product_name, quantity: deal.customer_quantity ?? deal.quantity, unit: deal.unit });
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

  // Match the supplier by trimmed, case-insensitive name and prefer a row that
  // actually has an email — so a duplicate supplier record, a trailing space or
  // different casing in the name can't hide the saved email address.
  const { data: supplierRows, error: supplierError } = await supabaseAdmin
    .from('trading_suppliers').select('supplier_name, email')
    .eq('organization_id', org);
  if (supplierError) fail(supplierError);
  const wanted = supplierName.toLowerCase();
  const sameName = (supplierRows ?? []).filter((row) => String(row.supplier_name ?? '').trim().toLowerCase() === wanted);
  const supplier = sameName.find((row) => String(row.email ?? '').trim()) ?? sameName[0];
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