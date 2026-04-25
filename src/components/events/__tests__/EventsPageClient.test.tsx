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
    category: 'drinks',
    price: 0,
    capacity: 30,
    image_url: 'https://example.com/test.jpg',
    dress_code: null,
    refund_window_hours: 48,
    is_published: true,
    is_cancelled: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    confirmed_count: 10,
    avg_rating: 0,
    review_count: 0,
    spots_left: 20,
    ...overrides,
  }
}

const testEvents: EventWithStats[] = [
  makeEvent({ id: 'e1', slug: 'wine-tasting', title: 'Wine Tasting', category: 'drinks', price: 0, date_time: '2036-01-01T19:00:00Z' }),
  makeEvent({ id: 'e2', slug: 'fine-dining', title: 'Fine Dining', category: 'dining', price: 5000, date_time: '2036-02-01T19:00:00Z' }),
  makeEvent({ id: 'e3', slug: 'art-show', title: 'Art Show', category: 'cultural', price: 3000, date_time: '2036-03-01T19:00:00Z' }),
  makeEvent({ id: 'e4', slug: 'free-networking', title: 'Free Networking', category: 'networking', price: 0, date_time: '2036-04-01T19:00:00Z' }),
]

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.setSystemTime(new Date('2026-04-11T12:00:00Z'))
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
    expect(screen.getByText('Free Networking')).toBeTruthy()
  })

  it('T4-2: category filter Dining shows only dining events', () => {
    render(<EventsPageClient events={testEvents} />)

    // Click the Dining category pill (first match — the filter button, not the card tag)
    const diningButtons = screen.getAllByText('Dining')
    fireEvent.click(diningButtons[0])

    expect(screen.getByText('Fine Dining')).toBeTruthy()
    expect(screen.queryByText('Wine Tasting')).toBeNull()
    expect(screen.queryByText('Art Show')).toBeNull()
    expect(screen.queryByText('Free Networking')).toBeNull()
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
    expect(screen.getByText('Free Networking')).toBeTruthy()
    expect(screen.queryByText('Fine Dining')).toBeNull()
    expect(screen.queryByText('Art Show')).toBeNull()
  })

  it('T4-4: price filter Paid shows only paid events', () => {
    render(<EventsPageClient events={testEvents} />)

    fireEvent.click(screen.getByText('Paid'))

    expect(screen.getByText('Fine Dining')).toBeTruthy()
    expect(screen.getByText('Art Show')).toBeTruthy()
    expect(screen.queryByText('Wine Tasting')).toBeNull()
    expect(screen.queryByText('Free Networking')).toBeNull()
  })

  it('T4-5: clearing filters after selecting Dining shows all events again', () => {
    render(<EventsPageClient events={testEvents} />)

    // Apply Dining filter
    const diningButtons = screen.getAllByText('Dining')
    fireEvent.click(diningButtons[0])

    // Verify only dining visible
    expect(screen.queryByText('Wine Tasting')).toBeNull()

    // Clear filters — click 'All' category pill (first "All" button)
    const allButtons = screen.getAllByText('All')
    fireEvent.click(allButtons[0])

    // All events visible again
    expect(screen.getByText('Wine Tasting')).toBeTruthy()
    expect(screen.getByText('Fine Dining')).toBeTruthy()
    expect(screen.getByText('Art Show')).toBeTruthy()
    expect(screen.getByText('Free Networking')).toBeTruthy()
  })
})
