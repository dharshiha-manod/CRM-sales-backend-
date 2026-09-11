-- 20260903000005_leads.sql
-- Leads pipeline with auto-generated lead codes (LD-YYMM-00001).
-- Matches: leads.repository.ts (leadCode is optional -- "DB trigger auto-generates it when omitted").

create table leads (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id) on delete cascade,
  lead_code             text not null,
  industry_type_id      uuid not null references industry_types (id),
  representative_id     uuid references sales_representatives (id),
  company_name          text not null,
  contact_name          text,
  phone                 text,
  email                 text,
  city                  text,
  state                 text,
  source                text not null default 'other' check (source in ('referral', 'cold_call', 'walk_in', 'website', 'exhibition', 'social_media', 'ivr', 'other')),
  priority              text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  status                text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost')),
  score                 integer,
  notes                 text,
  next_action           text,
  next_action_due_at    timestamptz,
  converted_client_id   uuid references clients (id),
  converted_at          timestamptz,
  created_by            uuid references user_profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organization_id, lead_code),
  check (phone is not null or email is not null)
);
create index idx_leads_org on leads (organization_id);
create index idx_leads_industry_type on leads (industry_type_id);
create index idx_leads_rep on leads (representative_id);
create index idx_leads_status on leads (status);
create index idx_leads_created_at on leads (created_at desc);
create trigger trg_leads_updated_at before update on leads
  for each row execute function set_updated_at();

-- Per-organization, per-month counter backing the LD-YYMM-00001 sequence.
create table lead_code_counters (
  organization_id  uuid not null references organizations (id) on delete cascade,
  period           text not null,
  last_value       integer not null default 0,
  primary key (organization_id, period)
);

create or replace function generate_lead_code()
returns trigger as $$
declare
  period text := to_char(now(), 'YYMM');
  next_value integer;
begin
  if new.lead_code is not null and new.lead_code <> '' then
    return new;
  end if;
  insert into lead_code_counters (organization_id, period, last_value)
  values (new.organization_id, period, 1)
  on conflict (organization_id, period)
  do update set last_value = lead_code_counters.last_value + 1
  returning last_value into next_value;
  new.lead_code := 'LD-' || period || '-' || lpad(next_value::text, 5, '0');
  return new;
end;
$$ language plpgsql;

create trigger trg_leads_generate_code before insert on leads
  for each row execute function generate_lead_code();

create table lead_activities (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  lead_id            uuid not null references leads (id) on delete cascade,
  activity_type      text not null check (activity_type in ('created', 'status_changed', 'assigned', 'note_added', 'converted')),
  previous_status    text,
  new_status         text,
  note               text,
  actor_id           uuid references user_profiles (id),
  created_at         timestamptz not null default now()
);
create index idx_lead_activities_lead on lead_activities (lead_id);
create index idx_lead_activities_created_at on lead_activities (created_at desc);