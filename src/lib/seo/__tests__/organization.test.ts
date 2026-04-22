import { describe, it, expect } from 'vitest'
import { organizationJsonLd } from '../organization'

describe('organizationJsonLd', () => {
  it('has Organization @type and the documented brand name', () => {
    const ld = organizationJsonLd()
    expect(ld['@type']).toBe('Organization')
    expect(ld.name).toBe('The Social Seen')
  })

  it('uses the canonical site URL as the org URL', () => {
    const ld = organizationJsonLd()
    expect(ld.url).toBe('https://thesocialseen.com')
  })

  it('exposes a London / GB foundingLocation', () => {
    const ld = organizationJsonLd()
    const loc = ld.foundingLocation as { address: Record<string, string> }
    expect(loc.address.addressLocality).toBe('London')
    expect(loc.address.addressCountry).toBe('GB')
  })

  it('exposes social profiles via sameAs (sourced from SOCIAL_LINKS)', () => {
    const ld = organizationJsonLd()
    const sameAs = ld.sameAs as string[]
    expect(Array.isArray(sameAs)).toBe(true)
    expect(sameAs.length).toBeGreaterThan(0)
    // Today: just Instagram. The exact slug is asserted to catch
    // accidental drift from SOCIAL_LINKS.instagram.
    expect(sameAs).toContain('https://www.instagram.com/the_social_seen')
    // Twitter / LinkedIn deliberately not in the list — those accounts
    // don't exist yet. Add them when they do.
    expect(sameAs.some((u) => u.includes('twitter.com'))).toBe(false)
    expect(sameAs.some((u) => u.includes('linkedin.com'))).toBe(false)
  })

  it('exposes a customer-support contactPoint', () => {
    const ld = organizationJsonLd()
    const cp = ld.contactPoint as Record<string, string>
    expect(cp['@type']).toBe('ContactPoint')
    expect(cp.email).toMatch(/^info@/)
    expect(cp.areaServed).toBe('GB')
  })
})
