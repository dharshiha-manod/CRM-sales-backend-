// FILE: admin/src/lib/recordFocus.ts
// Replaces the clipboard workaround in DealLinkedRecords.tsx, where
// "Open in Shipment Management →" copied the deal number and dropped the
// user on the module's list to paste it into the search box themselves.
//
// Same one-shot sessionStorage handoff as tradeDocumentHandoff.ts (the
// established pattern here, needed because each module only mounts when
// its own hash route is active, so one page can't call into another
// directly). The difference is what gets handed over: this queues a
// record to OPEN, not a draft to create.
//
// The shared TextileMasterPage engine consumes it after its first load and
// opens that record's View modal, so every industry's modules get real
// record links for free — no per-page routing changes.

const STORAGE_KEY = 'trading-record-focus';

export interface RecordFocus {
  /** API resource of the target module, e.g. '/trading/shipments' */
  resource: string;
  /** field on the target record to match against, e.g. 'shipment_number' */
  field: string;
  /** value to match, e.g. 'SHP-0001' */
  value: string;
}

/**
 * Navigates to `hash` and opens the matching record there.
 * @param hash module hash route, e.g. 'industry:trading:shipment'
 */
export function openRecord(hash: string, focus: RecordFocus): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(focus));
  } catch {
    // Locked-down environments: the user still lands on the right module
    // and can find the record by search.
  }
  if (window.location.hash.replace('#', '') === hash) {
    // Already on that module — the hash won't change, so no hashchange
    // fires and the page won't remount. Nudge it manually.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
}

/**
 * Returns and clears a pending focus, but only if it was meant for
 * `resource` — so navigating somewhere unrelated first doesn't leave a
 * stale focus that fires on the wrong module later.
 */
export function consumeRecordFocus(resource: string): RecordFocus | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecordFocus | null;
    if (!parsed || typeof parsed !== 'object' || parsed.resource !== resource) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return parsed;
  } catch {
    return null;
  }
}

/** Module hash routes, so linked-record panels don't hard-code strings. */
export const TRADING_HASH = {
  deal: 'industry:trading:deal',
  supplier: 'industry:trading:supplier-vendor',
  purchaseEnquiry: 'industry:trading:purchase-enquiry',
  priceList: 'industry:trading:price-rate-list',
  shipment: 'industry:trading:shipment',
  salesOrder: 'industry:trading:sales-order',
  tradeDocuments: 'industry:trading:trade-documents',
  currency: 'industry:trading:currency',
  logistics: 'industry:trading:logistics',
  importExport: 'industry:trading:import-export',
  customs: 'industry:trading:customs-clearance',
  claims: 'industry:trading:claims-disputes',
  commission: 'industry:trading:commission',
  commissionRules: 'industry:trading:commission-rules',
  profitability: 'industry:trading:trade-profitability',
  tradeCompliance: 'industry:trading:trade-compliance',
  tradeFinance: 'industry:trading:trade-finance-lc',
} as const;