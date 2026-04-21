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
            // token from document.cookie. XSS → session theft is mitigated by
            // Content-Security-Policy headers (see next.config.ts), not httpOnly.
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
      .select('status')
      .eq('id', user.id)
      .single()

    if (profile?.status === 'banned') {
      await supabase.auth.signOut()
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/account-suspended'
      redirectUrl.search = ''
      return NextResponse.redirect(redirectUrl)
    }
  }

  // Forward pathname to root layout so it can conditionally render Header/Footer
  supabaseResponse.headers.set('x-pathname', pathname)

  return supabaseResponse
}
