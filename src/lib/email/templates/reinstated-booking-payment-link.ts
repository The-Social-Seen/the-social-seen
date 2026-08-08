import {
  COLORS,
  escapeHtml,
  getSiteUrl,
  htmlToText,
  renderButton,
  renderDetailRow,
  renderShell,
} from './_shared'
import { formatPriceExact } from '@/lib/utils/currency'
import type { RenderedTemplate } from './welcome'

export interface ReinstatedBookingPaymentLinkInput {
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string // formatted, e.g. "Wednesday 7 May"
  eventTime: string // formatted, e.g. "7:00 PM"
  priceInPence: number
  bookingFeePence: number
  /**
   * Stripe-hosted Checkout URL. Passed in directly — this template does
   * NOT construct it (createAdminReinstatementHold already has it from
   * Stripe).
   */
  checkoutUrl: string
  /**
   * Pre-formatted display string (e.g. "Saturday 14 March, 3:00 PM"), or
   * null when the hold has no automated deadline (no countdown language
   * in that case — see the conditional block below). Per
   * SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md §6, this is `null`
   * for the foreseeable future.
   */
  holdExpiresAt: string | null
}

/**
 * Sent when an admin reinstates a `cancelled` booking (auto-cancelled by
 * `reap_stale_pending_bookings()` when the member's original payment
 * window lapsed) on a PAID event that has room again
 * (`reinstateCancelledBooking` → `createAdminReinstatementHold` →
 * `admin_reinstate_cancelled_booking_for_payment`). This is Gap C in
 * SYSTEM-DESIGN-admin-waitlist-promotion-payment.md's lineage — see
 * SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md §4.6 for the framing
 * decision this template implements.
 *
 * Deliberately its OWN template, not a branch inside
 * `waitlistPromotionTemplate` or `confirmedUnpaidPaymentLinkTemplate` —
 * same three-reason pattern the base spec and Addendum both already
 * applied (a new file costs nothing extra; the copy is fundamentally
 * different framing either way): this recipient was never on the
 * waitlist this cycle (`waitlistPromotionTemplate` would be wrong), and
 * they were told, correctly, that their booking was cancelled — they do
 * NOT currently hold a confirmed seat (`confirmedUnpaidPaymentLinkTemplate`
 * would be wrong too). The honest framing is "your spot was released
 * when your payment window closed — we've reserved it again for you, but
 * please confirm soon."
 *
 * The CTA links straight to the Stripe-hosted Checkout Session — no
 * intermediate "claim" page, same as its two siblings.
 *
 * Price shown is `input.priceInPence` — the booking's own PRESERVED
 * `price_at_booking` (not the event's current price; see design doc §3.4
 * for why this origin deviates), plus the fresh `bookingFeePence`. The
 * caller (`createAdminReinstatementHold` via `runAdminHoldFlow`'s
 * origin-aware `priceSource: 'booking'` resolution) is responsible for
 * passing the correct preserved value here — this template just renders
 * whatever it's given, same as its siblings.
 *
 * COPY: final, per UX-REVIEW-admin-reinstate-cancelled-booking.md §1
 * ("COPY FINAL — ready for backend-developer to drop in verbatim"),
 * dropped in verbatim from that doc's §1.11 reference implementation.
 * Framing decision (that doc §1.1): the honest fact pattern is
 * acknowledged plainly ("your payment window... closed... so your spot
 * was released") without blame language, then pivots immediately to the
 * fix — deliberately distinct from both sibling templates' framing.
 */
export function reinstatedBookingPaymentLinkTemplate(
  input: ReinstatedBookingPaymentLinkInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()

  const totalPence = input.priceInPence + input.bookingFeePence
  const totalLabel = formatPriceExact(totalPence)

  const subject = `Your spot's back: ${input.eventTitle}`

  const urgencyBlock = input.holdExpiresAt
    ? `<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">
  Reserved until <strong>${escapeHtml(input.holdExpiresAt)}</strong> &mdash; after that we may need to offer the spot to someone else.
</p>`
    : `<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">
  Complete payment below to secure your spot.
</p>`

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  We&rsquo;ve reserved your spot again.
</h1>

<p style="margin:0 0 16px 0;">
  Hi ${escapeHtml(firstName)} &mdash; your payment window for
  <strong>${escapeHtml(input.eventTitle)}</strong> closed before we received your
  payment, so your spot was released. We&rsquo;ve reserved it again for you &mdash;
  please complete payment below to secure it.
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0;">
  ${renderDetailRow({ label: 'Event', value: input.eventTitle })}
  ${renderDetailRow({ label: 'Date', value: input.eventDate })}
  ${renderDetailRow({ label: 'Time', value: input.eventTime })}
</table>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 0 0;">
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};">Ticket</td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;">${escapeHtml(formatPriceExact(input.priceInPence))}</td>
  </tr>
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};">Booking fee</td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;">${escapeHtml(formatPriceExact(input.bookingFeePence))}</td>
  </tr>
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};border-top:1px solid ${COLORS.border};"><strong>Total</strong></td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;border-top:1px solid ${COLORS.border};"><strong>${escapeHtml(totalLabel)}</strong></td>
  </tr>
</table>
<p style="margin:8px 0 0 0;font-size:12px;color:${COLORS.textSecondary};">
  The booking fee covers card processing and isn&rsquo;t refundable.
</p>

${renderButton({ label: `Complete payment (${totalLabel})`, href: input.checkoutUrl })}

${urgencyBlock}

<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  Questions about your spot? You can review all your bookings any time at
  <a href="${siteUrl}/bookings" style="color:${COLORS.gold};text-decoration:none;">your bookings page</a>.
</p>`

  const html = renderShell({
    previewText: `We've reserved your spot again — complete payment to keep it.`,
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}
