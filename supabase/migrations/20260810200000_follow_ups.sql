do $$ begin
  create type public.follow_up_status as enum ('pending', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.follow_up_priority as enum ('low', 'normal', 'high', 'critical');
exception when duplicate_object then null; end $$;

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  representative_id uuid not null references public.sales_representatives(id) on delete restrict,
  visit_id uuid references public.field_visits(id) on delete set null,
  sale_order_id uuid references public.sale_orders(id) on delete set null,
  title text not null,
  due_at timestamptz not null,
  priority public.follow_up_priority not null default 'normal',
  status public.follow_up_status not null default 'pending',
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists follow_ups_org_due_idx on public.follow_ups(organization_id, status, due_at);
create index if not exists follow_ups_rep_due_idx on public.follow_ups(representative_id, status, due_at);
drop trigger if exists follow_ups_set_updated_at on public.follow_ups;
create trigger follow_ups_set_updated_at before update on public.follow_ups for each row execute function public.set_updated_at();
create or replace function public.enforce_follow_up_scope() returns trigger language plpgsql security invoker set search_path = public as $$ begin
  if not exists (select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id) then raise exception 'Follow-up client must belong to the same organization'; end if;
  if not exists (select 1 from public.sales_representatives r where r.id = new.representative_id and r.organization_id = new.organization_id) then raise exception 'Follow-up representative must belong to the same organization'; end if;
  if new.visit_id is not null and not exists (select 1 from public.field_visits v where v.id = new.visit_id and v.organization_id = new.organization_id and v.client_id = new.client_id and v.representative_id = new.representative_id) then raise exception 'Follow-up visit must match the client and representative'; end if;
  return new;
end; $$;
drop trigger if exists follow_ups_scope on public.follow_ups;
create trigger follow_ups_scope before insert or update on public.follow_ups for each row execute function public.enforce_follow_up_scope();
alter table public.follow_ups enable row level security;
drop policy if exists "representatives read own follow ups" on public.follow_ups;
create policy "representatives read own follow ups" on public.follow_ups for select to authenticated using (exists (select 1 from public.sales_representatives r where r.id = follow_ups.representative_id and r.user_id = auth.uid()));
drop policy if exists "representatives create own follow ups" on public.follow_ups;
create policy "representatives create own follow ups" on public.follow_ups for insert to authenticated with check (exists (select 1 from public.sales_representatives r where r.id = follow_ups.representative_id and r.user_id = auth.uid()));
