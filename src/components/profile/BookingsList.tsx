'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import * as Tabs from '@radix-ui/react-tabs'
import { CalendarCheck, CalendarClock, Users, CalendarSearch, Star } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatDateCard } from '@/lib/utils/dates'
import { BookingCard } from '@/components/profile/BookingCard'
import ReviewForm from '@/components/reviews/ReviewForm'
import type { BookingWithEvent } from '@/types'

interface BookingsListProps {
  upcoming: BookingWithEvent[]
  past: BookingWithEvent[]
  waitlisted: BookingWithEvent[]
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
  reviewableEventIds,
  userName,
  userAvatar,
}: BookingsListProps) {
  const [activeTab, setActiveTab] = useState<TabValue>('upcoming')
  const [reviewTarget, setReviewTarget] = useState<BookingWithEvent | null>(null)

  const counts: Record<TabValue, number> = {
    upcoming: upcoming.length,
    past: past.length,
    waitlisted: waitlisted.length,
  }

  const handleReviewClose = useCallback(() => setReviewTarget(null), [])

  // First reviewable past booking for the discovery banner (Amendment 7.2)
  const firstReviewable = past.find((b) => reviewableEventIds.has(b.event_id))

  return (
    <>
    {/* Review discovery banner (Amendment 7.2) */}
    {firstReviewable && (
      <button
        type="button"
        onClick={() => setReviewTarget(firstReviewable)}
        className="mb-6 flex w-full items-center gap-3 rounded-xl border border-gold/20 bg-gold/5 p-4 text-left transition-colors hover:bg-gold/10 dark:border-gold/15 dark:bg-gold/5"
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gold/10">
          <Star className="h-5 w-5 text-gold" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-charcoal dark:text-dark-text">
            How was {firstReviewable.event.title}?
          </p>
          <p className="text-xs text-muted dark:text-dark-muted">
            Share your experience &rarr;
          </p>
        </div>
      </button>
    )}

    <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
      {/* Tab triggers */}
      <Tabs.List className="mb-6 flex gap-1 rounded-xl border border-border bg-white p-1.5 shadow-sm dark:border-dark-border dark:bg-dark-surface">
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
                  ? 'bg-charcoal text-cream shadow-sm dark:bg-gold dark:text-white'
                  : 'text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs',
                  isActive
                    ? 'bg-gold/20 text-gold dark:bg-white/20 dark:text-white'
                    : 'bg-charcoal/5 text-muted/60 dark:bg-dark-border dark:text-dark-muted',
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
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            message="Your next event awaits."
            cta="Browse what's coming up this month"
            href="/events"
          />
        ) : (
          upcoming.map((booking) => (
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
    <div className="rounded-xl border border-border bg-white p-10 text-center dark:border-dark-border dark:bg-dark-surface">
      <Icon className="mx-auto mb-3 h-10 w-10 text-muted/30 dark:text-dark-muted/30" />
      <p className="mx-auto max-w-sm text-sm text-muted dark:text-dark-muted">{message}</p>
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
