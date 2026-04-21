import Link from 'next/link'
import Image from 'next/image'
import { Star } from 'lucide-react'
import type { Metadata } from 'next'
import { getPastEvents } from '@/lib/supabase/queries/events'
import { formatDateCard } from '@/lib/utils/dates'
import { resolveEventImage } from '@/lib/utils/images'
import { categoryLabel } from '@/types'

export const metadata: Metadata = {
  title: 'Past Events — The Social Seen',
  description:
    'A look back at recent events — what we ran, what people said. Browse the archive to get a feel for The Social Seen before booking your first.',
}

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={
            i < rating
              ? 'h-3.5 w-3.5 fill-gold text-gold'
              : 'h-3.5 w-3.5 fill-none text-text-tertiary/40'
          }
        />
      ))}
    </div>
  )
}

export default async function PastEventsPage() {
  const events = await getPastEvents()

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
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => {
              const imgSrc = resolveEventImage(event.image_url)
              return (
              <Link
                key={event.id}
                href={`/events/${event.slug}`}
                className="group flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card transition-colors hover:border-gold/40"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-bg-secondary">
                  {imgSrc ? (
                    <Image
                      src={imgSrc}
                      alt={event.title}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : null}
                  <div className="absolute right-3 top-3 rounded-full bg-charcoal/70 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                    {formatDateCard(event.date_time)}
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-gold/20 px-2.5 py-0.5 text-xs font-medium text-gold">
                      {categoryLabel(event.category)}
                    </span>
                    {event.review_count > 0 && (
                      <span className="flex items-center gap-1 text-xs text-text-secondary">
                        <Star className="h-3 w-3 fill-gold text-gold" />
                        {event.avg_rating.toFixed(1)} · {event.review_count}{' '}
                        review{event.review_count === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>

                  <h2 className="font-serif text-xl font-semibold text-text-primary group-hover:text-gold">
                    {event.title}
                  </h2>

                  <p className="text-sm text-text-secondary line-clamp-2">
                    {event.short_description}
                  </p>

                  {event.top_review ? (
                    <figure className="mt-auto rounded-lg bg-cream/40 p-4">
                      <StarRow rating={event.top_review.rating} />
                      <blockquote className="mt-2 text-sm italic text-text-primary line-clamp-3">
                        &ldquo;{event.top_review.review_text}&rdquo;
                      </blockquote>
                      <figcaption className="mt-2 text-xs font-medium text-text-tertiary">
                        — {event.top_review.author_name}
                      </figcaption>
                    </figure>
                  ) : (
                    <p className="mt-auto text-xs text-text-tertiary">
                      No reviews yet for this one.
                    </p>
                  )}
                </div>
              </Link>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
