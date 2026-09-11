-- Requirements: what a client needs, captured by a rep during (or after) a
-- field visit. First stage of the doc's lead flow that feeds Quotations.
do $$ begin
  create type public.requirement_status as enum ('open', 'quoted', 'converted', 'dropped');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.requirement_urgency as enum ('low', 'normal', 'high');
exception when duplicate_object then null; end $$;

create table if not exists public.requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  representative_id uuid not null references public.sales_representatives(id) on delete restrict,
  visit_id uuid references public.field_visits(id) on delete set null,
  title text not null,
  description text,
  urgency public.requirement_urgency not null default 'normal',
  status public.requirement_status not null default 'open',
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(title)) between 2 and 300)
);

create table if not exists public.requirement_items (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  product_id uuid references public.products(id) on delete restrict,
  free_text_item text,
  quantity numeric(14,2) not null default 1 check (quantity > 0),
  notes text,
  created_at timestamptz not null default now(),
  check (product_id is not null or char_length(trim(coalesce(free_text_item, ''))) > 0)
);

create index if not exists requirements_org_status_idx on public.requirements(organization_id, status, created_at desc);
create index if not exists requirements_rep_status_idx on public.requirements(representative_id, status, created_at desc);
create index if not exists requirements_client_idx on public.requirements(client_id, created_at desc);
create index if not exists requirement_items_requirement_idx on public.requirement_items(requirement_id);

drop trigger if exists requirements_set_updated_at on public.requirements;
create trigger requirements_set_updated_at before update on public.requirements for each row execute function public.set_updated_at();

create or replace function public.enforce_requirement_scope() returns trigger language plpgsql security invoker set search_path = public as $$ begin
  if not exists (select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id) then
    raise exception 'Requirement client must belong to the same organization';
  end if;
  if not exists (select 1 from public.sales_representatives r where r.id = new.representative_id and r.organization_id = new.organization_id) then
    raise exception 'Requirement representative must belong to the same organization';
  end if;
  if new.visit_id is not null and not exists (
    select 1 from public.field_visits v
    where v.id = new.visit_id and v.organization_id = new.organization_id
      and v.client_id = new.client_id and v.representative_id = new.representative_id
  ) then
    raise exception 'Requirement visit must match the client and representative';
  end if;
  return new;
end; $$;
drop trigger if exists requirements_scope on public.requirements;
create trigger requirements_scope before insert or update on public.requirements for each row execute function public.enforce_requirement_scope();

create or replace function public.enforce_requirement_item_product_scope() returns trigger language plpgsql security invoker set search_path = public as $$ begin
  if new.product_id is not null and not exists (
    select 1 from public.products p
    join public.requirements r on r.id = new.requirement_id
    where p.id = new.product_id and p.organization_id = r.organization_id
  ) then
    raise exception 'Requirement item product must belong to the requirement organization';
  end if;
  return new;
end; $$;
drop trigger if exists requirement_items_scope on public.requirement_items;
create trigger requirement_items_scope before insert or update on public.requirement_items for each row execute function public.enforce_requirement_item_product_scope();

alter table public.requirements enable row level security;
drop policy if exists "representatives read own requirements" on public.requirements;
create policy "representatives read own requirements" on public.requirements for select to authenticated using (exists (select 1 from public.sales_representatives r where r.id = requirements.representative_id and r.user_id = auth.uid()));
drop policy if exists "representatives create own requirements" on public.requirements;
create policy "representatives create own requirements" on public.requirements for insert to authenticated with check (exists (select 1 from public.sales_representatives r where r.id = requirements.representative_id and r.user_id = auth.uid()));
drop policy if exists "representatives update own requirements" on public.requirements;
create policy "representatives update own requirements" on public.requirements for update to authenticated using (exists (select 1 from public.sales_representatives r where r.id = requirements.representative_id and r.user_id = auth.uid()));

alter table public.requirement_items enable row level security;
drop policy if exists "representatives read own requirement items" on public.requirement_items;
create policy "representatives read own requirement items" on public.requirement_items for select to authenticated using (exists (select 1 from public.requirements r join public.sales_representatives sr on sr.id = r.representative_id where r.id = requirement_items.requirement_id and sr.user_id = auth.uid()));
drop policy if exists "representatives write own requirement items" on public.requirement_items;
create policy "representatives write own requirement items" on public.requirement_items for insert to authenticated with check (exists (select 1 from public.requirements r join public.sales_representatives sr on sr.id = r.representative_id where r.id = requirement_items.requirement_id and sr.user_id = auth.uid()));