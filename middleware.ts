import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PATHS = ['/login', '/auth'];

/**
 * Refreshes the Supabase session cookie on every request and gates access:
 * unauthenticated users are redirected to /login (except for public paths).
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user: sessionUser },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Archived users (banned by an admin) lose access immediately: drop the
  // session and treat them as signed out. History rows are kept.
  const archived = !!sessionUser?.banned_until && Date.parse(sessionUser.banned_until) > Date.now();
  const user = archived ? null : sessionUser;
  if (archived) {
    await supabase.auth.signOut();
    if (!pathname.startsWith('/api/') && pathname !== '/login') {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '?archived=1';
      const redirect = NextResponse.redirect(url);
      // carry over the cleared auth cookies
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  // API routes: respond with 401 JSON rather than redirecting to an HTML page.
  if (!user && pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'you’re signed out. sign in again.' }, { status: 401 });
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Logged-in users shouldn't sit on the login page.
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
