'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy } from 'lucide-react'
import { duplicateEvent } from '@/app/(admin)/admin/actions'

interface DuplicateEventButtonProps {
  eventId: string
}

export default function DuplicateEventButton({
  eventId,
}: DuplicateEventButtonProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (
      !confirm(
        'Duplicate this event as a new draft? The copy will be scheduled 1 week later and unpublished — edit it before sharing.',
      )
    ) {
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await duplicateEvent(eventId)
      if ('error' in result) {
        setError(result.error)
        return
      }
      router.push(`/admin/events/${result.event.id}`)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-bg-card hover:bg-bg-secondary transition-colors text-sm font-medium text-text-primary disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
      >
        <Copy className="w-4 h-4" />
        {isPending ? 'Duplicating…' : 'Duplicate Event'}
      </button>
      {error && (
        <p className="text-sm text-red-600 mt-2" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
