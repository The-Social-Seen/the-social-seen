'use client'

import { useState, useTransition } from 'react'
import { demoteAdminHold } from '@/app/(admin)/admin/actions'
import { cn } from '@/lib/utils/cn'

interface DemoteHoldButtonProps {
  bookingId: string
  /** Set to true inside mobile card action rows so the button fills the row. */
  fullWidth?: boolean
}

/**
 * Gap B UI (SYSTEM-DESIGN-admin-waitlist-promotion-payment.md, Addendum
 * §C.2): manually releases an active `pending_payment` admin hold back to
 * `waitlisted` when the member doesn't pay — a stand-in for the
 * still-deferred 4h auto-revert cron. Origin-agnostic: works identically
 * whether the hold came from a waitlist promotion or a confirmed-booking
 * payment remediation.
 *
 * Mirrors PromoteButton's pattern exactly (useTransition, alert() on
 * failure, an inline text-success message on success), with one addition:
 * a native confirm() guard, since demoting is more consequential than
 * promoting — it kills a live payment link and reverses a member's status.
 */
export default function DemoteHoldButton({
  bookingId,
  fullWidth = false,
}: DemoteHoldButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  function handleDemote() {
    const confirmed = confirm(
      'Move this person back to the waitlist? Their payment link will stop working.',
    )
    if (!confirmed) return

    setSuccessMessage(null)
    startTransition(async () => {
      const result = await demoteAdminHold(bookingId)
      if (result.error) {
        alert(result.error)
        return
      }
      setSuccessMessage(`${result.memberName} moved back to waitlist`)
    })
  }

  return (
    <span className={cn('flex flex-col gap-0.5', fullWidth ? 'w-full' : 'inline-flex items-end')}>
      <button
        onClick={handleDemote}
        disabled={isPending}
        className={cn(
          'border font-medium rounded-full transition-colors disabled:opacity-50 border-danger/30 text-danger hover:bg-danger/5',
          fullWidth
            ? 'w-full px-4 py-2.5 text-sm min-h-[44px]'
            : 'text-xs px-3 py-1.5 min-h-[44px] md:min-h-[36px]',
        )}
      >
        {isPending ? 'Moving...' : 'Move to Waitlist'}
      </button>
      {successMessage && (
        <span className={cn('text-[10px] text-success', fullWidth && 'text-center')}>
          {successMessage}
        </span>
      )}
    </span>
  )
}
