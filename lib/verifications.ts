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
  const { data, error } = await admin
    .from('verifications')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    logEvent('verifications', 'admin-error', { error: error.message });
    return {
      totalVerifications: 0,
      totalDiscovered: 0,
      totalApiCalls: 0,
      distinctUsers: 0,
      perUser: [],
      recent: [],
    };
  }

  const rows = (data ?? []) as VerificationRow[];
  const byUser = new Map<string, UserStats>();
  let totalApiCalls = 0;
  let totalDiscovered = 0;

  for (const r of rows) {
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

    totalApiCalls += r.api_calls ?? 0;
    if (r.status === 'valid' || r.status === 'accept-all') totalDiscovered++;
  }

  const perUser: UserStats[] = Array.from(byUser.values()).sort((a, b) => b.total - a.total);

  return {
    totalVerifications: rows.length,
    totalDiscovered,
    totalApiCalls,
    distinctUsers: byUser.size,
    perUser,
    recent: rows.slice(0, 50),
  };
}
