// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { EventWithStats } from '@/types'

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

import { EventCard } from '../EventCard'

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EventWithStats> = {}): EventWithStats {
  return {
    id: 'evt-1',
    slug: 'rooftop-cocktails',
    title: 'Rooftop Cocktails',
    description: 'An evening of craft cocktails',
    short_description: 'Craft cocktails on the roof',
    date_time: '2027-03-14T19:00:00Z', // future date — upcoming
    end_time: '2027-03-14T22:00:00Z',
    venue_name: 'Sky Lounge',
    venue_address: '1 Rooftop Way, London',
    venue_revealed: true,
    postcode: null,
    category: 'drinks',
    price: 3500, // £35 in pence
    capacity: 30,
    image_url: 'https://example.com/cocktails.jpg',
    dress_code: 'Smart casual',
    is_published: true,
    is_cancelled: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    confirmed_count: 22,
    avg_rating: 0,
    review_count: 0,
    spots_left: 8,
    ...overrides,
  }
}

function makePastEvent(overrides: Partial<EventWithStats> = {}): EventWithStats {
  return makeEvent({
    date_time: '2025-01-10T19:00:00Z', // past date
    end_time: '2025-01-10T22:00:00Z',
    avg_rating: 4.7,
    review_count: 12,
    spots_left: 0,
    ...overrides,
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('EventCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders event title', () => {
    render(<EventCard event={makeEvent()} />)
    expect(screen.getByText('Rooftop Cocktails')).toBeTruthy()
  })

  it('renders venue name', () => {
    render(<EventCard event={makeEvent()} />)
    expect(screen.getByText('Sky Lounge')).toBeTruthy()
  })

  it('links to the event detail page using slug', () => {
    render(<EventCard event={makeEvent()} />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/events/rooftop-cocktails')
  })

  it('renders category label (capitalised)', () => {
    render(<EventCard event={makeEvent({ category: 'dining' })} />)
    expect(screen.getByText('Dining')).toBeTruthy()
  })

  // ── Price display ──

  it('displays "Free" for price = 0 events', () => {
    render(<EventCard event={makeEvent({ price: 0 })} />)
    expect(screen.getByText('Free')).toBeTruthy()
  })

  it('displays formatted price £35 for paid events (pence → pounds)', () => {
    render(<EventCard event={makeEvent({ price: 3500 })} />)
    expect(screen.getByText('£35')).toBeTruthy()
  })

  it('displays price with pence when not a whole pound', () => {
    render(<EventCard event={makeEvent({ price: 3550 })} />)
    expect(screen.getByText('£35.50')).toBeTruthy()
  })

  // ── Date format (Amendment 3.4) ──

  it('renders date in "EEE d MMM" format (Tier 1)', () => {
    // 2027-03-14 is a Sunday
    render(<EventCard event={makeEvent({ date_time: '2027-03-14T19:00:00Z' })} />)
    // formatDateCard uses London timezone — Sun 14 Mar
    expect(screen.getByText('Sun 14 Mar')).toBeTruthy()
  })

  // ── Spots & Waitlist (Amendment 3.3) ──

  it('shows gold "Join Waitlist" badge when spots_left = 0 (NOT red)', () => {
    render(<EventCard event={makeEvent({ spots_left: 0 })} />)
    const badge = screen.getByText('Join Waitlist')
    expect(badge).toBeTruthy()
    // Verify gold styling, not red
    expect(badge.className).toContain('text-gold')
    expect(badge.className).not.toContain('text-red')
  })

  it('shows "X spots left" when spots_left <= 5', () => {
    render(<EventCard event={makeEvent({ spots_left: 3 })} />)
    const spotsText = screen.getByText('3 spots left')
    expect(spotsText).toBeTruthy()
    // Should use gold styling for low spots
    expect(spotsText.className).toContain('text-gold')
  })

  it('shows spots left without gold when spots > 5', () => {
    render(<EventCard event={makeEvent({ spots_left: 15 })} />)
    const spotsText = screen.getByText('15 spots left')
    expect(spotsText).toBeTruthy()
    expect(spotsText.className).not.toContain('text-gold')
  })

  it('does not show spots indicator for null capacity (unlimited)', () => {
    render(<EventCard event={makeEvent({ spots_left: null, capacity: null })} />)
    expect(screen.queryByText(/spots left/i)).toBeNull()
    expect(screen.queryByText(/waitlist/i)).toBeNull()
  })

  // ── Sold Out overlay ──

  it('shows "Sold Out" overlay for upcoming events with 0 spots', () => {
    render(<EventCard event={makeEvent({ spots_left: 0 })} />)
    expect(screen.getByText('Sold Out')).toBeTruthy()
  })

  it('does NOT show "Sold Out" overlay for past events with 0 spots', () => {
    render(<EventCard event={makePastEvent({ spots_left: 0 })} />)
    expect(screen.queryByText('Sold Out')).toBeNull()
  })

  // ── Past events ──

  it('shows star rating badge for past events when avg_rating > 0', () => {
    render(<EventCard event={makePastEvent({ avg_rating: 4.7 })} />)
    expect(screen.getByText('4.7')).toBeTruthy()
  })

  it('does NOT show star rating badge when avg_rating = 0', () => {
    render(<EventCard event={makePastEvent({ avg_rating: 0 })} />)
    expect(screen.queryByText('0.0')).toBeNull()
  })

  it('shows rating and review count in footer when showRating is true for past events', () => {
    render(<EventCard event={makePastEvent({ avg_rating: 4.5, review_count: 8 })} showRating />)
    expect(screen.getByText('4.5 (8)')).toBeTruthy()
  })

  it('does NOT show footer rating for upcoming events even when showRating is true', () => {
    render(<EventCard event={makeEvent({ avg_rating: 4.5, review_count: 8 })} showRating />)
    expect(screen.queryByText('4.5 (8)')).toBeNull()
  })

  // ── Image ──

  it('renders event image with alt text', () => {
    render(<EventCard event={makeEvent()} />)
    const img = screen.getByAltText('Rooftop Cocktails')
    expect(img).toBeTruthy()
  })

  it('renders placeholder when image_url is null', () => {
    render(<EventCard event={makeEvent({ image_url: null })} />)
    expect(screen.getByText('No image')).toBeTruthy()
  })
})
