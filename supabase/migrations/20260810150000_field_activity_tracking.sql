-- Field activity foundation: browser/mobile check-ins and live location pings.
create type public.field_visit_status as enum ('checked_in', 'in_progress', 'checked_out');
create type public.field_visit_outcome as enum ('sale_made', 'follow_up_needed', 'no_interest', 'other');

create table public.field_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  representative_id uuid not null references public.sales_representatives(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  unlisted_client_name text,
  check_in_lat numeric(9,6) not null check (check_in_lat between -90 and 90),
  check_in_lng numeric(9,6) not null check (check_in_lng between -180 and 180),
  check_in_accuracy_meters numeric(10,2) check (check_in_accuracy_meters is null or check_in_accuracy_meters >= 0),
  check_in_time timestamptz not null default now(),
  check_out_lat numeric(9,6) check (check_out_lat is null or check_out_lat between -90 and 90),
  check_out_lng numeric(9,6) check (check_out_lng is null or check_out_lng between -180 and 180),
  check_out_accuracy_meters numeric(10,2) check (check_out_accuracy_meters is null or check_out_accuracy_meters >= 0),
  check_out_time timestamptz,
  status public.field_visit_status not null default 'checked_in',
  notes text,
  outcome public.field_visit_outcome,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_id is not null or char_length(trim(coalesce(unlisted_client_name, ''))) > 0),
  check ((check_out_time is null and check_out_lat is null and check_out_lng is null) or (check_out_time is not null and check_out_lat is not null and check_out_lng is not null)),
  check ((status in ('checked_in', 'in_progress') and check_out_time is null) or (status = 'checked_out' and check_out_time is not null))
);

create table public.field_activity_pings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  visit_id uuid not null references public.field_visits(id) on delete cascade,
  representative_id uuid not null references public.sales_representatives(id) on delete restrict,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  accuracy_meters numeric(10,2) check (accuracy_meters is null or accuracy_meters >= 0),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index field_visits_org_status_idx on public.field_visits(organization_id, status, check_in_time desc);
create index field_visits_rep_idx on public.field_visits(organization_id, representative_id, check_in_time desc);
create index field_activity_pings_visit_idx on public.field_activity_pings(visit_id, captured_at desc);

create trigger field_visits_set_updated_at before update on public.field_visits for each row execute function public.set_updated_at();

create or replace function public.enforce_field_visit_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.sales_representatives r where r.id = new.representative_id and r.organization_id = new.organization_id) then
    raise exception 'Representative must belong to the same organization';
  end if;
  if new.client_id is not null and not exists (select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id) then
    raise exception 'Client must belong to the same organization';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_field_ping_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.field_visits v where v.id = new.visit_id and v.organization_id = new.organization_id and v.representative_id = new.representative_id and v.status in ('checked_in', 'in_progress')) then
    raise exception 'Ping must belong to an active visit for the same representative';
  end if;
  return new;
end;
$$;

create trigger field_visits_scope before insert or update on public.field_visits for each row execute function public.enforce_field_visit_scope();
create trigger field_activity_pings_scope before insert on public.field_activity_pings for each row execute function public.enforce_field_ping_scope();

alter table public.field_visits enable row level security;
alter table public.field_activity_pings enable row level security;
create policy "representatives read own field visits" on public.field_visits for select to authenticated using (exists (select 1 from public.sales_representatives r where r.id = field_visits.representative_id and r.user_id = auth.uid()));
create policy "representatives read own field pings" on public.field_activity_pings for select to authenticated using (exists (select 1 from public.sales_representatives r where r.id = field_activity_pings.representative_id and r.user_id = auth.uid()));
