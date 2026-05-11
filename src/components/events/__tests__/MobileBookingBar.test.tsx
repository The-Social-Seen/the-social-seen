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
    // Defaults assume an authenticated viewer — existing assertions all
    // exercise the logged-in path. The logged-out branch will get
    // dedicated coverage from the tester agent.
    isLoggedIn: true,
    eventSlug: 'test-event',
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

  // ── Logged-out branch (P-? — unauthenticated booking redirect fix) ───────
  //
  // The mobile bar previously rendered a generic "Book Now" button for ALL
  // viewers, which let a logged-out user reach the BookingModal → Server
  // Action and hit "Authentication required" mid-flow. The fix gates the
  // CTA behind isLoggedIn: logged-out users see a Sign In link that
  // preserves the current event + `?book=1` so the modal auto-opens after
  // sign-in. Mirrors BookingSidebar.LoggedOutState (already gated).
  describe('logged-out variant', () => {
    // INVARIANT: A logged-out viewer must NEVER fire onBookClick. The CTA
    // must be a navigation Link to /login (carrying ?redirect=…?book=1),
    // not a button bound to the booking handler.
    it('renders an anchor (Link), NOT a button, when !isLoggedIn', () => {
      renderAndShow({ isLoggedIn: false, eventSlug: 'wine-evening' })
      expect(screen.queryByRole('button')).toBeNull()
      expect(screen.getByRole('link')).toBeTruthy()
    })

    it('shows "Sign In to Book" copy when !isLoggedIn', () => {
      renderAndShow({ isLoggedIn: false, eventSlug: 'wine-evening' })
      expect(screen.getByRole('link', { name: 'Sign In to Book' })).toBeTruthy()
    })

    it('points href at /login?redirect=/events/<slug>?book=1', () => {
      renderAndShow({ isLoggedIn: false, eventSlug: 'wine-evening' })
      const link = screen.getByRole('link', { name: 'Sign In to Book' })
      // Exact match — the post-auth resume Handler in EventDetailClient
      // reads `?book=1` to auto-open the BookingModal. Drift here would
      // break the resume flow silently.
      expect(link.getAttribute('href')).toBe(
        '/login?redirect=/events/wine-evening?book=1',
      )
    })

    it('does NOT invoke onBookClick when the Sign In link is tapped', () => {
      const { onBookClick } = renderAndShow({
        isLoggedIn: false,
        eventSlug: 'wine-evening',
      })
      const link = screen.getByRole('link', { name: 'Sign In to Book' })
      // Defence in depth: even if a future refactor reattaches onClick
      // to the link, the booking action must not fire for an unauth user.
      link.click()
      expect(onBookClick).not.toHaveBeenCalled()
    })

    it('shows "Sign In to Book" (not "Join Waitlist") for a sold-out event when !isLoggedIn', () => {
      // The auth gate trumps the sold-out copy — logging in always
      // comes first in the priority order (matches BookingSidebar).
      renderAndShow({
        isLoggedIn: false,
        isSoldOut: true,
        eventSlug: 'wine-evening',
      })
      expect(screen.getByRole('link', { name: 'Sign In to Book' })).toBeTruthy()
      expect(screen.queryByText('Join Waitlist')).toBeNull()
    })

    it('shows "Sign In to Book" (not "RSVP Now") for a free event when !isLoggedIn', () => {
      renderAndShow({
        isLoggedIn: false,
        isFree: true,
        price: 0,
        eventSlug: 'wine-evening',
      })
      expect(screen.getByRole('link', { name: 'Sign In to Book' })).toBeTruthy()
      expect(screen.queryByText('RSVP Now')).toBeNull()
    })

    it('URL-encodes a slug containing odd characters into the redirect param', () => {
      // Slugs in this app are slugify-d (lowercase, hyphen-separated),
      // so this is largely a defensive check — but the redirect param
      // is inlined into the href as a template literal. If a future
      // event ever ends up with a unicode/space slug, the encoded form
      // must still resolve back to the original target.
      renderAndShow({ isLoggedIn: false, eventSlug: 'wine & cheese' })
      const link = screen.getByRole('link')
      // We use template-literal interpolation (no encodeURIComponent),
      // so the raw slug ends up in the href. This pins that behaviour
      // — if it changes we need to update redirect-resume parsing too.
      expect(link.getAttribute('href')).toBe(
        '/login?redirect=/events/wine & cheese?book=1',
      )
    })
  })

  // Sanity check: the logged-in default (isLoggedIn: true in renderBar)
  // must still render a <button> bound to onBookClick. This pins the
  // logged-in / logged-out swap so a future refactor that accidentally
  // forces the link variant is caught by the existing logged-in tests
  // AND this targeted assertion.
  it('renders a button (not a Link) when isLoggedIn', () => {
    renderAndShow({ isLoggedIn: true })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('button', { name: 'Book Now' })).toBeTruthy()
  })
})
