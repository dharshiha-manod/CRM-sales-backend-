-- This must run after the enum values are committed in the preceding
-- migration; PostgreSQL does not permit using a newly added enum value as a
-- column default in the same transaction.
alter table public.quotations alter column status set default 'draft';
