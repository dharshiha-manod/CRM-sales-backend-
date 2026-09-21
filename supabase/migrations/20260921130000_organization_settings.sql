-- Persist the configurable Settings-page state per organization.  This keeps
-- configuration tenant-isolated while allowing new settings fields to be
-- introduced without repeated schema changes.
create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(settings) = 'object')
);

create trigger organization_settings_set_updated_at
before update on public.organization_settings
for each row execute function public.set_updated_at();

alter table public.organization_settings enable row level security;

create policy "members can read organization settings"
on public.organization_settings for select to authenticated
using (exists (
  select 1 from public.organization_memberships membership
  where membership.organization_id = organization_settings.organization_id
    and membership.user_id = auth.uid()
    and membership.status = 'active'
));
