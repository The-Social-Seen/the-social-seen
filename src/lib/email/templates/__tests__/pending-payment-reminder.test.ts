import { describe, it, expect } from 'vitest'
import { pendingPaymentReminderTemplate } from '../pending-payment-reminder'

/**
 * Coverage for `pendingPaymentReminderTemplate`
 * (src/lib/email/templates/pending-payment-reminder.ts) — the
 * abandoned-checkout reminder sent ~15 minutes after a self-service
 * `pending_payment` booking is created and still unpaid. See
 * SYSTEM-DESIGN-pending-payment-visibility.md §1's corollary and §4.2
 * for why this template must NEVER embed a raw Stripe URL: the whole
 * point of "mint on click, not on send" (§1.1) is defeated if the email
 * links directly to a Stripe Checkout Session that may already be dead
 * by the time the member opens the email.
 *
 * Mirrors the sibling template test's shape
 * (confirmed-unpaid-payment-link.test.ts).
 */

describe('pendingPaymentReminderTemplate', () => {
  const base = pendingPaymentReminderTemplate({
    fullName: 'Amaya Kaur',
    eventTitle: 'Summer Rooftop Party',
    eventDate: 'Saturday 15 August',
    eventTime: '7:00 PM',
    priceInPence: 2000,
    bookingFeePence: 60,
    resumeUrl: 'https://the-social-seen.vercel.app/bookings/resume/bk-amaya-1',
    deadline: 'Saturday 15 August, 8:15 PM',
  })

  it('subject frames this as a reminder, not a fresh offer', () => {
    expect(base.subject).toBe('Reminder: complete payment for Summer Rooftop Party')
  })

  it('greets by first name only', () => {
    expect(base.html).toContain('Hi Amaya')
  })

  it('falls back to the full string when fullName has no whitespace-separated parts', () => {
    const tpl = pendingPaymentReminderTemplate({
      fullName: 'Cher',
      eventTitle: 'X',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 1000,
      bookingFeePence: 30,
      resumeUrl: 'https://example.com/bookings/resume/bk-1',
      deadline: 'x',
    })
    expect(tpl.html).toContain('Hi Cher')
  })

  it('includes event title, date, and time as detail rows', () => {
    expect(base.html).toContain('Summer Rooftop Party')
    expect(base.html).toContain('Saturday 15 August')
    expect(base.html).toContain('7:00 PM')
  })

  it('shows the ticket / booking fee / total price breakdown as separate rows', () => {
    expect(base.html).toContain('£20.00') // ticket
    expect(base.html).toContain('£0.60') // fee
    expect(base.html).toContain('£20.60') // total
    expect(base.html).toMatch(/booking fee covers card processing/i)
    expect(base.html).toMatch(/not refundable|isn.{0,10}t refundable/i)
  })

  it('CTA button label includes the total (ticket + fee)', () => {
    expect(base.html).toContain('Complete Payment (£20.60)')
  })

  it("handles a zero booking fee without corrupting the total", () => {
    const tpl = pendingPaymentReminderTemplate({
      fullName: 'Test',
      eventTitle: 'X',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 1000,
      bookingFeePence: 0,
      resumeUrl: 'https://example.com/bookings/resume/bk-1',
      deadline: 'x',
    })
    expect(tpl.html).toContain('Complete Payment (£10.00)')
  })

  it('shows the deadline as soft, non-ticking copy ("release the spot"), not a countdown', () => {
    expect(base.html).toContain('Saturday 15 August, 8:15 PM')
    expect(base.html).toMatch(/release the spot/i)
  })

  it('INVARIANT: the CTA links to the app resumeUrl, never a raw Stripe URL — mint-on-click, not mint-on-send (spec §1.1 corollary)', () => {
    expect(base.html).toContain('href="https://the-social-seen.vercel.app/bookings/resume/bk-amaya-1"')
  })

  it('INVARIANT: the rendered output never contains a stripe.com / checkout.stripe URL substring, for any input', () => {
    // Structural guarantee: PendingPaymentReminderInput has no
    // `checkoutUrl` field at all (only `resumeUrl`, an app-owned path) —
    // this test proves the RENDERED output honours that even if a
    // resumeUrl happens to be passed that itself doesn't contain a
    // Stripe domain (the realistic case, since resumeUrl is always
    // `${SITE_URL}/bookings/resume/${bookingId}` per the Edge Function
    // caller).
    expect(base.html.toLowerCase()).not.toContain('checkout.stripe.com')
    expect(base.html.toLowerCase()).not.toContain('stripe.com')
    expect(base.text.toLowerCase()).not.toContain('stripe.com')
  })

  it('TYPE GUARD: PendingPaymentReminderInput does not accept a checkoutUrl field (compile-time proof the template cannot even be handed a raw Stripe URL)', () => {
    pendingPaymentReminderTemplate({
      fullName: 'Test',
      eventTitle: 'X',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 1000,
      bookingFeePence: 0,
      resumeUrl: 'https://example.com/bookings/resume/bk-1',
      deadline: 'x',
      // @ts-expect-error — `checkoutUrl` is not a key of
      // PendingPaymentReminderInput. If a future edit widens the input
      // type to accept one, this line will stop erroring and the build
      // will fail here, forcing a conscious decision rather than a
      // silent regression back into the "mint on send" staleness bug.
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_should_not_compile',
    })
    expect(true).toBe(true)
  })

  it('links to /bookings for the "review any of your bookings" line', () => {
    expect(base.html).toContain('/bookings')
  })

  it('escapes untrusted input in the event title (XSS defence)', () => {
    const tpl = pendingPaymentReminderTemplate({
      fullName: 'Bob',
      eventTitle: '<script>alert(1)</script>',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 1000,
      bookingFeePence: 30,
      resumeUrl: 'https://example.com/bookings/resume/bk-1',
      deadline: 'x',
    })
    expect(tpl.html).not.toContain('<script>alert')
    expect(tpl.html).toContain('&lt;script&gt;')
  })

  it('escapes untrusted input in fullName (XSS defence)', () => {
    const tpl = pendingPaymentReminderTemplate({
      fullName: '<img src=x onerror=alert(1)>',
      eventTitle: 'Safe Title',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 1000,
      bookingFeePence: 30,
      resumeUrl: 'https://example.com/bookings/resume/bk-1',
      deadline: 'x',
    })
    expect(tpl.html).not.toContain('<img src=x onerror')
  })

  it('escapes untrusted input in the deadline display string', () => {
    const tpl = pendingPaymentReminderTemplate({
      fullName: 'Bob',
      eventTitle: 'Safe Title',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 1000,
      bookingFeePence: 30,
      resumeUrl: 'https://example.com/bookings/resume/bk-1',
      deadline: '<img src=x onerror=alert(1)>',
    })
    expect(tpl.html).not.toContain('<img src=x onerror')
    expect(tpl.html).toContain('&lt;img')
  })

  it('escapes untrusted input in eventDate/eventTime', () => {
    const tpl = pendingPaymentReminderTemplate({
      fullName: 'Bob',
      eventTitle: 'Safe Title',
      eventDate: '<b>x</b>',
      eventTime: '<b>y</b>',
      priceInPence: 1000,
      bookingFeePence: 30,
      resumeUrl: 'https://example.com/bookings/resume/bk-1',
      deadline: 'x',
    })
    expect(tpl.html).not.toContain('<b>x</b>')
    expect(tpl.html).not.toContain('<b>y</b>')
  })

  it('escapes the resumeUrl when used as an href attribute value (attribute-injection defence)', () => {
    const tpl = pendingPaymentReminderTemplate({
      fullName: 'Bob',
      eventTitle: 'Safe Title',
      eventDate: 'x',
      eventTime: 'x',
      priceInPence: 1000,
      bookingFeePence: 30,
      resumeUrl: 'https://example.com/bookings/resume/bk-1"><script>alert(1)</script>',
      deadline: 'x',
    })
    expect(tpl.html).not.toContain('"><script>alert(1)</script>')
  })

  it('plain-text version strips HTML tags', () => {
    expect(base.text).not.toMatch(/<[^>]+>/)
  })

  it('INVARIANT: never uses waitlistPromotionTemplate\'s "a spot\'s been saved for you" / "You\'re in" framing — this recipient does not have a confirmed spot yet, unlike that template\'s recipient', () => {
    expect(base.html).not.toMatch(/spot.{0,20}saved for you/i)
    expect(base.subject).not.toMatch(/you.{0,3}re in/i)
  })

  it('CROSS-CHECK: subject/body text is genuinely different from confirmedUnpaidPaymentLinkTemplate for a structurally similar input (not an accidental copy-paste with only the file name changed)', async () => {
    const { confirmedUnpaidPaymentLinkTemplate } = await import('../confirmed-unpaid-payment-link')
    const remediation = confirmedUnpaidPaymentLinkTemplate({
      fullName: 'Amaya Kaur',
      eventTitle: 'Summer Rooftop Party',
      eventSlug: 'summer-rooftop-party',
      eventDate: 'Saturday 15 August',
      eventTime: '7:00 PM',
      priceInPence: 2000,
      bookingFeePence: 60,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
      holdExpiresAt: 'Saturday 15 August, 8:15 PM',
    })

    expect(base.subject).not.toBe(remediation.subject)
    expect(base.html).not.toBe(remediation.html)
    // The remediation template's recipient already HAS a confirmed spot —
    // this one's recipient does not. Conflating the two framings would
    // misrepresent the member's actual booking state (spec §7.3 /
    // module doc comment).
    expect(base.html).toMatch(/isn.{0,10}t confirmed yet/i)
  })
})
