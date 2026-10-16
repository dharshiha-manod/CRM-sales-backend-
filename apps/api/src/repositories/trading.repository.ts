import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import type { TradingResource } from '../lib/trading-resources.js';
import { TRADING_RESOURCES } from '../lib/trading-resources.js';
import {
  MOVING_LOGISTICS_STATUSES, MOVING_SHIPMENT_STATUSES, STARTED_LOGISTICS_STATUSES, STARTED_SHIPMENT_STATUSES,
  assertPlanReady, ensureLogisticsPlan, nextShipmentStatus, syncLogisticsFromShipment,
} from '../lib/logistics-plan.js';
import { resolveIndustryTypeId, assertRecordInScope } from '../lib/industry-scope.js';
import { isFmcgIndustry } from '../lib/fmcg-market.js';
import { fmcgShipmentsAsTradingRows, syncFmcgExportDocFlag } from '../lib/fmcg-paperwork.js';
import type { IndustryScope } from '../lib/industry-scope.js';
import { logger } from '../lib/logger.js';
import { sumInCurrency } from '../lib/currency-sum.js';
import { computeInvoiceTotals } from '../lib/invoice-totals.js';
import { addDays, daysFromPaymentTerms } from '../lib/invoice-terms.js';
import { sendPurchaseEnquiryEmail } from '../services/purchase-enquiry-email.service.js';
import { sendShipmentDocumentsEmail } from '../services/shipment-documents-email.service.js';
import { sendCustomerInvoiceEmail } from '../services/customer-invoice-email.service.js';
import { customsProblems, dispatchBlockMessage, documentProblems, paymentProblems } from '../lib/dispatch-gates.js';
import { assertCanClear, assertNoDirectReviewChange, planDocumentReview, resetApprovalOnNewFile } from '../lib/trade-verification.js';
import type { ReviewActor } from '../lib/trade-verification.js';
import { promoteEnquiriesToComparison } from '../services/purchase-enquiry-comparison.service.js';
import {
  OPEN_COMPLIANCE_STATUSES, buildComplianceSnapshot, complianceTypeFor, customsFromTransaction, nextReference,
  nextTransactionStatusFromCustoms, nextTransactionStatusFromShipment,
} from '../lib/trade-links.js';
import type { ComplianceInputs } from '../lib/trade-links.js';

const fail = (error: unknown): never => { throw error; };

// Currency: the rate that turns an amount in `currency` into the company's own currency (the row flagged
// is_base_currency in Currency Management, INR when none is). Same rule as findRate() in
// admin/src/lib/currencyLookup.ts: the newest rate in force today, a direct pair or its inverse.
// rate === null means "no usable rate", which callers must treat as an error, never as 1.
/** FMCG keeps its exchange rates in fmcg_currency_rates. This shows them in Trading's shape (X -> INR) so the shared Trade pages can use them. */
async function fmcgRatesAsTradingRows(org: string, industryTypeId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabaseAdmin.from('fmcg_currency_rates').select('*')
    .eq('organization_id', org).eq('industry_type_id', industryTypeId)
    .order('effective_from', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id, organization_id: org, industry_type_id: industryTypeId,
    currency_code: r.currency_code, currency_name: r.currency_code,
    base_currency: r.currency_code, target_currency: 'INR',
    exchange_rate: r.rate_to_inr, effective_date: r.effective_from, expiry_date: null,
    is_base_currency: 'No', created_at: r.created_at,
  }));
  // The company currency itself, so "base currency" resolves to INR.
  rows.push({
    id: 'fmcg-base-inr', organization_id: org, industry_type_id: industryTypeId,
    currency_code: 'INR', currency_name: 'Indian rupee', base_currency: 'INR', target_currency: 'INR',
    exchange_rate: 1, effective_date: null, expiry_date: null, is_base_currency: 'Yes', created_at: null,
  });
  return rows;
}

async function baseRateFor(org: string, industryTypeId: unknown, currency: string): Promise<{ base: string; rate: number | null }> {
  let rows: Array<Record<string, unknown>>;
  if (typeof industryTypeId === 'string' && industryTypeId && await isFmcgIndustry(org, industryTypeId)) {
    rows = await fmcgRatesAsTradingRows(org, industryTypeId);
  } else {
    let query = supabaseAdmin.from('trading_currency_rates').select('*').eq('organization_id', org);
    if (typeof industryTypeId === 'string' && industryTypeId) query = query.eq('industry_type_id', industryTypeId);
    const { data, error } = await query;
    if (error) throw error;
    rows = (data ?? []) as Array<Record<string, unknown>>;
  }
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

// Records that carry an amount in their own currency. The exchange rate, company currency and converted value are
// worked out HERE from Currency Management, never trusted from the form: a stale rate of 1 (INR picked first, then
// switched to USD) used to be saved as-is. Value = the column the admin form converts (see currencyLookup targets).
const RATE_STAMPED_AMOUNT: Record<string, string> = {
  trading_logistics: 'freight_cost',
  trading_import_export: 'total_value',
  trading_customs: 'declared_value',
  trading_claims: 'claimed_value',
};

async function stampForeignRate(table: string, org: string, industryTypeId: unknown, payload: Record<string, unknown>, existing: Record<string, unknown> = {}) {
  const amountKey = RATE_STAMPED_AMOUNT[table];
  if (!amountKey) return;
  if (!('currency' in payload) && !(amountKey in payload)) return;
  const currency = String(('currency' in payload ? payload.currency : existing.currency) ?? '').trim();
  if (!currency) return;
  const fx = await baseRateFor(org, industryTypeId, currency);
  if (fx.rate == null) {
    throw new AppError(422, 'NO_EXCHANGE_RATE', `There is no active ${currency.toUpperCase()} to ${fx.base} exchange rate in Currency Management. Add one, then save this record again.`);
  }
  const amount = Number(amountKey in payload ? payload[amountKey] : existing[amountKey]) || 0;
  payload.exchange_rate = Number(fx.rate.toFixed(6));
  payload.base_currency = fx.base;
  payload.base_value = Number((amount * fx.rate).toFixed(2));
}

// An Import / Export record must agree with the shipment it is raised for: goods going out to a customer are an
// Export, goods coming in from a supplier are an Import. Shipments with no direction (older rows) are not checked.
async function assertTypeMatchesShipment(org: string, payload: Record<string, unknown>, existing: Record<string, unknown> = {}) {
  if (!('transaction_type' in payload) && !('shipment_number' in payload)) return;
  const type = String(('transaction_type' in payload ? payload.transaction_type : existing.transaction_type) ?? '').trim();
  const shipmentNumber = String(('shipment_number' in payload ? payload.shipment_number : existing.shipment_number) ?? '').trim();
  if (!shipmentNumber || (type !== 'Import' && type !== 'Export')) return;
  const { data } = await supabaseAdmin.from('trading_shipments').select('direction').eq('organization_id', org).eq('shipment_number', shipmentNumber).limit(1).maybeSingle();
  const direction = String((data as { direction?: string | null } | null)?.direction ?? '').toLowerCase();
  const expected = direction === 'outbound' ? 'Export' : direction === 'inbound' ? 'Import' : '';
  if (expected && expected !== type) {
    throw new AppError(422, 'TRANSACTION_TYPE_MISMATCH', `Shipment ${shipmentNumber} is ${direction} (goods ${direction === 'outbound' ? 'going out to the customer' : 'coming in from the supplier'}), so this must be an ${expected}, not an ${type}.`);
  }
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
    // A deal or order with several shipments is Completed only when EVERY one of them is finished, and a Completed
    // deal / order is never moved back to an earlier stage by a later shipment.
    const FINISHED = ['Delivered', 'Completed', 'Cancelled'];
    const allShipmentsFinished = async (column: 'deal_number' | 'order_number', value: string): Promise<boolean> => {
      const { data, error } = await supabaseAdmin.from('trading_shipments').select('status').eq('organization_id', org).eq(column, value);
      if (error) throw error;
      return (data ?? []).every((s) => FINISHED.includes(String((s as Row).status ?? '')));
    };
    if (orderNumber) {
      const { data: currentOrder, error: orderReadError } = await supabaseAdmin.from('trading_sales_orders').select('status').eq('organization_id', org).eq('order_number', orderNumber).maybeSingle();
      if (orderReadError) throw orderReadError;
      const orderDone = String((currentOrder as Row | null)?.status ?? '') === 'Completed';
      const allowed = mapping.order === 'Completed' ? await allShipmentsFinished('order_number', orderNumber) : !orderDone;
      if (allowed) {
        const { error } = await supabaseAdmin.from('trading_sales_orders').update({ status: mapping.order }).eq('organization_id', org).eq('order_number', orderNumber);
        if (error) throw error;
      }
    }
    if (mapping.deal && dealNumber) {
      const { data: currentDeal, error: dealReadError } = await supabaseAdmin.from('trading_deals').select('status').eq('organization_id', org).eq('deal_number', dealNumber).maybeSingle();
      if (dealReadError) throw dealReadError;
      const dealDone = String((currentDeal as Row | null)?.status ?? '') === 'Completed';
      const allowed = mapping.deal === 'Completed' ? await allShipmentsFinished('deal_number', dealNumber) : !dealDone;
      if (allowed) {
        const { error } = await supabaseAdmin.from('trading_deals').update({ status: mapping.deal }).eq('organization_id', org).eq('deal_number', dealNumber);
        if (!error && mapping.deal === 'Completed') await syncProfitabilitySnapshot(org, dealNumber, 'Completed', true);
        if (!error && mapping.deal === 'In Progress') await syncProfitabilitySnapshot(org, dealNumber, 'In Progress');
        if (error) throw error;
      }
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

// ---------------------------------------------------------------------------
// Dispatch gates (the professional export flow). Before OUR goods leave (outbound shipments) three things must be true:
// the Commercial Invoice + Packing List are Verified, export customs is Cleared, and - only when the deal is backed
// by an LC or an advance - that LC is issued / the advance received. Inbound shipments (supplier -> us) are not
// gated: the supplier does their own export paperwork. The paperwork is created on the spot when it does not exist
// yet, so the person sees exactly what to work on instead of a bare refusal.
// Rules live in lib/dispatch-gates.ts (pure, unit-tested); this part only loads the rows.
// ---------------------------------------------------------------------------
const DISPATCH_LOGISTICS_STATUSES = new Set(['Dispatched', 'In Transit', 'At Destination', 'Out for Delivery', 'Delivered']);
const LEFT_LOGISTICS_STATUSES = new Set([...DISPATCH_LOGISTICS_STATUSES, 'Cancelled']);

const asText = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Goods crossing a border: a foreign-currency deal or logistics cost, or an Import/Export transaction or customs record exists. */
async function isCrossBorderShipment(org: string, shipment: Record<string, unknown>): Promise<boolean> {
  const shipmentNumber = asText(shipment.shipment_number);
  const dealNumber = asText(shipment.deal_number);
  const foreign = async (currency: string) => {
    if (!currency) return false;
    const fx = await baseRateFor(org, shipment.industry_type_id, currency);
    return currency.toUpperCase() !== fx.base;
  };
  if (dealNumber) {
    const { data: deal, error } = await supabaseAdmin.from('trading_deals').select('currency').eq('organization_id', org).eq('deal_number', dealNumber).limit(1).maybeSingle();
    if (error) throw error;
    if (await foreign(asText((deal as { currency?: string | null } | null)?.currency))) return true;
  }
  if (shipmentNumber) {
    const { data: txn, error: txnError } = await supabaseAdmin.from('trading_import_export').select('id').eq('organization_id', org).eq('shipment_number', shipmentNumber).limit(1).maybeSingle();
    if (txnError) throw txnError;
    if (txn) return true;
    const { data: plan, error: planError } = await supabaseAdmin.from('trading_logistics').select('currency').eq('organization_id', org).eq('shipment_number', shipmentNumber).limit(1).maybeSingle();
    if (planError) throw planError;
    if (await foreign(asText((plan as { currency?: string | null } | null)?.currency))) return true;
  }
  return false;
}

/** The shipment's customs record(s). Creates one (status Not Started) when the shipment is cross-border and has none. */
async function ensureShipmentCustoms(org: string, shipment: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  const shipmentNumber = asText(shipment.shipment_number);
  if (!shipmentNumber) return [];
  const { data, error } = await supabaseAdmin.from('trading_customs').select('id, customs_reference, clearance_status, status').eq('organization_id', org).eq('shipment_number', shipmentNumber);
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length > 0) return rows;
  if (!(await isCrossBorderShipment(org, shipment))) return [];
  const inbound = asText(shipment.direction).toLowerCase() === 'inbound';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = await nextOrgReference(org, 'trading_customs', 'customs_reference', 'CUS');
    const { data: created, error: insertError } = await supabaseAdmin.from('trading_customs').insert({
      organization_id: org, industry_type_id: shipment.industry_type_id ?? null,
      customs_reference: reference, shipment_number: shipmentNumber, transaction_type: inbound ? 'Import' : 'Export',
      customer_name: shipment.customer_name ?? null, supplier_name: shipment.supplier_name ?? null,
      product_name: shipment.product_name ?? null, quantity: shipment.quantity ?? null,
      port_of_loading: shipment.origin ?? null, port_of_discharge: shipment.destination ?? null,
      clearance_status: 'Not Started', status: 'Not Started',
      notes: `Automatically created from shipment ${shipmentNumber}. Export customs must be Cleared before the goods are dispatched.`,
    }).select('id, customs_reference, clearance_status, status').single();
    if (!insertError) return [created as Record<string, unknown>];
    if (insertError.code !== '23505') throw insertError;
  }
  return [];
}

/** At Ready to Ship (or later): the Packing List + Commercial Invoice drafts and the customs record all exist. Never throws. */
async function autoCreateShipmentPaperwork(org: string, shipment: Record<string, unknown>) {
  await autoCreateShipmentDocuments(org, shipment);
  try { await ensureShipmentCustoms(org, shipment); } catch (error) {
    logger.error({ err: error, shipmentNumber: shipment.shipment_number }, 'Automatic customs record for the shipment failed');
  }
}

/** Throws SHIPMENT_NOT_READY (422) listing everything still blocking an outbound shipment from leaving. */
async function assertReadyToDispatch(org: string, shipmentNumber: string): Promise<void> {
  if (!shipmentNumber) return;
  const { data, error } = await supabaseAdmin.from('trading_shipments').select('*').eq('organization_id', org).eq('shipment_number', shipmentNumber).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return;
  const shipment = data as Record<string, unknown>;
  if (asText(shipment.direction).toLowerCase() === 'inbound') return;

  await autoCreateShipmentDocuments(org, shipment);
  const customs = await ensureShipmentCustoms(org, shipment);
  const { data: docs, error: docsError } = await supabaseAdmin.from('trading_documents').select('document_number, document_type, status, verification_status').eq('organization_id', org).eq('shipment_number', shipmentNumber);
  if (docsError) throw docsError;
  const dealNumber = asText(shipment.deal_number);
  const finance = await fetchByAnyKey(org, 'trading_trade_finance', { shipment_number: [shipmentNumber], deal_number: dealNumber ? [dealNumber] : [] });

  const problems = [
    ...documentProblems((docs ?? []) as Array<Record<string, unknown>>),
    ...customsProblems(customs),
    ...paymentProblems(finance),
  ];
  if (problems.length > 0) throw new AppError(422, 'SHIPMENT_NOT_READY', dispatchBlockMessage(shipmentNumber, problems));
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

// What a shipment's invoice is built from. Goods value = THIS shipment's quantity x the Deal's selling rate, less the
// Deal's discount (the agreed quotation amount, before tax). Tax % comes from the Deal. Payment days = the Deal's
// payment terms, else the customer's own Credit days (the same days Collections uses for its due date).
async function invoiceBasisForShipment(org: string, shipment: Record<string, unknown>) {
  const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
  const dealNumber = typeof shipment.deal_number === 'string' ? shipment.deal_number : '';
  const orderNumber = typeof shipment.order_number === 'string' ? shipment.order_number : '';
  let deal: Row | null = null;
  let order: Row | null = null;
  if (dealNumber) {
    const { data, error } = await supabaseAdmin.from('trading_deals')
      .select('currency, selling_rate, discount_percent, tax_percent, payment_terms, customer_id')
      .eq('organization_id', org).eq('deal_number', dealNumber).maybeSingle();
    if (error) throw error;
    deal = (data ?? null) as Row | null;
  }
  if (orderNumber && !deal) {
    const { data, error } = await supabaseAdmin.from('trading_sales_orders')
      .select('currency, selling_rate, payment_terms')
      .eq('organization_id', org).eq('order_number', orderNumber).maybeSingle();
    if (error) throw error;
    order = (data ?? null) as Row | null;
  }
  let creditDays: number | null = null;
  const customerId = deal?.customer_id;
  if (typeof customerId === 'string' && customerId) {
    const { data: client, error } = await supabaseAdmin.from('clients').select('credit_days').eq('organization_id', org).eq('id', customerId).maybeSingle();
    if (error) throw error;
    const days = (client as Row | null)?.credit_days;
    creditDays = days == null ? null : Number(days);
  }
  const quantity = Number(shipment.quantity) || 0;
  const sellingRate = Number(deal?.selling_rate ?? order?.selling_rate) || 0;
  const discountPercent = Number(deal?.discount_percent) || 0;
  return {
    quantity, sellingRate, discountPercent,
    goodsValue: round2(quantity * sellingRate * (1 - discountPercent / 100)),
    taxPercent: Number(deal?.tax_percent) || 0,
    currency: String(deal?.currency ?? order?.currency ?? '').trim(),
    paymentDays: daysFromPaymentTerms(deal?.payment_terms ?? order?.payment_terms) ?? (creditDays != null && Number.isFinite(creditDays) ? creditDays : null),
  };
}

// When a shipment is Delivered, the customer is billed: one DRAFT customer invoice per shipment.
//   Subtotal = goods value (the agreed quotation amount for this shipment) + the shipment's open sell charges.
//   Charges already inside the quotation are never added: only Shipment Charges rows are, and each is billed once.
// It is a Draft on purpose, so a person checks the amounts before marking it Sent. Skipped when there is no customer,
// or when the shipment already has a (non-cancelled) invoice, so saving the shipment again never makes a second one.
async function autoCreateCustomerInvoice(org: string, shipment: Record<string, unknown>) {
  try {
    const shipmentNumber = typeof shipment.shipment_number === 'string' ? shipment.shipment_number : '';
    const customerName = typeof shipment.customer_name === 'string' ? shipment.customer_name.trim() : '';
    if (!shipmentNumber || !customerName) return;
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('trading_customer_invoices').select('id')
      .eq('organization_id', org).eq('shipment_number', shipmentNumber).neq('status', 'Cancelled').limit(1);
    if (existingError) throw existingError;
    if ((existing ?? []).length) return;

    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
    const basis = await invoiceBasisForShipment(org, shipment);
    const { data: charges, error: chargesError } = await supabaseAdmin
      .from('trading_shipment_charges').select('currency, sell_amount, status')
      .eq('organization_id', org).eq('shipment_number', shipmentNumber).is('invoice_number', null);
    if (chargesError) throw chargesError;
    const open = ((charges ?? []) as Row[]).filter((c) => c.status !== 'Cancelled');
    const currency = basis.currency || String(open.find((c) => c.currency)?.currency ?? '');
    const chargesValue = round2(open.filter((c) => String(c.currency ?? '') === currency).reduce((sum, c) => sum + (Number(c.sell_amount) || 0), 0));
    const subtotal = round2(basis.goodsValue + chargesValue);

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const dueDate = basis.paymentDays == null ? null : addDays(today, basis.paymentDays);
    const figures = { subtotal, tax_percent: basis.taxPercent, paid_amount: 0, due_date: dueDate, status: 'Draft' };
    const breakdown = `Goods ${basis.goodsValue}${currency ? ` ${currency}` : ''} (${basis.quantity} x ${basis.sellingRate}${basis.discountPercent ? `, less ${basis.discountPercent}% discount` : ''}) + shipment charges ${chargesValue}.`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invoiceNumber = await nextCustomerInvoiceNumber(org);
      const { error } = await supabaseAdmin.from('trading_customer_invoices').insert({
        organization_id: org,
        industry_type_id: shipment.industry_type_id ?? null,
        invoice_number: invoiceNumber,
        shipment_number: shipmentNumber,
        deal_number: shipment.deal_number ?? null,
        customer_name: customerName,
        invoice_date: today,
        due_date: dueDate,
        currency: currency || null,
        subtotal,
        tax_percent: basis.taxPercent,
        paid_amount: 0,
        ...computeInvoiceTotals(figures, today),
        notes: `Automatically created when shipment ${shipmentNumber} was delivered. ${breakdown} Please check the amounts, then mark it Sent.`,
      });
      if (error) {
        if (error.code === '23505') continue; // number taken meanwhile: pick the next free one
        throw error;
      }
      // Billing a shipment locks in its open charges: they now belong to this invoice.
      await supabaseAdmin.from('trading_shipment_charges').update({ invoice_number: invoiceNumber })
        .eq('organization_id', org).eq('shipment_number', shipmentNumber).is('invoice_number', null).eq('currency', currency);
      // An advance paid before delivery is applied to the new invoice (recalculated from the payments, never added twice).
      await syncInvoicePaymentsForDeal(org, typeof shipment.deal_number === 'string' ? shipment.deal_number : '');
      return;
    }
  } catch (error) {
    logger.error({ err: error, shipmentNumber: shipment.shipment_number }, 'Automatic customer invoice creation failed');
  }
}
// Next free CINV-<year>-<0001> across the whole organization (same style the form uses by hand).
async function nextCustomerInvoiceNumber(org: string): Promise<string> {
  const prefix = `CINV-${new Date().getFullYear()}-`;
  const { data, error } = await supabaseAdmin.from('trading_customer_invoices').select('invoice_number')
    .eq('organization_id', org).like('invoice_number', `${prefix}%`);
  if (error) fail(error);
  let max = 0;
  for (const row of (data ?? []) as Array<{ invoice_number: string | null }>) {
    const n = Number((row.invoice_number ?? '').slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// Payments recorded in Collections (against the Deal's core order, in the company currency) flow onto the Deal's
// customer invoices: converted to the Deal's currency, then allocated oldest invoice first. paid_amount only ever goes
// UP here (a figure typed by hand is never lowered) and is recalculated from the payments each time, so an advance is
// never counted twice. Status, balance and tax are recalculated by computeInvoiceTotals.
async function syncInvoicePaymentsForDeal(org: string, dealNumber: string) {
  try {
    if (!dealNumber) return;
    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
    const { data: dealRow, error: dealError } = await supabaseAdmin.from('trading_deals')
      .select('deal_number, currency, industry_type_id, core_order_id')
      .eq('organization_id', org).eq('deal_number', dealNumber).maybeSingle();
    if (dealError) throw dealError;
    const deal = dealRow as Row | null;
    if (!deal || !deal.core_order_id) return;
    const dealCurrency = String(deal.currency ?? '').trim();
    const fx = await baseRateFor(org, deal.industry_type_id, dealCurrency);
    if (fx.rate == null || fx.rate <= 0) {
      logger.warn({ dealNumber, currency: dealCurrency }, 'Invoice payments NOT synced: no exchange rate to the company currency.');
      return;
    }
    const { data: paymentRows, error: paymentError } = await supabaseAdmin.from('sales_collections')
      .select('amount, reference_no, created_at')
      .eq('organization_id', org).eq('sale_order_id', deal.core_order_id as string).order('created_at', { ascending: true });
    if (paymentError) throw paymentError;
    const payments = (paymentRows ?? []) as Row[];
    if (!payments.length) return;
    const collectedBase = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const { data: coreOrder, error: coreError } = await supabaseAdmin.from('sale_orders')
      .select('total_amount').eq('organization_id', org).eq('id', deal.core_order_id as string).maybeSingle();
    if (coreError) throw coreError;
    const orderTotal = Number((coreOrder as Row | null)?.total_amount) || 0;
    const last = payments[payments.length - 1];
    const { data: invoiceRows, error: invoiceError } = await supabaseAdmin.from('trading_customer_invoices').select('*')
      .eq('organization_id', org).eq('deal_number', dealNumber).neq('status', 'Cancelled')
      .order('invoice_date', { ascending: true }).order('invoice_number', { ascending: true });
    if (invoiceError) throw invoiceError;
    const invoices = (invoiceRows ?? []) as Row[];
    if (!invoices.length) return;
    const invoicedBase = invoices.reduce((sum, i) => sum + (Number(i.total_amount) || 0), 0) * fx.rate;
    // Company currency is exact. For a foreign-currency deal today's rate may differ from the rate used when the order
    // was made, so when the payments cover EVERYTHING ordered and billed, the invoices count as fully paid.
    const coversAll = fx.rate !== 1 && collectedBase + 0.01 >= Math.max(orderTotal, invoicedBase);
    let remaining = coversAll ? Number.POSITIVE_INFINITY : round2(collectedBase / fx.rate);
    for (const inv of invoices) {
      const invoiceCurrency = String(inv.currency ?? '').trim();
      if (invoiceCurrency && dealCurrency && invoiceCurrency !== dealCurrency) continue; // different currency: never guess
      const total = Number(inv.total_amount) || 0;
      const allocated = round2(Math.min(remaining, total));
      remaining = remaining - allocated;
      if (allocated <= (Number(inv.paid_amount) || 0)) continue;
      const patch = {
        paid_amount: allocated,
        payment_date: String(last.created_at ?? '').slice(0, 10) || null,
        payment_reference: (last.reference_no as string | null) ?? (inv.payment_reference as string | null) ?? null,
      };
      const { error } = await supabaseAdmin.from('trading_customer_invoices')
        .update({ ...patch, ...computeInvoiceTotals({ ...inv, ...patch }) })
        .eq('organization_id', org).eq('id', inv.id as string);
      if (error) throw error;
    }
  } catch (error) {
    logger.error({ err: error, dealNumber }, 'Syncing collections onto customer invoices failed');
  }
}

// Called by Collections after a payment is saved. Orders that do not belong to a Trading deal are ignored.
export async function syncInvoicePaymentsForSaleOrder(org: string, saleOrderId: string | null | undefined) {
  try {
    if (!saleOrderId) return;
    const { data, error } = await supabaseAdmin.from('trading_deals').select('deal_number')
      .eq('organization_id', org).eq('core_order_id', saleOrderId).maybeSingle();
    if (error) throw error;
    const dealNumber = (data as Row | null)?.deal_number;
    if (typeof dealNumber === 'string' && dealNumber) await syncInvoicePaymentsForDeal(org, dealNumber);
  } catch (error) {
    logger.error({ err: error, saleOrderId }, 'Syncing a collection onto its customer invoice failed');
  }
}

// A cancelled shipment is no longer billed: its DRAFT invoice is cancelled and the charges go back to "open".
// An invoice that was already sent or has money on it is NOT touched (it needs a manual credit note); it is logged.
async function autoCancelInvoiceOnShipmentCancel(org: string, shipment: Record<string, unknown>) {
  try {
    const shipmentNumber = typeof shipment.shipment_number === 'string' ? shipment.shipment_number : '';
    if (!shipmentNumber) return;
    const { data, error } = await supabaseAdmin.from('trading_customer_invoices')
      .select('id, invoice_number, status, paid_amount')
      .eq('organization_id', org).eq('shipment_number', shipmentNumber).neq('status', 'Cancelled');
    if (error) throw error;
    for (const inv of (data ?? []) as Row[]) {
      if (inv.status !== 'Draft' || (Number(inv.paid_amount) || 0) > 0) {
        logger.warn({ shipmentNumber, invoiceNumber: inv.invoice_number }, 'Shipment cancelled but its invoice was already sent or paid: handle it manually.');
        continue;
      }
      const { error: cancelError } = await supabaseAdmin.from('trading_customer_invoices')
        .update({ status: 'Cancelled', notes: `Cancelled automatically because shipment ${shipmentNumber} was cancelled.` })
        .eq('organization_id', org).eq('id', inv.id as string);
      if (cancelError) throw cancelError;
      await supabaseAdmin.from('trading_shipment_charges').update({ invoice_number: null })
        .eq('organization_id', org).eq('invoice_number', inv.invoice_number as string);
    }
  } catch (error) {
    logger.error({ err: error, shipmentNumber: shipment.shipment_number }, 'Cancelling the invoice of a cancelled shipment failed');
  }
}

// Charges are often entered AFTER the shipment is delivered, when its invoice already exists as a Draft. While the
// invoice is still a Draft it follows the shipment's charges: goods (first invoice of the shipment only, so a second
// invoice never bills the goods again) + every live sell charge in the invoice's currency. A Sent / Paid invoice is
// never changed: a charge added later stays open for its own invoice.
async function rebuildDraftInvoiceFromCharges(org: string, shipmentNumber: string) {
  try {
    if (!shipmentNumber) return;
    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
    const { data: invoiceRows, error } = await supabaseAdmin.from('trading_customer_invoices').select('*')
      .eq('organization_id', org).eq('shipment_number', shipmentNumber).neq('status', 'Cancelled').order('created_at', { ascending: true });
    if (error) throw error;
    const invoices = (invoiceRows ?? []) as Row[];
    const draft = invoices.find((i) => i.status === 'Draft');
    if (!draft) return;
    const { data: shipmentRow, error: shipmentError } = await supabaseAdmin.from('trading_shipments').select('*')
      .eq('organization_id', org).eq('shipment_number', shipmentNumber).maybeSingle();
    if (shipmentError) throw shipmentError;
    if (!shipmentRow) return;
    const basis = await invoiceBasisForShipment(org, shipmentRow as Row);
    const { data: chargeRows, error: chargeError } = await supabaseAdmin.from('trading_shipment_charges')
      .select('id, currency, sell_amount, status, invoice_number').eq('organization_id', org).eq('shipment_number', shipmentNumber);
    if (chargeError) throw chargeError;
    const mine = ((chargeRows ?? []) as Row[]).filter((c) => c.invoice_number == null || c.invoice_number === draft.invoice_number);
    const live = mine.filter((c) => c.status !== 'Cancelled');
    const currency = String(draft.currency ?? '').trim() || basis.currency || String(live.find((c) => c.currency)?.currency ?? '');
    const billable = live.filter((c) => String(c.currency ?? '') === currency);
    const chargesValue = round2(billable.reduce((sum, c) => sum + (Number(c.sell_amount) || 0), 0));
    const goods = draft.id === invoices[0].id ? basis.goodsValue : 0;
    const patch = { subtotal: round2(goods + chargesValue), currency: currency || null };
    const { error: updateError } = await supabaseAdmin.from('trading_customer_invoices')
      .update({ ...patch, ...computeInvoiceTotals({ ...draft, ...patch }) })
      .eq('organization_id', org).eq('id', draft.id as string);
    if (updateError) throw updateError;
    const billIds = billable.map((c) => c.id as string);
    if (billIds.length) await supabaseAdmin.from('trading_shipment_charges').update({ invoice_number: draft.invoice_number }).eq('organization_id', org).in('id', billIds);
    const freeIds = mine.filter((c) => c.status === 'Cancelled' && c.invoice_number === draft.invoice_number).map((c) => c.id as string);
    if (freeIds.length) await supabaseAdmin.from('trading_shipment_charges').update({ invoice_number: null }).eq('organization_id', org).in('id', freeIds);
  } catch (error) {
    logger.error({ err: error, shipmentNumber }, 'Refreshing the draft invoice from shipment charges failed');
  }
}

// Core order id -> total of its FINAL Trading invoices (Sent / Partially Paid / Paid / Overdue; Draft and Cancelled are
// not final), in the company currency. Collections uses it so the amount due follows the final invoice, not only the quote.
export async function billedTotalsForCoreOrders(org: string, orderIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  try {
    if (!orderIds.length) return result;
    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
    const deals: Row[] = [];
    for (let i = 0; i < orderIds.length; i += 100) {
      const { data, error } = await supabaseAdmin.from('trading_deals').select('deal_number, currency, industry_type_id, core_order_id')
        .eq('organization_id', org).in('core_order_id', orderIds.slice(i, i + 100));
      if (error) throw error;
      deals.push(...((data ?? []) as Row[]));
    }
    if (!deals.length) return result;
    const { data: invoiceRows, error: invoiceError } = await supabaseAdmin.from('trading_customer_invoices')
      .select('deal_number, total_amount').eq('organization_id', org)
      .in('deal_number', deals.map((d) => String(d.deal_number))).neq('status', 'Draft').neq('status', 'Cancelled');
    if (invoiceError) throw invoiceError;
    const invoices = (invoiceRows ?? []) as Row[];
    const rates = new Map<string, number | null>();
    for (const deal of deals) {
      const currency = String(deal.currency ?? '').trim();
      const key = `${String(deal.industry_type_id ?? '')}|${currency}`;
      if (!rates.has(key)) rates.set(key, (await baseRateFor(org, deal.industry_type_id, currency)).rate);
      const rate = rates.get(key);
      if (rate == null) continue;
      const total = invoices.filter((i) => i.deal_number === deal.deal_number).reduce((sum, i) => sum + (Number(i.total_amount) || 0), 0);
      result.set(deal.core_order_id as string, round2(total * rate));
    }
  } catch (error) {
    logger.error({ err: error }, 'Reading the billed totals of orders failed');
  }
  return result;
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
       if (!deal.core_order_number && (!customerId || !productName)) {
      logger.warn({ dealNumber }, 'Core order NOT created: the deal has no customer ID or product. Pick the customer from the list and save again.');
    }
    if (customerId && productName && !deal.core_order_number && fx.rate == null) {
      logger.error({ dealNumber, currency: deal.currency }, 'Core order NOT created: no exchange rate to the company currency. Add the rate in Currency Management.');
    } else if (customerId && productName && !deal.core_order_number) {
         const { data: product } = await supabaseAdmin.from('products').select('id').eq('organization_id', org).ilike('product_name', productName.trim()).limit(1).maybeSingle();
      if (!product) logger.warn({ dealNumber, productName }, 'Core order NOT created: no product in the catalog with this name.');
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
// Auto Profitability: ONE Deal-level row per deal that moves through stages.
//   Confirmed   -> created as [Estimated]   (agreed revenue minus the costs known so far)
//   In Progress -> updated as [Provisional] (real costs replace estimates as they are entered)
//   Completed   -> set to [Final] and locked (never auto-changed again)
//   Refresh     -> a cost record changed: recalculate, keeping the current stage
// The stage is stored as a tag at the start of `notes`. A row with no tag (older rows, or
// one made by hand) is treated as Final and is never overwritten.
// Same formulas as chainFinancials() in admin/src/lib/tradingChain.ts.
// Missing costs stay null (never 0). Never throws, so it can never block a deal / shipment save.
type ProfitStage = 'Confirmed' | 'In Progress' | 'Completed' | 'Refresh';
const PROFIT_BASIS: Record<Exclude<ProfitStage, 'Refresh'>, string> = { 'Confirmed': 'Estimated', 'In Progress': 'Provisional', 'Completed': 'Final' };
const PROFIT_TAG = /^\[(Estimated|Provisional|Final)\]/;
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
// Logistics and Customs rows are saved in the currency they were paid in (e.g. USD 3,000) together with the rate and
// the company currency. Profit is reported in the DEAL's currency, so every such amount goes through sumInCurrency()
// (lib/currency-sum.ts) - the same rule the admin Recalculate button uses (sumInCurrency in tradingChain.ts).
const mergeRows = (...lists: Row[][]): Row[] => {
  const seen = new Map<string, Row>();
  for (const list of lists) for (const row of list) seen.set(String(row.id ?? `${seen.size}`), row);
  return [...seen.values()];
};

async function syncProfitabilitySnapshot(org: string, dealNumber: string, stage: ProfitStage, requireDelivered = false, lateCost = false) {
  try {
    const { data: existingRow, error: existingError } = await supabaseAdmin.from('trading_profitability').select('*')
      .eq('organization_id', org).eq('deal_number', dealNumber).eq('analysis_level', 'Deal').limit(1).maybeSingle();
    if (existingError) throw existingError;
    const existingProfit = (existingRow ?? null) as Row | null;
    const existingNotes = String(existingProfit?.notes ?? '');
    // Rows made by the system before stages existed count as Final; hand-made rows are never touched.
    const existingTag = PROFIT_TAG.exec(existingNotes)?.[1] ?? (/^Automatically created when deal/.test(existingNotes) ? 'Final' : undefined);
    if (existingProfit && !existingTag) return;
    // Final is locked, except that a late cost (commission becomes Eligible only after delivery and payment,
    // finance charges arrive with the bank) is added to it.
    const reopenFinal = existingTag === 'Final' && stage === 'Refresh' && lateCost;
    if (existingProfit && existingTag === 'Final' && !reopenFinal) return;
    // A cost changed but this deal has no live profit row yet: nothing to refresh.
    if (stage === 'Refresh' && !existingProfit) return;
    const basis = stage === 'Refresh' ? String(existingTag) : PROFIT_BASIS[stage];
    // Never move backwards (e.g. saving a Confirmed deal again after it is In Progress).
    if (existingTag === 'Provisional' && basis === 'Estimated') return;

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
    if (stage === 'Completed' && requireDelivered && shipments.some((s) => !['Delivered', 'Completed', 'Cancelled'].includes(String(s.status ?? '')))) return;

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
      const soldQty = toNum(dealRow.customer_quantity);
      const q = soldQty != null && soldQty > 0 ? soldQty : toNum(dealRow.quantity);
      const rate = toNum(dealRow.purchase_rate);
      const supplierDiscount = toNum(dealRow.purchase_discount_percent) ?? 0;
      if (q != null && rate != null) { purchaseCost = q * rate * (1 - supplierDiscount / 100); purchaseSource = supplierDiscount ? `Deal · qty x purchase rate less ${supplierDiscount}% supplier discount` : 'Deal · qty x purchase rate'; }
    }
    if (purchaseCost == null && enquiry) {
      const q = toNum(enquiry.quantity); const rate = toNum(enquiry.requested_rate);
      const enquiryDiscount = toNum(enquiry.discount_percent) ?? 0;
      if (q != null && rate != null) { purchaseCost = q * rate * (1 - enquiryDiscount / 100); purchaseSource = enquiryDiscount ? `Purchase Enquiry · requested rate less ${enquiryDiscount}% supplier discount` : 'Purchase Enquiry · requested rate'; }
    }

    const logisticsFreight = sumInCurrency(logistics, 'freight_cost', currency);
    let freight = logisticsFreight;
    if (freight == null) {
      // A shipment's own freight is in the company currency; the report is in the deal's currency.
      const shipmentFreight = sumOf(shipments, 'freight_cost');
      const fx = shipmentFreight != null ? await baseRateFor(org, dealRow.industry_type_id, currency) : null;
      freight = shipmentFreight != null && fx && fx.rate != null && fx.rate > 0 ? Math.round((shipmentFreight / fx.rate) * 100) / 100 : shipmentFreight;
    }
    const freightSource = logisticsFreight != null ? `Logistics · freight charges (in ${currency})` : (freight != null ? 'Shipment · freight cost' : '');
    // Customs duty and port charges are levied in the company currency (the Customs page shows them that way), so
    // they are NOT multiplied by the record's own exchange rate; they only move into the deal's currency when that differs.
    const dealFx = await baseRateFor(org, dealRow.industry_type_id, currency);
    const fromCompanyCurrency = (n: number | null): number | null => (n != null && dealFx.rate != null && dealFx.rate > 0 && currency.trim().toUpperCase() !== dealFx.base ? Math.round((n / dealFx.rate) * 100) / 100 : n);
    const customsDuty = fromCompanyCurrency(sumOf(customs, 'customs_duty'));
    const portCharges = fromCompanyCurrency(sumOf(customs, 'other_charges'));
    const otherCosts = sumInCurrency(logistics, 'other_charges', currency);
    const financeCharges = sumOf(finance, 'finance_charges');
    const commission = sumOf(commissions.filter((c) => EARNED_COMMISSION_STATUSES.includes(String(c.status ?? ''))), 'commission_amount');

    // "Not applicable": a cost that can never exist for this deal is not counted as missing.
    // Same wording and rules as chainFinancials() in the admin tradingChain.ts.
    const isTradeDeal = tradeRows.length > 0 || customs.length > 0;
    const naTrade = !isTradeDeal ? 'domestic deal, no import/export or customs record' : undefined;
    const naFinance = finance.length === 0 ? 'no trade finance record' : undefined;
    const naCommission = commissions.length === 0 && !String(dealRow.sales_rep ?? '').trim() ? 'no commission record or sales rep' : undefined;
    const insuranceAmount = toNum(existingProfit?.insurance);

    const lines: Array<{ key: string; label: string; amount: number | null; source: string; na?: string }> = [
      { key: 'purchase_cost', label: 'Purchase / product cost', amount: purchaseCost, source: purchaseSource },
      { key: 'freight', label: 'Freight / logistics', amount: freight, source: freightSource },
      { key: 'customs_duty', label: 'Customs duty', amount: customsDuty, source: customsDuty != null ? 'Customs & Clearance' : '', na: customsDuty == null ? naTrade : undefined },
      { key: 'port_charges', label: 'Port / clearance charges', amount: portCharges, source: portCharges != null ? 'Customs & Clearance · other charges' : '', na: portCharges == null ? naTrade : undefined },
      { key: 'insurance', label: 'Insurance', amount: insuranceAmount, source: insuranceAmount != null ? 'Entered manually' : '', na: insuranceAmount == null ? 'optional, not entered' : undefined },
      { key: 'other_costs', label: 'Other trade costs', amount: otherCosts, source: otherCosts != null ? `Logistics · other charges (in ${currency})` : '', na: otherCosts == null ? 'optional, none entered' : undefined },
      { key: 'finance_charges', label: 'Trade finance charges', amount: financeCharges, source: financeCharges != null ? 'Trade Finance' : '', na: financeCharges == null ? naFinance : undefined },
      { key: 'commission', label: 'Commission', amount: commission, source: commission != null ? 'Commission Management · earned' : '', na: commission == null ? naCommission : undefined },
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
      cost_sources: lines.map((l) => `${l.label}: ${l.amount == null ? (l.na ? `not applicable (${l.na})` : 'not recorded') : `${l.amount} (${l.source})`}`).join('\n'),
      status: profitStatus,
      notes: [
        `[${basis}] ${reopenFinal ? `Final figures, revised ${new Date().toISOString().slice(0, 10)} when a late cost (commission, finance, logistics or customs) was recorded.` : basis === 'Final' ? `Final figures, locked when deal ${dealNumber} was completed.` : basis === 'Provisional' ? `Provisional: deal ${dealNumber} is in progress; costs update as they are recorded.` : `Estimate created when deal ${dealNumber} was confirmed; costs update as they are recorded.`}`,
        ...existingNotes.split('\n').slice(1),
      ].join('\n').trim(),
    };
    for (const line of lines) record[line.key] = line.amount;

    if (existingProfit) {
      const { organization_id: _org, ...changes } = record;
      const { error } = await supabaseAdmin.from('trading_profitability').update(changes).eq('organization_id', org).eq('id', existingProfit.id as string);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from('trading_profitability').insert(record);
      if (error && error.code !== '23505') throw error;
    }
  } catch (error) {
    logger.error({ err: error, dealNumber }, 'Automatic profitability sync failed');
  }
}

// A cost-carrying record was saved (logistics, customs, finance, commission, shipment, import/export):
// recalculate that deal's profit if it already has a live (Estimated / Provisional) row.
const PROFIT_COST_TABLES = new Set(['trading_logistics', 'trading_customs', 'trading_trade_finance', 'trading_commissions', 'trading_shipments', 'trading_import_export']);
// Costs that can legitimately arrive after the deal is Final: they reopen a system-made Final row (never a hand-made one).
const LATE_COST_TABLES = new Set(['trading_commissions', 'trading_trade_finance', 'trading_logistics', 'trading_customs']);
async function refreshProfitabilityForRecord(org: string, table: string, row: Row) {
  try {
    if (!PROFIT_COST_TABLES.has(table)) return;
    let dealNumber = typeof row.deal_number === 'string' ? row.deal_number : '';
    if (!dealNumber && typeof row.shipment_number === 'string' && row.shipment_number) {
      const { data } = await supabaseAdmin.from('trading_shipments').select('deal_number').eq('organization_id', org).eq('shipment_number', row.shipment_number).limit(1).maybeSingle();
      dealNumber = String((data as Row | null)?.deal_number ?? '');
    }
    if (!dealNumber && typeof row.transaction_number === 'string' && row.transaction_number) {
      const { data } = await supabaseAdmin.from('trading_import_export').select('deal_number').eq('organization_id', org).eq('transaction_number', row.transaction_number).limit(1).maybeSingle();
      dealNumber = String((data as Row | null)?.deal_number ?? '');
    }
    if (dealNumber) await syncProfitabilitySnapshot(org, dealNumber, 'Refresh', false, LATE_COST_TABLES.has(table));
  } catch (error) {
    logger.error({ err: error, table }, 'Profitability refresh after cost change failed');
  }
}

// ---------------------------------------------------------------------------
// Import/Export <-> Customs <-> Compliance links.
// Same rules as the other cascades in this file: every helper is best-effort and NEVER throws,
// because the record the person just saved has already succeeded.
// ---------------------------------------------------------------------------

// Marks a compliance check the system opened itself. While it says this, the suggested risk keeps following the paperwork.
const AUTO_CHECKED_BY = 'System (auto)';

/** Next free "<PREFIX>-<year>-<0001>" across the WHOLE organization (the database's unique rule counts every industry). */
async function nextOrgReference(org: string, table: string, column: string, prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const { data, error } = await supabaseAdmin.from(table).select(column).eq('organization_id', org).like(column, `${prefix}-${year}-%`);
  if (error) throw error;
  return nextReference(prefix, ((data ?? []) as unknown as Row[]).map((r) => r[column]), year);
}

const cleanList = (values: unknown[]): string[] => [...new Set(values.map((v) => (v == null ? '' : String(v).trim())).filter(Boolean))];

/** Rows of `table` that match ANY of the given keys (deduplicated by id). Skips a key when it has no values. */
async function fetchByAnyKey(org: string, table: string, keys: Record<string, string[]>): Promise<Row[]> {
  const found = new Map<string, Row>();
  for (const [column, values] of Object.entries(keys)) {
    if (values.length === 0) continue;
    const { data, error } = await supabaseAdmin.from(table).select('*').eq('organization_id', org).in(column, values);
    if (error) throw error;
    for (const row of (data ?? []) as Row[]) found.set(String(row.id), row);
  }
  return [...found.values()];
}

/** Reads the shipment, transaction, customs, document and claim records a compliance check depends on. */
async function loadComplianceInputs(org: string, anchor: { deal_number?: unknown; shipment_number?: unknown; transaction_number?: unknown }): Promise<ComplianceInputs> {
  const shipmentNumber = String(anchor.shipment_number ?? '').trim();
  const transactionNumber = String(anchor.transaction_number ?? '').trim();
  let dealNumber = String(anchor.deal_number ?? '').trim();

  // Anchor on the shipment when there is one, otherwise on the deal (the same order the screen uses).
  const shipments = shipmentNumber
    ? await fetchByAnyKey(org, 'trading_shipments', { shipment_number: [shipmentNumber] })
    : await fetchByAnyKey(org, 'trading_shipments', { deal_number: cleanList([dealNumber]) });
  if (!dealNumber) dealNumber = String(shipments[0]?.deal_number ?? '').trim();
  const shipmentNumbers = cleanList([shipmentNumber, ...shipments.map((s) => s.shipment_number)]);
  const deals = cleanList([dealNumber]);

  const transactions = await fetchByAnyKey(org, 'trading_import_export', { transaction_number: cleanList([transactionNumber]), shipment_number: shipmentNumbers, deal_number: deals });
  const transactionNumbers = cleanList([transactionNumber, ...transactions.map((t) => t.transaction_number)]);
  const customs = await fetchByAnyKey(org, 'trading_customs', { shipment_number: shipmentNumbers, transaction_number: transactionNumbers });
  const documents = await fetchByAnyKey(org, 'trading_documents', { shipment_number: shipmentNumbers, deal_number: deals });
  const claims = await fetchByAnyKey(org, 'trading_claims', { shipment_number: shipmentNumbers, transaction_number: transactionNumbers });
  return { transactions, customs, shipments, documents, claims };
}

// A new Import/Export transaction always needs a customs declaration, so start one (status "Not Started").
// Skipped when this transaction already has one (a person may have raised it by hand first).
async function autoCreateCustomsForTransaction(org: string, txn: Row) {
  try {
    const transactionNumber = String(txn.transaction_number ?? '').trim();
    if (!transactionNumber || txn.status === 'Cancelled') return;
    const { data: existing, error: existingError } = await supabaseAdmin.from('trading_customs').select('id').eq('organization_id', org).eq('transaction_number', transactionNumber).limit(1).maybeSingle();
    if (existingError) throw existingError;
    if (existing) return;
    // The shipment may already have its own customs record (created when it was Ready to Ship): link it instead of adding a second one.
    const shipmentNumber = String(txn.shipment_number ?? '').trim();
    if (shipmentNumber) {
      const { data: byShipment } = await supabaseAdmin.from('trading_customs').select('id, transaction_number').eq('organization_id', org).eq('shipment_number', shipmentNumber).limit(1).maybeSingle();
      if (byShipment) {
        if (!(byShipment as { transaction_number?: string | null }).transaction_number) {
          await supabaseAdmin.from('trading_customs').update({ transaction_number: transactionNumber, transaction_type: txn.transaction_type ?? null }).eq('organization_id', org).eq('id', (byShipment as { id: string }).id);
        }
        return;
      }
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reference = await nextOrgReference(org, 'trading_customs', 'customs_reference', 'CUS');
      const { error } = await supabaseAdmin.from('trading_customs').insert({ ...customsFromTransaction(txn, reference), organization_id: org, industry_type_id: txn.industry_type_id ?? null });
      if (!error) return;
      if (error.code !== '23505') throw error;
    }
  } catch (error) {
    logger.error({ err: error, transactionNumber: txn.transaction_number }, 'Automatic customs record for the transaction failed');
  }
}

// A new Import/Export transaction also gets a Compliance check, so paperwork gaps show up without anyone remembering to look.
// It starts open ("Pending Review" / "Failed") and is NEVER auto-passed - a person signs it off.
async function autoCreateComplianceForTransaction(org: string, txn: Row) {
  try {
    const transactionNumber = String(txn.transaction_number ?? '').trim();
    const shipmentNumber = String(txn.shipment_number ?? '').trim();
    if (!transactionNumber || txn.status === 'Cancelled') return;
    const already = await fetchByAnyKey(org, 'trading_compliance', { transaction_number: [transactionNumber], shipment_number: cleanList([shipmentNumber]) });
    if (already.length > 0) return;
    const inputs = await loadComplianceInputs(org, txn);
    const snapshot = buildComplianceSnapshot(inputs);
    const customs = inputs.customs[0];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reference = await nextOrgReference(org, 'trading_compliance', 'compliance_reference', 'CMP');
      const { error } = await supabaseAdmin.from('trading_compliance').insert({
        organization_id: org,
        industry_type_id: txn.industry_type_id ?? null,
        compliance_reference: reference,
        compliance_type: complianceTypeFor(txn.transaction_type),
        deal_number: txn.deal_number ?? null,
        shipment_number: txn.shipment_number ?? null,
        transaction_number: transactionNumber,
        customs_reference: customs?.customs_reference ?? null,
        customer_name: txn.customer_name ?? null,
        supplier_name: txn.supplier_name ?? null,
        product_name: txn.product_name ?? null,
        country: txn.destination_country ?? null,
        hs_code: customs?.hs_code ?? null,
        incoterm: txn.incoterm ?? null,
        required_documents: snapshot.required_documents,
        missing_documents: snapshot.missing_documents,
        expired_documents: snapshot.expired_documents,
        document_status: snapshot.document_status,
        customs_status: snapshot.customs_status,
        shipment_status: snapshot.shipment_status,
        risk_level: snapshot.suggested_risk,
        check_date: new Date().toISOString().slice(0, 10),
        checked_by: AUTO_CHECKED_BY,
        status: snapshot.suggested_status,
        notes: `Automatically created from ${transactionNumber}.`,
      });
      if (!error) return;
      if (error.code !== '23505') throw error;
    }
  } catch (error) {
    logger.error({ err: error, transactionNumber: txn.transaction_number }, 'Automatic compliance check for the transaction failed');
  }
}

// Customs moved (declaration submitted, duty paid, cleared...): move the Import/Export transaction that it belongs to.
async function syncTransactionFromCustoms(org: string, customs: Row) {
  try {
    const clearance = String(customs.clearance_status ?? '').trim();
    if (!clearance) return;
    let query = supabaseAdmin.from('trading_import_export').select('*').eq('organization_id', org);
    const transactionNumber = String(customs.transaction_number ?? '').trim();
    const shipmentNumber = String(customs.shipment_number ?? '').trim();
    if (transactionNumber) query = query.eq('transaction_number', transactionNumber);
    else if (shipmentNumber) query = query.eq('shipment_number', shipmentNumber);
    else return;
    const { data, error } = await query;
    if (error) throw error;
    for (const txn of (data ?? []) as Row[]) {
      const next = nextTransactionStatusFromCustoms(String(txn.status ?? ''), clearance);
      if (!next) continue;
      const { data: updated, error: updateError } = await supabaseAdmin.from('trading_import_export').update({ status: next }).eq('organization_id', org).eq('id', txn.id as string).select().maybeSingle();
      if (updateError) throw updateError;
      if (updated) await refreshComplianceForRecord(org, 'trading_import_export', updated as Row);
    }
  } catch (error) {
    logger.error({ err: error, customsReference: customs.customs_reference }, 'Syncing the transaction status from customs failed');
  }
}

// A shipment moved (dispatched, in transit, arrived, delivered): move the Import/Export transaction that carries it.
async function syncTransactionFromShipment(org: string, shipment: Row) {
  try {
    const shipmentNumber = String(shipment.shipment_number ?? '').trim();
    const status = String(shipment.status ?? '').trim();
    if (!shipmentNumber || !status) return;
    const { data, error } = await supabaseAdmin.from('trading_import_export').select('*').eq('organization_id', org).eq('shipment_number', shipmentNumber);
    if (error) throw error;
    for (const txn of (data ?? []) as Row[]) {
      const next = nextTransactionStatusFromShipment(String(txn.status ?? ''), status);
      if (!next) continue;
      const patch: Row = { status: next };
      if (status === 'Delivered' && !txn.actual_arrival_date) patch.actual_arrival_date = shipment.actual_delivery_date ?? new Date().toISOString().slice(0, 10);
      const { error: updateError } = await supabaseAdmin.from('trading_import_export').update(patch).eq('organization_id', org).eq('id', txn.id as string);
      if (updateError) throw updateError;
    }
  } catch (error) {
    logger.error({ err: error, shipmentNumber: shipment.shipment_number }, 'Syncing the transaction status from its shipment failed');
  }
}

// Paperwork, customs, the transaction or the shipment changed: re-read the position and refresh every OPEN compliance check
// that depends on it. A check a person has already signed off (Passed, Resolved, Closed, Exception...) is left exactly as they left it.
const COMPLIANCE_WATCHED_TABLES = new Set(['trading_documents', 'trading_customs', 'trading_import_export', 'trading_shipments', 'trading_claims']);
async function refreshComplianceForRecord(org: string, table: string, row: Row) {
  try {
    if (!COMPLIANCE_WATCHED_TABLES.has(table)) return;
    let shipmentNumber = String(row.shipment_number ?? '').trim();
    const transactionNumber = String(row.transaction_number ?? '').trim();
    let dealNumber = String(row.deal_number ?? '').trim();
    if (!dealNumber && shipmentNumber) {
      const { data } = await supabaseAdmin.from('trading_shipments').select('deal_number').eq('organization_id', org).eq('shipment_number', shipmentNumber).limit(1).maybeSingle();
      dealNumber = String((data as Row | null)?.deal_number ?? '').trim();
    }
    if (!shipmentNumber && transactionNumber) {
      const { data } = await supabaseAdmin.from('trading_import_export').select('shipment_number').eq('organization_id', org).eq('transaction_number', transactionNumber).limit(1).maybeSingle();
      shipmentNumber = String((data as Row | null)?.shipment_number ?? '').trim();
    }
    const checks = await fetchByAnyKey(org, 'trading_compliance', { shipment_number: cleanList([shipmentNumber]), transaction_number: cleanList([transactionNumber]), deal_number: cleanList([dealNumber]) });
    for (const check of checks) {
      if (!OPEN_COMPLIANCE_STATUSES.includes(String(check.status ?? '').trim())) continue;
      const inputs = await loadComplianceInputs(org, check);
      const snapshot = buildComplianceSnapshot(inputs);
      const customs = inputs.customs[0];
      const trade = inputs.transactions[0];
      const patch: Row = {
        required_documents: snapshot.required_documents,
        missing_documents: snapshot.missing_documents,
        expired_documents: snapshot.expired_documents,
        document_status: snapshot.document_status,
        customs_status: snapshot.customs_status,
        shipment_status: snapshot.shipment_status,
        check_date: new Date().toISOString().slice(0, 10),
        status: snapshot.suggested_status,
      };
      // Fill blanks only - never overwrite something a person typed.
      const fillIfBlank = (key: string, value: unknown) => { if (!String(check[key] ?? '').trim() && value != null && value !== '') patch[key] = value; };
      fillIfBlank('transaction_number', trade?.transaction_number);
      fillIfBlank('customs_reference', customs?.customs_reference);
      fillIfBlank('hs_code', customs?.hs_code);
      fillIfBlank('country', trade?.destination_country ?? customs?.destination_country);
      fillIfBlank('incoterm', trade?.incoterm);
      // The suggested risk follows the paperwork only until a person puts their own name on the check.
      const checkedBy = String(check.checked_by ?? '').trim();
      if (!checkedBy || checkedBy === AUTO_CHECKED_BY) patch.risk_level = snapshot.suggested_risk;
      const { error } = await supabaseAdmin.from('trading_compliance').update(patch).eq('organization_id', org).eq('id', check.id as string);
      if (error) throw error;
    }
  } catch (error) {
    logger.error({ err: error, table }, 'Refreshing compliance checks after a change failed');
  }
}

// One place that runs every Import/Export <-> Customs <-> Compliance follow-up for a saved record.
async function runTradeLinks(org: string, table: string, row: Row, isCreate: boolean) {
  if (table === 'trading_import_export' && isCreate) {
    // The shipment may already be on its way: start the transaction at the matching stage.
    const shipmentNumber = String(row.shipment_number ?? '').trim();
    if (shipmentNumber) {
      const { data } = await supabaseAdmin.from('trading_shipments').select('*').eq('organization_id', org).eq('shipment_number', shipmentNumber).limit(1).maybeSingle();
      if (data) await syncTransactionFromShipment(org, data as Row);
    }
    await autoCreateCustomsForTransaction(org, row);
    await autoCreateComplianceForTransaction(org, row);
    return;
  }
  if (table === 'trading_customs') await syncTransactionFromCustoms(org, row);
  if (table === 'trading_shipments') await syncTransactionFromShipment(org, row);
  await refreshComplianceForRecord(org, table, row);
}

// One-time catch-up for records saved BEFORE these links existed (see scripts/backfill-trade-links.ts).
// Safe to run again: it only creates a customs record / compliance check where one is missing, and only moves statuses forward.
export async function backfillTradeLinks(): Promise<{ transactions: number; customs: number }> {
  const { data: transactions, error } = await supabaseAdmin.from('trading_import_export').select('*');
  if (error) throw error;
  for (const txn of (transactions ?? []) as Row[]) await runTradeLinks(String(txn.organization_id), 'trading_import_export', txn, true);
  const { data: customs, error: customsError } = await supabaseAdmin.from('trading_customs').select('*');
  if (customsError) throw customsError;
  for (const row of (customs ?? []) as Row[]) {
    const org = String(row.organization_id);
    if (!String(row.clearance_status ?? '').trim()) {
      await supabaseAdmin.from('trading_customs').update({ clearance_status: 'Not Started', status: row.status || 'Not Started' }).eq('organization_id', org).eq('id', row.id as string);
    }
    await runTradeLinks(org, 'trading_customs', { ...row, clearance_status: row.clearance_status || 'Not Started' }, false);
  }
  return { transactions: (transactions ?? []).length, customs: (customs ?? []).length };
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
  // FMCG rates live in fmcg_currency_rates; give the shared Trade pages those rows.
  if (resource.table === 'trading_currency_rates' && industryTypeId && await isFmcgIndustry(org, industryTypeId)) return fmcgRatesAsTradingRows(org, industryTypeId);
  if (resource.table === 'trading_shipments' && industryTypeId && await isFmcgIndustry(org, industryTypeId)) return fmcgShipmentsAsTradingRows(org, industryTypeId);
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

// A delivery that has already happened cannot be dated in the future. One day of slack covers time zones (India is
// ahead of UTC). Without this a wrong date such as 2026-10-14 marks the movement Delivered and completes the deal early.
function assertNotFutureDelivery(resource: TradingResource, payload: Record<string, unknown>) {
  if (resource.table !== 'trading_logistics' && resource.table !== 'trading_shipments') return;
  const value = payload.actual_delivery_date;
  if (typeof value !== 'string' || !value) return;
  const limit = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (value.slice(0, 10) > limit) {
    throw new AppError(422, 'FUTURE_DELIVERY_DATE', `Actual delivery date ${value.slice(0, 10)} is in the future. Enter the date the goods were really delivered, or leave it blank until they are.`);
  }
}

export async function createTradingRecord(resource: TradingResource, org: string, input: Record<string, unknown>, scope: IndustryScope) {
  const payload = sanitizePayload(resource, input);
  assertNotFutureDelivery(resource, payload);
  if (!scope || !('role' in scope)) throw new AppError(400, 'VALIDATION_ERROR', 'Industry scope is required.');
  const industryTypeId = resolveIndustryTypeId(scope, typeof payload.industry_type_id === 'string' ? payload.industry_type_id : undefined);
  if (!industryTypeId) throw new AppError(400, 'VALIDATION_ERROR', 'industry_type_id is required.');
  if (resource.table === 'trading_price_lists') await validatePriceList(org, industryTypeId, payload);
  await stampForeignRate(resource.table, org, industryTypeId, payload);
  if (resource.table === 'trading_import_export') await assertTypeMatchesShipment(org, payload);
  if (resource.table === 'trading_documents') assertNoDirectReviewChange(payload);
  if (resource.table === 'trading_customs' && payload.clearance_status === 'Cleared') assertCanClear(payload);
  if (resource.table === 'trading_customer_invoices') {
    // The form sends blank fields as null, and the database does not accept null for these amounts. A blank means 0.
    for (const key of ['subtotal', 'tax_percent', 'paid_amount']) if (payload[key] == null) payload[key] = 0;
    Object.assign(payload, computeInvoiceTotals({ ...payload, status: payload.status || 'Sent' }));
  }
  // A customs record always starts as "Not Started" (never blank), and the plain status mirrors the clearance status.
  if (resource.table === 'trading_customs') {
    if (!payload.clearance_status) payload.clearance_status = 'Not Started';
    payload.status = payload.status || payload.clearance_status;
  }
  if (resource.table === 'trading_deals' && payload.status === 'Confirmed') await assertDealHasRate(org, industryTypeId, '', payload.currency);
  // A shipment made by hand that is tied to a deal or order carries goods to a customer.
  if (resource.table === 'trading_shipments' && !payload.direction) {
    payload.direction = payload.deal_number || payload.order_number ? 'outbound' : 'inbound';
  }
  // Purchase enquiries get their ENQ numberfrom the browser, which guesses it from the rows
  // it can currently see (filtered by industry). That guess can land on a number that already
  // exists, so on an enquiry_number clash we pick the next truly free number and retry.
  const isEnquiry = resource.table === 'trading_purchase_enquiries';
  for (let attempt = 0; ; attempt += 1) {
    const { data, error } = await supabaseAdmin.from(resource.table).insert({ ...payload, industry_type_id: industryTypeId, organization_id: org }).select().single();
    if (!error) {
      // Billing a shipment locks in its open charges: they now belong to this invoice.
      if (resource.table === 'trading_customer_invoices') {
        const inv = data as Record<string, unknown>;
        const { error: tagError } = await supabaseAdmin.from('trading_shipment_charges').update({ invoice_number: inv.invoice_number })
          .eq('organization_id', org).eq('shipment_number', inv.shipment_number as string).is('invoice_number', null)
          .eq('currency', String(inv.currency ?? ''));
          if (tagError) logger.warn({ err: tagError }, 'Could not tag shipment charges with the new invoice number');
        await syncInvoicePaymentsForDeal(org, String(inv.deal_number ?? ''));
      }
       if (resource.table === 'trading_shipments') await ensureLogisticsPlan(org, data as Record<string, unknown>);
      if (resource.table === 'trading_logistics') await syncFreightChargeFromLogistics(org, data as Record<string, unknown>);
      if (resource.table === 'trading_deals') await runDealSideEffects(org, data as Record<string, unknown>);
         if (resource.table === 'trading_shipment_charges') await rebuildDraftInvoiceFromCharges(org, String((data as Record<string, unknown>).shipment_number ?? ''));
      // A new cost record (logistics, customs, finance, commission...) updates the deal's live profit row.
      await refreshProfitabilityForRecord(org, resource.table, data as Record<string, unknown>);
      await runTradeLinks(org, resource.table, data as Record<string, unknown>, true);
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

// Freight is typed once: the freight on a Logistics record (what we pay the carrier) becomes ONE Shipment Charges line.
// The line is found again by its reference (CHG-<logistics number>), so saving Logistics again updates it, never duplicates it.
// Only the COST follows Logistics. The sell price (what the customer is billed) is a business decision: it starts at 0 and
// is never changed here, so nothing is billed by accident and an amount already billed is never altered.
async function syncFreightChargeFromLogistics(org: string, logistics: Record<string, unknown>) {
  try {
    const logisticsNumber = String(logistics.logistics_number ?? '').trim();
    const shipmentNumber = String(logistics.shipment_number ?? '').trim();
    if (!logisticsNumber || !shipmentNumber) return;
    const freight = Math.round((Math.max(0, Number(logistics.freight_cost) || 0) + Number.EPSILON) * 100) / 100;
    const chargeNumber = `CHG-${logisticsNumber}`;
    const currency = String(logistics.currency ?? '').trim() || null;

    const { data: existing, error: existingError } = await supabaseAdmin.from('trading_shipment_charges')
      .select('id, sell_amount').eq('organization_id', org).eq('charge_number', chargeNumber).maybeSingle();
    if (existingError) throw existingError;

    if (existing) {
      const row = existing as Record<string, unknown>;
      // Cost follows Logistics. The currency follows too, but only while nothing is set to bill (the sell price is in that currency).
      const patch: Record<string, unknown> = { cost_amount: freight };
      if (currency && !(Number(row.sell_amount) > 0)) patch.currency = currency;
      const { error: updateError } = await supabaseAdmin.from('trading_shipment_charges').update(patch)
        .eq('organization_id', org).eq('id', row.id as string);
      if (updateError) throw updateError;
      return;
    }

    if (freight <= 0) return;
    const mode = String(logistics.shipping_mode ?? '').trim().toLowerCase();
    const chargeType = mode === 'air' ? 'Air Freight' : mode === 'sea' ? 'Sea Freight' : mode === 'road' ? 'Road Freight' : 'Other';
    // Freight already typed by hand on this shipment: do not add it a second time.
    const { data: sameType, error: sameTypeError } = await supabaseAdmin.from('trading_shipment_charges')
      .select('charge_number, status').eq('organization_id', org).eq('shipment_number', shipmentNumber).eq('charge_type', chargeType);
    if (sameTypeError) throw sameTypeError;
    if (((sameType ?? []) as Record<string, unknown>[]).some((c) => c.status !== 'Cancelled' && !String(c.charge_number ?? '').startsWith('CHG-LOG-'))) return;

    const route = [logistics.origin, logistics.destination].map((v) => String(v ?? '').trim()).filter(Boolean).join(' to ');
    const { error: insertError } = await supabaseAdmin.from('trading_shipment_charges').insert({
      organization_id: org,
      industry_type_id: logistics.industry_type_id ?? null,
      charge_number: chargeNumber,
      shipment_number: shipmentNumber,
      deal_number: logistics.deal_number ?? null,
      customer_name: logistics.customer_name ?? null,
      charge_type: chargeType,
      description: route ? `Freight ${route}` : `Freight for ${logisticsNumber}`,
      vendor_name: String(logistics.carrier ?? '').trim() || null,
      currency,
      cost_amount: freight,
      sell_amount: 0,
      status: 'Active',
      notes: `Created automatically from logistics ${logisticsNumber}. Set the sell price to bill the customer.`,
    });
    if (insertError && insertError.code !== '23505') throw insertError;
  } catch (error) {
    logger.error({ err: error, logistics: logistics.logistics_number }, 'Creating the freight charge from logistics failed');
  }
}

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
      let value = logistics[from];
      // The shipment has no currency column, so its freight is always in the company currency: copy the converted
      // freight, not the raw USD figure (USD 1,500 must not become INR 1,500 on the shipment).
      if (from === 'freight_cost' && String(logistics.currency ?? '').trim() && String(logistics.currency).trim() !== String(logistics.base_currency ?? '').trim() && Number(logistics.base_value) > 0) value = logistics.base_value;
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
    // Picked Up asks the shipment to move to Dispatched; the dispatch gates may say "not yet". That is expected, not a failure.
    if (error instanceof AppError && error.code === 'SHIPMENT_NOT_READY') logger.info({ shipmentNumber: logistics.shipment_number }, error.message);
    else logger.error({ err: error, shipmentNumber: logistics.shipment_number }, 'Syncing the shipment from logistics failed');
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
  assertNotFutureDelivery(resource, payload);
  if (resource.table === 'trading_price_lists') await validatePriceList(org, (existing as { industry_type_id?: string | null }).industry_type_id, payload, id);
  if (resource.table === 'trading_import_export') {
     const { data: current } = await supabaseAdmin.from('trading_import_export').select('transaction_type, shipment_number').eq('organization_id', org).eq('id', id).maybeSingle();
    await assertTypeMatchesShipment(org, payload, (current ?? {}) as unknown as Record<string, unknown>);
  }
  // Trade documents: verification only moves through Submit / Approve / Reject (who + when is recorded), and a new file voids an old approval.
  if (resource.table === 'trading_documents') {
    const { data: current } = await supabaseAdmin.from('trading_documents').select('status, verification_status, file_reference').eq('organization_id', org).eq('id', id).maybeSingle();
    assertNoDirectReviewChange(payload, (current ?? {}) as Record<string, unknown>);
    resetApprovalOnNewFile(payload, (current ?? {}) as Record<string, unknown>);
  }
  // Customs: moving to Cleared needs the declaration number, clearance date, declared value and the stamped copy.
  if (resource.table === 'trading_customs' && payload.clearance_status === 'Cleared') {
    const { data: current } = await supabaseAdmin.from('trading_customs').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
    if (String((current as { clearance_status?: string | null } | null)?.clearance_status ?? '') !== 'Cleared') assertCanClear({ ...((current ?? {}) as Record<string, unknown>), ...payload });
  }
  // Customs: the plain status always follows the clearance status.
  if (resource.table === 'trading_customs' && typeof payload.clearance_status === 'string' && payload.clearance_status) payload.status = payload.clearance_status;
  if (resource.table === 'trading_customer_invoices') {
    const { data: current } = await supabaseAdmin.from('trading_customer_invoices').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
    const merged = { ...((current ?? {}) as Record<string, unknown>), ...payload };
    Object.assign(payload, computeInvoiceTotals({ ...merged, status: payload.status || merged.status || 'Sent' }));
  }
  if (RATE_STAMPED_AMOUNT[resource.table]) {
    const { data: current } = await supabaseAdmin.from(resource.table).select(`currency, ${RATE_STAMPED_AMOUNT[resource.table]}`).eq('organization_id', org).eq('id', id).maybeSingle();
    await stampForeignRate(resource.table, org, (existing as { industry_type_id?: string | null }).industry_type_id, payload, (current ?? {}) as unknown as Record<string, unknown>);
  }
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
    // Documents Verified + export customs Cleared + LC/advance in place (outbound shipments only).
    await assertReadyToDispatch(org, String(merged.shipment_number ?? ''));
  }
  if (resource.table === 'trading_logistics' && typeof payload.status === 'string' && MOVING_LOGISTICS_STATUSES.has(payload.status) && !STARTED_LOGISTICS_STATUSES.has(previousStatusBefore)) {
    const { data: current, error: currentError } = await supabaseAdmin.from('trading_logistics').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
    if (currentError) fail(currentError);
    const merged = { ...(current as Record<string, unknown> | null), ...payload };
    assertPlanReady(merged, String(merged.shipment_number ?? ''));
  }
  // Same gates for Logistics: leaving (Dispatched / In Transit ...) is blocked until documents, customs and payment are in order.
  // "Picked Up" is NOT gated: goods are collected from the factory before customs clearance happens at the port.
  if (resource.table === 'trading_logistics' && typeof payload.status === 'string' && DISPATCH_LOGISTICS_STATUSES.has(payload.status) && !LEFT_LOGISTICS_STATUSES.has(previousStatusBefore)) {
    const { data: current, error: currentError } = await supabaseAdmin.from('trading_logistics').select('shipment_number').eq('organization_id', org).eq('id', id).maybeSingle();
    if (currentError) fail(currentError);
    await assertReadyToDispatch(org, String(payload.shipment_number ?? (current as { shipment_number?: string | null } | null)?.shipment_number ?? ''));
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
    if (DOCUMENT_TRIGGER_STATUSES.has(status)) await autoCreateShipmentPaperwork(org, shipment);
    // Every shipment has a Logistics plan; keep its status/dates in step with the shipment.
    await syncLogisticsFromShipment(org, shipment);
    // Only on the actual transition INTO Delivered — never re-fires on a
    // later, unrelated save of an already-delivered shipment.     
    if (status === 'Delivered' && previousStatus !== 'Delivered') {
      await autoUpdateInventoryOnDelivery(org, shipment);
      await autoCloseEnquiryOnInboundDelivery(org, shipment);
         await autoCreateCustomerInvoice(org, shipment);
    }
    // Only on the actual transition INTO Cancelled.
    if (status === 'Cancelled' && previousStatus !== 'Cancelled') await autoCancelInvoiceOnShipmentCancel(org, shipment);
  }
  if (resource.table === 'trading_logistics') await syncShipmentFromLogistics(org, data as Record<string, unknown>, scope);
  if (resource.table === 'trading_logistics') await syncFreightChargeFromLogistics(org, data as Record<string, unknown>);  if (resource.table === 'trading_shipment_charges') await rebuildDraftInvoiceFromCharges(org, String((data as Record<string, unknown>).shipment_number ?? ''));
  if (resource.table === 'trading_deals') await runDealSideEffects(org, data as Record<string, unknown>);
  // A cost changed on a linked record: keep the deal's live profit row up to date.
  await refreshProfitabilityForRecord(org, resource.table, data as Record<string, unknown>);
  // Import/Export <-> Customs <-> Compliance: keep the linked records in step.
  await runTradeLinks(org, resource.table, data as Record<string, unknown>, false);
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
// Everything that follows a deal reaching a stage. Called from BOTH create and update, so a deal saved
// straight as "Confirmed" behaves the same as one confirmed later. Every step is safe to repeat.
async function runDealSideEffects(org: string, deal: Record<string, unknown>) {
  if (deal.status === 'Confirmed' && (!deal.order_number || !deal.core_order_number)) await convertConfirmedDealToOrders(org, deal);
  if (deal.status === 'Confirmed') await autoCreateInboundShipmentForDeal(org, deal);
  if (typeof deal.deal_number === 'string') {
    if (deal.status === 'Confirmed') await syncProfitabilitySnapshot(org, deal.deal_number, 'Confirmed');
    else if (deal.status === 'In Progress') await syncProfitabilitySnapshot(org, deal.deal_number, 'In Progress');
    else if (deal.status === 'Completed') await syncProfitabilitySnapshot(org, deal.deal_number, 'Completed');
  }
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
  // A deleted invoice gives its charges back: they are "open" again and can be billed on a new invoice.
  if (resource.table === 'trading_customer_invoices') {
    const invoiceNumber = (data as Record<string, unknown>).invoice_number;
    if (typeof invoiceNumber === 'string' && invoiceNumber) {
      const { error: releaseError } = await supabaseAdmin.from('trading_shipment_charges').update({ invoice_number: null })
        .eq('organization_id', org).eq('invoice_number', invoiceNumber);
      if (releaseError) logger.warn({ err: releaseError }, 'Could not release the charges of a deleted invoice');
    }
  }
  if (resource.table === 'trading_shipment_charges') await rebuildDraftInvoiceFromCharges(org, String((data as Record<string, unknown>).shipment_number ?? ''));
  // A deleted logistics / customs / finance / commission / shipment record was part of the deal's profit.
  await refreshProfitabilityForRecord(org, resource.table, data as Record<string, unknown>);
  // A deleted document / customs record changes what compliance can see.
  await refreshComplianceForRecord(org, resource.table, data as Record<string, unknown>);
  return data;
}

// Submit / Approve / Reject a trade document. The only way a document enters Pending Verification, Verified or Rejected.
export async function reviewTradeDocument(org: string, id: string, action: string, input: Record<string, unknown>, scope: IndustryScope, actor: ReviewActor) {
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', 'documents record was not found.');
  const { data: doc, error } = await supabaseAdmin.from('trading_documents').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!doc) throw notFound;
  const row = doc as Record<string, unknown>;
  assertRecordInScope(scope, row.industry_type_id as string | null | undefined, notFound);
  const patch = planDocumentReview(row, action, actor, input);
  // Only write if nobody changed the status meanwhile (two approvers clicking at once).
  let query = supabaseAdmin.from('trading_documents').update(patch).eq('organization_id', org).eq('id', id);
  query = row.status ? query.eq('status', row.status as string) : query.is('status', null);
  const { data, error: updateError } = await query.select().maybeSingle();
  if (updateError) fail(updateError);
  if (!data) throw new AppError(409, 'DOCUMENT_CHANGED', 'This document was changed by someone else. Refresh and try again.');
  await refreshProfitabilityForRecord(org, 'trading_documents', data as Record<string, unknown>);
  await runTradeLinks(org, 'trading_documents', data as Record<string, unknown>, false);
  await syncFmcgExportDocFlag(org, data as Record<string, unknown>);
  return data;
  await runTradeLinks(org, 'trading_documents', data as Record<string, unknown>, false);
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
  return { ...updated, sent_to: String(supplier.email).trim() };
}

// "Send documents": emails the shipment's Verified documents (download links) to the customer, or to the address typed.
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
function parseEmails(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/[\s,;]+/) : [];
  const list = [...new Set(raw.map((v) => v.trim()).filter(Boolean))];
  const bad = list.find((v) => !EMAIL_PATTERN.test(v));
  if (bad) throw new AppError(422, 'INVALID_EMAIL', `"${bad}" is not a valid email address.`);
  return list;
}

async function customerEmailFor(org: string, shipment: Record<string, unknown>): Promise<string> {
  try {
    const dealNumber = asText(shipment.deal_number);
    if (dealNumber) {
      const { data: deal } = await supabaseAdmin.from('trading_deals').select('customer_id').eq('organization_id', org).eq('deal_number', dealNumber).limit(1).maybeSingle();
      const customerId = asText((deal as { customer_id?: string | null } | null)?.customer_id);
      if (customerId) {
        const { data: client } = await supabaseAdmin.from('clients').select('email').eq('organization_id', org).eq('id', customerId).maybeSingle();
        const email = asText((client as { email?: string | null } | null)?.email);
        if (email) return email;
      }
    }
    const name = asText(shipment.customer_name);
    if (!name) return '';
    const { data: rows } = await supabaseAdmin.from('clients').select('client_name, email').eq('organization_id', org).ilike('client_name', name.replace(/[\\%_]/g, (m) => `\\${m}`)).limit(5);
    return asText(((rows ?? []) as Array<{ email?: string | null }>).find((r) => asText(r.email))?.email);
  } catch (error) {
    logger.warn({ err: error }, 'Could not look up the customer email');
    return '';
  }
}

export async function sendShipmentDocuments(org: string, id: string, input: Record<string, unknown>, scope: IndustryScope) {
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', 'shipments record was not found.');
  const { data, error } = await supabaseAdmin.from('trading_shipments').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound;
  const shipment = data as Record<string, unknown>;
  assertRecordInScope(scope, (shipment as { industry_type_id?: string | null }).industry_type_id, notFound);
  const shipmentNumber = asText(shipment.shipment_number);

  let recipients = parseEmails(input.to);
  if (recipients.length === 0) { const email = await customerEmailFor(org, shipment); if (email) recipients = [email]; }
  if (recipients.length === 0) throw new AppError(422, 'RECIPIENT_REQUIRED', 'Type the email address to send to, or save an email address on the customer first.');

  const { data: docs, error: docsError } = await supabaseAdmin.from('trading_documents').select('id, document_number, document_type, status, verification_status, file_reference, issue_date').eq('organization_id', org).eq('shipment_number', shipmentNumber);
  if (docsError) fail(docsError);
  const wanted = Array.isArray(input.documentIds) ? input.documentIds.map(String) : null;
  const sendable = ((docs ?? []) as Array<Record<string, unknown>>).filter((d) => (!wanted || wanted.includes(String(d.id))) && (d.status === 'Verified' || d.verification_status === 'Verified'));
  if (sendable.length === 0) throw new AppError(422, 'NO_VERIFIED_DOCUMENTS', 'This shipment has no Verified documents yet. Verify them in Trade Documents first, then send.');

  const { data: organization } = await supabaseAdmin.from('organizations').select('name').eq('id', org).maybeSingle();
  const result = await sendShipmentDocumentsEmail({
    shipmentNumber, customerName: asText(shipment.customer_name), recipients, documents: sendable,
    companyName: (organization as { name?: string | null } | null)?.name ?? 'Our company',
    note: typeof input.message === 'string' ? input.message.trim().slice(0, 1000) : undefined,
    carrier: asText(shipment.transporter), tracking: asText(shipment.tracking_number), origin: asText(shipment.origin), destination: asText(shipment.destination),
  });
  return { shipment_number: shipmentNumber, sent_to: recipients, documents: sendable.map((d) => d.document_number), message_id: result.messageId };
}

export async function sendCustomerInvoice(org: string, id: string, input: Record<string, unknown>, scope: IndustryScope) {
  const notFound = new AppError(404, 'RECORD_NOT_FOUND', 'customer invoices record was not found.');
  const { data, error } = await supabaseAdmin.from('trading_customer_invoices').select('*').eq('organization_id', org).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound;
  const invoice = data as Record<string, unknown>;
  assertRecordInScope(scope, (invoice as { industry_type_id?: string | null }).industry_type_id, notFound);
  if (asText(invoice.status) === 'Cancelled') throw new AppError(422, 'INVOICE_CANCELLED', 'A cancelled invoice cannot be sent.');

  let recipients = parseEmails(input.to);
  if (recipients.length === 0) { const email = await customerEmailFor(org, invoice); if (email) recipients = [email]; }
  if (recipients.length === 0) throw new AppError(422, 'RECIPIENT_REQUIRED', 'Type the email address to send to, or save an email address on the customer first.');

  const { data: organization } = await supabaseAdmin.from('organizations').select('name').eq('id', org).maybeSingle();
  const result = await sendCustomerInvoiceEmail({
    invoice, recipients,
    companyName: (organization as { name?: string | null } | null)?.name ?? 'Our company',
    note: typeof input.message === 'string' ? input.message.trim().slice(0, 1000) : undefined,
  });

  // Mail was accepted by SMTP: only now does a Draft invoice become "Sent" (overdue/partly-paid rules still apply).
  if (asText(invoice.status) === 'Draft') {
    const { status } = computeInvoiceTotals({ ...invoice, status: 'Sent' });
    const { error: updateError } = await supabaseAdmin.from('trading_customer_invoices').update({ status }).eq('organization_id', org).eq('id', id);
    if (updateError) logger.warn({ err: updateError }, 'Invoice email sent but status could not be updated');
  }
  return { invoice_number: asText(invoice.invoice_number), sent_to: recipients, message_id: result.messageId };
}