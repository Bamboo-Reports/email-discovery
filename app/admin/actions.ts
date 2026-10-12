'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/supabase/admin';
import { isAdmin, setAdmin, setBulkAccess } from '@/lib/access';
import { archiveUser, restoreUser } from '@/lib/users';

/** The signed-in admin's email; throws unless the caller is an admin. */
async function requireAdmin(): Promise<string> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !(await isAdmin(user.email))) throw new Error('forbidden');
  return user.email;
}

export async function toggleBulk(email: string, enabled: boolean) {
  await requireAdmin();
  await setBulkAccess(email, enabled);
  revalidatePath('/admin');
}

export async function archiveUserAction(email: string) {
  await requireAdmin();
  if (await isAdmin(email)) throw new Error('remove their admin access before archiving.');
  await archiveUser(email);
  revalidatePath('/admin');
}

export async function restoreUserAction(email: string) {
  await requireAdmin();
  await restoreUser(email);
  revalidatePath('/admin');
}

export async function setAdminAction(email: string, admin: boolean) {
  const me = await requireAdmin();
  if (isAdminEmail(email)) throw new Error('owners are set in ADMIN_EMAILS and can’t be changed here.');
  if (!admin && email.toLowerCase() === me.toLowerCase()) throw new Error('you can’t remove your own admin access.');
  await setAdmin(email, admin, me);
  revalidatePath('/admin');
  revalidatePath('/', 'layout');
}
