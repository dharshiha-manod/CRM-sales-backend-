-- Client-facing quotation delivery and manager approval gate.
alter type public.quotation_status add value if not exists 'draft';
alter type public.quotation_status add value if not exists 'client_accepted';

alter table public.quotations
  add column if not exists decision_source text check (decision_source in ('manual_rep', 'client_portal')),
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists rejection_reason text,
  add column if not exists public_token uuid,
  add column if not exists token_expires_at timestamptz;

create unique index if not exists quotations_public_token_idx
  on public.quotations(public_token) where public_token is not null;
create index if not exists quotations_public_token_expiry_idx
  on public.quotations(public_token, token_expires_at) where public_token is not null;
