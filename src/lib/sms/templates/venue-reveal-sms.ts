import 'server-only'

/**
 * Venue-reveal SMS template (Phase 2.5 Batch 5).
 *
 * Fires from the daily edge function one week before an event, for
 * attendees who have sms_consent=true. Complements the email template
 * — email is the primary channel (richer formatting); SMS is a
 * "guaranteed delivery" nudge for time-critical info.
 *
 * Budget: GSM-7 160-char soft cap. Going over doesn't fail but fragments
 * into multiple segments (cost × N). Content tuned for the median case
 * (short event title, standard London postcode).
 *
 * UK PECR: every SMS must carry an opt-out surface. Alphanumeric
 * senders (e.g. "SocialSeen") can't receive SMS replies, so we can't
 * honour "STOP" via SMS. Instead every body includes a link to
 * /profile where users can toggle sms_consent off. This plus the
 * profile preferences UI makes opt-out "as easy as opt-in".
 */

export interface VenueRevealSmsInput {
  firstName: string
  eventTitle: string
  venueName: string
  eventDate: string // e.g. "Fri 9 May"
  eventTime: string // e.g. "7pm"
  siteUrl: string
}

export interface RenderedSms {
  body: string
}

export function venueRevealSmsTemplate(
  input: VenueRevealSmsInput,
): RenderedSms {
  const base = input.siteUrl.replace(/\/$/, '')
  const manageUrl = `${base}/profile`
  const body =
    `The Social Seen: ${input.eventTitle} venue — ${input.venueName} on ${input.eventDate} ${input.eventTime}. ` +
    `Manage SMS: ${manageUrl}`

  return { body }
}
