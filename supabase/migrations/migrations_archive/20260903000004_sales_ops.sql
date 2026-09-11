-- 20260903000004_sales_ops.sql
-- Orders, collections, follow-ups, telephony calls.
-- Matches: orders.repository.ts, collections.repository.ts, follow-ups.repository.ts, telephony.repository.ts, dashboard.controller.ts

create table sale_orders (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  order_number       text not null unique,
  visit_id           uuid references field_visits (id),
  client_id          uuid not null references clients (id),
  representative_id  uuid not null references sales_representatives (id),
  discount_amount    numeric(14, 2) not null default 0,
  tax_amount         numeric(14, 2) not null default 0,
  total_amount       numeric(14, 2) not null,
  status             text not null default 'confirmed' check (status in ('draft', 'confirmed', 'fulfilled', 'cancelled')),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_sale_orders_org on sale_orders (organization_id);
create index idx_sale_orders_client on sale_orders (client_id);
create index idx_sale_orders_rep on sale_orders (representative_id);
create index idx_sale_orders_created_at on sale_orders (created_at desc);
create trigger trg_sale_orders_updated_at before update on sale_orders
  for each row execute function set_updated_at();

create table sale_order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references sale_orders (id) on delete cascade,
  product_id        uuid not null references products (id),
  quantity          numeric(14, 2) not null,
  unit_price        numeric(14, 2) not null,
  discount_amount   numeric(14, 2) not null default 0,
  subtotal          numeric(14, 2) not null
);
create index idx_sale_order_items_order on sale_order_items (order_id);

create table sales_collections (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  client_id          uuid not null references clients (id),
  representative_id  uuid not null references sales_representatives (id),
  visit_id           uuid references field_visits (id),
  sale_order_id      uuid references sale_orders (id),
  amount             numeric(14, 2) not null check (amount > 0),
  mode               text not null check (mode in ('cash', 'upi', 'bank_transfer', 'cheque', 'other')),
  reference_no       text,
  notes              text,
  collected_at       timestamptz not null default now()
);
create index idx_collections_org on sales_collections (organization_id);
create index idx_collections_order on sales_collections (sale_order_id);
create index idx_collections_collected_at on sales_collections (collected_at desc);

create table follow_ups (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  representative_id  uuid not null references sales_representatives (id),
  client_id          uuid not null references clients (id),
  visit_id           uuid references field_visits (id),
  title              text not null,
  due_at             timestamptz not null,
  priority           text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  status             text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  notes              text,
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);
create index idx_follow_ups_org on follow_ups (organization_id);
create index idx_follow_ups_rep on follow_ups (representative_id);
create index idx_follow_ups_due_at on follow_ups (due_at);

create table telephony_calls (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  client_id          uuid references clients (id),
  representative_id  uuid references sales_representatives (id),
  direction          text not null check (direction in ('inbound', 'outbound')),
  phone_number       text not null,
  status             text not null check (status in ('completed', 'missed', 'no_answer', 'busy', 'failed')),
  started_at         timestamptz,
  ended_at           timestamptz,
  duration_seconds   integer,
  notes              text,
  created_at         timestamptz not null default now()
);
create index idx_calls_org on telephony_calls (organization_id);
create index idx_calls_created_at on telephony_calls (created_at desc);