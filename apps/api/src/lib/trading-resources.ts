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
    columns: ['deal_number', 'deal_name', 'customer_name', 'supplier_name', 'product_name', 'product_category', 'quantity', 'unit', 'currency', 'purchase_rate', 'selling_rate', 'deal_date', 'expected_delivery_date', 'sales_rep', 'payment_terms', 'delivery_terms', 'priority', 'industry_type_id', 'notes'],
  },
  {
    path: 'suppliers',
    table: 'trading_suppliers',
    codeField: 'supplier_id',
    requiredFields: ['supplier_id', 'supplier_name'],
    columns: ['supplier_id', 'supplier_name', 'company_name', 'contact_person', 'phone', 'email', 'address', 'city', 'country', 'tax_number', 'supplier_category', 'products_supplied', 'payment_terms', 'credit_limit', 'bank_details', 'notes'],
  },
  {
    path: 'purchase-enquiries',
    table: 'trading_purchase_enquiries',
    codeField: 'enquiry_number',
    requiredFields: ['enquiry_number', 'product_name'],
    columns: ['enquiry_number', 'enquiry_date', 'required_by_date', 'product_name', 'quantity', 'unit', 'specification', 'supplier_name', 'requested_rate', 'currency', 'delivery_location', 'delivery_terms', 'payment_terms', 'procurement_person', 'notes'],
  },
  {
    path: 'price-lists',
    table: 'trading_price_lists',
    codeField: 'product_name',
    requiredFields: ['product_name'],
    columns: ['product_name', 'product_code', 'supplier_name', 'customer_name', 'rate_type', 'purchase_rate', 'selling_rate', 'currency', 'unit', 'min_quantity', 'tax', 'discount', 'effective_from', 'effective_to', 'notes'],
  },
  {
    // Shared by both the Shipment Management and Logistics screens on the
    // frontend — same resource/table, not two systems (see LogisticsPage.tsx).
    path: 'shipments',
    table: 'trading_shipments',
    codeField: 'shipment_number',
    requiredFields: ['shipment_number'],
    columns: ['shipment_number', 'deal_number', 'customer_name', 'supplier_name', 'product_name', 'quantity', 'unit', 'batch_serial', 'shipment_date', 'pickup_date', 'expected_delivery_date', 'actual_delivery_date', 'origin', 'destination', 'transporter', 'tracking_number', 'vehicle_container_number', 'shipping_mode', 'driver_contact', 'distance', 'current_location', 'freight_cost', 'notes'],
  },
  {
    path: 'documents',
    table: 'trading_documents',
    codeField: 'document_id',
    requiredFields: ['document_id', 'document_number'],
    columns: ['document_id', 'document_number', 'document_type', 'deal_number', 'shipment_number', 'customer_name', 'supplier_name', 'product_name', 'reference_number', 'issue_date', 'expiry_date', 'issued_by', 'uploaded_by', 'file_reference', 'verification_status', 'notes'],
  },
  {
    path: 'currency-rates',
    table: 'trading_currency_rates',
    codeField: 'currency_code',
    requiredFields: ['currency_code'],
    columns: ['currency_code', 'currency_name', 'currency_symbol', 'country_region', 'decimal_places', 'is_base_currency', 'base_currency', 'target_currency', 'exchange_rate', 'effective_date', 'expiry_date', 'rate_source', 'notes'],
  },
  {
    path: 'import-export',
    table: 'trading_import_export',
    codeField: 'transaction_number',
    requiredFields: ['transaction_number', 'transaction_type'],
    columns: ['transaction_number', 'transaction_type', 'deal_number', 'customer_name', 'supplier_name', 'product_name', 'quantity', 'unit', 'country_of_origin', 'destination_country', 'port_of_loading', 'port_of_discharge', 'shipment_number', 'shipping_mode', 'invoice_number', 'currency', 'total_value', 'incoterm', 'expected_shipment_date', 'expected_arrival_date', 'actual_arrival_date', 'notes'],
  },
  {
    path: 'customs',
    table: 'trading_customs',
    codeField: 'customs_reference',
    requiredFields: ['customs_reference'],
    columns: ['customs_reference', 'shipment_number', 'transaction_number', 'transaction_type', 'customer_name', 'supplier_name', 'product_name', 'hs_code', 'quantity', 'country_of_origin', 'destination_country', 'port', 'declared_value', 'currency', 'customs_broker', 'declaration_date', 'customs_duty', 'other_charges', 'inspection_status', 'clearance_date', 'clearance_status', 'notes'],
  },
  {
    path: 'claims',
    table: 'trading_claims',
    codeField: 'claim_number',
    requiredFields: ['claim_number'],
    columns: ['claim_number', 'claim_date', 'claim_type', 'priority', 'severity', 'claim_source', 'customer_name', 'supplier_name', 'deal_number', 'purchase_enquiry', 'shipment_number', 'logistics_provider', 'product_name', 'product_code', 'batch_number', 'quantity', 'claimed_value', 'currency', 'invoice_number', 'order_number', 'document_reference', 'description', 'evidence_documents', 'reported_by', 'assigned_to', 'department', 'responsible_party', 'expected_resolution_date', 'actual_resolution_date', 'resolution', 'compensation_amount', 'credit_note_reference', 'replacement_reference', 'refund_amount', 'notes'],
  },
  {
    path: 'commissions',
    table: 'trading_commissions',
    codeField: 'commission_number',
    requiredFields: ['commission_number', 'sales_rep'],
    columns: ['commission_number', 'sales_rep', 'deal_number', 'customer_name', 'product_name', 'quantity', 'purchase_value', 'selling_value', 'commission_basis', 'commission_rate', 'currency', 'eligible_date', 'calculation_date', 'approval_date', 'payment_date', 'notes'],
  },
  {
    path: 'profitability',
    table: 'trading_profitability',
    codeField: 'deal_number',
    requiredFields: ['deal_number'],
    columns: ['deal_number', 'customer_name', 'supplier_name', 'product_name', 'quantity', 'currency', 'exchange_rate', 'period', 'purchase_rate', 'selling_rate', 'freight', 'insurance', 'customs_duty', 'port_charges', 'handling_charges', 'logistics_cost', 'commission', 'other_costs', 'notes'],
  },
  {
    path: 'compliance',
    table: 'trading_compliance',
    codeField: 'compliance_reference',
    requiredFields: ['compliance_reference', 'compliance_type'],
    columns: ['compliance_reference', 'compliance_type', 'deal_number', 'customer_name', 'supplier_name', 'product_name', 'shipment_number', 'transaction_number', 'country', 'hs_code', 'document_status', 'risk_level', 'check_date', 'checked_by', 'required_action', 'due_date', 'approval_status', 'exception_reason', 'resolution', 'notes'],
  },
  {
    path: 'trade-finance',
    table: 'trading_trade_finance',
    codeField: 'lc_number',
    requiredFields: ['lc_number'],
    columns: ['lc_number', 'lc_type', 'deal_number', 'customer_name', 'supplier_name', 'issuing_bank', 'advising_bank', 'confirming_bank', 'applicant', 'beneficiary', 'currency', 'lc_amount', 'tolerance_percent', 'issue_date', 'expiry_date', 'latest_shipment_date', 'presentation_period', 'port_place', 'payment_terms', 'document_requirements', 'notes'],
  },
];

export function findTradingResource(path: string): TradingResource | undefined {
  return TRADING_RESOURCES.find((r) => r.path === path);
}
