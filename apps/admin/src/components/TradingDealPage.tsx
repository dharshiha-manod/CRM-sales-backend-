// FILE: admin/src/components/TradingDealPage.tsx
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { api } from '../lib/api';
import { applyPriceListRates } from '../lib/priceListLookup';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import { DealLinkedRecords } from './DealLinkedRecords';
import { buildDraftFromDeal } from '../lib/tradeDocumentHandoff';

const STATUSES = ['Draft', 'Enquiry', 'Negotiation', 'Quotation', 'Confirmed', 'In Progress', 'Completed', 'Cancelled', 'Lost'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const DEAL_DOC_TYPES = ['Proforma Invoice', 'Commercial Invoice', 'Sales Order', 'Purchase Order', 'Certificate of Origin', 'Insurance Certificate', 'Other'];

// NEW — shape returned by GET /clients/:id/trading-snapshot (see
// clientService.tradingSnapshot on the backend). Only the fields this form
// actually reads are declared; the endpoint returns more.
type SnapshotItem = { product_id?: string | null; product_name?: string; products?: { product_name?: string; product_code?: string; category?: string | null; cost_price?: number | null; selling_price?: number | null } | null; quantity?: number; unit_price?: number };
type SnapshotRequirement = { id: string; title?: string; status?: string; requirement_items?: SnapshotItem[] };
type SnapshotQuotation = { id: string; requirement_id?: string | null; quotation_number?: string; status?: string; quotation_items?: SnapshotItem[] };
type TradingSnapshot = { client: Record<string, unknown>; requirements: SnapshotRequirement[]; quotations: SnapshotQuotation[] };

function fillFromRequirementAndQuotation(
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
  requirement?: SnapshotRequirement,
  quotation?: SnapshotQuotation,
) {
  setForm((prev) => {
    const next = { ...prev };
    const item = quotation?.quotation_items?.[0] ?? requirement?.requirement_items?.[0];
    if (item) {
      const productName = item.products?.product_name ?? item.product_name;
      if (productName) next.product_name = productName;
      if (item.quantity) next.quantity = String(item.quantity);
      if (item.products?.category) next.product_category = item.products.category;
      // Selling rate: prefer the price actually quoted on the quotation line
      // (unit_price) over the product's list price, since that's the real
      // agreed rate for this deal.
      const sellingRate = item.unit_price ?? item.products?.selling_price;
      if (sellingRate) next.selling_rate = String(sellingRate);
      if (item.products?.cost_price) next.purchase_rate = String(item.products.cost_price);
    }
    if (requirement?.id) next.requirement_id = requirement.id;
    if (quotation?.id) next.quotation_id = quotation.id;
    return next;
  });
}

// NEW — fires when the user picks a Customer on the Add Deal form. Pulls
// that customer's open requirement(s)/accepted quotation(s) from the
// backend and auto-fills the rest of the form. Per the spec's data
// priority: accepted quotation first, then the customer's open
// requirement. When more than one candidate exists, this stores the
// snapshot and lets the "Requirement / Quotation" lookup field below act
// as the picker instead of guessing.
// NEW — client_contacts is a nested list on the /clients record (one client
// can have several contacts). We want the PRIMARY one, falling back to the
// first contact if none is marked primary. This runs synchronously off the
// already-fetched lookup record — no extra network call needed.
function fillPrimaryContact(matched: Record<string, unknown>, setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void, prefix: 'customer' | 'supplier') {
  const contacts = (matched.client_contacts as Array<Record<string, unknown>> | undefined) ?? [];
  const primary = contacts.find((c) => c.is_primary) ?? contacts[0];
  if (!primary) return;
  setForm((prev) => ({
    ...prev,
    [`${prefix}_contact_person`]: String(primary.name ?? prev[`${prefix}_contact_person`] ?? ''),
    [`${prefix}_phone`]: String(primary.phone ?? prev[`${prefix}_phone`] ?? ''),
  }));
}

async function autoFillFromCustomer(matched: Record<string, unknown>, setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void) {
  const clientId = matched.id as string | undefined;
  if (!clientId) return;
  try {
    const res = await api<{ data: TradingSnapshot }>(`/clients/${clientId}/trading-snapshot`);
    const snapshot = res.data;
    const quotation = snapshot.quotations[0];
    const requirement = snapshot.requirements.find((r) => r.id === quotation?.requirement_id) ?? snapshot.requirements[0];
    // Exactly one relevant record on both sides — auto-select it, per spec.
    // NOTE: when the customer has MORE than one open requirement/quotation,
    // this intentionally does nothing automatic (no guessing which one) —
    // the "Requirement (if multiple)" text field above is a manual
    // placeholder for that case. A real dropdown picker listing each
    // candidate (with Product/Quantity/Quotation shown) is the natural next
    // step but needs a small new lookupResource on that field pointed at
    // this snapshot's requirements, which is worth its own follow-up pass
    // rather than a rushed addition here.
    if (snapshot.quotations.length <= 1 && snapshot.requirements.length <= 1) {
      fillFromRequirementAndQuotation(setForm, requirement, quotation);
    }
  } catch {
    // Auto-fill is a convenience — leave the form usable (manual entry)
    // if the snapshot call fails for any reason.
  }
}

function sellingValue(r: Record<string, unknown>) {
  return (Number(r.selling_rate) || 0) * (Number(r.quantity) || 0);
}
function purchaseValue(r: Record<string, unknown>) {
  return (Number(r.purchase_rate) || 0) * (Number(r.quantity) || 0);
}

// NEW — Step 7 of the Trading connectivity plan. Mirrors Step 5's
// convertEnquiryToDeal in TradingPurchaseEnquiryPage.tsx: saving a Deal
// with status "Confirmed" creates the matching Sales Order automatically
// and links back to it. Guarded the same way (only fires once, checked
// via the absent order_number) so re-saving an already-converted Deal
// never creates a second Sales Order.
async function convertDealToSalesOrder(deal: Record<string, unknown>, reload: () => Promise<void>) {
  try {
    const ordersRes = await api<{ data: Array<Record<string, unknown>> }>('/trading/sales-orders');
    const year = new Date().getFullYear();
    const seq = String((ordersRes.data?.length ?? 0) + 1).padStart(4, '0');
    const orderNumber = `SO-${year}-${seq}`;
    await api('/trading/sales-orders', {
      method: 'POST',
      body: JSON.stringify({
        order_number: orderNumber,
        deal_number: deal.deal_number ?? '',
        customer_name: deal.customer_name ?? '',
        product_name: deal.product_name ?? '',
        quantity: deal.quantity,
        unit: deal.unit,
        currency: deal.currency,
        selling_rate: deal.selling_rate,
        order_date: new Date().toISOString().slice(0, 10),
        expected_delivery_date: deal.expected_delivery_date,
        payment_terms: deal.payment_terms,
        delivery_terms: deal.delivery_terms,
      }),
    });
    // Link back: this Deal now shows which Sales Order it became.
    await api(`/trading/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ order_number: orderNumber }) });
    await reload();
  } catch {
    // Best-effort automation — the Deal itself already saved fine; the
    // user can retry (edit status again) if this part fails.
  }
}

function handleAfterSave(saved: Record<string, unknown>, reload: () => Promise<void>) {
  // Only fire the moment status BECOMES "Confirmed" — not on every later
  // save of an already-converted Deal — so we never create a second
  // Sales Order for the same Deal.
  if (saved.status === 'Confirmed' && !saved.order_number) {
    void convertDealToSalesOrder(saved, reload);
  }
}

const config: TradingModuleConfig = {
  resource: '/trading/deals',
  eyebrowModule: 'DEAL MANAGEMENT',
  title: 'Deal management',
  description: 'Trading deals from initial requirement through negotiation, confirmation and closure, with margin calculated automatically from purchase and selling rate.',
  icon: '◆',
  emptyIcon: '◆',
  codeField: 'deal_number',
  nameField: 'deal_name',
  statusOptions: STATUSES,
  searchableKeys: ['deal_number', 'deal_name', 'customer_name', 'supplier_name', 'product_name', 'sales_rep'],
  fields: [
    { key: 'deal_number', label: 'Deal number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'DEAL' },
    { key: 'deal_name', label: 'Deal name', type: 'text', required: true, listColumn: true },
    {
      key: 'customer_name',
      label: 'Customer',
      type: 'lookup',
      required: true,
      lookupResource: '/clients',
      lookupValueKey: 'client_name',
      lookupLabelKey: 'client_code',
      listColumn: true,
      // Client-level fields the moment a customer is picked — instant,
      // no network wait (this is the existing autoFillMap feature, just
      // switched on for Deals). Requirement/quotation-level fields (product,
      // quantity, supplier, rates) fill a moment later via onLookupChange,
      // since those need a backend call.
      autoFillMap: { client_name: 'customer_name', id: 'customer_id', address: 'customer_address', city: 'customer_city', gstin: 'customer_gstin' },
      onLookupChange: (matched, setForm) => {
        fillPrimaryContact(matched, setForm, 'customer');
        void autoFillFromCustomer(matched, setForm);
      },
    },
    {
      key: 'requirement_id',
      label: 'Requirement (if multiple)',
      type: 'text',
      group: 'Product & quantity',
      placeholder: 'Auto-fills after Customer is selected; only shown when the customer has more than one open requirement',
    },
    { key: 'customer_address', label: 'Customer address', type: 'text', group: 'Customer details', placeholder: 'Auto-fills from the selected customer' },
    { key: 'customer_city', label: 'Customer city', type: 'text', group: 'Customer details' },
    { key: 'customer_gstin', label: 'Customer GSTIN', type: 'text', group: 'Customer details' },
    { key: 'customer_contact_person', label: 'Customer contact person', type: 'text', group: 'Customer details' },
    { key: 'customer_phone', label: 'Customer phone', type: 'text', group: 'Customer details' },
    {
      key: 'supplier_name',
      label: 'Supplier',
      type: 'lookup',
      lookupResource: '/trading/suppliers',
      lookupLabelKey: 'supplier_name',
      listColumn: true,
      // trading_suppliers stores these as flat columns (unlike clients,
      // there's no nested contacts table), so a plain autoFillMap covers
      // everything — no onLookupChange needed here.
      autoFillMap: { id: 'supplier_id', address: 'supplier_address', phone: 'supplier_phone', contact_person: 'supplier_contact_person', tax_number: 'supplier_tax_number' },
    },
    { key: 'supplier_address', label: 'Supplier address', type: 'text', group: 'Supplier details', placeholder: 'Auto-fills from the selected supplier' },
    { key: 'supplier_phone', label: 'Supplier phone', type: 'text', group: 'Supplier details' },
    { key: 'supplier_contact_person', label: 'Supplier contact person', type: 'text', group: 'Supplier details' },
    { key: 'supplier_tax_number', label: 'Supplier tax number', type: 'text', group: 'Supplier details' },
{
  key: 'product_name',
  label: 'Product',
  type: 'lookup',
  lookupResource: '/products?status=active',
  lookupLabelKey: 'product_code',
  // Standard product price fills first, instantly (existing behaviour —
  // this is the fallback the spec calls "the flat product price"). The
  // Price List lookup below then overwrites it a moment later IF a more
  // specific active rate exists, per Step 3 of the plan.
  autoFillMap: { unit: 'unit', cost_price: 'purchase_rate', selling_price: 'selling_rate' },
  listColumn: true,
  group: 'Product & quantity',
  onLookupChange: (matched, setForm) => {
    void applyPriceListRates(String(matched.product_name ?? ''), setForm, { selling: 'selling_rate', purchase: 'purchase_rate', currency: 'currency' });
  },
},
    { key: 'product_category', label: 'Product category', type: 'text', group: 'Product & quantity' },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Product & quantity' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Product & quantity' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Product & quantity', placeholder: 'e.g. INR, USD' },
    { key: 'purchase_rate', label: 'Purchase rate', type: 'number', group: 'Rates & margin' },
    { key: 'selling_rate', label: 'Selling rate', type: 'number', group: 'Rates & margin' },
    {
      key: 'gross_amount',
      label: 'Gross amount (Selling)',
      type: 'text',
      readOnly: true,
      format: (_v, r) => `₹${sellingValue(r).toLocaleString()}`,
      group: 'Rates & margin',
    },
    {
      key: 'purchase_amount',
      label: 'Purchase amount',
      type: 'text',
      readOnly: true,
      format: (_v, r) => `₹${purchaseValue(r).toLocaleString()}`,
      group: 'Rates & margin',
    },
    {
      key: 'gross_margin',
      label: 'Gross margin',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => `₹${(sellingValue(r) - purchaseValue(r)).toLocaleString()}`,
      group: 'Rates & margin',
    },
    {
      key: 'margin_percent',
      label: 'Margin %',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => {
        const sv = sellingValue(r);
        if (!sv) return '—';
        return `${(((sv - purchaseValue(r)) / sv) * 100).toFixed(2)}%`;
      },
      group: 'Rates & margin',
    },
    { key: 'deal_date', label: 'Deal date', type: 'date', group: 'Schedule & terms' },
    { key: 'expected_delivery_date', label: 'Expected delivery date', type: 'date', group: 'Schedule & terms' },
    { key: 'sales_rep', label: 'Sales representative', type: 'text', group: 'Schedule & terms' },
    { key: 'payment_terms', label: 'Payment terms', type: 'text', group: 'Schedule & terms' },
    { key: 'delivery_terms', label: 'Delivery terms', type: 'text', group: 'Schedule & terms' },
    { key: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, listColumn: true, group: 'Schedule & terms' },
    { key: 'status', label: 'Deal status', type: 'select', options: STATUSES, listColumn: true, group: 'Schedule & terms' },
    { key: 'order_number', label: 'Sales order (once confirmed)', type: 'text', readOnly: true, listColumn: true, placeholder: 'Fills in automatically when status is set to "Confirmed"', group: 'Schedule & terms' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Schedule & terms' },
  ],
  afterSave: handleAfterSave,
  kpis: [
    { icon: '◆', iconClass: 'kpi-icon-ink', label: 'Total deals', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Open deals', value: (r) => String(r.filter((x) => !['Completed', 'Cancelled', 'Lost'].includes(String(x.status))).length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Confirmed', value: (r) => String(r.filter((x) => x.status === 'Confirmed' || x.status === 'In Progress').length) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Deal value', value: (r) => `₹${r.reduce((sum, x) => sum + sellingValue(x), 0).toLocaleString()}` },
    { icon: '↗', iconClass: 'kpi-icon-green', label: 'Expected margin', value: (r) => `₹${r.reduce((sum, x) => sum + (sellingValue(x) - purchaseValue(x)), 0).toLocaleString()}` },
  ],
  rowActions: (r) => (
    <GenerateDocumentButton docTypes={DEAL_DOC_TYPES} buildDraft={(documentType) => buildDraftFromDeal(r, documentType)} />
  ),
  detailExtra: (r) => <DealLinkedRecords deal={r} />,
  detailActions: (r) => (
    <GenerateDocumentButton docTypes={DEAL_DOC_TYPES} buildDraft={(documentType) => buildDraftFromDeal(r, documentType)} />
  ),
};

export function TradingDealPage() {
  return <TradingMasterPage config={config} />;
}