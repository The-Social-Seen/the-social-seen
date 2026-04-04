// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { createRef } from 'react'

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
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...filterDomProps(props)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

import MobileBookingBar from '../MobileBookingBar'

// ── Helpers ────────────────────────────────────────────────────────────────────

// Mock IntersectionObserver to immediately call callback with isIntersecting=false
// (sidebar NOT visible → bar SHOULD show)
let ioCallback: IntersectionObserverCallback | null = null

function mockIntersectionObserver() {
  const observe = vi.fn()
  const disconnect = vi.fn()

  class MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      ioCallback = callback
    }
    observe = observe
    disconnect = disconnect
    unobserve = vi.fn()
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  return { observe, disconnect }
}

/** Simulate the sidebar entering/leaving the viewport */
function triggerIntersection(isIntersecting: boolean) {
  if (ioCallback) {
    ioCallback(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
  }
}

function renderBar(overrides: Partial<Parameters<typeof MobileBookingBar>[0]> = {}) {
  const sidebarRef = createRef<HTMLDivElement>()
  // Create an actual DOM element so the ref has .current
  const sidebarEl = document.createElement('div')
  document.body.appendChild(sidebarEl)
  ;(sidebarRef as { current: HTMLDivElement }).current = sidebarEl

  const defaultProps = {
    price: 3500,
    spotsLeft: 8 as number | null,
    isFree: false,
    isSoldOut: false,
    isPast: false,
    onBookClick: vi.fn(),
    sidebarRef,
    ...overrides,
  }

  const result = render(<MobileBookingBar {...defaultProps} />)
  return { ...result, onBookClick: defaultProps.onBookClick, sidebarEl }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MobileBookingBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ioCallback = null
    mockIntersectionObserver()
  })

  /** Render and then trigger the IO to make bar visible */
  function renderAndShow(overrides: Partial<Parameters<typeof MobileBookingBar>[0]> = {}) {
    const result = renderBar(overrides)
    act(() => triggerIntersection(false)) // sidebar NOT visible → bar shows
    return result
  }

  it('renders price for paid events', () => {
    renderAndShow({ price: 3500, isFree: false })
    expect(screen.getByText('£35')).toBeTruthy()
  })

  it('renders "Free" for free events', () => {
    renderAndShow({ price: 0, isFree: true })
    expect(screen.getByText('Free')).toBeTruthy()
  })

  it('shows "per person" text for paid events', () => {
    renderAndShow({ price: 3500, isFree: false })
    expect(screen.getByText('per person')).toBeTruthy()
  })

  it('does NOT show "per person" for free events', () => {
    renderAndShow({ price: 0, isFree: true })
    expect(screen.queryByText('per person')).toBeNull()
  })

  // ── CTA text ──

  it('shows "Book Now" for paid events with spots available', () => {
    renderAndShow({ price: 3500, isFree: false, isSoldOut: false })
    expect(screen.getByRole('button', { name: 'Book Now' })).toBeTruthy()
  })

  it('shows "RSVP Now" for free events', () => {
    renderAndShow({ price: 0, isFree: true, isSoldOut: false })
    expect(screen.getByRole('button', { name: 'RSVP Now' })).toBeTruthy()
  })

  it('shows "Join Waitlist" when sold out', () => {
    renderAndShow({ isSoldOut: true })
    expect(screen.getByRole('button', { name: 'Join Waitlist' })).toBeTruthy()
  })

  // ── Spots indicator ──

  it('shows spots remaining when < 10', () => {
    renderAndShow({ spotsLeft: 5 })
    expect(screen.getByText('5 spots left')).toBeTruthy()
  })

  it('does NOT show spots remaining when >= 10', () => {
    renderAndShow({ spotsLeft: 15 })
    expect(screen.queryByText(/spots left/i)).toBeNull()
  })

  it('does NOT show spots for unlimited capacity (null)', () => {
    renderAndShow({ spotsLeft: null })
    expect(screen.queryByText(/spots left/i)).toBeNull()
  })

  // ── Visibility ──

  it('returns null for past events', () => {
    const { container } = renderBar({ isPast: true })
    act(() => triggerIntersection(false))
    expect(container.innerHTML).toBe('')
  })

  it('has lg:hidden class to hide on desktop', () => {
    renderAndShow()
    const bar = screen.getByText('£35').closest('[class*="lg:hidden"]')
    expect(bar).toBeTruthy()
  })

  it('calls onBookClick when CTA button is clicked', () => {
    const { onBookClick } = renderAndShow()
    const button = screen.getByRole('button', { name: 'Book Now' })
    button.click()
    expect(onBookClick).toHaveBeenCalledOnce()
  })

  // ── IntersectionObserver behaviour ──

  it('does NOT render content when sidebar IS visible', () => {
    renderBar()
    // Trigger with sidebar visible → bar should stay hidden
    act(() => triggerIntersection(true))
    expect(screen.queryByRole('button')).toBeNull()
  })
})
