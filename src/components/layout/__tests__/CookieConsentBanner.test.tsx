// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
