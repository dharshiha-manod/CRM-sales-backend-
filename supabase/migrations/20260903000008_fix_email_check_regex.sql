-- Fix broken email check constraints: the original regex used doubled
-- backslashes ('\\s', '\\.') which, in a standard (non-E'') string
-- literal, are passed to the regex engine as literal backslash
-- characters instead of \s (whitespace) / \. (literal dot) escapes.
-- That made the constraint reject virtually every real email address.

alter table public.sales_representatives
  drop constraint sales_representatives_email_check,
  add constraint sales_representatives_email_check
    check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

alter table public.clients
  drop constraint clients_email_check,
  add constraint clients_email_check
    check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

alter table public.client_contacts
  drop constraint client_contacts_email_check,
  add constraint client_contacts_email_check
    check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

alter table public.leads
  drop constraint leads_email_check,
  add constraint leads_email_check
    check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');