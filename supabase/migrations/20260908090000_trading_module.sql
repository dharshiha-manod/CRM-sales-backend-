-- Trading module: real tables backing every /trading/* API resource used by
-- the admin app's Trading pages (TradingDealPage, TradingSupplierVendorPage,
-- TradingPurchaseEnquiryPage, TradingPriceRateListPage, TradingShipmentPage /
-- LogisticsPage, TradeDocumentsPage, CurrencyManagementPage, ImportExportPage,
-- CustomsClearancePage, ClaimsDisputesPage, CommissionManagementPage,
-- TradeProfitabilityPage, TradeCompliancePage, TradeFinanceLCPage).
--
-- Every table shares the same base shape (id, organization_id, status,
-- created_at, updated_at) plus the columns listed for that resource in
-- apps/api/src/lib/trading-resources.ts — keep the two in sync if you add
-- a field on either side. Computed/display-only fields (margin %, gross
-- profit, validity badges, etc.) are calculated in the frontend and are
-- never stored.
--
-- Uses gen_random_uuid() (pgcrypto) — already enabled if other tables in
-- this project use uuid ids; run `create extension if not exists pgcrypto;`
-- first if your project doesn't have it yet.

create table if not exists public.trading_deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  deal_number text not null,
  deal_name text not null,
  customer_name text not null,
  supplier_name text,
  product_name text,
  product_category text,
  quantity numeric,
  unit text,
  currency text,
  purchase_rate numeric,
  selling_rate numeric,
  deal_date date,
  expected_delivery_date date,
  sales_rep text,
  payment_terms text,
  delivery_terms text,
  priority text,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, deal_number)
);

create table if not exists public.trading_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  supplier_id text not null,
  supplier_name text not null,
  company_name text,
  contact_person text,
  phone text,
  email text,
  address text,
  city text,
  country text,
  tax_number text,
  supplier_category text,
  products_supplied text,
  payment_terms text,
  credit_limit numeric,
  bank_details text,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, supplier_id)
);

create table if not exists public.trading_purchase_enquiries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  enquiry_number text not null,
  enquiry_date date,
  required_by_date date,
  product_name text not null,
  quantity numeric,
  unit text,
  specification text,
  supplier_name text,
  requested_rate numeric,
  currency text,
  delivery_location text,
  delivery_terms text,
  payment_terms text,
  procurement_person text,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, enquiry_number)
);

create table if not exists public.trading_price_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  product_name text not null,
  product_code text,
  supplier_name text,
  customer_name text,
  rate_type text,
  purchase_rate numeric,
  selling_rate numeric,
  currency text,
  unit text,
  min_quantity numeric,
  tax numeric,
  discount numeric,
  effective_from date,
  effective_to date,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Shared by Shipment Management and Logistics screens (same table, two views).
create table if not exists public.trading_shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  shipment_number text not null,
  deal_number text,
  customer_name text,
  supplier_name text,
  product_name text,
  quantity numeric,
  unit text,
  batch_serial text,
  shipment_date date,
  pickup_date date,
  expected_delivery_date date,
  actual_delivery_date date,
  origin text,
  destination text,
  transporter text,
  tracking_number text,
  vehicle_container_number text,
  shipping_mode text,
  driver_contact text,
  distance text,
  current_location text,
  freight_cost numeric,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, shipment_number)
);

create table if not exists public.trading_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  document_id text not null,
  document_number text not null,
  document_type text,
  deal_number text,
  shipment_number text,
  customer_name text,
  supplier_name text,
  product_name text,
  reference_number text,
  issue_date date,
  expiry_date date,
  issued_by text,
  uploaded_by text,
  file_reference text,
  verification_status text,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, document_id)
);

create table if not exists public.trading_currency_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  currency_code text not null,
  currency_name text,
  currency_symbol text,
  country_region text,
  decimal_places numeric,
  is_base_currency text,
  base_currency text,
  target_currency text,
  exchange_rate numeric,
  effective_date date,
  expiry_date date,
  rate_source text,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trading_import_export (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  transaction_number text not null,
  transaction_type text not null,
  deal_number text,
  customer_name text,
  supplier_name text,
  product_name text,
  quantity numeric,
  unit text,
  country_of_origin text,
  destination_country text,
  port_of_loading text,
  port_of_discharge text,
  shipment_number text,
  shipping_mode text,
  invoice_number text,
  currency text,
  total_value numeric,
  incoterm text,
  expected_shipment_date date,
  expected_arrival_date date,
  actual_arrival_date date,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, transaction_number)
);

create table if not exists public.trading_customs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  customs_reference text not null,
  shipment_number text,
  transaction_number text,
  transaction_type text,
  customer_name text,
  supplier_name text,
  product_name text,
  hs_code text,
  quantity numeric,
  country_of_origin text,
  destination_country text,
  port text,
  declared_value numeric,
  currency text,
  customs_broker text,
  declaration_date date,
  customs_duty numeric,
  other_charges numeric,
  inspection_status text,
  clearance_date date,
  clearance_status text,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, customs_reference)
);

create table if not exists public.trading_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  claim_number text not null,
  claim_date date,
  claim_type text,
  priority text,
  severity text,
  claim_source text,
  customer_name text,
  supplier_name text,
  deal_number text,
  purchase_enquiry text,
  shipment_number text,
  logistics_provider text,
  product_name text,
  product_code text,
  batch_number text,
  quantity numeric,
  claimed_value numeric,
  currency text,
  invoice_number text,
  order_number text,
  document_reference text,
  description text,
  evidence_documents text,
  reported_by text,
  assigned_to text,
  department text,
  responsible_party text,
  expected_resolution_date date,
  actual_resolution_date date,
  resolution text,
  compensation_amount numeric,
  credit_note_reference text,
  replacement_reference text,
  refund_amount numeric,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, claim_number)
);

create table if not exists public.trading_commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  commission_number text not null,
  sales_rep text not null,
  deal_number text,
  customer_name text,
  product_name text,
  quantity numeric,
  purchase_value numeric,
  selling_value numeric,
  commission_basis text,
  commission_rate numeric,
  currency text,
  eligible_date date,
  calculation_date date,
  approval_date date,
  payment_date date,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, commission_number)
);

create table if not exists public.trading_profitability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  deal_number text not null,
  customer_name text,
  supplier_name text,
  product_name text,
  quantity numeric,
  currency text,
  exchange_rate numeric,
  period text,
  purchase_rate numeric,
  selling_rate numeric,
  freight numeric,
  insurance numeric,
  customs_duty numeric,
  port_charges numeric,
  handling_charges numeric,
  logistics_cost numeric,
  commission numeric,
  other_costs numeric,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trading_compliance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  compliance_reference text not null,
  compliance_type text not null,
  deal_number text,
  customer_name text,
  supplier_name text,
  product_name text,
  shipment_number text,
  transaction_number text,
  country text,
  hs_code text,
  document_status text,
  risk_level text,
  check_date date,
  checked_by text,
  required_action text,
  due_date date,
  approval_status text,
  exception_reason text,
  resolution text,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, compliance_reference)
);

create table if not exists public.trading_trade_finance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  lc_number text not null,
  lc_type text,
  deal_number text,
  customer_name text,
  supplier_name text,
  issuing_bank text,
  advising_bank text,
  confirming_bank text,
  applicant text,
  beneficiary text,
  currency text,
  lc_amount numeric,
  tolerance_percent numeric,
  issue_date date,
  expiry_date date,
  latest_shipment_date date,
  presentation_period text,
  port_place text,
  payment_terms text,
  document_requirements text,
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, lc_number)
);

-- One index per table on organization_id — every query is scoped by org.
create index if not exists trading_deals_org_idx on public.trading_deals (organization_id);
create index if not exists trading_suppliers_org_idx on public.trading_suppliers (organization_id);
create index if not exists trading_purchase_enquiries_org_idx on public.trading_purchase_enquiries (organization_id);
create index if not exists trading_price_lists_org_idx on public.trading_price_lists (organization_id);
create index if not exists trading_shipments_org_idx on public.trading_shipments (organization_id);
create index if not exists trading_documents_org_idx on public.trading_documents (organization_id);
create index if not exists trading_currency_rates_org_idx on public.trading_currency_rates (organization_id);
create index if not exists trading_import_export_org_idx on public.trading_import_export (organization_id);
create index if not exists trading_customs_org_idx on public.trading_customs (organization_id);
create index if not exists trading_claims_org_idx on public.trading_claims (organization_id);
create index if not exists trading_commissions_org_idx on public.trading_commissions (organization_id);
create index if not exists trading_profitability_org_idx on public.trading_profitability (organization_id);
create index if not exists trading_compliance_org_idx on public.trading_compliance (organization_id);
create index if not exists trading_trade_finance_org_idx on public.trading_trade_finance (organization_id);

-- RLS: the API talks to Supabase with the service-role key (bypasses RLS)
-- and does its own org/role checks in Express (see requireRoles). Enable
-- RLS with no public policies so these tables are still locked down if a
-- client ever queries them directly with an anon/user key.
alter table public.trading_deals enable row level security;
alter table public.trading_suppliers enable row level security;
alter table public.trading_purchase_enquiries enable row level security;
alter table public.trading_price_lists enable row level security;
alter table public.trading_shipments enable row level security;
alter table public.trading_documents enable row level security;
alter table public.trading_currency_rates enable row level security;
alter table public.trading_import_export enable row level security;
alter table public.trading_customs enable row level security;
alter table public.trading_claims enable row level security;
alter table public.trading_commissions enable row level security;
alter table public.trading_profitability enable row level security;
alter table public.trading_compliance enable row level security;
alter table public.trading_trade_finance enable row level security;
