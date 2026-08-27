-- Provider-neutral call history. This does not connect to a telecom provider by itself.
do $$ begin
  create type public.telephony_call_direction as enum ('outbound', 'inbound');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.telephony_call_status as enum ('queued', 'ringing', 'answered', 'completed', 'failed', 'missed');
exception when duplicate_object then null; end $$;

create table if not exists public.telephony_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid references public.clients(id) on delete set null,
  representative_id uuid references public.sales_representatives(id) on delete set null,
  visit_id uuid references public.field_visits(id) on delete set null,
  provider text not null,
  provider_call_id text,
  direction public.telephony_call_direction not null,
  phone_number text not null,
  status public.telephony_call_status not null default 'queued',
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  recording_url text,
  notes text,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_call_id)
);

create index if not exists telephony_calls_org_started_idx on public.telephony_calls(organization_id, started_at desc);
create index if not exists telephony_calls_rep_started_idx on public.telephony_calls(representative_id, started_at desc);

drop trigger if exists telephony_calls_set_updated_at on public.telephony_calls;
create trigger telephony_calls_set_updated_at before update on public.telephony_calls for each row execute function public.set_updated_at();

create or replace function public.enforce_telephony_call_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.client_id is not null and not exists (select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id) then
    raise exception 'Call client must belong to the same organization';
  end if;
  if new.representative_id is not null and not exists (select 1 from public.sales_representatives r where r.id = new.representative_id and r.organization_id = new.organization_id) then
    raise exception 'Call representative must belong to the same organization';
  end if;
  if new.visit_id is not null and not exists (select 1 from public.field_visits v where v.id = new.visit_id and v.organization_id = new.organization_id) then
    raise exception 'Call visit must belong to the same organization';
  end if;
  return new;
end; $$;
drop trigger if exists telephony_calls_scope on public.telephony_calls;
create trigger telephony_calls_scope before insert or update on public.telephony_calls for each row execute function public.enforce_telephony_call_scope();

alter table public.telephony_calls enable row level security;
drop policy if exists "representatives read own telephony calls" on public.telephony_calls;
create policy "representatives read own telephony calls" on public.telephony_calls for select to authenticated using (
  exists (select 1 from public.sales_representatives r where r.id = telephony_calls.representative_id and r.user_id = auth.uid())
);
