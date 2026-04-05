// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { GalleryPhotoWithEvent, GalleryEvent } from '@/lib/supabase/queries/gallery'

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
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...filterDomProps(props)}>{children}</div>
    ),
    section: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <section {...filterDomProps(props)}>{children}</section>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string; [key: string]: unknown }) => (
    <img alt={alt} src={src} data-testid="gallery-image" />
  ),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string; [key: string]: unknown }>) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/lib/utils/images', () => ({
  resolveEventImage: vi.fn((url: string) => url),
}))

import GalleryClient from '../GalleryClient'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const mockEvents: GalleryEvent[] = [
  { id: 'evt-1', slug: 'rooftop-cocktails', title: 'Rooftop Cocktails' },
  { id: 'evt-2', slug: 'axe-throwing', title: 'Axe Throwing' },
]

function makePhoto(overrides: { id: string; event_id?: string; caption?: string; eventTitle?: string; eventSlug?: string }): GalleryPhotoWithEvent {
  return {
    id: overrides.id,
    event_id: overrides.event_id ?? 'evt-1',
    image_url: `https://images.unsplash.com/photo-${overrides.id}?w=800&h=600&fit=crop`,
    caption: overrides.caption ?? `Caption for ${overrides.id}`,
    sort_order: 1,
    created_at: '2025-01-15T10:00:00Z',
    event: {
      title: overrides.eventTitle ?? 'Rooftop Cocktails',
      slug: overrides.eventSlug ?? 'rooftop-cocktails',
    },
  }
}

const mockPhotos: GalleryPhotoWithEvent[] = [
  makePhoto({ id: 'p1', event_id: 'evt-1', caption: 'The rooftop at golden hour', eventTitle: 'Rooftop Cocktails', eventSlug: 'rooftop-cocktails' }),
  makePhoto({ id: 'p2', event_id: 'evt-1', caption: 'Cocktails in hand', eventTitle: 'Rooftop Cocktails', eventSlug: 'rooftop-cocktails' }),
  makePhoto({ id: 'p3', event_id: 'evt-2', caption: 'First throw of the evening', eventTitle: 'Axe Throwing', eventSlug: 'axe-throwing' }),
  makePhoto({ id: 'p4', event_id: 'evt-2', caption: 'The scoreboard', eventTitle: 'Axe Throwing', eventSlug: 'axe-throwing' }),
]

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// GalleryClient
// ════════════════════════════════════════════════════════════════════════════

describe('GalleryClient', () => {
  it('renders photos in the masonry grid', () => {
    render(<GalleryClient photos={mockPhotos} events={mockEvents} />)

    const images = screen.getAllByTestId('gallery-image')
    // At least 4 grid photos + 1 featured = 5+
    expect(images.length).toBeGreaterThanOrEqual(mockPhotos.length)
  })

  it('renders filter buttons for all events plus "All"', () => {
    render(<GalleryClient photos={mockPhotos} events={mockEvents} />)

    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rooftop Cocktails' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Axe Throwing' })).toBeTruthy()
  })

  it('filters photos when an event filter button is clicked', () => {
    render(<GalleryClient photos={mockPhotos} events={mockEvents} />)

    // Click "Axe Throwing" filter
    fireEvent.click(screen.getByRole('button', { name: 'Axe Throwing' }))

    // Should show only axe throwing photos
    expect(screen.getByText('First throw of the evening')).toBeTruthy()
    expect(screen.getByText('The scoreboard')).toBeTruthy()

    // Rooftop photos should not be visible
    expect(screen.queryByText('The rooftop at golden hour')).toBeFalsy()
  })

  it('shows all photos when "All" filter is clicked after filtering', () => {
    render(<GalleryClient photos={mockPhotos} events={mockEvents} />)

    // Filter to one event
    fireEvent.click(screen.getByRole('button', { name: 'Axe Throwing' }))

    // Back to All
    fireEvent.click(screen.getByRole('button', { name: 'All' }))

    // All captions should be visible again (may appear multiple times due to featured photo)
    expect(screen.getAllByText('The rooftop at golden hour').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('First throw of the evening').length).toBeGreaterThanOrEqual(1)
  })

  it('shows empty state when no photos match the filter', () => {
    const limitedPhotos = mockPhotos.filter((p) => p.event_id === 'evt-1')
    const events: GalleryEvent[] = [
      ...mockEvents,
      { id: 'evt-3', slug: 'empty-event', title: 'Empty Event' },
    ]

    render(<GalleryClient photos={limitedPhotos} events={events} />)

    fireEvent.click(screen.getByRole('button', { name: 'Empty Event' }))

    expect(screen.getByText(/no photos found/i)).toBeTruthy()
  })

  it('renders the featured "Photo of the Month" when on All filter', () => {
    render(<GalleryClient photos={mockPhotos} events={mockEvents} />)

    // Text appears in both the badge and the heading — use getAllByText
    expect(screen.getAllByText('Photo of the Month').length).toBeGreaterThanOrEqual(1)
  })

  it('hides featured photo when a specific event filter is active', () => {
    render(<GalleryClient photos={mockPhotos} events={mockEvents} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rooftop Cocktails' }))

    // "Photo of the Month" heading should be hidden when not on "All"
    expect(screen.queryByText('Photo of the Month')).toBeFalsy()
  })

  // ── Lightbox ────────────────────────────────────────────────────────────

  it('opens lightbox when a photo is clicked', () => {
    render(<GalleryClient photos={mockPhotos} events={mockEvents} />)

    // Find clickable photo buttons in the masonry grid
    // Each grid photo is wrapped in a <button> with an <img> inside
    const allButtons = screen.getAllByRole('button')
    const photoButton = allButtons.find(
      (btn) => btn.querySelector('[data-testid="gallery-image"]') && btn.tagName === 'BUTTON'
    )

    expect(photoButton).toBeTruthy()
    if (photoButton) {
      fireEvent.click(photoButton)

      // Lightbox should appear — it has role="dialog"
      expect(screen.getByRole('dialog', { name: /photo lightbox/i })).toBeTruthy()
    }
  })

  it('closes lightbox on Escape key', () => {
    render(<GalleryClient photos={mockPhotos} events={mockEvents} />)

    // Open lightbox
    const allButtons = screen.getAllByRole('button')
    const photoButton = allButtons.find(
      (btn) => btn.querySelector('[data-testid="gallery-image"]') && btn.tagName === 'BUTTON'
    )

    if (photoButton) {
      fireEvent.click(photoButton)
      expect(screen.getByRole('dialog', { name: /photo lightbox/i })).toBeTruthy()

      // Press Escape
      fireEvent.keyDown(document, { key: 'Escape' })

      // Lightbox should be gone
      expect(screen.queryByRole('dialog', { name: /photo lightbox/i })).toBeFalsy()
    }
  })

  it('navigates to next photo with ArrowRight', () => {
    render(<GalleryClient photos={mockPhotos} events={mockEvents} />)

    // Open lightbox
    const allButtons = screen.getAllByRole('button')
    const photoButton = allButtons.find(
      (btn) => btn.querySelector('[data-testid="gallery-image"]') && btn.tagName === 'BUTTON'
    )

    if (photoButton) {
      fireEvent.click(photoButton)

      // Should show "1 / N" counter
      expect(screen.getByText(/1 \//)).toBeTruthy()

      // Press ArrowRight
      fireEvent.keyDown(document, { key: 'ArrowRight' })

      // Counter should now show "2 / N"
      expect(screen.getByText(/2 \//)).toBeTruthy()
    }
  })

  it('navigates to previous photo with ArrowLeft', () => {
    render(<GalleryClient photos={mockPhotos} events={mockEvents} />)

    // Open lightbox
    const allButtons = screen.getAllByRole('button')
    const photoButton = allButtons.find(
      (btn) => btn.querySelector('[data-testid="gallery-image"]') && btn.tagName === 'BUTTON'
    )

    if (photoButton) {
      fireEvent.click(photoButton)

      // Go to photo 2
      fireEvent.keyDown(document, { key: 'ArrowRight' })
      expect(screen.getByText(/2 \//)).toBeTruthy()

      // Go back to photo 1
      fireEvent.keyDown(document, { key: 'ArrowLeft' })
      expect(screen.getByText(/1 \//)).toBeTruthy()
    }
  })

  it('wraps around when navigating past the last photo', () => {
    const twoPhotos = mockPhotos.slice(0, 2)

    render(<GalleryClient photos={twoPhotos} events={mockEvents} />)

    const allButtons = screen.getAllByRole('button')
    const photoButton = allButtons.find(
      (btn) => btn.querySelector('[data-testid="gallery-image"]') && btn.tagName === 'BUTTON'
    )

    if (photoButton) {
      fireEvent.click(photoButton)

      expect(screen.getByText(/1 \/ 2/)).toBeTruthy()

      // ArrowRight → 2
      fireEvent.keyDown(document, { key: 'ArrowRight' })
      expect(screen.getByText(/2 \/ 2/)).toBeTruthy()

      // ArrowRight → wraps to 1
      fireEvent.keyDown(document, { key: 'ArrowRight' })
      expect(screen.getByText(/1 \/ 2/)).toBeTruthy()
    }
  })

  it('shows lightbox navigation buttons', () => {
    render(<GalleryClient photos={mockPhotos} events={mockEvents} />)

    const allButtons = screen.getAllByRole('button')
    const photoButton = allButtons.find(
      (btn) => btn.querySelector('[data-testid="gallery-image"]') && btn.tagName === 'BUTTON'
    )

    if (photoButton) {
      fireEvent.click(photoButton)

      expect(screen.getByLabelText('Previous photo')).toBeTruthy()
      expect(screen.getByLabelText('Next photo')).toBeTruthy()
      expect(screen.getByLabelText('Close lightbox')).toBeTruthy()
    }
  })

  it('applies initialEventSlug as the default filter', () => {
    render(
      <GalleryClient
        photos={mockPhotos}
        events={mockEvents}
        initialEventSlug="axe-throwing"
      />,
    )

    // Should only show axe throwing photos
    expect(screen.getByText('First throw of the evening')).toBeTruthy()
    expect(screen.queryByText('The rooftop at golden hour')).toBeFalsy()
  })
})
