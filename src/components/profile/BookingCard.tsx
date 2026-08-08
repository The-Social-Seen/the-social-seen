'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Calendar, CalendarPlus, Clock, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { resolveEventImage } from '@/lib/utils/images'
import {
  formatDateCard,
  formatTime,
  isWithin48Hours,
  getPendingPaymentDeadline,
  isPendingPaymentDeadlinePassed,
} from '@/lib/utils/dates'
import { downloadIcsFile } from '@/lib/utils/calendar'
import { resumePendingCheckout } from '@/app/(member)/bookings/actions'
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
  // Pending-payment cards render with variant="upcoming" (merged into
  // the Upcoming tab's render list by BookingsList) — gated on
  // booking.status, not variant. See UX-REVIEW-pending-payment-visibility.md §3/§4.
  const isPending = booking.status === 'pending_payment'

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
              {/* Primary-tag chip (F1b-app — was categoryLabel(event.category)) */}
              <span className="rounded-full border border-gold/20 px-2.5 py-0.5 text-xs font-medium text-gold">
                {event.primary_tag.label}
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

            {isPending && <PendingPaymentCopy booking={booking} />}
          </div>

          {/* Actions */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {isPending && <PendingPaymentActions booking={booking} />}
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

// ── Pending-payment sub-components ───────────────────────────────────────────
// (UX-REVIEW-pending-payment-visibility.md §3/§4) Extracted to keep
// BookingCard itself under the 200-line component limit.

/** Explainer + deadline copy block, rendered above the actions row. */
function PendingPaymentCopy({ booking }: { booking: BookingWithEvent }) {
  const isAdminHold = booking.is_admin_hold === true
  const deadlinePassed = isPendingPaymentDeadlinePassed(booking.created_at)

  if (isAdminHold) {
    return (
      <p className="mt-2 text-xs text-text-tertiary">
        This spot is managed by our team &mdash; check your email for a payment link, or contact us.
      </p>
    )
  }

  if (deadlinePassed) {
    return (
      <p className="mt-2 text-xs text-text-tertiary">
        This hold may have expired &mdash; refresh to check your booking.
      </p>
    )
  }

  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-text-tertiary">
        You started checking out but didn&rsquo;t finish &mdash; this spot isn&rsquo;t confirmed yet.
      </p>
      <p className="flex items-center gap-1.5 text-xs font-medium text-gold">
        <Clock className="h-3.5 w-3.5 flex-shrink-0" />
        Complete payment by {formatTime(getPendingPaymentDeadline(booking.created_at))} to keep it.
      </p>
    </div>
  )
}

/**
 * Primary "Complete Payment" CTA (or the stale-deadline "Refresh"
 * fallback). Renders nothing for `is_admin_hold` rows — those are
 * rejected server-side by `resumePendingCheckout` (see
 * resume-checkout.ts step 3), so the button must not be offered here
 * either.
 */
function PendingPaymentActions({ booking }: { booking: BookingWithEvent }) {
  const router = useRouter()
  const [isResuming, startResumeTransition] = useTransition()
  const [resumeError, setResumeError] = useState<string | null>(null)

  if (booking.is_admin_hold === true) return null

  const deadlinePassed = isPendingPaymentDeadlinePassed(booking.created_at)

  function handleResume() {
    setResumeError(null)
    startResumeTransition(async () => {
      const result = await resumePendingCheckout(booking.id)
      if (!result.success) {
        setResumeError(result.error ?? 'Something went wrong. Please try again.')
        return
      }
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl
      }
    })
  }

  return (
    <>
      {deadlinePassed ? (
        <button
          type="button"
          onClick={() => router.refresh()}
          className="text-xs font-medium text-gold transition-colors hover:text-gold-hover"
        >
          Refresh
        </button>
      ) : (
        <button
          type="button"
          onClick={handleResume}
          disabled={isResuming}
          className="w-full rounded-full bg-gold px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
        >
          {isResuming ? 'Opening secure checkout…' : 'Complete Payment'}
        </button>
      )}
      {resumeError && (
        <p className="w-full text-xs text-danger" role="alert">
          {resumeError}
        </p>
      )}
    </>
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
  if (status === 'pending_payment') {
    // Gold, same family as Confirmed/Waitlisted — NOT danger/red.
    // UX-REVIEW-pending-payment-visibility.md §2: this is an active,
    // recoverable state (a sibling of "waitlist is positive"), not a
    // failure. The label text ("Payment Pending") carries the meaning;
    // colour is reinforcement only.
    return (
      <span className="rounded-full bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold">
        Payment Pending
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
