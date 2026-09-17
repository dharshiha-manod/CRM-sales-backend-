// FILE: admin/src/components/DealLinkedRecords.tsx
// Now a thin wrapper over the generic LinkedRecords panel, which was
// generalised out of this file so every module in the chain gets the same
// backward traceability instead of only Deals having it.
//
// Two behaviour changes come with that:
//  - "Open →" opens the actual related record, via lib/recordFocus.ts.
//    The old version copied the deal number to the clipboard and dropped
//    the user on the target module's list to paste it into the search box
//    themselves; the comment here used to call that out as deferred work.
//  - Logistics, Import/Export, Customs and Claims are included, so a deal
//    shows its whole downstream chain rather than stopping at documents.
import { LinkedRecords } from './LinkedRecords';
import { TRADING_HASH } from '../lib/recordFocus';

export function DealLinkedRecords({ deal }: { deal: Record<string, unknown> }) {
  const dealNumber = String(deal.deal_number ?? '');
  if (!dealNumber) return null;

  return (
    <LinkedRecords
      heading={`Linked records for ${dealNumber}`}
      links={[
        {
          title: 'Sales orders', resource: '/trading/sales-orders', matchField: 'deal_number', matchValue: dealNumber,
          hash: TRADING_HASH.salesOrder, codeField: 'order_number', subField: 'status',
          emptyLabel: 'No sales order created from this deal yet.',
        },
        {
          title: 'Purchase enquiries', resource: '/trading/purchase-enquiries', matchField: 'deal_number', matchValue: dealNumber,
          hash: TRADING_HASH.purchaseEnquiry, codeField: 'enquiry_number', subField: 'status',
          emptyLabel: 'No purchase enquiry raised against this deal yet.',
        },
        {
          title: 'Shipments', resource: '/trading/shipments', matchField: 'deal_number', matchValue: dealNumber,
          hash: TRADING_HASH.shipment, codeField: 'shipment_number', subField: 'status',
          emptyLabel: 'No shipments created from this deal yet.',
        },
        {
          title: 'Logistics', resource: '/trading/logistics', matchField: 'deal_number', matchValue: dealNumber,
          hash: TRADING_HASH.logistics, codeField: 'logistics_number', subField: 'status',
          emptyLabel: 'No logistics movement recorded for this deal yet.',
        },
        {
          title: 'Import / export', resource: '/trading/import-export', matchField: 'deal_number', matchValue: dealNumber,
          hash: TRADING_HASH.importExport, codeField: 'transaction_number', subField: 'status',
          emptyLabel: 'No import/export transaction for this deal yet.',
        },
        {
          title: 'Trade documents', resource: '/trading/documents', matchField: 'deal_number', matchValue: dealNumber,
          hash: TRADING_HASH.tradeDocuments, codeField: 'document_number', subField: 'document_type',
          emptyLabel: 'No trade documents generated from this deal yet.',
        },
           {
          title: 'Claims', resource: '/trading/claims', matchField: 'deal_number', matchValue: dealNumber,
          hash: TRADING_HASH.claims, codeField: 'claim_number', subField: 'status',
          emptyLabel: 'No claims raised against this deal.',
        },
        {
          title: 'Commission', resource: '/trading/commissions', matchField: 'deal_number', matchValue: dealNumber,
          hash: TRADING_HASH.commission, codeField: 'commission_number', subField: 'status',
          emptyLabel: 'No commission calculated for this deal yet.',
        },
        {
          title: 'Profitability', resource: '/trading/profitability', matchField: 'deal_number', matchValue: dealNumber,
          hash: TRADING_HASH.profitability, codeField: 'deal_number', subField: 'analysis_level',
          emptyLabel: 'No profitability analysis run on this deal yet.',
        },
        {
          title: 'Compliance', resource: '/trading/compliance', matchField: 'deal_number', matchValue: dealNumber,
          hash: TRADING_HASH.tradeCompliance, codeField: 'compliance_reference', subField: 'status',
          emptyLabel: 'No compliance check recorded against this deal.',
        },
        {
          title: 'Trade finance', resource: '/trading/trade-finance', matchField: 'deal_number', matchValue: dealNumber,
          hash: TRADING_HASH.tradeFinance, codeField: 'finance_reference', subField: 'payment_status',
          emptyLabel: 'No trade finance arrangement recorded for this deal.',
        },
      ]}
    />
  );
}