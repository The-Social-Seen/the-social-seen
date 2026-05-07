/**
 * PKCE exchange handler for Supabase auth flows that arrive via email link
 * (currently only password recovery; OAuth/social login would land here too
 * if added later).
 *
 * Why this exists: `@supabase/ssr` uses the PKCE flow, so the recovery email
 * link routes through Supabase's /auth/v1/verify endpoint and 302s back here
 * with `?code=…`. The code must be exchanged server-side via
 * `exchangeCodeForSession` to mint the session cookie before the user can
 * actually update their password on /reset-password. Pointing
 * `resetPasswordForEmail`'s `redirectTo` straight at /reset-password skips
 * this step and leaves the user without a recovery session.
 *
 * Observability: thrown errors from the SDK exchange (e.g. Supabase 5xx,
 * network failures) are reported to Sentry as warnings — the user gets a
 * clean redirect, but ops still need visibility into auth-side flakiness.
 */
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createServerClient } from '@/lib/supabase/server'
import { sanitizeRedirectPath } from '@/lib/utils/redirect'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = sanitizeRedirectPath(
    url.searchParams.get('next'),
    '/reset-password',
  )

  if (!code) {
    return NextResponse.redirect(
      new URL('/forgot-password?error=expired_link', url.origin),
    )
  }

  const supabase = await createServerClient()

  // Network failures or Supabase 5xx can cause the SDK to throw rather than
  // return { error }. Catch both rejection paths so the user gets the same
  // actionable expired-link redirect instead of a 500 — a 500 on a
  // password-recovery click is a dead-end since the email is single-use.
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(
        new URL('/forgot-password?error=expired_link', url.origin),
      )
    }
  } catch (err) {
    // Capture in Sentry for ops visibility, but defensively wrap the
    // captureException itself — a Sentry misconfig must never crash the
    // recovery flow. Level is 'warning' (not 'error') because the user
    // gets a clean actionable redirect; this is a logged anomaly, not an
    // unhandled crash. `hadCode` lets triagers tell "exchange threw" from
    // "missing code" without us logging the single-use code itself.
    try {
      Sentry.captureException(err, {
        tags: { surface: 'auth-callback-pkce' },
        level: 'warning',
        extra: { hadCode: typeof code === 'string' && code.length > 0 },
      })
    } catch {
      // Don't let Sentry misconfig crash the recovery flow.
    }
    return NextResponse.redirect(
      new URL('/forgot-password?error=expired_link', url.origin),
    )
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
