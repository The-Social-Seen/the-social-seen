'use client'

import { useTransition } from 'react'
import { promoteFromWaitlist } from '@/app/(admin)/admin/actions'

interface PromoteButtonProps {
  bookingId: string
}

export default function PromoteButton({ bookingId }: PromoteButtonProps) {
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
      className="bg-gold hover:bg-gold-dark text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors disabled:opacity-50 min-h-[36px]"
    >
      {isPending ? 'Promoting...' : 'Promote'}
    </button>
  )
}
