'use client'

import Script from 'next/script'
import { useTheme } from '@/components/layout/ThemeProvider'

/**
 * Cloudflare Turnstile widget for public forms.
 *
 * Renders the invisible challenge and writes the resulting token into a
 * hidden input named `cf-turnstile-response` (Cloudflare's default; the
 * server-side verifier in src/lib/turnstile/verify.ts reads this exact
 * field from FormData).
 *
 * The widget gracefully no-ops when the site key is unset — useful for
 * local development before the operator configures the env var. In that
 * case `cf-turnstile-response` is absent from the submission and the
 * server verifier falls through to fail-open (also with a Sentry warning
 * in production).
 */
export function TurnstileWidget() {
  const { theme } = useTheme()
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  if (!siteKey) return null

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        async
        defer
      />
      <div
        className="cf-turnstile"
        data-sitekey={siteKey}
        data-theme={theme === 'dark' ? 'dark' : 'light'}
        data-size="flexible"
      />
    </>
  )
}
