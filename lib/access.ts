import { createSupabaseAdminClient, isAdminEmail } from './supabase/admin';

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
  return !!data?.enabled;
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
