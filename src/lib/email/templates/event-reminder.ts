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

export type ReminderVariant = '2day' | 'today'

export interface EventReminderInput {
  variant: ReminderVariant
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string
  eventTime: string
  venueName: string
  venueAddress: string
  postcode: string | null
  /**
   * Whether the venue has been revealed. Events with `venue_revealed = false`
   * at 2 days out would be unusual (the venue-reveal job fires at 7 days),
   * but we handle it gracefully — the reminder still goes, it just omits
   * the address.
   */
  venueRevealed: boolean
  dressCode: string | null
}

/**
 * Sent 2 days before an event and on the day of the event (two runs of
 * the scheduled job with different `variant`s). Same template, different
 * tone.
 */
export function eventReminderTemplate(
  input: EventReminderInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()
  const eventUrl = `${siteUrl}/events/${input.eventSlug}`

  const copy =
    input.variant === 'today'
      ? {
          subject: `Tonight: ${input.eventTitle}`,
          preview: `See you at ${input.eventTitle} \u2014 ${input.eventTime}`,
          heading: 'Tonight\u2019s the night.',
          lead: `Looking forward to seeing you at <strong>${escapeHtml(input.eventTitle)}</strong> later.`,
          ctaLabel: 'View Event Details',
        }
      : {
          subject: `In 2 days: ${input.eventTitle}`,
          preview: `${input.eventTitle} is coming up in 2 days`,
          heading: 'Just a heads-up.',
          lead: `<strong>${escapeHtml(input.eventTitle)}</strong> is in 2 days. Here&rsquo;s a quick reminder.`,
          ctaLabel: 'View Event',
        }

  const venueValue = input.venueRevealed
    ? [input.venueName, input.venueAddress, input.postcode]
        .filter(Boolean)
        .join(', ')
    : 'Revealed 1 week before the event'

  const dressCodeRow = input.dressCode
    ? renderDetailRow({ label: 'Dress code', value: input.dressCode })
    : ''

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  ${copy.heading}
</h1>

<p style="margin:0 0 24px 0;">
  Hi ${escapeHtml(firstName)} &mdash; ${copy.lead}
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0;">
  ${renderDetailRow({ label: 'Date', value: input.eventDate })}
  ${renderDetailRow({ label: 'Time', value: input.eventTime })}
  ${renderDetailRow({ label: 'Venue', value: venueValue })}
  ${dressCodeRow}
</table>

${renderButton({ label: copy.ctaLabel, href: eventUrl })}

<p style="margin:24px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  Plans changed? Cancel at
  <a href="${siteUrl}/bookings" style="color:${COLORS.gold};text-decoration:none;">your bookings page</a>
  so someone else can take your spot.
</p>`

  const html = renderShell({
    previewText: copy.preview,
    bodyHtml,
  })

  return {
    subject: copy.subject,
    html,
    text: htmlToText(html),
  }
}
