// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { EventWithStats } from '@/types'

// ── Mocks ──────────────────────────────────────────────────────────────────────

function filterDomProps(props: Record<string, unknown>) {
  const invalid = [
    'variants', 'initial', 'animate', 'exit', 'whileInView', 'viewport',
    'transition', 'custom', 'whileHover', 'layout', 'mode',
  ]
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!invalid.includes(key)) filtered[key] = value
  }
  return filtered
}

vi.mock('framer-motion', () => ({
  motion: {
    article: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <article {...filterDomProps(props)}>{children}</article>
    ),
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...filterDomProps(props)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string; [key: string]: unknown }) => (
    <img alt={alt} src={src} />
  ),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

const mockRouterReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

import EventsPageClient from '../EventsPageClient'

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EventWithStats> = {}): EventWithStats {
  return {
    id: 'evt-default',
    slug: 'test-event',
    title: 'Test Event',
    description: 'A test event',
    short_description: 'Test',
    date_time: '2036-01-01T19:00:00Z',
    end_time: '2036-01-01T22:00:00Z',
    venue_name: 'Test Venue',
    venue_address: '1 London Rd',
    venue_revealed: true,
    postcode: null,
    price: 0,
    capacity: 30,
    image_url: 'https://example.com/test.jpg',
    dress_code: null,
    refund_window_hours: 48,
    is_published: true,
    is_cancelled: false,
    external_attendees: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    confirmed_count: 10,
    total_attending: 10,
    revenue_collected: 0,
    avg_rating: 0,
    review_count: 0,
    spots_left: 20,
    primary_tag: { slug: 'drinks-bars', label: 'Drinks & Bars' },
    ...overrides,
  }
}

// F1a: each fixture carries the matching primary_tag for its event.
// Filter logic now keys off primary_tag.slug, so the per-event tag must
// match what the chip filter expects.
const testEvents: EventWithStats[] = [
  makeEvent({
    id: 'e1', slug: 'wine-tasting', title: 'Wine Tasting',
    price: 0, date_time: '2036-01-01T19:00:00Z',
    primary_tag: { slug: 'drinks-bars', label: 'Drinks & Bars' },
  }),
  makeEvent({
    id: 'e2', slug: 'fine-dining', title: 'Fine Dining',
    price: 5000, date_time: '2036-02-01T19:00:00Z',
    primary_tag: { slug: 'dining-supper-clubs', label: 'Dining & Supper Clubs' },
  }),
  makeEvent({
    id: 'e3', slug: 'art-show', title: 'Art Show',
    price: 3000, date_time: '2036-03-01T19:00:00Z',
    primary_tag: { slug: 'galleries-museums', label: 'Galleries & Museums' },
  }),
  makeEvent({
    id: 'e4', slug: 'workshops-event', title: 'Free Workshops',
    price: 0, date_time: '2036-04-01T19:00:00Z',
    primary_tag: { slug: 'workshops-masterclasses', label: 'Workshops & Masterclasses' },
  }),
]

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.setSystemTime(new Date('2026-04-11T12:00:00Z'))
  mockRouterReplace.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('EventsPageClient', () => {
  it('T4-1: shows all events when no filter is active', () => {
    render(<EventsPageClient events={testEvents} />)

    expect(screen.getByText('Wine Tasting')).toBeTruthy()
    expect(screen.getByText('Fine Dining')).toBeTruthy()
    expect(screen.getByText('Art Show')).toBeTruthy()
    expect(screen.getByText('Free Workshops')).toBeTruthy()
  })

  it('T4-2 (F1a): primary-tag filter "Dining & Supper Clubs" shows only matching events', () => {
    render(<EventsPageClient events={testEvents} />)

    // Click the Dining & Supper Clubs filter pill — it's the chip in the
    // filter bar, not a card label (cards render the same label too).
    const diningChips = screen.getAllByText('Dining & Supper Clubs')
    fireEvent.click(diningChips[0])

    expect(screen.getByText('Fine Dining')).toBeTruthy()
    expect(screen.queryByText('Wine Tasting')).toBeNull()
    expect(screen.queryByText('Art Show')).toBeNull()
    expect(screen.queryByText('Free Workshops')).toBeNull()
  })

  it('T4-2b (F1a): clicking a tag chip pushes ?tag=<slug> to the URL', () => {
    render(<EventsPageClient events={testEvents} />)

    const diningChips = screen.getAllByText('Dining & Supper Clubs')
    fireEvent.click(diningChips[0])

    expect(mockRouterReplace).toHaveBeenCalledWith(
      '/events?tag=dining-supper-clubs',
      { scroll: false },
    )
  })

  it('T4-2c (F1a): initialTag prop pre-selects the matching chip', () => {
    render(<EventsPageClient events={testEvents} initialTag="galleries-museums" />)

    // Only the Art Show event should be visible (its primary_tag.slug
    // matches the initial filter).
    expect(screen.getByText('Art Show')).toBeTruthy()
    expect(screen.queryByText('Wine Tasting')).toBeNull()
    expect(screen.queryByText('Fine Dining')).toBeNull()
  })

  it('T4-3: price filter Free shows only free events', () => {
    render(<EventsPageClient events={testEvents} />)

    // "Free" appears on both the filter button and EventCard price.
    // The filter buttons are in a specific container — use getAllByText and pick the filter pill.
    const freeButtons = screen.getAllByText('Free')
    // The price filter button is the one in the price filter bar
    const filterButton = freeButtons.find(
      (el) => el.tagName === 'BUTTON' && el.className.includes('min-h-[44px]')
    )!
    fireEvent.click(filterButton)

    expect(screen.getByText('Wine Tasting')).toBeTruthy()
    expect(screen.getByText('Free Workshops')).toBeTruthy()
    expect(screen.queryByText('Fine Dining')).toBeNull()
    expect(screen.queryByText('Art Show')).toBeNull()
  })

  it('T4-4: price filter Paid shows only paid events', () => {
    render(<EventsPageClient events={testEvents} />)

    fireEvent.click(screen.getByText('Paid'))

    expect(screen.getByText('Fine Dining')).toBeTruthy()
    expect(screen.getByText('Art Show')).toBeTruthy()
    expect(screen.queryByText('Wine Tasting')).toBeNull()
    expect(screen.queryByText('Free Workshops')).toBeNull()
  })

  it('T4-5: clearing filter via "All" chip shows all events again', () => {
    render(<EventsPageClient events={testEvents} />)

    // Apply Dining & Supper Clubs filter
    const diningChips = screen.getAllByText('Dining & Supper Clubs')
    fireEvent.click(diningChips[0])

    // Verify only dining visible
    expect(screen.queryByText('Wine Tasting')).toBeNull()

    // Clear filters — click 'All' tag chip (first "All" button)
    const allButtons = screen.getAllByText('All')
    fireEvent.click(allButtons[0])

    // All events visible again
    expect(screen.getByText('Wine Tasting')).toBeTruthy()
    expect(screen.getByText('Fine Dining')).toBeTruthy()
    expect(screen.getByText('Art Show')).toBeTruthy()
    expect(screen.getByText('Free Workshops')).toBeTruthy()

    // URL was reset to /events with no ?tag= param
    expect(mockRouterReplace).toHaveBeenLastCalledWith('/events', {
      scroll: false,
    })
  })

  it('T4-6 (F1a): renders all 15 primary-eligible tag chips + All', () => {
    render(<EventsPageClient events={testEvents} />)

    // Sample a few chips to confirm the 15-tag bar (sharper labels)
    expect(screen.getAllByText('All').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Drinks & Bars').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Theatre & Comedy').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Activities & Social Games').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Wellness & Mindfulness').length).toBeGreaterThan(0)
    // Legacy enum labels must NOT appear as a filter chip
    const chipBar = screen.getAllByText('Drinks & Bars')[0]
    const chipParent = chipBar.closest('div')
    expect(chipParent?.textContent).not.toContain('Cultural')
    expect(chipParent?.textContent).not.toContain('Networking')
  })
})
