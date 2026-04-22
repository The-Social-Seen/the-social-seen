// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from '../Footer'

describe('Footer', () => {
  it('renders without crashing', () => {
    const { container } = render(<Footer />)
    expect(container.querySelector('footer')).toBeTruthy()
  })

  it('renders About link with href /about', () => {
    render(<Footer />)
    const aboutLink = screen.getByRole('link', { name: /^about$/i })
    expect(aboutLink.getAttribute('href')).toBe('/about')
  })

  it('renders Events link with route href /events', () => {
    render(<Footer />)
    const link = screen.getByRole('link', { name: /^events$/i })
    expect(link.getAttribute('href')).toBe('/events')
  })

  it('renders Gallery link with route href /gallery', () => {
    render(<Footer />)
    const link = screen.getByRole('link', { name: /^gallery$/i })
    expect(link.getAttribute('href')).toBe('/gallery')
  })

  it('renders Join link with route href /join', () => {
    render(<Footer />)
    const link = screen.getByRole('link', { name: /^join$/i })
    expect(link.getAttribute('href')).toBe('/join')
  })

  it('renders Sign In link with route href /login', () => {
    render(<Footer />)
    const link = screen.getByRole('link', { name: /^sign in$/i })
    expect(link.getAttribute('href')).toBe('/login')
  })

  it('has no hash anchor hrefs in any footer navigation', () => {
    render(<Footer />)
    // Phase 2.5 Batch 6 split the footer into Discover + Connect nav
    // groups, so `getByRole('navigation')` would find multiple. Iterate
    // all nav landmarks together.
    const navSections = screen.getAllByRole('navigation')
    const hashLinks = navSections.flatMap((nav) =>
      Array.from(nav.querySelectorAll('a')).filter((l) => {
        const href = l.getAttribute('href') ?? ''
        return href.startsWith('#')
      }),
    )
    expect(hashLinks.length).toBe(0)
  })

  it('renders Privacy Policy and Terms of Service links', () => {
    render(<Footer />)
    expect(screen.getByRole('link', { name: /privacy policy/i }).getAttribute('href')).toBe('/privacy')
    expect(screen.getByRole('link', { name: /terms of service/i }).getAttribute('href')).toBe('/terms')
  })

  it('renders the Instagram social icon linking to the canonical handle', () => {
    render(<Footer />)
    const ig = screen.getByLabelText('Instagram')
    expect(ig).toBeTruthy()
    expect(ig.getAttribute('href')).toBe(
      'https://www.instagram.com/the_social_seen',
    )
    // Twitter / LinkedIn deliberately removed — those accounts don't
    // exist yet (P2-12). Add back when they do.
    expect(screen.queryByLabelText('X (Twitter)')).toBeNull()
    expect(screen.queryByLabelText('LinkedIn')).toBeNull()
  })

  it('renders updated tagline copy', () => {
    render(<Footer />)
    expect(screen.getByText(/curated experiences for london/i)).toBeTruthy()
  })
})
