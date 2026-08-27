# Field Sales Platform

Phase 1 foundation for a generic, organization-scoped field sales platform. The school use case is represented as a generic `clients` domain in later phases; no school-specific schema is included here.

## Workspace

- `apps/api` — Express REST API. Routes are thin and use controllers, services, and repositories.
- `apps/admin` — React + Vite administration shell.
- `apps/mobile` — Expo + React Native representative shell.
- `supabase/migrations` — PostgreSQL schema and Row Level Security policies.

## Local setup

1. Install Node 20+ and pnpm.
2. Copy each `.env.example` to `.env` and provide values from a Supabase project.
3. Apply migrations with the Supabase CLI: `supabase db push` (or `supabase migration up` for a linked local project).
4. Run `pnpm install`, then `pnpm dev` commands from individual apps.

The API uses a Supabase service-role key only on the server. Browser and mobile use only the publishable/anon key. Clients authenticate through Supabase Auth; the API verifies bearer JWTs and loads organization role memberships from the database.
