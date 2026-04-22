'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy } from 'lucide-react'
import { duplicateEvent } from '@/app/(admin)/admin/actions'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface DuplicateEventButtonProps {
  eventId: string
}

export default function DuplicateEventButton({
  eventId,
}: DuplicateEventButtonProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  async function handleConfirm() {
    setError(null)
    const result = await duplicateEvent(eventId)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setDialogOpen(false)
    router.push(`/admin/events/${result.event.id}`)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-bg-card hover:bg-bg-secondary transition-colors text-sm font-medium text-text-primary min-h-[44px]"
      >
        <Copy className="w-4 h-4" />
        Duplicate Event
      </button>
      {error && (
        <p className="text-sm text-red-600 mt-2" role="alert">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Duplicate this event?"
        description={
          <p>
            The copy will be created as an unpublished draft scheduled
            one week later than the original. Edit the copy (date, slug,
            hosts) before publishing.
          </p>
        }
        confirmLabel="Duplicate"
        onConfirm={handleConfirm}
      />
    </>
  )
}
