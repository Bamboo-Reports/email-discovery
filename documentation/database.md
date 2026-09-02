# Database

> **Scope:** Every Supabase object in `supabase/schema.sql` and `supabase/migrations/`, RLS policies, the three client types, access control (`lib/access.ts`), and admin roles.

## Applying the schema

`supabase/schema.sql` is the full current schema, meant for the Supabase SQL editor or `supabase db push`. Warning: it starts with `drop table if exists public.verifications cascade` (it was recreated to add the per-provider columns), so it destroys existing verification data. `supabase/migrations/` holds the additive, idempotent migrations for databases that already have data:

| Migration | Adds |
|---|---|
| `0001_bulk_access.sql` | `bulk_access` table |
| `0002_bulk_exports.sql` | `bulk_exports` table + `bulk-exports` storage bucket |
| `0003_admin_user_stats.sql` | `admin_user_stats()` function (in-database aggregation) |
| `0004_verifications_email_created_idx.sql` | `(email, created_at desc)` composite index; drops the superseded `verifications_email_idx` |

## Table: `public.verifications`

Per-user audit log of every find/verify attempt; also the backing store for the 90-day result caches.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid | FK `auth.users(id)` on delete cascade |
| `user_email` | text | denormalized for admin display |
| `created_at` | timestamptz | default `now()` |
| `kind` | text | check: `find` or `verify` |
| `source` | text | check: `manual` or `bulk`, default `manual` |
| `first_name`, `last_name`, `domain` | text | discovery inputs (nullable) |
| `email` | text | resolved/checked address, default `''` |
| `status` | text | check: `valid`, `accept-all`, `invalid`, `not found` (headline verdict: Reacher in BOTH mode, otherwise the single active provider) |
| `confidence` | numeric | default 0 |
| `pattern_index` | int | winning pattern spec index (discovery only) |
| `api_calls` | int | provider calls made; 0 marks a cache-hit row |
| `credits_left` | int | MV balance after the call, nullable |
| `reacher_status`, `reacher_confidence` | text, numeric | null when Reacher did not run |
| `millionverifier_status`, `millionverifier_confidence` | text, numeric | null when MV did not run |

Indexes: `(user_id, created_at desc)`, `(status)`, `(domain)`, `(email, created_at desc)` (serves plain email lookups and the verification cache).

RLS: enabled. Policies `own rows: select` and `own rows: insert`, both `auth.uid() = user_id`. No update/delete policies, so users can neither modify nor delete rows. The admin dashboard and both caches read via the service-role key, which bypasses RLS.

## Table: `public.bulk_access`

Opt-in gate for the bulk CSV feature, controlled from the admin panel.

| Column | Type | Notes |
|---|---|---|
| `email` | text PK | stored lowercase by the app |
| `enabled` | boolean | default true |
| `updated_at` | timestamptz | default `now()` |

RLS enabled with **no policies**: only the service-role client can read or write it. All access goes through `lib/access.ts`.

## Table: `public.bulk_exports`

Metadata for completed bulk runs; the CSV files themselves live in Storage.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | generated client-side by the route (`randomUUID()`) |
| `user_id` | uuid | FK `auth.users(id)` on delete cascade |
| `user_email` | text | |
| `created_at` | timestamptz | default `now()` |
| `mode` | text | check: `discovery` or `verification` |
| `filename` | text | sanitized download name |
| `storage_path` | text unique | `<user_id>/<id>.csv` in the bucket |
| `row_count` | int | |
| `valid_count`, `accept_all_count`, `invalid_count`, `not_found_count` | int | default 0 |

Index: `(user_id, created_at desc)`. RLS: enabled, own-rows select and insert (same pattern as verifications). Inserts actually happen through the admin client in the route, after the route itself has verified the user.

## Storage bucket: `bulk-exports`

Private (`public = false`), created by the schema/migration via an upsert into `storage.buckets`. Files are uploaded and signed by the service-role client only; downloads go through `/api/bulk-exports/[id]/download`, which checks auth + bulk access, resolves the row under the user's RLS (so users can only download their own exports), and redirects to a 60-second signed URL.

## Function: `public.admin_user_stats()`

`security definer` SQL function returning per-user aggregates (total, per-status counts, api_calls sum, last_active) grouped by `coalesce(user_email, user_id::text)`, ordered by total desc. Motivation: the previous JS aggregation silently broke past PostgREST's 1000-row response cap. Execute is revoked from `public`, `anon`, and `authenticated` and granted only to `service_role`. `lib/verifications.ts` calls it via `admin.rpc('admin_user_stats')` and falls back to paging through the raw table (1000 rows per page) if the function is not deployed.

## Supabase clients (`lib/supabase/`)

| Client | File | Key | RLS |
|---|---|---|---|
| Browser | `client.ts` | publishable/anon | enforced; used by the login page |
| Server | `server.ts` | publishable/anon + request cookies | enforced as the logged-in user; Server Components, route handlers, server actions |
| Admin | `admin.ts` | `SUPABASE_SECRET_KEY` (service role) | **bypassed**; server-only, never imported into client components |

## Access control layers

1. **Authentication (middleware.ts).** Every non-public path requires a Supabase session. Unauthenticated: `/api/*` gets 401 JSON, pages redirect to `/login?next=...`. Public paths: `/login`, `/auth/*`. Sign-up is restricted client-side to `@researchnxt.com` addresses (`ALLOWED_DOMAIN` in `app/login/page.tsx`).
2. **Admin role (env-based).** `ADMIN_EMAILS` (comma-separated) defines admins via `isAdminEmail()` in `lib/supabase/admin.ts`. Gates `/admin` (redirect to `/` otherwise), the admin nav link, and the `toggleBulk` server action.
3. **Bulk access (`lib/access.ts`).** `canUseBulk(email)`: admins always allowed; otherwise requires a `bulk_access` row with `enabled = true`. Checked by the workbench page (to show the bulk tab), by `/api/lookup` and `/api/verify` when `source === 'bulk'`, and by all `/api/bulk-exports` routes. `setBulkAccess` upserts through the admin client; `getEnabledBulkEmails` feeds the admin toggle UI.
4. **RLS.** Own-rows policies on `verifications` and `bulk_exports`; `bulk_access` is service-role-only.

## Related Files

| File | Purpose |
|---|---|
| `supabase/schema.sql` | Full schema (destructive for verifications) |
| `supabase/migrations/0001_bulk_access.sql` | bulk_access migration |
| `supabase/migrations/0002_bulk_exports.sql` | bulk_exports + bucket migration |
| `supabase/migrations/0003_admin_user_stats.sql` | Stats function |
| `supabase/migrations/0004_verifications_email_created_idx.sql` | Cache index |
| `lib/supabase/admin.ts` | Service-role client, admin email helpers |
| `lib/supabase/server.ts` | Cookie-bound RLS client |
| `lib/supabase/client.ts` | Browser client |
| `lib/access.ts` | Bulk access checks |
| `middleware.ts` | Auth gate |
