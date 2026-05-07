import { LONDON_TZ } from '@/lib/constants'

// ── Internal helper ───────────────────────────────────────────────────────────

/**
 * Returns a named-part map from Intl.DateTimeFormat.formatToParts().
 * Handles both Date objects and ISO timestamp strings from Supabase.
 */
function getParts(
  date: Date,
  options: Omit<Intl.DateTimeFormatOptions, 'timeZone'>
): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    ...options,
    timeZone: LONDON_TZ,
  })
  return Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value])
  )
}

function toDate(date: Date | string): Date {
  return typeof date === 'string' ? new Date(date) : date
}

// ── Three-tier date formatting (per Amendment 3.4 / RC-06) ───────────────────

/**
 * Tier 1 — Event card.
 * Output: "Sat 14 Mar"
 */
export function formatDateCard(date: Date | string): string {
  const d = toDate(date)
  const p = getParts(d, { weekday: 'short', day: 'numeric', month: 'short' })
  return `${p.weekday} ${p.day} ${p.month}`
}

/**
 * Tier 2 — Booking modal / compact detail.
 * Output: "Saturday 14 March, 7:00 PM"
 */
export function formatDateModal(date: Date | string): string {
  const d = toDate(date)
  const dateParts = getParts(d, { weekday: 'long', day: 'numeric', month: 'long' })
  const time = formatTime(d)
  return `${dateParts.weekday} ${dateParts.day} ${dateParts.month}, ${time}`
}

/**
 * Tier 3 — Full event detail page.
 * Output: "Saturday 14 March 2026"
 */
export function formatDateFull(date: Date | string): string {
  const d = toDate(date)
  const p = getParts(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`
}

// ── Time formatting ───────────────────────────────────────────────────────────

/**
 * Format a time value in Europe/London timezone.
 * Output: "7:00 PM"
 */
export function formatTime(date: Date | string): string {
  const d = toDate(date)
  // Get hour in 24h format for AM/PM calculation, then format display hour
  const h24Parts = getParts(d, { hour: 'numeric', hour12: false })
  const h24 = parseInt(h24Parts.hour ?? '0', 10)
  const minParts = getParts(d, { minute: '2-digit' })
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 || 12
  // Node.js 24: '2-digit' minute returns '0' not '00' — pad explicitly
  const mm = minParts.minute.padStart(2, '0')
  return `${h12}:${mm} ${period}`
}

/**
 * Format a date range as a time span.
 * Output: "7:00 PM – 10:00 PM"
 */
export function formatTimeRange(start: Date | string, end: Date | string): string {
  return `${formatTime(start)} – ${formatTime(end)}`
}

// ── Duration ──────────────────────────────────────────────────────────────────

/**
 * Human-readable duration between two dates.
 * Output: "3 hours" | "2 hours 30 minutes" | "45 minutes"
 */
export function formatDuration(start: Date | string, end: Date | string): string {
  const startMs = toDate(start).getTime()
  const endMs   = toDate(end).getTime()
  const diffMinutes = Math.round((endMs - startMs) / 60_000)
  const hours   = Math.floor(diffMinutes / 60)
  const minutes = diffMinutes % 60

  if (hours === 0)   return `${minutes} minute${minutes !== 1 ? 's' : ''}`
  if (minutes === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`
  return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`
}

// ── Relative labels ───────────────────────────────────────────────────────────

/**
 * Short relative label for an event date.
 * Returns "Today", "Tomorrow", "In X days", "X days ago", or falls back
 * to formatDateCard for dates more than 7 days out/past.
 */
export function formatRelative(date: Date | string): string {
  const d = toDate(date)
  const now = new Date()
  // Compare calendar days in London timezone
  const diffMs   = d.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / 86_400_000)

  if (diffDays === 0)  return 'Today'
  if (diffDays === 1)  return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays > 1 && diffDays <= 7)  return `In ${diffDays} days`
  if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`
  return formatDateCard(d)
}

// ── Predicates ────────────────────────────────────────────────────────────────

/** True if the event date is in the past. */
export function isPastEvent(date: Date | string): boolean {
  return toDate(date).getTime() < Date.now()
}

/**
 * True if the event starts within the next 48 hours.
 * Used to show the "tomorrow" reminder highlight (Amendment 5.3).
 */
export function isWithin48Hours(date: Date | string): boolean {
  const diffMs = toDate(date).getTime() - Date.now()
  return diffMs > 0 && diffMs <= 48 * 60 * 60 * 1_000
}

/**
 * Convert a datetime-local input value (YYYY-MM-DDTHH:mm with no TZ) to a
 * UTC ISO string, treating the input as Europe/London wall-clock time.
 *
 * The platform is for London professionals; admin events are scheduled in
 * London time. This is the inverse of the `toDatetimeLocal()` helper inside
 * EventForm.tsx (which goes UTC → London for the input's defaultValue).
 *
 * Algorithm: build a "pretend UTC" instant from the wall-clock components,
 * then ask Intl.DateTimeFormat what that instant looks like in Europe/London.
 * The gap between the two IS the London offset at that wall-clock moment
 * (1h during BST, 0 during GMT). Subtract that offset from pretend-UTC to
 * get the true UTC instant the admin meant.
 *
 * Strings that already carry a timezone marker (Z or ±HH:mm) pass through
 * unchanged — we never override an explicit timezone.
 *
 * Pre-fix the conversion at parseEventFormData in admin/actions.ts naively
 * appended `Z` to a local datetime string, treating London wall-clock as
 * UTC. Off by 1h during BST; admins entered 7pm and the public event page
 * displayed 8pm. This helper lives here (rather than alongside the Server
 * Action) so it's directly unit-testable — files with `'use server'`
 * can only export async Server Actions.
 */
export function normaliseLondonDatetimeToUtc(value: string): string {
  if (!value) return ''
  // Already has explicit timezone — pass through.
  if (value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)) return value

  // Parse YYYY-MM-DDTHH:mm (seconds optional)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value)
  if (!match) return ''
  const [, y, mo, d, hh, mm, ss] = match

  // Step 1: pretend the components ARE UTC. Compute that instant.
  const pretendUtcMs = Date.UTC(
    +y,
    +mo - 1,
    +d,
    +hh,
    +mm,
    ss ? +ss : 0,
  )

  // Step 2: render that instant in Europe/London. Read the rendered
  // wall-clock components back via formatToParts.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(pretendUtcMs))
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0')
  // Intl.DateTimeFormat sometimes emits hour=24 at midnight; normalise to 0.
  const renderedHour = get('hour') === 24 ? 0 : get('hour')
  const renderedMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    renderedHour,
    get('minute'),
    get('second'),
  )

  // Step 3: gap between rendered and pretend = London offset at this
  // wall-clock moment (positive in BST, zero in GMT).
  const londonOffsetMs = renderedMs - pretendUtcMs

  // Step 4: subtract offset from pretend-UTC to get TRUE UTC.
  const trueUtcMs = pretendUtcMs - londonOffsetMs
  return new Date(trueUtcMs).toISOString()
}
