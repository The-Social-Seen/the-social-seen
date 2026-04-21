import {
  COLORS,
  escapeAttr,
  escapeHtml,
  getSiteUrl,
  htmlToText,
  renderButton,
  renderDetailRow,
  renderShell,
} from './_shared'
import type { RenderedTemplate } from './welcome'

export interface VenueRevealInput {
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string // formatted, e.g. "Wednesday 7 May"
  eventTime: string // formatted, e.g. "7:00 PM"
  venueName: string
  venueAddress: string
  postcode: string | null
}

/**
 * Sent by the daily scheduled job (P2-5) to all confirmed attendees on
 * the day the event becomes 1 week away. The venue was previously hidden
 * on the public event page and from the initial booking confirmation;
 * this email is the first time the attendee sees the address.
 */
export function venueRevealTemplate(
  input: VenueRevealInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()
  const eventUrl = `${siteUrl}/events/${input.eventSlug}`

  // Google Maps "search" URL — works reliably across desktop + mobile,
  // opens the Google Maps app on iOS/Android when tapped from email.
  const mapsQuery = [input.venueName, input.venueAddress, input.postcode]
    .filter(Boolean)
    .join(', ')
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    mapsQuery,
  )}`

  const addressLine = input.postcode
    ? `${input.venueAddress}, ${input.postcode}`
    : input.venueAddress

  const subject = `Venue revealed: ${input.eventTitle}`

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  The venue is revealed.
</h1>

<p style="margin:0 0 24px 0;">
  Hi ${escapeHtml(firstName)} &mdash; one week to go until <strong>${escapeHtml(input.eventTitle)}</strong>.
  Here&rsquo;s where we&rsquo;re meeting.
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0;">
  ${renderDetailRow({ label: 'Event', value: input.eventTitle })}
  ${renderDetailRow({ label: 'Date', value: input.eventDate })}
  ${renderDetailRow({ label: 'Time', value: input.eventTime })}
  ${renderDetailRow({ label: 'Venue', value: input.venueName })}
  ${renderDetailRow({ label: 'Address', value: addressLine })}
</table>

${renderButton({ label: 'Get Directions', href: mapsUrl })}

<p style="margin:16px 0 0 0;font-size:14px;color:${COLORS.textSecondary};text-align:center;">
  Or <a href="${escapeAttr(eventUrl)}" style="color:${COLORS.gold};text-decoration:none;">view the event page</a>.
</p>

<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  Can&rsquo;t make it? Cancel from
  <a href="${siteUrl}/bookings" style="color:${COLORS.gold};text-decoration:none;">your bookings page</a>
  so someone on the waitlist can take your spot.
</p>`

  const html = renderShell({
    previewText: `${input.venueName} \u2014 ${input.eventDate} at ${input.eventTime}`,
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}
