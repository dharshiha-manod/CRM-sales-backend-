import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { api } from '../lib/api';
import { applyPriceListRates } from '../lib/priceListLookup';
import { SendPurchaseEnquiryButton, SendAllUnsentBar } from './SendPurchaseEnquiryButton';
import { CompareSuppliersBar } from './EnquiryComparison';

const STATUSES = ['Draft', 'Sent', 'Supplier Responded', 'Under Comparison', 'Negotiation', 'Approved', 'Rejected', 'Converted to Deal', 'Closed'];

// Handed this page's own reload() via registerReload below, so the
// Send-to-supplier button can refresh the list/detail after a real send
// updates status to 'Sent' server-side.
let reloadPurchaseEnquiries: () => void = () => {};

// Reuses the same /clients/:id/trading-snapshot endpoint Deal Management
// already calls — looks at that customer's existing Requirements and
// Quotations for a line matching the product on this enquiry, and fills
// "Customer needs" from it. Never overwrites something the user already
// typed, and fails silently (stays manual) if nothing matches.
async function autoFillCustomerQuantity(
  matched: Record<string, unknown>,
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
) {
  const clientId = matched.id as string | undefined;
  if (!clientId) return;
  try {
    const res = await api<{
      data: {
        requirements: Array<{ requirement_items?: Array<{ quantity?: number; product_name?: string; products?: { product_name?: string } | null }> }>;
        quotations: Array<{ quotation_items?: Array<{ quantity?: number; product_name?: string; products?: { product_name?: string } | null }> }>;
      };
       }>(`/clients/${clientId}/trading-snapshot?quotationStatuses=accepted,converted`);
    const items = [
      ...res.data.quotations.flatMap((q) => q.quotation_items ?? []),
      ...res.data.requirements.flatMap((r) => r.requirement_items ?? []),
    ];
    setForm((prev) => {
      if (prev.customer_quantity) return prev; // don't clobber a manual entry
      const productName = (prev.product_name ?? '').trim().toLowerCase();
      if (!productName) return prev;
      const match = items.find((item) => (item.products?.product_name ?? item.product_name ?? '').trim().toLowerCase() === productName);
      if (!match || match.quantity == null) return prev;
      return { ...prev, customer_quantity: String(match.quantity) };
    });
  } catch {
    // Auto-fill is a convenience — leave the field usable manually if this fails.
  }
}

// When a customer is picked, fills "Sales / procurement person" with the
// sales rep assigned to that customer (first active assignment). Never
// overwrites a person already chosen, and does nothing if the customer has
// no active assignment, so the field stays manual in that case.
function autoFillSalesRep(
  matched: Record<string, unknown>,
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
) {
  const assignments = (matched.sales_representative_client_assignments as Array<{ status?: string; sales_representatives?: { employee_code?: string } | null }> | undefined) ?? [];
  const active = assignments.find((a) => a.status === 'active' && a.sales_representatives?.employee_code);
  const code = active?.sales_representatives?.employee_code;
  if (!code) return;
  setForm((prev) => (prev.procurement_person ? prev : { ...prev, procurement_person: code }));
}

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
    window.alert(`${String(enquiry.enquiry_number ?? '')} has no Customer, so it cannot become a Deal.\n\n• Selling to a customer? Pick the Customer, then set the status to "Converted to Deal" again.\n• Buying only for your own stock? Set the status to "Approved" instead. The incoming shipment is then created automatically.`);
    return; // enquiry stays "Converted to Deal" with no deal_number; editing status again retries
  }
  try {
    const dealNumber = `DEAL-${String(enquiry.enquiry_number ?? '').replace(/^ENQ-/, '')}`;
    // Same Price List lookup the Deal form runs, so a Deal made from an enquiry starts with its selling rate, discount and tax.
    let priced: Record<string, string> = {
      product_name: String(enquiry.product_name ?? ''),
      customer_name: customerName,
      supplier_name: String(enquiry.supplier_name ?? ''),
      quantity: String(enquiry.quantity ?? ''),
      customer_quantity: String(enquiry.customer_quantity ?? enquiry.quantity ?? ''),
    };
    await applyPriceListRates(priced.product_name, (update) => { priced = update(priced); }, { selling: 'selling_rate', purchase: 'purchase_rate', currency: 'currency', discount: 'discount_percent', tax: 'tax_percent', purchaseDiscount: 'purchase_discount_percent' });
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
        // Falls back to the full purchase quantity when left blank, so
        // enquiries that don't set this keep behaving exactly as before.
        customer_quantity: enquiry.customer_quantity ?? enquiry.quantity,
        unit: enquiry.unit,
        currency: enquiry.currency ?? priced.currency,
        // The supplier's real quote wins; the price list purchase rate is only the fallback.
        purchase_rate: enquiry.requested_rate ?? priced.purchase_rate,
        // Discount the supplier gave on this enquiry (falls back to the price list's supplier discount).
        purchase_discount_percent: enquiry.discount_percent ?? priced.purchase_discount_percent,
        selling_rate: priced.selling_rate,
        discount_percent: priced.discount_percent,
        tax_percent: priced.tax_percent,
        payment_terms: enquiry.payment_terms,
        delivery_terms: enquiry.delivery_terms,
        // Global/admin roles aren't locked to one industry, so the server
        // can't infer this — it must come from the enquiry being converted.
        industry_type_id: enquiry.industry_type_id ?? null,
      }),
    });
    await api(`/trading/purchase-enquiries/${enquiry.id}`, { method: 'PATCH', body: JSON.stringify({ deal_number: dealNumber }) });
    await reload();
  } catch (caught) {
    window.alert(`Could not create the Deal for ${String(enquiry.enquiry_number ?? '')}: ${caught instanceof Error ? caught.message : 'unknown error'}`);
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
  icon: '✉',
  emptyIcon: '✉',
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
  industryScoped: true,
     lookupLabelKey: 'product_code',
     listColumn: true,
     group: 'Requirement',
     autoFillMap: { unit: 'unit' },
     // The Price List purchase rate goes into the read-only reference
     // field (price_list_rate) only — never into the quoted rate, so an
     // old price is not mistaken for what the supplier actually quoted.
     onLookupChange: (matched, setForm) => {
       void applyPriceListRates(String(matched.product_name ?? ''), setForm, { purchase: 'price_list_rate', currency: 'currency', discount: 'discount_percent', tax: 'tax_percent' });
     },
   },
     {
       key: 'quantity', label: 'Quantity to purchase', type: 'number', group: 'Requirement',
       onValueChangeAsync: (_v, form, setForm) => {
         if (form.product_name) void applyPriceListRates(form.product_name, setForm, { purchase: 'price_list_rate', currency: 'currency', discount: 'discount_percent', tax: 'tax_percent' });
       },
     },
    {
      key: 'customer_quantity', label: 'Customer needs (out of the above)', type: 'number', group: 'Requirement',
      placeholder: 'Leave blank if this whole quantity is for one customer',
    },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Requirement' },
    { key: 'specification', label: 'Specification', type: 'textarea', group: 'Requirement' },
        {
key: 'customer_name', label: 'Customer (needed to convert this to a Deal)', type: 'lookup',
lookupResource: '/clients', lookupValueKey: 'client_name', lookupLabelKey: 'client_name',
lookupSecondaryLabelKey: 'client_code',
      autoFillMap: { id: 'customer_id' }, group: 'Supplier response',
      // Pick the product first, then the customer — this looks up that
      // customer's saved requirement for the product and fills the
      // quantity for you.
      onLookupChange: (matched, setForm) => {
        void autoFillCustomerQuantity(matched, setForm);
        autoFillSalesRep(matched, setForm);
      },
    },
    // Hidden helper field — never rendered (visibleIf always false), but
    // being in `fields` means submit() now actually sends the customer_id
    // that autoFillMap sets above, instead of silently dropping it.
    { key: 'customer_id', label: 'Customer ID', type: 'text', visibleIf: () => false },
    { key: 'supplier_name', label: 'Supplier / vendor', helpText: 'Select one or more suppliers. A separate enquiry is created for each.', type: 'multi-lookup', lookupValueKey: 'supplier_name', lookupResource: '/trading/suppliers', lookupLabelKey: 'supplier_name', listColumn: true, group: 'Supplier response',
      onValueChangeAsync: (_v, form, setForm) => {
        if (form.product_name) void applyPriceListRates(form.product_name, setForm, { purchase: 'price_list_rate', currency: 'currency', discount: 'discount_percent', tax: 'tax_percent' });
      },
    },
    // Reference only. Not a saved column (the API drops it on save). Shows the
    // last matched Price List purchase rate so the team can compare it with the
    // rate the supplier tells them.
    { key: 'price_list_rate', label: 'Last price list rate (reference only)', type: 'number', readOnly: true, group: 'Supplier response', placeholder: 'Shows after you pick a product' },
    { key: 'requested_rate', label: 'Quoted rate (from supplier)', type: 'number', group: 'Supplier response', placeholder: 'Type the rate the supplier tells you' },
    { key: 'discount_percent', label: 'Discount from supplier (%)', type: 'number', group: 'Supplier response', placeholder: 'Type the discount % the supplier gives' },
    { key: 'tax_percent', label: 'Tax (%)', type: 'number', group: 'Supplier response', placeholder: 'Type the tax % the supplier charges' },
    {
      key: 'net_purchase_amount',
      label: 'Net purchase amount (after discount & tax)',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => {
        const gross = (Number(r.requested_rate) || 0) * (Number(r.quantity) || 0);
        const afterDiscount = gross - gross * ((Number(r.discount_percent) || 0) / 100);
        const net = afterDiscount + afterDiscount * ((Number(r.tax_percent) || 0) / 100);
        if (!gross) return '—'; // no quoted rate yet
        return `₹${net.toLocaleString()}`;
      },
      group: 'Supplier response',
    },
{
      key: 'currency', label: 'Currency', type: 'lookup', group: 'Supplier response',
      lookupResource: '/trading/currency-rates', lookupValueKey: 'currency_code', lookupLabelKey: 'currency_name',
    },
    { key: 'delivery_location', label: 'Delivery location', type: 'text', group: 'Supplier response' },
    {
      key: 'delivery_terms', label: 'Delivery terms', type: 'combo', group: 'Supplier response',
      comboOptions: ['FOB', 'CIF', 'CFR', 'Ex-Works', 'DAP', 'DDP', 'FCA'],
    },
    {
      key: 'payment_terms', label: 'Payment terms', type: 'combo', group: 'Supplier response',
      comboOptions: ['100% Advance', '50% Advance, 50% on Delivery', 'Net 15', 'Net 30', 'Net 45', 'Against Invoice', 'Cash on Delivery'],
    },
    {
      key: 'procurement_person', label: 'Handled by (sales / procurement person)', type: 'lookup', group: 'Supplier response',
      lookupResource: '/sales-representatives', lookupValueKey: 'employee_code', lookupLabelKey: 'user_profiles.display_name',
    },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, group: 'Supplier response' },
    { key: 'deal_number', label: 'Deal (once converted)', type: 'text', readOnly: true, listColumn: true, placeholder: 'Fills in automatically when status is set to "Converted to Deal"', group: 'Supplier response' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Supplier response' },
  ],

  afterSave: handleAfterSave,
  // One save = one enquiry per ticked supplier, each with its own ENQ number, so each
  // supplier's reply is matched to only its own enquiry. Editing stays one supplier.
  submitVariants: (form, isEditing) => {
    const names = Array.from(new Set((form.supplier_name ?? '').split(',').map((s) => s.trim()).filter(Boolean)));
    if (names.length === 0) throw new Error('Pick at least one supplier.');
    if (isEditing && names.length > 1) throw new Error('An enquiry belongs to one supplier. Untick the extra suppliers, or use Duplicate to make another enquiry.');
    return names.map((n) => ({ supplier_name: n }));
  },
  renderInsights: (rows) => (
    <>
      <SendAllUnsentBar rows={rows} onDone={() => reloadPurchaseEnquiries()} />
      <CompareSuppliersBar rows={rows} onChanged={() => reloadPurchaseEnquiries()} />
    </>
  ),
  // "Duplicate" in the ⋮ menu: opens a new enquiry with the requirement copied so only
  // the supplier needs changing. Supplier, quoted rate, discount, tax, status, deal and
  // notes are deliberately NOT copied — those belong to the original supplier's response.
  duplicateFrom: (r) => {
    const keys = ['product_name', 'quantity', 'customer_quantity', 'unit', 'specification', 'required_by_date', 'customer_name', 'customer_id', 'procurement_person', 'currency', 'delivery_location', 'delivery_terms', 'payment_terms'];
    const out: Record<string, string> = {};
    for (const k of keys) if (r[k] != null && r[k] !== '') out[k] = String(r[k]);
    return out;
  },
  registerReload: (reload) => { reloadPurchaseEnquiries = reload; },
  // Shown directly in the row (not inside the ⋮ menu), and the table fits the
  // screen so the Send button is visible without scrolling sideways.
  inlineActions: (r) => <SendPurchaseEnquiryButton enquiry={r} onSent={() => reloadPurchaseEnquiries()} />,
  fitToScreen: true,
  detailActions: (r) => <SendPurchaseEnquiryButton enquiry={r} onSent={() => reloadPurchaseEnquiries()} />,
  kpis: [
    { icon: '✉', iconClass: 'kpi-icon-ink', label: 'Total enquiries', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pending supplier response', value: (r) => String(r.filter((x) => x.status === 'Sent').length) },
    { icon: '⚖', iconClass: 'kpi-icon-school', label: 'Under comparison', value: (r) => String(r.filter((x) => x.status === 'Under Comparison').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Converted', value: (r) => String(r.filter((x) => x.status === 'Converted to Deal').length) },
  ],
 
};

export function TradingPurchaseEnquiryPage() {
  return <TradingMasterPage config={config} />;
}