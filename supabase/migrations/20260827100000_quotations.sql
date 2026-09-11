-- Quotations: priced proposal built from a Requirement's product line items.
-- Sits between Requirements and the existing sale_orders/sale_order_items
-- tables in the doc's lead flow (Requirement -> Quotation -> Sales order).
do $$ begin
  create type public.quotation_status as enum ('sent', 'accepted', 'rejected', 'expired', 'converted');
exception when duplicate_object then null; end $$;

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  quotation_number text not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  representative_id uuid not null references public.sales_representatives(id) on delete restrict,
  requirement_id uuid references public.requirements(id) on delete set null,
  status public.quotation_status not null default 'sent',
  valid_until date,
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  notes text,
  converted_order_id uuid references public.sale_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, quotation_number)
);

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(14,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create index if not exists quotations_org_status_idx on public.quotations(organization_id, status, created_at desc);
create index if not exists quotations_rep_status_idx on public.quotations(representative_id, status, created_at desc);
create index if not exists quotations_requirement_idx on public.quotations(requirement_id);
create index if not exists quotation_items_quotation_idx on public.quotation_items(quotation_id);

drop trigger if exists quotations_set_updated_at on public.quotations;
create trigger quotations_set_updated_at before update on public.quotations for each row execute function public.set_updated_at();

create or replace function public.enforce_quotation_scope() returns trigger language plpgsql security invoker set search_path = public as $$ begin
  if not exists (select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id) then
    raise exception 'Quotation client must belong to the same organization';
  end if;
  if not exists (select 1 from public.sales_representatives r where r.id = new.representative_id and r.organization_id = new.organization_id) then
    raise exception 'Quotation representative must belong to the same organization';
  end if;
  if new.requirement_id is not null and not exists (
    select 1 from public.requirements req
    where req.id = new.requirement_id and req.organization_id = new.organization_id and req.client_id = new.client_id
  ) then
    raise exception 'Quotation requirement must belong to the same organization and client';
  end if;
  return new;
end; $$;
drop trigger if exists quotations_scope on public.quotations;
create trigger quotations_scope before insert or update on public.quotations for each row execute function public.enforce_quotation_scope();

create or replace function public.enforce_quotation_item_product_scope() returns trigger language plpgsql security invoker set search_path = public as $$ begin
  if not exists (
    select 1 from public.products p
    join public.quotations q on q.id = new.quotation_id
    where p.id = new.product_id and p.organization_id = q.organization_id
  ) then
    raise exception 'Quotation item product must belong to the quotation organization';
  end if;
  return new;
end; $$;
drop trigger if exists quotation_items_scope on public.quotation_items;
create trigger quotation_items_scope before insert or update on public.quotation_items for each row execute function public.enforce_quotation_item_product_scope();

alter table public.quotations enable row level security;
drop policy if exists "representatives read own quotations" on public.quotations;
create policy "representatives read own quotations" on public.quotations for select to authenticated using (exists (select 1 from public.sales_representatives r where r.id = quotations.representative_id and r.user_id = auth.uid()));
drop policy if exists "representatives create own quotations" on public.quotations;
create policy "representatives create own quotations" on public.quotations for insert to authenticated with check (exists (select 1 from public.sales_representatives r where r.id = quotations.representative_id and r.user_id = auth.uid()));
drop policy if exists "representatives update own quotations" on public.quotations;
create policy "representatives update own quotations" on public.quotations for update to authenticated using (exists (select 1 from public.sales_representatives r where r.id = quotations.representative_id and r.user_id = auth.uid()));

alter table public.quotation_items enable row level security;
drop policy if exists "representatives read own quotation items" on public.quotation_items;
create policy "representatives read own quotation items" on public.quotation_items for select to authenticated using (exists (select 1 from public.quotations q join public.sales_representatives sr on sr.id = q.representative_id where q.id = quotation_items.quotation_id and sr.user_id = auth.uid()));