// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// next/navigation: Footer reads usePathname to self-hide on /admin/*.
// Default to '/' so the existing tests (which don't care about pathname)
// see a non-admin route and Footer renders normally.
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
}))

import { usePathname } from 'next/navigation'

// The newsletter signup form inside the footer uses TurnstileWidget,
// which consumes the ThemeProvider context. Mock both rather than
// spin up a real provider tree for every test.
vi.mock('@/components/layout/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}))

// Turnstile widget no-ops in tests (no site key, no loaded script).
// Stub it to a fragment so axe / tests don't see the Cloudflare iframe.
vi.mock('@/components/forms/TurnstileWidget', () => ({
  TurnstileWidget: () => null,
}))

// The subscribe Server Action is imported at module load; mock it so
// no DB client is constructed during Footer render.
vi.mock('@/app/newsletter/actions', () => ({
  subscribeToNewsletter: vi.fn().mockResolvedValue({
    success: true,
    message: 'stubbed',
  }),
}))

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

  // 2026-04-29: Gallery removed from footer until upload UI ships.
  // See memory/project_event_gallery_hidden.md for the restoration checklist.
  it('does not render a Gallery link (hidden until upload UI ships)', () => {
    render(<Footer />)
    const link = screen.queryByRole('link', { name: /^gallery$/i })
    expect(link).toBeNull()
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

describe('Footer — admin route hiding', () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/')
  })

  it('renders nothing when pathname starts with /admin', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/events')
    const { container } = render(<Footer />)
    expect(container.firstChild).toBeNull()
    expect(container.querySelector('footer')).toBeNull()
  })

  it('renders the public footer on non-admin paths', () => {
    vi.mocked(usePathname).mockReturnValue('/events')
    const { container } = render(<Footer />)
    expect(container.querySelector('footer')).toBeTruthy()
  })
})
