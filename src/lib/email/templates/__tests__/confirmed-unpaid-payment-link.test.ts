import { describe, it, expect } from 'vitest'
import { confirmedUnpaidPaymentLinkTemplate } from '../confirmed-unpaid-payment-link'

describe('confirmedUnpaidPaymentLinkTemplate', () => {
  const withDeadline = confirmedUnpaidPaymentLinkTemplate({
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

  const noDeadline = confirmedUnpaidPaymentLinkTemplate({
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

  it('subject is framed as remediating an existing spot, not a fresh admission', () => {
    expect(withDeadline.subject).toBe('Action needed: complete payment for France vs Spain Screening')
    expect(noDeadline.subject).toBe('Action needed: complete payment for Wine & Wisdom')
    // Must NOT use waitlistPromotionTemplate's "You're in:" framing — that
    // implies a fresh admission, which is factually wrong here.
    expect(withDeadline.subject).not.toMatch(/you.{0,3}re in/i)
  })

  it('greets by first name only', () => {
    expect(withDeadline.html).toContain('Hi Amy')
    expect(noDeadline.html).toContain('Hi Yasemin')
  })

  it('falls back to the full string when fullName has no whitespace-separated parts', () => {
    const tpl = confirmedUnpaidPaymentLinkTemplate({
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

  it('INVARIANT: never mentions "waitlist" anywhere in subject, html, or text — this member was never on it this cycle (Addendum §A.5)', () => {
    // The recipient believes (correctly) they already hold a confirmed
    // place. Telling them they were "on the waitlist" or that a "spot's
    // been saved" would be factually wrong and could read as a mistake or
    // a scam attempt. This is the one deliberate copy divergence from
    // waitlistPromotionTemplate that actually matters (mirrors that
    // template's own analogous INVARIANT test for its "not a race" claim).
    for (const tpl of [withDeadline, noDeadline]) {
      expect(tpl.subject.toLowerCase()).not.toContain('waitlist')
      expect(tpl.html.toLowerCase()).not.toContain('waitlist')
      expect(tpl.text.toLowerCase()).not.toContain('waitlist')
    }
  })

  it('INVARIANT: frames the copy as finishing/keeping an EXISTING confirmed spot, not a new offer', () => {
    expect(withDeadline.html).toMatch(/finish confirming your spot/i)
    expect(withDeadline.html).toMatch(/you have a confirmed place at/i)
    // Must not use the sibling waitlist-promotion template's "a spot's
    // been saved for you" framing — that implies the recipient did NOT
    // already have the seat, which is wrong here.
    expect(withDeadline.html).not.toMatch(/spot.{0,20}saved for you/i)
  })

  it('CTA links DIRECTLY to the Stripe checkoutUrl (no intermediate page)', () => {
    expect(withDeadline.html).toContain(
      'href="https://checkout.stripe.com/c/pay/cs_test_abc123"',
    )
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
    expect(withDeadline.html).toMatch(/booking fee covers card processing/i)
    expect(withDeadline.html).toMatch(/refundable/i)
  })

  it('holdExpiresAt present -> shows the deadline with urgency framing', () => {
    expect(withDeadline.html).toMatch(/Please complete payment by/i)
    expect(withDeadline.html).toContain('Tuesday 14 July, 4:00 PM')
    expect(withDeadline.html).toMatch(/offer the spot to someone else/i)
  })

  it('holdExpiresAt null -> NO countdown/urgency language, neutral copy instead', () => {
    expect(noDeadline.html).not.toMatch(/Please complete payment by/i)
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
    const tpl = confirmedUnpaidPaymentLinkTemplate({
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
    const tpl = confirmedUnpaidPaymentLinkTemplate({
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

  it("handles a zero booking fee (edge case — shouldn't occur for a paid event, but must not corrupt the total)", () => {
    const tpl = confirmedUnpaidPaymentLinkTemplate({
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

  it('CROSS-CHECK: subject/body text is genuinely DIFFERENT from waitlistPromotionTemplate for the same input shape (not an accidental re-export or copy with only the file name changed)', async () => {
    const { waitlistPromotionTemplate } = await import('../waitlist-promotion')
    const sameInput = {
      fullName: 'Amy Sangam',
      eventTitle: 'France vs Spain Screening',
      eventSlug: 'france-vs-spain-screening',
      eventDate: 'Tuesday 14 July',
      eventTime: '7:00 PM',
      priceInPence: 2000,
      bookingFeePence: 60,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
      holdExpiresAt: 'Tuesday 14 July, 4:00 PM',
    }
    const remediation = confirmedUnpaidPaymentLinkTemplate(sameInput)
    const promotion = waitlistPromotionTemplate(sameInput)

    expect(remediation.subject).not.toBe(promotion.subject)
    expect(remediation.html).not.toBe(promotion.html)
  })
})
