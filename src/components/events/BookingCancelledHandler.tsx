'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { abandonPendingCheckout } from '@/app/events/[slug]/actions'

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
 */
export default function BookingCancelledHandler({ eventId }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [showToast, setShowToast] = useState(false)

  const [fromClaim, setFromClaim] = useState(false)

  useEffect(() => {
    if (sp.get('cancelled') !== '1') return

    // If the user reached Stripe via a waitlist-claim flow (Stripe
    // redirects back with ?cancelled=1&from=claim on abandon), we want
    // to restore them to `waitlisted` rather than `cancelled` so they
    // keep their queue position for the next cancellation email.
    const isFromClaim = sp.get('from') === 'claim'
    setFromClaim(isFromClaim)

    let cancelled = false
    void (async () => {
      const result = await abandonPendingCheckout(
        eventId,
        isFromClaim ? { from: 'claim' } : { from: 'book' },
      )
      if (cancelled) return
      if (!result.success) {
        console.warn(
          '[BookingCancelledHandler] cleanup failed:',
          result.error,
        )
      }
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
      {fromClaim
        ? 'No charge made — you\u2019re still on the waitlist.'
        : 'Payment cancelled — no charge made. You can book again whenever you\u2019re ready.'}
    </div>
  )
}
