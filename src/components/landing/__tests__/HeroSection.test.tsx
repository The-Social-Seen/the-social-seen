// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const safe: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(props)) {
        if (!['variants', 'initial', 'animate', 'exit', 'whileInView', 'viewport', 'transition', 'custom'].includes(k)) safe[k] = v
      }
      return <div {...safe}>{children}</div>
    },
    p: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const safe: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(props)) {
        if (!['variants', 'initial', 'animate', 'exit', 'whileInView', 'viewport', 'transition', 'custom'].includes(k)) safe[k] = v
      }
      return <p {...safe}>{children}</p>
    },
    h1: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const safe: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(props)) {
        if (!['variants', 'initial', 'animate', 'exit', 'whileInView', 'viewport', 'transition', 'custom'].includes(k)) safe[k] = v
      }
      return <h1 {...safe}>{children}</h1>
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

import { HeroSection } from '../HeroSection'

describe('HeroSection', () => {
  it('renders without crashing', () => {
    const { container } = render(<HeroSection />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders the main heading "Where Connections Become Stories"', () => {
    render(<HeroSection />)
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.getByText(/where connections/i)).toBeTruthy()
    expect(screen.getByText(/stories/i)).toBeTruthy()
  })

  it('renders a primary CTA linking to /events', () => {
    render(<HeroSection />)
    // Current text is "Explore Events" — Amendment 2.3 says it should be "See What's On"
    // Test for presence of link to /events regardless of label
    const eventsLinks = screen.getAllByRole('link').filter(
      (l) => l.getAttribute('href') === '/events',
    )
    expect(eventsLinks.length).toBeGreaterThan(0)
  })

  it('renders a secondary CTA linking to /join', () => {
    render(<HeroSection />)
    const joinLinks = screen.getAllByRole('link').filter(
      (l) => l.getAttribute('href') === '/join',
    )
    expect(joinLinks.length).toBeGreaterThan(0)
  })

  it('renders "See What\'s On" primary CTA (Amendment 2.3)', () => {
    render(<HeroSection />)
    expect(screen.getByText(/see what's on/i)).toBeTruthy()
  })

  it('renders "Become a Member" secondary CTA (Amendment 2.3)', () => {
    render(<HeroSection />)
    expect(screen.getByText(/become a member/i)).toBeTruthy()
  })

  it('renders updated subtitle with event types (Amendment 2.3)', () => {
    render(<HeroSection />)
    expect(screen.getByText(/supper clubs\. gallery openings\. rooftop drinks/i)).toBeTruthy()
  })
})
