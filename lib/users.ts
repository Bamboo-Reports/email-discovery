import { createSupabaseAdminClient } from './supabase/admin';
import { logEvent } from './log';

/**
 * Login accounts (Supabase auth users) for the admin team table.
 * "Archived" = banned in Supabase Auth: sign-in is refused and the middleware
 * signs out any live session, but the user's rows and history are untouched.
 * Service-role client — callers MUST verify the requester is an admin first.
 */

// Effectively permanent; restoring sets ban_duration back to 'none'.
const ARCHIVE_BAN = '876000h'; // ~100 years

export interface AuthAccount {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  archived: boolean;
}

export function isArchived(bannedUntil: string | null | undefined): boolean {
  return !!bannedUntil && Date.parse(bannedUntil) > Date.now();
}

/** Every login account, keyed by lower-cased email. */
export async function getAuthAccounts(): Promise<Map<string, AuthAccount>> {
  const admin = createSupabaseAdminClient();
  const PER_PAGE = 1000;
  const out = new Map<string, AuthAccount>();

  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) {
      logEvent('users', 'list-error', { error: error.message });
      break;
    }
    for (const u of data.users) {
      if (!u.email) continue;
      out.set(u.email.toLowerCase(), {
        id: u.id,
        email: u.email.toLowerCase(),
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        archived: isArchived(u.banned_until),
      });
    }
    if (data.users.length < PER_PAGE) break;
  }
  return out;
}

async function findAccountId(email: string): Promise<string> {
  const account = (await getAuthAccounts()).get(email.toLowerCase());
  if (!account) throw new Error(`no login account for ${email}`);
  return account.id;
}

/** Block sign-in for a user. Their verification history is kept. */
export async function archiveUser(email: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.updateUserById(await findAccountId(email), {
    ban_duration: ARCHIVE_BAN,
  });
  if (error) throw new Error(error.message);
  logEvent('users', 'archive', { email });
}

/** Re-enable sign-in for an archived user. */
export async function restoreUser(email: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.updateUserById(await findAccountId(email), {
    ban_duration: 'none',
  });
  if (error) throw new Error(error.message);
  logEvent('users', 'restore', { email });
}
