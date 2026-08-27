create type public.visit_status as enum ('in_progress', 'completed', 'cancelled');
create type public.collection_payment_method as enum ('cash', 'upi', 'bank_transfer', 'cheque', 'other');
create type public.follow_up_status as enum ('upcoming', 'due_today', 'overdue', 'completed', 'cancelled');
create type public.follow_up_priority as enum ('low', 'normal', 'high');

alter table public.clients add column opening_outstanding numeric(14,2) not null default 0 check (opening_outstanding >= 0);

create table public.visits (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
 client_id uuid not null references public.clients(id) on delete restrict, representative_id uuid not null references public.sales_representatives(id) on delete restrict,
 purpose text not null check (char_length(trim(purpose)) between 1 and 160), status public.visit_status not null default 'in_progress',
 check_in_at timestamptz not null default now(), check_out_at timestamptz, check_in_latitude numeric(9,6) not null check (check_in_latitude between -90 and 90), check_in_longitude numeric(9,6) not null check (check_in_longitude between -180 and 180), check_in_accuracy numeric(10,2) check (check_in_accuracy is null or check_in_accuracy >= 0),
 check_out_latitude numeric(9,6) check (check_out_latitude is null or check_out_latitude between -90 and 90), check_out_longitude numeric(9,6) check (check_out_longitude is null or check_out_longitude between -180 and 180), check_out_accuracy numeric(10,2) check (check_out_accuracy is null or check_out_accuracy >= 0), outcome text, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((check_out_at is null and status = 'in_progress') or (check_out_at is not null and status = 'completed')),
 check ((check_out_latitude is null and check_out_longitude is null) or (check_out_latitude is not null and check_out_longitude is not null))
);
create table public.collections (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
 client_id uuid not null references public.clients(id) on delete restrict, representative_id uuid not null references public.sales_representatives(id) on delete restrict, visit_id uuid references public.visits(id) on delete restrict,
 amount numeric(14,2) not null check (amount > 0), payment_method public.collection_payment_method not null, payment_reference text, receipt_url text, collected_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.follow_ups (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
 client_id uuid not null references public.clients(id) on delete restrict, representative_id uuid not null references public.sales_representatives(id) on delete restrict, visit_id uuid references public.visits(id) on delete restrict,
 follow_up_at timestamptz not null, purpose text not null, priority public.follow_up_priority not null default 'normal', notes text, status public.follow_up_status not null default 'upcoming', completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.client_activities (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict, client_id uuid not null references public.clients(id) on delete restrict, representative_id uuid not null references public.sales_representatives(id) on delete restrict,
 visit_id uuid references public.visits(id) on delete restrict, activity_type text not null, occurred_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index visits_rep_day_idx on public.visits(organization_id, representative_id, check_in_at desc); create index collections_client_idx on public.collections(organization_id, client_id, collected_at desc); create index follow_ups_rep_due_idx on public.follow_ups(organization_id, representative_id, follow_up_at); create index activities_client_idx on public.client_activities(organization_id, client_id, occurred_at desc);
create trigger visits_updated_at before update on public.visits for each row execute function public.set_updated_at(); create trigger follow_ups_updated_at before update on public.follow_ups for each row execute function public.set_updated_at();
create or replace function public.enforce_field_activity_scope() returns trigger language plpgsql security invoker set search_path=public as $$ begin
 if not exists (select 1 from sales_representatives r where r.id=new.representative_id and r.organization_id=new.organization_id) or not exists (select 1 from clients c where c.id=new.client_id and c.organization_id=new.organization_id) then raise exception 'Client and representative must belong to the same organization'; end if; return new; end; $$;
create trigger visits_scope before insert or update on public.visits for each row execute function public.enforce_field_activity_scope(); create trigger collections_scope before insert or update on public.collections for each row execute function public.enforce_field_activity_scope(); create trigger follow_ups_scope before insert or update on public.follow_ups for each row execute function public.enforce_field_activity_scope(); create trigger activities_scope before insert or update on public.client_activities for each row execute function public.enforce_field_activity_scope();
alter table public.visits enable row level security; alter table public.collections enable row level security; alter table public.follow_ups enable row level security; alter table public.client_activities enable row level security;
create policy "representatives read own visits" on public.visits for select to authenticated using (exists(select 1 from public.sales_representatives r where r.id=visits.representative_id and r.user_id=auth.uid()));
create policy "representatives read own collections" on public.collections for select to authenticated using (exists(select 1 from public.sales_representatives r where r.id=collections.representative_id and r.user_id=auth.uid()));
create policy "representatives read own follow ups" on public.follow_ups for select to authenticated using (exists(select 1 from public.sales_representatives r where r.id=follow_ups.representative_id and r.user_id=auth.uid()));
create policy "representatives read own activities" on public.client_activities for select to authenticated using (exists(select 1 from public.sales_representatives r where r.id=client_activities.representative_id and r.user_id=auth.uid()));
