-- 20260903000001_core_tenancy.sql
-- Extensions, organizations, roles, user_profiles, organization_memberships.
-- Matches: authorize.ts, user.repository.ts, user-management.repository.ts

create extension if not exists pgcrypto;

-- Generic updated_at trigger reused by every table below.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  status      text not null default 'active' check (status in ('active', 'inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_organizations_updated_at before update on organizations
  for each row execute function set_updated_at();

-- Roles are global (role codes are checked directly in requireRoles(...)).
create table roles (
  id    uuid primary key default gen_random_uuid(),
  code  text not null unique check (code in ('super_admin', 'admin', 'sales_manager', 'sales_representative')),
  name  text not null
);

insert into roles (code, name) values
  ('super_admin', 'Super Admin'),
  ('admin', 'Admin'),
  ('sales_manager', 'Sales Manager'),
  ('sales_representative', 'Sales Representative');

-- Mirrors auth.users 1:1 (id is the Supabase Auth user id).
create table user_profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_user_profiles_updated_at before update on user_profiles
  for each row execute function set_updated_at();

create table organization_memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id         uuid not null references user_profiles (id) on delete cascade,
  role_id         uuid not null references roles (id),
  status          text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index idx_org_memberships_org on organization_memberships (organization_id);
create index idx_org_memberships_user on organization_memberships (user_id);
create trigger trg_org_memberships_updated_at before update on organization_memberships
  for each row execute function set_updated_at();