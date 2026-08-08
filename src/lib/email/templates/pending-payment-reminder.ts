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

export interface PendingPaymentReminderInput {
  fullName: string
  eventTitle: string
  eventDate: string // formatted, e.g. "Wednesday 7 May"
  eventTime: string // formatted, e.g. "7:00 PM"
  priceInPence: number
  bookingFeePence: number
  /**
   * App URL — `{SITE_URL}/bookings/resume/{bookingId}` — NOT a raw
   * Stripe URL. Per SYSTEM-DESIGN-pending-payment-visibility.md §1's
   * corollary, the fresh Checkout Session is minted at CLICK time by
   * that route, not at send time here. Embedding a Stripe URL directly
   * would reintroduce the exact staleness bug this feature exists to
   * prevent for an email with unbounded open-latency.
   */
  resumeUrl: string
  /**
   * Pre-formatted display string (e.g. "Saturday 14 March, 3:00 PM") —
   * the reaper's approximate cutoff (created_at + 35 minutes, the
   * reaper's own floor — see reap_stale_pending_bookings()). Always
   * shown; unlike confirmedUnpaidPaymentLinkTemplate's holdExpiresAt,
   * there is no "no deadline" branch here — a self-service
   * pending_payment row always has the reaper's cutoff.
   */
  deadline: string
}

/**
 * Sent once, ~15 minutes after a self-service `pending_payment` booking
 * is created and still unpaid (book_event_paid / claim_waitlist_spot),
 * by the `pending-payment-reminder` Edge Function
 * (supabase/functions/pending-payment-reminder). See
 * SYSTEM-DESIGN-pending-payment-visibility.md §3/§4 for the timing and
 * send mechanism, and UX-REVIEW-pending-payment-visibility.md §7 for the
 * full copy this template lifts verbatim.
 *
 * Deliberately its OWN template, not a reuse of
 * confirmedUnpaidPaymentLinkTemplate — structurally similar (price
 * table → button → urgency line → footer link, same _shared.ts
 * primitives) but the copy framing is fundamentally different: THIS
 * recipient does NOT have a confirmed spot yet ("Your spot's on hold" /
 * "isn't confirmed yet"), whereas that template's recipient already has
 * a confirmed seat missing a payment. Conflating the two framings would
 * misrepresent the member's actual booking state. See UX-REVIEW §7 and
 * the base SYSTEM-DESIGN §7.3 note.
 *
 * No Stripe calls happen here or in the caller — the CTA is an app URL
 * that mints a fresh Checkout Session on click (§1's corollary), so this
 * template only ever needs data already on the booking/event/profile
 * rows.
 */
export function pendingPaymentReminderTemplate(
  input: PendingPaymentReminderInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()

  const totalPence = input.priceInPence + input.bookingFeePence
  const totalLabel = formatPriceExact(totalPence)

  const subject = `Reminder: complete payment for ${input.eventTitle}`

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  Your spot&rsquo;s on hold.
</h1>

<p style="margin:0 0 16px 0;">
  Hi ${escapeHtml(firstName)} &mdash; looks like you started booking
  <strong>${escapeHtml(input.eventTitle)}</strong> but didn&rsquo;t get to
  finish. Your spot isn&rsquo;t confirmed yet, but we&rsquo;re holding it
  for you a little longer.
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

${renderButton({ label: `Complete Payment (${totalLabel})`, href: input.resumeUrl })}

<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">
  Complete payment by <strong>${escapeHtml(input.deadline)}</strong> &mdash; after that, we&rsquo;ll release the spot so someone else can have it.
</p>

<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  Changed your mind? No need to do anything &mdash; the hold will simply
  expire and we&rsquo;ll let it go. You can review this (or any of your
  bookings) any time at
  <a href="${siteUrl}/bookings" style="color:${COLORS.gold};text-decoration:none;">your bookings page</a>.
</p>`

  const html = renderShell({
    previewText: 'Your spot is on hold — finish up when you’re ready.',
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}
