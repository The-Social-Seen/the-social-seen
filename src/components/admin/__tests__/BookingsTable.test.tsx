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
  profile: {
    id: string
    full_name: string
    email: string
    avatar_url: string | null
  } | null
}

const booking = (overrides: Partial<TestBooking> = {}): TestBooking => ({
  id: 'bk-1',
  status: 'confirmed',
  waitlist_position: null,
  booked_at: '2026-04-10T12:00:00.000Z',
  created_at: '2026-04-10T12:00:00.000Z',
  profile: {
    id: 'usr-1',
    full_name: 'Charlotte Davis',
    email: 'charlotte@example.com',
    avatar_url: null,
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
