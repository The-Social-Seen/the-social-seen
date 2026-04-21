import { describe, it, expect } from 'vitest'
import { waitlistSpotAvailableTemplate } from '../waitlist-spot-available'

describe('waitlistSpotAvailableTemplate', () => {
  const paid = waitlistSpotAvailableTemplate({
    fullName: 'Charlotte Moreau',
    eventTitle: 'Wine & Wisdom',
    eventSlug: 'wine-and-wisdom',
    eventDate: 'Wednesday 7 May',
    eventTime: '7:00 PM',
    priceInPence: 3500,
  })

  const free = waitlistSpotAvailableTemplate({
    fullName: 'Alex',
    eventTitle: 'Run Club',
    eventSlug: 'run-club',
    eventDate: 'Sunday 10 May',
    eventTime: '9:00 AM',
    priceInPence: 0,
  })

  it('subject calls out the event', () => {
    expect(paid.subject).toBe('A spot just opened: Wine & Wisdom')
    expect(free.subject).toBe('A spot just opened: Run Club')
  })

  it('greets by first name', () => {
    expect(paid.html).toContain('Hi Charlotte')
    expect(free.html).toContain('Hi Alex')
  })

  it('makes "first to claim wins" explicit', () => {
    expect(paid.html).toMatch(/first to claim/i)
  })

  it('links to /events/<slug>?claim=1', () => {
    expect(paid.html).toContain('/events/wine-and-wisdom?claim=1')
    expect(free.html).toContain('/events/run-club?claim=1')
  })

  it('paid variant includes the price in the CTA', () => {
    expect(paid.html).toContain('Claim spot (£35)')
  })

  it('free variant CTA does NOT include a price', () => {
    expect(free.html).toMatch(/Claim your spot/)
    expect(free.html).not.toMatch(/Claim spot \(/)
  })

  it('formats prices with pence only when non-zero', () => {
    const withPence = waitlistSpotAvailableTemplate({
      fullName: 'Test',
      eventTitle: 'X',
      eventSlug: 'x',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 3550,
    })
    expect(withPence.html).toContain('£35.50')
  })

  it('escapes untrusted input in the event title', () => {
    const tpl = waitlistSpotAvailableTemplate({
      fullName: 'Bob',
      eventTitle: '<script>alert(1)</script>',
      eventSlug: 'x',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 0,
    })
    expect(tpl.html).not.toContain('<script>alert')
    expect(tpl.html).toContain('&lt;script&gt;')
  })

  it('plain-text version strips HTML tags', () => {
    expect(paid.text).not.toMatch(/<[^>]+>/)
  })
})
