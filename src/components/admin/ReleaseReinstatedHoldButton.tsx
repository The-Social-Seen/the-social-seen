'use client'

import { useState, useTransition } from 'react'
import { releaseReinstatedHold } from '@/app/(admin)/admin/actions'
import { cn } from '@/lib/utils/cn'

interface ReleaseReinstatedHoldButtonProps {
  bookingId: string
  /** Set to true inside mobile card action rows so the button fills the row. */
  fullWidth?: boolean
}

/**
 * Gap C UI (SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md §4.8):
 * manually releases an active cancelled-reinstatement `pending_payment`
 * hold back to `cancelled` if the member doesn't pay.
 *
 * Mirrors DemoteHoldButton's pattern exactly (useTransition, alert() on
 * failure, an inline text-success message on success, native confirm()
 * guard retained per architect §4.8/§8 item 2 and UX §2.3 — this action
 * fully cancels a spot the member was just given back, at least as
 * consequential as demoting to waitlist).
 *
 * Copy final — UX-REVIEW-admin-reinstate-cancelled-booking.md §2.3.
 * "Cancel Reinstatement" names the action from the admin's own mental
 * model (undo what I just did), matching DemoteHoldButton's convention
 * of naming the label after the destination where that reads naturally.
 */
export default function ReleaseReinstatedHoldButton({
  bookingId,
  fullWidth = false,
}: ReleaseReinstatedHoldButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  function handleRelease() {
    const confirmed = confirm(
      'Cancel this reinstatement? Their payment link will stop working and the spot will go back to cancelled.',
    )
    if (!confirmed) return

    setSuccessMessage(null)
    startTransition(async () => {
      const result = await releaseReinstatedHold(bookingId)
      if (result.error) {
        alert(result.error)
        return
      }
      setSuccessMessage(`${result.memberName} returned to cancelled`)
    })
  }

  return (
    <span className={cn('flex flex-col gap-0.5', fullWidth ? 'w-full' : 'inline-flex items-end')}>
      <button
        onClick={handleRelease}
        disabled={isPending}
        className={cn(
          'border font-medium rounded-full transition-colors disabled:opacity-50 border-danger/30 text-danger hover:bg-danger/5',
          fullWidth
            ? 'w-full px-4 py-2.5 text-sm min-h-[44px]'
            : 'text-xs px-3 py-1.5 min-h-[44px] md:min-h-[36px]',
        )}
      >
        {isPending ? 'Cancelling...' : 'Cancel Reinstatement'}
      </button>
      {successMessage && (
        <span className={cn('text-[10px] text-success', fullWidth && 'text-center')}>
          {successMessage}
        </span>
      )}
    </span>
  )
}
