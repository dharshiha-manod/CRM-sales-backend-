-- 20260903000007_rls_lockdown.sql
-- The Express API is the only reader/writer of this data and always uses
-- SUPABASE_SERVICE_ROLE_KEY (supabaseAdmin in src/lib/supabase.ts), which
-- bypasses RLS entirely. The frontend's supabase-js client only ever calls
-- supabase.auth.getSession() (see src/lib/api.ts) -- it never queries these
-- tables with the anon/publishable key. Enabling RLS with no policies makes
-- that assumption enforced at the database level instead of implicit.

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
 where schemaname = 'public'
  and tablename not in ('lead_code_sequences')
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
alter table lead_code_sequences enable row level security;