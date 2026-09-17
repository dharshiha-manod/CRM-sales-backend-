import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { api } from '../lib/api';
import { applyPriceListRates } from '../lib/priceListLookup';

const STATUSES = ['Draft', 'Sent', 'Supplier Responded', 'Under Comparison', 'Negotiation', 'Approved', 'Rejected', 'Converted to Deal', 'Closed'];

// NEW — Step 5 of the Trading connectivity plan. The "Converted to Deal"
// status option existed on this form already but did nothing when picked.
// This makes it real: saving an enquiry with that status creates the
// matching Deal automatically and links back to it.
//
// One thing this can't automate honestly: Deal Management requires a
// Customer, and Purchase Enquiry — being purely supplier-facing — never
// captures one. Rather than invent a fake customer (bad data) or fail
// silently, this asks once at conversion time. Swapping the prompt for a
// real customer-picker (like Deal's own Customer lookup) is a reasonable
// next step, not folded in here to keep this change reviewable on its own.
async function convertEnquiryToDeal(enquiry: Record<string, unknown>, reload: () => Promise<void>) {
  const customerName = window.prompt(`Convert ${String(enquiry.enquiry_number ?? '')} to a Deal — which customer is this for?`);
  if (!customerName) return; // cancelled — enquiry stays "Converted to Deal" with no deal_number; editing status again retries
  try {
    const dealsRes = await api<{ data: Array<Record<string, unknown>> }>('/trading/deals');
    const year = new Date().getFullYear();
    const seq = String((dealsRes.data?.length ?? 0) + 1).padStart(4, '0');
    const dealNumber = `DEAL-${year}-${seq}`;
    await api('/trading/deals', {
      method: 'POST',
      body: JSON.stringify({
        deal_number: dealNumber,
        deal_name: `Deal for ${String(enquiry.product_name ?? '')} (from ${String(enquiry.enquiry_number ?? '')})`,
        customer_name: customerName,
        supplier_name: enquiry.supplier_name ?? '',
        product_name: enquiry.product_name ?? '',
        quantity: enquiry.quantity,
        unit: enquiry.unit,
        currency: enquiry.currency,
        purchase_rate: enquiry.requested_rate,
        payment_terms: enquiry.payment_terms,
        delivery_terms: enquiry.delivery_terms,
      }),
    });
    // Link back: this enquiry now shows which Deal it became.
    await api(`/trading/purchase-enquiries/${enquiry.id}`, { method: 'PATCH', body: JSON.stringify({ deal_number: dealNumber }) });
    await reload();
  } catch {
    // Best-effort automation — the enquiry itself already saved fine;
    // the user can retry (edit status again) if this part fails.
  }
}

function handleAfterSave(saved: Record<string, unknown>, reload: () => Promise<void>) {
  // Only fire the moment status BECOMES "Converted to Deal" — not on every
  // later save of an already-converted enquiry — so we never create a
  // second Deal for the same enquiry.
  if (saved.status === 'Converted to Deal' && !saved.deal_number) {
    void convertEnquiryToDeal(saved, reload);
  }
}

const config: TradingModuleConfig = {
  resource: '/trading/purchase-enquiries',
  eyebrowModule: 'PURCHASE ENQUIRY',
  title: 'Purchase enquiry',
  description: 'Send a requirement to one or more suppliers, capture their rates, and compare before selecting who to deal with.',
  icon: '❓',
  emptyIcon: '❓',
  codeField: 'enquiry_number',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['enquiry_number', 'product_name', 'supplier_name', 'procurement_person'],
  fields: [
    { key: 'enquiry_number', label: 'Enquiry number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'ENQ' },
    { key: 'enquiry_date', label: 'Enquiry date', type: 'date', listColumn: true },
    { key: 'required_by_date', label: 'Required by date', type: 'date', listColumn: true },
   {
     key: 'product_name',
     label: 'Product',
     type: 'lookup',
     required: true,
     lookupResource: '/products?status=active',
     lookupLabelKey: 'product_code',
     listColumn: true,
     group: 'Requirement',
     autoFillMap: { unit: 'unit' },
     // Purchase Enquiry only has one rate field (requested_rate), so this
     // fills the PURCHASE side of the Price List match — same shared
     // lookup Deal Management uses, per Step 3 of the plan.
     onLookupChange: (matched, setForm) => {
       void applyPriceListRates(String(matched.product_name ?? ''), setForm, { purchase: 'requested_rate', currency: 'currency' });
     },
   },
    { key: 'quantity', label: 'Quantity', type: 'number', group: 'Requirement' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Requirement' },
    { key: 'specification', label: 'Specification', type: 'textarea', group: 'Requirement' },
    { key: 'supplier_name', label: 'Supplier / vendor', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', listColumn: true, group: 'Supplier response' },
    { key: 'requested_rate', label: 'Requested / quoted rate', type: 'number', group: 'Supplier response' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Supplier response' },
    { key: 'delivery_location', label: 'Delivery location', type: 'text', group: 'Supplier response' },
    { key: 'delivery_terms', label: 'Delivery terms', type: 'text', group: 'Supplier response' },
    { key: 'payment_terms', label: 'Payment terms', type: 'text', group: 'Supplier response' },
    { key: 'procurement_person', label: 'Sales / procurement person', type: 'text', group: 'Supplier response' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Supplier response' },
    { key: 'deal_number', label: 'Deal (once converted)', type: 'text', readOnly: true, listColumn: true, placeholder: 'Fills in automatically when status is set to "Converted to Deal"', group: 'Supplier response' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Supplier response' },
  ],
  afterSave: handleAfterSave,
  kpis: [
    { icon: '❓', iconClass: 'kpi-icon-ink', label: 'Total enquiries', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pending supplier response', value: (r) => String(r.filter((x) => x.status === 'Sent').length) },
    { icon: '⚖', iconClass: 'kpi-icon-school', label: 'Under comparison', value: (r) => String(r.filter((x) => x.status === 'Under Comparison').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Converted', value: (r) => String(r.filter((x) => x.status === 'Converted to Deal').length) },
  ],
 
};

export function TradingPurchaseEnquiryPage() {
  return <TradingMasterPage config={config} />;
}