-- Phase 2: generic client and sales-representative master data.
create type public.sales_representative_status as enum ('active', 'inactive');
create type public.client_status as enum ('active', 'inactive');
create type public.client_priority as enum ('low', 'normal', 'high', 'critical');
create type public.assignment_status as enum ('active', 'inactive');

create table public.sales_representatives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references public.user_profiles(id) on delete restrict,
  employee_code text not null,
  phone text,
  email text,
  designation text,
  joining_date date,
  status public.sales_representative_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, employee_code),
  check (char_length(trim(employee_code)) between 1 and 80),
  check (email is null or email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_code text not null,
  client_name text not null,
  client_type text not null,
  industry text,
  phone text,
  email text,
  website text,
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  gps_radius_meters integer,
  priority public.client_priority not null default 'normal',
  status public.client_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_code),
  check (char_length(trim(client_code)) between 1 and 80),
  check (char_length(trim(client_name)) between 1 and 240),
  check (char_length(trim(client_type)) between 1 and 80),
  check (email is null or email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (gps_radius_meters is null or gps_radius_meters between 10 and 10000),
  check ((latitude is null and longitude is null) or (latitude is not null and longitude is not null))
);

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  designation text,
  department text,
  phone text,
  alternate_phone text,
  email text,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(name)) between 1 and 160),
  check (email is null or email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
);

create unique index client_contacts_one_primary_per_client_idx on public.client_contacts(client_id) where is_primary;
create index clients_organization_status_idx on public.clients(organization_id, status);
create index clients_organization_type_idx on public.clients(organization_id, client_type);
create index sales_representatives_organization_status_idx on public.sales_representatives(organization_id, status);
create index client_contacts_client_id_idx on public.client_contacts(client_id);

create table public.sales_representative_client_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sales_representative_id uuid not null references public.sales_representatives(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  status public.assignment_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sales_representative_id, client_id)
);
create index sales_rep_client_assignments_client_idx on public.sales_representative_client_assignments(client_id, status);

create trigger sales_representatives_set_updated_at before update on public.sales_representatives for each row execute function public.set_updated_at();
create trigger clients_set_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger client_contacts_set_updated_at before update on public.client_contacts for each row execute function public.set_updated_at();
create trigger sales_rep_client_assignments_set_updated_at before update on public.sales_representative_client_assignments for each row execute function public.set_updated_at();

-- Reject cross-organization contact and assignment references even for service-role API writes.
create or replace function public.enforce_phase_2_organization_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_table_name = 'client_contacts' and not exists (select 1 from clients c where c.id = new.client_id and c.organization_id = new.organization_id) then
    raise exception 'Client must belong to the same organization';
  end if;
  if tg_table_name = 'sales_representative_client_assignments' and (
    not exists (select 1 from sales_representatives r where r.id = new.sales_representative_id and r.organization_id = new.organization_id)
    or not exists (select 1 from clients c where c.id = new.client_id and c.organization_id = new.organization_id)
  ) then raise exception 'Representative and client must belong to the same organization'; end if;
  return new;
end;
$$;
create trigger client_contacts_enforce_organization before insert or update on public.client_contacts for each row execute function public.enforce_phase_2_organization_scope();
create trigger sales_rep_client_assignments_enforce_organization before insert or update on public.sales_representative_client_assignments for each row execute function public.enforce_phase_2_organization_scope();

alter table public.sales_representatives enable row level security;
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.sales_representative_client_assignments enable row level security;

create policy "members can read organization representatives" on public.sales_representatives for select to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = sales_representatives.organization_id and m.user_id = auth.uid() and m.status = 'active'));
create policy "members can read organization clients" on public.clients for select to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = clients.organization_id and m.user_id = auth.uid() and m.status = 'active'));
create policy "members can read organization contacts" on public.client_contacts for select to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = client_contacts.organization_id and m.user_id = auth.uid() and m.status = 'active'));
create policy "members can read organization assignments" on public.sales_representative_client_assignments for select to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = sales_representative_client_assignments.organization_id and m.user_id = auth.uid() and m.status = 'active'));
