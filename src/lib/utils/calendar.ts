/**
 * ICS calendar file generation for event bookings.
 * Extracted from BookingModal.tsx inline implementation.
 * All timestamps are converted to UTC for the ICS format.
 */

interface CalendarEvent {
  title: string
  dateTime: string      // ISO string (UTC from DB)
  endTime: string       // ISO string (UTC from DB)
  venueName: string
  venueAddress: string
  shortDescription: string
  slug: string
}

/**
 * Format a Date to ICS-compatible UTC timestamp: 20260314T190000Z
 */
function formatIcsDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/**
 * Escape special characters for ICS text fields.
 * ICS spec requires escaping backslashes, semicolons, commas, and newlines.
 */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Generate ICS file content string for an event.
 */
export function generateIcsContent(event: CalendarEvent): string {
  const start = formatIcsDate(new Date(event.dateTime))
  const end = formatIcsDate(new Date(event.endTime))
  const now = formatIcsDate(new Date())
  const uid = `${event.slug}-${start}@thesocialseen.com`

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Social Seen//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `LOCATION:${escapeIcsText(`${event.venueName}, ${event.venueAddress}`)}`,
    `DESCRIPTION:${escapeIcsText(event.shortDescription)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

/**
 * Trigger a browser download of an .ics calendar file for the event.
 * Client-side only — call from an onClick handler.
 */
export function downloadIcsFile(event: CalendarEvent): void {
  const content = generateIcsContent(event)
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${event.slug}.ics`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
