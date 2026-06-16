'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/supabase/admin';
import { setBulkAccess } from '@/lib/access';

export async function toggleBulk(email: string, enabled: boolean) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email)) throw new Error('forbidden');
  await setBulkAccess(email, enabled);
  revalidatePath('/admin');
}
