import { describe, it, expect } from 'vitest'
import { venueRevealTemplate } from '../venue-reveal'

describe('venueRevealTemplate', () => {
  const base = venueRevealTemplate({
    fullName: 'Charlotte Moreau',
    eventTitle: 'Wine & Wisdom',
    eventSlug: 'wine-and-wisdom',
    eventDate: 'Wednesday 7 May',
    eventTime: '7:00 PM',
    venueName: 'Vinopolis Cellar',
    venueAddress: '1 Bank End, London',
    postcode: 'SE1 9BU',
  })

  it('returns subject, html, and text', () => {
    expect(base.subject).toBe('Venue revealed: Wine & Wisdom')
    expect(base.html).toBeTruthy()
    expect(base.text).toBeTruthy()
  })

  it('greets by first name', () => {
    expect(base.html).toContain('Hi Charlotte')
  })

  it('includes venue name and address', () => {
    expect(base.html).toContain('Vinopolis Cellar')
    expect(base.html).toContain('1 Bank End, London')
    expect(base.html).toContain('SE1 9BU')
  })

  it('includes a Google Maps "Get Directions" link', () => {
    expect(base.html).toContain('google.com/maps/search/')
    expect(base.html).toMatch(/Get Directions/)
  })

  it('URL-encodes the maps query', () => {
    // Expect "Vinopolis%20Cellar" or "Vinopolis+Cellar" etc. — any percent-encoding is fine.
    expect(base.html).toMatch(/query=[^"]*%/)
  })

  it('gracefully handles missing postcode', () => {
    const tpl = venueRevealTemplate({
      fullName: 'Alex',
      eventTitle: 'Run Club',
      eventSlug: 'run-club',
      eventDate: 'Sunday 10 May',
      eventTime: '9:00 AM',
      venueName: 'Regent\u2019s Park',
      venueAddress: 'London',
      postcode: null,
    })
    expect(tpl.html).toContain('Regent')
    expect(tpl.html).not.toContain('null')
  })

  it('escapes untrusted input in the event title', () => {
    const tpl = venueRevealTemplate({
      fullName: 'Bob',
      eventTitle: '<script>alert(1)</script>',
      eventSlug: 'x',
      eventDate: 'x',
      eventTime: 'x',
      venueName: 'x',
      venueAddress: 'x',
      postcode: null,
    })
    expect(tpl.html).not.toContain('<script>alert')
    expect(tpl.html).toContain('&lt;script&gt;')
  })

  it('plain-text version strips HTML tags', () => {
    expect(base.text).not.toMatch(/<[^>]+>/)
  })
})
