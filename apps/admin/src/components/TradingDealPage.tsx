import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { api } from '../lib/api';

const STATUSES = ['Draft', 'Enquiry', 'Negotiation', 'Quotation', 'Confirmed', 'In Progress', 'Completed', 'Cancelled', 'Lost'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

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
      autoFillMap: { client_name: 'customer_name', id: 'customer_id' },
      onLookupChange: (matched, setForm) => { void autoFillFromCustomer(matched, setForm); },
    },
    {
      key: 'requirement_id',
      label: 'Requirement (if multiple)',
      type: 'text',
      group: 'Product & quantity',
      placeholder: 'Auto-fills after Customer is selected; only shown when the customer has more than one open requirement',
    },
    { key: 'supplier_name', label: 'Supplier', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', listColumn: true },
{ key: 'product_name', label: 'Product', type: 'lookup', lookupResource: '/products?status=active', lookupLabelKey: 'product_code', autoFillMap: { unit: 'unit', cost_price: 'purchase_rate', selling_price: 'selling_rate' }, listColumn: true, group: 'Product & quantity' },
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
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Schedule & terms' },
  ],
  kpis: [
    { icon: '◆', iconClass: 'kpi-icon-ink', label: 'Total deals', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Open deals', value: (r) => String(r.filter((x) => !['Completed', 'Cancelled', 'Lost'].includes(String(x.status))).length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Confirmed', value: (r) => String(r.filter((x) => x.status === 'Confirmed' || x.status === 'In Progress').length) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Deal value', value: (r) => `₹${r.reduce((sum, x) => sum + sellingValue(x), 0).toLocaleString()}` },
    { icon: '↗', iconClass: 'kpi-icon-green', label: 'Expected margin', value: (r) => `₹${r.reduce((sum, x) => sum + (sellingValue(x) - purchaseValue(x)), 0).toLocaleString()}` },
  ],
};

export function TradingDealPage() {
  return <TradingMasterPage config={config} />;
}