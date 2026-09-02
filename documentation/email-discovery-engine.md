# Email Discovery Engine

> **Scope:** Pattern generation (`lib/patterns.ts`), the find loop (`lib/finder.ts`), confidence scoring, and the learned domain format store (`lib/domainFormatStore.ts`). Provider mechanics are in `documentation/verification.md`.

## Pattern generation

`lib/patterns.ts` defines 12 pattern specs, each a builder plus a static confidence score. `generatePatterns(first, last, domain)` lowercases and trims the names and returns all 12 candidates in spec order:

| Index | Pattern | Example (abhishek fodikar @ example.com) | Score |
|---|---|---|---|
| 0 | `first.last` | abhishek.fodikar@example.com | 0.90 |
| 1 | `f` + `last` | afodikar@example.com | 0.75 |
| 2 | `first` | abhishek@example.com | 0.65 |
| 3 | `firstlast` | abhishekfodikar@example.com | 0.60 |
| 4 | `f.last` | a.fodikar@example.com | 0.50 |
| 5 | `first` + `l` | abhishekf@example.com | 0.42 |
| 6 | `last` | fodikar@example.com | 0.35 |
| 7 | `last.first` | fodikar.abhishek@example.com | 0.25 |
| 8 | `last` + `f` | fodikara@example.com | 0.20 |
| 9 | `first_last` | abhishek_fodikar@example.com | 0.15 |
| 10 | `first-last` | abhishek-fodikar@example.com | 0.12 |
| 11 | `first.l` | abhishek.f@example.com | 0.48 |

Index 11 scores higher than several earlier entries but sits at the end: new specs are appended, never inserted, so learned pattern indices stored in Redis stay valid. `PATTERN_COUNT` exports the spec count.

`generatePatternsPreferring(first, last, domain, preferredIndex)` moves the spec at `preferredIndex` to the front (no-op for index 0 or out-of-range). This applies a domain's learned format before the default order.

## The find loop (`findEmail` in lib/finder.ts)

```
learned = getDomainFormat(domain)            // Upstash / in-memory
patterns = learned ? preferring(learned) : default order
for each pattern p:
  result = checkPrimary(p.email)             // Reacher in RR/BOTH, MV in MV mode
  valid       -> setDomainFormat(domain, p.index); return valid (confidence = p.score)
  accept-all  -> return accept-all for the TOP candidate
                 (confidence = top.score * provider confidence, 2 dp)
  invalid/unknown on the LEARNED pattern -> break early (see below)
// nothing confirmed:
BOTH mode -> MV sweep over the whole pattern set (learned-first order)
otherwise -> not found (email: '', confidence 0)
```

Details:

- **Stop on first win.** The loop returns on the first `valid`; remaining candidates are never checked.
- **Accept-all short-circuit.** A catch-all verdict applies to the whole domain, so the loop stops and returns the highest-priority candidate (`top`), not the one that happened to trigger the verdict.
- **Learned-pattern early break.** If the learned (preferred) pattern comes back `invalid` or inconclusive from Reacher, the loop breaks immediately instead of probing the other 11 patterns: the learned format is trusted over a single negative from Reacher (which may be throttled or probe-blocked), and the MV sweep settles it.
- **MV sweep (BOTH mode only).** When Reacher confirms nothing, every pattern is checked through MillionVerifier (learned pattern first, since it leads the list). First MV `valid` learns the format and returns; MV `accept-all` returns risky on the top candidate. MV errors abort the sweep. This is where credits are actually spent during discovery.
- **apiCalls** counts every provider call (Reacher + MV). During discovery each MV call costs one credit, so `apiCalls` doubles as credits-used in MV-involving paths; `creditsLeft` is the balance from the most recent MV response (null for Reacher).

## Confidence scoring

- `valid`: the pattern's static score (0.12 to 0.90 per the table). Provider confidence is reported separately in the `rr`/`mv` sub-results.
- `accept-all`: `top.score * providerConfidence` rounded to 2 decimals (provider confidence is 0.5 for both Reacher `risky` and MV `catch_all`, so typically 0.45 for a first.last top candidate).
- `not found`: 0.

## Learned domain format store (lib/domainFormatStore.ts)

Maps `domain -> pattern spec index` that last produced a `valid`.

| Layer | Backing | Notes |
|---|---|---|
| 1 | Process-local `Map` | Write-through cache; persists across requests within one server instance |
| 2 | Upstash Redis | Key `domainfmt:<domain>`, shared org-wide, survives deploys. Optional: without `UPSTASH_REDIS_REST_URL`/`TOKEN` the store degrades to memory-only |

Behavior:

- `getDomainFormat`: local hit wins; otherwise Redis; read errors are treated as "not learned yet" (lookup proceeds with the default order).
- `setDomainFormat`: skips the write when the local value is unchanged; Redis write failures are logged and ignored (the format is simply re-learned later).
- `clearLearnedFormats()` clears only the local map (test helper, re-exported from `lib/finder.ts`).

Writes happen in exactly two places, both in `findEmail`: a Reacher-confirmed valid and an MV-sweep-confirmed valid.

## Discovery result cache

Separate from the format store: `/api/lookup` first consults `getCachedDiscovery` (Supabase `verifications` table, any user, 90-day window, case-insensitive name match on the same domain). All cached statuses are reused, including `not found`, so bulk re-runs skip contacts that already failed. Manual discovery via the single-lookup UI hits the same route and the same cache; the documented force-retry path is that the cache only stores rows with `api_calls > 0`, see `documentation/verification.md` for cache mechanics.

## Brandfetch domain suggestions

`app/api/company-domains/route.ts`: GET with `?q=` (min 2 chars) proxies the Brandfetch search API (`https://api.brandfetch.io/v2/search/<q>?c=<BRANDFETCH_CLIENT_ID>`), cleans and dedupes domains, returns up to 6 `{name, domain, icon}` suggestions. Returns `{domains: []}` on any failure or when `BRANDFETCH_CLIENT_ID` is unset. The manual UI debounces this by 300 ms while typing a domain that does not yet contain a dot.

## Related Files

| File | Purpose |
|---|---|
| `lib/patterns.ts` | Pattern specs and generators |
| `lib/finder.ts` | `findEmail`, `verifyEmail`, `verifyWithMv` |
| `lib/domainFormatStore.ts` | Learned format cache (local + Upstash) |
| `lib/verifications.ts` | `getCachedDiscovery` (90-day discovery cache) |
| `app/api/lookup/route.ts` | Discovery endpoint |
| `app/api/company-domains/route.ts` | Brandfetch suggestions |
| `app/manual.tsx` | Single lookup UI |
