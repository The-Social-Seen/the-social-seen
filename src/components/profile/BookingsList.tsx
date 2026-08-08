'use client'

import { useState, useCallback, useTransition } from 'react'
import Link from 'next/link'
import * as Tabs from '@radix-ui/react-tabs'
import { CalendarCheck, CalendarClock, Users, CalendarSearch, Star, Clock } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatDateCard, formatTime, getPendingPaymentDeadline } from '@/lib/utils/dates'
import { BookingCard } from '@/components/profile/BookingCard'
import ReviewForm from '@/components/reviews/ReviewForm'
import { resumePendingCheckout } from '@/app/(member)/bookings/actions'
import type { BookingWithEvent } from '@/types'

interface BookingsListProps {
  upcoming: BookingWithEvent[]
  past: BookingWithEvent[]
  waitlisted: BookingWithEvent[]
  /**
   * `pending_payment` bookings for events that haven't happened yet
   * (SplitBookings' new bucket). Merged into the Upcoming tab's render
   * list, sorted first, ahead of confirmed bookings — see
   * UX-REVIEW-pending-payment-visibility.md §5.
   */
  pendingPayment: BookingWithEvent[]
  /** Event IDs the user can still review (past + confirmed + not yet reviewed) */
  reviewableEventIds: Set<string>
  /** User name for review preview */
  userName: string
  /** User avatar URL for review preview */
  userAvatar?: string | null
}

type TabValue = 'upcoming' | 'past' | 'waitlisted'

const TAB_CONFIG: Array<{
  value: TabValue
  label: string
  icon: React.ElementType
}> = [
  { value: 'upcoming', label: 'Upcoming', icon: CalendarClock },
  { value: 'past', label: 'Past', icon: CalendarCheck },
  { value: 'waitlisted', label: 'Waitlisted', icon: Users },
]

export function BookingsList({
  upcoming,
  past,
  waitlisted,
  pendingPayment,
  reviewableEventIds,
  userName,
  userAvatar,
}: BookingsListProps) {
  const [activeTab, setActiveTab] = useState<TabValue>('upcoming')
  const [reviewTarget, setReviewTarget] = useState<BookingWithEvent | null>(null)
  const [isResumingBanner, startBannerResumeTransition] = useTransition()
  const [bannerError, setBannerError] = useState<string | null>(null)

  // Pending-payment bookings sort first within Upcoming, ahead of the
  // (already date/created_at-ordered) confirmed bookings — see
  // UX-REVIEW-pending-payment-visibility.md §5.
  const upcomingWithPending = [...pendingPayment, ...upcoming]

  const counts: Record<TabValue, number> = {
    upcoming: upcoming.length + pendingPayment.length,
    past: past.length,
    waitlisted: waitlisted.length,
  }

  const handleReviewClose = useCallback(() => setReviewTarget(null), [])

  // First reviewable past booking for the discovery banner (Amendment 7.2)
  const firstReviewable = past.find((b) => reviewableEventIds.has(b.event_id))

  // Cross-tab pending-payment banner tap target (UX-REVIEW §5). Single
  // booking: resume straight into checkout (fewer taps) unless it's an
  // admin-managed hold, which has no self-service resume path — in
  // that case (and for 2+ bookings, which can't deep-link to one card)
  // just surface the Upcoming tab where the specifics live.
  function handleBannerClick() {
    const single = pendingPayment.length === 1 ? pendingPayment[0] : null
    if (single && single.is_admin_hold !== true) {
      setBannerError(null)
      startBannerResumeTransition(async () => {
        const result = await resumePendingCheckout(single.id)
        if (!result.success) {
          setBannerError(result.error ?? 'Something went wrong. Please try again.')
          return
        }
        if (result.checkoutUrl) {
          window.location.href = result.checkoutUrl
        }
      })
      return
    }
    setActiveTab('upcoming')
  }

  return (
    <>
    {/* Pending-payment banner ranks above the review banner — a payment
        hold has time pressure, a review nudge doesn't. At most one
        urgent-action banner shows at a time. */}
    <DiscoveryBanner
      pendingPayment={pendingPayment}
      firstReviewable={firstReviewable}
      isResumingBanner={isResumingBanner}
      bannerError={bannerError}
      onBannerClick={handleBannerClick}
      onReviewClick={setReviewTarget}
    />

    <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
      {/* Tab triggers */}
      <Tabs.List className="mb-6 flex gap-1 rounded-xl border border-border bg-bg-card p-1.5 shadow-sm">
        {TAB_CONFIG.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.value
          return (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                isActive
                  ? 'bg-charcoal text-cream shadow-sm'
                  : 'text-text-tertiary hover:text-text-primary',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs',
                  isActive
                    ? 'bg-gold/20 text-gold'
                    : 'bg-charcoal/5 text-text-tertiary/60',
                )}
              >
                {counts[tab.value]}
              </span>
            </Tabs.Trigger>
          )
        })}
      </Tabs.List>

      {/* Tab content */}
      <Tabs.Content value="upcoming" className="space-y-4">
        {upcomingWithPending.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            message="Your next event awaits."
            cta="Browse what's coming up this month"
            href="/events"
          />
        ) : (
          upcomingWithPending.map((booking) => (
            <BookingCard key={booking.id} booking={booking} variant="upcoming" />
          ))
        )}
      </Tabs.Content>

      <Tabs.Content value="past" className="space-y-4">
        {past.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            message="Once you've attended your first event, it'll appear here — along with photos and reviews from the evening."
          />
        ) : (
          past.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              variant="past"
              isReviewable={reviewableEventIds.has(booking.event_id)}
              onReviewClick={() => setReviewTarget(booking)}
            />
          ))
        )}
      </Tabs.Content>

      <Tabs.Content value="waitlisted" className="space-y-4">
        {waitlisted.length === 0 ? (
          <EmptyState
            icon={CalendarSearch}
            message="Nothing on the waitlist right now. Popular events fill fast — bookmark ones you're interested in."
          />
        ) : (
          waitlisted.map((booking) => (
            <BookingCard key={booking.id} booking={booking} variant="waitlisted" />
          ))
        )}
      </Tabs.Content>
    </Tabs.Root>

    {/* Review modal */}
    {reviewTarget && (
      <ReviewForm
        eventId={reviewTarget.event_id}
        eventTitle={reviewTarget.event.title}
        eventDate={formatDateCard(reviewTarget.event.date_time)}
        userName={userName}
        userAvatar={userAvatar}
        onClose={handleReviewClose}
        onSuccess={() => {
          // After review, remove from reviewable set so UI updates instantly
          reviewableEventIds.delete(reviewTarget.event_id)
        }}
      />
    )}
    </>
  )
}

// ── Discovery banner ─────────────────────────────────────────────────────────
// Extracted to keep BookingsList itself under the 200-line component
// limit. Shows at most one banner: pending-payment (time-sensitive)
// takes priority over the review-discovery banner (Amendment 7.2).

function DiscoveryBanner({
  pendingPayment,
  firstReviewable,
  isResumingBanner,
  bannerError,
  onBannerClick,
  onReviewClick,
}: {
  pendingPayment: BookingWithEvent[]
  firstReviewable: BookingWithEvent | undefined
  isResumingBanner: boolean
  bannerError: string | null
  onBannerClick: () => void
  onReviewClick: (booking: BookingWithEvent) => void
}) {
  if (pendingPayment.length > 0) {
    const single = pendingPayment.length === 1 ? pendingPayment[0] : null
    return (
      <button
        type="button"
        onClick={onBannerClick}
        disabled={isResumingBanner}
        className="mb-6 flex w-full flex-col items-center gap-3 rounded-xl border border-gold/20 bg-gold/5 p-4 text-center transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-row sm:text-left"
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gold/10">
          <Clock className="h-5 w-5 text-gold" />
        </div>
        <div className="min-w-0 flex-1">
          {single ? (
            <>
              <p className="text-sm font-medium text-text-primary">
                Finish booking {single.event.title}
              </p>
              <p className="text-xs text-text-tertiary">
                {isResumingBanner
                  ? 'Opening secure checkout…'
                  : `Payment pending — complete by ${formatTime(getPendingPaymentDeadline(single.created_at))} to keep your spot →`}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-text-primary">
                You have {pendingPayment.length} bookings awaiting payment
              </p>
              <p className="text-xs text-text-tertiary">
                Complete payment to keep your spots &rarr;
              </p>
            </>
          )}
          {bannerError && (
            <p className="mt-1 text-xs text-danger" role="alert">
              {bannerError}
            </p>
          )}
        </div>
      </button>
    )
  }

  if (!firstReviewable) return null

  return (
    <button
      type="button"
      onClick={() => onReviewClick(firstReviewable)}
      className="mb-6 flex w-full items-center gap-3 rounded-xl border border-gold/20 bg-gold/5 p-4 text-left transition-colors hover:bg-gold/10"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gold/10">
        <Star className="h-5 w-5 text-gold" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">
          How was {firstReviewable.event.title}?
        </p>
        <p className="text-xs text-text-tertiary">
          Share your experience &rarr;
        </p>
      </div>
    </button>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  icon: Icon,
  message,
  cta,
  href,
}: {
  icon: React.ElementType
  message: string
  cta?: string
  href?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-10 text-center">
      <Icon className="mx-auto mb-3 h-10 w-10 text-text-tertiary/30" />
      <p className="mx-auto max-w-sm text-sm text-text-tertiary">{message}</p>
      {cta && href && (
        <Link
          href={href}
          className="mt-4 inline-block text-sm font-medium text-gold transition-colors hover:text-gold-hover"
        >
          {cta} &rarr;
        </Link>
      )}
    </div>
  )
}
