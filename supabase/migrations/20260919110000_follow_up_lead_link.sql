-- A follow-up may originate from an unconverted lead, before a client exists.
alter table public.follow_ups
  add column if not exists lead_id uuid references public.leads(id) on delete cascade;

alter table public.follow_ups
  alter column client_id drop not null,
  alter column representative_id drop not null;

create index if not exists follow_ups_lead_open_idx
  on public.follow_ups(organization_id, lead_id, status)
  where lead_id is not null;

create or replace function public.enforce_follow_up_scope() returns trigger language plpgsql security invoker set search_path = public as $$ begin
  if new.client_id is null and new.lead_id is null then
    raise exception 'Follow-up must be linked to a client or lead';
  end if;
  if new.client_id is not null and not exists (select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id) then
    raise exception 'Follow-up client must belong to the same organization';
  end if;
  if new.lead_id is not null and not exists (select 1 from public.leads l where l.id = new.lead_id and l.organization_id = new.organization_id) then
    raise exception 'Follow-up lead must belong to the same organization';
  end if;
  if new.representative_id is not null and not exists (select 1 from public.sales_representatives r where r.id = new.representative_id and r.organization_id = new.organization_id) then
    raise exception 'Follow-up representative must belong to the same organization';
  end if;
  if new.visit_id is not null and (new.client_id is null or new.representative_id is null or not exists (select 1 from public.field_visits v where v.id = new.visit_id and v.organization_id = new.organization_id and v.client_id = new.client_id and v.representative_id = new.representative_id)) then
    raise exception 'Follow-up visit must match the client and representative';
  end if;
  return new;
end; $$;
