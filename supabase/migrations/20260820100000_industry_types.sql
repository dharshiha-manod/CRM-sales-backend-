-- Industry Type master data: organization-scoped industry catalog, plus
-- product tagging (many-to-many) and client tagging (single industry per client).
create type public.industry_type_status as enum ('active', 'inactive');

create table public.industry_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null,
  name text not null,
  description text,
  status public.industry_type_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  check (char_length(trim(code)) between 1 and 40),
  check (char_length(trim(name)) between 1 and 120)
);

create index industry_types_organization_status_idx on public.industry_types(organization_id, status, name);

create trigger industry_types_set_updated_at before update on public.industry_types for each row execute function public.set_updated_at();

alter table public.industry_types enable row level security;
create policy "members can read organization industry types" on public.industry_types for select to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = industry_types.organization_id and m.user_id = auth.uid() and m.status = 'active'));

-- Product <-> Industry Type: many-to-many (a product can serve multiple industries).
create table public.product_industry_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete cascade,
  industry_type_id uuid not null references public.industry_types(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (product_id, industry_type_id)
);

create index product_industry_types_org_idx on public.product_industry_types(organization_id, industry_type_id);
create index product_industry_types_product_idx on public.product_industry_types(product_id);

alter table public.product_industry_types enable row level security;
create policy "members can read organization product industry tags" on public.product_industry_types for select to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = product_industry_types.organization_id and m.user_id = auth.uid() and m.status = 'active'));

-- Reject cross-organization tag references, matching the Phase 2 enforcement pattern.
create or replace function public.enforce_product_industry_type_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from products p where p.id = new.product_id and p.organization_id = new.organization_id) then
    raise exception 'Product must belong to the same organization';
  end if;
  if not exists (select 1 from industry_types i where i.id = new.industry_type_id and i.organization_id = new.organization_id) then
    raise exception 'Industry type must belong to the same organization';
  end if;
  return new;
end;
$$;
create trigger product_industry_types_enforce_organization before insert or update on public.product_industry_types for each row execute function public.enforce_product_industry_type_scope();

-- Client <-> Industry Type: a client belongs to exactly one industry (nullable during transition).
alter table public.clients add column industry_type_id uuid references public.industry_types(id) on delete restrict;
create index clients_organization_industry_type_idx on public.clients(organization_id, industry_type_id);

create or replace function public.enforce_client_industry_type_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.industry_type_id is not null and not exists (
    select 1 from industry_types i where i.id = new.industry_type_id and i.organization_id = new.organization_id
  ) then
    raise exception 'Industry type must belong to the same organization';
  end if;
  return new;
end;
$$;
create trigger clients_enforce_industry_type_organization before insert or update on public.clients for each row execute function public.enforce_client_industry_type_scope();

-- Backfill: for any client with legacy free-text `industry`, create/match an
-- industry_type row per organization and link it. Safe to run even if no
-- clients have the legacy column populated.
insert into public.industry_types (organization_id, code, name)
select distinct
  c.organization_id,
  upper(regexp_replace(trim(c.industry), '[^a-zA-Z0-9]+', '_', 'g')),
  trim(c.industry)
from public.clients c
where c.industry is not null and trim(c.industry) <> ''
on conflict (organization_id, code) do nothing;

update public.clients c
set industry_type_id = i.id
from public.industry_types i
where c.industry is not null
  and trim(c.industry) <> ''
  and i.organization_id = c.organization_id
  and i.code = upper(regexp_replace(trim(c.industry), '[^a-zA-Z0-9]+', '_', 'g'));

-- Legacy free-text column kept for one release cycle for rollback safety.
-- Drop it in a later migration once the admin UI is confirmed working end-to-end:
--   alter table public.clients drop column industry;
comment on column public.clients.industry is 'Deprecated: superseded by industry_type_id. Safe to drop after UI cutover.';