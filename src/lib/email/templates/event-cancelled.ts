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

/**
 * Variant of the event-cancelled email, determined by the recipient's
 * booking status at the time the admin cancelled.
 *
 *   - confirmed_refunded — paid booking, got a full refund (price + fee)
 *   - confirmed_free     — confirmed on a free event (no refund involved)
 *   - waitlisted         — was on the waitlist (no charge, no refund)
 *   - pending_payment    — was mid-checkout when the cancel landed
 *
 * Per SYSTEM-DESIGN-refund-fee-deduction.md §7.4.
 */
export type EventCancelledVariant =
  | 'confirmed_refunded'
  | 'confirmed_free'
  | 'waitlisted'
  | 'pending_payment'

export interface EventCancelledInput {
  variant: EventCancelledVariant
  fullName: string
  eventTitle: string
  eventDate: string // formatted, e.g. "Wednesday 7 May"
  eventTime: string // formatted, e.g. "7:00 PM"
  /**
   * Refund amount in pence — required when variant is
   * 'confirmed_refunded' (rendered into the body so the customer sees
   * exactly what's coming back). Ignored for all other variants.
   */
  refundedAmountPence?: number
}

/**
 * Sent to every affected member when an admin cancels an event via
 * cancelEventAndRefundBookings(). The variant determines tone and
 * whether a refund amount appears.
 *
 * Transactional — no unsubscribe footer (per renderShell's documented
 * behaviour). The user took an action (booked / waitlisted) that
 * implicitly requires us to notify them when the event is pulled.
 */
export function eventCancelledTemplate(
  input: EventCancelledInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()
  const eventsUrl = `${siteUrl}/events`

  // ── Per-variant copy ──────────────────────────────────────────────────
  const copy: Record<
    EventCancelledVariant,
    { subject: string; preview: string; heading: string; leadHtml: string }
  > = {
    confirmed_refunded: {
      subject: `We've cancelled ${input.eventTitle} — full refund issued`,
      preview: `${input.eventTitle} has been cancelled. A full refund is on the way.`,
      heading: 'We’ve cancelled this event.',
      leadHtml:
        input.refundedAmountPence !== undefined && input.refundedAmountPence > 0
          ? `We’re sorry — <strong>${escapeHtml(input.eventTitle)}</strong> has been cancelled. We’re refunding <strong>${escapeHtml(formatPriceExact(input.refundedAmountPence))}</strong> to your card (this includes the booking fee, because the cancellation is on us). Refunds usually arrive within 5–10 working days.`
          : `We’re sorry — <strong>${escapeHtml(input.eventTitle)}</strong> has been cancelled. A refund is on its way; it usually arrives within 5–10 working days.`,
    },
    confirmed_free: {
      subject: `We've cancelled ${input.eventTitle}`,
      preview: `${input.eventTitle} has been cancelled.`,
      heading: 'We’ve cancelled this event.',
      leadHtml: `We’re sorry — <strong>${escapeHtml(input.eventTitle)}</strong> has been cancelled. There’s no charge to refund (this was a free event), but we’d love to see you at another one soon.`,
    },
    waitlisted: {
      subject: `${input.eventTitle} has been cancelled — heads-up`,
      preview: `${input.eventTitle} has been cancelled.`,
      heading: 'Heads-up — an event you were waitlisted for has been cancelled.',
      leadHtml: `You were on the waitlist for <strong>${escapeHtml(input.eventTitle)}</strong>, which we’ve had to cancel. Sorry to miss seeing you — we’d love to suggest some alternatives.`,
    },
    pending_payment: {
      subject: `${input.eventTitle} has been cancelled`,
      preview: `${input.eventTitle} has been cancelled. No charge made.`,
      heading: 'We’ve cancelled this event.',
      leadHtml: `We’re sorry — <strong>${escapeHtml(input.eventTitle)}</strong> has been cancelled before your payment completed, so <strong>no charge has been made</strong> to your card. Here are other events you might enjoy.`,
    },
  }

  const variantCopy = copy[input.variant]

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  ${variantCopy.heading}
</h1>

<p style="margin:0 0 24px 0;">
  Hi ${escapeHtml(firstName)} &mdash; ${variantCopy.leadHtml}
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0;">
  ${renderDetailRow({ label: 'Event', value: input.eventTitle })}
  ${renderDetailRow({ label: 'Date', value: input.eventDate })}
  ${renderDetailRow({ label: 'Time', value: input.eventTime })}
</table>

${renderButton({ label: 'Browse other events', href: eventsUrl })}

<p style="margin:24px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  Questions? Email us at <a href="mailto:info@the-social-seen.com" style="color:${COLORS.gold};text-decoration:none;">info@the-social-seen.com</a> and we’ll help.
</p>`

  const html = renderShell({
    previewText: variantCopy.preview,
    bodyHtml,
  })

  return {
    subject: variantCopy.subject,
    html,
    text: htmlToText(html),
  }
}
