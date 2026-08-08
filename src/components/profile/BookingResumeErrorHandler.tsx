'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * Mounted on `/bookings`. If the URL carries `?resumeError=<message>` (set
 * by `GET /bookings/resume/[bookingId]` — src/app/(member)/bookings/resume/
 * [bookingId]/route.ts — when `resumePendingBookingCheckout` rejects a
 * resume attempt), show it as a toast and strip the param via
 * `router.replace()`. Mirrors `AccountDeletedHandler` /
 * `BookingCancelledHandler`'s "read a query param on mount, show a toast,
 * strip the param" pattern.
 *
 * This is the primary failure path the abandoned-checkout reminder email
 * exists to guard against: a member clicks "Complete Payment" from the
 * email at the wrong moment (booking already reaped, event cancelled, it's
 * an admin-hold row, etc.) and, without this handler, was silently bounced
 * back to `/bookings` with zero explanation.
 *
 * Every value `resumePendingBookingCheckout` can put in `resumeError` is
 * static, pre-written app copy (see src/lib/bookings/resume-checkout.ts and
 * the route handler's fallback) — never raw user input, Stripe error text,
 * or Postgres error detail — so it's safe to render directly as text
 * content.
 */
export default function BookingResumeErrorHandler() {
  const router = useRouter()
  const sp = useSearchParams()
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const resumeError = sp.get('resumeError')
    if (!resumeError) return

    // The lint rule flags setState inside useEffect to discourage render
    // loops, but this is a one-shot mount-time read of a URL param — the
    // setter runs at most once per page load and has no dependency cycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessage(resumeError)

    // Strip ?resumeError so a refresh doesn't re-trigger the toast. Use
    // replace (not push) so the user's back button still works.
    const url = new URL(window.location.href)
    url.searchParams.delete('resumeError')
    router.replace(url.pathname + (url.search || ''))

    const timer = window.setTimeout(() => setMessage(null), 5000)
    return () => window.clearTimeout(timer)
    // `sp`, `router` are stable enough for this mount-time effect; empty
    // deps would run only once which is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!message) return null

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-blush/60 bg-bg-card px-5 py-3 text-sm text-text-primary shadow-lg"
    >
      {message}
    </div>
  )
}
