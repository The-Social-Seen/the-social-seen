// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// next/navigation: CookieConsentBanner reads usePathname to self-hide on
// /admin/*. Default to '/' so the existing tests (which control consent
// state via localStorage but don't care about pathname) see a non-admin
// route and the banner's pre-existing visibility logic decides.
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
}))

import { usePathname } from 'next/navigation'
import CookieConsentBanner from '../CookieConsentBanner'
import { readConsent } from '@/lib/analytics/consent'

describe('CookieConsentBanner', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('shows the banner on first visit (no stored decision)', () => {
    render(<CookieConsentBanner />)
    expect(
      screen.getByRole('dialog', { name: /cookie consent/i }),
    ).toBeTruthy()
    expect(screen.getByText(/Help us improve/i)).toBeTruthy()
  })

  it('does NOT show the banner when consent is already granted', () => {
    window.localStorage.setItem('tss_analytics_consent', 'granted')
    render(<CookieConsentBanner />)
    expect(screen.queryByRole('dialog', { name: /cookie consent/i })).toBeNull()
  })

  it('does NOT show the banner when consent was previously declined', () => {
    window.localStorage.setItem('tss_analytics_consent', 'denied')
    render(<CookieConsentBanner />)
    expect(screen.queryByRole('dialog', { name: /cookie consent/i })).toBeNull()
  })

  it('writes `granted` and hides the banner when Accept is clicked', () => {
    render(<CookieConsentBanner />)
    fireEvent.click(screen.getByRole('button', { name: /Accept analytics/i }))
    expect(readConsent()).toBe('granted')
    expect(screen.queryByRole('dialog', { name: /cookie consent/i })).toBeNull()
  })

  it('writes `denied` and hides the banner when Decline is clicked', () => {
    render(<CookieConsentBanner />)
    fireEvent.click(screen.getByRole('button', { name: /^Decline$/i }))
    expect(readConsent()).toBe('denied')
    expect(screen.queryByRole('dialog', { name: /cookie consent/i })).toBeNull()
  })

  it('includes a link to the privacy policy', () => {
    render(<CookieConsentBanner />)
    const privacyLink = screen.getByRole('link', { name: /privacy policy/i })
    expect(privacyLink.getAttribute('href')).toBe('/privacy')
  })

  it('renders Accept and Decline buttons with equal visual weight', () => {
    // Dark-pattern check — Decline shouldn't be de-emphasised.
    render(<CookieConsentBanner />)
    const accept = screen.getByRole('button', { name: /Accept analytics/i })
    const decline = screen.getByRole('button', { name: /^Decline$/i })
    // Both use `flex-1` so each takes equal space in the button row.
    expect(accept.className).toContain('flex-1')
    expect(decline.className).toContain('flex-1')
  })
})

describe('CookieConsentBanner — admin route hiding', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.mocked(usePathname).mockReturnValue('/')
  })

  it('renders nothing on /admin/* even when no consent decision is stored', () => {
    // No localStorage entry → the visibility effect would normally flip
    // visible=true and show the dialog. The /admin/* guard must beat
    // that by returning null first.
    vi.mocked(usePathname).mockReturnValue('/admin/events')
    const { container } = render(<CookieConsentBanner />)
    expect(container.firstChild).toBeNull()
    expect(
      screen.queryByRole('dialog', { name: /cookie consent/i }),
    ).toBeNull()
  })

  it('renders the banner on non-admin paths when no consent stored', () => {
    vi.mocked(usePathname).mockReturnValue('/events')
    render(<CookieConsentBanner />)
    expect(
      screen.getByRole('dialog', { name: /cookie consent/i }),
    ).toBeTruthy()
  })
})
