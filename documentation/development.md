# Development

> **Scope:** Local setup, every environment variable, scripts, auth/middleware behavior, logging, and testing.

## Prerequisites

- Node.js (repo pins `npm@10.7.0` via `packageManager`; `@types/node` targets Node 20)
- A Supabase project (auth + Postgres + Storage)
- Optional: MillionVerifier API key, Upstash Redis database, Brandfetch client ID, a deployed Reacher backend

## Setup

```bash
npm install
cp .env.example .env.local        # fill in values (table below)
# Apply supabase/schema.sql in the Supabase SQL editor (fresh project),
# or run the files in supabase/migrations/ on an existing database.
npm run dev
```

Warning: `supabase/schema.sql` drops and recreates `public.verifications`. On a database with data, use `supabase/migrations/` only.

Repo policy (AGENTS.md / CLAUDE.md): agents must not run dev or build server commands (`npm run dev`, `npm run build`); use `npm run typecheck` or targeted static checks instead.

## Scripts (package.json)

| Script | Command | Notes |
|---|---|---|
| `dev` | `next dev --turbo` | Turbopack dev server |
| `build` | `next build` | |
| `start` | `next start` | |
| `lint` | `next lint` | |
| `typecheck` | `tsc --noEmit` | Preferred verification for agents |

`turbo.json` defines the same tasks for Turborepo (`turbo` is a devDependency); global deps include `.env`, `.env.local`, `tsconfig.json`, `next.config.mjs`.

## Environment variables

All variables from `.env.example`, plus two read only in code:

| Variable | Required | Used by | Purpose |
|---|---|---|---|
| `MILLIONVERIFIER_API_KEY` | Yes unless `VERIFICATION_METHOD=RR` | `lib/millionverifier.ts` | MV verify + credits API key; throws when missing and MV is called |
| `MILLIONVERIFIER_BASE_URL` | No | `lib/millionverifier.ts` | Override the MV endpoint (default `https://api.millionverifier.com/api/v3`). Not listed in `.env.example` |
| `VERIFICATION_METHOD` | No | `lib/verifier.ts`, `app/api/credits` | `MV` (default), `RR` (Reacher only), or `BOTH` (Reacher primary + MV second opinion) |
| `REACHER_BACKEND_URL` | When method is RR/BOTH | `lib/reacher.ts` | Base URL of the self-hosted Reacher backend (Cloudflare Tunnel hostname) |
| `REACHER_SECRET` | No (recommended) | `lib/reacher.ts` | Sent as `x-reacher-secret`; must match the container's `RCH__HEADER_SECRET` |
| `BRANDFETCH_CLIENT_ID` | No | `app/api/company-domains` | Enables company domain suggestions; suggestions return empty when unset |
| `BRANDFETCH_API_KEY` | No | (declared in `.env.example`; not read by any route, only the client ID is used) | |
| `UPSTASH_REDIS_REST_URL` | No | `lib/domainFormatStore.ts` | Durable, org-wide learned-format store; falls back to in-memory only when unset |
| `UPSTASH_REDIS_REST_TOKEN` | No | `lib/domainFormatStore.ts` | Token for the above |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | all Supabase clients, middleware | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | browser/server clients, middleware | Anon/publishable key (RLS enforced) |
| `SUPABASE_SECRET_KEY` | Yes | `lib/supabase/admin.ts` | Service-role key. Bypasses RLS. Server-only, never expose to the client |
| `ADMIN_EMAILS` | Yes | `lib/supabase/admin.ts` | Comma-separated admin emails: `/admin` access, bulk always allowed, bulk-access toggling |
| `EMAIL_ENGINE_LOG` | No | `lib/log.ts` | `1` forces logging on (e.g. in production), `off` disables. Default: on outside production. Not listed in `.env.example` |

## Auth and middleware

- `middleware.ts` runs on everything except Next internals and static assets. It refreshes the Supabase session cookie on each request via `@supabase/ssr`, then gates: unauthenticated `/api/*` gets 401 JSON; unauthenticated pages redirect to `/login?next=<path>`; authenticated users on `/login` are redirected to `/`. Public paths: `/login` and `/auth/*`.
- Login (`app/login/page.tsx`) is Supabase email/password. Sign-up is restricted client-side to `@researchnxt.com` addresses; if email confirmation is enabled the user is told to confirm before signing in.
- Sign-out: POST `/auth/signout` (form in the NavBar), redirects 303 to `/login`.
- Admin: `ADMIN_EMAILS` membership (see `documentation/database.md`).

## Logging

`lib/log.ts` prints `[scope] event k=v ...` lines server-side. Scopes in use: `finder`, `verifier`, `reacher`, `millionverifier`, `domainfmt`, `verifications`, `bulk-exports`. Gated by `EMAIL_ENGINE_LOG` as above.

## Testing

No test framework is configured. The only automated check besides `typecheck` is the Reacher mapping self-check:

```bash
node lib/reacherMap.selfcheck.ts
```

It runs under bare Node (type-stripping) because `lib/reacherMap.ts` is a pure module with no runtime imports.

## UI conventions

- App Router, all API routes on `runtime = 'nodejs'` with `dynamic = 'force-dynamic'`.
- Fonts: DM Sans (`--font-sans`) and JetBrains Mono (`--font-mono`) via `next/font`.
- Dark mode: an inline script in `app/layout.tsx` sets `data-theme` from `localStorage` or `prefers-color-scheme` before paint; `components/ThemeToggle.tsx` toggles and persists it.
- SheetJS (`xlsx`) is dynamically imported in `app/batch.tsx` to keep it out of the initial bundle.

## Related Files

| File | Purpose |
|---|---|
| `.env.example` | Environment variable template |
| `package.json` | Scripts and dependency versions |
| `turbo.json` | Turborepo task config |
| `middleware.ts` | Session refresh and auth gate |
| `AGENTS.md` | Agent command restrictions |
| `lib/log.ts` | Gated logger |
| `lib/reacherMap.selfcheck.ts` | Self-check test |
| `supabase/schema.sql` | Fresh-project schema |
