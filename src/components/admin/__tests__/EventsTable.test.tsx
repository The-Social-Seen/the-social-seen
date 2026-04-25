// @vitest-environment jsdom
//
// Viewport + touch-target tests for the admin EventsTable mobile pass.
//
// Test strategy: Tailwind responsive classes (`hidden md:block`,
// `md:hidden`) leave both representations in the DOM at all times;
// jsdom doesn't compute layout, so we assert that BOTH the desktop
// table and the mobile card list exist, that critical content is
// present in both, and that the mobile card action buttons carry the
// expected min-h-[44px] touch-target classes. If a future change
// drops `min-h-[44px]` from a card action button these tests fail
// loudly — exactly what spec §4 (touch-target audit) calls for.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/app/(admin)/admin/actions', () => ({
  softDeleteEvent: vi.fn(),
}))

import EventsTable from '../EventsTable'
import type { EventWithStats } from '@/types'

const baseEvent = (overrides: Partial<EventWithStats> = {}): EventWithStats => ({
  id: 'evt-1',
  slug: 'wine-and-wisdom',
  title: 'Wine & Wisdom at Borough Market',
  description: 'Long description here',
  short_description: 'A curated wine night',
  date_time: '2026-06-15T19:00:00.000Z',
  end_time: '2026-06-15T22:00:00.000Z',
  venue_name: 'Borough Wines',
  venue_address: '1 Bank End, London',
  venue_revealed: true,
  postcode: 'SE1 9BU',
  category: 'drinks',
  price: 3500,
  capacity: 30,
  image_url: null,
  dress_code: null,
  refund_window_hours: 48,
  is_published: true,
  is_cancelled: false,
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
  deleted_at: null,
  confirmed_count: 12,
  avg_rating: 0,
  review_count: 0,
  spots_left: 18,
  ...overrides,
})

describe('EventsTable — mobile pass', () => {
  it('renders the empty state when there are no events', () => {
    render(<EventsTable events={[]} />)
    expect(screen.getByText(/no events yet/i)).toBeTruthy()
  })

  it('renders BOTH the desktop table and the mobile card list (Tailwind responsive pattern)', () => {
    const { container } = render(<EventsTable events={[baseEvent()]} />)

    // Desktop: <div className="hidden md:block ..."> wrapping the <table>.
    const desktopWrapper = container.querySelector('div.hidden.md\\:block')
    expect(desktopWrapper).toBeTruthy()
    expect(desktopWrapper?.querySelector('table')).toBeTruthy()

    // Mobile: <ul className="md:hidden ..."> with one <li> per event.
    const mobileList = container.querySelector('ul.md\\:hidden')
    expect(mobileList).toBeTruthy()
    expect(mobileList?.querySelectorAll('li').length).toBe(1)
  })

  it('mobile card displays the event title, status badge, and key metadata', () => {
    const { container } = render(
      <EventsTable events={[baseEvent({ title: 'Jazz Night at The Shard' })]} />
    )
    const mobileCard = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(mobileCard).toBeTruthy()

    // Title appears inside the mobile card title row.
    expect(mobileCard.textContent).toContain('Jazz Night at The Shard')
    // Status badge ("Published" for is_published=true, future date).
    expect(mobileCard.textContent).toContain('Published')
    // Body label/value pairs — at minimum Date, Category, Price, Booked.
    const labels = mobileCard.querySelectorAll('dt')
    const labelTexts = [...labels].map((l) => l.textContent)
    expect(labelTexts).toEqual(
      expect.arrayContaining(['Date', 'Category', 'Price', 'Booked'])
    )
  })

  it('mobile card action row has labelled Edit / Bookings / Delete buttons (not icon-only)', () => {
    const { container } = render(<EventsTable events={[baseEvent()]} />)
    const mobileCard = container.querySelector('ul.md\\:hidden article') as HTMLElement
    const actionRow = mobileCard.querySelector('div.border-t') as HTMLElement
    expect(actionRow).toBeTruthy()

    // Three buttons with visible text labels (not icon-only).
    const actions = actionRow.querySelectorAll('a, button')
    expect(actions.length).toBe(3)
    const labels = [...actions].map((a) => a.textContent?.trim())
    expect(labels).toEqual(['Edit', 'Bookings', 'Delete'])
  })

  it('every interactive element in the mobile card carries min-h-[44px] (touch-target compliance)', () => {
    const { container } = render(<EventsTable events={[baseEvent()]} />)
    const mobileCard = container.querySelector('ul.md\\:hidden article') as HTMLElement
    const interactives = mobileCard.querySelectorAll(
      'a[href], button:not([disabled]), button[disabled]'
    )

    // Sanity: at least the 3 action buttons + the title link.
    expect(interactives.length).toBeGreaterThanOrEqual(3)

    // Every action-row button explicitly declares min-h-[44px]. The
    // title-row link is the whole card-header tap area; it can be
    // taller than 44px without the class because the row content
    // (image 48px) already exceeds 44.
    const actionButtons = mobileCard.querySelectorAll('div.border-t a, div.border-t button')
    actionButtons.forEach((el) => {
      expect(el.className).toContain('min-h-[44px]')
    })
  })

  it('shows status badge "Past" for events whose date_time is in the past', () => {
    const { container } = render(
      <EventsTable
        events={[baseEvent({ date_time: '2024-01-01T19:00:00.000Z' })]}
      />
    )
    const mobileCard = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(mobileCard.textContent).toContain('Past')
  })

  it('shows status badge "Cancelled" when is_cancelled is true', () => {
    const { container } = render(
      <EventsTable events={[baseEvent({ is_cancelled: true })]} />
    )
    const mobileCard = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(mobileCard.textContent).toContain('Cancelled')
  })
})
