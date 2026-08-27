-- Products, sales orders, order lines and payment collections.
create type public.product_status as enum ('active', 'inactive');
create type public.sales_order_status as enum ('draft', 'confirmed', 'completed', 'cancelled');
create type public.sales_payment_status as enum ('pending', 'partial', 'paid', 'overdue');
create type public.sales_collection_mode as enum ('cash', 'upi', 'bank_transfer', 'cheque', 'other');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  product_code text not null, product_name text not null, category text, description text,
  selling_price numeric(14,2) not null check (selling_price >= 0),
  cost_price numeric(14,2) check (cost_price is null or cost_price >= 0),
  stock_quantity numeric(14,2) check (stock_quantity is null or stock_quantity >= 0),
  status public.product_status not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, product_code)
);

create table public.sale_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  order_number text not null, client_id uuid not null references public.clients(id) on delete restrict,
  representative_id uuid not null references public.sales_representatives(id) on delete restrict,
  visit_id uuid references public.field_visits(id) on delete restrict,
  order_date timestamptz not null default now(), status public.sales_order_status not null default 'confirmed',
  payment_status public.sales_payment_status not null default 'pending', discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0), total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, order_number)
);

create table public.sale_order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.sale_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict, quantity numeric(14,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0), discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0), created_at timestamptz not null default now()
);

create table public.sales_collections (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict, representative_id uuid not null references public.sales_representatives(id) on delete restrict,
  visit_id uuid references public.field_visits(id) on delete restrict, sale_order_id uuid references public.sale_orders(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0), mode public.sales_collection_mode not null, reference_no text, collected_at timestamptz not null default now(), notes text, created_at timestamptz not null default now()
);

create index products_org_status_idx on public.products(organization_id, status, product_name);
create index sale_orders_org_date_idx on public.sale_orders(organization_id, order_date desc);
create index sale_orders_rep_idx on public.sale_orders(organization_id, representative_id, order_date desc);
create index sales_collections_org_date_idx on public.sales_collections(organization_id, collected_at desc);
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger sale_orders_set_updated_at before update on public.sale_orders for each row execute function public.set_updated_at();
alter table public.products enable row level security; alter table public.sale_orders enable row level security; alter table public.sale_order_items enable row level security; alter table public.sales_collections enable row level security;
create policy "representatives read organization products" on public.products for select to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = products.organization_id and m.user_id = auth.uid() and m.status = 'active'));
create policy "representatives read own sales orders" on public.sale_orders for select to authenticated using (exists (select 1 from public.sales_representatives r where r.id = sale_orders.representative_id and r.user_id = auth.uid()));
create policy "representatives read own collections" on public.sales_collections for select to authenticated using (exists (select 1 from public.sales_representatives r where r.id = sales_collections.representative_id and r.user_id = auth.uid()));
