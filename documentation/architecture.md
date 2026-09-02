# Architecture

> **Scope:** System overview, request/data flow, directory responsibilities, and runtime topology. For subsystem details see the other files in `documentation/`.

## What this is

An internal email discovery and verification workbench ("email workbench", package name `hunter-web`). Two core operations:

1. **Discovery (find):** given first name + last name + company domain, generate candidate email patterns and probe them against the company's mail server until one verifies.
2. **Verification (verify):** given a known email address, report whether the mailbox exists.

No email is ever sent. Verification is SMTP handshake probing (self-hosted Reacher) and/or the MillionVerifier API.

## Runtime topology

```
Browser (React client components)
   |
   v
Next.js 14 App Router (Vercel, nodejs runtime)
   |-- middleware.ts ............. Supabase session refresh + auth gate
   |-- app/api/lookup ............ discovery endpoint
   |-- app/api/verify ............ verification endpoint
   |-- app/api/credits ........... MV credit balance
   |-- app/api/company-domains ... Brandfetch domain suggestions
   |-- app/api/bulk-exports ...... bulk CSV export persistence + download
   |
   |---> lib/finder.ts (orchestration)
   |        |---> lib/verifier.ts (provider selection: MV / RR / BOTH)
   |        |        |---> lib/reacher.ts -----> Reacher backend (VPS, Cloudflare Tunnel, SOCKS5 proxy)
   |        |        |---> lib/millionverifier.ts -> api.millionverifier.com
   |        |---> lib/patterns.ts (candidate generation)
   |        |---> lib/domainFormatStore.ts ----> Upstash Redis (learned domain formats)
   |
   |---> lib/verifications.ts --------> Supabase Postgres (verifications table, cache + history)
   |---> lib/access.ts ---------------> Supabase Postgres (bulk_access table)
   |---> lib/bulkExports.ts ----------> Supabase Postgres + Storage (bulk_exports, bulk-exports bucket)
```

The app cannot do SMTP itself: it runs on Vercel serverless, which cannot hold open SMTP connections. All SMTP probing is delegated to the Reacher container on a VPS (see `documentation/reacher-deployment.md`).

## Request flow for one discovery

1. Client POSTs `{firstName, lastName, domain}` to `/api/lookup` (bulk requests add `source: 'bulk'` and are gated by `lib/access.ts`).
2. Route checks the discovery cache (`getCachedDiscovery`): most recent stored result for that contact from any user within 90 days. Hit: return it with `cached: true`, `apiCalls: 0`, and record a history row.
3. Miss: `findEmail()` in `lib/finder.ts` loads the domain's learned pattern index from `lib/domainFormatStore.ts`, generates candidates via `lib/patterns.ts` (learned pattern first), and checks each through `checkPrimary()` in `lib/verifier.ts`.
4. First `valid` wins: the pattern index is saved back to the domain format store and the loop stops. `accept-all` also ends the loop (returned as risky). In BOTH mode, if Reacher confirms nothing, the whole pattern set is re-swept through MillionVerifier.
5. The result is persisted to `verifications` via `recordVerification()` (best-effort, never fails the response) and returned as JSON.

Verification of a known email follows the same shape through `/api/verify` and `verifyEmail()` but with no pattern loop.

## Directory responsibilities

| Path | Responsibility |
|---|---|
| `middleware.ts` | Refreshes the Supabase session cookie on every request; redirects unauthenticated page requests to `/login`, returns 401 JSON for unauthenticated `/api/*` requests |
| `app/page.tsx` | Workbench entry (server component), computes bulk access, renders `Workbench` |
| `app/workbench.tsx` | Client tab switcher: single vs bulk (bulk tab only when the user has bulk access) |
| `app/manual.tsx` | Single lookup UI (discovery + verification modes, Brandfetch suggestions, MV re-check button) |
| `app/batch.tsx` | Bulk CSV/XLSX UI: parse, column mapping, two-phase run (cache sweep then serialized verifications), CSV export, auto-save to bulk_exports |
| `app/history/page.tsx` | Current user's verification history + saved bulk exports |
| `app/admin/` | Admin dashboard (org-wide stats, MV credit balance, per-user bulk access toggles) plus `toggleBulk` server action |
| `app/login/page.tsx` | Supabase email/password sign-in and sign-up (sign-up restricted to `@researchnxt.com`) |
| `app/auth/signout/route.ts` | POST sign-out, redirects to `/login` |
| `app/api/` | Route handlers (all `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`) |
| `lib/finder.ts` | Discovery/verify orchestration, result shaping, provider labeling |
| `lib/verifier.ts` | Provider selection (MV / RR / BOTH), verdict normalization, second-opinion policy |
| `lib/patterns.ts` | 12 email pattern specs with confidence scores |
| `lib/domainFormatStore.ts` | Learned domain format cache (in-process map + Upstash Redis) |
| `lib/reacher.ts`, `lib/reacherMap.ts` | Reacher HTTP client and verdict mapping (`reacherMap.selfcheck.ts` is a bare-node test) |
| `lib/millionverifier.ts` | MillionVerifier HTTP client (verify + credits endpoints) |
| `lib/verifications.ts` | History persistence, verification/discovery caches, admin aggregation |
| `lib/access.ts` | Bulk feature access checks and admin toggling |
| `lib/bulkExports.ts` | Bulk export history reads |
| `lib/log.ts` | Gated server-side logger (`EMAIL_ENGINE_LOG`) |
| `lib/supabase/` | Three Supabase clients: browser (anon), server (cookie-bound, RLS), admin (service role, bypasses RLS) |
| `components/` | Presentational client/server components (NavBar, StatusBadge, ConfidenceBar, PaginatedTabs, BulkToggle, ThemeToggle, Spinner) |
| `supabase/` | `schema.sql` (full schema, destructive re-create of verifications) + additive `migrations/` |
| `reacher-deploy/` | docker-compose for the self-hosted Reacher backend on a VPS |

## The four verdicts

Every check normalizes to one of:

| Status | Meaning |
|---|---|
| `valid` | Mailbox confirmed deliverable |
| `invalid` | Mailbox rejected, disabled, or disposable |
| `accept-all` | Catch-all domain, server accepts any address, cannot confirm the specific mailbox |
| `not found` | No conclusive answer (malformed input, server blocked/throttled the probe, unknown result) |

## Cost model

| Provider | Cost | Role |
|---|---|---|
| Reacher (self-hosted) | Flat VPS cost, free per check | Primary in RR/BOTH modes |
| MillionVerifier | 1 credit per check | Only provider in MV mode; second opinion / sweep in BOTH mode |

Three layers reduce spend: the 90-day result cache in Postgres (`documentation/verification.md`), the learned domain format store (`documentation/email-discovery-engine.md`), and the RR-first/MV-fallback policy of BOTH mode.

## Related Files

| File | Purpose |
|---|---|
| `middleware.ts` | Auth gate and session refresh |
| `app/api/lookup/route.ts` | Discovery endpoint |
| `app/api/verify/route.ts` | Verification endpoint |
| `lib/finder.ts` | Orchestration core |
| `lib/verifier.ts` | Provider selection and normalization |
| `lib/verifications.ts` | Persistence and caching |
| `supabase/schema.sql` | Database schema |
| `reacher-deploy/docker-compose.yml` | Reacher backend deployment |
