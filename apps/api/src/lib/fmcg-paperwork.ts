// FMCG export paperwork bridge.
// FMCG ships through fmcg_shipments, but Trade Documents / Import-Export / Customs are the shared Trade pages that
// were only ever filled from Trading shipments. This file connects them:
//  1) ensureFmcgExportPaperwork: an INTERNATIONAL FMCG shipment gets its Commercial Invoice, Packing List and Bill of
//     Lading drafts, an Export transaction and an Export customs record (all linked by the shipment number).
//  2) syncFmcgExportDocFlag: when one of those documents is Verified (or Rejected) in Trade Documents, the matching
//     "export docs ready" tick on the order is updated, so the dispatch check on the Shipments page uses real verification.
//  3) fmcgShipmentsAsTradingRows: lets the "Shipment" pick-lists on the Trade pages show FMCG shipments.
// Nothing here throws into the caller: paperwork is a helper, it must never block creating or shipping goods.
   import { supabaseAdmin } from './supabase.js';
import { logger } from '../lib/logger.js';
import { marketScopeOf, isFmcgIndustry } from '../lib/fmcg-market.js';
import { nextReference } from '../lib/trade-links.js';
import { customsProblems, dispatchBlockMessage, documentProblems } from '../lib/dispatch-gates.js';
import { AppError } from '../errors/app-error.js';
import { computeInvoiceTotals } from './invoice-totals.js';

type Row = Record<string, unknown>;
const text = (v: unknown) => (v == null ? '' : String(v).trim());
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

const DOC_TYPES: Array<{ type: string; prefix: string }> = [
  { type: 'Commercial Invoice', prefix: 'CI' },
  { type: 'Packing List', prefix: 'PL' },
  { type: 'Bill of Lading', prefix: 'BL' },
];
const FLAG_BY_TYPE: Record<string, string> = { 'Commercial Invoice': 'commercial_invoice', 'Packing List': 'packing_list', 'Bill of Lading': 'bill_of_lading', 'Airway Bill': 'bill_of_lading' };

async function nextRef(org: string, table: string, column: string, prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const { data, error } = await supabaseAdmin.from(table).select(column).eq('organization_id', org).like(column, `${prefix}-${year}-%`);
  if (error) throw error;
  return nextReference(prefix, ((data ?? []) as unknown as Row[]).map((r) => r[column]), year);
}

type Loaded = {
  id: string; shipment_no: string; transport_ref: string | null; expected_arrival: string | null; shipped_at: string | null; order_id: string;
  items: Array<{ order_item_id: string; quantity: number }>;
  order: { id: string; order_number: string; incoterm: string | null; port_of_loading: string | null; port_of_discharge: string | null; currency_code: string | null; exchange_rate: number | null; total_amount: number | null; base_total: number | null;
    clients: { client_name: string; country_code: string | null; industry_type_id: string | null };
    sale_order_items: Array<{ id: string; quantity: number; free_quantity: number | null; products: { product_name?: string | null; hsn_code?: string | null } | null }> };
};

async function loadShipment(org: string, shipmentId: string): Promise<Loaded | null> {
  const { data, error } = await supabaseAdmin.from('fmcg_shipments')
    .select('id, shipment_no, transport_ref, expected_arrival, shipped_at, order_id, fmcg_shipment_items(order_item_id, quantity), sale_orders!inner(id, order_number, incoterm, port_of_loading, port_of_discharge, currency_code, exchange_rate, total_amount, base_total, clients!inner(client_name, country_code, industry_type_id), sale_order_items(id, quantity, free_quantity, products(product_name, hsn_code)))')
    .eq('organization_id', org).eq('id', shipmentId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const d = data as unknown as Row & { fmcg_shipment_items: Loaded['items']; sale_orders: Loaded['order'] };
  return { ...(d as unknown as Loaded), items: d.fmcg_shipment_items ?? [], order: d.sale_orders };
}

function summarise(s: Loaded) {
  const names = new Map(s.order.sale_order_items.map((i) => [i.id, i.products?.product_name ?? 'Product']));
  const qty = r3(s.items.reduce((a, i) => a + Number(i.quantity), 0));
  const productNames = [...new Set(s.items.map((i) => names.get(i.order_item_id) ?? 'Product'))];
  const product = productNames.length > 2 ? `${productNames.slice(0, 2).join(', ')} +${productNames.length - 2} more` : productNames.join(', ');
  const ordered = r3(s.order.sale_order_items.reduce((a, i) => a + Number(i.quantity) + Number(i.free_quantity ?? 0), 0));
  const share = ordered > 0 ? Math.min(1, qty / ordered) : 1;
  // HS / HSN code(s) of the products on this shipment (from Products → HSN code); blank when the product has none.
  const hsByItem = new Map(s.order.sale_order_items.map((i) => [i.id, (i.products?.hsn_code ?? '').trim()]));
  const hs = [...new Set(s.items.map((i) => hsByItem.get(i.order_item_id) ?? '').filter(Boolean))].join(', ');
  return { qty, product, share, hs };
}

export async function ensureFmcgExportPaperwork(org: string, shipmentId: string): Promise<{ created: string[] }> {
  const created: string[] = [];
  try {
    const s = await loadShipment(org, shipmentId);
    if (!s) return { created };
    const industryTypeId = s.order.clients.industry_type_id;
    if (!(await isFmcgIndustry(org, industryTypeId))) return { created };
    if (marketScopeOf(s.order.clients.country_code) !== 'international') return { created }; // local shipments need no export paperwork
    const { qty, product, share, hs } = summarise(s);
    const common = { organization_id: org, industry_type_id: industryTypeId, customer_name: s.order.clients.client_name, product_name: product, quantity: qty };
    const today = new Date().toISOString().slice(0, 10);
    const suffix = s.shipment_no.replace(/^SH-/, '');
    const rate = Number(s.order.exchange_rate ?? 1) || 1;
    const value = r2(Number(s.order.total_amount ?? 0) * share); // this shipment's share of the order value

    // 1) documents (one of each type per shipment)
    const { data: have, error: haveError } = await supabaseAdmin.from('trading_documents').select('document_type').eq('organization_id', org).eq('shipment_number', s.shipment_no);
    if (haveError) throw haveError;
    const already = new Set((have ?? []).map((d) => String((d as Row).document_type)));
    for (const { type, prefix } of DOC_TYPES) {
      if (already.has(type)) continue;
      const code = `${prefix}-FM-${suffix}`;
      const { error } = await supabaseAdmin.from('trading_documents').insert({
        ...common, document_id: code, document_number: code, document_type: type, shipment_number: s.shipment_no,
        reference_number: s.order.order_number, expected_delivery_date: s.expected_arrival, tracking_number: s.transport_ref, issue_date: today, status: 'Draft', generated_from: 'shipment',
        notes: `Automatically created from FMCG shipment ${s.shipment_no} (order ${s.order.order_number}).`,
      });
      if (error && error.code !== '23505') throw error; else if (!error) created.push(type);
    }

    // 2) export transaction
    let txnNumber: string | null = null;
    const { data: txnRow, error: txnReadError } = await supabaseAdmin.from('trading_import_export').select('transaction_number').eq('organization_id', org).eq('shipment_number', s.shipment_no).limit(1).maybeSingle();
    if (txnReadError) throw txnReadError;
    txnNumber = txnRow ? text((txnRow as Row).transaction_number) : null;
    if (!txnNumber) {
      for (let attempt = 0; attempt < 5 && !txnNumber; attempt += 1) {
        const ref = await nextRef(org, 'trading_import_export', 'transaction_number', 'TXN');
        const { error } = await supabaseAdmin.from('trading_import_export').insert({
          ...common, transaction_number: ref, transaction_type: 'Export', shipment_number: s.shipment_no, order_number: s.order.order_number,
          destination_country: s.order.clients.country_code, country_of_origin: 'IN', port_of_loading: s.order.port_of_loading, port_of_discharge: s.order.port_of_discharge,
          incoterm: s.order.incoterm, currency: s.order.currency_code ?? 'INR', total_value: value, exchange_rate: rate, base_currency: 'INR', base_value: r2(value * rate),
          expected_shipment_date: s.shipped_at, expected_arrival_date: s.expected_arrival, status: 'Documentation Pending',
          notes: `Automatically created from FMCG shipment ${s.shipment_no} (order ${s.order.order_number}).`,
        });
        if (!error) { txnNumber = ref; created.push('Export transaction'); } else if (error.code !== '23505') throw error;
      }
    }

    // 3) export customs record
    const { data: customsRow, error: customsReadError } = await supabaseAdmin.from('trading_customs').select('id, transaction_number').eq('organization_id', org).eq('shipment_number', s.shipment_no).limit(1).maybeSingle();
    if (customsReadError) throw customsReadError;
    if (!customsRow) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const ref = await nextRef(org, 'trading_customs', 'customs_reference', 'CUS');
        const { error } = await supabaseAdmin.from('trading_customs').insert({
          ...common, customs_reference: ref, shipment_number: s.shipment_no, transaction_number: txnNumber, transaction_type: 'Export',
          country_of_origin: 'IN', destination_country: s.order.clients.country_code, hs_code: hs || null,
          port_of_loading: s.order.port_of_loading, port_of_discharge: s.order.port_of_discharge,
          declared_value: value, currency: s.order.currency_code ?? 'INR', exchange_rate: rate, base_currency: 'INR', base_value: r2(value * rate),
          clearance_status: 'Not Started', status: 'Not Started',
          notes: `Automatically created from FMCG shipment ${s.shipment_no}. Export customs must be Cleared before the goods are dispatched.`,
        });
        if (!error) { created.push('Customs record'); break; }
        if (error.code !== '23505') throw error;
      }
    } else {
      if (txnNumber && !text((customsRow as Row).transaction_number)) {
        await supabaseAdmin.from('trading_customs').update({ transaction_number: txnNumber }).eq('id', (customsRow as Row).id as string).eq('organization_id', org);
      }
      // Older customs records: fill a blank HS code from the product's HSN code (never overwrites one the user typed).
      if (hs) await supabaseAdmin.from('trading_customs').update({ hs_code: hs }).eq('id', (customsRow as Row).id as string).eq('organization_id', org).is('hs_code', null);
    }
  } catch (error) {
    logger.error({ err: error, shipmentId }, 'FMCG export paperwork could not be created');
  }
  return { created };
}

/** Called after a Trade Document is reviewed. Verified -> tick the order's export-doc flag; Rejected -> untick it. */
export async function syncFmcgExportDocFlag(org: string, doc: Row): Promise<void> {
  try {
    const flag = FLAG_BY_TYPE[text(doc.document_type)];
    const shipmentNo = text(doc.shipment_number);
    const state = text(doc.verification_status);
    if (!flag || !shipmentNo || (state !== 'Verified' && state !== 'Rejected')) return;
    const { data: shipment, error } = await supabaseAdmin.from('fmcg_shipments').select('order_id').eq('organization_id', org).eq('shipment_no', shipmentNo).maybeSingle();
    if (error || !shipment) return; // not an FMCG shipment (e.g. a Trading document)
    const orderId = (shipment as Row).order_id as string;
    const { data: order, error: orderError } = await supabaseAdmin.from('sale_orders').select('export_docs').eq('id', orderId).eq('organization_id', org).maybeSingle();
    if (orderError || !order) return;
    const docs = { ...(((order as Row).export_docs as Record<string, boolean> | null) ?? {}) };
    if (state === 'Verified') docs[flag] = true;
    else {
      // Rejected: only untick when no other document of the same kind on this order is still Verified.
      const { data: others } = await supabaseAdmin.from('trading_documents').select('document_type, verification_status, shipment_number').eq('organization_id', org).eq('shipment_number', shipmentNo).eq('verification_status', 'Verified').neq('id', doc.id as string);
      const stillVerified = (others ?? []).some((o) => FLAG_BY_TYPE[text((o as Row).document_type)] === flag && text((o as Row).shipment_number) === shipmentNo);
      if (!stillVerified) docs[flag] = false;
    }
    const { error: updateError } = await supabaseAdmin.from('sale_orders').update({ export_docs: docs }).eq('id', orderId).eq('organization_id', org);
    if (updateError) throw updateError;
  } catch (error) {
    logger.error({ err: error, documentId: doc.id }, 'Could not sync export document flag to the FMCG order');
  }
}

/** FMCG shipments in the shape the Trade pages expect from /trading/shipments (used for their Shipment pick-lists). */
export async function fmcgShipmentsAsTradingRows(org: string, industryTypeId: string): Promise<Row[]> {
  const { data, error } = await supabaseAdmin.from('fmcg_shipments')
    .select('id, shipment_no, status, transport_ref, expected_arrival, shipped_at, created_at, fmcg_shipment_items(order_item_id, quantity), sale_orders!inner(order_number, incoterm, port_of_loading, port_of_discharge, clients!inner(client_name, country_code, industry_type_id), sale_order_items(id, products(product_name)))')
    .eq('organization_id', org).eq('sale_orders.clients.industry_type_id', industryTypeId).order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  const STATUS: Record<string, string> = { packed: 'Ready to Ship', dispatched: 'In Transit', delivered: 'Delivered', cancelled: 'Cancelled' };
  return ((data ?? []) as unknown as Array<Row & { fmcg_shipment_items: Loaded['items']; sale_orders: { order_number: string; port_of_loading: string | null; port_of_discharge: string | null; clients: { client_name: string; country_code: string | null }; sale_order_items: Array<{ id: string; products: { product_name?: string | null } | null }> } }>).map((s) => {
    const names = new Map(s.sale_orders.sale_order_items.map((i) => [i.id, i.products?.product_name ?? 'Product']));
    const items = s.fmcg_shipment_items ?? [];
    return {
      id: s.id, organization_id: org, industry_type_id: industryTypeId, shipment_number: s.shipment_no, direction: 'Outbound', order_number: s.sale_orders.order_number, deal_number: null,
      customer_name: s.sale_orders.clients.client_name, market: marketScopeOf(s.sale_orders.clients.country_code), product_name: [...new Set(items.map((i) => names.get(i.order_item_id) ?? 'Product'))].join(', '),
      quantity: r3(items.reduce((a, i) => a + Number(i.quantity), 0)), tracking_number: s.transport_ref, expected_delivery_date: s.expected_arrival,
      origin: s.sale_orders.port_of_loading, destination: s.sale_orders.port_of_discharge, status: STATUS[String(s.status)] ?? String(s.status), created_at: s.created_at,
    };
  });
}

/** Export customs problems that stop an international FMCG shipment from leaving. Empty = cleared. */
export async function fmcgCustomsDispatchProblems(org: string, shipmentNo: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('trading_customs').select('customs_reference, clearance_status, status').eq('organization_id', org).eq('shipment_number', shipmentNo);
   if (error) throw new AppError(500, 'CUSTOMS_LOOKUP_FAILED', error.message, error);
  const rows = (data ?? []) as Row[];
  // No live customs record at all means the automatic one could not be created: that must block the dispatch, not pass it.
  if (!rows.some((r) => text(r.status) !== 'Cancelled')) return [`Export customs record for ${shipmentNo} is missing - add it in Customs & Clearance and clear it`];
  return customsProblems(rows);
}

/** Commercial Invoice, Packing List and Bill of Lading / Airway Bill of THIS shipment must each be Verified in Trade Documents.
 *  Checked per shipment (not per order), so the 2nd partial shipment of an order cannot leave on the 1st one's paperwork. Empty = all verified. */
export async function fmcgDocumentDispatchProblems(org: string, shipmentNo: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('trading_documents').select('document_type, document_number, status, verification_status').eq('organization_id', org).eq('shipment_number', shipmentNo);
  if (error) throw new AppError(500, 'DOCUMENT_LOOKUP_FAILED', error.message, error);
  const docs = (data ?? []) as Row[];
  const transport = docs.filter((d) => ['Bill of Lading', 'Airway Bill'].includes(text(d.document_type))).map((d) => ({ ...d, document_type: 'Bill of Lading' }));
  return [...documentProblems(docs, ['Commercial Invoice', 'Packing List']), ...documentProblems(transport, ['Bill of Lading'])];
}
export { dispatchBlockMessage };

/** Keeps the Export transaction, its draft documents and its customs record in step with the FMCG shipment.
 *  dispatched -> transaction "Shipped"; delivered -> "Delivered" (+ arrival date); cancelled -> transaction cancelled,
 *  unverified draft documents archived, customs closed (a Cleared customs record is left as it is). Never throws. */
export async function syncFmcgPaperworkOnStatus(org: string, shipmentId: string, target: string, dates: { shippedAt: string | null; deliveredAt: string | null }): Promise<void> {
  try {
    if (!['dispatched', 'delivered', 'cancelled'].includes(target)) return;
    const { data: shipment, error } = await supabaseAdmin.from('fmcg_shipments').select('shipment_no').eq('organization_id', org).eq('id', shipmentId).maybeSingle();
    if (error || !shipment) return;
    const shipmentNo = text((shipment as Row).shipment_no);
    const { data: txns, error: txnError } = await supabaseAdmin.from('trading_import_export').select('id, status').eq('organization_id', org).eq('shipment_number', shipmentNo);
    if (txnError) throw txnError;
    for (const txn of (txns ?? []) as Row[]) {
      const current = text(txn.status);
      if (['Completed', 'Cancelled'].includes(current)) continue;
      if (target === 'dispatched' && current === 'Delivered') continue;
      const patch: Record<string, unknown> = { status: target === 'dispatched' ? 'Shipped' : target === 'delivered' ? 'Delivered' : 'Cancelled' };
      if (target === 'dispatched' && dates.shippedAt) patch.expected_shipment_date = dates.shippedAt;
      if (target === 'delivered' && dates.deliveredAt) patch.actual_arrival_date = dates.deliveredAt;
      const { error: updateError } = await supabaseAdmin.from('trading_import_export').update(patch).eq('organization_id', org).eq('id', txn.id as string);
      if (updateError) throw updateError;
    }
    if (target === 'cancelled') {
      await supabaseAdmin.from('trading_documents').update({ status: 'Archived' }).eq('organization_id', org).eq('shipment_number', shipmentNo).eq('status', 'Draft');
      await supabaseAdmin.from('trading_customs').update({ status: 'Cancelled' }).eq('organization_id', org).eq('shipment_number', shipmentNo).neq('clearance_status', 'Cleared');
    }
  } catch (error) {
    logger.error({ err: error, shipmentId }, 'Could not sync FMCG export paperwork with the shipment status');
  }
}
/** FMCG only: what customers were really invoiced (Sent / Paid, not Draft or Cancelled) per sales order, in the ORDER's currency.
 *  Invoice -> shipment number -> fmcg_shipments -> order. Orders with no such invoice are left out. Never throws. */
export async function fmcgInvoicedByOrder(org: string, orderIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  try {
    if (!orderIds.length) return result;
    const { data: ships, error: shipError } = await supabaseAdmin.from('fmcg_shipments').select('shipment_no, order_id').eq('organization_id', org).in('order_id', orderIds);
    if (shipError) throw shipError;
    const orderOf = new Map(((ships ?? []) as Row[]).map((x) => [text(x.shipment_no), text(x.order_id)]));
    if (!orderOf.size) return result;
    const { data: invs, error: invError } = await supabaseAdmin.from('trading_customer_invoices').select('shipment_number, total_amount')
      .eq('organization_id', org).in('shipment_number', [...orderOf.keys()]).neq('status', 'Draft').neq('status', 'Cancelled');
    if (invError) throw invError;
    for (const i of (invs ?? []) as Row[]) {
      const orderId = orderOf.get(text(i.shipment_number));
      if (orderId) result.set(orderId, r2((result.get(orderId) ?? 0) + (Number(i.total_amount) || 0)));
    }
  } catch (error) {
    logger.error({ err: error }, 'Reading the FMCG invoiced totals of orders failed');
  }
  return result;
}
/** FMCG only: every FMCG shipment gets ONE Shipment Charges line (CHG-<shipment no>), made when the shipment is dispatched.
 *  Found again by its charge number, so saving again updates it, never duplicates it. Cost/sell are only changed when a value is passed.
 *  A charge already billed on an invoice is never altered. Other industries are untouched. Never throws. */
export async function ensureFmcgFreightCharge(org: string, shipmentNo: string, amounts: { cost?: number | null; sell?: number | null } = {}): Promise<void> {
  try {
    const { data: ship, error: shipError } = await supabaseAdmin.from('fmcg_shipments').select('id, transporter_name').eq('organization_id', org).eq('shipment_no', shipmentNo).maybeSingle();
    if (shipError || !ship) return;
    const s = await loadShipment(org, (ship as Row).id as string);
    if (!s) return;
    const industryTypeId = s.order.clients.industry_type_id;
    if (!(await isFmcgIndustry(org, industryTypeId))) return;
    const chargeNumber = `CHG-${shipmentNo}`;
    const { data: existing, error: existingError } = await supabaseAdmin.from('trading_shipment_charges').select('id, invoice_number').eq('organization_id', org).eq('charge_number', chargeNumber).maybeSingle();
    if (existingError) throw existingError;
    const patch: Row = {};
    if (amounts.cost != null) patch.cost_amount = r2(Math.max(0, Number(amounts.cost) || 0));
    if (amounts.sell != null) patch.sell_amount = r2(Math.max(0, Number(amounts.sell) || 0));
    if (existing) {
      const row = existing as Row;
      if (row.invoice_number == null && Object.keys(patch).length) {
        const { error } = await supabaseAdmin.from('trading_shipment_charges').update(patch).eq('organization_id', org).eq('id', row.id as string);
        if (error) throw error;
      }
    } else {
      const carrier = text((ship as Row).transporter_name);
      const { error } = await supabaseAdmin.from('trading_shipment_charges').insert({
        organization_id: org, industry_type_id: industryTypeId, charge_number: chargeNumber, shipment_number: shipmentNo, deal_number: null,
        customer_name: s.order.clients.client_name, charge_type: 'Other', description: `Freight for ${shipmentNo}`, vendor_name: carrier || null,
        currency: text(s.order.currency_code) || 'INR', cost_amount: 0, sell_amount: 0, status: 'Active', ...patch,
        notes: `Created automatically when FMCG shipment ${shipmentNo} was dispatched. Enter the freight cost and the sell price to bill the customer.`,
      });
      if (error && error.code !== '23505') throw error;
    }
    await syncFmcgExportInvoice(org, shipmentNo, false); // refresh an existing Draft invoice (international only; no-op otherwise)
  } catch (error) {
    logger.error({ err: error, shipmentNo }, 'FMCG freight charge could not be created');
  }
}
/** FMCG shipment -> customer invoice: goods + every live sell charge (freight, clearance, other...).
 *  create = true  (shipment delivered): makes the Draft invoice if the shipment has none yet.
 *  create = false (a charge was saved): refreshes the existing Draft.
 *  International shipments always get an invoice. Domestic ones get one only when they carry a sell charge (goods are already billed by the order).
 *  A Sent / Paid invoice is never changed. A charge added or priced AFTER its invoice was sent goes on a new Draft invoice
 *  (charges only, goods 0), so nothing is billed twice and nothing is lost. Never throws. */
export async function syncFmcgExportInvoice(org: string, shipmentNo: string, create: boolean): Promise<void> {
  try {
    const { data: ship, error: shipError } = await supabaseAdmin.from('fmcg_shipments').select('id').eq('organization_id', org).eq('shipment_no', shipmentNo).maybeSingle();
    if (shipError || !ship) return;
    const s = await loadShipment(org, (ship as Row).id as string);
    if (!s) return;
    const industryTypeId = s.order.clients.industry_type_id;
    if (!(await isFmcgIndustry(org, industryTypeId))) return;
    const international = marketScopeOf(s.order.clients.country_code) === 'international';
    const currency = text(s.order.currency_code) || 'INR';
    const { data: invRows, error: invError } = await supabaseAdmin.from('trading_customer_invoices').select('*').eq('organization_id', org).eq('shipment_number', shipmentNo).neq('status', 'Cancelled').order('created_at', { ascending: true });
    if (invError) throw invError;
    const invoices = (invRows ?? []) as Row[];
    const draft = invoices.find((i) => i.status === 'Draft');
    if (!draft && !create && invoices.length === 0) return; // not delivered yet: nothing to bill
    const { data: chargeRows, error: chargeError } = await supabaseAdmin.from('trading_shipment_charges').select('id, currency, sell_amount, status, invoice_number').eq('organization_id', org).eq('shipment_number', shipmentNo);
    if (chargeError) throw chargeError;
    const mine = ((chargeRows ?? []) as Row[]).filter((c) => c.invoice_number == null || (draft && c.invoice_number === draft.invoice_number));
    const live = mine.filter((c) => c.status !== 'Cancelled');
    const billable = live.filter((c) => !text(c.currency) || text(c.currency) === currency);
    const skipped = live.filter((c) => text(c.currency) && text(c.currency) !== currency && (Number(c.sell_amount) || 0) > 0);
    if (skipped.length) logger.warn({ shipmentNo, invoiceCurrency: currency, charges: skipped.map((c) => c.id) }, 'Shipment charges in another currency than the invoice are not added to it. Re-enter them in the invoice currency.');
    const charges = r2(billable.reduce((a, c) => a + (Number(c.sell_amount) || 0), 0));
    const supplementary = !draft && invoices.length > 0;
    if (!draft && charges <= 0 && (supplementary || !international)) return; // nothing extra to bill
    const goods = supplementary ? 0 : !draft || draft.id === invoices[0]?.id ? r2(Number(s.order.total_amount ?? 0) * summarise(s).share) : 0;
    const subtotal = r2(goods + charges);
    const today = new Date().toISOString().slice(0, 10);
    const figures = { subtotal, tax_percent: 0, paid_amount: draft ? draft.paid_amount : 0, due_date: draft ? draft.due_date : null, status: 'Draft' };
    let invoiceNumber = draft ? text(draft.invoice_number) : '';
    if (draft) {
      const { error } = await supabaseAdmin.from('trading_customer_invoices').update({ subtotal, currency, ...computeInvoiceTotals(figures, today) }).eq('organization_id', org).eq('id', draft.id as string);
      if (error) throw error;
    } else {
      for (let attempt = 0; attempt < 5 && !invoiceNumber; attempt += 1) {
        const ref = await nextRef(org, 'trading_customer_invoices', 'invoice_number', 'CINV');
        const { error } = await supabaseAdmin.from('trading_customer_invoices').insert({
          organization_id: org, industry_type_id: industryTypeId, invoice_number: ref, shipment_number: shipmentNo, deal_number: null, customer_name: s.order.clients.client_name,
          invoice_date: today, due_date: null, currency, subtotal, tax_percent: 0, paid_amount: 0, ...computeInvoiceTotals(figures, today),
          notes: supplementary
            ? `Extra shipment charges added after the earlier invoice of FMCG shipment ${shipmentNo} (order ${s.order.order_number}) was sent. Charges ${charges} ${currency}. Please check the amounts, then mark it Sent.`
            : `Automatically created when FMCG shipment ${shipmentNo} (order ${s.order.order_number}) was delivered. Goods ${goods} ${currency} + shipment charges ${charges} ${currency} (freight, clearance, other). Please check the amounts, then mark it Sent.`,
        });
        if (!error) invoiceNumber = ref; else if (error.code !== '23505') throw error;
      }
    }
    if (!invoiceNumber) return;
    const ids = billable.map((c) => c.id as string);
    if (ids.length) await supabaseAdmin.from('trading_shipment_charges').update({ invoice_number: invoiceNumber }).eq('organization_id', org).in('id', ids);
  } catch (error) {
    logger.error({ err: error, shipmentNo }, 'FMCG customer invoice could not be created or refreshed');
  }
}

/** FMCG: puts the order's payments (Collections) onto its Sent invoices, oldest first, so Paid so far / Balance due / status are right.
 *  Payments and invoices are both in the order currency. Draft and Cancelled invoices are skipped. Never throws. */
export async function syncFmcgInvoicePayments(org: string, orderId: string | null | undefined): Promise<void> {
  try {
    if (!orderId) return;
    const { data: ships, error: shipError } = await supabaseAdmin.from('fmcg_shipments').select('shipment_no').eq('organization_id', org).eq('order_id', orderId);
    if (shipError) throw shipError;
    const nos = ((ships ?? []) as Row[]).map((x) => text(x.shipment_no)).filter(Boolean);
    if (!nos.length) return;
    const { data: invRows, error: invError } = await supabaseAdmin.from('trading_customer_invoices').select('*').eq('organization_id', org).in('shipment_number', nos).neq('status', 'Draft').neq('status', 'Cancelled').order('invoice_date', { ascending: true }).order('invoice_number', { ascending: true });
    if (invError) throw invError;
    const invoices = (invRows ?? []) as Row[];
    if (!invoices.length) return;
    const { data: pays, error: payError } = await supabaseAdmin.from('sales_collections').select('amount').eq('organization_id', org).eq('sale_order_id', orderId);
    if (payError) throw payError;
    let remaining = r2(((pays ?? []) as Row[]).reduce((a, p) => a + (Number(p.amount) || 0), 0));
    const today = new Date().toISOString().slice(0, 10);
    for (const inv of invoices) {
      const total = Number(inv.total_amount) || 0;
      const paid = r2(Math.min(total, Math.max(0, remaining)));
      remaining = r2(remaining - paid);
      const totals = computeInvoiceTotals({ subtotal: inv.subtotal, tax_percent: inv.tax_percent, paid_amount: paid, due_date: inv.due_date, status: inv.status }, today);
      if (Number(inv.paid_amount) === paid && totals.status === inv.status) continue;
      const { error } = await supabaseAdmin.from('trading_customer_invoices').update({ paid_amount: paid, balance_amount: totals.balance_amount, status: totals.status }).eq('organization_id', org).eq('id', inv.id as string);
      if (error) throw error;
    }
  } catch (error) {
    logger.error({ err: error, orderId }, 'Putting payments on the FMCG invoices failed');
  }
}