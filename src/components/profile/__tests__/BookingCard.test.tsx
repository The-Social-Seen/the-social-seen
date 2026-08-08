// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

const mockRouterRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}))

const mockResumePendingCheckout = vi.fn()
vi.mock('@/app/(member)/bookings/actions', () => ({
  resumePendingCheckout: (...args: unknown[]) => mockResumePendingCheckout(...args),
}))

// Mock dates module — control isWithin48Hours + pending-payment deadline helpers
const mockIsWithin48Hours = vi.fn((_date: unknown) => false)
const mockDeadlinePassed = vi.fn((_createdAt: unknown) => false)
vi.mock('@/lib/utils/dates', () => ({
  formatDateCard: () => 'Sat 10 May',
  formatTime: () => '7:00 PM',
  isWithin48Hours: (date: unknown) => mockIsWithin48Hours(date),
  getPendingPaymentDeadline: () => new Date('2026-05-10T15:45:00Z'),
  isPendingPaymentDeadlinePassed: (createdAt: unknown) => mockDeadlinePassed(createdAt),
}))

vi.mock('@/lib/utils/images', () => ({
  resolveEventImage: (url: string | null) => url,
}))

import { BookingCard } from '../BookingCard'

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeBooking(overrides: Partial<BookingWithEvent> = {}): BookingWithEvent {
  return {
    id: 'book-1',
    user_id: 'user-1',
    event_id: 'evt-1',
    status: 'confirmed',
    waitlist_position: null,
    price_at_booking: 3500,
    booking_fee_pence: 0,
    stripe_fee_pence: 0,
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
      short_description: 'A short description',
      venue_address: '1 London Rd',
      image_url: 'https://example.com/wine.jpg',
      dress_code: 'Smart Casual',
      primary_tag: { slug: 'dining-supper-clubs', label: 'Dining & Supper Clubs' },
    },
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('BookingCard', () => {
  beforeEach(() => {
    mockDeadlinePassed.mockReturnValue(false)
    mockResumePendingCheckout.mockReset()
    mockRouterRefresh.mockReset()
  })

  it('renders event title and venue', () => {
    render(<BookingCard booking={makeBooking()} variant="upcoming" />)

    expect(screen.getByText('Wine & Wisdom')).toBeTruthy()
    expect(screen.getByText('The Cellar')).toBeTruthy()
  })

  it('renders date and time', () => {
    render(<BookingCard booking={makeBooking()} variant="upcoming" />)

    // formatDateCard returns 'Sat 10 May', formatTime returns '7:00 PM'
    expect(screen.getByText(/Sat 10 May/)).toBeTruthy()
    expect(screen.getByText(/7:00 PM/)).toBeTruthy()
  })

  it('shows "Confirmed" badge for confirmed booking', () => {
    render(<BookingCard booking={makeBooking({ status: 'confirmed' })} variant="upcoming" />)

    expect(screen.getByText('Confirmed')).toBeTruthy()
  })

  it('shows "Waitlisted" badge with position number', () => {
    render(
      <BookingCard
        booking={makeBooking({ status: 'waitlisted', waitlist_position: 3 })}
        variant="waitlisted"
      />,
    )

    expect(screen.getByText('Waitlisted #3')).toBeTruthy()
  })

  it('shows positive waitlist copy for waitlisted variant', () => {
    render(
      <BookingCard
        booking={makeBooking({ status: 'waitlisted' })}
        variant="waitlisted"
      />,
    )

    expect(screen.getByText(/Most waitlisted members get a spot/)).toBeTruthy()
  })

  it('shows "Cancelled" badge for cancelled booking', () => {
    render(
      <BookingCard booking={makeBooking({ status: 'cancelled' })} variant="upcoming" />,
    )

    expect(screen.getByText('Cancelled')).toBeTruthy()
  })

  it('shows "Leave a Review" button for reviewable past variant', () => {
    const onReviewClick = vi.fn()
    render(
      <BookingCard booking={makeBooking()} variant="past" isReviewable onReviewClick={onReviewClick} />,
    )

    const reviewBtn = screen.getByText('Leave a Review')
    expect(reviewBtn).toBeTruthy()
    expect(reviewBtn.tagName).toBe('BUTTON')
  })

  it('shows "Reviewed" label for non-reviewable past variant', () => {
    render(<BookingCard booking={makeBooking()} variant="past" />)

    expect(screen.getByText('Reviewed')).toBeTruthy()
    expect(screen.queryByText('Leave a Review')).toBeNull()
  })

  it('does not show "Leave a Review" for upcoming variant', () => {
    render(<BookingCard booking={makeBooking()} variant="upcoming" />)

    expect(screen.queryByText('Leave a Review')).toBeNull()
  })

  it('links to event detail page', () => {
    render(<BookingCard booking={makeBooking()} variant="upcoming" />)

    const link = screen.getByText('View Event')
    expect(link.closest('a')?.getAttribute('href')).toBe('/events/wine-and-wisdom')
  })

  it('shows 48-hour reminder styling and microcopy when event is soon', () => {
    mockIsWithin48Hours.mockReturnValue(true)

    const { container } = render(
      <BookingCard booking={makeBooking()} variant="upcoming" />,
    )

    // Should have gold ring styling
    const card = container.firstElementChild
    expect(card?.className).toContain('ring-gold')

    // Should show "see you there" microcopy
    expect(screen.getByText(/see you there!/)).toBeTruthy()

    mockIsWithin48Hours.mockReturnValue(false)
  })

  it('does not show 48-hour reminder for non-upcoming variant', () => {
    mockIsWithin48Hours.mockReturnValue(true)

    const { container } = render(
      <BookingCard booking={makeBooking()} variant="past" />,
    )

    const card = container.firstElementChild
    expect(card?.className).not.toContain('ring-gold')
    expect(screen.queryByText(/see you there!/)).toBeNull()

    mockIsWithin48Hours.mockReturnValue(false)
  })

  it('shows the primary_tag label (F1b-app — was categoryLabel(event.category))', () => {
    render(<BookingCard booking={makeBooking()} variant="upcoming" />)

    expect(screen.getByText('Dining & Supper Clubs')).toBeTruthy()
    // Must NOT render the legacy enum label
    expect(screen.queryByText('Dining')).toBeNull()
  })

  it('renders placeholder when event has no image', () => {
    const booking = makeBooking()
    booking.event = { ...booking.event, image_url: null }

    const { container } = render(<BookingCard booking={booking} variant="upcoming" />)

    // No <img> element should be rendered
    expect(container.querySelector('img')).toBeNull()
  })

  // ── Pending-payment state ──────────────────────────────────────────────────

  it('shows "Payment Pending" gold badge for pending_payment booking', () => {
    render(
      <BookingCard booking={makeBooking({ status: 'pending_payment' })} variant="upcoming" />,
    )

    const badge = screen.getByText('Payment Pending')
    expect(badge).toBeTruthy()
    expect(badge.className).toContain('text-gold')
    expect(badge.className).not.toContain('text-danger')
  })

  it('shows explainer + deadline copy for a resumable pending_payment booking', () => {
    render(
      <BookingCard booking={makeBooking({ status: 'pending_payment' })} variant="upcoming" />,
    )

    expect(screen.getByText(/didn.t finish/)).toBeTruthy()
    expect(screen.getByText(/Complete payment by 7:00 PM to keep it/)).toBeTruthy()
  })

  it('shows a primary "Complete Payment" button for a resumable pending_payment booking', () => {
    render(
      <BookingCard booking={makeBooking({ status: 'pending_payment' })} variant="upcoming" />,
    )

    const button = screen.getByText('Complete Payment')
    expect(button.tagName).toBe('BUTTON')
    expect(button.className).toContain('bg-gold')
  })

  it('calls resumePendingCheckout and redirects on "Complete Payment" click', async () => {
    mockResumePendingCheckout.mockResolvedValue({
      success: true,
      checkoutUrl: 'https://checkout.stripe.com/session-1',
    })
    // jsdom doesn't implement navigation — stub the setter
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    })

    render(
      <BookingCard booking={makeBooking({ status: 'pending_payment' })} variant="upcoming" />,
    )

    fireEvent.click(screen.getByText('Complete Payment'))

    await waitFor(() => expect(mockResumePendingCheckout).toHaveBeenCalledWith('book-1'))
    await waitFor(() =>
      expect(window.location.href).toBe('https://checkout.stripe.com/session-1'),
    )
  })

  it('shows an inline error and re-enables the button when resume fails', async () => {
    mockResumePendingCheckout.mockResolvedValue({
      success: false,
      error: 'This booking is no longer awaiting payment.',
    })

    render(
      <BookingCard booking={makeBooking({ status: 'pending_payment' })} variant="upcoming" />,
    )

    fireEvent.click(screen.getByText('Complete Payment'))

    expect(
      await screen.findByText('This booking is no longer awaiting payment.'),
    ).toBeTruthy()
  })

  it('shows admin-managed copy with no resume button when is_admin_hold is true', () => {
    render(
      <BookingCard
        booking={makeBooking({ status: 'pending_payment', is_admin_hold: true })}
        variant="upcoming"
      />,
    )

    expect(screen.getByText(/managed by our team/)).toBeTruthy()
    expect(screen.queryByText('Complete Payment')).toBeNull()
  })

  it('treats is_admin_hold undefined the same as false (shows resume button)', () => {
    // The fixture doesn't set is_admin_hold at all — undefined, same as
    // real Booking rows selected by queries that don't fetch the column.
    const booking = makeBooking({ status: 'pending_payment' })

    render(<BookingCard booking={booking} variant="upcoming" />)

    expect(screen.getByText('Complete Payment')).toBeTruthy()
  })

  it('shows the stale-deadline fallback with a Refresh action once the deadline has passed', () => {
    mockDeadlinePassed.mockReturnValue(true)

    render(
      <BookingCard booking={makeBooking({ status: 'pending_payment' })} variant="upcoming" />,
    )

    expect(screen.getByText(/This hold may have expired/)).toBeTruthy()
    expect(screen.queryByText('Complete Payment')).toBeNull()

    fireEvent.click(screen.getByText('Refresh'))
    expect(mockRouterRefresh).toHaveBeenCalled()
  })
})
