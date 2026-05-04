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
 */
import { NextResponse } from 'next/server'
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
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      new URL('/forgot-password?error=expired_link', url.origin),
    )
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
