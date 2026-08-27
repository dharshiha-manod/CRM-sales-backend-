-- Phase 1: tenancy and identity foundation. Domain modules follow in later migrations.
create extension if not exists pgcrypto;

create type public.organization_status as enum ('active', 'suspended');
create type public.membership_status as enum ('active', 'invited', 'disabled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status public.organization_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z_]*$'),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_memberships_user_id_idx on public.organization_memberships(user_id);
create index organization_memberships_organization_id_idx on public.organization_memberships(organization_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger user_profiles_set_updated_at before update on public.user_profiles for each row execute function public.set_updated_at();
create trigger organization_memberships_set_updated_at before update on public.organization_memberships for each row execute function public.set_updated_at();

-- Create a profile when a Supabase Auth user is created.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (id, display_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.email), new.phone)
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

insert into public.roles (code, name, description) values
  ('super_admin', 'Super admin', 'Full organization administration'),
  ('admin', 'Admin', 'Organization administration'),
  ('sales_manager', 'Sales manager', 'Sales oversight'),
  ('sales_representative', 'Sales representative', 'Mobile field-sales access')
on conflict (code) do nothing;

alter table public.organizations enable row level security;
alter table public.roles enable row level security;
alter table public.user_profiles enable row level security;
alter table public.organization_memberships enable row level security;

create policy "authenticated users can read roles" on public.roles for select to authenticated using (true);
create policy "users can read own profile" on public.user_profiles for select to authenticated using (id = auth.uid());
create policy "users can update own profile" on public.user_profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "users can read own memberships" on public.organization_memberships for select to authenticated using (user_id = auth.uid());
create policy "users can read their organizations" on public.organizations for select to authenticated using (
  exists (select 1 from public.organization_memberships m where m.organization_id = organizations.id and m.user_id = auth.uid() and m.status = 'active')
);
