import { describe, it, expect } from 'vitest'
import { waitlistPromotionTemplate } from '../waitlist-promotion'

describe('waitlistPromotionTemplate', () => {
  const withDeadline = waitlistPromotionTemplate({
    fullName: 'Amy Sangam',
    eventTitle: 'France vs Spain Screening',
    eventSlug: 'france-vs-spain-screening',
    eventDate: 'Tuesday 14 July',
    eventTime: '7:00 PM',
    priceInPence: 2000,
    bookingFeePence: 60,
    checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
    holdExpiresAt: 'Tuesday 14 July, 4:00 PM',
  })

  const noDeadline = waitlistPromotionTemplate({
    fullName: 'Yasemin Salp',
    eventTitle: 'Wine & Wisdom',
    eventSlug: 'wine-and-wisdom',
    eventDate: 'Wednesday 15 July',
    eventTime: '7:30 PM',
    priceInPence: 3500,
    bookingFeePence: 100,
    checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_xyz789',
    holdExpiresAt: null,
  })

  it('subject calls out the event, framed as an offer (not a race)', () => {
    expect(withDeadline.subject).toBe('You’re in: France vs Spain Screening')
    expect(noDeadline.subject).toBe('You’re in: Wine & Wisdom')
  })

  it('greets by first name only', () => {
    expect(withDeadline.html).toContain('Hi Amy')
    expect(noDeadline.html).toContain('Hi Yasemin')
  })

  it('falls back to the full string when fullName has no whitespace-separated parts', () => {
    const tpl = waitlistPromotionTemplate({
      fullName: 'Cher',
      eventTitle: 'X',
      eventSlug: 'x',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 1000,
      bookingFeePence: 30,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test',
      holdExpiresAt: null,
    })
    expect(tpl.html).toContain('Hi Cher')
  })

  it('INVARIANT: is framed as a personal offer, not the waitlist-race language ("first to claim wins")', () => {
    // This is the one deliberate copy divergence from
    // waitlistSpotAvailableTemplate that the spec calls out as
    // load-bearing (§7) — there is no race here, the admin already
    // reserved this specific seat for this specific recipient. A future
    // "let's reuse the race copy" edit would misrepresent the offer.
    expect(withDeadline.html).not.toMatch(/first to claim/i);
    expect(withDeadline.html).not.toMatch(/someone else claims it first/i)
    expect(withDeadline.html).toMatch(/spot.{0,20}saved for you/i)
  })

  it('CTA links DIRECTLY to the Stripe checkoutUrl (no intermediate claim page)', () => {
    expect(withDeadline.html).toContain(
      'href="https://checkout.stripe.com/c/pay/cs_test_abc123"',
    )
    // Unlike waitlist-spot-available's /events/<slug>?claim=1 pattern —
    // there is nothing to "claim", the admin already assigned the seat.
    expect(withDeadline.html).not.toContain('?claim=1')
  })

  it('CTA button label includes the total (ticket + fee)', () => {
    // £20.00 + £0.60 = £20.60
    expect(withDeadline.html).toContain('Complete payment (£20.60)')
  })

  it('shows the ticket / booking fee / total breakdown as separate rows', () => {
    expect(withDeadline.html).toContain('£20.00') // ticket
    expect(withDeadline.html).toContain('£0.60') // fee
    expect(withDeadline.html).toContain('£20.60') // total
    // Non-refundable disclosure — apostrophe is HTML-entity-encoded
    // (&rsquo;) in the source, so match on the surrounding words only.
    expect(withDeadline.html).toMatch(/booking fee covers card processing/i)
    expect(withDeadline.html).toMatch(/refundable/i)
  })

  it('holdExpiresAt present → shows the deadline with urgency framing', () => {
    expect(withDeadline.html).toMatch(/Reserved until/)
    expect(withDeadline.html).toContain('Tuesday 14 July, 4:00 PM')
    expect(withDeadline.html).toMatch(/offer the spot to someone else/i)
  })

  it('holdExpiresAt null → NO countdown/urgency language, neutral copy instead', () => {
    expect(noDeadline.html).not.toMatch(/Reserved until/)
    expect(noDeadline.html).not.toMatch(/offer the spot to someone else/i)
    expect(noDeadline.html).toMatch(/Complete payment below to secure your spot/i)
  })

  it('includes event title, date, and time as detail rows', () => {
    expect(withDeadline.html).toContain('France vs Spain Screening')
    expect(withDeadline.html).toContain('Tuesday 14 July')
    expect(withDeadline.html).toContain('7:00 PM')
  })

  it('links to /bookings for the "questions about your spot" line', () => {
    expect(withDeadline.html).toContain('/bookings')
  })

  it('escapes untrusted input in the event title (XSS defence)', () => {
    const tpl = waitlistPromotionTemplate({
      fullName: 'Bob',
      eventTitle: '<script>alert(1)</script>',
      eventSlug: 'x',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 1000,
      bookingFeePence: 30,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test',
      holdExpiresAt: null,
    })
    expect(tpl.html).not.toContain('<script>alert')
    expect(tpl.html).toContain('&lt;script&gt;')
  })

  it('escapes untrusted input in the holdExpiresAt display string', () => {
    const tpl = waitlistPromotionTemplate({
      fullName: 'Bob',
      eventTitle: 'Safe Title',
      eventSlug: 'x',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 1000,
      bookingFeePence: 30,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test',
      holdExpiresAt: '<img src=x onerror=alert(1)>',
    })
    expect(tpl.html).not.toContain('<img src=x onerror')
    expect(tpl.html).toContain('&lt;img')
  })

  it('handles a zero booking fee (edge case — shouldn\'t occur for a paid event, but must not corrupt the total)', () => {
    const tpl = waitlistPromotionTemplate({
      fullName: 'Test',
      eventTitle: 'X',
      eventSlug: 'x',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 1000,
      bookingFeePence: 0,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test',
      holdExpiresAt: null,
    })
    expect(tpl.html).toContain('Complete payment (£10.00)')
  })

  it('plain-text version strips HTML tags', () => {
    expect(withDeadline.text).not.toMatch(/<[^>]+>/)
    expect(noDeadline.text).not.toMatch(/<[^>]+>/)
  })

  it('plain-text version retains the CTA button LABEL (pre-existing renderButton/htmlToText limitation: raw href is not preserved in text — same as every other template in this dir, e.g. waitlist-spot-available)', () => {
    // Documents actual (shared, pre-existing) behaviour rather than
    // asserting a stronger guarantee this template doesn't actually make.
    // htmlToText (_shared.ts) strips ALL tags including <a href> — the
    // visible button text survives, the URL itself does not. This is
    // common to every template using renderButton, not specific to this
    // one; flagged as a thin-coverage / potential UX gap in the HANDOVER
    // rather than "fixed" here (out of tester-role scope, and fixing it
    // would touch shared infra used by every other transactional email).
    expect(withDeadline.text).toContain('Complete payment (£20.60)')
    expect(withDeadline.text).not.toContain('https://checkout.stripe.com')
  })
})
