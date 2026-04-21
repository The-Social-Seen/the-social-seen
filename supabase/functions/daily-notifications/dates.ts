// Date/formatting helpers for the daily-notifications edge function.
//
// Two concerns:
//   1. "Today" / "2 days out" / "day after" need to be computed in
//      Europe/London time, not UTC, so that an event at 19:00 London on
//      day X isn't mis-bucketed around midnight UTC.
//   2. We need human-readable date/time strings for the email bodies in
//      the same timezone.

const LONDON_TZ = 'Europe/London'

/**
 * Extract the London local date (YYYY-MM-DD) from an ISO timestamp.
 * Uses Intl.DateTimeFormat so DST is handled correctly.
 */
export function londonDateString(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${day}`
}

/** Today's date in London as YYYY-MM-DD. */
export function londonToday(now: Date = new Date()): string {
  return londonDateString(now.toISOString())
}

/**
 * Add `days` to a YYYY-MM-DD string — returns YYYY-MM-DD. Parses the
 * date at midnight UTC which is fine for day arithmetic.
 */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d)
  const shifted = new Date(base + days * 24 * 60 * 60 * 1000)
  const ry = shifted.getUTCFullYear()
  const rm = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const rd = String(shifted.getUTCDate()).padStart(2, '0')
  return `${ry}-${rm}-${rd}`
}

/** Human-readable date, e.g. "Wednesday 7 May". */
export function formatLondonDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(iso))
}

/** Human-readable time, e.g. "7:00 PM". */
export function formatLondonTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}
