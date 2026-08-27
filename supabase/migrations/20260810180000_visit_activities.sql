-- Structured meeting/activity notes linked to a GPS-verified field visit.
create table public.visit_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  visit_id uuid not null references public.field_visits(id) on delete cascade,
  representative_id uuid not null references public.sales_representatives(id) on delete restrict,
  person_met text,
  designation text,
  purpose text,
  requirements text,
  expected_quantity numeric(14,2) check (expected_quantity is null or expected_quantity >= 0),
  expected_value numeric(14,2) check (expected_value is null or expected_value >= 0),
  notes text,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index visit_activities_visit_idx on public.visit_activities(visit_id, created_at desc);
create index visit_activities_org_rep_idx on public.visit_activities(organization_id, representative_id, created_at desc);
create trigger visit_activities_set_updated_at before update on public.visit_activities for each row execute function public.set_updated_at();

create or replace function public.enforce_visit_activity_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (
    select 1 from public.field_visits v
    where v.id = new.visit_id and v.organization_id = new.organization_id
      and v.representative_id = new.representative_id
      and v.status in ('checked_in', 'in_progress')
  ) then
    raise exception 'Activity must belong to an active visit for the same representative';
  end if;
  return new;
end;
$$;

create trigger visit_activities_scope before insert or update on public.visit_activities
  for each row execute function public.enforce_visit_activity_scope();

alter table public.visit_activities enable row level security;
create policy "representatives read own visit activities" on public.visit_activities for select to authenticated
  using (exists (select 1 from public.sales_representatives r where r.id = visit_activities.representative_id and r.user_id = auth.uid()));
create policy "representatives create own visit activities" on public.visit_activities for insert to authenticated
  with check (exists (select 1 from public.sales_representatives r where r.id = visit_activities.representative_id and r.user_id = auth.uid()));
