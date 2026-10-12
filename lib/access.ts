import { createSupabaseAdminClient, isAdminEmail } from './supabase/admin';
import { logEvent } from './log';

// ponytail: bulk is opt-in — a bulk_access row with enabled=true grants it.
// Admins always allowed. Reads/writes use the service-role client (server-only).
export async function canUseBulk(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  if (isAdminEmail(email)) return true;
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from('bulk_access')
    .select('enabled')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (data?.enabled) return true;
  // granted admins last: one extra lookup only for users without a bulk row
  return isAdmin(email);
}

export async function getEnabledBulkEmails(): Promise<Set<string>> {
  const db = createSupabaseAdminClient();
  const { data } = await db.from('bulk_access').select('email').eq('enabled', true);
  return new Set((data ?? []).map((r) => (r.email as string).toLowerCase()));
}

export async function setBulkAccess(email: string, enabled: boolean): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from('bulk_access')
    .upsert({ email: email.toLowerCase(), enabled, updated_at: new Date().toISOString() });
}

// --- Admins ---------------------------------------------------------------
// Owners come from ADMIN_EMAILS; everyone else is granted in app_admins
// (migration 0006). If the table is missing, only owners are admins.

/** Emails promoted to admin from the dashboard (excludes env owners). */
export async function getGrantedAdmins(): Promise<Set<string>> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.from('app_admins').select('email');
  if (error) {
    logEvent('access', 'admins-error', { error: error.message });
    return new Set();
  }
  return new Set((data ?? []).map((r) => (r.email as string).toLowerCase()));
}

export async function isAdmin(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  if (isAdminEmail(email)) return true;
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from('app_admins')
    .select('email')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error) {
    logEvent('access', 'admins-error', { error: error.message });
    return false;
  }
  return !!data;
}

export async function setAdmin(email: string, admin: boolean, grantedBy: string): Promise<void> {
  const db = createSupabaseAdminClient();
  const { error } = admin
    ? await db.from('app_admins').upsert({ email: email.toLowerCase(), granted_by: grantedBy.toLowerCase() })
    : await db.from('app_admins').delete().eq('email', email.toLowerCase());
  if (error) throw new Error(error.message);
}
