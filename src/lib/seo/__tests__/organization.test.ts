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

  it('omits sameAs until real social handles are confirmed (P2-12)', () => {
    const ld = organizationJsonLd()
    // Deliberately absent — the footer still has placeholder href="#"
    // for Instagram / Twitter / LinkedIn. Putting guessed slugs in
    // sameAs would 404 and pollute the Knowledge Graph entry.
    expect('sameAs' in ld).toBe(false)
  })

  it('exposes a customer-support contactPoint', () => {
    const ld = organizationJsonLd()
    const cp = ld.contactPoint as Record<string, string>
    expect(cp['@type']).toBe('ContactPoint')
    expect(cp.email).toMatch(/^info@/)
    expect(cp.areaServed).toBe('GB')
  })
})
