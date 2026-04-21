'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { readConsent, writeConsent } from '@/lib/analytics/consent'

/**
 * P2-8b — Cookie consent banner.
 *
 * Visible when no analytics decision has been recorded. Clicking
 * Accept or Decline writes to localStorage via `writeConsent`, which
 * also dispatches a custom event the PostHog provider listens for.
 *
 * Design intent:
 *   • Unobtrusive — footer-pinned, not a full-screen blocker.
 *   • No dark-pattern — Decline is visually equal to Accept (not
 *     hidden / greyed out).
 *   • Link to the Privacy Policy for detail.
 *
 * Strictly-necessary cookies (Supabase session, theme toggle) are NOT
 * gated — this banner governs analytics only. That's reflected in the
 * copy ("Help us improve").
 */
export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Show only when no decision has been recorded. Deferred to
    // `useEffect` so SSR output matches the first client render
    // regardless of localStorage state. The canonical post-hydration
    // pattern — lint rule flags setState-in-effect but the intent
    // here is exactly that: render nothing on first paint, reveal
    // after reading localStorage.
    const state = readConsent()
    if (state === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  function decide(state: 'granted' | 'denied') {
    writeConsent(state)
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-2xl rounded-2xl border border-border bg-bg-card p-5 shadow-lg md:left-auto md:right-6 md:bottom-6 md:max-w-md"
    >
      <p className="text-sm font-semibold text-text-primary">
        Help us improve The Social Seen
      </p>
      <p className="mt-1 text-xs text-text-primary/70">
        We&rsquo;d like to set an analytics cookie (PostHog, EU-hosted)
        to understand which events are working and where the site is
        slow. Strictly-necessary cookies for login are always on.
        Read our{' '}
        <Link
          href="/privacy"
          className="font-medium text-gold hover:text-gold-hover"
        >
          privacy policy
        </Link>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => decide('granted')}
          className="flex-1 rounded-full bg-gold px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-gold-dark"
        >
          Accept analytics
        </button>
        <button
          type="button"
          onClick={() => decide('denied')}
          className="flex-1 rounded-full border border-border px-4 py-2 text-xs font-medium text-text-primary transition-colors hover:bg-bg-secondary"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
