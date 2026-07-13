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

export interface ConfirmedUnpaidPaymentLinkInput {
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string // formatted, e.g. "Wednesday 7 May"
  eventTime: string // formatted, e.g. "7:00 PM"
  priceInPence: number
  bookingFeePence: number
  /**
   * Stripe-hosted Checkout URL. Passed in directly — this template does
   * NOT construct it (createAdminPaymentRemediationHold already has it
   * from Stripe).
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
 * Sent when an admin remediates a CONFIRMED booking on a PAID event that
 * was never actually charged (sendPaymentLinkForConfirmedBooking →
 * createAdminPaymentRemediationHold → admin_hold_confirmed_booking_for_
 * payment). This is Gap A in
 * SYSTEM-DESIGN-admin-waitlist-promotion-payment.md's
 * "Addendum (2026-07-13, same day)" — the production-incident-repair
 * path for bookings that ended up `status='confirmed'` with
 * `stripe_payment_id IS NULL` (Amy Sangam / Yasemin Salp).
 *
 * Deliberately its OWN template, not a branch inside
 * waitlistPromotionTemplate (waitlist-promotion.ts) or a reuse of
 * waitlistSpotAvailableTemplate — for the same three reasons the base
 * spec already used to justify waitlist-promotion.ts as its own file
 * (§7): a new file costs nothing extra (same shared _shared.ts
 * primitives), and — the one that actually matters here — the copy is
 * fundamentally different framing. The recipient was NEVER on the
 * waitlist this cycle; they believe (correctly) that they already hold
 * a confirmed place. Telling them they were "on the waitlist" or that a
 * "spot's been saved" would be factually wrong and could read as a
 * mistake or a scam attempt ("wait, was I on a waitlist? I thought I had
 * a ticket"). This template's copy is framed as "let's finish confirming
 * a spot you already have" and must NOT mention "waitlist" anywhere. See
 * Addendum §A.5.
 *
 * The CTA links straight to the Stripe-hosted Checkout Session — there's
 * no intermediate "claim" page, same as waitlistPromotionTemplate.
 *
 * NOTE: copy below is a first draft in the house style, not final —
 * exact wording and the charge amount shown to real members are reviewed
 * by a human before this ever sends for a real booking (see
 * SYSTEM-DESIGN-admin-waitlist-promotion-payment.md Addendum §A.5 and
 * the addendum's own open questions list, item 1 — same reserved review
 * step as the base spec's §7/§9.1).
 */
export function confirmedUnpaidPaymentLinkTemplate(
  input: ConfirmedUnpaidPaymentLinkInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()

  const totalPence = input.priceInPence + input.bookingFeePence
  const totalLabel = formatPriceExact(totalPence)

  const subject = `Action needed: complete payment for ${input.eventTitle}`

  const urgencyBlock = input.holdExpiresAt
    ? `<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">
  Please complete payment by <strong>${escapeHtml(input.holdExpiresAt)}</strong> &mdash; after that we may need to offer the spot to someone else.
</p>`
    : `<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">
  Complete payment below to secure your spot.
</p>`

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  Let&rsquo;s finish confirming your spot.
</h1>

<p style="margin:0 0 16px 0;">
  Hi ${escapeHtml(firstName)} &mdash; you have a confirmed place at
  <strong>${escapeHtml(input.eventTitle)}</strong>, but we&rsquo;re missing
  a completed payment on our side. To keep your spot, please complete
  payment below.
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
    previewText: `Action needed to keep your spot at ${input.eventTitle}.`,
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}
