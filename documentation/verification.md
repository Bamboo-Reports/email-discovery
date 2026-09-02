# Verification

> **Scope:** Provider integration (Reacher, MillionVerifier), verdict mapping, the three verification modes, result caching, and the MV re-check flow. Discovery-specific logic is in `documentation/email-discovery-engine.md`.

## Verification modes (`VERIFICATION_METHOD`)

Selected per-request from env in `lib/verifier.ts`; anything other than `RR` or `BOTH` means `MV`.

| Mode | Primary | Second opinion | Cost profile |
|---|---|---|---|
| `MV` (default) | MillionVerifier | never | 1 credit per check |
| `RR` | Reacher | never | free per check |
| `BOTH` | Reacher | MillionVerifier, only when Reacher says `invalid` or `not found` | credits spent only on Reacher's negatives |

`primaryIsReacher()` is true for RR and BOTH. `shouldSecondOpinion(status)` encodes the BOTH policy: Reacher's `valid` and `accept-all` are trusted as-is; its negatives can be false positives on a shared proxy IP, so MV re-checks them.

## Reacher client (`lib/reacher.ts`)

- POST `${REACHER_BACKEND_URL}/v0/check_email` with body `{to_email}` and, when set, header `x-reacher-secret: $REACHER_SECRET`.
- Proxy, from-email, and hello-name are configured on the Reacher container (RCH__* env vars), not sent per request.
- Non-2xx throws `reacher check failed (<status>)`.

### Verdict mapping (`lib/reacherMap.ts`)

Kept import-free so `lib/reacherMap.selfcheck.ts` can run under bare `node`.

| Reacher `is_reachable` | Status | Confidence | `inconclusive` |
|---|---|---|---|
| `safe` | `valid` | 0.9 | false |
| `invalid` | `invalid` | 0 | false |
| `risky` | `accept-all` | 0.5 | false |
| `unknown` (or anything else / missing) | `not found` | 0 | true only for `unknown` |

`inconclusive: true` marks a throttled/greylisted probe as distinct from a clean negative; the finder's learned-pattern early break keys off it. `creditsLeft` is always null (Reacher has no credit concept).

Self-check: `node lib/reacherMap.selfcheck.ts` (Node strips the types natively) asserts the full mapping table.

## MillionVerifier client (`lib/millionverifier.ts`)

- GET `${MILLIONVERIFIER_BASE_URL:-https://api.millionverifier.com/api/v3}?api=<key>&email=<email>&timeout=10`.
- A JSON body containing `error` throws.
- `getMillionVerifierCredits()`: GET `/credits`, returns `{credits, bulk_credits, renewing_credits, plan}`; does not consume a verification credit. Used by `/api/credits` and the admin dashboard.

### Verdict mapping (`fromMillionVerifier` in `lib/verifier.ts`)

| MV `result` | Status | Confidence |
|---|---|---|
| `ok` | `valid` | 0.95 if `quality === 'good'`, else 0.85 |
| `catch_all` | `accept-all` | 0.5 |
| `invalid`, `disposable` | `invalid` | 0 |
| anything else (`unknown`, `unverified`, `error`, ...) | `not found` | 0 |

`creditsLeft` comes from the response's `credits` field.

## Verify flow (`verifyEmail` in lib/finder.ts)

1. Syntax check against `/^[^\s@]+@([^\s@]+\.[^\s@]+)$/`; failures return `not found` with 0 apiCalls.
2. `checkPrimary(email)`.
3. `checkSecondOpinion(email, primaryStatus)`: null unless BOTH mode and primary was `invalid`/`not found`. MV failures are swallowed (logged) so the primary result is never lost.
4. Headline selection: primary wins if it is `valid`, if there is no second opinion, or if MV itself returned `not found`; otherwise MV's definitive answer wins.
5. Both per-provider verdicts are surfaced as `rr` and `mv` sub-results (`labelProviders`: in MV-only mode `rr` is null and the primary is labeled `mv`).

## Result caching (`lib/verifications.ts`)

Two Postgres-backed caches over the `verifications` table, both org-wide (service-role client, bypasses per-user RLS), both with a 90-day freshness window (`CACHE_MAX_AGE_DAYS`), both best-effort (errors return null and the real check runs).

| Cache | Function | Key | Statuses reused |
|---|---|---|---|
| Verification | `getCachedVerification(email)` | exact email | `valid`, `accept-all`, `invalid` (never `not found`) |
| Discovery | `getCachedDiscovery(first, last, domain)` | `kind='find'` + domain + case-insensitive exact names (`ilike` with escaped wildcards) | all, including `not found` |

Both filter `api_calls > 0`: cache hits are recorded back into the table with `api_calls = 0`, and that filter stops hit rows from endlessly extending the freshness window. The newest matching row wins (`order created_at desc limit 1`), served by the `verifications_email_created_idx` composite index (migration 0004).

Cache hits are returned with `cached: true` and `cachedAt` (the source row's `created_at`); the UI shows a "cached, no credit used" badge. Each hit is still recorded as a history row so per-user history and admin stats reflect it, with `api_calls: 0` keeping credit stats accurate.

## MV re-check flow (`mvOnly`)

The single-lookup result UI offers a "check with MillionVerifier" button (and a re-check button when an MV verdict already exists). It POSTs `/api/verify` with `mvOnly: true`, which:

- always bypasses the verification cache (explicit force-recheck),
- calls `verifyWithMv` -> `checkWithMv`, forcing an MV check regardless of `VERIFICATION_METHOD`,
- returns the MV verdict as both the headline and the `mv` sub-result (`rr` null),
- costs 1 credit and is recorded to history like any verification.

## Recording (`recordVerification`)

Every lookup/verify (real or cache hit) inserts one row into `verifications` as the authenticated user (RLS-scoped server client). Failures are logged, never surfaced: a storage error must not break the lookup response. Skipped entirely when no user is authenticated.

## Related Files

| File | Purpose |
|---|---|
| `lib/verifier.ts` | Mode selection, MV mapping, second-opinion policy |
| `lib/reacher.ts` | Reacher HTTP client |
| `lib/reacherMap.ts` | Reacher verdict mapping (pure) |
| `lib/reacherMap.selfcheck.ts` | Bare-node assertions for the mapping |
| `lib/millionverifier.ts` | MV verify + credits client |
| `lib/finder.ts` | `verifyEmail`, `verifyWithMv`, headline selection |
| `lib/verifications.ts` | Caches and history recording |
| `app/api/verify/route.ts` | Verify endpoint (cache, cacheOnly, mvOnly) |
| `app/api/credits/route.ts` | Credit balance endpoint |
