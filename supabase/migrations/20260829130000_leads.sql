-- Lead Management: first stage of the Industry -> Lead -> Sales Rep ->
-- Follow-up -> Visit -> Requirement -> Quotation -> Order -> Collection ->
-- Client pipeline. A lead is a prospective client, scoped by industry and
-- assigned to a sales representative. Converting a lead creates a row in the
-- existing `clients` table and closes the lead.

do $$ begin
  create type public.lead_status as enum ('new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_source as enum ('referral', 'cold_call', 'walk_in', 'website', 'exhibition', 'social_media', 'other');
exception when duplicate_object then null; end $$;

-- Representative <-> Industry Type: which industries a rep is allowed to see
-- and work leads in. Mirrors the sales_representative_client_assignments
-- pattern from Phase 2. No row for a rep means "no industry restriction" is
-- NOT assumed by the API -- the API treats an empty set as zero visibility
-- for that rep (see the lead visibility scoping in the service layer).
create table if not exists public.sales_representative_industry_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sales_representative_id uuid not null references public.sales_representatives(id) on delete restrict,
  industry_type_id uuid not null references public.industry_types(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, sales_representative_id, industry_type_id)
);
create index if not exists sales_rep_industry_types_rep_idx on public.sales_representative_industry_types(sales_representative_id);
create index if not exists sales_rep_industry_types_industry_idx on public.sales_representative_industry_types(industry_type_id);

create or replace function public.enforce_sales_rep_industry_type_scope()
returns trigger language plpgsql security invoker set search_path = public as $$ begin
  if not exists (select 1 from public.sales_representatives r where r.id = new.sales_representative_id and r.organization_id = new.organization_id) then
    raise exception 'Representative must belong to the same organization';
  end if;
  if not exists (select 1 from public.industry_types i where i.id = new.industry_type_id and i.organization_id = new.organization_id) then
    raise exception 'Industry type must belong to the same organization';
  end if;
  return new;
end; $$;
drop trigger if exists sales_rep_industry_types_scope on public.sales_representative_industry_types;
create trigger sales_rep_industry_types_scope before insert or update on public.sales_representative_industry_types for each row execute function public.enforce_sales_rep_industry_type_scope();

alter table public.sales_representative_industry_types enable row level security;
drop policy if exists "members can read organization rep industry assignments" on public.sales_representative_industry_types;
create policy "members can read organization rep industry assignments" on public.sales_representative_industry_types for select to authenticated using (
  exists (select 1 from public.organization_memberships m where m.organization_id = sales_representative_industry_types.organization_id and m.user_id = auth.uid() and m.status = 'active')
);

-- Leads.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  industry_type_id uuid not null references public.industry_types(id) on delete restrict,
  representative_id uuid references public.sales_representatives(id) on delete restrict,
  lead_code text not null,
  company_name text not null,
  contact_name text,
  phone text,
  email text,
  city text,
  state text,
  source public.lead_source not null default 'other',
  status public.lead_status not null default 'new',
  notes text,
  converted_client_id uuid references public.clients(id) on delete set null,
  converted_at timestamptz,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, lead_code),
  check (char_length(trim(lead_code)) between 1 and 80),
  check (char_length(trim(company_name)) between 1 and 240),
  check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  check (status <> 'converted' or converted_client_id is not null)
);

create index if not exists leads_organization_status_idx on public.leads(organization_id, status, created_at desc);
create index if not exists leads_organization_industry_idx on public.leads(organization_id, industry_type_id);
create index if not exists leads_representative_idx on public.leads(representative_id, status);
-- Duplicate detection: fast lookup on the two fields the API checks
-- (phone and email) scoped per organization.
create index if not exists leads_org_phone_idx on public.leads(organization_id, phone) where phone is not null;
create index if not exists leads_org_email_idx on public.leads(organization_id, lower(email)) where email is not null;
create index if not exists leads_org_company_name_idx on public.leads(organization_id, lower(company_name));

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at before update on public.leads for each row execute function public.set_updated_at();

create or replace function public.enforce_lead_scope()
returns trigger language plpgsql security invoker set search_path = public as $$ begin
  if not exists (select 1 from public.industry_types i where i.id = new.industry_type_id and i.organization_id = new.organization_id) then
    raise exception 'Lead industry type must belong to the same organization';
  end if;
  if new.representative_id is not null and not exists (
    select 1 from public.sales_representatives r where r.id = new.representative_id and r.organization_id = new.organization_id
  ) then
    raise exception 'Lead representative must belong to the same organization';
  end if;
  if new.converted_client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.converted_client_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Converted client must belong to the same organization';
  end if;
  return new;
end; $$;
drop trigger if exists leads_scope on public.leads;
create trigger leads_scope before insert or update on public.leads for each row execute function public.enforce_lead_scope();

alter table public.leads enable row level security;
drop policy if exists "members can read organization leads" on public.leads;
create policy "members can read organization leads" on public.leads for select to authenticated using (
  exists (select 1 from public.organization_memberships m where m.organization_id = leads.organization_id and m.user_id = auth.uid() and m.status = 'active')
);
-- Note: RLS here is a defense-in-depth backstop only. The API uses the
-- service-role client (supabaseAdmin) which bypasses RLS, so industry-based
-- and representative-based visibility for leads is enforced in the API
-- service layer (see apps/api/src/services/leads.service.ts), not by policy.

-- Lead activity / history log. Append-only audit trail of status changes,
-- assignment changes, and notes added to a lead.
do $$ begin
  create type public.lead_activity_type as enum ('created', 'status_changed', 'assigned', 'note_added', 'converted');
exception when duplicate_object then null; end $$;

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  lead_id uuid not null references public.leads(id) on delete cascade,
  activity_type public.lead_activity_type not null,
  note text,
  previous_status public.lead_status,
  new_status public.lead_status,
  actor_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lead_activities_lead_idx on public.lead_activities(lead_id, created_at desc);
create index if not exists lead_activities_org_idx on public.lead_activities(organization_id, created_at desc);

create or replace function public.enforce_lead_activity_scope()
returns trigger language plpgsql security invoker set search_path = public as $$ begin
  if not exists (select 1 from public.leads l where l.id = new.lead_id and l.organization_id = new.organization_id) then
    raise exception 'Lead activity must belong to the same organization as its lead';
  end if;
  return new;
end; $$;
drop trigger if exists lead_activities_scope on public.lead_activities;
create trigger lead_activities_scope before insert on public.lead_activities for each row execute function public.enforce_lead_activity_scope();

alter table public.lead_activities enable row level security;
drop policy if exists "members can read organization lead activities" on public.lead_activities;
create policy "members can read organization lead activities" on public.lead_activities for select to authenticated using (
  exists (select 1 from public.organization_memberships m where m.organization_id = lead_activities.organization_id and m.user_id = auth.uid() and m.status = 'active')
);
