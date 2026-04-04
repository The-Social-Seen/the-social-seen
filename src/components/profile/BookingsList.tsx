'use client'

import { useState } from 'react'
import Link from 'next/link'
import * as Tabs from '@radix-ui/react-tabs'
import { CalendarCheck, CalendarClock, Users, CalendarSearch } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { BookingCard } from '@/components/profile/BookingCard'
import type { BookingWithEvent } from '@/types'

interface BookingsListProps {
  upcoming: BookingWithEvent[]
  past: BookingWithEvent[]
  waitlisted: BookingWithEvent[]
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

export function BookingsList({ upcoming, past, waitlisted }: BookingsListProps) {
  const [activeTab, setActiveTab] = useState<TabValue>('upcoming')

  const counts: Record<TabValue, number> = {
    upcoming: upcoming.length,
    past: past.length,
    waitlisted: waitlisted.length,
  }

  return (
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
            <BookingCard key={booking.id} booking={booking} variant="past" />
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
