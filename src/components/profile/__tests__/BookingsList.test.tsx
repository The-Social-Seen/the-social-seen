// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { BookingWithEvent } from '@/types'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string; [k: string]: unknown }) => (
    <img alt={alt} src={src} />
  ),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/components/reviews/ReviewForm', () => ({
  default: () => <div data-testid="review-form" />,
}))

vi.mock('@/lib/utils/dates', () => ({
  formatDateCard: () => 'Sat 10 May',
  formatTime: () => '7:00 PM',
  isWithin48Hours: () => false,
}))

vi.mock('@/lib/utils/images', () => ({
  resolveEventImage: (url: string | null) => url,
}))

vi.mock('lucide-react', () => {
  const icon = ({ className }: { className?: string }) => <span className={className} />
  return {
    CalendarCheck: icon,
    CalendarClock: icon,
    CalendarSearch: icon,
    Users: icon,
    Calendar: icon,
    MapPin: icon,
    Star: icon,
  }
})

// Mock Radix Tabs — jsdom can't handle Radix pointer event handlers
vi.mock('@radix-ui/react-tabs', () => {
  const Root = ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <div data-testid="tabs-root" data-value={value} data-onvaluechange={String(!!onValueChange)}>
      {/* Pass the setter through a context-like pattern via the DOM */}
      <TabsContext.Provider value={{ value, onValueChange }}>
        {children}
      </TabsContext.Provider>
    </div>
  )

  const List = ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div role="tablist" {...filterProps(props)}>{children}</div>
  )

  const Trigger = ({
    value: tabValue,
    children,
    ...props
  }: React.PropsWithChildren<{ value: string; className?: string }>) => (
    <TabsContext.Consumer>
      {(ctx) => (
        <button
          role="tab"
          data-state={ctx?.value === tabValue ? 'active' : 'inactive'}
          aria-selected={ctx?.value === tabValue}
          onClick={() => ctx?.onValueChange(tabValue)}
          {...filterProps(props)}
        >
          {children}
        </button>
      )}
    </TabsContext.Consumer>
  )

  const Content = ({
    value: tabValue,
    children,
    ...props
  }: React.PropsWithChildren<{ value: string; className?: string }>) => (
    <TabsContext.Consumer>
      {(ctx) =>
        ctx?.value === tabValue ? (
          <div role="tabpanel" data-state="active" {...filterProps(props)}>
            {children}
          </div>
        ) : null
      }
    </TabsContext.Consumer>
  )

  // Simple context for tests
  const React = require('react')
  const TabsContext = React.createContext<{
    value: string
    onValueChange: (v: string) => void
  } | null>(null)

  function filterProps(props: Record<string, unknown>) {
    const { className } = props as { className?: string }
    return className ? { className } : {}
  }

  return { Root, List, Trigger, Content }
})

import { BookingsList } from '../BookingsList'

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeBooking(overrides: Partial<BookingWithEvent> & { id?: string } = {}): BookingWithEvent {
  return {
    id: 'book-1',
    user_id: 'user-1',
    event_id: 'evt-1',
    status: 'confirmed',
    waitlist_position: null,
    price_at_booking: 3500,
    booked_at: '2026-04-01T12:00:00Z',
    created_at: '2026-04-01T12:00:00Z',
    updated_at: '2026-04-01T12:00:00Z',
    deleted_at: null,
    event: {
      id: 'evt-1',
      slug: 'wine-and-wisdom',
      title: 'Wine & Wisdom',
      date_time: '2026-05-10T19:00:00Z',
      end_time: '2026-05-10T22:00:00Z',
      venue_name: 'The Cellar',
      image_url: 'https://example.com/wine.jpg',
      category: 'dining',
      dress_code: 'Smart Casual',
    },
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('BookingsList', () => {
  it('renders three tab triggers', () => {
    render(<BookingsList upcoming={[]} past={[]} waitlisted={[]} reviewableEventIds={new Set()} userName="Test User" userAvatar={null} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(screen.getByText('Upcoming')).toBeTruthy()
    expect(screen.getByText('Past')).toBeTruthy()
    expect(screen.getByText('Waitlisted')).toBeTruthy()
  })

  it('shows correct counts on tabs', () => {
    const upcoming = [makeBooking({ id: 'b1' }), makeBooking({ id: 'b2' })]

    render(<BookingsList upcoming={upcoming} past={[]} waitlisted={[]} reviewableEventIds={new Set()} userName="Test User" userAvatar={null} />)

    expect(screen.getByText('2')).toBeTruthy()
    const zeros = screen.getAllByText('0')
    expect(zeros).toHaveLength(2)
  })

  it('shows upcoming empty state with CTA when no upcoming bookings', () => {
    render(<BookingsList upcoming={[]} past={[]} waitlisted={[]} reviewableEventIds={new Set()} userName="Test User" userAvatar={null} />)

    expect(screen.getByText(/Your next event awaits/)).toBeTruthy()
    const ctaLink = screen.getByText(/Browse what's coming up this month/)
    expect(ctaLink.closest('a')?.getAttribute('href')).toBe('/events')
  })

  it('shows past empty state when past tab is clicked and empty', () => {
    render(<BookingsList upcoming={[]} past={[]} waitlisted={[]} reviewableEventIds={new Set()} userName="Test User" userAvatar={null} />)

    fireEvent.click(screen.getByRole('tab', { name: /Past/ }))

    expect(
      screen.getByText(/Once you.ve attended your first event/),
    ).toBeTruthy()
  })

  it('shows waitlisted empty state when waitlisted tab is clicked and empty', () => {
    render(<BookingsList upcoming={[]} past={[]} waitlisted={[]} reviewableEventIds={new Set()} userName="Test User" userAvatar={null} />)

    fireEvent.click(screen.getByRole('tab', { name: /Waitlisted/ }))

    expect(
      screen.getByText(/Nothing on the waitlist right now/),
    ).toBeTruthy()
  })

  it('renders BookingCards when upcoming bookings exist', () => {
    const upcoming = [makeBooking()]

    render(<BookingsList upcoming={upcoming} past={[]} waitlisted={[]} reviewableEventIds={new Set()} userName="Test User" userAvatar={null} />)

    expect(screen.getByText('Wine & Wisdom')).toBeTruthy()
    expect(screen.getByText('Confirmed')).toBeTruthy()
  })

  it('renders past BookingCards when past tab is clicked', () => {
    const past = [
      makeBooking({
        id: 'past-1',
        event_id: 'evt-2',
        event: {
          id: 'evt-2',
          slug: 'jazz-night',
          title: 'Jazz Night',
          date_time: '2025-12-10T19:00:00Z',
          end_time: '2025-12-10T22:00:00Z',
          venue_name: 'Ronnie Scotts',
          image_url: null,
          category: 'music',
          dress_code: null,
        },
      }),
    ]

    render(<BookingsList upcoming={[]} past={past} waitlisted={[]} reviewableEventIds={new Set(['evt-2'])} userName="Test User" userAvatar={null} />)

    fireEvent.click(screen.getByRole('tab', { name: /Past/ }))

    expect(screen.getByText('Jazz Night')).toBeTruthy()
    expect(screen.getByText('Leave a Review')).toBeTruthy()
  })

  it('renders waitlisted BookingCards with position when waitlisted tab is clicked', () => {
    const waitlisted = [
      makeBooking({
        id: 'wait-1',
        status: 'waitlisted',
        waitlist_position: 2,
      }),
    ]

    render(<BookingsList upcoming={[]} past={[]} waitlisted={waitlisted} reviewableEventIds={new Set()} userName="Test User" userAvatar={null} />)

    fireEvent.click(screen.getByRole('tab', { name: /Waitlisted/ }))

    expect(screen.getByText('Waitlisted #2')).toBeTruthy()
  })
})
