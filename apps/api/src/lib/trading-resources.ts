// One generic engine backs every Trading module — mirrors the frontend's
// TextileMasterPage/TradingMasterPage pattern (config-driven, never
// duplicated per module). Add a new Trading module by adding a resource
// here and a matching CREATE TABLE in the migration; never hand-write a
// new controller/service/repository per module.
//
// `columns` is the allowlist of real, stored fields for this resource —
// it must match the frontend's FieldDef `key`s for that module, MINUS any
// field that is `readOnly` with a `format` function and no `autoGenerate`
// (those are computed client-side for display only and are never sent to
// the API as real data — e.g. deals' `gross_margin`, price-lists'
// `validity`, profitability's `gross_profit`). `status` is a base column
// on every table and is not repeated here.

export interface TradingResource {
  /** URL segment mounted at /trading/<path> */
  path: string;
  /** Postgres table name */
  table: string;
  /** Storable, non-computed field keys for this resource (excludes id/status/created_at/updated_at) */
  columns: string[];
  /** Primary human-facing identifying field, e.g. 'deal_number' */
  codeField: string;
  /** Fields that must be present (non-empty) on create */
  requiredFields: string[];
}

export const TRADING_RESOURCES: TradingResource[] = [

  {
    path: 'deals',
    table: 'trading_deals',
    codeField: 'deal_number',
    requiredFields: ['deal_number', 'deal_name', 'customer_name'],
    columns: ['deal_number', 'deal_name', 'customer_name', 'customer_id', 'customer_address', 'customer_city', 'customer_gstin', 'customer_contact_person', 'customer_phone', 'supplier_name', 'supplier_id', 'supplier_address', 'supplier_phone', 'supplier_contact_person', 'supplier_tax_number', 'product_name', 'product_category', 'quantity', 'unit', 'currency', 'purchase_rate', 'selling_rate', 'deal_date', 'expected_delivery_date', 'sales_rep', 'payment_terms', 'delivery_terms', 'priority', 'industry_type_id', 'notes', 'order_number'],
  },
  {
    path: 'shipments',
    table: 'trading_shipments',
    codeField: 'shipment_number',
    requiredFields: ['shipment_number'],
    columns: ['shipment_number', 'deal_number', 'customer_name', 'supplier_name', 'product_name', 'quantity', 'unit', 'batch_serial', 'shipment_date', 'expected_delivery_date', 'actual_delivery_date', 'origin', 'destination', 'transporter', 'tracking_number', 'vehicle_container_number', 'shipping_mode', 'freight_cost', 'notes', 'industry_type_id'],
  },
  {
    path: 'suppliers',
    table: 'trading_suppliers',
    codeField: 'supplier_id',
    requiredFields: ['supplier_id', 'supplier_name'],
       columns: ['supplier_id', 'supplier_name', 'company_name', 'contact_person', 'phone', 'email', 'address', 'city', 'country', 'tax_number', 'supplier_category', 'products_supplied', 'payment_terms', 'credit_limit', 'bank_details', 'notes', 'industry_type_id'],
  },
  {
    path: 'purchase-enquiries',
    table: 'trading_purchase_enquiries',
    codeField: 'enquiry_number',
    requiredFields: ['enquiry_number', 'product_name'],
    columns: ['enquiry_number', 'enquiry_date', 'required_by_date', 'product_name', 'quantity', 'unit', 'specification', 'supplier_name', 'requested_rate', 'currency', 'delivery_location', 'delivery_terms', 'payment_terms', 'procurement_person', 'notes', 'industry_type_id', 'deal_number'],
  },
  {
    path: 'price-lists',
    table: 'trading_price_lists',
    codeField: 'product_name',
    requiredFields: ['product_name'],
    columns: ['product_name', 'product_code', 'supplier_name', 'customer_name', 'rate_type', 'purchase_rate', 'selling_rate', 'currency', 'unit', 'min_quantity', 'tax', 'discount', 'effective_from', 'effective_to', 'notes', 'industry_type_id'],
  },
  // NEW — Step 7 of the Trading connectivity plan: a Sales Order created
  // automatically when a Deal's status is set to "Confirmed" (see
  // TradingDealPage.tsx's handleAfterSave / convertDealToSalesOrder).
  {
    path: 'sales-orders',
    table: 'trading_sales_orders',
    codeField: 'order_number',
    requiredFields: ['order_number'],
    columns: ['order_number', 'deal_number', 'customer_name', 'product_name', 'quantity', 'unit', 'currency', 'selling_rate', 'total_amount', 'order_date', 'expected_delivery_date', 'payment_terms', 'delivery_terms', 'notes', 'industry_type_id'],
  },
  {
    path: 'documents',
    table: 'trading_documents',
    codeField: 'document_id',
    requiredFields: ['document_id', 'document_number'],
    columns: [
      'document_id', 'document_number', 'document_type',
      'deal_number', 'shipment_number', 'customer_name', 'supplier_name', 'product_name',
      'reference_number', 'issue_date', 'expiry_date', 'issued_by', 'uploaded_by', 'file_reference',
      'verification_status', 'notes', 'industry_type_id',
      'quantity', 'unit', 'currency', 'unit_price', 'total_value',
      'sales_rep', 'order_date', 'expected_delivery_date',
      'shipping_mode', 'transporter', 'tracking_number',
      'billing_address', 'shipping_address', 'tax_details', 'contact_person',
      'generated_from',
    ],
  },
  // NEW — Logistics is its own record, keyed to an existing Shipment.
  // It does NOT write to trading_shipments: sharing that table meant two
  // incompatible status vocabularies overwriting each other, and fields
  // like current_location/pickup_date being silently dropped by
  // sanitizePayload because they were never columns there. Shipment stays
  // the commercial source of truth; Logistics is the movement record that
  // points at it.
  {
    path: 'logistics',
    table: 'trading_logistics',
    codeField: 'logistics_number',
    requiredFields: ['logistics_number', 'shipment_number'],
    columns: ['logistics_number', 'shipment_number', 'deal_number', 'customer_name', 'supplier_name', 'product_name', 'quantity', 'unit', 'origin', 'destination', 'carrier', 'shipping_mode', 'tracking_number', 'vehicle_container_number', 'driver_contact', 'pickup_date', 'estimated_departure_date', 'estimated_arrival_date', 'actual_departure_date', 'actual_delivery_date', 'current_location', 'distance', 'freight_cost', 'other_charges', 'currency', 'exchange_rate', 'base_currency', 'base_value', 'notes', 'industry_type_id'],
  },
  {
    path: 'currency-rates',
    table: 'trading_currency_rates',
    codeField: 'currency_code',
    requiredFields: ['currency_code'],
   columns: ['currency_code', 'currency_name', 'currency_symbol', 'country_region', 'decimal_places', 'is_base_currency', 'base_currency', 'target_currency', 'exchange_rate', 'effective_date', 'expiry_date', 'rate_source', 'notes', 'industry_type_id'],
  },
  {
    path: 'import-export',
    table: 'trading_import_export',
    codeField: 'transaction_number',
    requiredFields: ['transaction_number', 'transaction_type'],
columns: ['transaction_number', 'transaction_type', 'deal_number', 'customer_name', 'supplier_name', 'product_name', 'quantity', 'unit', 'country_of_origin', 'destination_country', 'port_of_loading', 'port_of_discharge', 'shipment_number', 'shipping_mode', 'invoice_number', 'currency', 'total_value', 'incoterm', 'expected_shipment_date', 'expected_arrival_date', 'actual_arrival_date', 'notes', 'industry_type_id', 'order_number', 'exchange_rate', 'base_currency', 'base_value', 'required_documents'],
  },
  {
    path: 'customs',
    table: 'trading_customs',
    codeField: 'customs_reference',
    requiredFields: ['customs_reference'],
   columns: ['customs_reference', 'shipment_number', 'transaction_number', 'transaction_type', 'customer_name', 'supplier_name', 'product_name', 'hs_code', 'quantity', 'country_of_origin', 'destination_country', 'port', 'declared_value', 'currency', 'customs_broker', 'declaration_date', 'customs_duty', 'other_charges', 'inspection_status', 'clearance_date', 'clearance_status', 'notes', 'industry_type_id', 'port_of_loading', 'port_of_discharge', 'exchange_rate', 'base_currency', 'base_value', 'required_documents', 'duty_paid_date', 'assessment_date'],
  },
  {
    path: 'claims',
    table: 'trading_claims',
    codeField: 'claim_number',
    requiredFields: ['claim_number'],
   columns: ['claim_number', 'claim_date', 'claim_type', 'priority', 'severity', 'claim_source', 'customer_name', 'supplier_name', 'deal_number', 'purchase_enquiry', 'shipment_number', 'logistics_provider', 'product_name', 'product_code', 'batch_number', 'quantity', 'claimed_value', 'currency', 'invoice_number', 'order_number', 'document_reference', 'description', 'evidence_documents', 'reported_by', 'assigned_to', 'department', 'responsible_party', 'expected_resolution_date', 'actual_resolution_date', 'resolution', 'compensation_amount', 'credit_note_reference', 'replacement_reference', 'refund_amount', 'notes', 'industry_type_id', 'logistics_number', 'transaction_number', 'exchange_rate', 'base_currency', 'base_value'],
  },
   // Commission is calculated from the transaction and a rule, not typed per
  // record, so the row stores WHAT it was calculated from (order/shipment/
  // invoice), WHICH rule fired, the amount as calculated, and the
  // eligibility evidence (delivery + collection status). `sales_rep` is no
  // longer required on create — it comes from the Deal.
  {
    path: 'commissions',
    table: 'trading_commissions',
    codeField: 'commission_number',
    requiredFields: ['commission_number', 'deal_number'],
    columns: ['commission_number', 'sales_rep', 'deal_number', 'order_number', 'shipment_number', 'invoice_number', 'customer_name', 'product_name', 'quantity', 'purchase_value', 'selling_value', 'currency', 'rule_code', 'commission_basis', 'commission_rate', 'commission_amount', 'calculation_note', 'qualifying_event', 'delivery_status', 'payment_status', 'eligible_date', 'calculation_date', 'approved_by', 'approval_date', 'payment_date', 'payment_reference', 'notes', 'industry_type_id'],
  },
  // NEW — the configurable rules behind Commission Management. Rules are
  // referenced by a commission record (rule_code), never copied into it, so
  // editing a rule never silently re-prices an approved payout.
  {
    path: 'commission-rules',
    table: 'trading_commission_rules',
    codeField: 'rule_code',
    requiredFields: ['rule_code', 'rule_name', 'commission_basis'],
    columns: ['rule_code', 'rule_name', 'commission_basis', 'qualifying_event', 'sales_rep', 'customer_name', 'product_name', 'product_category', 'deal_number', 'commission_rate', 'currency', 'tier_1_upto', 'tier_1_rate', 'tier_2_upto', 'tier_2_rate', 'tier_3_rate', 'target_amount', 'target_rate', 'below_target_rate', 'priority', 'effective_from', 'effective_to', 'notes', 'industry_type_id'],
  },
    // Revenue and every cost are now read from the module that owns them and
  // stored as at `analysis_date`. NULL means "not recorded anywhere" and is
  // deliberately distinct from 0 — see the page for why that distinction
  // matters. purchase_rate/selling_rate stay in the allowlist so existing
  // rows keep loading.
  {
    path: 'profitability',
    table: 'trading_profitability',
    codeField: 'deal_number',
    requiredFields: ['deal_number'],
    columns: ['deal_number', 'order_number', 'shipment_number', 'analysis_level', 'analysis_date', 'customer_name', 'supplier_name', 'product_name', 'quantity', 'currency', 'exchange_rate', 'period', 'revenue', 'revenue_source', 'purchase_cost', 'purchase_rate', 'selling_rate', 'freight', 'insurance', 'customs_duty', 'port_charges', 'handling_charges', 'logistics_cost', 'finance_charges', 'commission', 'other_costs', 'cost_sources', 'notes', 'industry_type_id'],
  },
   // The required/missing/expired document lists, customs status and
  // shipment status are detected from the linked records at review time and
  // stored as evidence of what was true then; the live position is
  // recomputed every time the record is opened.
  {
    path: 'compliance',
    table: 'trading_compliance',
    codeField: 'compliance_reference',
    requiredFields: ['compliance_reference', 'compliance_type'],
    columns: ['compliance_reference', 'compliance_type', 'deal_number', 'customer_name', 'supplier_name', 'product_name', 'shipment_number', 'transaction_number', 'customs_reference', 'country', 'hs_code', 'incoterm', 'required_documents', 'missing_documents', 'expired_documents', 'document_status', 'customs_status', 'shipment_status', 'risk_level', 'check_date', 'checked_by', 'responsible_person', 'required_action', 'due_date', 'approval_status', 'exception_reason', 'resolution', 'notes', 'industry_type_id'],
  },
   // An LC is now one instrument among several (open account, advance,
  // documentary collection, bank guarantee, credit terms), so the record is
  // keyed on finance_reference rather than lc_number. The lc_* columns stay
  // in the allowlist so existing LC rows keep loading and editing; the
  // migration backfills finance_reference from them.
  {
    path: 'trade-finance',
    table: 'trading_trade_finance',
    codeField: 'finance_reference',
    requiredFields: ['finance_reference', 'deal_number'],
    columns: ['finance_reference', 'instrument_type', 'deal_number', 'order_number', 'shipment_number', 'invoice_number', 'customer_name', 'supplier_name', 'currency', 'transaction_value', 'financing_amount', 'finance_charges', 'payment_terms', 'credit_days', 'advance_percent', 'advance_amount', 'lc_number', 'lc_type', 'lc_amount', 'issuing_bank', 'advising_bank', 'confirming_bank', 'applicant', 'beneficiary', 'tolerance_percent', 'presentation_period', 'port_place', 'document_requirements', 'bank_reference', 'issue_date', 'expiry_date', 'due_date', 'latest_shipment_date', 'payment_status', 'collected_amount', 'notes', 'industry_type_id'],
  },
];

export function findTradingResource(path: string): TradingResource | undefined {
  return TRADING_RESOURCES.find((r) => r.path === path);
}