// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { EventDetail, Booking } from '@/types'

// ── Mocks ──────────────────────────────────────────────────────────────────────

function filterDomProps(props: Record<string, unknown>) {
  const invalid = [
    'variants', 'initial', 'animate', 'exit', 'whileInView', 'viewport',
    'transition', 'custom', 'whileHover', 'layout',
  ]
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!invalid.includes(key)) filtered[key] = value
  }
  return filtered
}

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...filterDomProps(props)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/components/reviews/StarRating', () => ({
  default: ({ rating }: { rating: number }) => (
    <div data-testid="star-rating">{rating.toFixed(1)}</div>
  ),
}))

vi.mock('@/lib/utils/calendar', () => ({
  downloadIcsFile: vi.fn(),
}))

vi.mock('@/app/events/[slug]/actions', () => ({
  cancelBooking: vi.fn(),
  leaveWaitlist: vi.fn(),
}))

import BookingSidebar from '../BookingSidebar'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: 'evt-1',
    slug: 'wine-evening',
    title: 'Wine Evening',
    description: 'Description',
    short_description: 'Short',
    date_time: '2027-05-10T19:00:00Z',
    end_time: '2027-05-10T22:00:00Z',
    venue_name: 'The Cellar',
    venue_address: '123 London Rd',
    venue_revealed: true,
    postcode: null,
    category: 'dining',
    price: 3500,
    capacity: 30,
    image_url: null,
    dress_code: null,
    is_published: true,
    is_cancelled: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    confirmed_count: 22,
    avg_rating: 0,
    review_count: 0,
    spots_left: 8,
    hosts: [],
    inclusions: [],
    ...overrides,
  }
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-1',
    user_id: 'user-1',
    event_id: 'evt-1',
    status: 'confirmed',
    waitlist_position: null,
    price_at_booking: 3500,
    booked_at: '2026-04-01T10:00:00Z',
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    deleted_at: null,
    ...overrides,
  }
}

const defaultProps = {
  isPast: false,
  isLoggedIn: true,
  userName: 'Charlotte Moreau' as string | null,
  onBookClick: vi.fn(),
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BookingSidebar', () => {
  // ── Logged-out state ──

  it('shows "Sign In to Book" when user is not authenticated', () => {
    render(
      <BookingSidebar
        event={makeEvent()}
        userBooking={null}
        {...defaultProps}
        isLoggedIn={false}
      />
    )

    expect(screen.getByText('Sign In to Book')).toBeTruthy()
  })

  it('shows "Join now" link for unauthenticated users', () => {
    render(
      <BookingSidebar
        event={makeEvent()}
        userBooking={null}
        {...defaultProps}
        isLoggedIn={false}
      />
    )

    expect(screen.getByText('Join now')).toBeTruthy()
  })

  // ── Bookable states ──

  it('shows "RSVP Now" for a free event with no booking', () => {
    render(
      <BookingSidebar
        event={makeEvent({ price: 0 })}
        userBooking={null}
        {...defaultProps}
      />
    )

    expect(screen.getByText('RSVP Now')).toBeTruthy()
  })

  it('shows "Book Now" for a paid event with no booking', () => {
    render(
      <BookingSidebar
        event={makeEvent({ price: 3500 })}
        userBooking={null}
        {...defaultProps}
      />
    )

    expect(screen.getByText('Book Now')).toBeTruthy()
  })

  it('shows "Join Waitlist" when event is sold out', () => {
    render(
      <BookingSidebar
        event={makeEvent({ spots_left: 0, capacity: 30 })}
        userBooking={null}
        {...defaultProps}
      />
    )

    expect(screen.getByText('Join Waitlist')).toBeTruthy()
  })

  // ── Confirmed state ──

  it('shows "You\'re going!" when user has confirmed booking', () => {
    render(
      <BookingSidebar
        event={makeEvent()}
        userBooking={makeBooking({ status: 'confirmed' })}
        {...defaultProps}
      />
    )

    expect(screen.getByText("You're going!")).toBeTruthy()
  })

  it('shows "Need to cancel?" link for confirmed bookings', () => {
    render(
      <BookingSidebar
        event={makeEvent()}
        userBooking={makeBooking({ status: 'confirmed' })}
        {...defaultProps}
      />
    )

    expect(screen.getByText('Need to cancel?')).toBeTruthy()
  })

  // ── Waitlisted state ──

  it('shows waitlist position when user is waitlisted', () => {
    render(
      <BookingSidebar
        event={makeEvent()}
        userBooking={makeBooking({ status: 'waitlisted', waitlist_position: 3 })}
        {...defaultProps}
      />
    )

    expect(screen.getByText('#3')).toBeTruthy()
    expect(screen.getByText('Leave waitlist')).toBeTruthy()
  })

  // ── Past event state ──

  it('shows "This event has ended" for past events', () => {
    render(
      <BookingSidebar
        event={makeEvent({ date_time: '2024-01-01T19:00:00Z' })}
        userBooking={null}
        {...defaultProps}
        isPast={true}
      />
    )

    expect(screen.getByText('This event has ended')).toBeTruthy()
  })

  it('shows rating for past events with reviews', () => {
    render(
      <BookingSidebar
        event={makeEvent({
          date_time: '2024-01-01T19:00:00Z',
          avg_rating: 4.5,
        })}
        userBooking={null}
        {...defaultProps}
        isPast={true}
      />
    )

    expect(screen.getByTestId('star-rating')).toBeTruthy()
  })

  // ── Cancelled event state ──

  it('shows cancellation notice for cancelled events', () => {
    render(
      <BookingSidebar
        event={makeEvent({ is_cancelled: true })}
        userBooking={null}
        {...defaultProps}
      />
    )

    expect(screen.getByText('This event has been cancelled')).toBeTruthy()
    expect(screen.getByText(/Browse upcoming events/)).toBeTruthy()
  })

  // ── Capacity display ──

  it('shows spots remaining when event has capacity', () => {
    render(
      <BookingSidebar
        event={makeEvent({ spots_left: 5, capacity: 30 })}
        userBooking={null}
        {...defaultProps}
      />
    )

    expect(screen.getByText('5 / 30')).toBeTruthy()
    expect(screen.getByText(/Only 5 spots left/)).toBeTruthy()
  })
})
