import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canUseBulk } from '@/lib/access';
import { Workbench } from './workbench';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const bulkEnabled = await canUseBulk(user?.email);
  return <Workbench bulkEnabled={bulkEnabled} />;
}
