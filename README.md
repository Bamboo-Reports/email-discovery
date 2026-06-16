# email-lookup

Internal email discovery and verification workbench.

## features

- **Single lookup** — find an email by name + domain, or verify an existing email. Probes run against the live MX record; results are confidence-scored.
- **Bulk CSV lookup** — upload a CSV of names + domains. Pattern detection runs against live MX records; results are confidence-scored and exportable.
- **Company domain suggestions** — manual lookup suggests company domains as you type via the Brandfetch API.
- **Pattern learning** — discovered email formats are cached in Upstash Redis so the optimization is shared org-wide.
- **Admin dashboard** — manage per-user bulk access and view verification history (Supabase + RLS).

## env variables

| Variable | Required | Description |
|---|---|---|
| `MILLIONVERIFIER_API_KEY` | Yes | API key for email verification |
| `MILLIONVERIFIER_BASE_URL` | No | Override the API endpoint (default: `https://api.millionverifier.com/api/v3`) |
| `BRANDFETCH_CLIENT_ID` | No | Client ID for company domain suggestions |
| `BRANDFETCH_API_KEY` | No | API key for company domain suggestions |
| `UPSTASH_REDIS_REST_URL` | No | Redis REST URL for shared pattern learning |
| `UPSTASH_REDIS_REST_TOKEN` | No | Redis REST token |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon/publishable key |
| `SUPABASE_SECRET_KEY` | Yes | Supabase service role key (server-only, admin dashboard) |
| `ADMIN_EMAILS` | Yes | Comma-separated emails allowed to view `/admin` |

## tech stack

- **Framework:** Next.js 14 (App Router)
- **Auth / DB:** Supabase (SSR, RLS)
- **Cache:** Upstash Redis
- **APIs:** MillionVerifier, Brandfetch
- **Language:** TypeScript
