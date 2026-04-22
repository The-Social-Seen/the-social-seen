import Link from 'next/link'
import type { Metadata } from 'next'
import { getPastEvents } from '@/lib/supabase/queries/events'
import { canonicalUrl } from '@/lib/utils/site'
import PastEventCard from '@/components/events/PastEventCard'
import PastEventsLoadMore from './LoadMore'

export const metadata: Metadata = {
  title: 'Past Events — The Social Seen',
  description:
    'A look back at recent events — what we ran, what people said. Browse the archive to get a feel for The Social Seen before booking your first.',
  alternates: { canonical: canonicalUrl('/events/past') },
}

export default async function PastEventsPage() {
  const { events, nextCursor } = await getPastEvents()

  return (
    <main className="min-h-screen bg-bg-primary">
      <section className="border-b border-blush/40 bg-bg-card pt-16 sm:pt-20">
        <div className="mx-auto max-w-7xl px-6 py-12 md:py-16">
          <p className="mb-3 font-sans text-sm font-medium uppercase tracking-[0.2em] text-gold">
            Archive
          </p>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-text-primary md:text-5xl">
            Past Events
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-text-primary/60">
            A look back at recent gatherings — venues, who came, what people
            said. Browse the archive to get a feel for The Social Seen before
            booking your first.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-12 md:py-16">
        {events.length === 0 ? (
          <div className="rounded-xl border border-border bg-bg-card p-12 text-center">
            <p className="text-text-secondary">
              No past events yet — the archive fills up as soon as our first
              gathering wraps.
            </p>
            <Link
              href="/events"
              className="mt-4 inline-block font-medium text-gold underline-offset-2 hover:underline"
            >
              See upcoming events &rarr;
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {events.map((event) => (
                <PastEventCard key={event.id} event={event} />
              ))}
            </div>
            <PastEventsLoadMore initialCursor={nextCursor} />
          </>
        )}
      </section>
    </main>
  )
}
