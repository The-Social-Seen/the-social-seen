'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { abandonPendingCheckout } from '@/app/events/[slug]/actions'
import type { BookingStatus } from '@/types'

interface Props {
  eventId: string
}

/**
 * Mounted once on the event detail page. If the URL carries
 * `?cancelled=1` (set when Stripe redirects the user back from Checkout
 * after they hit "Back"), soft-cancel any lingering `pending_payment`
 * booking so the seat is freed immediately and the user can retry. Then
 * strip the query param from the URL so a refresh doesn't re-trigger
 * the message, and show a brief toast.
 *
 * Non-blocking: the page renders normally whether or not the cleanup
 * runs. Failure just logs to console — the worst case is the user
 * waits 30 min for Stripe's session expiry.
 *
 * Toast copy is chosen from `abandonPendingCheckout`'s RETURNED
 * `status` — the real, server-derived rollback outcome — not from the
 * `?from=` query param. `from` is still read and forwarded to the
 * Server Action purely as a diagnostics hint (see that function's own
 * security comment); it is untrusted client input and must never decide
 * what the user is told, or the toast could claim an outcome ("you're
 * still on the waitlist") that contradicts what the database actually
 * did.
 */
export default function BookingCancelledHandler({ eventId }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [showToast, setShowToast] = useState(false)
  const [resultStatus, setResultStatus] = useState<BookingStatus | undefined>(
    undefined,
  )

  useEffect(() => {
    if (sp.get('cancelled') !== '1') return

    // Stripe redirects back with ?cancelled=1&from=<value> on abandon.
    // Forwarded to the Server Action as a diagnostics hint only — it does
    // NOT determine the rollback status or the toast copy (both are
    // driven by the action's real, server-derived return value below).
    const fromParam = sp.get('from')
    const from:
      | 'book'
      | 'claim'
      | 'admin_hold'
      | 'admin_remediation'
      | 'admin_reinstate' =
      fromParam === 'claim' ||
      fromParam === 'admin_hold' ||
      fromParam === 'admin_remediation' ||
      fromParam === 'admin_reinstate'
        ? fromParam
        : 'book'

    let cancelled = false
    void (async () => {
      const result = await abandonPendingCheckout(eventId, { from })
      if (cancelled) return
      if (!result.success) {
        console.warn(
          '[BookingCancelledHandler] cleanup failed:',
          result.error,
        )
      }
      // The lint rule flags setState inside useEffect to discourage
      // render loops, but this is a one-shot mount-time async result — it
      // runs at most once per page load and has no dependency cycle.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResultStatus(result.status)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowToast(true)
      // Strip the ?cancelled=1 so a refresh doesn't re-trigger. Use
      // replace (not push) so the user's back button still works.
      const url = new URL(window.location.href)
      url.searchParams.delete('cancelled')
      url.searchParams.delete('from')
      router.replace(url.pathname + (url.search || ''))
      window.setTimeout(() => {
        if (!cancelled) setShowToast(false)
      }, 4000)
    })()

    return () => {
      cancelled = true
    }
    // `eventId`, `sp`, `router` are stable enough for this mount-time
    // effect; empty deps would run only once which is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!showToast) return null

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-blush/60 bg-bg-card px-5 py-3 text-sm text-text-primary shadow-lg"
    >
      {resultStatus === 'waitlisted'
        ? 'No charge made — you’re still on the waitlist.'
        : resultStatus === 'confirmed'
          ? 'No charge made — your spot is still confirmed. We’ll follow up about payment.'
          : 'Payment cancelled — no charge made. You can book again whenever you’re ready.'}
    </div>
  )
}
