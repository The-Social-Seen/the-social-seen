// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { EventDetail } from '@/types'

// ── Mocks ──────────────────────────────────────────────────────────────────────

function filterDomProps(props: Record<string, unknown>) {
  const invalid = [
    'variants', 'initial', 'animate', 'exit', 'whileInView', 'viewport',
    'transition', 'custom', 'whileHover', 'layout', 'style',
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

const mockCreateBooking = vi.fn()
const mockCreatePaidCheckout = vi.fn()
const mockAbandonPendingCheckout = vi.fn()
vi.mock('@/app/events/[slug]/actions', () => ({
  createBooking: (...args: unknown[]) => mockCreateBooking(...args),
  createPaidCheckout: (...args: unknown[]) => mockCreatePaidCheckout(...args),
  abandonPendingCheckout: (...args: unknown[]) => mockAbandonPendingCheckout(...args),
}))

const mockResumePendingCheckout = vi.fn()
vi.mock('@/app/(member)/bookings/actions', () => ({
  resumePendingCheckout: (...args: unknown[]) => mockResumePendingCheckout(...args),
}))

vi.mock('@/lib/utils/calendar', () => ({
  downloadIcsFile: vi.fn(),
}))

import BookingModal from '../BookingModal'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: 'evt-1',
    slug: 'wine-evening',
    title: 'Wine Evening',
    description: 'Description',
    short_description: 'Short desc',
    date_time: '2027-05-10T19:00:00Z',
    end_time: '2027-05-10T22:00:00Z',
    venue_name: 'The Cellar',
    venue_address: '123 London Rd',
    venue_revealed: true,
    postcode: null,
    price: 3500,
    capacity: 30,
    image_url: null,
    dress_code: 'Smart Casual',
    refund_window_hours: 48,
    is_published: true,
    is_cancelled: false,
    external_attendees: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    confirmed_count: 22,
    occupied_count: 22,
    total_attending: 22,
    revenue_collected: null,
    avg_rating: 0,
    review_count: 0,
    spots_left: 8,
    primary_tag: { slug: 'dining-supper-clubs', label: 'Dining & Supper Clubs' },
    hosts: [],
    inclusions: [],
    ...overrides,
  }
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BookingModal', () => {
  // ── Rendering ──

  it('does not render when isOpen is false', () => {
    render(
      <BookingModal
        event={makeEvent()}
        isOpen={false}
        onClose={vi.fn()}
        userName="Charlotte"
      />
    )

    expect(screen.queryByText('Confirm Details')).toBeNull()
  })

  it('renders confirm step when opened', () => {
    render(
      <BookingModal
        event={makeEvent()}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />
    )

    expect(screen.getByText('Confirm Details')).toBeTruthy()
    expect(screen.getByText('Wine Evening')).toBeTruthy()
    expect(screen.getByText('The Cellar')).toBeTruthy()
  })

  // ── Free event: 2-step flow ──

  it('shows "Reserve My Spot" for free events', () => {
    render(
      <BookingModal
        event={makeEvent({ price: 0 })}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />
    )

    expect(screen.getByText('Reserve My Spot')).toBeTruthy()
  })

  it('renders 2 progress bar segments for free events', () => {
    render(
      <BookingModal
        event={makeEvent({ price: 0 })}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />
    )

    // 2 progress segments for free flow
    const progressBar = screen.getByTestId('progress-bar')
    expect(progressBar.children.length).toBe(2)
  })

  // ── Paid event: Stripe redirect flow (P2-7a) ──

  it('shows "Continue to Payment" CTA for paid events', () => {
    render(
      <BookingModal
        event={makeEvent({ price: 3500 })}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />
    )

    expect(screen.getByText('Continue to Payment')).toBeTruthy()
  })

  it('renders 2 progress bar segments for paid events (confirm → ticket)', () => {
    // P2-7a: the in-modal payment step was removed. The paid flow is
    // confirm → Stripe Checkout (external). Ticket card only renders
    // in-modal for paid-waitlisted bookings.
    render(
      <BookingModal
        event={makeEvent({ price: 3500 })}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />
    )

    const progressBar = screen.getByTestId('progress-bar')
    expect(progressBar.children.length).toBe(2)
  })

  it('does not render an in-modal payment/card form for paid events', () => {
    // P2-7a removed the mocked PaymentStep. Card entry now happens on
    // Stripe's hosted Checkout page, not inside this modal.
    render(
      <BookingModal
        event={makeEvent({ price: 3500 })}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />
    )

    // None of the old mocked-payment markers should be visible.
    expect(screen.queryByText(/Demo mode/)).toBeNull()
    expect(screen.queryByDisplayValue('4242 4242 4242 4242')).toBeNull()
    expect(screen.queryByDisplayValue('12 / 28')).toBeNull()
  })

  // ── Close behaviour ──

  it('calls onClose when X button is clicked', () => {
    const onClose = vi.fn()
    render(
      <BookingModal
        event={makeEvent()}
        isOpen={true}
        onClose={onClose}
        userName="Charlotte"
      />
    )

    const closeBtn = screen.getByLabelText('Close booking modal')
    fireEvent.click(closeBtn)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn()
    render(
      <BookingModal
        event={makeEvent()}
        isOpen={true}
        onClose={onClose}
        userName="Charlotte"
      />
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // ── Price display ──

  it('displays "Free" for zero-price events', () => {
    render(
      <BookingModal
        event={makeEvent({ price: 0 })}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />
    )

    const freeElements = screen.getAllByText(/Free/)
    expect(freeElements.length).toBeGreaterThanOrEqual(1)
  })

  // ── Special requirements ──

  it('has a collapsible special requirements section', () => {
    render(
      <BookingModal
        event={makeEvent()}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />
    )

    expect(screen.getByText('Special requirements')).toBeTruthy()
  })

  // ── Price breakdown (refund-fee-deduction spec §8.2) ─────────────────
  //
  // Paid events render a three-row breakdown (Ticket / Booking fee /
  // Total) in the confirm step. Free events keep the legacy
  // "1 spot × Free" rendering. Amounts always use formatPriceExact so
  // the totals always show pence ("£20.00", not "£20").

  it('renders Ticket / Booking fee / Total breakdown for a £20 paid event', () => {
    render(
      <BookingModal
        event={makeEvent({ price: 2000 })}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />,
    )

    // Three explicit labels.
    expect(screen.getByText('Ticket')).toBeTruthy()
    expect(screen.getByText('Booking fee')).toBeTruthy()
    expect(screen.getByText('Total')).toBeTruthy()
    // £20.00 ticket + £0.60 fee = £20.60 total — calculateBookingFeePence(2000) = 60.
    expect(screen.getByText('£20.00')).toBeTruthy()
    expect(screen.getByText('£0.60')).toBeTruthy()
    expect(screen.getByText('£20.60')).toBeTruthy()
    // Pre-purchase disclosure that the booking fee is non-refundable —
    // pinned so it can't drift back to "good-to-have, not required".
    expect(
      screen.getByText(/Non-refundable if you cancel/i),
    ).toBeTruthy()
    // Legacy "1 spot × £20" rendering must NOT appear for paid events.
    expect(screen.queryByText(/1 spot ×/)).toBeNull()
  })

  it('does NOT render the three-row breakdown for free events', () => {
    render(
      <BookingModal
        event={makeEvent({ price: 0 })}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />,
    )

    // Free events keep the legacy "1 spot × Free" rendering.
    expect(screen.queryByText('Ticket')).toBeNull()
    expect(screen.queryByText('Booking fee')).toBeNull()
    expect(screen.queryByText('Total')).toBeNull()
    expect(screen.getByText(/1 spot × Free/)).toBeTruthy()
  })

  it('renders £50 / £1.00 / £51.00 breakdown for a £50 paid event', () => {
    // Higher-price scenario — calculateBookingFeePence(5000) = 100
    // (£1.00) so total = £51.00. Pins both the formula and the
    // formatPriceExact rendering (always two-decimal places).
    render(
      <BookingModal
        event={makeEvent({ price: 5000 })}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />,
    )

    expect(screen.getByText('£50.00')).toBeTruthy()
    expect(screen.getByText('£1.00')).toBeTruthy()
    expect(screen.getByText('£51.00')).toBeTruthy()
  })

  // ── Redirecting lock state (docs/SYSTEM-DESIGN-paid-checkout-confusion-fix.md §1) ──
  //
  // Regresses F2: the CTA must lock into "Redirecting to payment…" the
  // instant a checkoutUrl comes back, and must NEVER re-enable itself —
  // closing the "slow mobile redirect looks identical to nothing
  // happened, invites a second tap" bug.

  describe('redirecting state', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
      })
    })

    it('locks the CTA to "Redirecting to payment…" and never re-enables it after a successful checkoutUrl response', async () => {
      mockCreatePaidCheckout.mockResolvedValue({
        success: true,
        bookingId: 'booking-1',
        status: 'pending_payment',
        checkoutUrl: 'https://checkout.stripe.com/session-1',
      })

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      fireEvent.click(screen.getByText('Continue to Payment'))

      const lockedButton = await screen.findByText('Redirecting to payment…')
      expect(lockedButton.closest('button')).toHaveProperty('disabled', true)
      expect(window.location.href).toBe('https://checkout.stripe.com/session-1')

      // The old, live "Continue to Payment" CTA must be gone, not merely
      // duplicated — there is only ever one CTA on screen.
      expect(screen.queryByText('Continue to Payment')).toBeNull()
    })

    it('disables the close (X) button while redirecting', async () => {
      mockCreatePaidCheckout.mockResolvedValue({
        success: true,
        bookingId: 'booking-1',
        status: 'pending_payment',
        checkoutUrl: 'https://checkout.stripe.com/session-1',
      })

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      fireEvent.click(screen.getByText('Continue to Payment'))
      await screen.findByText('Redirecting to payment…')

      const closeBtn = screen.getByLabelText('Close booking modal')
      expect(closeBtn).toHaveProperty('disabled', true)
    })
  })

  // ── "Already booked" recovery screens (docs/UX-booking-confusion-fix.md §3/§4) ──
  //
  // Regresses F3: a conflicting booking must never render the generic
  // red ErrorAlert side-by-side with a live, unrelated CTA — the exact
  // contradiction from the original bug report.

  describe('already-booked recovery', () => {
    it('shows the "Your Spot\'s on Hold" recovery panel — not the generic error banner + live retry CTA — for a pending_payment conflict', async () => {
      mockCreatePaidCheckout.mockResolvedValue({
        success: false,
        error: 'Already booked for this event',
        errorCode: 'already_booked_pending',
        existingBookingId: 'booking-existing',
        existingBookingCreatedAt: new Date().toISOString(),
      })

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      fireEvent.click(screen.getByText('Continue to Payment'))

      expect(await screen.findByText('Your Spot’s on Hold')).toBeTruthy()
      expect(screen.getByText('Resume Checkout')).toBeTruthy()
      expect(screen.getByText('Start Over')).toBeTruthy()

      // The exact contradiction from the bug report must be impossible:
      // no generic red error banner, no live re-enabled "Continue to
      // Payment" button, shown at the same time as this panel.
      expect(screen.queryByText('Already booked for this event')).toBeNull()
      expect(screen.queryByText('Continue to Payment')).toBeNull()
    })

    it('resumes checkout via resumePendingCheckout and redirects from the recovery panel', async () => {
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
      })
      mockCreatePaidCheckout.mockResolvedValue({
        success: false,
        error: 'Already booked for this event',
        errorCode: 'already_booked_pending',
        existingBookingId: 'booking-existing',
        existingBookingCreatedAt: new Date().toISOString(),
      })
      mockResumePendingCheckout.mockResolvedValue({
        success: true,
        checkoutUrl: 'https://checkout.stripe.com/session-resume',
      })

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      fireEvent.click(screen.getByText('Continue to Payment'))
      fireEvent.click(await screen.findByText('Resume Checkout'))

      await waitFor(() =>
        expect(mockResumePendingCheckout).toHaveBeenCalledWith('booking-existing'),
      )
      await waitFor(() =>
        expect(window.location.href).toBe('https://checkout.stripe.com/session-resume'),
      )
    })

    it('"Start Over" calls abandonPendingCheckout and returns to the default bookable form', async () => {
      mockCreatePaidCheckout.mockResolvedValue({
        success: false,
        error: 'Already booked for this event',
        errorCode: 'already_booked_pending',
        existingBookingId: 'booking-existing',
        existingBookingCreatedAt: new Date().toISOString(),
      })
      mockAbandonPendingCheckout.mockResolvedValue({ success: true, status: 'cancelled' })

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      fireEvent.click(screen.getByText('Continue to Payment'))
      await screen.findByText('Your Spot’s on Hold')

      fireEvent.click(screen.getByText('Start Over'))

      await waitFor(() => expect(mockAbandonPendingCheckout).toHaveBeenCalledWith('evt-1'))
      // Back to the clean default form — no recovery panel, live CTA restored.
      expect(await screen.findByText('Continue to Payment')).toBeTruthy()
      expect(screen.queryByText('Your Spot’s on Hold')).toBeNull()
      expect(
        await screen.findByText('Started over — you can book again whenever you’re ready.'),
      ).toBeTruthy()
    })

    it('shows the defensive "You\'re Already Booked" screen for a confirmed conflict', async () => {
      mockCreatePaidCheckout.mockResolvedValue({
        success: false,
        error: 'Already booked for this event',
        errorCode: 'already_booked_confirmed',
      })

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      fireEvent.click(screen.getByText('Continue to Payment'))

      expect(await screen.findByText('You’re Already Booked')).toBeTruthy()
      expect(screen.getByText('View My Booking')).toBeTruthy()
      expect(screen.queryByText('Already booked for this event')).toBeNull()
      expect(screen.queryByText('Continue to Payment')).toBeNull()
    })

    it('shows the positive "already on the list" screen — not the generic error banner + live retry CTA — for a waitlisted conflict', async () => {
      mockCreatePaidCheckout.mockResolvedValue({
        success: false,
        error: 'Already booked for this event',
        errorCode: 'already_booked_waitlisted',
      })

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      fireEvent.click(screen.getByText('Continue to Payment'))

      expect(await screen.findByText('You’re Already on the List')).toBeTruthy()
      expect(screen.getByText('View My Booking')).toBeTruthy()
      // No contradictory state: no raw error text and no live "Continue to
      // Payment" CTA co-rendered with the positive waitlist panel.
      expect(screen.queryByText('Already booked for this event')).toBeNull()
      expect(screen.queryByText('Continue to Payment')).toBeNull()
      // Not framed as an error — no red alert affordance and no
      // "Resume Checkout" / "Start Over" (there's no pending payment to
      // resume or abandon here).
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByText('Resume Checkout')).toBeNull()
      expect(screen.queryByText('Start Over')).toBeNull()
    })

    it('the "View My Booking" CTA for a waitlisted conflict links to /bookings', async () => {
      mockCreatePaidCheckout.mockResolvedValue({
        success: false,
        error: 'Already booked for this event',
        errorCode: 'already_booked_waitlisted',
      })

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      fireEvent.click(screen.getByText('Continue to Payment'))
      await screen.findByText('You’re Already on the List')

      const cta = screen.getByText('View My Booking').closest('a')
      expect(cta?.getAttribute('href')).toBe('/bookings')
    })

    // INVARIANT: the deliberate generic fallback (already_booked_other, or
    // any error without a dedicated already_booked_* panel) must still fall
    // through to the plain ErrorAlert + live retry form — this is the one
    // case where that combination is intentional, not the bug the fix
    // closes. If a future change accidentally routes this case into one of
    // the positive panels (hiding a genuine error) or, conversely, starts
    // suppressing the ErrorAlert here too, this test catches it.
    it('falls through to the generic ErrorAlert + live retry CTA for the already_booked_other fallback', async () => {
      mockCreatePaidCheckout.mockResolvedValue({
        success: false,
        error: 'Something went wrong with your booking.',
        errorCode: 'already_booked_other',
      })

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      fireEvent.click(screen.getByText('Continue to Payment'))

      expect(await screen.findByText('Something went wrong with your booking.')).toBeTruthy()
      // The CTA must still be live (re-tryable), unlike the three dedicated
      // conflict panels. Use findByText (not getByText) — the ErrorAlert
      // text and the isPending->false transition settle can land in
      // separate renders under load, so asserting on the button's final
      // label/disabled state needs its own wait, not a synchronous read
      // piggybacked on the ErrorAlert's findByText above.
      const cta = (await screen.findByText('Continue to Payment')).closest('button')
      expect(cta).toHaveProperty('disabled', false)
      // None of the three dedicated panels should render for this code.
      expect(screen.queryByText('Your Spot’s on Hold')).toBeNull()
      expect(screen.queryByText('You’re Already Booked')).toBeNull()
      expect(screen.queryByText('You’re Already on the List')).toBeNull()
    })

    // Same fallback path, reached a different way: an already_booked_pending
    // code without an existingBookingId (isRecovery requires both per the
    // ConfirmStep branching). Guards the `&& existingBookingId != null`
    // half of that condition specifically.
    it('falls through to the generic ErrorAlert when already_booked_pending has no existingBookingId', async () => {
      mockCreatePaidCheckout.mockResolvedValue({
        success: false,
        error: 'Already booked for this event',
        errorCode: 'already_booked_pending',
        // existingBookingId intentionally omitted
      })

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      fireEvent.click(screen.getByText('Continue to Payment'))

      expect(await screen.findByText('Already booked for this event')).toBeTruthy()
      expect(screen.queryByText('Your Spot’s on Hold')).toBeNull()
      // findByText, not getByText — see comment on the sibling test above;
      // the CTA's isPending settle is a separate render from the ErrorAlert
      // text appearing.
      expect(
        (await screen.findByText('Continue to Payment')).closest('button'),
      ).toHaveProperty('disabled', false)
    })

    // INVARIANT: exactly one conflict panel can ever be on screen — hitting a
    // second, different already_booked_* conflict after dismissing the first
    // must SWAP the panel, never stack it alongside the previous one (or
    // alongside the default form's live CTA). This is what stops the three
    // panels from ever being simultaneously visible / contradictory.
    it('swaps to a different conflict panel on a second attempt instead of stacking both', async () => {
      mockCreatePaidCheckout.mockResolvedValueOnce({
        success: false,
        error: 'Already booked for this event',
        errorCode: 'already_booked_waitlisted',
      })

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      fireEvent.click(screen.getByText('Continue to Payment'))
      await screen.findByText('You’re Already on the List')

      // Dismiss back to the clean default form (internal error state is
      // cleared by handleClose -> clearBookingError; isOpen stays true so
      // the tree remains mounted for this test).
      fireEvent.click(screen.getByText('Close'))
      expect(await screen.findByText('Continue to Payment')).toBeTruthy()
      expect(screen.queryByText('You’re Already on the List')).toBeNull()

      // Second attempt hits a DIFFERENT conflict type.
      mockCreatePaidCheckout.mockResolvedValueOnce({
        success: false,
        error: 'Already booked for this event',
        errorCode: 'already_booked_confirmed',
      })
      fireEvent.click(screen.getByText('Continue to Payment'))

      expect(await screen.findByText('You’re Already Booked')).toBeTruthy()
      // The first conflict's panel must be gone, not stacked underneath.
      expect(screen.queryByText('You’re Already on the List')).toBeNull()
      // And the default form's live CTA must not be co-rendered either.
      expect(screen.queryByText('Continue to Payment')).toBeNull()
    })
  })

  // ── Double-submission re-entrancy guard ──
  //
  // handleBook()'s `if (isPending || isRedirecting) return;` guard (added
  // alongside the WaitlistConflictPanel fix as defense-in-depth against
  // double-submission) is exercised end-to-end here: two real clicks on the
  // CTA must never result in two overlapping createPaidCheckout calls.
  //
  // Caveat (found via a manual mutation check — temporarily deleting the
  // guard line and re-running this test): with RTL's fireEvent synchronously
  // flushing the isPending state update via act(), the CTA's own
  // disabled={isPending || isRedirecting} attribute already blocks the DOM
  // from dispatching the second click before the guard clause is ever
  // reached, so this test passes identically with or without that line — it
  // does NOT independently pin the guard's own code path. The guard's stated
  // purpose (catching a "stray synthetic/duplicate event" that bypasses the
  // disabled attribute) isn't reachable through standard RTL
  // render+fireEvent; doing so would need to invoke the onClick handler
  // directly, bypassing the rendered DOM's disabled state. Kept as
  // regression coverage for the observable double-click behaviour; flagged
  // in the handover as a testability gap rather than closed silently.
  describe('double-submission guard', () => {
    // INVARIANT: a rapid double-tap (or a stray duplicate synthetic event)
    // on the CTA must never result in two overlapping createPaidCheckout
    // calls — that would risk two concurrent bookings/checkout sessions for
    // the same attempt.
    it('calls createPaidCheckout exactly once when the CTA is clicked twice in rapid succession', async () => {
      let resolveCheckout!: (value: unknown) => void
      mockCreatePaidCheckout.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCheckout = resolve
          }),
      )

      render(
        <BookingModal
          event={makeEvent({ price: 3500 })}
          isOpen={true}
          onClose={vi.fn()}
          userName="Charlotte"
        />,
      )

      const cta = screen.getByText('Continue to Payment')
      fireEvent.click(cta)
      // Second tap before the first createPaidCheckout call has resolved —
      // exercises the handler-level guard directly, not just the CTA's
      // disabled attribute (which may or may not have re-rendered yet).
      fireEvent.click(cta)

      resolveCheckout({
        success: true,
        bookingId: 'booking-1',
        status: 'pending_payment',
        checkoutUrl: 'https://checkout.stripe.com/session-1',
      })

      await waitFor(() => expect(mockCreatePaidCheckout).toHaveBeenCalled())
      expect(mockCreatePaidCheckout).toHaveBeenCalledTimes(1)
    })
  })
})
