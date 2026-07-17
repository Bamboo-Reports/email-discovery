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
 * Per-user aggregates, computed in Postgres via the admin_user_stats()
 * function (migration 0003). Falls back to paging through the raw table if
 * the function isn't deployed yet.
 */
async function getPerUserStats(): Promise<UserStats[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('admin_user_stats');

  if (error) {
    logEvent('verifications', 'admin-stats-rpc-error', { error: error.message });
    return getPerUserStatsFallback();
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
async function getPerUserStatsFallback(): Promise<UserStats[]> {
  const admin = createSupabaseAdminClient();
  const PAGE = 1000;
  const byUser = new Map<string, UserStats>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('verifications')
      .select('user_id, user_email, created_at, status, api_calls')
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
