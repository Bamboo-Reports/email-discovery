import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canUseBulk, isAdmin } from '@/lib/access';
import {
  RiHistoryLine,
  RiMailCheckFill,
  RiSearchEyeLine,
  RiShieldUserLine,
} from '@remixicon/react';
import { AccountMenu } from './AccountMenu';

/**
 * Top navigation. Server component — renders nothing for signed-out visitors
 * (e.g. the /login page), otherwise shows the user and section links.
 */
export async function NavBar() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  const [admin, bulkEnabled] = await Promise.all([isAdmin(user.email), canUseBulk(user.email)]);

  return (
    <nav className="appnav">
      <div className="appnav-links">
        <Link href="/" className="appnav-brand">
          <span className="appnav-logo"><RiMailCheckFill size={16} aria-hidden="true" /></span>
          email workbench
        </Link>
        <Link href="/" className="appnav-link"><RiSearchEyeLine size={16} aria-hidden="true" />workbench</Link>
        <Link href="/history" className="appnav-link"><RiHistoryLine size={16} aria-hidden="true" />history</Link>
        {admin && <Link href="/admin" className="appnav-link"><RiShieldUserLine size={16} aria-hidden="true" />admin</Link>}
      </div>
      <AccountMenu email={user.email ?? ''} isAdmin={admin} bulkEnabled={bulkEnabled} />
    </nav>
  );
}
