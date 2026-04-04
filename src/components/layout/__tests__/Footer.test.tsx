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

  it('has no hash anchor hrefs in quick links navigation', () => {
    render(<Footer />)
    // Check only the quick links nav section, not social icon placeholders (which use # intentionally)
    const navSection = screen.getByRole('navigation')
    const navLinks = navSection.querySelectorAll('a')
    const hashLinks = Array.from(navLinks).filter((l) => {
      const href = l.getAttribute('href') ?? ''
      return href.startsWith('#')
    })
    expect(hashLinks.length).toBe(0)
  })

  it('renders Privacy Policy and Terms of Service links', () => {
    render(<Footer />)
    expect(screen.getByRole('link', { name: /privacy policy/i }).getAttribute('href')).toBe('/privacy')
    expect(screen.getByRole('link', { name: /terms of service/i }).getAttribute('href')).toBe('/terms')
  })

  it('renders social media icons with aria-labels', () => {
    render(<Footer />)
    expect(screen.getByLabelText('Instagram')).toBeTruthy()
    expect(screen.getByLabelText('X (Twitter)')).toBeTruthy()
    expect(screen.getByLabelText('LinkedIn')).toBeTruthy()
  })

  it('renders updated tagline copy', () => {
    render(<Footer />)
    expect(screen.getByText(/curated experiences for london/i)).toBeTruthy()
  })
})
