// FILE: admin/src/components/TradingDealPage.tsx
import { useEffect, useState } from 'react';
import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';
import { api } from '../lib/api';
import { applyPriceListRates, isRateActive } from '../lib/priceListLookup';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import { DealLinkedRecords } from './DealLinkedRecords';
import { buildDraftFromDeal } from '../lib/tradeDocumentHandoff';
import { findRate, getBaseCurrency, loadCurrencyRates } from '../lib/currencyLookup';
import type { CurrencyRate } from '../lib/currencyLookup';

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
type SnapshotCandidate = { requirement?: SnapshotRequirement; quotation?: SnapshotQuotation };
type DynamicOption = { value: string; label: string };

// The candidate records are deliberately kept with the fetched snapshot: picking
// one must not require a second request just to recover its product and rates.
let requirementCandidates = new Map<string, SnapshotCandidate>();

function candidateItemLabel(item?: SnapshotItem): string {
  const productName = item?.products?.product_name ?? item?.product_name ?? 'No product';
  const quantity = item?.quantity == null ? '—' : String(item.quantity);
  return `${productName}, qty ${quantity}`;
}

function quotationReference(quotation: SnapshotQuotation): string {
  const number = quotation.quotation_number ?? quotation.id;
  return number.startsWith('QT-') ? number : `QT-${number}`;
}

function buildCandidateOptions(snapshot: TradingSnapshot): DynamicOption[] {
  requirementCandidates = new Map<string, SnapshotCandidate>();
  const options: DynamicOption[] = [];

  for (const requirement of snapshot.requirements) {
    const value = `requirement:${requirement.id}`;
    requirementCandidates.set(value, { requirement });
    options.push({
      value,
      label: `REQ — ${requirement.title ?? requirement.id} (${candidateItemLabel(requirement.requirement_items?.[0])})`,
    });
  }
  for (const quotation of snapshot.quotations) {
    const value = `quotation:${quotation.id}`;
    const requirement = snapshot.requirements.find((item) => item.id === quotation.requirement_id);
    requirementCandidates.set(value, { requirement, quotation });
    options.push({
      value,
      label: `${quotationReference(quotation)} — ${candidateItemLabel(quotation.quotation_items?.[0])}`,
    });
  }
  return options;
}

// Picks the supplier this product is normally bought from, so the Supplier field fills itself.
// Order of trust: (1) an active Supplier-specific Rate on the Price List, (2) a purchase enquiry that
// was Approved / Converted to Deal, (3) the most recent non-cancelled deal for the same product.
// It never overwrites a supplier the user picked by hand — only an empty field, or one this function
// filled earlier (e.g. the product changed after the customer was re-picked).
const SUPPLIER_ENQUIRY_STATUSES = ['Approved', 'Converted to Deal'];
const DEAD_DEAL_STATUSES = ['Cancelled', 'Lost'];
async function autoFillSupplierForProduct(
  productName: string,
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
) {
  if (!productName) return;
  const list = (path: string) => api<{ data: Array<Record<string, unknown>> }>(path).then((r) => r.data ?? []).catch(() => [] as Array<Record<string, unknown>>);
  const [prices, enquiries, deals, suppliers] = await Promise.all([
    list('/trading/price-lists'),
    list('/trading/purchase-enquiries'),
    list('/trading/deals'),
    list('/trading/suppliers'),
  ]);
  const wanted = productName.trim().toLowerCase();
  const sameProduct = (r: Record<string, unknown>) => String(r.product_name ?? '').trim().toLowerCase() === wanted;
  const priceRow = prices.find((r) => sameProduct(r) && isRateActive(r) && r.rate_type === 'Supplier-specific Rate' && r.supplier_name);
  const found =
    priceRow?.supplier_name ??
    enquiries.find((r) => sameProduct(r) && r.supplier_name && SUPPLIER_ENQUIRY_STATUSES.includes(String(r.status)))?.supplier_name ??
    deals.find((r) => sameProduct(r) && r.supplier_name && !DEAD_DEAL_STATUSES.includes(String(r.status)))?.supplier_name;
  if (!found) return;
  const name = String(found).trim();
  const supplier = suppliers.find((x) => String(x.supplier_name ?? '').trim() === name);
  setForm((prev) => {
    if (prev.supplier_name && prev._supplier_auto !== '1') return prev; // user's own choice wins
    const next: Record<string, string> = { ...prev, supplier_name: name, _supplier_auto: '1' };
    const fromSupplier: Record<string, string> = { id: 'supplier_id', address: 'supplier_address', phone: 'supplier_phone', contact_person: 'supplier_contact_person', tax_number: 'supplier_tax_number' };
    for (const [source, dest] of Object.entries(fromSupplier)) next[dest] = supplier?.[source] != null ? String(supplier[source]) : '';
    // A supplier-specific price-list rate is that supplier's real rate — use it (and its discount).
    if (priceRow?.purchase_rate != null) {
      next.purchase_rate = String(priceRow.purchase_rate);
      next.purchase_discount_percent = priceRow.discount != null ? String(priceRow.discount) : '';
    }
    return next;
  });
}

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
  const filledItem = quotation?.quotation_items?.[0] ?? requirement?.requirement_items?.[0];
  const filledProduct = filledItem?.products?.product_name ?? filledItem?.product_name;
  if (filledProduct) void autoFillSupplierForProduct(filledProduct, setForm);
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

// Fallback used only when the customer has no open requirement / accepted quotation.
// Uses the existing /requirements and /quotations list endpoints (both accept ?clientId=, newest first),
// so no backend change is needed. Rejected quotations and dropped requirements are ignored.
async function fillFromLatestHistory(
  clientId: string,
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
  setDynamicOptions: (key: string, options: DynamicOption[]) => void,
  setNote: (note: string) => void,
) {
  const [reqRes, quoRes] = await Promise.all([
    api<{ data: SnapshotRequirement[] }>(`/requirements?clientId=${clientId}`).catch(() => ({ data: [] as SnapshotRequirement[] })),
    api<{ data: SnapshotQuotation[] }>(`/quotations?clientId=${clientId}`).catch(() => ({ data: [] as SnapshotQuotation[] })),
  ]);
  const hasProduct = (i?: SnapshotItem) => Boolean(i?.products?.product_name ?? i?.product_name);
  const requirements = (reqRes.data ?? []).filter((r) => r.status !== 'dropped' && hasProduct(r.requirement_items?.[0]));
  const quotations = (quoRes.data ?? []).filter((q) => q.status !== 'rejected' && hasProduct(q.quotation_items?.[0]));
  if (requirements.length === 0 && quotations.length === 0) {
    setNote('This customer has no requirement or quotation with a product yet. Please pick the product manually.');
    return;
  }
  // Newest first already. Fill the latest one, and keep the rest selectable in the picker.
  const quotation = quotations[0];
  const requirement = requirements.find((r) => r.id === quotation?.requirement_id) ?? requirements[0];
  fillFromRequirementAndQuotation(setForm, requirement, quotation);
  const source = quotation ? `quotation ${quotationReference(quotation)} (${quotation.status ?? 'n/a'})` : `requirement "${requirement?.title ?? requirement?.id}" (${requirement?.status ?? 'n/a'})`;
  let note = `Product filled from this customer's latest ${source}. Change it if this deal is for something else.`;
  if (quotations.length + requirements.length > 1) {
    const candidates = buildCandidateOptions({ client: {}, requirements, quotations });
    setDynamicOptions('requirement_id', candidates);
    setForm((prev) => ({ ...prev, _requirement_candidate_count: String(candidates.length) }));
    note += ' Other products are in "Requirement (if multiple)".';
  }
  setNote(note);
}

async function autoFillFromCustomer(
  matched: Record<string, unknown>,
  setForm: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
  setDynamicOptions: (key: string, options: DynamicOption[]) => void,
) {
  const clientId = matched.id as string | undefined;
  if (!clientId) return;
  const setNote = (note: string) => setForm((prev) => ({ ...prev, _snapshot_note: note }));
  requirementCandidates = new Map<string, SnapshotCandidate>();
  setDynamicOptions('requirement_id', []);
  setForm((prev) => ({ ...prev, _requirement_candidate_count: '0', _requirement_candidate_id: '', requirement_id: '', quotation_id: '', _snapshot_note: '' }));
  try {
    const res = await api<{ data: TradingSnapshot }>(`/clients/${clientId}/trading-snapshot`);
    const snapshot = res.data;
    if (snapshot.quotations.length === 0 && snapshot.requirements.length === 0) {
      // Nothing open/accepted. Instead of leaving Product blank, fall back to the customer's most
      // recent requirement / quotation of any status (converted, sent, draft...) — newest first.
      await fillFromLatestHistory(clientId, setForm, setDynamicOptions, setNote);
      return;
    }
    const quotation = snapshot.quotations[0];
    const requirement = snapshot.requirements.find((r) => r.id === quotation?.requirement_id) ?? snapshot.requirements[0];
    // Exactly one relevant record on both sides — auto-select it, per spec.
    if (snapshot.quotations.length <= 1 && snapshot.requirements.length <= 1) {
      fillFromRequirementAndQuotation(setForm, requirement, quotation);
    } else {
      const candidates = buildCandidateOptions(snapshot);
      setDynamicOptions('requirement_id', candidates);
      setForm((prev) => ({ ...prev, _requirement_candidate_count: String(candidates.length) }));
      setNote(`This customer has ${candidates.length} requirements/quotations. Choose one in "Requirement (if multiple)" to fill the product.`);
    }
  } catch {
    // Auto-fill is a convenience — leave the form usable, but say so instead of failing silently.
    setNote("Couldn't load this customer's requirements/quotations. Please enter the product manually.");
  }
}

// What the CUSTOMER takes. Falls back to the full purchased quantity when "Quantity for this
// customer" is blank — the same rule the server uses when it creates the Sales Order.
function customerQty(r: Record<string, unknown>) {
  const own = Number(r.customer_quantity);
  return Number.isFinite(own) && own > 0 ? own : (Number(r.quantity) || 0);
}
function sellingValue(r: Record<string, unknown>) {
  return (Number(r.selling_rate) || 0) * customerQty(r);
}
// Supplier discount is taken off the purchase side only (never mixed with the customer discount).
function supplierFactor(r: Record<string, unknown>) {
  return 1 - (Number(r.purchase_discount_percent) || 0) / 100;
}
// Everything bought from the supplier (e.g. 100 units) — what you actually pay, after the supplier's discount.
function purchaseValue(r: Record<string, unknown>) {
  // Supplier quantity left blank -> assume everything bought is what the customer takes,
  // so Purchase amount agrees with the cost used in Gross margin / Margin %.
  const boughtQty = Number(r.quantity) > 0 ? Number(r.quantity) : customerQty(r);
  return (Number(r.purchase_rate) || 0) * boughtQty * supplierFactor(r);
}
// Cost of only the units sold to this customer (e.g. 21 of 100). Margin is worked out on this,
// because the unsold units are still your stock, not a loss on this deal.
function soldCostValue(r: Record<string, unknown>) {
  return (Number(r.purchase_rate) || 0) * customerQty(r) * supplierFactor(r);
}
// Same order of operations as convertConfirmedDealToOrders() in the API's
// trading.repository.ts (discount off the gross, then tax on the
// discounted amount) — this is what actually lands on the real Sales
// Order once the deal is Confirmed, so the preview here must match it.
function netSellingValue(r: Record<string, unknown>) {
  const gross = sellingValue(r);
  const afterDiscount = gross - gross * ((Number(r.discount_percent) || 0) / 100);
  return afterDiscount + afterDiscount * ((Number(r.tax_percent) || 0) / 100);
}
// ---- Currency ---------------------------------------------------------------------------
// Rates come from Currency Management (loaded once by the page wrapper at the bottom). A deal is
// shown in ITS OWN currency, with the company-currency value next to it, and every total across
// deals (the KPIs) is added up in the company currency so dollars and rupees are never mixed.
let currencyRows: CurrencyRate[] = [];
const SYMBOLS: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥' };
const baseCode = () => getBaseCurrency(currencyRows);
const dealCode = (r: Record<string, unknown>) => String(r.currency ?? '').trim().toUpperCase();
function moneyIn(code: string, amount: number) {
  const text = amount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return `${SYMBOLS[code] ?? `${code} `}${text}`;
}
/** Rate from the deal's currency to the company currency; 1 when they are the same or the deal has no currency. */
function rateToBase(r: Record<string, unknown>): number | null {
  const code = dealCode(r);
  if (!code || code === baseCode()) return 1;
  return findRate(currencyRows, code, baseCode());
}
/** "$80,000 (≈ ₹77,20,000)" for a foreign-currency deal, plain "₹80,000" for a company-currency one. */
function amountText(r: Record<string, unknown>, amount: number) {
  const code = dealCode(r) || baseCode();
  const own = moneyIn(code, amount);
  if (code === baseCode()) return own;
  const rate = rateToBase(r);
  return rate == null ? `${own} (no ${code} → ${baseCode()} rate)` : `${own} (≈ ${moneyIn(baseCode(), amount * rate)})`;
}
// A deal whose currency has no rate is left OUT of the company-currency totals (never counted 1:1,
// which would add dollars into a rupee total). kpiTotal() says how many were left out.
const toBase = (r: Record<string, unknown>, amount: number) => {
  const rate = rateToBase(r);
  return rate == null ? 0 : amount * rate;
};
function kpiTotal(rows: Array<Record<string, unknown>>, amountOf: (r: Record<string, unknown>) => number) {
  const total = rows.reduce((sum, x) => sum + toBase(x, amountOf(x)), 0);
  const skipped = rows.filter((x) => rateToBase(x) == null).length;
  return skipped ? `${moneyIn(baseCode(), total)} (excl. ${skipped} deal${skipped > 1 ? 's' : ''} with no rate)` : moneyIn(baseCode(), total);
}

// Step 7/8 of the Trading connectivity plan: creating the Sales Order(s)
// for a Confirmed deal used to happen here, client-side. It's now done by
// the backend in trading.repository.ts (convertConfirmedDealToOrders),
// because that path also needs to create the core FS- order Collections
// reads from — something only the server can do safely. Saving a Deal is
// now just a save; the backend reacts to status becoming "Confirmed" on
// its own.

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
  inlineStatus: true,
  fitToScreen: true,
  searchableKeys: ['deal_number', 'deal_name', 'customer_name', 'supplier_name', 'product_name', 'sales_rep'],
  fields: [
    {
      key: 'deal_number', label: 'Deal number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'DEAL',
      render: (_v, r) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <strong style={{ fontWeight: 600 }}>{String(r.deal_number ?? '—')}</strong>
          <span style={{ color: '#64748b', fontSize: '.74rem' }}>{String(r.deal_name ?? '')}</span>
        </span>
      ),
    },
    { key: 'deal_name', label: 'Deal name', type: 'text', required: true },
    {
      key: 'customer_name',
      label: 'Customer',
      type: 'lookup',
      required: true,
      lookupResource: '/clients',
      lookupValueKey: 'client_name',
      lookupLabelKey: 'client_code',
      lookupSecondaryLabelKey: 'client_name', // dropdown shows "CLI-2609-00047 — Customer name"
      listColumn: true,
      render: (_v, r) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <strong style={{ fontWeight: 600 }}>{String(r.customer_name ?? '—')}</strong>
          <span style={{ color: '#64748b', fontSize: '.74rem' }}>{r.supplier_name ? `Supplier: ${String(r.supplier_name)}` : ''}</span>
        </span>
      ),
      // Client-level fields the moment a customer is picked — instant,
      // no network wait (this is the existing autoFillMap feature, just
      // switched on for Deals). Requirement/quotation-level fields (product,
      // quantity, supplier, rates) fill a moment later via onLookupChange,
      // since those need a backend call.
      autoFillMap: { client_name: 'customer_name', id: 'customer_id', address: 'customer_address', city: 'customer_city', gstin: 'customer_gstin' },
      onLookupChange: (matched, setForm, setDynamicOptions) => {
        fillPrimaryContact(matched, setForm, 'customer');
        void autoFillFromCustomer(matched, setForm, setDynamicOptions);
      },
      // A customer-specific price-list rate can only match once the customer is known,
      // so re-run the lookup when the customer is picked after the product.
      onValueChangeAsync: (_v, form, setForm) => {
        if (form.product_name) void applyPriceListRates(form.product_name, setForm, { selling: 'selling_rate', purchase: 'purchase_rate', currency: 'currency', discount: 'discount_percent', tax: 'tax_percent', purchaseDiscount: 'purchase_discount_percent' });
      },
    },
    {
      key: 'requirement_id',
      label: 'Requirement (if multiple)',
      type: 'select',
      group: 'Product & quantity',
      dynamicOptionsKey: 'requirement_id',
      dynamicOptionsValueKey: '_requirement_candidate_id',
      visibleIf: (form) => Number(form._requirement_candidate_count) > 1,
      onValueChangeAsync: (candidateKey, _form, setForm) => {
        const candidate = requirementCandidates.get(candidateKey);
        if (candidate) fillFromRequirementAndQuotation(setForm, candidate.requirement, candidate.quotation);
      },
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
      // trading_suppliers stores these as flat columns (unlike clients,
      // there's no nested contacts table), so a plain autoFillMap covers
      // everything — no onLookupChange needed here.
      autoFillMap: { id: 'supplier_id', address: 'supplier_address', phone: 'supplier_phone', contact_person: 'supplier_contact_person', tax_number: 'supplier_tax_number' },
      onLookupChange: (_matched, setForm) => setForm((prev) => ({ ...prev, _supplier_auto: '' })),
      onValueChangeAsync: (_v, form, setForm) => {
        if (form.product_name) void applyPriceListRates(form.product_name, setForm, { selling: 'selling_rate', purchase: 'purchase_rate', currency: 'currency', discount: 'discount_percent', tax: 'tax_percent', purchaseDiscount: 'purchase_discount_percent' });
      },
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
  industryScoped: true,
  lookupLabelKey: 'product_code',
  lookupSecondaryLabelKey: 'product_name', // dropdown shows "PRD-001 — Product name"
  // Standard product price fills first, instantly (existing behaviour —
  // this is the fallback the spec calls "the flat product price"). The
  // Price List lookup below then overwrites it a moment later IF a more
  // specific active rate exists, per Step 3 of the plan.
  autoFillMap: { unit: 'unit', cost_price: 'purchase_rate', selling_price: 'selling_rate' },
  listColumn: true,
  group: 'Product & quantity',
  onLookupChange: (matched, setForm) => {
    void applyPriceListRates(String(matched.product_name ?? ''), setForm, { selling: 'selling_rate', purchase: 'purchase_rate', currency: 'currency', discount: 'discount_percent', tax: 'tax_percent', purchaseDiscount: 'purchase_discount_percent' });
    void autoFillSupplierForProduct(String(matched.product_name ?? ''), setForm);
  },
},
    { key: 'product_category', label: 'Product category', type: 'text', group: 'Product & quantity' },
    {
      key: 'quantity', label: 'Quantity (purchased from supplier)', type: 'number', group: 'Product & quantity',
      // Re-picks the rate once quantity is known, so a bulk purchase moves
      // off the base rate onto a Wholesale-tier price-list row as soon as
      // quantity crosses that row's Minimum quantity — same shared lookup
      // the Product field above already triggers, just re-run now that
      // quantity is in hand.
      onValueChangeAsync: (_v, form, setForm) => {
        if (form.product_name) void applyPriceListRates(form.product_name, setForm, { selling: 'selling_rate', purchase: 'purchase_rate', currency: 'currency', discount: 'discount_percent', tax: 'tax_percent', purchaseDiscount: 'purchase_discount_percent' });
      },
    },
    {
      key: 'customer_quantity', label: 'Quantity for this customer', type: 'number', group: 'Product & quantity',
      placeholder: 'Leave blank if the customer takes the full purchased quantity',
      onValueChangeAsync: (_v, form, setForm) => {
        if (form.product_name) void applyPriceListRates(form.product_name, setForm, { selling: 'selling_rate', purchase: 'purchase_rate', currency: 'currency', discount: 'discount_percent', tax: 'tax_percent', purchaseDiscount: 'purchase_discount_percent' });
      },
    },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Product & quantity' },
    { key: 'currency', label: 'Currency', type: 'text', group: 'Product & quantity', placeholder: 'e.g. INR, USD' },
    { key: 'purchase_rate', label: 'Purchase rate', type: 'number', group: 'Rates & margin' },
    { key: 'purchase_discount_percent', label: 'Supplier discount (%)', type: 'number', group: 'Rates & margin', placeholder: 'Auto-fills from the Purchase Price List / enquiry' },
    { key: 'selling_rate', label: 'Selling rate', type: 'number', group: 'Rates & margin' },
    { key: 'discount_percent', label: 'Discount (%)', type: 'number', group: 'Rates & margin', placeholder: 'Auto-fills from the matched Price List rate' },
    { key: 'tax_percent', label: 'Tax (%)', type: 'number', group: 'Rates & margin', placeholder: 'Auto-fills from the matched Price List rate' },
    {
      key: 'gross_amount',
      label: 'Gross amount (Selling)',
      type: 'text',
      readOnly: true,
      format: (_v, r) => amountText(r, sellingValue(r)),
      group: 'Rates & margin',
    },
    {
      key: 'net_amount',
      label: 'Net amount (after discount & tax)',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, r) => amountText(r, netSellingValue(r)),
      group: 'Rates & margin',
    },
    {
      key: 'purchase_amount',
      label: 'Purchase amount (after supplier discount)',
      type: 'text',
      readOnly: true,
      format: (_v, r) => amountText(r, purchaseValue(r)),
      group: 'Rates & margin',
    },
    {
      key: 'gross_margin',
      label: 'Gross margin',
      type: 'text',
      readOnly: true,
      format: (_v, r) => amountText(r, sellingValue(r) - soldCostValue(r)),
      group: 'Rates & margin',
    },
    {
      key: 'margin_percent',
      label: 'Margin %',
      type: 'text',
      readOnly: true,
      listColumn: true,
      render: (_v, r) => {
        const sv = sellingValue(r);
        if (!sv) return '—';
        const pct = ((sv - soldCostValue(r)) / sv) * 100;
        return (
          <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <strong style={{ fontWeight: 600, color: pct < 0 ? '#991b1b' : '#166534' }}>{pct.toFixed(2)}%</strong>
            <span style={{ color: '#64748b', fontSize: '.74rem' }}>{amountText(r, sv - soldCostValue(r))}</span>
          </span>
        );
      },
      format: (_v, r) => {
        const sv = sellingValue(r);
        if (!sv) return '—';
        return `${(((sv - soldCostValue(r)) / sv) * 100).toFixed(2)}%`;
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
  kpis: [
    { icon: '◆', iconClass: 'kpi-icon-ink', label: 'Total deals', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Open deals', value: (r) => String(r.filter((x) => !['Completed', 'Cancelled', 'Lost'].includes(String(x.status))).length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Confirmed', value: (r) => String(r.filter((x) => x.status === 'Confirmed' || x.status === 'In Progress').length) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Deal value', value: (r) => kpiTotal(r, sellingValue) },
    { icon: '↗', iconClass: 'kpi-icon-green', label: 'Expected margin', value: (r) => kpiTotal(r, (x) => sellingValue(x) - soldCostValue(x)) },
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
  const [, setRatesLoaded] = useState(0);
  useEffect(() => {
    let cancelled = false;
    loadCurrencyRates(true)
      .then((rows) => { currencyRows = rows; if (!cancelled) setRatesLoaded((n) => n + 1); })
      .catch(() => undefined); // amounts simply show without the company-currency value
    return () => { cancelled = true; };
  }, []);
  return <TradingMasterPage config={config} />;
}