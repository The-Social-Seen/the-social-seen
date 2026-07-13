'use client'

import { useState, useTransition } from 'react'
import { promoteFromWaitlist } from '@/app/(admin)/admin/actions'
import { cn } from '@/lib/utils/cn'

interface PromoteButtonProps {
  bookingId: string
  /** Set to true inside mobile card action rows so the button fills the row. */
  fullWidth?: boolean
}

export default function PromoteButton({
  bookingId,
  fullWidth = false,
}: PromoteButtonProps) {
  const [isPending, startTransition] = useTransition()
  // Paid promotions don't confirm a seat outright — they email a Stripe
  // payment link and hold it as pending_payment. Without this, the button
  // just goes back to "Promote" with no signal that anything happened, and
  // the admin has to check the Payment column or the recipient's inbox to
  // know whether a link actually went out.
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  function handlePromote() {
    setSuccessMessage(null)
    startTransition(async () => {
      const result = await promoteFromWaitlist(bookingId)
      if (result.error) {
        alert(result.error)
        return
      }
      setSuccessMessage(
        result.status === 'pending_payment'
          ? `Payment link emailed to ${result.promotedName}`
          : `${result.promotedName} confirmed`,
      )
    })
  }

  return (
    <span className={cn('flex flex-col gap-0.5', fullWidth ? 'w-full' : 'inline-flex items-end')}>
      <button
        onClick={handlePromote}
        disabled={isPending}
        className={cn(
          'bg-gold hover:bg-gold-dark text-white font-medium rounded-full transition-colors disabled:opacity-50',
          fullWidth
            ? 'w-full px-4 py-2.5 text-sm min-h-[44px]'
            : 'text-xs px-3 py-1.5 min-h-[44px] md:min-h-[36px]',
        )}
      >
        {isPending ? 'Promoting...' : 'Promote'}
      </button>
      {successMessage && (
        <span className={cn('text-[10px] text-success', fullWidth && 'text-center')}>
          {successMessage}
        </span>
      )}
    </span>
  )
}
