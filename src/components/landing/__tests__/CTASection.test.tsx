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
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

import { CTASection } from '../CTASection'

describe('CTASection', () => {
  it('renders without crashing', () => {
    const { container } = render(<CTASection />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders "Become a Member" CTA button (Amendment 2.3)', () => {
    render(<CTASection />)
    expect(screen.getByText(/become a member/i)).toBeTruthy()
  })

  it('does NOT render old "Join The Social Seen" copy', () => {
    render(<CTASection />)
    expect(screen.queryByText(/join the social seen/i)).toBeNull()
  })

  it('renders updated body copy about London professionals', () => {
    render(<CTASection />)
    expect(screen.getByText(/1,000\+ london professionals/i)).toBeTruthy()
  })

  it('renders updated subtext "Just great evenings"', () => {
    render(<CTASection />)
    expect(screen.getByText(/just great evenings/i)).toBeTruthy()
  })

  it('does NOT render old subtext "Just great experiences"', () => {
    render(<CTASection />)
    expect(screen.queryByText(/just great experiences/i)).toBeNull()
  })

  it('CTA links to /join', () => {
    render(<CTASection />)
    const link = screen.getByRole('link', { name: /become a member/i })
    expect(link.getAttribute('href')).toBe('/join')
  })

  it('renders "Ready to Be Seen?" heading', () => {
    render(<CTASection />)
    expect(screen.getByText(/ready to be/i)).toBeTruthy()
  })
})
