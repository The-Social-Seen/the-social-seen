'use client'

import { useState, useTransition } from 'react'
import type { PastEventWithSnippet } from '@/lib/supabase/queries/events'
import PastEventCard from '@/components/events/PastEventCard'
import { loadMorePastEvents } from './actions'

/**
 * Append-only paginator for the past-events archive. Receives the
 * initial cursor from the server-rendered page; each click swaps in
 * the next page of events and advances the cursor. Stops rendering
 * itself when the cursor runs out.
 *
 * Not a Suspense boundary — the initial page is always SSR'd for SEO
 * + above-the-fold, and older events appearing via a Server Action
 * don't need to block paint.
 */
export default function PastEventsLoadMore({
  initialCursor,
}: {
  initialCursor: string | null
}) {
  const [appended, setAppended] = useState<PastEventWithSnippet[]>([])
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (cursor === null && appended.length === 0) {
    // Nothing more to show from the start — render nothing.
    return null
  }

  function handleClick() {
    if (!cursor) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await loadMorePastEvents(cursor!)
        setAppended((prev) => [...prev, ...result.events])
        setCursor(result.nextCursor)
      } catch (err) {
        console.error('[PastEventsLoadMore]', err)
        setError('Could not load more events. Please try again.')
      }
    })
  }

  return (
    <>
      {appended.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {appended.map((event) => (
            <PastEventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {cursor !== null && (
        <div className="mt-10 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleClick}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-full border border-gold bg-transparent px-8 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? 'Loading…' : 'Load more'}
          </button>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  )
}
