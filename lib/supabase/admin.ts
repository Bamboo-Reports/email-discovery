import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. BYPASSES Row Level Security — server-only.
 * Never import this into a Client Component. Used by the admin dashboard to
 * read across all users' rows.
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Owner admins from the ADMIN_EMAILS env var (comma-separated). They can't be
 * demoted from the UI; admins granted in the dashboard live in app_admins —
 * use isAdmin() from lib/access for the full check.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}
