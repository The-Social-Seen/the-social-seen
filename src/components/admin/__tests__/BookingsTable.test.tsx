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
  reinstateCancelledBooking: vi.fn(),
  releaseReinstatedHold: vi.fn(),
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
  // Admin reinstate-cancelled-booking mechanism (SYSTEM-DESIGN-admin-
  // reinstate-cancelled-booking.md §4.8) — mirrors the real BookingRow
  // shape's new field.
  cancellation_reason?: string | null
  // admin waitlist-promotion / payment-remediation / cancelled-
  // reinstatement hold mechanism — non-optional, matches the real
  // BookingRow shape (DB: NOT NULL DEFAULT false).
  is_admin_hold: boolean
  admin_hold_expires_at: string | null
  profile: {
    id: string
    full_name: string
    email: string
    avatar_url: string | null
    phone_number: string | null
    gender?: 'female' | 'male' | 'non_binary' | 'prefer_not_to_say' | null
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
// gender abbreviation, rendered inline next to the attendee's name in both
// the desktop Name column and the mobile card's name line (moved from next
// to the phone number — gender describes the person, not their phone
// number) — never a new column or `<dt>` row.
// ════════════════════════════════════════════════════════════════════════════

describe('BookingsTable — gender abbreviation (desktop + mobile, inline with name)', () => {
  it.each([
    ['female', 'F'],
    ['male', 'M'],
    ['non_binary', 'NB'],
  ] as const)('renders "(%s)" as "(%s)" in both the desktop table and mobile card', (gender, code) => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ profile: { id: 'usr-1', full_name: 'Charlotte Davis', email: 'charlotte@example.com', avatar_url: null, phone_number: '+44 7700 900123', gender } })]}
        eventId="evt-1"
      />
    )
    const desktopCell = container.querySelector(
      'div.hidden.md\\:block td.font-medium.text-text-primary'
    ) as HTMLElement
    const mobileName = container.querySelector(
      'ul.md\\:hidden p.font-medium.text-text-primary'
    ) as HTMLElement
    expect(desktopCell.textContent).toContain(`(${code})`)
    expect(mobileName.textContent).toContain(`(${code})`)
  })

  it('renders nothing (no glyph) for a null gender', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ profile: { id: 'usr-1', full_name: 'Charlotte Davis', email: 'charlotte@example.com', avatar_url: null, phone_number: '+44 7700 900123', gender: null } })]}
        eventId="evt-1"
      />
    )
    expect(container.textContent).not.toMatch(/\((F|M|NB)\)/)
  })

  it('renders nothing (no glyph) for prefer_not_to_say', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ profile: { id: 'usr-1', full_name: 'Charlotte Davis', email: 'charlotte@example.com', avatar_url: null, phone_number: '+44 7700 900123', gender: 'prefer_not_to_say' } })]}
        eventId="evt-1"
      />
    )
    expect(container.textContent).not.toMatch(/\((F|M|NB)\)/)
  })

  it('renders nothing (no glyph) when gender is absent from the profile object entirely (undefined)', () => {
    const { container } = render(
      <BookingsTable bookings={[booking()]} eventId="evt-1" />
    )
    expect(container.textContent).not.toMatch(/\((F|M|NB)\)/)
  })

  it('exposes the full word to assistive tech via aria-label (e.g. "Female", not just "F")', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ profile: { id: 'usr-1', full_name: 'Charlotte Davis', email: 'charlotte@example.com', avatar_url: null, phone_number: '+44 7700 900123', gender: 'female' } })]}
        eventId="evt-1"
      />
    )
    const labelled = container.querySelectorAll('[aria-label="Female"]')
    expect(labelled.length).toBeGreaterThan(0)
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

// ════════════════════════════════════════════════════════════════════════════
// showReinstate / showReleaseReinstatement / narrowed showDemote — three-way
// mutual exclusivity (SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md
// §4.8, flagged as needing dedicated coverage by the architect's own "Test
// surface" note). The three booleans must never render together for the
// SAME row shape: a reinstated-origin hold shows Release-Reinstatement but
// NOT Demote; a waitlist-promotion/payment-remediation-origin hold shows
// Demote but NOT Release-Reinstatement; a genuinely-reaped cancelled row
// shows Reinstate; an event-cancelled row does NOT show Reinstate.
// ════════════════════════════════════════════════════════════════════════════

describe('BookingsTable — showReinstate visibility (isPaidEvent && cancelled && !cancellation_reason && cancelled_at && !stripe_payment_id && refunded=0)', () => {
  it('renders "Reinstate" for a genuinely-reaped cancelled row on a PAID event (desktop + mobile)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'cancelled',
            cancelled_at: '2026-08-08T10:00:00.000Z',
            cancellation_reason: null,
            stripe_payment_id: null,
            refunded_amount_pence: 0,
          }),
        ]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    const desktopTable = container.querySelector('div.hidden.md\\:block table') as HTMLElement
    const mobileCard = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(desktopTable.textContent).toContain('Reinstate')
    expect(mobileCard.textContent).toContain('Reinstate')
  })

  it('does NOT render "Reinstate" on a FREE event (isPaidEvent=false) even for an otherwise-eligible cancelled row', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'cancelled',
            cancelled_at: '2026-08-08T10:00:00.000Z',
            cancellation_reason: null,
            stripe_payment_id: null,
            refunded_amount_pence: 0,
          }),
        ]}
        eventId="evt-1"
      />,
    )
    expect(container.textContent).not.toContain('Reinstate')
  })

  it('INVARIANT: does NOT render "Reinstate" for an event-cancelled row (cancellation_reason IS NOT NULL — the event-cancellation origin, NOT a reap)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'cancelled',
            cancelled_at: '2026-08-08T10:00:00.000Z',
            cancellation_reason: 'Event was cancelled by admin',
            stripe_payment_id: null,
            refunded_amount_pence: 0,
          }),
        ]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    expect(container.textContent).not.toContain('Reinstate')
  })

  it('does NOT render "Reinstate" when cancelled_at is NULL (the createPaidCheckout/abandonPendingCheckout rollback shape — not a reap)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'cancelled',
            cancelled_at: null,
            cancellation_reason: null,
            stripe_payment_id: null,
            refunded_amount_pence: 0,
          }),
        ]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    expect(container.textContent).not.toContain('Reinstate')
  })

  it('does NOT render "Reinstate" when the row already has a stripe_payment_id (a paid-then-refunded-adjacent shape, never reinstatable)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'cancelled',
            cancelled_at: '2026-08-08T10:00:00.000Z',
            cancellation_reason: null,
            stripe_payment_id: 'pi_old_payment',
            refunded_amount_pence: 0,
          }),
        ]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    expect(container.textContent).not.toContain('Reinstate')
  })

  it('does NOT render "Reinstate" when the row was refunded (refunded_amount_pence > 0)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'cancelled',
            cancelled_at: '2026-08-08T10:00:00.000Z',
            cancellation_reason: null,
            stripe_payment_id: null,
            refunded_amount_pence: 5000,
          }),
        ]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    expect(container.textContent).not.toContain('Reinstate')
  })

  it('does NOT render "Reinstate" for a non-cancelled row (e.g. confirmed) even with a stray cancelled_at', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'confirmed',
            cancelled_at: '2026-08-08T10:00:00.000Z',
            cancellation_reason: null,
          }),
        ]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    expect(container.textContent).not.toContain('Reinstate')
  })
})

describe('BookingsTable — CancelledInfo ("Cancelled N ago" + reason)', () => {
  it('shows "Cancelled ... ago" for a cancelled row with cancelled_at, with no "Reason:" line when cancellation_reason is null', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'cancelled',
            cancelled_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            cancellation_reason: null,
          }),
        ]}
        eventId="evt-1"
      />,
    )
    expect(container.textContent).toMatch(/Cancelled .* ago/)
    expect(container.textContent).not.toContain('Reason:')
  })

  it('shows the "Reason:" line when cancellation_reason is present (event-cancellation origin)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'cancelled',
            cancelled_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            cancellation_reason: 'Event was cancelled by admin',
          }),
        ]}
        eventId="evt-1"
      />,
    )
    expect(container.textContent).toContain('Reason: Event was cancelled by admin')
  })

  it('renders nothing for a cancelled row with no cancelled_at (rollback shape, not a reap/cancellation)', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'cancelled', cancelled_at: null })]}
        eventId="evt-1"
      />,
    )
    expect(container.textContent).not.toMatch(/Cancelled .* ago/)
  })

  it('renders nothing for a non-cancelled row even if cancelled_at happens to be set', () => {
    const { container } = render(
      <BookingsTable
        bookings={[booking({ status: 'confirmed', cancelled_at: '2026-08-08T10:00:00.000Z' })]}
        eventId="evt-1"
      />,
    )
    expect(container.textContent).not.toMatch(/Cancelled .* ago/)
  })
})

describe('BookingsTable — THREE-WAY MUTUAL EXCLUSIVITY: showDemote / showReinstate / showReleaseReinstatement', () => {
  it('INVARIANT: a reinstated-origin hold (is_admin_hold + pending_payment + cancelled_at SET) shows "Cancel Reinstatement" but NOT "Move to Waitlist"', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'pending_payment',
            is_admin_hold: true,
            cancelled_at: '2026-08-08T10:00:00.000Z', // origin marker (design doc §3.2/§3.3)
          }),
        ]}
        eventId="evt-1"
      />,
    )
    expect(container.textContent).toContain('Cancel Reinstatement')
    expect(container.textContent).not.toContain('Move to Waitlist')
  })

  it('INVARIANT: a waitlist-promotion/payment-remediation-origin hold (is_admin_hold + pending_payment + cancelled_at NULL) shows "Move to Waitlist" but NOT "Cancel Reinstatement"', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'pending_payment',
            is_admin_hold: true,
            cancelled_at: null, // no origin marker — NOT a reinstatement
          }),
        ]}
        eventId="evt-1"
      />,
    )
    expect(container.textContent).toContain('Move to Waitlist')
    expect(container.textContent).not.toContain('Cancel Reinstatement')
  })

  it('a genuinely-reaped cancelled row shows "Reinstate" but NEITHER "Move to Waitlist" NOR "Cancel Reinstatement"', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'cancelled',
            cancelled_at: '2026-08-08T10:00:00.000Z',
            cancellation_reason: null,
            stripe_payment_id: null,
            refunded_amount_pence: 0,
            is_admin_hold: false,
          }),
        ]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    expect(container.textContent).toContain('Reinstate')
    expect(container.textContent).not.toContain('Move to Waitlist')
    expect(container.textContent).not.toContain('Cancel Reinstatement')
  })

  it('an event-cancelled row (cancellation_reason set) shows NONE of the three action buttons', () => {
    const { container } = render(
      <BookingsTable
        bookings={[
          booking({
            status: 'cancelled',
            cancelled_at: '2026-08-08T10:00:00.000Z',
            cancellation_reason: 'Event was cancelled by admin',
            stripe_payment_id: null,
            refunded_amount_pence: 0,
            is_admin_hold: false,
          }),
        ]}
        eventId="evt-1"
        isPaidEvent
      />,
    )
    expect(container.textContent).not.toContain('Reinstate')
    expect(container.textContent).not.toContain('Move to Waitlist')
    expect(container.textContent).not.toContain('Cancel Reinstatement')
  })

  it('CROSS-CHECK: across all four row shapes in this suite, at most ONE of the three buttons ever renders for a single row', () => {
    const shapes: Array<Partial<TestBooking>> = [
      { status: 'pending_payment', is_admin_hold: true, cancelled_at: '2026-08-08T10:00:00.000Z' },
      { status: 'pending_payment', is_admin_hold: true, cancelled_at: null },
      {
        status: 'cancelled',
        cancelled_at: '2026-08-08T10:00:00.000Z',
        cancellation_reason: null,
        stripe_payment_id: null,
        refunded_amount_pence: 0,
        is_admin_hold: false,
      },
      {
        status: 'cancelled',
        cancelled_at: '2026-08-08T10:00:00.000Z',
        cancellation_reason: 'Event was cancelled by admin',
        stripe_payment_id: null,
        refunded_amount_pence: 0,
        is_admin_hold: false,
      },
    ]

    for (const shape of shapes) {
      const { container } = render(
        <BookingsTable bookings={[booking(shape)]} eventId="evt-1" isPaidEvent />,
      )
      // NOTE: 'Reinstate' is a literal SUBSTRING of 'Cancel Reinstatement'
      // ("Reinstate" + "ment") — a naive `.includes('Reinstate')` would
      // double-count a row that only renders the "Cancel Reinstatement"
      // button. Match on actual <button> element text instead, which is
      // exactly one of the three literal labels with no overlap risk.
      const buttonLabels = [...container.querySelectorAll('button')]
        .map((b) => b.textContent?.trim())
        .filter((t): t is string =>
          t === 'Move to Waitlist' || t === 'Cancel Reinstatement' || t === 'Reinstate',
        )
      expect(buttonLabels.length).toBeLessThanOrEqual(2) // desktop + mobile copy of the SAME button
      expect(new Set(buttonLabels).size).toBeLessThanOrEqual(1) // but never TWO DIFFERENT labels
    }
  })
})
