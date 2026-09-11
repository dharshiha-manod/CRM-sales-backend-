-- Client industry profile: real-world compliance and commercial fields for
-- India-based B2B field sales (GSTIN/PAN, credit terms, outlet classification)
-- plus a structured industry_details bag for the 5 verticals this CRM serves
-- (FMCG, School, Textile, Pharmaceutical, Trading). Additive and nullable —
-- does not touch existing client_type/industry_type_id usage.

alter table public.clients
  add column gstin text,
  add column pan text,
  add column outlet_type text,
  add column credit_limit numeric(12,2),
  add column credit_days integer,
  add column industry_details jsonb not null default '{}'::jsonb;

-- GSTIN: 2-digit state code + 10-char PAN + 1 entity code + 'Z' + 1 checksum.
alter table public.clients add constraint clients_gstin_format_check
  check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$');

-- PAN: 5 letters + 4 digits + 1 letter.
alter table public.clients add constraint clients_pan_format_check
  check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$');

alter table public.clients add constraint clients_outlet_type_check
  check (outlet_type is null or outlet_type in ('wholesaler', 'retailer', 'distributor', 'super_stockist', 'institution', 'manufacturer', 'other'));

alter table public.clients add constraint clients_credit_limit_check check (credit_limit is null or credit_limit >= 0);
alter table public.clients add constraint clients_credit_days_check check (credit_days is null or credit_days between 0 and 365);
alter table public.clients add constraint clients_industry_details_is_object_check check (jsonb_typeof(industry_details) = 'object');

comment on column public.clients.gstin is 'GST Identification Number (India). Uppercase, 15 characters.';
comment on column public.clients.pan is 'Permanent Account Number (India). Uppercase, 10 characters.';
comment on column public.clients.outlet_type is 'Commercial classification of the account, independent of industry vertical.';
comment on column public.clients.industry_details is 'Structured attributes specific to the client''s industry_type, e.g. { "fssaiNumber": "..." } for FMCG or { "drugLicenseNumber": "..." } for Pharmaceutical. Validated by the API against the industry''s field set, not by the database.';

-- Seed the 5 real industry verticals this CRM is built for, for every existing
-- organization. Safe to re-run; only inserts codes that don't already exist,
-- so any organization that has already created its own custom industry types
-- (or previously ran the legacy free-text backfill) is left untouched for
-- those codes and only gains the ones it's missing.
insert into public.industry_types (organization_id, code, name, description)
select o.id, v.code, v.name, v.description
from public.organizations o
cross join (values
  ('FMCG', 'FMCG', 'Fast-moving consumer goods: distributors, super stockists, wholesalers and retail outlets.'),
  ('SCHOOL', 'School', 'Educational institutions purchasing supplies, uniforms, books or equipment.'),
  ('TEXTILE', 'Textile', 'Textile manufacturing and trading: powerloom, handloom, composite mills and garment units.'),
  ('PHARMA', 'Pharmaceutical', 'Pharmaceutical distributors, stockists and retail pharmacies requiring drug licensing.'),
  ('TRADING', 'Trading', 'General import/export and domestic trading accounts.')
) as v(code, name, description)
on conflict (organization_id, code) do nothing;