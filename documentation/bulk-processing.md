# Bulk Processing

> **Scope:** The bulk CSV/XLSX flow in `app/batch.tsx`, the two-phase run (parallel cache sweep then serialized verification), and bulk export persistence/history.

## Access

Bulk is opt-in per user (`lib/access.ts`, admins always allowed). The bulk tab only renders when `canUseBulk` passes, and the server re-checks on every bulk-tagged API call (`source: 'bulk'` on `/api/lookup` and `/api/verify` returns 403 without access), plus on all `/api/bulk-exports` routes.

## Modes and input

Two bulk modes, mirrored by the API `mode` values:

| Mode | Required columns | Output per row |
|---|---|---|
| `discovery` | uuid, first name, last name, domain | best email + status + confidence + per-provider verdicts |
| `verification` | uuid, email | status + confidence + per-provider verdicts |

File handling (`app/batch.tsx`):

- Accepts `.csv`, `.xlsx`, `.xls`. Parsed with SheetJS (`xlsx`), lazy-imported so the ~400KB parser stays out of the initial bundle. First sheet only, first row = headers.
- Column mapping is auto-guessed by normalized header name against per-field alias lists (exact match first, then substring), and user-adjustable before confirming.
- Missing uuid falls back to `row-<n>`. Rows with missing required inputs are settled as `not found` without any API call.
- Discovery rows are **sorted by domain** on confirm so same-domain lookups run back-to-back, maximizing learned-format and catch-all reuse.

## The two-phase run

### Phase 1: parallel cache sweep

Every row is first probed with `cacheOnly: true` at concurrency 8 (`CACHE_SWEEP_CONCURRENCY`). On the server, `cacheOnly` means: check the 90-day Postgres cache; on a hit return the cached result (recorded to history with `api_calls: 0`), on a miss return `{miss: true}` without touching any verifier. Cache probes are pure DB reads (no verifier, no proxy IP), so wide concurrency is safe. Misses are collected for phase 2; any sweep-phase failure just defers the row to a real attempt.

### Phase 2: serialized real verifications

Cache misses are re-sorted into file order (keeping same-domain rows consecutive for the learned-format optimization) and processed at concurrency 1 (`CONCURRENCY`). Rationale from the code: Reacher probes real SMTP through one proxy IP; parallel lookups get that IP throttled by Google/Microsoft, producing false invalids/unknowns.

Per-row client timeout is 120 s (`ROW_TIMEOUT_MS`): a Reacher-fail domain can run ~11 SMTP probes plus a full MV sweep, so a single row can take 45 s or more; a shorter timeout would abort rows and wrongly show `not found` while the server is still resolving them. Timeouts and non-OK responses become `not found` rows.

For discovery hits, the client re-derives the pattern index by regenerating patterns locally (`generatePatterns`) and matching the returned email; `applyHit` then rebuilds the email from the index, so learned formats map cleanly onto each row's own name.

## Progress UI

Live counters (done, valid, accept-all, invalid, not found), a distribution chart, average confidence, unique domain count, elapsed/ETA/rows-per-minute derived from rows completed in the current run, and per-row active spinners.

## Export and history

- **Auto-save.** When a run completes (all rows resolved), the client builds the CSV (`toCSV`, includes UUID, inputs, status, confidence, RR/MV status+confidence, and a `Cached` column) and POSTs it to `/api/bulk-exports` with counts. One save per completed run, keyed by a run signature (`completedRunKey`/`savedRunKey`).
- **Server side** (`app/api/bulk-exports/route.ts`): validates mode and CSV, sanitizes the filename (forced `.csv`), uploads to the private `bulk-exports` Storage bucket at `<user_id>/<id>.csv` via the service-role client, inserts the metadata row, and rolls back the upload if the insert fails.
- **Listing.** GET `/api/bulk-exports` returns the caller's newest 50 exports (RLS-scoped). `lib/bulkExports.ts#getMyBulkExports` (limit 100) feeds the History page's "bulk history" tab.
- **Download.** GET `/api/bulk-exports/[id]/download` resolves the row under the user's RLS (404 for other users' exports), then redirects to a 60-second signed Storage URL with the original filename as the download name.
- A local "download CSV" button also builds the file client-side via a Blob, independent of the saved export.

## Related Files

| File | Purpose |
|---|---|
| `app/batch.tsx` | Bulk UI, parsing, mapping, two-phase run loop, CSV building |
| `app/api/lookup/route.ts` | `source: 'bulk'` gate, `cacheOnly` handling |
| `app/api/verify/route.ts` | Same for verification mode |
| `app/api/bulk-exports/route.ts` | Save + list exports |
| `app/api/bulk-exports/[id]/download/route.ts` | Signed-URL download |
| `lib/bulkExports.ts` | Export history reads |
| `lib/access.ts` | Bulk access checks |
| `app/history/page.tsx` | Bulk history tab |
