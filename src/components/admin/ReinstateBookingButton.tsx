'use client'

import { useState, useTransition } from 'react'
import { reinstateCancelledBooking } from '@/app/(admin)/admin/actions'
import { cn } from '@/lib/utils/cn'

interface ReinstateBookingButtonProps {
  bookingId: string
  /** Set to true inside mobile card action rows so the button fills the row. */
  fullWidth?: boolean
}

/**
 * Gap C UI (SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md §4.8):
 * reinstates an eligible reaped `cancelled` booking on a paid event that
 * has room again, sending the member a fresh Stripe payment link.
 *
 * Mirrors PromoteButton's exact interaction pattern (useTransition, no
 * `confirm()` guard — this is a positive/additive action for the member,
 * not a destructive one) with one deliberate addition: an always-visible
 * caption before the first click, since "Reinstate" on a cancelled row is
 * a rarer, higher-stakes action than "Promote" worth one line of
 * explanation (UX-REVIEW-admin-reinstate-cancelled-booking.md §2.2 —
 * copy final).
 */
export default function ReinstateBookingButton({
  bookingId,
  fullWidth = false,
}: ReinstateBookingButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  function handleReinstate() {
    setSuccessMessage(null)
    startTransition(async () => {
      const result = await reinstateCancelledBooking(bookingId)
      if (result.error) {
        alert(result.error)
        return
      }
      setSuccessMessage(`Payment link emailed to ${result.memberName}`)
    })
  }

  return (
    <span className={cn('flex flex-col gap-0.5', fullWidth ? 'w-full' : 'inline-flex items-end')}>
      <button
        onClick={handleReinstate}
        disabled={isPending}
        className={cn(
          'bg-gold hover:bg-gold-dark text-white font-medium rounded-full transition-colors disabled:opacity-50',
          fullWidth
            ? 'w-full px-4 py-2.5 text-sm min-h-[44px]'
            : 'text-xs px-3 py-1.5 min-h-[44px] md:min-h-[36px]',
        )}
      >
        {isPending ? 'Reinstating...' : 'Reinstate'}
      </button>
      <span className={cn('text-[10px]', fullWidth && 'text-center', successMessage ? 'text-success' : 'text-text-tertiary')}>
        {successMessage ?? 'Emails a new payment link'}
      </span>
    </span>
  )
}
