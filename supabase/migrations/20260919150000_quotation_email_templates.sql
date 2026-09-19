-- Run this migration before enabling quotation-email settings in production.
create table if not exists public.quotation_email_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  industry_type_id uuid not null references public.industry_types(id) on delete cascade,
  logo_url text,
  subject text not null,
  body text not null,
  footer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, industry_type_id)
);

create trigger quotation_email_templates_set_updated_at
before update on public.quotation_email_templates
for each row execute function public.set_updated_at();

alter table public.quotation_email_templates enable row level security;
create policy "members can read quotation email templates" on public.quotation_email_templates for select to authenticated using (
  exists (select 1 from public.organization_memberships m where m.organization_id = quotation_email_templates.organization_id and m.user_id = auth.uid() and m.status = 'active')
);

-- Logo files are uploaded by authenticated organization members from Settings.
insert into storage.buckets (id, name, public) values ('quotation-email-logos', 'quotation-email-logos', true) on conflict (id) do nothing;
create policy "members upload quotation logos" on storage.objects for insert to authenticated with check (
  bucket_id = 'quotation-email-logos' and exists (select 1 from public.organization_memberships m where m.user_id = auth.uid() and m.status = 'active' and (storage.foldername(name))[1] = m.organization_id::text)
);
create policy "public read quotation logos" on storage.objects for select using (bucket_id = 'quotation-email-logos');
