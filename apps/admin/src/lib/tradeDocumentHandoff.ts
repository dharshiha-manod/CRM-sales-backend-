// FILE: admin/src/lib/tradeDocumentHandoff.ts
// Cross-page handoff for "Generate Document" buttons on Deal/Shipment pages.
// Trade Documents lives on its own hash route (industry:trading:trade-documents)
// and only mounts when the user navigates there, so we can't call into it
// directly — queue the draft in sessionStorage, then navigate; the page
// consumes it once, on its first load, via config.consumePendingDraft.

const STORAGE_KEY = 'trade-document-draft';
const TRADE_DOCUMENTS_HASH = 'industry:trading:trade-documents';

export function queueTradeDocumentDraft(values: Record<string, string>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // sessionStorage can fail in locked-down environments — the user can
    // still navigate and fill the form manually.
  }
  window.location.hash = TRADE_DOCUMENTS_HASH;
}

export function consumeTradeDocumentDraft(): Record<string, string> | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : null;
  } catch {
    return null;
  }
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value != null ? n : undefined;
}

/** Builds a Trade Document draft from a Trading Deal record. Purchase-side
 *  documents (Purchase Order) price off the deal's purchase_rate — the rate
 *  agreed with the supplier — while every other document type (Proforma/
 *  Commercial Invoice, Sales Order, etc.) prices off selling_rate, the rate
 *  agreed with the customer. Same deal, two sides of the same transaction. */
export function buildDraftFromDeal(deal: Record<string, unknown>, documentType: string): Record<string, string> {
  const isPurchaseSide = documentType === 'Purchase Order';
  const quantity = num(deal.quantity);
  const unitPrice = num(isPurchaseSide ? deal.purchase_rate : deal.selling_rate);
  const totalValue = quantity != null && unitPrice != null ? quantity * unitPrice : undefined;
  const values: Record<string, string> = {
    document_type: documentType,
    deal_number: String(deal.deal_number ?? ''),
    customer_name: String(deal.customer_name ?? ''),
    supplier_name: String(deal.supplier_name ?? ''),
    product_name: String(deal.product_name ?? ''),
    // A Purchase Order is addressed to the supplier — the reference a
    // supplier would quote back is the deal number either way, but flag
    // which side of the deal this document belongs to for anyone scanning
    // the Trade Documents list.
    reference_number: String(deal.deal_number ?? ''),
    unit: String(deal.unit ?? ''),
    currency: String(deal.currency ?? ''),
    sales_rep: String(deal.sales_rep ?? ''),
    order_date: String(deal.deal_date ?? ''),
    expected_delivery_date: String(deal.expected_delivery_date ?? ''),
    issue_date: new Date().toISOString().slice(0, 10),
    generated_from: isPurchaseSide ? 'deal_purchase' : 'deal',
  };
  if (quantity != null) values.quantity = String(quantity);
  if (unitPrice != null) values.unit_price = String(unitPrice);
  if (totalValue != null) values.total_value = String(totalValue);
  return values;
}

/** Builds a Trade Document draft from a Sales Order record (global orders module). */
export function buildDraftFromOrder(order: Record<string, unknown>, documentType: string): Record<string, string> {
  const clients = (order.clients ?? {}) as Record<string, unknown>;
  const rep = (order.sales_representatives ?? {}) as Record<string, unknown>;
  const repProfile = (rep.user_profiles ?? {}) as Record<string, unknown>;
  const items = Array.isArray(order.sale_order_items) ? order.sale_order_items as Record<string, unknown>[] : [];
  const firstItem = items[0] ?? {};
  const firstProduct = (firstItem.products ?? {}) as Record<string, unknown>;
  const productNames = items
    .map((line) => ((line.products as Record<string, unknown> | undefined)?.product_name))
    .filter(Boolean)
    .join(', ');
  const quantity = num(firstItem.quantity);

  const values: Record<string, string> = {
    document_type: documentType,
    reference_number: String(order.order_number ?? ''),
    customer_name: String(clients.client_name ?? ''),
    product_name: productNames || String(firstProduct.product_name ?? ''),
    sales_rep: String(repProfile.display_name ?? rep.employee_code ?? ''),
    order_date: String(order.created_at ?? '').slice(0, 10),
    issue_date: new Date().toISOString().slice(0, 10),
    generated_from: 'sales_order',
  };
  if (quantity != null) values.quantity = String(quantity);
  if (order.total_amount != null) values.total_value = String(order.total_amount);
  return values;
}

/** Builds a Trade Document draft from a Quotation record (global quotations module). */
export function buildDraftFromQuotation(quotation: Record<string, unknown>, documentType: string): Record<string, string> {
  const clients = (quotation.clients ?? {}) as Record<string, unknown>;
  const items = Array.isArray(quotation.quotation_items) ? quotation.quotation_items as Record<string, unknown>[] : [];
  const productNames = items
    .map((line) => ((line.products as Record<string, unknown> | undefined)?.product_name))
    .filter(Boolean)
    .join(', ');
  const total = items.reduce((sum, line) => sum + Number(line.subtotal || 0), 0);

  const values: Record<string, string> = {
    document_type: documentType,
    reference_number: String(quotation.quotation_number ?? ''),
    customer_name: String(clients.client_name ?? ''),
    product_name: productNames,
    order_date: String(quotation.created_at ?? '').slice(0, 10),
    issue_date: new Date().toISOString().slice(0, 10),
    generated_from: 'quotation',
  };
  if (total > 0) values.total_value = String(total);
  return values;
}

/** Builds a Trade Document draft from a Trading Shipment record. */
export function buildDraftFromShipment(shipment: Record<string, unknown>, documentType: string): Record<string, string> {
  const quantity = num(shipment.quantity);
  const values: Record<string, string> = {
    document_type: documentType,
    shipment_number: String(shipment.shipment_number ?? ''),
    deal_number: String(shipment.deal_number ?? ''),
    customer_name: String(shipment.customer_name ?? ''),
    supplier_name: String(shipment.supplier_name ?? ''),
    product_name: String(shipment.product_name ?? ''),
    reference_number: String(shipment.shipment_number ?? ''),
    unit: String(shipment.unit ?? ''),
    expected_delivery_date: String(shipment.expected_delivery_date ?? ''),
    shipping_mode: String(shipment.shipping_mode ?? ''),
    transporter: String(shipment.transporter ?? ''),
    tracking_number: String(shipment.tracking_number ?? ''),
    issue_date: new Date().toISOString().slice(0, 10),
    generated_from: 'shipment',
  };
  if (quantity != null) values.quantity = String(quantity);
  return values;
}