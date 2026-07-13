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

export interface WaitlistPromotionInput {
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string // formatted, e.g. "Wednesday 7 May"
  eventTime: string // formatted, e.g. "7:00 PM"
  priceInPence: number
  bookingFeePence: number
  /**
   * Stripe-hosted Checkout URL. Passed in directly — this template does
   * NOT construct it (createAdminBookingHold already has it from Stripe).
   */
  checkoutUrl: string
  /**
   * Pre-formatted display string (e.g. "Saturday 14 March, 3:00 PM"), or
   * null when the hold has no automated deadline (no countdown language
   * in that case — see the conditional block below).
   */
  holdExpiresAt: string | null
}

/**
 * Sent when an admin promotes a waitlisted member to a seat on a PAID
 * event (promoteFromWaitlist → createAdminBookingHold). This is NOT the
 * `waitlist_spot_available` race — the admin has already reserved this
 * specific seat for this specific recipient, so the copy is framed as a
 * personal offer ("a spot's been saved for you"), not "first to claim
 * wins". Deliberately its own template rather than reusing
 * waitlistSpotAvailableTemplate (wrong framing) or the dead
 * `pending_payment` branch of bookingConfirmationTemplate (no
 * checkoutUrl field, CTA points at the event page rather than Stripe).
 *
 * The CTA links straight to the Stripe-hosted Checkout Session — there's
 * no intermediate "claim" page, unlike the waitlist-race email.
 *
 * NOTE: copy below is a first draft in the house style, not final —
 * exact wording and the charge amount shown to real members are reviewed
 * by a human before this ever sends for a real booking (see
 * SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §7, §9.1).
 */
export function waitlistPromotionTemplate(
  input: WaitlistPromotionInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()

  const totalPence = input.priceInPence + input.bookingFeePence
  const totalLabel = formatPriceExact(totalPence)

  const subject = `You’re in: ${input.eventTitle}`

  const urgencyBlock = input.holdExpiresAt
    ? `<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">
  Reserved until <strong>${escapeHtml(input.holdExpiresAt)}</strong> &mdash; after that we may need to offer the spot to someone else.
</p>`
    : `<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">
  Complete payment below to secure your spot.
</p>`

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  A spot&rsquo;s been saved for you.
</h1>

<p style="margin:0 0 16px 0;">
  Hi ${escapeHtml(firstName)} &mdash; you were on the waitlist for
  <strong>${escapeHtml(input.eventTitle)}</strong>, and we&rsquo;d love to
  have you. We&rsquo;ve set a seat aside &mdash; it&rsquo;s yours as soon
  as you complete payment below.
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
    previewText: `A spot's been saved for you at ${input.eventTitle}.`,
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}
