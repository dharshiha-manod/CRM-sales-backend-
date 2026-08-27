# Phase 1 Architecture

## Current state before implementation

The supplied workspace contained only `work/` and `outputs/`; no repository, manifests, source code, database files, credentials, or authentication configuration existed. Consequently there were no dependency conflicts or unrelated code to preserve.

## Chosen structure

```text
apps/
  admin/                 React + Vite admin shell
  mobile/                Expo + React Native representative shell
  api/src/
    routes/              HTTP registration only
    controllers/         HTTP request/response coordination
    services/            business-use-case boundary
    repositories/        Supabase/PostgreSQL access
    middleware/          authentication, authorization, errors
    config/, lib/, errors/
supabase/migrations/     ordered PostgreSQL migrations and RLS
```

## Identity and tenancy

Supabase Auth owns credentials and session issuance. Admin and mobile use the publishable/anon key to sign in; neither receives the service-role key. The API verifies Supabase JWTs through the project JWKS and loads the caller's active organization membership from PostgreSQL. Protected organization-scoped endpoints require `x-organization-id`, then validate the caller's role server-side.

The Phase 1 schema provides `organizations`, `roles`, `user_profiles`, and `organization_memberships`. `user_profiles` is linked 1:1 with `auth.users` by a trigger. Row Level Security is enabled for all exposed Phase 1 tables. Future domain data must include `organization_id`, a foreign key, indexes, and matching RLS policies.

## Intentional Phase 1 boundary

There are no client/school, representative, product, visit, location, offline-sync, order, collection, follow-up, notification, reporting, maps, or AI modules. The generic term **client** will be used when those modules are introduced; a school is a client subtype/use case rather than a foundation-level table.
