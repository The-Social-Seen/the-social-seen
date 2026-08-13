'use server'

import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { uniqueSlug } from '@/lib/utils/slugify'
import { normaliseLondonDatetimeToUtc, formatDateFull, formatTime } from '@/lib/utils/dates'
import { sendEmail } from '@/lib/email/send'
import { adminAnnouncementTemplate } from '@/lib/email/templates/admin-announcement'
import {
  eventCancelledTemplate,
  type EventCancelledVariant,
} from '@/lib/email/templates/event-cancelled'
import { isRedacted } from '@/lib/notifications/redaction'
import { getStripeClient } from '@/lib/stripe/server'
import {
  createAdminBookingHold,
  createAdminPaymentRemediationHold,
  createAdminReinstatementHold,
  releaseAdminBookingHold,
  releaseReinstatedBookingHold,
} from '@/lib/bookings/admin-hold'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import { PRIMARY_ELIGIBLE_TAG_SLUGS } from '@/lib/constants/tags'
import {
  PRIMARY_TAG_EMBED,
  attachPrimaryTag,
  type RowWithPrimaryTagEmbed,
} from '@/lib/supabase/queries/events'
import type {
  AdminEventBooking,
  EventWithStats,
  Gender,
  MemberWithStats,
  NotificationRecipient,
  NotificationType,
  UserStatus,
} from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Prevents CSV formula injection by prefixing dangerous leading characters
 * with a single-quote so spreadsheet applications treat the cell as text.
 */
function sanitizeCsvCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`
  return value
}

/**
 * Escapes PostgreSQL ILIKE wildcards in user-supplied search strings so that
 * literal % and _ characters are matched verbatim rather than as wildcards.
 */
function escapeIlike(value: string): string {
  return value.replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/**
 * Supabase join results can be object, array-of-one, or null depending on
 * the FK relationship. This normalises to a single object or null.
 */
function extractJoin<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null
  return (value as T) ?? null
}

function extractField<T extends Record<string, unknown>>(
  value: unknown,
  field: keyof T
): T[keyof T] | null {
  const obj = extractJoin<T>(value)
  return obj ? obj[field] : null
}

/**
 * Batch-fetches member phone numbers (admin-only PII) via the
 * `admin_get_user_phones()` SECURITY DEFINER RPC and returns a
 * Map<user_id, phone>.
 *
 * Phone was revoked from the `authenticated` SELECT GRANT on
 * `public.profiles` (20260503000002), so it can NOT be read through a
 * `.select()` — the RPC's in-body admin gate is the authorisation boundary.
 * Callers pass the user-scoped client from `requireAdmin()` (the RPC carries
 * its own gate; no service-role needed) and merge the result by id with a
 * `?? null` fallback — never assume every input id yields a row (soft-deleted
 * or phone-less members are absent / null). Exactly ONE RPC round-trip; ids
 * are de-duped first.
 */
async function fetchPhoneMap(
  supabase: Awaited<ReturnType<typeof requireAdmin>>['supabase'],
  userIds: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (userIds.length === 0) return map

  const unique = [...new Set(userIds)]
  const { data, error } = await supabase.rpc('admin_get_user_phones', {
    target_user_ids: unique,
  })

  if (error) {
    throw new Error(`Failed to fetch member phone numbers: ${error.message}`)
  }

  for (const row of (data ?? []) as Array<{ user_id: string; phone_number: string | null }>) {
    map.set(row.user_id, row.phone_number ?? null)
  }

  return map
}

/**
 * Batch-fetches member gender (admin-only PII) via the
 * `admin_get_user_demographics()` SECURITY DEFINER RPC and returns a
 * Map<user_id, gender>.
 *
 * `gender` was excluded from the `authenticated` SELECT GRANT on
 * `public.profiles` from the moment the column was introduced
 * (20260503000001), so it can NOT be read through a `.select()` — the RPC's
 * in-body admin gate is the authorisation boundary. Callers pass the
 * user-scoped client from `requireAdmin()` (the RPC carries its own gate; no
 * service-role needed) and merge the result by id with a `?? null` fallback
 * — never assume every input id yields a row (soft-deleted or
 * gender-unset members are absent / null). Exactly ONE RPC round-trip; ids
 * are de-duped first.
 *
 * The RPC also returns `age_range`, which is deliberately NOT surfaced here
 * — no consumer needs it yet (docs/SYSTEM-DESIGN-admin-gender-batch-rpc.md
 * §1.2). Extending this map to a richer value type is a same-shape follow-up.
 */
async function fetchDemographicsMap(
  supabase: Awaited<ReturnType<typeof requireAdmin>>['supabase'],
  userIds: string[]
): Promise<Map<string, Gender | null>> {
  const map = new Map<string, Gender | null>()
  if (userIds.length === 0) return map

  const unique = [...new Set(userIds)]
  const { data, error } = await supabase.rpc('admin_get_user_demographics', {
    target_user_ids: unique,
  })

  if (error) {
    throw new Error(`Failed to fetch member demographics: ${error.message}`)
  }

  for (const row of (data ?? []) as Array<{
    user_id: string
    gender: Gender | null
    age_range: string | null
  }>) {
    map.set(row.user_id, row.gender ?? null)
  }

  return map
}

async function requireAdmin() {
  const supabase = await createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new Error('Authentication required')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') throw new Error('Admin access required')

  return { supabase, userId: user.id }
}

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const eventFormSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  short_description: z.string().min(10).max(300),
  date_time: z.string().datetime({ message: 'Valid ISO datetime required' }),
  end_time: z.string().datetime({ message: 'Valid ISO datetime required' }),
  venue_name: z.string().min(2, 'Venue name must be at least 2 characters'),
  venue_address: z.string().min(5, 'Venue address must be at least 5 characters'),
  postcode: z
    .string()
    .max(16, 'Postcode too long')
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  venue_revealed: z.boolean(),
  // The form submits a primary tag slug. The slug is validated against
  // PRIMARY_ELIGIBLE_TAG_SLUGS and persisted via the event_tags primary
  // row (saveEventTags below). Post-F1b-schema there's no legacy
  // `events.category` column to keep in sync — event_tags is the sole
  // source of truth for primary categorisation.
  primary_tag_slug: z
    .string()
    .min(1, 'Pick a primary tag — this is the main category for the event.')
    .refine((slug) => PRIMARY_ELIGIBLE_TAG_SLUGS.has(slug), {
      message: 'Pick a primary tag from the allowed list.',
    }),
  price: z.number().min(0, 'Price cannot be negative'),
  capacity: z.number().int().positive().nullable(),
  // Off-platform partnership headcount. Additive to public "going" display
  // only — does NOT consume capacity. Defaults to 0 when missing from payload.
  external_attendees: z
    .number()
    .int('External attendees must be a whole number')
    .nonnegative('External attendees cannot be negative')
    .default(0),
  image_url: z.string().url().nullable().or(z.literal('')).transform(v => v || null),
  dress_code: z.string().nullable().transform(v => v || null),
  refund_window_hours: z
    .number()
    .int('Refund window must be a whole number')
    .min(0, 'Refund window cannot be negative'),
  is_published: z.boolean(),
}).refine(
  (data) => new Date(data.end_time) > new Date(data.date_time),
  { message: 'End time must be after start time', path: ['end_time'] }
)

const notificationSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(200),
  body: z.string().min(1, 'Body is required'),
  recipient_type: z.enum(['all', 'event_attendees', 'waitlisted', 'custom'] as const),
  type: z.enum(['reminder', 'announcement', 'waitlist', 'event_update'] as const),
  recipient_event_id: z.string().uuid().nullable().optional(),
})

// ── Form data → typed object helper ──────────────────────────────────────────

function parseEventFormData(formData: FormData) {
  const priceInPounds = parseFloat(formData.get('price') as string) || 0
  const priceInPence = Math.round(priceInPounds * 100)

  const capacityRaw = formData.get('capacity') as string
  const capacity = capacityRaw && capacityRaw.trim() !== ''
    ? parseInt(capacityRaw, 10)
    : null

  // External attendees defaults to 0 when missing/empty so existing form
  // payloads without the field continue to round-trip cleanly. Don't clamp
  // negatives here — Zod (.nonnegative()) is the validation layer; clamping
  // would silently swallow user-visible errors and confuse the admin.
  const externalRaw = formData.get('external_attendees') as string
  const externalAttendees = externalRaw && externalRaw.trim() !== ''
    ? parseInt(externalRaw, 10)
    : 0

  // Refund policy: 'none' → 0, 'standard' → 48, 'custom' → user input.
  // The form falls back to 'standard' when the field is missing (older
  // form payloads, programmatic submissions) so existing behaviour is
  // preserved.
  const refundPolicy = (formData.get('refund_policy') as string) || 'standard'
  let refundWindowHours = 48
  if (refundPolicy === 'none') {
    refundWindowHours = 0
  } else if (refundPolicy === 'custom') {
    const customRaw = formData.get('refund_window_custom_hours') as string
    const parsed = parseInt(customRaw, 10)
    refundWindowHours = Number.isFinite(parsed) && parsed > 0 ? parsed : 48
  }

  return {
    title: (formData.get('title') as string) ?? '',
    description: (formData.get('description') as string) ?? '',
    short_description: (formData.get('short_description') as string) ?? '',
    date_time: normaliseLondonDatetimeToUtc((formData.get('date_time') as string) ?? ''),
    end_time: normaliseLondonDatetimeToUtc((formData.get('end_time') as string) ?? ''),
    venue_name: (formData.get('venue_name') as string) ?? '',
    venue_address: (formData.get('venue_address') as string) ?? '',
    postcode: (formData.get('postcode') as string) || null,
    // Form checkbox is "Hide venue until 1 week before". Invert for DB.
    venue_revealed: formData.get('venue_hidden') !== 'true',
    primary_tag_slug: (formData.get('primary_tag_slug') as string) ?? '',
    price: priceInPence,
    capacity,
    external_attendees: externalAttendees,
    image_url: (formData.get('image_url') as string) || null,
    dress_code: (formData.get('dress_code') as string) || null,
    refund_window_hours: refundWindowHours,
    is_published: formData.get('is_published') === 'true',
  }
}

// ── Dashboard Aggregations ───────────────────────────────────────────────────

export async function getDashboardStats() {
  const { supabase } = await requireAdmin()

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

  const [membersRes, eventsRes, revenueRes, ratingRes] = await Promise.all([
    // Total active members
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null),

    // Upcoming published events
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('is_published', true)
      .is('deleted_at', null)
      .gt('date_time', now.toISOString()),

    // Revenue this month: sum price_at_booking for confirmed bookings
    // created this calendar month (i.e. money actually collected this month,
    // regardless of when the event takes place).
    supabase
      .from('bookings')
      .select('price_at_booking')
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .gte('created_at', startOfMonth)
      .lte('created_at', endOfMonth),

    // Average rating across all visible reviews
    supabase
      .from('event_reviews')
      .select('rating')
      .eq('is_visible', true),
  ])

  const totalMembers = membersRes.count ?? 0
  const upcomingEvents = eventsRes.count ?? 0

  const revenueThisMonth = (revenueRes.data ?? []).reduce(
    (sum, b) => sum + (b.price_at_booking ?? 0), 0
  )

  const ratings = ratingRes.data ?? []
  const averageRating = ratings.length > 0
    ? parseFloat((ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length).toFixed(2))
    : 0

  return { totalMembers, upcomingEvents, revenueThisMonth, averageRating }
}

export async function getMonthlyBookings() {
  const { supabase } = await requireAdmin()

  // Group by event date so upcoming bookings appear in their event's month,
  // not the month the booking was made. Include 2 future months so admins
  // can see attendance booked for upcoming events.
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

  const twoMonthsAhead = new Date()
  twoMonthsAhead.setMonth(twoMonthsAhead.getMonth() + 3)
  twoMonthsAhead.setDate(1)

  const { data: bookings } = await supabase
    .from('bookings')
    .select('event:events!inner(date_time)')
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .gte('events.date_time', twelveMonthsAgo.toISOString())
    .lte('events.date_time', twoMonthsAhead.toISOString())

  // Pre-fill last 12 months + next 2 months with zeros
  const monthCounts = new Map<string, number>()
  for (let i = 11; i >= -2; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const key = d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short' })
    monthCounts.set(key, 0)
  }

  for (const b of bookings ?? []) {
    const eventDate = extractField<{ date_time: string }>(b.event, 'date_time')
    if (!eventDate) continue
    const key = new Date(eventDate).toLocaleDateString('en-GB', { year: 'numeric', month: 'short' })
    if (monthCounts.has(key)) {
      monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1)
    }
  }

  return Array.from(monthCounts.entries()).map(([month, count]) => ({ month, count }))
}

export async function getRecentActivity() {
  const { supabase } = await requireAdmin()

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, status, created_at,
      profile:profiles!bookings_user_id_fkey(full_name),
      event:events!bookings_event_id_fkey(title)
    `)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) throw new Error(`Failed to fetch recent activity: ${error.message}`)

  return (data ?? []).map((b) => ({
    id: b.id,
    status: b.status,
    created_at: b.created_at,
    user_name: extractField<{ full_name: string }>(b.profile, 'full_name') ?? 'Unknown',
    event_title: extractField<{ title: string }>(b.event, 'title') ?? 'Unknown',
  }))
}

// ── Event CRUD ───────────────────────────────────────────────────────────────

export async function createEvent(formData: FormData, hosts?: HostInput[]) {
  const { supabase, userId } = await requireAdmin()

  const raw = parseEventFormData(formData)
  const parsed = eventFormSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Validation failed' }
  }

  const data = parsed.data

  // Validate hosts input BEFORE creating the event so a bad role_label
  // doesn't leave us with an event whose host insert silently failed.
  // The helper returns rows without event_id; we tack it on after the
  // events insert returns the real id.
  let validatedHostRows:
    | Array<{
        profile_id: string
        role_label: string
        sort_order: number
      }>
    | null = null
  if (hosts && hosts.length > 0) {
    const prepared = prepareHostRows(hosts)
    if ('error' in prepared) return { error: prepared.error }
    validatedHostRows = prepared.rows
  }

  // Generate unique slug
  const slug = await uniqueSlug(data.title, async (s) => {
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('slug', s)
      .maybeSingle()
    return !!existing
  })

  const { data: event, error } = await supabase
    .from('events')
    .insert({
      slug,
      title: data.title,
      description: data.description,
      short_description: data.short_description,
      date_time: data.date_time,
      end_time: data.end_time,
      venue_name: data.venue_name,
      venue_address: data.venue_address,
      postcode: data.postcode,
      venue_revealed: data.venue_revealed,
      price: data.price,
      capacity: data.capacity,
      external_attendees: data.external_attendees,
      image_url: data.image_url,
      dress_code: data.dress_code,
      refund_window_hours: data.refund_window_hours,
      is_published: data.is_published,
    })
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  // If hosts were submitted, use them with their per-host role_labels.
  // Otherwise fall back to the historical "creator becomes the sole Host"
  // behaviour so events without an explicit hosts payload aren't hostless.
  if (validatedHostRows) {
    const rowsWithEventId = validatedHostRows.map((row) => ({
      ...row,
      event_id: event.id,
    }))
    await supabase.from('event_hosts').insert(rowsWithEventId)
  } else {
    await supabase.from('event_hosts').insert({
      event_id: event.id,
      profile_id: userId,
      role_label: 'Host',
      sort_order: 0,
    })
  }

  revalidatePath('/admin/events')
  revalidatePath('/events')

  return { event }
}

export async function updateEvent(eventId: string, formData: FormData) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  const raw = parseEventFormData(formData)
  const parsed = eventFormSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Validation failed' }
  }

  const data = parsed.data

  // Get current slug to check if title changed
  const { data: currentEvent } = await supabase
    .from('events')
    .select('slug, title')
    .eq('id', eventId)
    .single()

  if (!currentEvent) return { error: 'Event not found' }

  // Re-generate slug only if title changed
  let slug = currentEvent.slug
  if (data.title !== currentEvent.title) {
    slug = await uniqueSlug(data.title, async (s) => {
      const { data: existing } = await supabase
        .from('events')
        .select('id')
        .eq('slug', s)
        .neq('id', eventId)
        .maybeSingle()
      return !!existing
    })
  }

  const { data: event, error } = await supabase
    .from('events')
    .update({
      slug,
      title: data.title,
      description: data.description,
      short_description: data.short_description,
      date_time: data.date_time,
      end_time: data.end_time,
      venue_name: data.venue_name,
      venue_address: data.venue_address,
      postcode: data.postcode,
      venue_revealed: data.venue_revealed,
      price: data.price,
      capacity: data.capacity,
      external_attendees: data.external_attendees,
      image_url: data.image_url,
      dress_code: data.dress_code,
      refund_window_hours: data.refund_window_hours,
      is_published: data.is_published,
    })
    .eq('id', eventId)
    .select()
    .single()

  if (error) return { error: error.message }

  revalidatePath('/admin/events')
  revalidatePath('/events')
  revalidatePath(`/events/${slug}`)

  return { event }
}

/**
 * Duplicate an event as a new draft.
 *
 * Copies: all event columns (except date — shifted +7 days so the
 * duplicate doesn't collide with the original) + inclusions + hosts.
 * Resets: is_published=false, is_cancelled=false, slug regenerated,
 * title prefixed with "Copy of ". Bookings, reviews, and photos are
 * NOT copied (they're scoped to the original event).
 *
 * Returns the new event id so the caller can redirect to its edit page.
 */
export async function duplicateEvent(
  eventId: string,
): Promise<{ event: { id: string; slug: string } } | { error: string }> {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  const { data: source, error: fetchErr } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .is('deleted_at', null)
    .single()
  if (fetchErr || !source) return { error: 'Event not found' }

  const newTitle = `Copy of ${source.title}`
  const newSlug = await uniqueSlug(newTitle, async (s) => {
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('slug', s)
      .maybeSingle()
    return !!existing
  })

  const shiftDays = 7
  const shiftMs = shiftDays * 24 * 60 * 60 * 1000
  const newDateTime = new Date(
    new Date(source.date_time).getTime() + shiftMs,
  ).toISOString()
  const newEndTime = new Date(
    new Date(source.end_time).getTime() + shiftMs,
  ).toISOString()

  const { data: inserted, error: insertErr } = await supabase
    .from('events')
    .insert({
      slug: newSlug,
      title: newTitle,
      description: source.description,
      short_description: source.short_description,
      date_time: newDateTime,
      end_time: newEndTime,
      venue_name: source.venue_name,
      venue_address: source.venue_address,
      postcode: source.postcode,
      venue_revealed: source.venue_revealed ?? true,
      price: source.price,
      capacity: source.capacity,
      external_attendees: source.external_attendees,
      image_url: source.image_url,
      dress_code: source.dress_code,
      refund_window_hours: source.refund_window_hours,
      is_published: false,
      is_cancelled: false,
    })
    .select('id, slug')
    .single()

  if (insertErr || !inserted) {
    return { error: insertErr?.message ?? 'Failed to duplicate event' }
  }

  // Copy inclusions (same labels/icons, preserved order).
  const { data: inclusions } = await supabase
    .from('event_inclusions')
    .select('label, icon, sort_order')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true })

  if (inclusions && inclusions.length > 0) {
    await supabase.from('event_inclusions').insert(
      inclusions.map((i) => ({
        event_id: inserted.id,
        label: i.label,
        icon: i.icon,
        sort_order: i.sort_order,
      })),
    )
  }

  // Copy hosts (same roster).
  const { data: hosts } = await supabase
    .from('event_hosts')
    .select('profile_id, role_label, sort_order')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true })

  if (hosts && hosts.length > 0) {
    await supabase.from('event_hosts').insert(
      hosts.map((h) => ({
        event_id: inserted.id,
        profile_id: h.profile_id,
        role_label: h.role_label,
        sort_order: h.sort_order,
      })),
    )
  }

  // Copy event_tags (primary + secondaries). Without this, the duplicate
  // would have no `event_tags` rows at all — violating the Phase 3
  // "exactly one primary per event" application invariant (and leaving
  // the new event with no chip on the event card).
  const { data: sourceTags } = await supabase
    .from('event_tags')
    .select('tag_id, is_primary')
    .eq('event_id', eventId)

  if (sourceTags && sourceTags.length > 0) {
    await supabase.from('event_tags').insert(
      sourceTags.map((t) => ({
        event_id: inserted.id,
        tag_id: t.tag_id,
        is_primary: t.is_primary,
      })),
    )
  }

  revalidatePath('/admin/events')

  return { event: inserted }
}

// ── Event tags (Phase 3 W5) ──────────────────────────────────────────────────

// Canonical UUID format check — matches 8-4-4-4-12 hex without enforcing
// RFC 4122 version digits, so the test/seed UUIDs (e.g.
// `e1000000-0000-0000-0000-000000000001`) which have version field '0'
// pass. The events table FK constraint catches anything that's not a
// real row.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const eventTagsSchema = z.object({
  eventId: z.string().regex(UUID_RE, 'Invalid event ID'),
  primarySlug: z
    .string()
    .min(1, 'Pick a primary tag — this is the main category for the event.')
    .refine((slug) => PRIMARY_ELIGIBLE_TAG_SLUGS.has(slug), {
      message: 'Pick a primary tag from the allowed list.',
    }),
  // Secondary slugs are zero or more. Empty array is fine — many events
  // have no secondaries.
  secondarySlugs: z.array(z.string().min(1)),
})

/**
 * Replace the full set of event_tags for an event.
 *
 * Strategy: DELETE all event_tags rows for this event, then INSERT primary
 * + secondaries fresh. Simpler than a per-row diff. Post-F1b-schema there
 * is no legacy `events.category` column to keep in sync — `event_tags`
 * with `is_primary = true` is the sole source of truth for primary
 * categorisation.
 *
 * Defence in depth — collision guards:
 *   1. Slug must be in `PRIMARY_ELIGIBLE_TAG_SLUGS` (zod refinement).
 *   2. Primary slug must NOT appear in the secondaries array (the picker UI
 *      already enforces this; this server-side check rejects malicious or
 *      malformed payloads).
 *   3. Each secondary slug must exist in the `tags` table (we resolve them
 *      in a single batched lookup; missing slugs short-circuit the action).
 *   4. Caller must be an admin (requireAdmin throws otherwise).
 */
export async function saveEventTags(
  eventId: string,
  primarySlug: string,
  secondarySlugs: string[],
): Promise<{ success: boolean; error?: string }> {
  const { supabase } = await requireAdmin()

  const parsed = eventTagsSchema.safeParse({
    eventId,
    primarySlug,
    secondarySlugs,
  })
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid tag payload',
    }
  }

  // Collision guard — defence in depth. The picker UI prevents this client-
  // side, but the Server Action MUST also enforce it: if the same tag ends
  // up as both primary and secondary, the bidirectional trigger's Side A
  // would later fail with `uq_event_tags_event_tag` unique violation when
  // an admin re-saved the event, surfacing as a confusing 500.
  if (parsed.data.secondarySlugs.includes(parsed.data.primarySlug)) {
    return {
      success: false,
      error:
        'A tag can&rsquo;t be both primary and secondary on the same event. Pick one.',
    }
  }

  // De-duplicate secondaries (UI shouldn't send dupes, but a malformed
  // payload could).
  const dedupedSecondaries = Array.from(new Set(parsed.data.secondarySlugs))

  // Batch-resolve all required slugs to UUIDs in one query.
  const allSlugs = [parsed.data.primarySlug, ...dedupedSecondaries]
  const { data: tagRows, error: tagsError } = await supabase
    .from('tags')
    .select('id, slug')
    .in('slug', allSlugs)

  if (
    tagsError ||
    !tagRows ||
    tagRows.length !== new Set(allSlugs).size
  ) {
    console.error(
      '[saveEventTags:tags]',
      tagsError?.message ??
        `expected ${new Set(allSlugs).size} tag rows, got ${tagRows?.length ?? 0}`,
    )
    return { success: false, error: 'Failed to resolve tags' }
  }
  const slugToId = new Map(tagRows.map((t) => [t.slug, t.id]))
  const primaryId = slugToId.get(parsed.data.primarySlug)!

  // Replace strategy — DELETE all then INSERT primary + secondaries.
  const { error: deleteError } = await supabase
    .from('event_tags')
    .delete()
    .eq('event_id', parsed.data.eventId)

  if (deleteError) {
    console.error('[saveEventTags:delete]', deleteError.message)
    return { success: false, error: 'Failed to clear existing tags' }
  }

  const rows = [
    { event_id: parsed.data.eventId, tag_id: primaryId, is_primary: true },
    ...dedupedSecondaries.map((slug) => ({
      event_id: parsed.data.eventId,
      tag_id: slugToId.get(slug)!,
      is_primary: false,
    })),
  ]

  const { error: insertError } = await supabase
    .from('event_tags')
    .insert(rows)

  if (insertError) {
    console.error('[saveEventTags:insert]', insertError.message)
    return { success: false, error: 'Failed to save tags' }
  }

  revalidatePath('/admin/events')
  revalidatePath(`/admin/events/${parsed.data.eventId}`)
  revalidatePath('/events')

  return { success: true }
}

export async function softDeleteEvent(eventId: string) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  // Check for confirmed bookings
  const { count } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'confirmed')
    .is('deleted_at', null)

  if (count && count > 0) {
    return {
      error: `Cannot delete: ${count} confirmed booking${count > 1 ? 's' : ''} exist. Cancel the event instead.`,
    }
  }

  const { error } = await supabase
    .from('events')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', eventId)

  if (error) return { error: error.message }

  revalidatePath('/admin/events')
  revalidatePath('/events')

  return { success: true }
}

export async function toggleEventPublished(eventId: string) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  const { data: current } = await supabase
    .from('events')
    .select('is_published, slug')
    .eq('id', eventId)
    .single()

  if (!current) return { error: 'Event not found' }

  const { error } = await supabase
    .from('events')
    .update({ is_published: !current.is_published })
    .eq('id', eventId)

  if (error) return { error: error.message }

  revalidatePath('/admin/events')
  revalidatePath('/events')
  revalidatePath(`/events/${current.slug}`)

  return { success: true, is_published: !current.is_published }
}

export async function cancelEvent(eventId: string) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  const { data: current } = await supabase
    .from('events')
    .select('slug')
    .eq('id', eventId)
    .single()

  if (!current) return { error: 'Event not found' }

  const { error } = await supabase
    .from('events')
    .update({ is_cancelled: true })
    .eq('id', eventId)

  if (error) return { error: error.message }

  revalidatePath('/admin/events')
  revalidatePath('/events')
  revalidatePath(`/events/${current.slug}`)

  return { success: true }
}

// ── getEventCancelPreview ────────────────────────────────────────────────────

/**
 * Counts shown in the admin "Cancel & Refund" confirm modal.
 *
 * Read-only preview helper — does NOT mutate. Lets the UI pick the right
 * copy variant (paid / free / waitlist-only / zero) and show the exact
 * total refund amount before the admin commits.
 *
 * `totalRefundPence` is `SUM(price_at_booking + booking_fee_pence)`
 * across confirmed bookings — the same formula the real cancel action
 * uses (spec §8.8). Computed in this helper rather than the client so
 * the admin sees the truth from the database, not the eventually-stale
 * EventWithStats aggregate.
 */
export interface EventCancelPreview {
  confirmedPaid: number
  confirmedFree: number
  waitlisted: number
  totalRefundPence: number
}

export async function getEventCancelPreview(
  eventId: string,
): Promise<EventCancelPreview> {
  await requireAdmin()

  if (!eventId) throw new Error('Event ID is required')

  // Use the admin client so the count works regardless of the per-row
  // RLS gating — same pattern as cancelEventAndRefundBookings's loop.
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('bookings')
    .select('status, price_at_booking, booking_fee_pence')
    .eq('event_id', eventId)
    .in('status', ['confirmed', 'waitlisted'])
    .is('deleted_at', null)

  if (error) {
    throw new Error(`Failed to fetch booking preview: ${error.message}`)
  }

  const preview: EventCancelPreview = {
    confirmedPaid: 0,
    confirmedFree: 0,
    waitlisted: 0,
    totalRefundPence: 0,
  }

  for (const row of data ?? []) {
    if (row.status === 'waitlisted') {
      preview.waitlisted += 1
      continue
    }
    // confirmed
    const price = row.price_at_booking ?? 0
    const fee = row.booking_fee_pence ?? 0
    if (price > 0) {
      preview.confirmedPaid += 1
      preview.totalRefundPence += price + fee
    } else {
      preview.confirmedFree += 1
    }
  }

  return preview
}

// ── cancelEventAndRefundBookings ─────────────────────────────────────────────

/**
 * One entry in the per-booking failure list returned to the admin UI.
 */
interface FailedRefund {
  bookingId: string
  userEmail: string
  error: string
}

export interface CancelEventResult {
  success: boolean
  error?: string
  summary?: {
    eventId: string
    eventTitle: string
    /** Count of all non-cancelled bookings touched. */
    totalBookings: number
    /** Successful Stripe refunds issued (paid bookings only). */
    refundedCount: number
    /** Sum of price_at_booking + booking_fee_pence across refunded bookings (pence). */
    refundedTotalPence: number
    /** Free-event bookings flipped to cancelled (no refund needed). */
    cancelledFreeCount: number
    /** Waitlisted bookings flipped to cancelled. */
    cancelledWaitlistCount: number
    /** pending_payment bookings flipped to cancelled. */
    cancelledPendingCount: number
    /** Bookings where the Stripe refund failed — admin must follow up manually. */
    failedRefunds: FailedRefund[]
    /** Cancellation emails dispatched (best-effort; may differ from totalBookings on email failures). */
    emailedCount: number
  }
}

/**
 * Cancel an event AND refund every confirmed booking. Admin-only.
 *
 * Refund amount per confirmed paid booking: price_at_booking +
 * booking_fee_pence (full — platform absorbs the Stripe processing fee
 * on admin-initiated cancellations, per locked decision 3 in
 * SYSTEM-DESIGN-refund-fee-deduction.md §0). User-initiated cancellation
 * keeps the fee (see cancelBooking in src/app/events/[slug]/actions.ts).
 *
 * Algorithm (spec §7.3):
 *   1. requireAdmin guard.
 *   2. Validate eventId + fetch event.
 *   3. Flip events.is_cancelled = true (idempotent guard so a re-run
 *      after a partial failure mid-loop is safe).
 *   4. Iterate confirmed / waitlisted / pending_payment bookings:
 *        - confirmed + paid: Stripe refund + UPDATE.
 *        - confirmed + free: UPDATE only.
 *        - waitlisted / pending_payment: UPDATE only (Stripe Checkout
 *          Session auto-expires within 30 min; if the user happens to
 *          complete payment in that window the webhook's
 *          .eq('status','pending_payment') guard no-ops and admin
 *          handles the orphan payment manually — flagged as a
 *          follow-up).
 *   5. Fire-and-forget the per-recipient cancellation email post-loop.
 *   6. Return per-booking outcomes so the admin UI can surface partial
 *      success (failedRefunds includes user email + Stripe error string
 *      so admin can manually refund from the Stripe dashboard).
 *
 * Uses the service-role admin client for the loop because we're
 * mutating rows that belong to many users — same pattern as the
 * webhook's `handleChargeRefunded`. RLS is bypassed but the
 * `requireAdmin()` gate at the entry enforces the admin check.
 */
export async function cancelEventAndRefundBookings(
  eventId: string,
  reason?: string,
): Promise<CancelEventResult> {
  await requireAdmin()

  if (!eventId) return { success: false, error: 'Event ID is required' }

  const admin = createAdminClient()

  // 1) Fetch the event.
  const { data: event, error: eventErr } = await admin
    .from('events')
    .select('id, slug, title, date_time, is_cancelled, deleted_at')
    .eq('id', eventId)
    .single()

  if (eventErr || !event) {
    return { success: false, error: 'Event not found' }
  }

  if (event.deleted_at) {
    return { success: false, error: 'Event has been deleted' }
  }

  // 2) Flip is_cancelled = true. Optimistic guard so a concurrent
  //    duplicate call doesn't double-flip — and the re-run case
  //    (resuming after a partial-failure mid-loop) is supported by
  //    falling through to the booking iteration even when the flag is
  //    already true.
  if (!event.is_cancelled) {
    const { error: flipErr } = await admin
      .from('events')
      .update({ is_cancelled: true })
      .eq('id', eventId)
      .eq('is_cancelled', false)

    if (flipErr) {
      return {
        success: false,
        error: `Failed to mark event cancelled: ${flipErr.message}`,
      }
    }
  }

  // 3) Fetch all non-cancelled, non-deleted bookings for this event,
  //    joined to the recipient profile so the cancellation email has
  //    a name/email to send to.
  const { data: bookings, error: bookingsErr } = await admin
    .from('bookings')
    .select(`
      id, user_id, status,
      price_at_booking, booking_fee_pence,
      stripe_payment_id, refunded_amount_pence,
      waitlist_position,
      profile:profiles!bookings_user_id_fkey(full_name, email)
    `)
    .eq('event_id', eventId)
    .in('status', ['confirmed', 'waitlisted', 'pending_payment'])
    .is('deleted_at', null)

  if (bookingsErr) {
    return {
      success: false,
      error: `Failed to fetch bookings: ${bookingsErr.message}`,
    }
  }

  const summary: NonNullable<CancelEventResult['summary']> = {
    eventId: event.id,
    eventTitle: event.title,
    totalBookings: bookings?.length ?? 0,
    refundedCount: 0,
    refundedTotalPence: 0,
    cancelledFreeCount: 0,
    cancelledWaitlistCount: 0,
    cancelledPendingCount: 0,
    failedRefunds: [],
    emailedCount: 0,
  }

  // Track the per-recipient email job. Variant + refund amount captured
  // here so the post-loop `after()` can fire them without re-querying.
  type EmailJob = {
    userId: string
    email: string
    fullName: string
    variant: EventCancelledVariant
    refundedAmountPence?: number
  }
  const emailJobs: EmailJob[] = []

  type BookingRow = {
    id: string
    user_id: string
    status: string
    price_at_booking: number
    booking_fee_pence: number | null
    stripe_payment_id: string | null
    refunded_amount_pence: number | null
    waitlist_position: number | null
    profile: unknown
  }

  for (const raw of (bookings ?? []) as BookingRow[]) {
    const profile = extractJoin<{ full_name: string | null; email: string | null }>(
      raw.profile,
    )
    const userEmail = profile?.email ?? ''
    const fullName = profile?.full_name ?? ''
    const cancellationReason = reason ?? 'admin_event_cancelled'
    const fee = raw.booking_fee_pence ?? 0

    // ── confirmed + paid → Stripe refund + UPDATE ──────────────────────
    if (
      raw.status === 'confirmed' &&
      raw.stripe_payment_id &&
      (raw.refunded_amount_pence ?? 0) === 0
    ) {
      const refundTotal = raw.price_at_booking + fee
      let refundId: string | null = null
      try {
        const stripe = getStripeClient()
        const refund = await stripe.refunds.create(
          {
            payment_intent: raw.stripe_payment_id,
            // Full amount — ticket + fee — because the cancellation is
            // ours, not the customer's. Locked decision 3.
            amount: refundTotal,
            reason: 'requested_by_customer',
            metadata: {
              booking_id: raw.id,
              user_id: raw.user_id,
              source: 'admin_event_cancelled',
            },
          },
          {
            // Per-booking key so a re-run (resume after partial failure)
            // returns the same refund object instead of double-charging.
            idempotencyKey: `event-cancel-refund-${raw.id}`,
          },
        )
        refundId = refund.id
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(
          '[cancelEventAndRefundBookings] Stripe refund failed:',
          raw.id,
          message,
        )
        Sentry.captureException(err, {
          tags: { surface: 'cancelEventAndRefundBookings' },
          extra: { bookingId: raw.id, eventId, userId: raw.user_id },
          level: 'error',
        })
        summary.failedRefunds.push({
          bookingId: raw.id,
          userEmail,
          error: message,
        })
        // Do NOT flip status to cancelled — leaving the booking in a
        // visibly-inconsistent state is better than silently cancelling
        // without refund. Admin can retry the Server Action; the Stripe
        // idempotency key will return the now-successful refund. No
        // email sent for this user yet (the loop will get them on retry).
        continue
      }

      const nowIso = new Date().toISOString()
      const { error: updErr } = await admin
        .from('bookings')
        .update({
          status: 'cancelled',
          cancelled_at: nowIso,
          cancellation_reason: cancellationReason,
          refunded_amount_pence: refundTotal,
          refunded_at: nowIso,
          stripe_refund_id: refundId,
        })
        .eq('id', raw.id)
        .eq('status', 'confirmed') // optimistic guard

      if (updErr) {
        // Refund went through but DB UPDATE failed — same severity as
        // the cancelBooking refund-reconcile path. Log + Sentry with a
        // filterable tag so the operator can find the orphan.
        console.error(
          '[cancelEventAndRefundBookings] Refund issued but UPDATE failed:',
          raw.id,
          refundId,
          updErr.message,
        )
        Sentry.captureException(
          new Error('Refund issued but booking UPDATE failed — manual reconciliation needed'),
          {
            tags: { surface: 'admin-refund-reconcile' },
            extra: {
              bookingId: raw.id,
              stripeRefundId: refundId,
              eventId,
            },
            level: 'error',
          },
        )
        summary.failedRefunds.push({
          bookingId: raw.id,
          userEmail,
          error: `Refund issued (${refundId}) but DB UPDATE failed: ${updErr.message}`,
        })
        continue
      }

      summary.refundedCount += 1
      summary.refundedTotalPence += refundTotal
      if (userEmail) {
        emailJobs.push({
          userId: raw.user_id,
          email: userEmail,
          fullName,
          variant: 'confirmed_refunded',
          refundedAmountPence: refundTotal,
        })
      }
      continue
    }

    // ── confirmed + free → UPDATE only ────────────────────────────────
    if (raw.status === 'confirmed' && !raw.stripe_payment_id) {
      const nowIso = new Date().toISOString()
      const { error: updErr } = await admin
        .from('bookings')
        .update({
          status: 'cancelled',
          cancelled_at: nowIso,
          cancellation_reason: cancellationReason,
        })
        .eq('id', raw.id)
        .eq('status', 'confirmed')

      if (updErr) {
        summary.failedRefunds.push({
          bookingId: raw.id,
          userEmail,
          error: `Free-event UPDATE failed: ${updErr.message}`,
        })
        continue
      }
      summary.cancelledFreeCount += 1
      if (userEmail) {
        emailJobs.push({
          userId: raw.user_id,
          email: userEmail,
          fullName,
          variant: 'confirmed_free',
        })
      }
      continue
    }

    // ── waitlisted → UPDATE only ───────────────────────────────────────
    if (raw.status === 'waitlisted') {
      const nowIso = new Date().toISOString()
      const { error: updErr } = await admin
        .from('bookings')
        .update({
          status: 'cancelled',
          cancelled_at: nowIso,
          cancellation_reason: cancellationReason,
          waitlist_position: null,
        })
        .eq('id', raw.id)
        .eq('status', 'waitlisted')

      if (updErr) {
        summary.failedRefunds.push({
          bookingId: raw.id,
          userEmail,
          error: `Waitlist UPDATE failed: ${updErr.message}`,
        })
        continue
      }
      summary.cancelledWaitlistCount += 1
      if (userEmail) {
        emailJobs.push({
          userId: raw.user_id,
          email: userEmail,
          fullName,
          variant: 'waitlisted',
        })
      }
      continue
    }

    // ── pending_payment → UPDATE only ─────────────────────────────────
    if (raw.status === 'pending_payment') {
      const nowIso = new Date().toISOString()
      const { error: updErr } = await admin
        .from('bookings')
        .update({
          status: 'cancelled',
          cancelled_at: nowIso,
          cancellation_reason: cancellationReason,
          // Unconditionally clear the admin-hold flag — required if this
          // pending_payment row happens to be an outstanding admin-
          // created hold (createAdminBookingHold), or the row would
          // violate chk_bookings_admin_hold_requires_pending_payment the
          // instant status leaves pending_payment. Harmless no-op
          // otherwise (already false/null). See
          // SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §5 site #4.
          is_admin_hold: false,
          admin_hold_expires_at: null,
        })
        .eq('id', raw.id)
        .eq('status', 'pending_payment')

      if (updErr) {
        summary.failedRefunds.push({
          bookingId: raw.id,
          userEmail,
          error: `Pending-payment UPDATE failed: ${updErr.message}`,
        })
        continue
      }
      summary.cancelledPendingCount += 1
      if (userEmail) {
        emailJobs.push({
          userId: raw.user_id,
          email: userEmail,
          fullName,
          variant: 'pending_payment',
        })
      }
      continue
    }
  }

  // 4) Fire-and-forget the per-recipient cancellation emails.
  //
  // Snapshot the date/time strings once — the loop captures them inside
  // `after()` so the closure outlives the request scope.
  const eventDate = formatDateFull(event.date_time)
  const eventTime = formatTime(event.date_time)
  const eventTitleSnap = event.title

  after(async () => {
    for (const job of emailJobs) {
      try {
        const tpl = eventCancelledTemplate({
          variant: job.variant,
          fullName: job.fullName?.trim() || 'there',
          eventTitle: eventTitleSnap,
          eventDate,
          eventTime,
          refundedAmountPence: job.refundedAmountPence,
        })

        const result = await sendEmail({
          to: job.email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
          templateName: 'event_cancelled',
          relatedProfileId: job.userId,
          tags: [
            { name: 'template', value: 'event_cancelled' },
            { name: 'variant', value: job.variant },
            { name: 'event_id', value: eventId },
          ],
        })

        if (result.success) summary.emailedCount += 1
      } catch (err) {
        console.warn(
          '[cancelEventAndRefundBookings] cancellation email threw:',
          err instanceof Error ? err.message : err,
        )
      }
    }
  })

  // The summary.emailedCount returned to the synchronous caller is 0 —
  // `after()` runs post-response so we can't await it here. Operators
  // reconcile counts via the `notifications` table audit. Surface this
  // expectation in the comment so a future reader doesn't expect the
  // returned count to be accurate.

  revalidatePath('/admin/events')
  revalidatePath('/events')
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')

  return { success: true, summary }
}

// ── Event CRUD Helpers ───────────────────────────────────────────────────────

export async function getAdminEvents(): Promise<EventWithStats[]> {
  const { supabase } = await requireAdmin()

  // Admin sees all events including drafts/cancelled. RLS on
  // `event_with_stats` lets admins read past published-only.
  //
  // The `event_tags!inner` embed + `attachPrimaryTag` are imported from
  // queries/events.ts so every reader of `event_with_stats` shares one
  // JOIN definition. Routing through `attachPrimaryTag` also means a
  // missing-embed mistake here surfaces as that helper's explicit
  // throw, not a silent `undefined` on `event.primary_tag`.
  const { data, error } = await supabase
    .from('event_with_stats')
    .select(`*, ${PRIMARY_TAG_EMBED}`)
    .eq('event_tags.is_primary', true)
    .order('date_time', { ascending: false })

  if (error) throw new Error(`Failed to fetch events: ${error.message}`)

  return (data ?? []).map((row) =>
    attachPrimaryTag(row as RowWithPrimaryTagEmbed),
  ) as unknown as EventWithStats[]
}

export async function getAdminEventById(eventId: string) {
  const { supabase } = await requireAdmin()

  if (!eventId) throw new Error('Event ID is required')

  const [eventRes, inclusionsRes, hostsRes] = await Promise.all([
    supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single(),

    supabase
      .from('event_inclusions')
      .select('id, label, icon, sort_order')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true }),

    supabase
      .from('event_hosts')
      .select(`
        id, role_label, sort_order,
        profile:profiles!event_hosts_profile_id_fkey(id, full_name, avatar_url, bio, job_title, company)
      `)
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true }),
  ])

  // Split predicate so RLS / connection failures (eventRes.error truthy) are
  // distinguishable from genuine not-found (data null, error null) in Sentry.
  // Follow-up from PR #101 reviewer note S-2 — the combined predicate above
  // would have made `${error.message}` ambiguous on the not-found path
  // (where `error` is null). See:
  // ~/.claude/projects/.../memory/project_admin_actions_error_messages.md
  if (eventRes.error) {
    throw new Error(`Failed to fetch event: ${eventRes.error.message}`)
  }
  if (!eventRes.data) throw new Error('Event not found')

  return {
    ...eventRes.data,
    inclusions: inclusionsRes.data ?? [],
    hosts: hostsRes.data ?? [],
  }
}

export async function upsertEventInclusions(
  eventId: string,
  inclusions: { label: string; icon?: string }[]
) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  // Delete existing inclusions for this event
  const { error: deleteError } = await supabase
    .from('event_inclusions')
    .delete()
    .eq('event_id', eventId)

  if (deleteError) return { error: deleteError.message }

  // Insert new ones
  if (inclusions.length > 0) {
    const rows = inclusions.map((inc, i) => ({
      event_id: eventId,
      label: inc.label,
      icon: inc.icon ?? null,
      sort_order: i,
    }))

    const { error: insertError } = await supabase
      .from('event_inclusions')
      .insert(rows)

    if (insertError) return { error: insertError.message }
  }

  revalidatePath('/admin/events')

  return { success: true }
}

/** Per-host input for upsertEventHosts and the optional hosts arg on createEvent. */
export interface HostInput {
  profileId: string
  roleLabel: string
}

const HOST_ROLE_LABEL_MAX = 60

/**
 * Validate + shape a hosts array into event_hosts rows ready for insert.
 *
 * Returns rows WITHOUT `event_id`; callers tack it on at insert time. This
 * keeps the helper agnostic about whether the event exists yet — useful for
 * `createEvent` (which doesn't have the id until the events insert returns).
 *
 * Rules:
 *   - profileId required (non-empty trimmed string)
 *   - roleLabel trimmed; empty / whitespace-only → falls back to 'Host'
 *     (matches the column default and pre-multi-host behaviour)
 *   - roleLabel post-trim length capped at HOST_ROLE_LABEL_MAX (60 chars)
 *   - sort_order = array index (callers pass hosts in display order)
 */
function prepareHostRows(
  hosts: HostInput[],
):
  | {
      rows: Array<{
        profile_id: string
        role_label: string
        sort_order: number
      }>
    }
  | { error: string } {
  const rows: Array<{
    profile_id: string
    role_label: string
    sort_order: number
  }> = []

  for (let i = 0; i < hosts.length; i++) {
    const { profileId, roleLabel } = hosts[i]
    const profile = (profileId ?? '').trim()
    if (!profile) {
      return { error: `Host #${i + 1} is missing a profile id` }
    }
    const trimmed = (roleLabel ?? '').trim()
    if (trimmed.length > HOST_ROLE_LABEL_MAX) {
      return {
        error: `Host role label must be ${HOST_ROLE_LABEL_MAX} characters or fewer`,
      }
    }
    rows.push({
      profile_id: profile,
      role_label: trimmed.length > 0 ? trimmed : 'Host',
      sort_order: i,
    })
  }

  return { rows }
}

export async function upsertEventHosts(eventId: string, hosts: HostInput[]) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  // Validate + shape BEFORE we delete the existing rows. If the new payload
  // is malformed we'd rather fail loud than leave the event hostless.
  const prepared = prepareHostRows(hosts)
  if ('error' in prepared) return { error: prepared.error }

  const { error: deleteError } = await supabase
    .from('event_hosts')
    .delete()
    .eq('event_id', eventId)

  if (deleteError) return { error: deleteError.message }

  if (prepared.rows.length > 0) {
    const rowsWithEventId = prepared.rows.map((row) => ({
      ...row,
      event_id: eventId,
    }))
    const { error: insertError } = await supabase
      .from('event_hosts')
      .insert(rowsWithEventId)

    if (insertError) return { error: insertError.message }
  }

  revalidatePath('/admin/events')

  return { success: true }
}

// ── Booking / Waitlist Management ────────────────────────────────────────────

export async function getEventBookings(
  eventId: string,
  statusFilter?: string
): Promise<AdminEventBooking[]> {
  const { supabase } = await requireAdmin()

  if (!eventId) throw new Error('Event ID is required')

  // NOTE: phone_number is deliberately NOT selected here (revoked from the
  // `authenticated` GRANT in 20260503000002). It is merged below via the
  // admin_get_user_phones() SECURITY DEFINER RPC. gender is likewise never
  // selected (excluded from the GRANT since 20260503000001) and is merged
  // below via the admin_get_user_demographics() SECURITY DEFINER RPC.
  //
  // Deliberately NOT filtering by status at the query level (even when
  // `statusFilter` is passed) — a person can have multiple rows for the
  // same event (e.g. cancelled a paid checkout, then rebooked and got
  // confirmed), each preserving its own Stripe/refund trail. Filtering by
  // status here, before collapsing to one row per attendee below, would
  // show the SAME PERSON under two different tabs (their stale cancelled
  // attempt under "Cancelled" and their current booking under
  // "Confirmed") — confusing, since only their most recent attempt
  // reflects where they actually stand. Fetch everything, collapse to one
  // row per attendee (latest `created_at` wins), THEN apply the status
  // filter to that collapsed list.
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, status, waitlist_position, price_at_booking, booking_fee_pence,
      stripe_fee_pence, booked_at, created_at,
      stripe_payment_id, stripe_refund_id, refunded_amount_pence, cancelled_at,
      cancellation_reason, is_admin_hold, admin_hold_expires_at,
      profile:profiles!bookings_user_id_fkey(id, full_name, email, avatar_url)
    `)
    .eq('event_id', eventId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to fetch bookings: ${error.message}`)

  const rows = (data ?? []) as Array<
    Omit<AdminEventBooking, 'profile'> & { profile: unknown }
  >

  // One batch RPC for every distinct attendee's phone — no N+1.
  const profileIds = rows
    .map((b) => extractField<{ id: string }>(b.profile, 'id'))
    .filter((id): id is string => typeof id === 'string')
  const phoneMap = await fetchPhoneMap(supabase, profileIds)
  const genderMap = await fetchDemographicsMap(supabase, profileIds)

  const merged = rows.map((b) => {
    const profile = extractJoin<{
      id: string
      full_name: string
      email: string
      avatar_url: string | null
    }>(b.profile)
    return {
      ...b,
      profile: profile
        ? {
            ...profile,
            phone_number: phoneMap.get(profile.id) ?? null,
            gender: genderMap.get(profile.id) ?? null,
          }
        : null,
    }
  })

  // Collapse to one row per attendee — their most recent booking attempt
  // for this event, which is the only one that reflects their current
  // standing. Earlier attempts (e.g. a cancelled checkout before a
  // successful rebook) still exist in the DB with their own Stripe/refund
  // trail intact — this only affects what the admin list displays, never
  // the underlying rows. Rows already come sorted `created_at` ascending
  // (the query above), so the LAST row seen per profile id is the latest
  // — a plain Map insertion-order overwrite gets this for free with no
  // extra sort. Rows with no resolvable profile (deleted/missing) are
  // never collapsed against each other — each keeps its own booking id
  // as a distinct key so it still displays.
  const latestPerAttendee = new Map<string, (typeof merged)[number]>()
  for (const b of merged) {
    latestPerAttendee.set(b.profile?.id ?? `__no-profile-${b.id}`, b)
  }
  const collapsed = Array.from(latestPerAttendee.values())

  if (statusFilter && statusFilter !== 'all') {
    return collapsed.filter((b) => b.status === statusFilter)
  }
  return collapsed
}

/**
 * Promote a waitlisted booking. Branches on the event's price
 * (SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §4.1):
 *
 *   - FREE event: confirmed directly. This is exactly the pre-existing
 *     behaviour, unchanged in shape — the only deliberate deviation is
 *     the capacity-check predicate (see comment below).
 *   - PAID event: held as `pending_payment` via createAdminBookingHold()
 *     (RPC transition + Stripe Checkout Session + payment-link email).
 *     NEVER confirmed directly with zero payment collection — that was
 *     the production incident this rewrite fixes (Amy Sangam / Yasemin
 *     Salp, 2026-07-13): the old code set status='confirmed' on ANY
 *     waitlisted booking regardless of event.price.
 *
 * `holdExpiresAt` is hardcoded to `null` for every paid promotion in
 * this pass (not `computeHoldExpiresAt(event.date_time)`) — the cron
 * that would act on a non-null deadline (`revert_expired_admin_holds`,
 * migration 20260713000003) doesn't exist yet. Setting a real deadline
 * now would create holds nothing ever reverts. See spec §8.1 step 6 /
 * §8.2 step 2 — flipping this to the computed deadline is a deliberate,
 * separate, one-line follow-up once the cron ships.
 */
export async function promoteFromWaitlist(bookingId: string) {
  const { supabase } = await requireAdmin()

  if (!bookingId) return { error: 'Booking ID is required' }

  // 1. Fetch the booking — must be waitlisted and active
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, event_id, user_id, status')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (bookingError || !booking) return { error: 'Booking not found' }
  if (booking.status !== 'waitlisted') return { error: 'Booking is not waitlisted' }

  // 2. Fetch the event. `price` added (vs the pre-existing 'id, slug,
  // capacity' select) so we can branch free vs paid below.
  const { data: event } = await supabase
    .from('events')
    .select('id, slug, capacity, price')
    .eq('id', booking.event_id)
    .single()

  if (!event) return { error: 'Event not found' }

  // ── Paid event: hold the seat + collect payment ─────────────────────────
  // Spec-faithful `!== 0` (paid) / implicit `=== 0` (free, fallthrough
  // below) — matches the SQL-side convention used throughout this RPC
  // family (book_event_paid, claim_waitlist_spot, and
  // admin_promote_waitlist_to_hold itself all branch on `price = 0`).
  // event.price is always a well-defined non-negative integer for any
  // real row (events.price has a `>= 0` CHECK constraint and is
  // NOT NULL) — this is never ambiguous in production.
  if (event.price !== 0) {
    const result = await createAdminBookingHold(supabase, bookingId, {
      holdExpiresAt: null,
    })

    if (!result.success) return { error: result.error }

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', booking.user_id)
      .single()

    revalidatePath('/admin/events')
    revalidatePath(`/events/${event.slug}`)
    revalidatePath('/bookings')

    return {
      success: true,
      promotedName: profile?.full_name ?? 'Member',
      status: 'pending_payment' as const,
      holdExpiresAt: result.holdExpiresAt ?? null,
    }
  }

  // ── Free event: confirm directly ─────────────────────────────────────────
  // Capacity check + status transition + waitlist recompute now all live
  // inside the admin_promote_waitlist_to_confirmed SECURITY DEFINER RPC
  // (one row-locked transaction) instead of a TS-side check-then-update,
  // closing the same direct-write forgery vector as the paid branch's
  // admin_promote_waitlist_to_hold RPC. See docs/SYSTEM-DESIGN-bookings-
  // write-authorization-hardening.md §3.4. Capacity predicate is
  // IN ('confirmed', 'pending_payment') inside the RPC, same as before.
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'admin_promote_waitlist_to_confirmed',
    { p_booking_id: bookingId },
  )
  if (rpcError) return { error: rpcError.message }

  const rpcResult = rpcData as { error?: string } | null
  if (rpcResult?.error) return { error: rpcResult.error }

  // Get promoted user's name for the success message
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', booking.user_id)
    .single()

  revalidatePath('/admin/events')
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')

  return {
    success: true,
    promotedName: profile?.full_name ?? 'Member',
  }
}

/**
 * Gap A remediation (SYSTEM-DESIGN-admin-waitlist-promotion-payment.md,
 * "Addendum (2026-07-13, same day)" §A.6): sends a real Stripe payment
 * link to a member whose booking is `status='confirmed'` on a PAID event
 * but was never actually charged (`stripe_payment_id IS NULL`) — the
 * exact bug `promoteFromWaitlist` above fixes going forward, except it
 * already happened to two production bookings (Amy Sangam, Yasemin Salp)
 * BEFORE that fix existed. `promoteFromWaitlist` / `admin_promote_
 * waitlist_to_hold` can't touch them — that RPC hard-rejects anything not
 * `status='waitlisted'`.
 *
 * Holds the booking as `pending_payment` via
 * `createAdminPaymentRemediationHold` (→ `admin_hold_confirmed_booking_
 * for_payment`, which deliberately skips the capacity check — Addendum
 * §A.1 — the booking already occupies its seat today as 'confirmed', so
 * this isn't a new admission) and emails a template that does NOT
 * mention the waitlist (they were never on it this cycle — Addendum
 * §A.5).
 *
 * Pre-validates status/stripe_payment_id/event.price in TS BEFORE ever
 * calling the RPC — belt-and-braces, matching this family's established
 * habit of the Server Action pre-checking what the RPC will re-validate
 * anyway under lock (see promoteFromWaitlist's own pre-fetch-and-branch
 * above, and admin_promote_waitlist_to_hold's independent re-validation
 * of everything promoteFromWaitlist already checked).
 *
 * `holdExpiresAt` hardcoded to `null` — same deferred-cron tradeoff as
 * promoteFromWaitlist above (the revert-cron that would act on a
 * non-null deadline, migration 20260713000003, still doesn't exist and
 * isn't being built now). See Addendum §A.3.
 */
export async function sendPaymentLinkForConfirmedBooking(bookingId: string) {
  const { supabase } = await requireAdmin()

  if (!bookingId) return { error: 'Booking ID is required' }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, event_id, user_id, status, stripe_payment_id')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (bookingError || !booking) return { error: 'Booking not found' }
  if (booking.status !== 'confirmed') {
    return { error: 'Only confirmed bookings can be sent a payment link' }
  }
  if (booking.stripe_payment_id) {
    return { error: 'This booking has already been paid' }
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, slug, price')
    .eq('id', booking.event_id)
    .single()

  if (!event) return { error: 'Event not found' }
  if (event.price === 0) {
    return { error: 'This is a free event — nothing to remediate' }
  }

  // holdExpiresAt hardcoded null — same deferred-cron tradeoff as
  // promoteFromWaitlist. See Addendum §A.3.
  const result = await createAdminPaymentRemediationHold(supabase, bookingId, {
    holdExpiresAt: null,
  })

  if (!result.success) return { error: result.error }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', booking.user_id)
    .single()

  revalidatePath('/admin/events')
  revalidatePath(`/admin/events/${event.id}/bookings`)
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')

  return {
    success: true,
    memberName: profile?.full_name ?? 'Member',
    status: 'pending_payment' as const,
    holdExpiresAt: result.holdExpiresAt ?? null,
  }
}

/**
 * Gap B (SYSTEM-DESIGN-admin-waitlist-promotion-payment.md addendum
 * §B.5): manually release an active `pending_payment` admin hold back to
 * `waitlisted` if the member doesn't pay. Stand-in for the still-
 * deferred, still-not-being-built 4h auto-revert cron
 * (`revert_expired_admin_holds`, migration 20260713000003).
 *
 * Origin-agnostic — works identically whether the hold came from
 * `promoteFromWaitlist` (waitlist promotion) or
 * `sendPaymentLinkForConfirmedBooking` above (payment remediation); see
 * `releaseAdminBookingHold` / `admin_revert_hold_to_waitlist` for why.
 * Always reverts to `waitlisted`, never `confirmed` — reverting a
 * remediated hold to an unpaid `confirmed` would silently recreate the
 * exact incident this whole feature exists to fix (Addendum §B.1).
 *
 * Pre-fetches booking (event_id, user_id) for the revalidatePath targets
 * and the success message only — the RPC re-validates everything that
 * matters for correctness under lock (Addendum §B.3). This fetch is UX,
 * not a security boundary.
 */
export async function demoteAdminHold(bookingId: string) {
  const { supabase } = await requireAdmin()

  if (!bookingId) return { error: 'Booking ID is required' }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, event_id, user_id')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (bookingError || !booking) return { error: 'Booking not found' }

  const result = await releaseAdminBookingHold(supabase, bookingId)
  if (!result.success) return { error: result.error }

  const [{ data: event }, { data: profile }] = await Promise.all([
    supabase.from('events').select('slug').eq('id', booking.event_id).single(),
    supabase.from('profiles').select('full_name').eq('id', booking.user_id).single(),
  ])

  revalidatePath('/admin/events')
  revalidatePath(`/admin/events/${booking.event_id}/bookings`)
  if (event?.slug) revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')

  return {
    success: true,
    memberName: profile?.full_name ?? 'Member',
    status: 'waitlisted' as const,
    waitlistPosition: result.waitlistPosition ?? null,
  }
}

/**
 * Gap C (SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md): reinstates
 * an eligible reaped `cancelled` booking on a PAID event that has room
 * again, sending the member a fresh Stripe payment link. Urgent incident
 * response — four real bookings (Amaya Kaur, Senam Paya, Christian I,
 * Laura Florez Perez) were auto-cancelled by
 * `reap_stale_pending_bookings()` before their payment window could be
 * extended, and the event now has room again freed by exactly those four
 * cancellations.
 *
 * Holds the booking as `pending_payment` via `createAdminReinstatementHold`
 * (→ `admin_reinstate_cancelled_booking_for_payment`, which re-validates
 * the full safety-critical eligibility predicate under lock — §1.5 of
 * the design doc, including the owning-profile-not-soft-deleted check —
 * and DOES capacity-check, unlike Gap A) and emails a template that does
 * NOT imply the member is still on the waitlist or still holds a
 * confirmed seat (§4.6).
 *
 * Pre-validates status/event.price in TS BEFORE ever calling the RPC —
 * belt-and-braces, matching this family's established habit (see
 * sendPaymentLinkForConfirmedBooking above). The RPC re-validates
 * everything that matters — including the safety-critical checks this
 * pre-check does NOT duplicate (cancellation_reason, stripe_payment_id,
 * refunded_amount_pence, is_admin_hold, other-active-booking,
 * profile.deleted_at) — under lock.
 *
 * `holdExpiresAt` hardcoded to `null` — same deferred-cron tradeoff as
 * promoteFromWaitlist/sendPaymentLinkForConfirmedBooking above (design
 * doc §6): no cron exists to act on a non-null deadline for ANY origin
 * yet. This origin's urgency is instead addressed by a mandatory,
 * first-class manual release action (`releaseReinstatedHold` below).
 */
export async function reinstateCancelledBooking(bookingId: string) {
  const { supabase } = await requireAdmin()
  if (!bookingId) return { error: 'Booking ID is required' }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, event_id, user_id, status')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()
  if (bookingError || !booking) return { error: 'Booking not found' }
  if (booking.status !== 'cancelled') {
    return { error: 'Only cancelled bookings can be reinstated' }
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, slug, price')
    .eq('id', booking.event_id)
    .single()
  if (!event) return { error: 'Event not found' }
  if (event.price === 0) {
    return { error: 'This is a free event — reinstate by booking directly, not via this tool' }
  }

  // holdExpiresAt hardcoded null — see design doc §6. No cron exists to
  // act on a non-null deadline for ANY origin yet; this origin has a
  // mandatory manual release action instead (releaseReinstatedHold below).
  const result = await createAdminReinstatementHold(supabase, bookingId, { holdExpiresAt: null })
  if (!result.success) return { error: result.error }

  const { data: profile } = await supabase
    .from('profiles').select('full_name').eq('id', booking.user_id).single()

  revalidatePath('/admin/events')
  revalidatePath(`/admin/events/${event.id}/bookings`)
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')

  return {
    success: true,
    memberName: profile?.full_name ?? 'Member',
    status: 'pending_payment' as const,
    holdExpiresAt: result.holdExpiresAt ?? null,
  }
}

/**
 * Gap C's own release action (SYSTEM-DESIGN-admin-reinstate-cancelled-
 * booking.md §4.2/§4.7/§6): manually release an active cancelled-
 * reinstatement `pending_payment` hold back to `cancelled` if the member
 * doesn't pay. Unlike `demoteAdminHold` above, this is NOT a stand-in for
 * a not-yet-built cron — it is the PRIMARY, mandatory release path for
 * this origin by design (§6): reinstating a reaped booking is inherently
 * a "second chance" for a spot that was already lost once, so a
 * first-class manual release exists from day one rather than being
 * deferred.
 *
 * Reverts to `cancelled` — never `waitlisted` (this booking was never on
 * the waitlist this cycle; see `releaseReinstatedBookingHold`'s own doc
 * comment for the full reasoning).
 *
 * Pre-fetches booking (event_id, user_id) for the revalidatePath targets
 * and the success message only — the RPC re-validates everything that
 * matters for correctness under lock, same convention as demoteAdminHold.
 */
export async function releaseReinstatedHold(bookingId: string) {
  const { supabase } = await requireAdmin()
  if (!bookingId) return { error: 'Booking ID is required' }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings').select('id, event_id, user_id').eq('id', bookingId).is('deleted_at', null).single()
  if (bookingError || !booking) return { error: 'Booking not found' }

  const result = await releaseReinstatedBookingHold(supabase, bookingId)
  if (!result.success) return { error: result.error }

  const [{ data: event }, { data: profile }] = await Promise.all([
    supabase.from('events').select('slug').eq('id', booking.event_id).single(),
    supabase.from('profiles').select('full_name').eq('id', booking.user_id).single(),
  ])

  revalidatePath('/admin/events')
  revalidatePath(`/admin/events/${booking.event_id}/bookings`)
  if (event?.slug) revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')

  return { success: true, memberName: profile?.full_name ?? 'Member', status: 'cancelled' as const }
}

export async function exportEventAttendeesCSV(eventId: string) {
  const { supabase } = await requireAdmin()

  if (!eventId) throw new Error('Event ID is required')

  // `id` is added to the join purely to key the phone merge; it is on the
  // `authenticated` allow-list (safe). phone_number is NOT selected here
  // (revoked in 20260503000002) — it is merged via admin_get_user_phones().
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      booked_at,
      profile:profiles!bookings_user_id_fkey(id, full_name, email)
    `)
    .eq('event_id', eventId)
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .order('booked_at', { ascending: true })

  if (error) throw new Error(`Failed to fetch attendees: ${error.message}`)

  const parsed = (data ?? []).map((b) => {
    const profile = extractJoin<{ id: string; full_name: string; email: string }>(
      b.profile
    )
    return {
      id: profile?.id ?? null,
      name: profile?.full_name ?? '',
      email: profile?.email ?? '',
      booked_at: b.booked_at,
    }
  })

  // One batch RPC for the confirmed attendees' phones — no N+1.
  const profileIds = parsed
    .map((r) => r.id)
    .filter((id): id is string => typeof id === 'string')
  const phoneMap = await fetchPhoneMap(supabase, profileIds)

  const rows = parsed.map((r) => ({
    name: r.name,
    email: r.email,
    mobile: r.id ? phoneMap.get(r.id) ?? null : null,
    booked_at: r.booked_at,
  }))

  // Mobile is column 3 (contact details grouped: Name, Email, Mobile; the
  // timestamp stays last). The Mobile cell MUST pass through sanitizeCsvCell:
  // phone numbers start with `+`, a CSV formula-injection lead char. NULL
  // phone → empty quoted cell. See SYSTEM-DESIGN-member-phone-admin-read.md §3.
  const header = 'Name,Email,Mobile,Booked At'
  const csvRows = rows.map(
    (r) =>
      `"${sanitizeCsvCell(r.name)}","${sanitizeCsvCell(r.email)}","${sanitizeCsvCell(r.mobile ?? '')}","${r.booked_at}"`
  )

  return [header, ...csvRows].join('\n')
}

// ── Member Management ────────────────────────────────────────────────────────

export async function getAdminMembers(search?: string, sort?: string) {
  const { supabase } = await requireAdmin()

  // Get profiles with booking counts
  // We'll fetch profiles then compute booking stats
  //
  // Columns enumerated explicitly because migration 20260503000001
  // (add_profile_demographics) narrowed the `authenticated` SELECT GRANT on
  // `public.profiles` to a column allow-list, and 20260503000002
  // (narrow_phone_number_grant) revoked phone_number from it. `select('*')`
  // would now raise 42501 (permission-denied) — PostgREST does NOT silently
  // omit ungranted columns. The list below is the full post-W1 allow-list
  // for the `authenticated` role; if a column is added to or removed from
  // the GRANT, mirror it here. Demographics + phone reads (when needed)
  // must go through the SECURITY DEFINER helpers
  // (`admin_get_demographics`, `admin_get_user_phone`).
  let query = supabase
    .from('profiles')
    .select(`
      id, email, full_name, avatar_url, job_title, company, industry, bio,
      linkedin_url, role, onboarding_complete, referral_source, status,
      email_consent, email_verified, sms_consent,
      moderation_reason, moderation_at, moderation_by,
      created_at, updated_at, deleted_at
    `)
    .is('deleted_at', null)

  if (search && search.trim()) {
    const escaped = escapeIlike(search.trim())
    const term = `%${escaped}%`
    query = query.or(`full_name.ilike.${term},email.ilike.${term}`)
  }

  switch (sort) {
    case 'alphabetical':
      query = query.order('full_name', { ascending: true })
      break
    case 'most_active':
      // Sort by created_at desc as a proxy; we'll re-sort after getting booking counts
      query = query.order('created_at', { ascending: false })
      break
    case 'newest':
    default:
      query = query.order('created_at', { ascending: false })
      break
  }

  const { data: profiles, error } = await query

  if (error) throw new Error(`Failed to fetch members: ${error.message}`)

  if (!profiles || profiles.length === 0) return [] as MemberWithStats[]

  // Fetch booking counts for all members in one query
  const profileIds = profiles.map((p) => p.id)

  const { data: bookings } = await supabase
    .from('bookings')
    .select('user_id, status')
    .in('user_id', profileIds)
    .is('deleted_at', null)

  // Batch-fetch phone (admin-only PII) via the SECURITY DEFINER RPC, reusing
  // the same id array. NOT added to the .select() above — see the comment in
  // the .map() below and the guard test in actions-get-members.test.ts.
  const phoneMap = await fetchPhoneMap(supabase, profileIds)

  // Aggregate booking stats per user
  const statsMap = new Map<string, { attended: number; confirmed: number; waitlisted: number }>()

  for (const b of bookings ?? []) {
    const stats = statsMap.get(b.user_id) ?? { attended: 0, confirmed: 0, waitlisted: 0 }
    if (b.status === 'confirmed') {
      stats.confirmed++
      stats.attended++ // confirmed = attended for our purposes
    } else if (b.status === 'waitlisted') {
      stats.waitlisted++
    }
    statsMap.set(b.user_id, stats)
  }

  const result: MemberWithStats[] = profiles.map((p) => {
    const stats = statsMap.get(p.id) ?? { attended: 0, confirmed: 0, waitlisted: 0 }
    // `phone_number` is NOT in the explicit select() above (revoked from the
    // `authenticated` GRANT in 20260503000002). It is fetched in one batch via
    // the admin_get_user_phones() SECURITY DEFINER RPC and merged here, so the
    // returned object satisfies `MemberWithStats` without the previous
    // `as unknown` cast.
    //
    // Caveat: the narrowed select also omits other Profile-adjacent revoked
    // columns (gender, age_range, stripe_customer_id,
    // profile_nudge_email_sent_at). The CURRENT `Profile` interface does not
    // declare those, so once phone_number is supplied the object satisfies
    // `Profile` (and thus `MemberWithStats`) cleanly. If `Profile` is later
    // extended to include those revoked columns, a narrower row type or a cast
    // returns here.
    return {
      ...p,
      phone_number: phoneMap.get(p.id) ?? null,
      events_attended: stats.attended,
      events_confirmed: stats.confirmed,
      events_waitlisted: stats.waitlisted,
    } satisfies MemberWithStats
  })

  // Re-sort by most_active if needed (by events_attended desc)
  if (sort === 'most_active') {
    result.sort((a, b) => b.events_attended - a.events_attended)
  }

  return result
}

/** Slim member shape for the admin host-picker UI. */
export interface HostPickerMember {
  id: string
  full_name: string
  avatar_url: string | null
  job_title: string | null
  company: string | null
}

/**
 * Lean read for the admin host-picker dropdown. `getAdminMembers` is too
 * heavy here because it joins per-member booking counts; the picker just
 * needs identifying info to render a row. Active members only — banned /
 * suspended / soft-deleted shouldn't appear in the dropdown.
 */
export async function listMembersForHostPicker(): Promise<HostPickerMember[]> {
  const { supabase } = await requireAdmin()

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, job_title, company')
    .is('deleted_at', null)
    .eq('status', 'active')
    .order('full_name', { ascending: true })

  if (error) throw new Error(`Failed to fetch members for host picker: ${error.message}`)

  return (data ?? []) as HostPickerMember[]
}

export async function exportMembersCSV(search?: string) {
  const { supabase } = await requireAdmin()

  let query = supabase
    .from('profiles')
    .select('full_name, email, job_title, company, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (search && search.trim()) {
    const escaped = escapeIlike(search.trim())
    const term = `%${escaped}%`
    query = query.or(`full_name.ilike.${term},email.ilike.${term}`)
  }

  const { data, error } = await query

  if (error) throw new Error(`Failed to fetch members: ${error.message}`)

  const header = 'Name,Email,Job Title,Company,Joined'
  const csvRows = (data ?? []).map((m) => {
    const name = sanitizeCsvCell(m.full_name ?? '')
    const email = sanitizeCsvCell(m.email ?? '')
    const jobTitle = sanitizeCsvCell(m.job_title ?? '')
    const company = sanitizeCsvCell(m.company ?? '')
    return `"${name}","${email}","${jobTitle}","${company}","${m.created_at}"`
  })

  return [header, ...csvRows].join('\n')
}

// ── Review Moderation ────────────────────────────────────────────────────────

export async function getAdminReviews(filter?: 'all' | 'visible' | 'hidden') {
  const { supabase } = await requireAdmin()

  let query = supabase
    .from('event_reviews')
    .select(`
      id, rating, review_text, is_visible, created_at,
      author:profiles!event_reviews_user_id_fkey(id, full_name, avatar_url, email),
      event:events!event_reviews_event_id_fkey(id, slug, title)
    `)
    .order('created_at', { ascending: false })

  if (filter === 'visible') {
    query = query.eq('is_visible', true)
  } else if (filter === 'hidden') {
    query = query.eq('is_visible', false)
  }

  const { data, error } = await query

  if (error) throw new Error(`Failed to fetch reviews: ${error.message}`)

  return data ?? []
}

export async function toggleReviewVisibility(reviewId: string) {
  const { supabase } = await requireAdmin()

  if (!reviewId) return { error: 'Review ID is required' }

  // Get current state + event slug for revalidation
  const { data: review } = await supabase
    .from('event_reviews')
    .select('is_visible, event:events!event_reviews_event_id_fkey(slug)')
    .eq('id', reviewId)
    .single()

  if (!review) return { error: 'Review not found' }

  const { error } = await supabase
    .from('event_reviews')
    .update({ is_visible: !review.is_visible })
    .eq('id', reviewId)

  if (error) return { error: error.message }

  const eventSlug = extractJoin<{ slug: string }>(review.event)?.slug
  revalidatePath('/admin/reviews')
  if (eventSlug) revalidatePath(`/events/${eventSlug}`)

  return { success: true, is_visible: !review.is_visible }
}

// ── Notifications (Mocked) ──────────────────────────────────────────────────

export async function sendNotification(formData: FormData) {
  const { supabase, userId } = await requireAdmin()

  const raw = {
    subject: (formData.get('subject') as string) ?? '',
    body: (formData.get('body') as string) ?? '',
    recipient_type: (formData.get('recipient_type') as string) ?? 'all',
    type: (formData.get('type') as string) ?? 'announcement',
    recipient_event_id: (formData.get('recipient_event_id') as string) || null,
  }

  const parsed = notificationSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Validation failed' }
  }

  const data = parsed.data

  const { error } = await supabase
    .from('notifications')
    .insert({
      sent_by: userId,
      recipient_type: data.recipient_type as NotificationRecipient,
      recipient_event_id: data.recipient_event_id ?? null,
      type: data.type as NotificationType,
      subject: data.subject,
      body: data.body,
    })

  if (error) return { error: error.message }

  // Mock email log
  console.log(`[MOCK EMAIL] To: ${data.recipient_type}, Subject: ${data.subject}`)

  revalidatePath('/admin/notifications')

  return { success: true }
}

export async function getNotificationHistory() {
  const { supabase } = await requireAdmin()

  const { data, error } = await supabase
    .from('notifications')
    .select(`
      id, subject, body, type, recipient_type, recipient_event_id, sent_at,
      sender:profiles!notifications_sent_by_fkey(id, full_name, avatar_url)
    `)
    .order('sent_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch notifications: ${error.message}`)

  return data ?? []
}

// ════════════════════════════════════════════════════════════════════════════
// P2-9 — Failed notifications (admin retry view)
// ════════════════════════════════════════════════════════════════════════════

export interface FailedNotification {
  id: string
  template_name: string | null
  subject: string
  body: string
  recipient_email: string | null
  error_message: string | null
  sent_at: string
  retried_at: string | null
}

/**
 * Lists notifications that the email send wrapper logged with
 * `status='failed'`. Limited to 100 most-recent rows — the failure rate
 * should be low; if it isn't, that's a bigger problem than this view.
 */
export async function getFailedNotifications(): Promise<FailedNotification[]> {
  const { supabase } = await requireAdmin()

  const { data, error } = await supabase
    .from('notifications')
    .select(
      'id, template_name, subject, body, recipient_email, error_message, sent_at, retried_at',
    )
    .eq('channel', 'email')
    .eq('status', 'failed')
    .order('sent_at', { ascending: false })
    .limit(100)

  if (error) throw new Error(`Failed to fetch failed notifications: ${error.message}`)
  return (data ?? []) as FailedNotification[]
}

/**
 * Re-fire a failed email send using the stored subject + body +
 * recipient. Marks the original row's `retried_at` so the admin can
 * tell when it last cycled. The retry itself logs a fresh row via
 * the standard send wrapper.
 *
 * Refuses to retry rows that have been GDPR-scrubbed
 * (body/subject/recipient redacted on account deletion) — sending
 * "[redacted]" to nobody is worse than no-op.
 */
export async function retryNotification(
  notificationId: string,
): Promise<{ success: true } | { error: string }> {
  const { supabase } = await requireAdmin()

  if (!notificationId) return { error: 'Notification ID is required' }

  const { data: row, error: fetchErr } = await supabase
    .from('notifications')
    .select(
      'id, template_name, subject, body, recipient_email, channel, status',
    )
    .eq('id', notificationId)
    .single()
  if (fetchErr || !row) return { error: 'Notification not found' }

  if (row.channel !== 'email') {
    return { error: 'Only email notifications can be retried here' }
  }
  if (row.status !== 'failed') {
    return { error: 'Only failed notifications can be retried' }
  }
  if (!row.recipient_email) {
    return { error: 'No recipient email — cannot retry' }
  }
  if (isRedacted(row.body) || isRedacted(row.subject)) {
    return { error: 'This notification has been redacted (account deleted)' }
  }

  const sendResult = await sendEmail({
    to: row.recipient_email,
    subject: row.subject,
    html: row.body,
    templateName: row.template_name ?? 'retry',
  })

  // Stamp the original row as retried regardless of send outcome — the
  // admin sees the timestamp and can check the new audit row written
  // by the send wrapper for the actual outcome.
  await supabase
    .from('notifications')
    .update({ retried_at: new Date().toISOString() })
    .eq('id', notificationId)

  revalidatePath('/admin/notifications/failed')

  if (!sendResult.success) {
    return { error: `Retry send failed: ${sendResult.error}` }
  }
  return { success: true }
}

// ════════════════════════════════════════════════════════════════════════════
// P2-9 — Email all confirmed attendees
// ════════════════════════════════════════════════════════════════════════════

const announcementSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(3, 'Subject must be at least 3 characters')
    .max(150, 'Subject is too long (max 150 chars)')
    .refine((v) => !/[\r\n]/.test(v), {
      message: 'Subject cannot contain line breaks',
    }),
  body: z
    .string()
    .trim()
    .min(10, 'Body must be at least 10 characters')
    .max(5000, 'Body is too long (max 5000 chars)'),
})

/**
 * Send a plain-text announcement email to every confirmed attendee of
 * an event. The dispatch loop runs in `next/server.after()` so the
 * admin gets an immediate response — emails fan out post-response.
 *
 * Each send is logged to `notifications` via the existing `sendEmail`
 * wrapper with `recipient_user_id` + `recipient_event_id` populated so
 * the GDPR scrub RPC (`sanitise_user_notifications`) can find and
 * redact these rows when an attendee deletes their account.
 *
 * Returns the count we *intend* to send (post-response failures appear
 * in the failed-notifications admin view).
 */
export async function emailEventAttendees(
  eventId: string,
  formData: FormData,
): Promise<{ success: true; recipientCount: number } | { error: string }> {
  const { supabase, userId: adminId } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  const parsed = announcementSchema.safeParse({
    subject: (formData.get('subject') as string) ?? '',
    body: (formData.get('body') as string) ?? '',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { subject, body } = parsed.data

  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select('id, title, slug')
    .eq('id', eventId)
    .is('deleted_at', null)
    .single()
  if (eventErr || !event) return { error: 'Event not found' }

  // Confirmed attendees only — no waitlist, no cancelled, no pending.
  // We deliberately do NOT block sending on cancelled events — admins
  // may legitimately need to email attendees about a cancellation /
  // refund timeline. The event row's `is_cancelled` is informational
  // only at this layer; the admin sees the cancelled badge in the UI
  // when composing.
  const { data: bookings, error: bookingsErr } = await supabase
    .from('bookings')
    .select(`
      id,
      user_id,
      profile:profiles!bookings_user_id_fkey(id, full_name, email)
    `)
    .eq('event_id', eventId)
    .eq('status', 'confirmed')
    .is('deleted_at', null)
  if (bookingsErr) return { error: 'Failed to fetch attendees' }

  type Recipient = { userId: string; fullName: string; email: string }
  const recipients: Recipient[] = []
  for (const b of bookings ?? []) {
    const profile = extractJoin<{ id: string; full_name: string; email: string }>(
      b.profile,
    )
    if (!profile?.email) continue
    recipients.push({
      userId: profile.id,
      fullName: profile.full_name ?? '',
      email: profile.email,
    })
  }

  if (recipients.length === 0) {
    return { error: 'No confirmed attendees to email' }
  }

  // Pre-filter recipients by their admin_announcements preference in a
  // single round-trip. Previously sendEmail's per-send
  // `preferenceCategory` check issued one SELECT per attendee — fine at
  // small events, compounding with the 120ms throttle + Resend latency
  // once attendee lists cross ~100. One IN query builds a map, the
  // loop consults it in memory.
  //
  // Default-on semantics: a missing row means the user hasn't opted
  // out of anything yet, so they receive admin announcements.
  const { data: prefRows, error: prefErr } = await supabase
    .from('notification_preferences')
    .select('user_id, admin_announcements')
    .in('user_id', recipients.map((r) => r.userId))
  if (prefErr) {
    console.error('[emailEventAttendees] preference lookup failed', prefErr)
    // Fall through — we'd rather over-send than silently drop the whole
    // batch on a transient DB error. sendEmail's own per-send check will
    // still run and enforce opt-outs individually (at the old cost).
  }
  const optedOut = new Set<string>()
  for (const row of prefRows ?? []) {
    const r = row as { user_id: string; admin_announcements: boolean | null }
    if (r.admin_announcements === false) optedOut.add(r.user_id)
  }
  const deliverable = recipients.filter((r) => !optedOut.has(r.userId))

  if (deliverable.length === 0) {
    // Every attendee has opted out — return a clear signal so the admin
    // UI can inform them rather than showing a "sent to 0 of N" toast.
    return { error: 'No attendees are opted in to admin announcements' }
  }

  // Keep `preferenceCategory` on the sendEmail call below as a
  // defence-in-depth check — the in-memory map is the fast path; if a
  // user opts out between the batch-fetch and the send (during the
  // throttled delivery loop) sendEmail's per-send lookup catches it.
  // The optimisation is that the *common case* (no opt-out change
  // mid-batch) skips the per-send SELECT via the pre-filter.

  // Snapshot what we need inside `after()` — closure-captured values
  // outlive the request scope.
  const eventSnapshot = {
    id: event.id,
    title: event.title,
    slug: event.slug,
  }

  // Resend free tier caps at 10 req/sec. We previously relied on sequential
  // awaits + natural latency to stay under the cap, which worked for
  // small events but started hitting 429s around 100 attendees. Phase
  // 2.5 Batch 7 adds an explicit 120ms throttle between sends — yields
  // ~8.3 req/sec, comfortably under the cap — plus a small grace period
  // after every 50 sends to absorb any provider jitter. Failed sends
  // still land in the admin retry view for recovery.
  const THROTTLE_MS = 120
  const BATCH_PAUSE_MS = 1000
  const BATCH_SIZE = 50
  after(async () => {
    for (let i = 0; i < deliverable.length; i++) {
      const r = deliverable[i]
      const rendered = adminAnnouncementTemplate({
        fullName: r.fullName,
        eventTitle: eventSnapshot.title,
        eventSlug: eventSnapshot.slug,
        subject,
        bodyText: body,
        userId: r.userId,
      })
      await sendEmail({
        to: r.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateName: 'admin_announcement',
        relatedProfileId: adminId,
        recipientUserId: r.userId,
        recipientEventId: eventSnapshot.id,
        recipientType: 'event_attendees',
        notificationType: 'announcement',
        preferenceCategory: 'admin_announcements',
        tags: [
          { name: 'template', value: 'admin_announcement' },
          { name: 'event_id', value: eventSnapshot.id },
        ],
      })
      // Throttle: standard pause after every send, longer pause every 50.
      const isLast = i === deliverable.length - 1
      if (!isLast) {
        const pause =
          (i + 1) % BATCH_SIZE === 0 ? BATCH_PAUSE_MS : THROTTLE_MS
        await new Promise((resolve) => setTimeout(resolve, pause))
      }
    }
  })

  return { success: true, recipientCount: deliverable.length }
}

// ════════════════════════════════════════════════════════════════════════════
// P2-8a — Member moderation
// ════════════════════════════════════════════════════════════════════════════

const moderationSchema = z.object({
  memberId: z.string().uuid('Invalid member id'),
  reason: z
    .string()
    .trim()
    .min(3, 'Please enter a reason (3+ chars)')
    .max(500, 'Reason is too long (max 500 chars)'),
})

/**
 * Shared implementation for ban/suspend/reinstate. Records the
 * moderation audit columns (reason, actor, timestamp) atomically with
 * the status change. Refuses:
 *   - self-moderation (an admin can't ban themselves)
 *   - moderation of other admins (defence against compromised admin
 *     accidentally locking out the team; admins must use the DB
 *     directly to moderate each other, which is intentional friction).
 *
 * Reinstate paths pass reason = 'Reinstated' by default — the audit
 * column stays populated so the history is preserved.
 */
async function setMemberStatus(args: {
  memberId: string
  newStatus: UserStatus
  reason: string
}): Promise<{ success: true } | { error: string }> {
  const { supabase, userId: adminId } = await requireAdmin()

  if (args.memberId === adminId) {
    return { error: 'You can\u2019t moderate your own account.' }
  }

  const parsed = moderationSchema.safeParse({
    memberId: args.memberId,
    reason: args.reason,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { data: target, error: fetchErr } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', args.memberId)
    .is('deleted_at', null)
    .single()
  if (fetchErr || !target) {
    return { error: 'Member not found' }
  }
  if (target.role === 'admin') {
    return { error: 'Admin accounts can\u2019t be moderated via this UI.' }
  }

  const { error: updErr } = await supabase
    .from('profiles')
    .update({
      status: args.newStatus,
      moderation_reason: args.reason,
      moderation_at: new Date().toISOString(),
      moderation_by: adminId,
    })
    .eq('id', args.memberId)

  if (updErr) {
    console.error('[setMemberStatus]', updErr.message)
    return { error: 'Could not update member status' }
  }

  revalidatePath('/admin/members')
  revalidatePath(`/admin/members/${args.memberId}`)
  return { success: true }
}

/** Suspend a member — keep login + browse, block booking. */
export async function suspendMember(
  memberId: string,
  reason: string,
): Promise<{ success: true } | { error: string }> {
  return setMemberStatus({ memberId, newStatus: 'suspended', reason })
}

/** Ban a member — middleware signs them out on next request. */
export async function banMember(
  memberId: string,
  reason: string,
): Promise<{ success: true } | { error: string }> {
  return setMemberStatus({ memberId, newStatus: 'banned', reason })
}

/**
 * Restore an actioned member to 'active'. `reason` is optional; we
 * default to "Reinstated" so the audit columns stay populated (the
 * moderation history is preserved across reinstatements).
 */
export async function reinstateMember(
  memberId: string,
  reason: string = 'Reinstated',
): Promise<{ success: true } | { error: string }> {
  return setMemberStatus({ memberId, newStatus: 'active', reason })
}

// ── P2-8b: deletion queue ────────────────────────────────────────────────

/**
 * Lists soft-deleted profiles — the "deletion queue" for admins to
 * review before the 30-day hard-delete cut-off. The Server Action
 * `deleteMyAccount` has already anonymised the row (email and full_name
 * replaced with placeholders, PII cleared) at the time of soft-delete;
 * this view surfaces what's still sitting in the table.
 *
 * Phase 3 will cron-automate hard deletion after 30 days. For now the
 * admin performs the final cleanup manually (or via SQL) — which keeps
 * us deliberately cautious while the flow is new.
 */
export async function getDeletedAccounts() {
  const { supabase } = await requireAdmin()

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, deleted_at, created_at')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch deleted accounts: ${error.message}`)
  return data ?? []
}

// ── No-show tracking ──────────────────────────────────────────────────────

/**
 * Toggle a booking's status between `confirmed` and `no_show`. Only
 * applies to confirmed bookings for past events — marking a no-show on
 * an upcoming event is a no-op (doesn't make sense). Also refuses
 * bookings that were cancelled or waitlisted.
 *
 * `on=true` → `no_show`; `on=false` → `confirmed` (undo the mark).
 */
export async function setNoShow(
  bookingId: string,
  on: boolean,
): Promise<{ success: true } | { error: string }> {
  const { supabase } = await requireAdmin()

  if (!bookingId) return { error: 'Booking ID is required' }

  // Fetch to verify the booking exists, belongs to a past event, and is
  // in a valid source status for the toggle.
  const { data: booking, error: fetchErr } = await supabase
    .from('bookings')
    .select('id, status, event:events!inner(date_time)')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()
  if (fetchErr || !booking) return { error: 'Booking not found' }

  const eventRow = Array.isArray(booking.event) ? booking.event[0] : booking.event
  if (!eventRow || new Date((eventRow as { date_time: string }).date_time) > new Date()) {
    return { error: 'No-show can only be marked for past events' }
  }

  const sourceStatus = on ? 'confirmed' : 'no_show'

  if (booking.status !== sourceStatus) {
    return {
      error: on
        ? 'Only confirmed bookings can be marked no-show'
        : 'Only no-show bookings can be reverted',
    }
  }

  // Final write moved into the set_booking_no_show SECURITY DEFINER RPC
  // (re-validates admin role, past-event, and source status server-side
  // under a row lock) so a member can no longer forge `status` via a
  // direct PATCH to the REST API. The TS pre-checks above are kept
  // unchanged for their snappier, identically-worded error messages in
  // the common "already correct state" case. See docs/SYSTEM-DESIGN-
  // bookings-write-authorization-hardening.md §3.5.
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'set_booking_no_show',
    { p_booking_id: bookingId, p_no_show: on },
  )
  if (rpcError) return { error: rpcError.message }

  const rpcResult = rpcData as { error?: string } | null
  if (rpcResult?.error) return { error: rpcResult.error }

  revalidatePath('/admin/events')
  revalidatePath('/admin/members')
  return { success: true }
}
