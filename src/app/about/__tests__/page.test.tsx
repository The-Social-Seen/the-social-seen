// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock framer-motion (CTASection uses it)
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

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}))

import AboutPage from '../page'

describe('About page', () => {
  it('renders without crashing', () => {
    const { container } = render(<AboutPage />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders the page heading "The People Behind the Evenings"', () => {
    render(<AboutPage />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toContain('The People Behind the')
    expect(h1.textContent).toContain('Evenings')
  })

  it('renders the "Our Story" eyebrow text', () => {
    render(<AboutPage />)
    expect(screen.getByText('Our Story')).toBeTruthy()
  })

  it('renders origin story section with heading', () => {
    render(<AboutPage />)
    expect(screen.getByText(/born from a/i)).toBeTruthy()
  })

  it('renders all three value cards', () => {
    render(<AboutPage />)
    expect(screen.getByText('Curated, Not Open')).toBeTruthy()
    expect(screen.getByText('Experiences Over Networking')).toBeTruthy()
    expect(screen.getByText('Community First')).toBeTruthy()
  })

  it('renders the values section heading', () => {
    render(<AboutPage />)
    expect(screen.getByText(/what we/i)).toBeTruthy()
    expect(screen.getByText(/believe/i)).toBeTruthy()
  })

  it('renders stat numbers', () => {
    render(<AboutPage />)
    expect(screen.getByText('1,000+')).toBeTruthy()
    expect(screen.getByText('200+')).toBeTruthy()
    expect(screen.getByText('4.8')).toBeTruthy()
    expect(screen.getByText('12+')).toBeTruthy()
  })

  it('renders founder note signed by Mitesh', () => {
    render(<AboutPage />)
    expect(screen.getByText(/mitesh, co-founder/i)).toBeTruthy()
  })

  it('renders an image with alt text', () => {
    render(<AboutPage />)
    const img = screen.getByAltText(/supper club/i)
    expect(img).toBeTruthy()
  })

  it('renders the CTA section with "Become a Member"', () => {
    render(<AboutPage />)
    expect(screen.getByText(/become a member/i)).toBeTruthy()
  })
})
