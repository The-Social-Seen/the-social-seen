import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { buildCsp, CSP_NONCE_HEADER, generateNonce } from '@/lib/security/csp'

const PROTECTED_ROUTES = ['/profile', '/bookings', '/admin']

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )
}

export async function updateSession(request: NextRequest) {
  // Per-request CSP nonce (CL-8). Set on the REQUEST headers so
  // Server Components can read it via `next/headers` → `headers()`,
  // and on the RESPONSE `Content-Security-Policy` header so the
  // browser enforces it.
  const nonce = generateNonce()
  const isDev = process.env.NODE_ENV !== 'production'
  const csp = buildCsp(nonce, isDev)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(CSP_NONCE_HEADER, nonce)

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })
  // Set CSP up-front so every return path (including early redirects)
  // carries the policy. Subsequent recreations of `supabaseResponse`
  // inside the cookies.setAll callback re-apply it.
  supabaseResponse.headers.set('Content-Security-Policy', csp)

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
          request: { headers: requestHeaders },
        })
        supabaseResponse.headers.set('Content-Security-Policy', csp)
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, {
            ...options,
            // httpOnly must be false so createBrowserClient can read the
            // auth token from document.cookie. The compensating control
            // against XSS-driven cookie exfiltration is the per-request
            // nonce-based CSP set above: in production `script-src`
            // allows only `'self'` + a fresh nonce per request +
            // the third-party origin allowlist. Attacker-injected
            // `<script>` tags lack the nonce and are refused by the
            // browser. See `src/lib/security/csp.ts`.
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

  // Forward pathname to root layout so it can conditionally render
  // Header/Footer. Set on BOTH the request (so `next/headers` in Server
  // Components reads it) and the response (cheap telemetry for proxies).
  requestHeaders.set('x-pathname', pathname)
  supabaseResponse.headers.set('x-pathname', pathname)

  return supabaseResponse
}
