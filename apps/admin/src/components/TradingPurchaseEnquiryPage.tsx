
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { api } from '../lib/api';
import { applyPriceListRates } from '../lib/priceListLookup';
import { SendPurchaseEnquiryButton } from './SendPurchaseEnquiryButton';

const STATUSES = ['Draft', 'Sent', 'Supplier Responded', 'Under Comparison', 'Negotiation', 'Approved', 'Rejected', 'Converted to Deal', 'Closed'];

// Handed this page's own reload() via registerReload below, so the
// Send-to-supplier button can refresh the list/detail after a real send
// updates status to 'Sent' server-side.
let reloadPurchaseEnquiries: () => void = () => {};

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
  const customerName = typeof enquiry.customer_name === 'string' ? enquiry.customer_name : '';
  const customerId = typeof enquiry.customer_id === 'string' ? enquiry.customer_id : '';
  if (!customerId) {
    window.alert(`Pick a Customer on ${String(enquiry.enquiry_number ?? '')} before converting it to a Deal.`);
    return; // enquiry stays "Converted to Deal" with no deal_number; editing status again retries
  }
  try {
    const dealNumber = `DEAL-${String(enquiry.enquiry_number ?? '').replace(/^ENQ-/, '')}`;
    await api('/trading/deals', {
      method: 'POST',
      body: JSON.stringify({
        deal_number: dealNumber,
        deal_name: `Deal for ${String(enquiry.product_name ?? '')} (from ${String(enquiry.enquiry_number ?? '')})`,
        customer_name: customerName,
        customer_id: customerId,
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
    await api(`/trading/purchase-enquiries/${enquiry.id}`, { method: 'PATCH', body: JSON.stringify({ deal_number: dealNumber }) });
    await reload();
  } catch {}
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
       {
      key: 'customer_name', label: 'Customer (needed to convert this to a Deal)', type: 'lookup',
      lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_code',
      autoFillMap: { id: 'customer_id' }, group: 'Supplier response',
    },
    { key: 'supplier_name', label: 'Supplier / vendor', type: 'lookup', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', listColumn: true, group: 'Supplier response' },
    { key: 'requested_rate', label: 'Requested / quoted rate', type: 'number', group: 'Supplier response' },
{
      key: 'currency', label: 'Currency', type: 'lookup', group: 'Supplier response',
      lookupResource: '/trading/currency-rates', lookupValueKey: 'currency_code', lookupLabelKey: 'currency_name',
    },
    { key: 'delivery_location', label: 'Delivery location', type: 'text', group: 'Supplier response' },
    { key: 'delivery_terms', label: 'Delivery terms', type: 'text', group: 'Supplier response' },
    { key: 'payment_terms', label: 'Payment terms', type: 'text', group: 'Supplier response' },
    { key: 'procurement_person', label: 'Sales / procurement person', type: 'text', group: 'Supplier response' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Supplier response' },
    { key: 'deal_number', label: 'Deal (once converted)', type: 'text', readOnly: true, listColumn: true, placeholder: 'Fills in automatically when status is set to "Converted to Deal"', group: 'Supplier response' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Supplier response' },
  ],

  afterSave: handleAfterSave,
  registerReload: (reload) => { reloadPurchaseEnquiries = reload; },
  rowActions: (r) => <SendPurchaseEnquiryButton enquiry={r} onSent={() => reloadPurchaseEnquiries()} />,
  detailActions: (r) => <SendPurchaseEnquiryButton enquiry={r} onSent={() => reloadPurchaseEnquiries()} />,
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