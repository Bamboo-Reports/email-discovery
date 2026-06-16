import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/supabase/admin';

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
  const admin = isAdminEmail(user.email);

  return (
    <nav className="appnav">
      <div className="appnav-links">
        <Link href="/" className="appnav-brand">email workbench</Link>
        <Link href="/" className="appnav-link">workbench</Link>
        <Link href="/history" className="appnav-link">history</Link>
        {admin && <Link href="/admin" className="appnav-link">admin</Link>}
      </div>
      <div className="appnav-user">
        <span className="appnav-email">{user.email}</span>
        <form action="/auth/signout" method="post">
          <button type="submit" className="btn ghost">sign out</button>
        </form>
      </div>
    </nav>
  );
}
