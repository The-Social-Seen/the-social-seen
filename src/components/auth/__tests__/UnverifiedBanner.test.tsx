// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/profile',
}))

import { UnverifiedBanner } from '../UnverifiedBanner'

describe('UnverifiedBanner', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('renders nothing when user is verified', () => {
    const { container } = render(<UnverifiedBanner verified={true} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders banner when user is unverified', () => {
    render(<UnverifiedBanner verified={false} />)
    expect(screen.getByText(/verify your email/i)).toBeTruthy()
  })

  it('renders "Verify now" link with /verify?from=<pathname>&source=banner', () => {
    render(<UnverifiedBanner verified={false} />)
    const cta = screen.getByRole('link', { name: /verify now/i })
    expect(cta.getAttribute('href')).toBe(
      '/verify?from=' + encodeURIComponent('/profile') + '&source=banner',
    )
  })

  it('hides itself when dismiss button is clicked', () => {
    render(<UnverifiedBanner verified={false} />)
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i })
    fireEvent.click(dismissBtn)
    expect(screen.queryByText(/verify your email/i)).toBeNull()
  })

  it('persists dismissal across renders via sessionStorage', () => {
    const { unmount } = render(<UnverifiedBanner verified={false} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    unmount()

    render(<UnverifiedBanner verified={false} />)
    expect(screen.queryByText(/verify your email/i)).toBeNull()
  })
})
