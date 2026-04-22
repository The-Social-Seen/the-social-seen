// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InstagramFollowSection } from '../InstagramFollowSection'

describe('<InstagramFollowSection>', () => {
  it('card variant: renders a Follow CTA linking to the canonical Instagram URL', () => {
    render(<InstagramFollowSection variant="card" />)
    const link = screen.getByRole('link', { name: /follow/i })
    expect(link.getAttribute('href')).toBe(
      'https://www.instagram.com/the_social_seen',
    )
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('banner variant: bigger headline + same canonical link', () => {
    render(<InstagramFollowSection variant="banner" />)
    expect(screen.getByText(/Follow the moments/i)).toBeTruthy()
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe(
      'https://www.instagram.com/the_social_seen',
    )
  })

  it('respects a custom headline override', () => {
    render(
      <InstagramFollowSection
        variant="card"
        headline="See you on the grid"
      />,
    )
    expect(screen.getByText('See you on the grid')).toBeTruthy()
  })

  it('opens in a new tab with safe rel=noopener noreferrer', () => {
    render(<InstagramFollowSection />)
    const link = screen.getByRole('link', { name: /follow/i })
    expect(link.getAttribute('rel')).toMatch(/noopener.*noreferrer/)
  })

  it('announces the new-tab behaviour via aria-label (a11y)', () => {
    render(<InstagramFollowSection />)
    const link = screen.getByRole('link', { name: /follow/i })
    expect(link.getAttribute('aria-label')).toMatch(/opens in a new tab/i)
    expect(link.getAttribute('aria-label')).toContain('@the_social_seen')
  })
})
