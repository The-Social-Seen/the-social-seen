import {
  COLORS,
  escapeHtml,
  getSiteUrl,
  htmlToText,
  renderButton,
  renderDetailRow,
  renderShell,
} from './_shared'
import type { RenderedTemplate } from './welcome'

export interface BookingConfirmationInput {
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string // formatted, e.g. "Wednesday 7 May"
  eventTime: string // formatted, e.g. "7:00 PM"
  venueName: string
  venueAddress: string
  venueRevealed: boolean
  status: 'confirmed' | 'waitlisted' | 'pending_payment'
  waitlistPosition: number | null
}

/**
 * Sent immediately after a successful booking. Three variants based on
 * the booking status — confirmed (you're in), waitlisted (you're #N in
 * line), pending_payment (placeholder, P2-7 will wire Stripe).
 *
 * Venue is hidden when `venueRevealed: false` (P2-5 venue-reveal flow).
 */
export function bookingConfirmationTemplate(
  input: BookingConfirmationInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()
  const eventUrl = `${siteUrl}/events/${input.eventSlug}`

  // ── Per-status copy ──────────────────────────────────────────────────────
  const statusCopy = {
    confirmed: {
      subject: `You\u2019re booked: ${input.eventTitle}`,
      preview: `Confirmed for ${input.eventTitle}`,
      heading: 'You\u2019re booked.',
      lead: `We\u2019ve confirmed your spot at <strong>${escapeHtml(input.eventTitle)}</strong>. The details are below.`,
      ctaLabel: 'View Event',
    },
    waitlisted: {
      subject: `You\u2019re on the waitlist: ${input.eventTitle}`,
      preview: `Waitlisted for ${input.eventTitle}${input.waitlistPosition ? ` \u2014 #${input.waitlistPosition}` : ''}`,
      heading: 'You\u2019re on the waitlist.',
      lead:
        input.waitlistPosition !== null
          ? `<strong>${escapeHtml(input.eventTitle)}</strong> is full, but you\u2019re <strong>#${input.waitlistPosition}</strong> in line. We\u2019ll email you the moment a spot opens up.`
          : `<strong>${escapeHtml(input.eventTitle)}</strong> is full, but you\u2019re on the waitlist. We\u2019ll email you the moment a spot opens up.`,
      ctaLabel: 'View Event',
    },
    pending_payment: {
      subject: `Finish booking: ${input.eventTitle}`,
      preview: `Complete payment to secure your spot at ${input.eventTitle}`,
      heading: 'Almost there.',
      lead: `Your spot at <strong>${escapeHtml(input.eventTitle)}</strong> is held while you complete payment. Tap below to finish.`,
      ctaLabel: 'Complete Payment',
    },
  }[input.status]

  // ── Venue rendering — hidden until 1 week before for venue_revealed=false
  // Both venueName and venueAddress are admin-controlled today, but escape
  // both unconditionally — defence-in-depth so a future user-supplied venue
  // (e.g. user-suggested venues) can't inject markup.
  const venueValue = input.venueRevealed
    ? `${escapeHtml(input.venueName)}${input.venueAddress ? `<br><span style="color:${COLORS.textSecondary};font-size:13px;">${escapeHtml(input.venueAddress)}</span>` : ''}`
    : `<span style="color:${COLORS.textSecondary};font-style:italic;">Revealed 1 week before the event</span>`

  // The detail row helper escapes its `value` — we need raw HTML for the
  // venue (italic text and address line). Inline that row manually.
  const venueRow = `<tr>
  <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};width:120px;vertical-align:top;">Venue</td>
  <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};font-weight:500;">${venueValue}</td>
</tr>`

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  ${statusCopy.heading}
</h1>

<p style="margin:0 0 24px 0;">
  Hi ${escapeHtml(firstName)} &mdash; ${statusCopy.lead}
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0;">
  ${renderDetailRow({ label: 'Event', value: input.eventTitle })}
  ${renderDetailRow({ label: 'Date', value: input.eventDate })}
  ${renderDetailRow({ label: 'Time', value: input.eventTime })}
  ${venueRow}
</table>

${renderButton({ label: statusCopy.ctaLabel, href: eventUrl })}

<p style="margin:24px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  Need to cancel? You can manage all your bookings at
  <a href="${siteUrl}/bookings" style="color:${COLORS.gold};text-decoration:none;">your bookings page</a>.
</p>`

  const html = renderShell({
    previewText: statusCopy.preview,
    bodyHtml,
  })

  return {
    subject: statusCopy.subject,
    html,
    text: htmlToText(html),
  }
}
