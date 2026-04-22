import 'server-only'

/**
 * Day-of event reminder SMS (Phase 2.5 Batch 5).
 *
 * Fires from the daily edge function on the morning of the event for
 * attendees with sms_consent=true. Single segment targeted.
 *
 * We deliberately DON'T ship a 2-day variant over SMS — 2 days out is
 * email territory. SMS is reserved for "today is the day" + the venue
 * reveal above. Keeps per-user SMS volume sane and cost predictable.
 */

export interface EventReminderSmsInput {
  firstName: string
  eventTitle: string
  venueName: string // may be "Venue TBA" if venue_revealed=false (unlikely day-of)
  eventTime: string // e.g. "7pm"
  siteUrl: string
}

export interface RenderedSms {
  body: string
}

export function eventReminderSmsTemplate(
  input: EventReminderSmsInput,
): RenderedSms {
  const base = input.siteUrl.replace(/\/$/, '')
  const manageUrl = `${base}/profile`
  const body =
    `Tonight: ${input.eventTitle} at ${input.eventTime}, ${input.venueName}. See you there! ` +
    `Manage SMS: ${manageUrl}`

  return { body }
}
