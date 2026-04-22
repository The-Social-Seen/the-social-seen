import Link from 'next/link'
import Image from 'next/image'
import { Star } from 'lucide-react'
import { formatDateCard } from '@/lib/utils/dates'
import { resolveEventImage } from '@/lib/utils/images'
import { categoryLabel } from '@/types'
import type { PastEventWithSnippet } from '@/lib/supabase/queries/events'

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

/**
 * Card for the `/events/past` archive listing. Shared between the
 * server-rendered first page and the client-appended subsequent
 * pages so markup stays identical.
 *
 * Cancelled events render at muted opacity with a "Cancelled" badge
 * overlay — they're in the archive for transparency (an attendee
 * looking for an event they booked shouldn't find the entry missing)
 * but visually deprioritised vs ran-as-planned events.
 */
export default function PastEventCard({
  event,
}: {
  event: PastEventWithSnippet
}) {
  const imgSrc = resolveEventImage(event.image_url)
  const cancelled = event.is_cancelled

  return (
    <Link
      href={`/events/${event.slug}`}
      className={
        'group flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card transition-colors hover:border-gold/40 ' +
        (cancelled ? 'opacity-80' : '')
      }
      aria-label={cancelled ? `${event.title} — Cancelled` : event.title}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-bg-secondary">
        {imgSrc ? (
          <Image
            src={imgSrc}
            alt={event.title}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
            className={
              'object-cover transition-transform duration-500 group-hover:scale-105 ' +
              (cancelled ? 'grayscale' : '')
            }
          />
        ) : null}
        <div className="absolute right-3 top-3 rounded-full bg-charcoal/70 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {formatDateCard(event.date_time)}
        </div>
        {cancelled && (
          <div className="absolute left-3 top-3 rounded-full bg-danger/90 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
            Cancelled
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-gold/20 px-2.5 py-0.5 text-xs font-medium text-gold">
            {categoryLabel(event.category)}
          </span>
          {!cancelled && event.review_count > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-secondary">
              <Star aria-hidden="true" className="h-3 w-3 fill-gold text-gold" />
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

        {cancelled ? (
          <p className="mt-auto text-xs text-text-tertiary">
            This event was cancelled — attendees were refunded in full.
          </p>
        ) : event.top_review ? (
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
}
