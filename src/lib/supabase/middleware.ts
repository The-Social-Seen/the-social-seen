import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED_ROUTES = ['/profile', '/bookings', '/admin']

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    // Env vars are missing — redirect all protected-route requests to /login?error=configuration.
    // Silently passing through would allow unauthenticated users to reach /admin.
    if (isProtectedRoute(request.nextUrl.pathname)) {
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/login'
      redirectUrl.searchParams.set('error', 'configuration')
      return NextResponse.redirect(redirectUrl)
    }
    return supabaseResponse
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = NextResponse.next({
          request,
        })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, {
            ...options,
            // httpOnly must be false so createBrowserClient can read the auth
            // token from document.cookie.
            //
            // ⚠ The CSP shipped in next.config.ts currently allows
            // `'unsafe-inline'` in script-src (for the inline theme-
            // detection script in app/layout.tsx), so it does NOT
            // meaningfully block XSS-driven cookie exfiltration yet.
            // Tracked in docs/FOLLOW-UPS.md → "Migrate CSP script-src
            // to nonce-based". Until that lands, treat this cookie
            // as XSS-exposed and weight any pending XSS findings
            // accordingly.
            httpOnly: false,
          })
        )
      },
    },
  })

  // Refresh the session — do NOT remove this line.
  // It refreshes the auth token if expired and syncs cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && isProtectedRoute(pathname)) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // P2-8a: banned-user enforcement.
  //
  // When an admin bans a member (profiles.status = 'banned'), we want
  // that to take effect on their next request without having to wait
  // for the Supabase session cookie to expire. We:
  //   1. Read the status column for the authenticated user.
  //   2. If banned, sign them out (revokes cookies) and redirect to
  //      /account-suspended. Any further request is handled as
  //      unauthenticated until they log back in, at which point this
  //      check fires again.
  //
  // Done in middleware rather than layout/page so it catches BOTH
  // protected and public routes (a banned user shouldn't be able to
  // maintain a session by hitting the landing page either).
  //
  // Suspended users are NOT signed out — they can browse events, just
  // not book. That gate is in the booking RPCs.
  //
  // Skipped on /account-suspended itself to avoid a redirect loop if
  // the cookie hasn't cleared yet.
  if (user && pathname !== '/account-suspended') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('status, deleted_at')
      .eq('id', user.id)
      .single()

    if (profile?.status === 'banned') {
      await supabase.auth.signOut()
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/account-suspended'
      redirectUrl.search = ''
      return NextResponse.redirect(redirectUrl)
    }

    // Defence-in-depth for deleted accounts (Phase 2.5 Batch 2):
    // The GDPR delete flow calls `auth.signOut()` and redirects to
    // `/?account_deleted=1`. If that sign-out call silently fails (rare
    // but possible — network hiccup between app and auth.supabase.co),
    // the session cookie survives and the user keeps navigating with
    // an account that no longer exists server-side. This catch-all
    // revokes the session on the next request.
    //
    // `profile.status` does NOT flip on delete, so the ban check above
    // doesn't cover this path. Separate check, same outcome.
    if (profile?.deleted_at) {
      await supabase.auth.signOut()
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/'
      redirectUrl.search = 'account_deleted=1'
      return NextResponse.redirect(redirectUrl)
    }
  }

  // Forward pathname to root layout so it can conditionally render Header/Footer
  supabaseResponse.headers.set('x-pathname', pathname)

  return supabaseResponse
}
