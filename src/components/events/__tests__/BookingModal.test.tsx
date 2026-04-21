// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
vi.mock('@/app/events/[slug]/actions', () => ({
  createBooking: (...args: unknown[]) => mockCreateBooking(...args),
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
    category: 'dining',
    price: 3500,
    capacity: 30,
    image_url: null,
    dress_code: 'Smart Casual',
    is_published: true,
    is_cancelled: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    confirmed_count: 22,
    avg_rating: 0,
    review_count: 0,
    spots_left: 8,
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

  // ── Paid event: 3-step flow ──

  it('shows "Continue to Payment" for paid events', () => {
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

  it('renders 3 progress bar segments for paid events', () => {
    render(
      <BookingModal
        event={makeEvent({ price: 3500 })}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />
    )

    const progressBar = screen.getByTestId('progress-bar')
    expect(progressBar.children.length).toBe(3)
  })

  it('shows payment step with disabled inputs when "Continue to Payment" is clicked', () => {
    render(
      <BookingModal
        event={makeEvent({ price: 3500 })}
        isOpen={true}
        onClose={vi.fn()}
        userName="Charlotte"
      />
    )

    fireEvent.click(screen.getByText('Continue to Payment'))

    // Payment step renders
    expect(screen.getByText('Payment')).toBeTruthy()
    expect(screen.getByText(/Demo mode/)).toBeTruthy()
    expect(screen.getByText(/Powered by Stripe/)).toBeTruthy()

    // Inputs are disabled and pre-filled
    const cardInput = screen.getByDisplayValue('4242 4242 4242 4242')
    expect(cardInput).toBeTruthy()
    expect((cardInput as HTMLInputElement).disabled).toBe(true)

    const expiryInput = screen.getByDisplayValue('12 / 28')
    expect((expiryInput as HTMLInputElement).disabled).toBe(true)

    const cvcInput = screen.getByDisplayValue('123')
    expect((cvcInput as HTMLInputElement).disabled).toBe(true)
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
})
