'use client'

import { useState, useTransition } from 'react'
import { sendPaymentLinkForConfirmedBooking } from '@/app/(admin)/admin/actions'
import { cn } from '@/lib/utils/cn'

interface SendPaymentLinkButtonProps {
  bookingId: string
  /** Set to true inside mobile card action rows so the button fills the row. */
  fullWidth?: boolean
}

/**
 * Gap A remediation UI (SYSTEM-DESIGN-admin-waitlist-promotion-payment.md,
 * Addendum §C.2): sends a real Stripe payment link to a member whose
 * booking is `status='confirmed'` on a paid event but was never actually
 * charged (`stripe_payment_id IS NULL`) — the production incident
 * `sendPaymentLinkForConfirmedBooking` remediates (Amy Sangam / Yasemin
 * Salp, 2026-07-13).
 *
 * Mirrors PromoteButton's pattern exactly: useTransition, alert() on
 * failure, an inline text-success message on success.
 */
export default function SendPaymentLinkButton({
  bookingId,
  fullWidth = false,
}: SendPaymentLinkButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  function handleSend() {
    setSuccessMessage(null)
    startTransition(async () => {
      const result = await sendPaymentLinkForConfirmedBooking(bookingId)
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
        onClick={handleSend}
        disabled={isPending}
        className={cn(
          'bg-gold hover:bg-gold-dark text-white font-medium rounded-full transition-colors disabled:opacity-50',
          fullWidth
            ? 'w-full px-4 py-2.5 text-sm min-h-[44px]'
            : 'text-xs px-3 py-1.5 min-h-[44px] md:min-h-[36px]',
        )}
      >
        {isPending ? 'Sending...' : 'Send Payment Link'}
      </button>
      {successMessage && (
        <span className={cn('text-[10px] text-success', fullWidth && 'text-center')}>
          {successMessage}
        </span>
      )}
    </span>
  )
}
