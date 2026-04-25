'use client'

import { useTransition } from 'react'
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

  function handlePromote() {
    startTransition(async () => {
      const result = await promoteFromWaitlist(bookingId)
      if (result.error) {
        alert(result.error)
      }
    })
  }

  return (
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
  )
}
