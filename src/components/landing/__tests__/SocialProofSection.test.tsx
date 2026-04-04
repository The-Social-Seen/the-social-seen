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
  },
  useInView: () => false, // counters start at 0 when not in view
}))

import { SocialProofSection } from '../SocialProofSection'

describe('SocialProofSection', () => {
  it('renders without crashing', () => {
    const { container } = render(<SocialProofSection />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders updated heading "Join 1,000+ London Professionals" (Amendment 2.4)', () => {
    render(<SocialProofSection />)
    expect(screen.getByText(/join 1,000\+ london professionals/i)).toBeTruthy()
  })

  it('does NOT render old heading "The Community in Numbers"', () => {
    render(<SocialProofSection />)
    expect(screen.queryByText(/the community in numbers/i)).toBeNull()
  })

  it('renders "Events Hosted" label', () => {
    render(<SocialProofSection />)
    expect(screen.getByText(/events hosted/i)).toBeTruthy()
  })

  it('renders "Average Rating" label', () => {
    render(<SocialProofSection />)
    expect(screen.getByText(/average rating/i)).toBeTruthy()
  })

  it('renders "Events This Month" label', () => {
    render(<SocialProofSection />)
    expect(screen.getByText(/events this month/i)).toBeTruthy()
  })

  it('does NOT render old "Members" or "Industries Represented" labels', () => {
    render(<SocialProofSection />)
    // "Members" was the old first counter label
    const memberLabels = screen.queryAllByText(/^members$/i)
    expect(memberLabels.length).toBe(0)
    expect(screen.queryByText(/industries represented/i)).toBeNull()
  })

  it('has aria-labels on counter elements for accessibility', () => {
    const { container } = render(<SocialProofSection />)
    const ariaLabelled = container.querySelectorAll('[aria-label]')
    expect(ariaLabelled.length).toBeGreaterThanOrEqual(3)
  })
})
