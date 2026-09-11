-- 20260903000002_master_data.sql
-- Industry types, sales representatives, clients, contacts, assignments, products.
-- Matches: master-data.repository.ts, industry-types.repository.ts, products.repository.ts

create table industry_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  code            text not null,
  name            text not null,
  description     text,
  status          text not null default 'active' check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);
create index idx_industry_types_org on industry_types (organization_id);
create trigger trg_industry_types_updated_at before update on industry_types
  for each row execute function set_updated_at();

create table sales_representatives (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id         uuid not null references user_profiles (id) on delete cascade,
  employee_code   text not null,
  phone           text,
  email           text,
  designation     text,
  joining_date    date,
  status          text not null default 'active' check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, employee_code),
  unique (organization_id, user_id)
);
create index idx_sales_reps_org on sales_representatives (organization_id);
create trigger trg_sales_reps_updated_at before update on sales_representatives
  for each row execute function set_updated_at();

-- Which industries a representative is allowed to see leads for (leads.repository.ts).
create table sales_representative_industry_types (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references organizations (id) on delete cascade,
  sales_representative_id   uuid not null references sales_representatives (id) on delete cascade,
  industry_type_id          uuid not null references industry_types (id) on delete cascade,
  created_at                timestamptz not null default now(),
  unique (organization_id, sales_representative_id, industry_type_id)
);
create index idx_rep_industry_types_rep on sales_representative_industry_types (sales_representative_id);

create table clients (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  client_code        text not null,
  client_name        text not null,
  client_type        text not null,
  industry           text,
  industry_type_id   uuid references industry_types (id),
  gstin              text,
  pan                text,
  outlet_type        text check (outlet_type in ('wholesaler', 'retailer', 'distributor', 'super_stockist', 'institution', 'manufacturer', 'other')),
  credit_limit       numeric(14, 2),
  credit_days        integer,
  industry_details   jsonb,
  phone              text,
  email              text,
  website            text,
  address            text,
  city               text,
  state              text,
  country            text,
  postal_code        text,
  latitude           double precision,
  longitude          double precision,
  gps_radius_meters  integer default 150,
  priority           text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  status             text not null default 'active' check (status in ('active', 'inactive')),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, client_code)
);
create index idx_clients_org on clients (organization_id);
create index idx_clients_industry_type on clients (industry_type_id);
create trigger trg_clients_updated_at before update on clients
  for each row execute function set_updated_at();

create table client_contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  client_id        uuid not null references clients (id) on delete cascade,
  name             text not null,
  designation      text,
  department       text,
  phone            text,
  alternate_phone  text,
  email            text,
  is_primary       boolean not null default false,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_client_contacts_client on client_contacts (client_id);
create trigger trg_client_contacts_updated_at before update on client_contacts
  for each row execute function set_updated_at();

create table sales_representative_client_assignments (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references organizations (id) on delete cascade,
  sales_representative_id   uuid not null references sales_representatives (id) on delete cascade,
  client_id                 uuid not null references clients (id) on delete cascade,
  status                    text not null default 'active' check (status in ('active', 'inactive')),
  notes                     text,
  assigned_at               timestamptz not null default now(),
  unique (organization_id, sales_representative_id, client_id)
);
create index idx_rep_client_assignments_rep on sales_representative_client_assignments (sales_representative_id);
create index idx_rep_client_assignments_client on sales_representative_client_assignments (client_id);

create table products (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  product_code      text not null,
  product_name      text not null,
  category          text,
  description       text,
  selling_price     numeric(14, 2) not null,
  cost_price        numeric(14, 2),
  stock_quantity    numeric(14, 2) default 0,
  status            text not null default 'active' check (status in ('active', 'inactive')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, product_code)
);
create index idx_products_org on products (organization_id);
create trigger trg_products_updated_at before update on products
  for each row execute function set_updated_at();

-- Many-to-many product <-> industry tagging (industry-types.repository.ts).
create table product_industry_types (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  product_id        uuid not null references products (id) on delete cascade,
  industry_type_id  uuid not null references industry_types (id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (organization_id, product_id, industry_type_id)
);
create index idx_product_industry_types_product on product_industry_types (product_id);
create index idx_product_industry_types_industry on product_industry_types (industry_type_id);