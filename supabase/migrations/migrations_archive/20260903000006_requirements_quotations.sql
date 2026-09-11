-- 20260903000006_requirements_quotations.sql
-- Requirement capture -> quotation -> order conversion pipeline.
-- Matches: requirements.repository.ts, quotations.repository.ts

create table requirements (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  representative_id  uuid not null references sales_representatives (id),
  client_id          uuid not null references clients (id),
  visit_id           uuid references field_visits (id),
  title              text not null,
  description        text,
  urgency            text not null default 'normal' check (urgency in ('low', 'normal', 'high')),
  target_date        date,
  status             text not null default 'open' check (status in ('open', 'quoted', 'converted', 'dropped')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_requirements_org on requirements (organization_id);
create index idx_requirements_rep on requirements (representative_id);
create index idx_requirements_client on requirements (client_id);
create index idx_requirements_status on requirements (status);
create trigger trg_requirements_updated_at before update on requirements
  for each row execute function set_updated_at();

create table requirement_items (
  id                 uuid primary key default gen_random_uuid(),
  requirement_id     uuid not null references requirements (id) on delete cascade,
  product_id         uuid references products (id),
  free_text_item     text,
  quantity           numeric(14, 2) not null default 1,
  notes              text,
  check (product_id is not null or free_text_item is not null)
);
create index idx_requirement_items_requirement on requirement_items (requirement_id);

create table quotations (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id) on delete cascade,
  quotation_number      text not null unique,
  client_id             uuid not null references clients (id),
  representative_id     uuid not null references sales_representatives (id),
  requirement_id        uuid references requirements (id),
  valid_until           date,
  discount_amount       numeric(14, 2) not null default 0,
  tax_amount            numeric(14, 2) not null default 0,
  total_amount          numeric(14, 2) not null,
  status                text not null default 'sent' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted')),
  notes                 text,
  converted_order_id    uuid references sale_orders (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index idx_quotations_org on quotations (organization_id);
create index idx_quotations_rep on quotations (representative_id);
create index idx_quotations_client on quotations (client_id);
create index idx_quotations_requirement on quotations (requirement_id);
create trigger trg_quotations_updated_at before update on quotations
  for each row execute function set_updated_at();

create table quotation_items (
  id                 uuid primary key default gen_random_uuid(),
  quotation_id       uuid not null references quotations (id) on delete cascade,
  product_id         uuid not null references products (id),
  quantity           numeric(14, 2) not null,
  unit_price         numeric(14, 2) not null,
  discount_percent   numeric(5, 2) not null default 0,
  discount_amount    numeric(14, 2) not null default 0,
  subtotal           numeric(14, 2) not null
);
create index idx_quotation_items_quotation on quotation_items (quotation_id);