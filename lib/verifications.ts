import { createSupabaseServerClient } from './supabase/server';
import { createSupabaseAdminClient } from './supabase/admin';
import { logEvent } from './log';

export interface VerificationRow {
  id: string;
  user_id: string;
  user_email: string | null;
  created_at: string;
  kind: 'find' | 'verify';
  source: 'manual' | 'bulk';
  first_name: string | null;
  last_name: string | null;
  domain: string | null;
  email: string;
  status: 'valid' | 'accept-all' | 'invalid' | 'not found';
  confidence: number;
  pattern_index: number | null;
  api_calls: number;
  credits_left: number | null;
  // Per-provider verdicts (BOTH mode). Null when a provider didn't run.
  reacher_status: string | null;
  reacher_confidence: number | null;
  millionverifier_status: string | null;
  millionverifier_confidence: number | null;
}

export type VerificationInsert = Omit<
  VerificationRow,
  'id' | 'user_id' | 'user_email' | 'created_at'
>;

/**
 * Persist one verification attempt for the currently-authenticated user.
 * Best-effort: a storage failure is logged but never breaks the lookup response.
 */
export async function recordVerification(row: VerificationInsert): Promise<void> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logEvent('verifications', 'skip-insert', { reason: 'no-user' });
    return;
  }

  const { error } = await supabase.from('verifications').insert({
    ...row,
    user_id: user.id,
    user_email: user.email ?? null,
  });

  if (error) {
    logEvent('verifications', 'insert-error', { error: error.message });
  } else {
    logEvent('verifications', 'insert', {
      user: user.email,
      kind: row.kind,
      status: row.status,
      email: row.email,
    });
  }
}

// How long a stored verification verdict is reused instead of re-verifying
// (and re-spending a MillionVerifier credit).
const CACHE_MAX_AGE_DAYS = 90;

/**
 * Most recent stored verdict for an email, from ANY user, within the freshness
 * window. Uses the service-role client so the cache is shared org-wide despite
 * per-user RLS. Best-effort: returns null on error so a cache failure never
 * blocks a real verification. `not found` rows are never reused.
 */
export async function getCachedVerification(email: string): Promise<VerificationRow | null> {
  const admin = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('verifications')
    .select('*')
    .eq('email', email)
    .in('status', ['valid', 'accept-all', 'invalid'])
    // Only rows backed by a real verifier call — cache-hit rows are recorded
    // with api_calls=0 and must not keep extending the freshness window.
    .gt('api_calls', 0)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logEvent('verifications', 'cache-lookup-error', { error: error.message });
    return null;
  }
  return (data as VerificationRow | null) ?? null;
}

// Escape LIKE wildcards so a name is matched literally by ilike
// (ilike without wildcards = case-insensitive equality).
const likeExact = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/**
 * Most recent stored discovery for a contact (first + last name on a domain),
 * from ANY user, within the freshness window. Names match case-insensitively
 * since they're stored as entered. All statuses are reused — including
 * `not found`, so bulk re-runs skip previously-failed contacts (manual
 * discovery bypasses this cache and serves as the force-retry path).
 * Best-effort: returns null on error so a cache failure never blocks a find.
 */
export async function getCachedDiscovery(
  firstName: string,
  lastName: string,
  domain: string,
): Promise<VerificationRow | null> {
  const admin = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('verifications')
    .select('*')
    .eq('kind', 'find')
    .eq('domain', domain)
    .ilike('first_name', likeExact(firstName))
    .ilike('last_name', likeExact(lastName))
    // Only rows backed by real verifier calls — cache-hit rows are recorded
    // with api_calls=0 and must not keep extending the freshness window.
    .gt('api_calls', 0)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logEvent('verifications', 'discovery-cache-lookup-error', { error: error.message });
    return null;
  }
  return (data as VerificationRow | null) ?? null;
}

const HISTORY_PAGE_SIZE = 100;

/** The current user's own verification history, newest first. */
export async function getMyHistory(limit = HISTORY_PAGE_SIZE): Promise<VerificationRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('verifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    logEvent('verifications', 'history-error', { error: error.message });
    return [];
  }
  return (data ?? []) as VerificationRow[];
}

export interface UserStats {
  user_email: string;
  total: number;
  valid: number;
  acceptAll: number;
  invalid: number;
  notFound: number;
  apiCalls: number;
  lastActive: string;
}

export interface AdminOverview {
  totalVerifications: number;
  totalDiscovered: number; // valid + accept-all rows
  totalApiCalls: number;
  distinctUsers: number;
  perUser: UserStats[];
  recent: VerificationRow[];
}

/**
 * Aggregate dashboard data across ALL users. Uses the service-role client
 * (bypasses RLS) — callers MUST verify the requester is an admin first.
 */
export async function getAdminOverview(): Promise<AdminOverview> {
  const admin = createSupabaseAdminClient();

  const [perUser, recent] = await Promise.all([
    getPerUserStats(),
    admin
      .from('verifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) logEvent('verifications', 'admin-recent-error', { error: error.message });
        return (data ?? []) as VerificationRow[];
      }),
  ]);

  let totalVerifications = 0;
  let totalDiscovered = 0;
  let totalApiCalls = 0;
  for (const u of perUser) {
    totalVerifications += u.total;
    totalDiscovered += u.valid + u.acceptAll;
    totalApiCalls += u.apiCalls;
  }

  return {
    totalVerifications,
    totalDiscovered,
    totalApiCalls,
    distinctUsers: perUser.length,
    perUser,
    recent,
  };
}

interface AdminUserStatsRow {
  user_email: string;
  total: number;
  valid: number;
  accept_all: number;
  invalid: number;
  not_found: number;
  api_calls: number;
  last_active: string;
}

/**
 * Per-user aggregates, computed in Postgres via admin_user_stats() (migration
 * 0003), or admin_user_stats_since() (0007) when `since` is given. Falls back
 * to paging through the raw table if the function isn't deployed yet.
 */
async function getPerUserStats(since?: string): Promise<UserStats[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = since
    ? await admin.rpc('admin_user_stats_since', { p_since: since })
    : await admin.rpc('admin_user_stats');

  if (error) {
    logEvent('verifications', 'admin-stats-rpc-error', { error: error.message, since });
    return getPerUserStatsFallback(since);
  }

  return ((data ?? []) as AdminUserStatsRow[]).map((r) => ({
    user_email: r.user_email,
    total: Number(r.total),
    valid: Number(r.valid),
    acceptAll: Number(r.accept_all),
    invalid: Number(r.invalid),
    notFound: Number(r.not_found),
    apiCalls: Number(r.api_calls),
    lastActive: r.last_active,
  }));
}

/**
 * Aggregate in JS by paging through every row. PostgREST caps a single
 * response at 1000 rows, so the paging is mandatory — a plain select would
 * silently cover only the newest 1000.
 */
async function getPerUserStatsFallback(since?: string): Promise<UserStats[]> {
  const admin = createSupabaseAdminClient();
  const PAGE = 1000;
  const byUser = new Map<string, UserStats>();

  for (let from = 0; ; from += PAGE) {
    let query = admin
      .from('verifications')
      .select('user_id, user_email, created_at, status, api_calls');
    if (since) query = query.gte('created_at', since);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);

    if (error) {
      logEvent('verifications', 'admin-error', { error: error.message });
      return [];
    }

    const page = (data ?? []) as Pick<
      VerificationRow,
      'user_id' | 'user_email' | 'created_at' | 'status' | 'api_calls'
    >[];

    for (const r of page) {
      const key = r.user_email ?? r.user_id;
      let u = byUser.get(key);
      if (!u) {
        u = {
          user_email: key,
          total: 0,
          valid: 0,
          acceptAll: 0,
          invalid: 0,
          notFound: 0,
          apiCalls: 0,
          lastActive: r.created_at,
        };
        byUser.set(key, u);
      }
      u.total++;
      u.apiCalls += r.api_calls ?? 0;
      if (r.created_at > u.lastActive) u.lastActive = r.created_at;
      if (r.status === 'valid') u.valid++;
      else if (r.status === 'accept-all') u.acceptAll++;
      else if (r.status === 'invalid') u.invalid++;
      else u.notFound++;
    }

    if (page.length < PAGE) break;
  }

  return Array.from(byUser.values()).sort((a, b) => b.total - a.total);
}

// --- Usage over time (admin) ---

export type PeriodGrain = 'day' | 'week' | 'month' | 'year';

export interface PeriodStats {
  periodStart: string; // YYYY-MM-DD, first day of the period in IST
  total: number;
  valid: number;
  acceptAll: number;
  invalid: number;
  notFound: number;
  apiCalls: number;
  activeUsers: number;
}

export type PeriodStatsByGrain = Record<PeriodGrain, PeriodStats[]>;

// How many periods each view goes back (fewer if data starts later).
export const PERIOD_WINDOWS: Record<PeriodGrain, number> = { day: 30, week: 12, month: 6, year: 5 };
const GRAINS = Object.keys(PERIOD_WINDOWS) as PeriodGrain[];

// Periods are cut in IST, matching admin_period_stats()'s default p_tz.
// IST has no DST, so a fixed offset is exact.
const IST_OFFSET_MS = 330 * 60 * 1000;

interface AdminPeriodStatsRow {
  period_start: string;
  total: number;
  valid: number;
  accept_all: number;
  invalid: number;
  not_found: number;
  api_calls: number;
  active_users: number;
}

/**
 * Org-wide usage per day / week / month / year, newest period first, with
 * empty periods zero-filled. Computed in Postgres via admin_period_stats()
 * (migration 0005); falls back to paging the raw table if it isn't deployed.
 * Service-role client — callers MUST verify the requester is an admin first.
 */
export async function getAdminPeriodStats(): Promise<PeriodStatsByGrain> {
  const admin = createSupabaseAdminClient();
  const results = await Promise.all(
    GRAINS.map((g) => admin.rpc('admin_period_stats', { p_grain: g, p_periods: PERIOD_WINDOWS[g] })),
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    logEvent('verifications', 'admin-period-stats-rpc-error', { error: failed.error.message });
    return getAdminPeriodStatsFallback();
  }

  const out = {} as PeriodStatsByGrain;
  GRAINS.forEach((g, i) => {
    out[g] = ((results[i].data ?? []) as AdminPeriodStatsRow[]).map((r) => ({
      periodStart: r.period_start,
      total: Number(r.total),
      valid: Number(r.valid),
      acceptAll: Number(r.accept_all),
      invalid: Number(r.invalid),
      notFound: Number(r.not_found),
      apiCalls: Number(r.api_calls),
      activeUsers: Number(r.active_users),
    }));
  });
  return out;
}

/** First day (YYYY-MM-DD, IST) of the period containing `ms`. */
function periodKey(ms: number, grain: PeriodGrain): string {
  const d = new Date(ms + IST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  let day = d.getUTCDate();
  if (grain === 'year') return `${y}-01-01`;
  if (grain === 'month') return `${y}-${String(m + 1).padStart(2, '0')}-01`;
  if (grain === 'week') day -= (d.getUTCDay() + 6) % 7; // back to Monday
  return new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
}

/** The period before `key` (a YYYY-MM-DD period start). */
function previousKey(key: string, grain: PeriodGrain): string {
  const [y, m, d] = key.split('-').map(Number);
  const prev =
    grain === 'year' ? Date.UTC(y - 1, 0, 1)
    : grain === 'month' ? Date.UTC(y, m - 2, 1)
    : Date.UTC(y, m - 1, d - (grain === 'week' ? 7 : 1));
  return new Date(prev).toISOString().slice(0, 10);
}

/**
 * Same result as admin_period_stats(), aggregated in JS. Pages through every
 * row once (PostgREST caps responses at 1000) and buckets it for all grains.
 */
async function getAdminPeriodStatsFallback(): Promise<PeriodStatsByGrain> {
  const admin = createSupabaseAdminClient();
  const PAGE = 1000;
  const PARALLEL = 8;
  type Row = Pick<VerificationRow, 'user_id' | 'user_email' | 'created_at' | 'status' | 'api_calls'>;

  const { count, error: countError } = await admin
    .from('verifications')
    .select('id', { count: 'exact', head: true });
  if (countError) {
    logEvent('verifications', 'admin-period-count-error', { error: countError.message });
  }

  const rows: Row[] = [];
  const pages = Math.ceil((count ?? 0) / PAGE);
  for (let start = 0; start < pages; start += PARALLEL) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(PARALLEL, pages - start) }, (_, i) => {
        const from = (start + i) * PAGE;
        return admin
          .from('verifications')
          .select('user_id, user_email, created_at, status, api_calls')
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
      }),
    );
    for (const { data, error } of batch) {
      if (error) {
        logEvent('verifications', 'admin-period-error', { error: error.message });
        continue;
      }
      rows.push(...((data ?? []) as Row[]));
    }
  }

  const now = Date.now();
  const firstMs = rows.length ? Date.parse(rows[0].created_at) : now;
  const out = {} as PeriodStatsByGrain;

  for (const grain of GRAINS) {
    const buckets = new Map<string, PeriodStats & { users: Set<string> }>();
    const firstKey = periodKey(firstMs, grain);
    let key = periodKey(now, grain);
    for (let i = 0; i < PERIOD_WINDOWS[grain] && key >= firstKey; i++) {
      buckets.set(key, {
        periodStart: key,
        total: 0, valid: 0, acceptAll: 0, invalid: 0, notFound: 0, apiCalls: 0, activeUsers: 0,
        users: new Set(),
      });
      key = previousKey(key, grain);
    }

    for (const r of rows) {
      const b = buckets.get(periodKey(Date.parse(r.created_at), grain));
      if (!b) continue;
      b.total++;
      b.apiCalls += r.api_calls ?? 0;
      b.users.add(r.user_email ?? r.user_id);
      if (r.status === 'valid') b.valid++;
      else if (r.status === 'accept-all') b.acceptAll++;
      else if (r.status === 'invalid') b.invalid++;
      else b.notFound++;
    }

    out[grain] = Array.from(buckets.values()).map(({ users, ...s }) => ({ ...s, activeUsers: users.size }));
  }
  return out;
}

// --- Per-user totals for the current day / week / month / year (admin) ---

export type UserPeriod = 'today' | 'week' | 'month' | 'year';
const USER_PERIOD_GRAIN: Record<UserPeriod, PeriodGrain> = { today: 'day', week: 'week', month: 'month', year: 'year' };

/**
 * Per-user totals since the start of the current day / week / month / year
 * in IST (weeks start Monday), matching the usage-over-time periods.
 * Service-role client — callers MUST verify the requester is an admin first.
 */
export async function getPerUserStatsByPeriod(): Promise<Record<UserPeriod, UserStats[]>> {
  const periods = Object.keys(USER_PERIOD_GRAIN) as UserPeriod[];
  const results = await Promise.all(
    periods.map((p) => {
      const start = periodKey(Date.now(), USER_PERIOD_GRAIN[p]); // YYYY-MM-DD in IST
      return getPerUserStats(new Date(`${start}T00:00:00+05:30`).toISOString());
    }),
  );
  return Object.fromEntries(periods.map((p, i) => [p, results[i]])) as Record<UserPeriod, UserStats[]>;
}
