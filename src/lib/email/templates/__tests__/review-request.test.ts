import { describe, it, expect } from 'vitest'
import { reviewRequestTemplate } from '../review-request'

// Ensures the unsubscribe-token lib has a signing secret during test runs.
process.env.UNSUBSCRIBE_TOKEN_SECRET ||=
  'deterministic-test-secret-for-review-request-template'

describe('reviewRequestTemplate', () => {
  const base = reviewRequestTemplate({
    userId: '11111111-2222-3333-4444-555555555555',
    fullName: 'Charlotte Moreau',
    eventTitle: 'Wine & Wisdom',
    eventSlug: 'wine-and-wisdom',
  })

  it('uses the event title in the subject', () => {
    expect(base.subject).toBe('How was Wine & Wisdom?')
  })

  it('greets by first name', () => {
    expect(base.html).toContain('Hi Charlotte')
  })

  it('links to the review anchor on the event page', () => {
    expect(base.html).toMatch(/\/events\/wine-and-wisdom#review/)
    expect(base.html).toMatch(/Leave a Review/)
  })

  it('escapes untrusted input in the event title', () => {
    const tpl = reviewRequestTemplate({
      userId: '11111111-2222-3333-4444-555555555555',
      fullName: 'Bob',
      eventTitle: '<img src=x onerror=y>',
      eventSlug: 'x',
    })
    expect(tpl.html).not.toContain('<img src=x onerror=y>')
    expect(tpl.html).toContain('&lt;img')
  })

  it('plain-text version strips HTML tags', () => {
    expect(base.text).not.toMatch(/<[^>]+>/)
  })
})
