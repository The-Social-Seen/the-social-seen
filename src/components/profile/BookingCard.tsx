'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Calendar, CalendarPlus, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { resolveEventImage } from '@/lib/utils/images'
import { formatDateCard, formatTime, isWithin48Hours } from '@/lib/utils/dates'
import { downloadIcsFile } from '@/lib/utils/calendar'
import { categoryLabel } from '@/types'
import type { BookingWithEvent } from '@/types'
import ShareActions from '@/components/shared/ShareActions'

interface BookingCardProps {
  booking: BookingWithEvent
  variant: 'upcoming' | 'past' | 'waitlisted'
  /** Whether this past booking is eligible for a review */
  isReviewable?: boolean
  /** Callback when "Leave a Review" is clicked */
  onReviewClick?: () => void
}

export function BookingCard({ booking, variant, isReviewable, onReviewClick }: BookingCardProps) {
  const { event } = booking
  const imageUrl = resolveEventImage(event.image_url)
  const isSoon = variant === 'upcoming' && isWithin48Hours(event.date_time)

  return (
    <div
      className={cn(
        'group overflow-hidden rounded-xl border bg-bg-card shadow-sm transition-all hover:shadow-md',
        isSoon
          ? 'border-gold/30 ring-2 ring-gold/20'
          : 'border-border',
      )}
    >
      <div className="flex flex-col sm:flex-row">
        {/* Image */}
        <div className="relative h-44 w-full flex-shrink-0 overflow-hidden sm:h-auto sm:w-40">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={event.title}
              fill
              sizes="(max-width: 640px) 100vw, 160px"
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full min-h-[100px] w-full items-center justify-center bg-bg-secondary">
              <Calendar className="h-8 w-8 text-text-tertiary/30" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col justify-between p-4 sm:p-5">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-gold/20 px-2.5 py-0.5 text-xs font-medium text-gold">
                {categoryLabel(event.category)}
              </span>
              <StatusBadge status={booking.status} waitlistPosition={booking.waitlist_position} />
            </div>

            <h3 className="mb-1.5 font-serif text-base font-bold text-text-primary sm:text-lg">
              <Link href={`/events/${event.slug}`} className="hover:text-gold transition-colors">
                {event.title}
              </Link>
            </h3>

            <div className="space-y-1 text-xs text-text-tertiary">
              <p className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                {formatDateCard(event.date_time)} &middot; {formatTime(event.date_time)}
              </p>
              <p className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                {event.venue_name}
              </p>
            </div>

            {/* Amendment 5.3: upcoming within 48h microcopy */}
            {isSoon && (
              <p className="mt-2 text-xs font-medium text-gold">
                {formatSoonLabel(event.date_time)} &mdash; see you there!
              </p>
            )}

            {/* Waitlisted positive copy */}
            {variant === 'waitlisted' && (
              <p className="mt-2 text-xs text-text-tertiary">
                Most waitlisted members get a spot &mdash; we&rsquo;ll let you know the moment one opens.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link
              href={`/events/${event.slug}`}
              className="text-xs font-medium text-gold transition-colors hover:text-gold-hover"
            >
              View Event
            </Link>
            {variant === 'upcoming' && booking.status === 'confirmed' && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    downloadIcsFile({
                      title: event.title,
                      dateTime: event.date_time,
                      endTime: event.end_time,
                      venueName: event.venue_name,
                      venueAddress: event.venue_address,
                      shortDescription: event.short_description,
                      slug: event.slug,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-blush/60 px-3 py-1 text-xs font-medium text-text-primary transition-colors hover:bg-bg-primary"
                  aria-label={`Add ${event.title} to your calendar`}
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                  Add to calendar
                </button>
                <ShareActions
                  eventTitle={event.title}
                  eventSlug={event.slug}
                  variant="compact"
                />
              </>
            )}
            {variant === 'past' && isReviewable && onReviewClick && (
              <button
                type="button"
                onClick={onReviewClick}
                className="rounded-full border border-gold/20 px-3 py-1 text-xs font-medium text-gold transition-all hover:bg-gold/5"
              >
                Leave a Review
              </button>
            )}
            {variant === 'past' && !isReviewable && (
              <Link
                href={`/events/${event.slug}#reviews`}
                className="rounded-full border border-gold/20 px-3 py-1 text-xs font-medium text-text-tertiary/50 transition-all"
              >
                Reviewed
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  waitlistPosition,
}: {
  status: string
  waitlistPosition: number | null
}) {
  if (status === 'confirmed') {
    return (
      <span className="rounded-full bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold">
        Confirmed
      </span>
    )
  }
  if (status === 'waitlisted') {
    return (
      <span className="rounded-full bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold">
        Waitlisted{waitlistPosition ? ` #${waitlistPosition}` : ''}
      </span>
    )
  }
  if (status === 'cancelled') {
    return (
      <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger">
        Cancelled
      </span>
    )
  }
  return null
}

function formatSoonLabel(dateTime: string): string {
  const eventDate = new Date(dateTime)
  const now = new Date()
  const diffHours = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60)

  if (diffHours <= 24) {
    return `Today at ${formatTime(dateTime)}`
  }
  return `Tomorrow at ${formatTime(dateTime)}`
}
