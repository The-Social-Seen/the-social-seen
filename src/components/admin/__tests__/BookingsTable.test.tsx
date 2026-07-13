// @vitest-environment jsdom
//
// Viewport + filter-tab + touch-target tests for the admin BookingsTable.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/app/(admin)/admin/actions', () => ({
  exportEventAttendeesCSV: vi.fn(),
  setNoShow: vi.fn(),
  promoteFromWaitlist: vi.fn(),
  sendPaymentLinkForConfirmedBooking: vi.fn(),
  demoteAdminHold: vi.fn(),
}))

import BookingsTable from '../BookingsTable'

interface TestBooking {
  id: string
  status: string
  waitlist_position: number | null
  booked_at: string
  created_at: string
  stripe_payment_id?: string | null
  stripe_refund_id?: string | null
  refunded_amount_pence?: number | null
  cancelled_at?: string | null
  // admin waitlist-promotion / payment-remediation hold mechanism —
  // non-optional, matches the real BookingRow shape (DB: NOT NULL DEFAULT false).
  is_admin_hold: boolean
  admin_hold_expires_at: string | null
  profile: {
    id: string
    full_name: string
    email: string
    avatar_url: string | null
    phone_number: string | null
  } | null
}

const booking = (overrides: Partial<TestBooking> = {}): TestBooking => ({
  id: 'bk-1',
  status: 'confirmed',
  waitlist_position: null,
  booked_at: '2026-04-10T12:00:00.000Z',
  created_at: '2026-04-10T12:00:00.000Z',
  is_admin_hold: false,
  admin_hold_expires_at: null,
  profile: {
    id: 'usr-1',
    full_name: 'Charlotte Davis',
    email: 'charlotte@example.com',
    avatar_url: null,
    phone_number: null,
  },
  ...overrides,
})

describe('BookingsTable — mobile pass', () => {
  it('renders BOTH the desktop table and the mobile card list', () => {
    const { container } = render(
      <BookingsTable bookings={[booking()]} eventId="evt-1" />
    )
    expect(container.querySelector('div.hidden.md\\:block table')).toBeTruthy()
    expect(container.querySelector('ul.md\\:hidden')).toBeTruthy()
    expect(container.querySelectorAll('ul.md\\:hidden li').length).toBe(1)
  })

  it('mobile card surfaces attendee name, email, and confirmed status badge', () => {
    const { container } = render(
      <BookingsTable bookings={[booking()]} eventId="evt-1" />
    )
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(card.textContent).toContain('Charlotte Davis')
    expect(card.textContent).toContain('charlotte@example.com')
    expect(card.textContent).toContain('Confirmed')
  })

  it('every filter tab pill has min-h-[44px] for mobile touch-target compliance', () => {
    const { container } = render(
      <BookingsTable bookings={[booking()]} eventId="evt-1" />
    )
    // Tabs are direct children of the segmented control container.
    const tabBar = container.querySelector('div.bg-bg-secondary.rounded-lg.p-1') as HTMLElement
    expect(tabBar).toBeTruthy()
    const tabs = tabBar.querySelectorAll('button')
    expect(tabs.length).toBe(5) // All / Confirmed / Waitlisted / Cancelled / No-shows
    tabs.forEach((tab) => {
      expect(tab.className).toContain('min-h-[44px]')
    })
  })

  it('uses the "Waitlist" mobile-shortened label and "Waitlisted" desktop label for the same tab', () => {
    const { container } = render(
      <BookingsTable bookings={[booking({ status: 'waitlisted', waitlist_position: 1 })]} eventId="evt-1" />
    )
    const tabBar = container.querySelector('div.bg-bg-secondary.rounded-lg.p-1') as HTMLElement
    // Find the waitlisted tab — it's the third one.
    const tabs = tabBar.querySelectorAll('button')
    const waitlistTab = [...tabs].find((t) => t.textContent?.includes('Waitlist')) as HTMLElement
    expect(waitlistTab).toBeTruthy()
    // Both labels exist in the DOM, one visible per breakpoint via md:hidden / hidden md:inline.
    const mobileSpan = waitlistTab.querySelector('span.md\\:hidden')
    const desktopSpan = waitlistTab.querySelector('span.hidden.md\\:inline')
    expect(mobileSpan?.textContent).toBe('Waitlist')
    expect(desktopSpan?.textContent).toBe('Waitlisted')
  })

  it('mobile card for a waitlisted booking shows full-width Promote button (44px)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'waitlisted', waitlist_position: 3 })]}
        eventId="evt-1"
      />
    )
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    const actionRow = card.querySelector('div.border-t') as HTMLElement
    expect(actionRow).toBeTruthy()
    const promoteBtn = actionRow.querySelector('button') as HTMLElement
    expect(promoteBtn).toBeTruthy()
    expect(promoteBtn.textContent).toContain('Promote')
    // Full-width prop applies w-full + min-h-[44px].
    expect(promoteBtn.className).toContain('w-full')
    expect(promoteBtn.className).toContain('min-h-[44px]')
  })

  it('switching filter tabs hides bookings that do not match', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({ id: 'bk-c', status: 'confirmed' }),
          booking({
            id: 'bk-w',
            status: 'waitlisted',
            waitlist_position: 1,
            profile: {
              id: 'usr-2',
              full_name: 'James Hartley',
              email: 'james@example.com',
              avatar_url: null,
              phone_number: null,
            },
          }),
        ]}
        eventId="evt-1"
      />
    )
    // All tab — both visible.
    const mobileList = container.querySelector('ul.md\\:hidden')!
    expect(mobileList.querySelectorAll('li').length).toBe(2)

    // Click the "Confirmed" tab.
    // Each tab has two text spans (mobile + desktop variants), so
    // textContent ends up like "ConfirmedConfirmed" — match by includes.
    const tabBar = container.querySelector('div.bg-bg-secondary.rounded-lg.p-1') as HTMLElement
    const confirmedTab = [...tabBar.querySelectorAll('button')].find(
      (t) => (t.textContent ?? '').includes('Confirmed')
    )!
    expect(confirmedTab).toBeTruthy()
    fireEvent.click(confirmedTab)

    // Only the confirmed booking remains — the waitlisted one disappears.
    const updatedList = container.querySelector('ul.md\\:hidden')!
    expect(updatedList.querySelectorAll('li').length).toBe(1)
    expect(updatedList.textContent).toContain('Charlotte Davis')
    expect(updatedList.textContent).not.toContain('James Hartley')
  })

  it('renders empty-state copy when no bookings match the active filter', () => {
    render(<BookingsTable bookings={[]} eventId="evt-1" />)
    expect(screen.getByText(/no bookings found/i)).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// showSendPaymentLink / showDemote visibility (SYSTEM-DESIGN-admin-
// waitlist-promotion-payment.md Addendum §C.1) — flagged by the
// Addendum's own "Test surface" note as needing dedicated coverage.
// ════════════════════════════════════════════════════════════════════════════

describe('BookingsTable — showSendPaymentLink visibility (isPaidEvent && confirmed && !stripe_payment_id)', () => {
  it('renders "Send Payment Link" on a PAID event for a confirmed, unpaid booking (desktop + mobile)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'confirmed', stripe_payment_id: null })]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    const desktopTable = container.querySelector('div.hidden.md\\:block table') as HTMLElement
    const mobileCard = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(desktopTable.textContent).toContain('Send Payment Link')
    expect(mobileCard.textContent).toContain('Send Payment Link')
  })

  it('does NOT render "Send Payment Link" when the booking already has a stripe_payment_id (already paid — the double-charge guard reflected in the UI)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'confirmed', stripe_payment_id: 'pi_already_paid' })]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    expect(container.textContent).not.toContain('Send Payment Link')
  })

  it('does NOT render "Send Payment Link" on a FREE event (isPaidEvent=false / default) even for a confirmed, unpaid booking', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'confirmed', stripe_payment_id: null })]}
        eventId="evt-1"
      />,
    )
    expect(container.textContent).not.toContain('Send Payment Link')
  })

  it('does NOT render "Send Payment Link" for a waitlisted booking on a paid event (wrong status — Promote is the correct action there instead)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'waitlisted', waitlist_position: 1, stripe_payment_id: null })]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    expect(container.textContent).not.toContain('Send Payment Link')
    expect(container.textContent).toContain('Promote')
  })

  it('does NOT render "Send Payment Link" for a cancelled booking on a paid event', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'cancelled', stripe_payment_id: null })]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    expect(container.textContent).not.toContain('Send Payment Link')
  })
})

describe('BookingsTable — showDemote visibility (is_admin_hold===true && status==="pending_payment")', () => {
  it('renders "Move to Waitlist" for an active admin hold (desktop + mobile)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'pending_payment', is_admin_hold: true })]}
        eventId="evt-1"
      />,
    )
    const desktopTable = container.querySelector('div.hidden.md\\:block table') as HTMLElement
    const mobileCard = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(desktopTable.textContent).toContain('Move to Waitlist')
    expect(mobileCard.textContent).toContain('Move to Waitlist')
  })

  it('does NOT render "Move to Waitlist" for an ORDINARY pending_payment row (is_admin_hold=false — a normal in-flight self-service checkout, not an admin hold)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'pending_payment', is_admin_hold: false })]}
        eventId="evt-1"
      />,
    )
    expect(container.textContent).not.toContain('Move to Waitlist')
  })

  it('does NOT render "Move to Waitlist" when is_admin_hold=true but status has already moved on (defence in depth — requires BOTH conditions, matches the DB CHECK constraint invariant that is_admin_hold=true implies status=pending_payment)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'confirmed', is_admin_hold: true })]}
        eventId="evt-1"
      />,
    )
    expect(container.textContent).not.toContain('Move to Waitlist')
  })

  it('showDemote is origin-agnostic in the UI too — renders identically regardless of which flow created the hold (the component has no notion of "origin", only the two DB columns)', () => {
    // BookingRow doesn't carry an "origin" field at all — is_admin_hold +
    // status is the WHOLE predicate, exactly mirroring
    // admin_revert_hold_to_waitlist's own origin-agnostic SQL predicate.
    const { container: promotionOrigin } = render(
      <BookingsTable
        bookings={[booking({ status: 'pending_payment', is_admin_hold: true, waitlist_position: 2 })]}
        eventId="evt-1"
      />,
    )
    const { container: remediationOrigin } = render(
      <BookingsTable
        bookings={[booking({ status: 'pending_payment', is_admin_hold: true, waitlist_position: null })]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    expect(promotionOrigin.textContent).toContain('Move to Waitlist')
    expect(remediationOrigin.textContent).toContain('Move to Waitlist')
  })
})

describe('BookingsTable — mobile hasAction includes the two new buttons', () => {
  it('shows the mobile action row (border-t) when ONLY showSendPaymentLink is true (no promote/no-show applicable)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'confirmed', stripe_payment_id: null })]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(card.querySelector('div.border-t')).toBeTruthy()
  })

  it('shows the mobile action row (border-t) when ONLY showDemote is true', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'pending_payment', is_admin_hold: true })]}
        eventId="evt-1"
      />,
    )
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(card.querySelector('div.border-t')).toBeTruthy()
  })

  it('omits the mobile action row entirely for a plain confirmed booking on a free event (no action applies)', () => {
    const { container } = render(
      <BookingsTable bookings={[booking({ status: 'confirmed' })]} eventId="evt-1" />,
    )
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(card.querySelector('div.border-t')).toBeNull()
  })
})

describe('BookingsTable — known interaction: past+paid+confirmed+unpaid renders BOTH NoShowButton and SendPaymentLinkButton (documented, not a crash)', () => {
  // Flagged by the frontend-developer as a product/UX question, not a
  // correctness bug — the 5 button-visibility conditions are NOT fully
  // mutually exclusive for this one edge case (a past paid event where a
  // confirmed booking was never charged). This test pins the CURRENT
  // actual behaviour so a future change here is a deliberate, visible
  // diff rather than a silent regression either way.
  it('both "No-show" and "Send Payment Link" render simultaneously for a past, paid, confirmed, unpaid booking', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'confirmed', stripe_payment_id: null })]}
        eventId="evt-1"
        isPastEvent
        isPaidEvent
      />,
    )
    const desktopRow = container.querySelector('div.hidden.md\\:block table tbody tr') as HTMLElement
    expect(desktopRow.textContent).toContain('No-show')
    expect(desktopRow.textContent).toContain('Send Payment Link')
  })
})
