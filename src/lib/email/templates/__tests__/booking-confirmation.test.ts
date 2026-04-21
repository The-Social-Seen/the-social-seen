import { describe, it, expect } from 'vitest'
import { bookingConfirmationTemplate } from '../booking-confirmation'

const baseInput = {
  fullName: 'Charlotte Moreau',
  eventTitle: 'Wine & Wisdom',
  eventSlug: 'wine-and-wisdom',
  eventDate: 'Wednesday 7 May',
  eventTime: '7:00 PM',
  venueName: 'Quo Vadis',
  venueAddress: '26-29 Dean St, Soho, London W1D 3LL',
  venueRevealed: true,
  status: 'confirmed' as const,
  waitlistPosition: null,
}

describe('bookingConfirmationTemplate', () => {
  // ── Confirmed variant ───────────────────────────────────────────────────
  it('renders confirmed copy when status=confirmed', () => {
    const tpl = bookingConfirmationTemplate(baseInput)
    expect(tpl.subject).toBe('You\u2019re booked: Wine & Wisdom')
    expect(tpl.html).toContain('You\u2019re booked.')
    expect(tpl.html).toContain('confirmed your spot')
  })

  it('shows venue when venueRevealed=true', () => {
    const tpl = bookingConfirmationTemplate(baseInput)
    expect(tpl.html).toContain('Quo Vadis')
    expect(tpl.html).toContain('26-29 Dean St')
    expect(tpl.text).toContain('Quo Vadis')
  })

  // ── Waitlisted variant ──────────────────────────────────────────────────
  it('renders waitlisted copy when status=waitlisted, with position', () => {
    const tpl = bookingConfirmationTemplate({
      ...baseInput,
      status: 'waitlisted',
      waitlistPosition: 3,
    })
    expect(tpl.subject).toBe('You\u2019re on the waitlist: Wine & Wisdom')
    expect(tpl.html).toContain('on the waitlist')
    expect(tpl.html).toContain('#3')
  })

  it('renders waitlisted copy gracefully when position is null', () => {
    const tpl = bookingConfirmationTemplate({
      ...baseInput,
      status: 'waitlisted',
      waitlistPosition: null,
    })
    expect(tpl.html).toContain('on the waitlist')
    expect(tpl.html).not.toContain('#null')
    expect(tpl.html).not.toContain('#0')
  })

  // ── Pending payment variant ─────────────────────────────────────────────
  it('renders pending-payment copy when status=pending_payment', () => {
    const tpl = bookingConfirmationTemplate({
      ...baseInput,
      status: 'pending_payment',
    })
    expect(tpl.subject).toBe('Finish booking: Wine & Wisdom')
    expect(tpl.html).toContain('Almost there')
    expect(tpl.html).toContain('Complete Payment')
  })

  // ── Venue not revealed ──────────────────────────────────────────────────
  it('hides venue address when venueRevealed=false', () => {
    const tpl = bookingConfirmationTemplate({
      ...baseInput,
      venueRevealed: false,
    })
    expect(tpl.html).toContain('Revealed 1 week before')
    expect(tpl.html).not.toContain('Quo Vadis')
    expect(tpl.html).not.toContain('26-29 Dean St')
  })

  // ── Common assertions ───────────────────────────────────────────────────
  it('includes event title in subject and body', () => {
    const tpl = bookingConfirmationTemplate(baseInput)
    expect(tpl.subject).toContain('Wine & Wisdom')
    expect(tpl.html).toContain('Wine &amp; Wisdom') // HTML-escaped
  })

  it('uses the first name in the greeting', () => {
    const tpl = bookingConfirmationTemplate(baseInput)
    expect(tpl.html).toContain('Hi Charlotte')
  })

  it('plain-text version strips all HTML tags', () => {
    const tpl = bookingConfirmationTemplate(baseInput)
    expect(tpl.text).not.toMatch(/<[^>]+>/)
  })

  it('CTA links to the event detail page', () => {
    const tpl = bookingConfirmationTemplate(baseInput)
    expect(tpl.html).toMatch(/\/events\/wine-and-wisdom/)
  })

  it('escapes HTML in event title', () => {
    const tpl = bookingConfirmationTemplate({
      ...baseInput,
      eventTitle: '<script>alert(1)</script>',
    })
    expect(tpl.html).not.toContain('<script>alert')
    expect(tpl.html).toContain('&lt;script&gt;')
  })

  it('escapes HTML in venue name (defence-in-depth)', () => {
    const tpl = bookingConfirmationTemplate({
      ...baseInput,
      venueName: '<a href="https://evil.com">Click here</a>',
    })
    // The href attribute and tag must not appear unescaped — email clients
    // would render the raw <a> as a real link. Escaped form is fine.
    expect(tpl.html).not.toContain('href="https://evil.com"')
    expect(tpl.html).not.toContain('<a href="https://evil.com">')
    expect(tpl.html).toContain('&lt;a href=')
  })

  it('escapes HTML in venue name (script tag form)', () => {
    const tpl = bookingConfirmationTemplate({
      ...baseInput,
      venueName: '<script>alert(1)</script>',
    })
    expect(tpl.html).not.toContain('<script>alert')
    expect(tpl.html).toContain('&lt;script&gt;')
  })
})
