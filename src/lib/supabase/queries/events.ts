import { createServerClient } from '@/lib/supabase/server'
import type {
  EventCategory,
  EventDetail,
  EventPhoto,
  EventWithStats,
  ReviewWithAuthor,
  Booking,
} from '@/types'

// ── Published events (listing page) ─────────────────────────────────────────

/**
 * Fetch all published, non-cancelled events from the event_with_stats view.
 * Returns upcoming + past — client splits by date_time.
 */
export async function getPublishedEvents(): Promise<EventWithStats[]> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('event_with_stats')
    .select('*')
    .eq('is_published', true)
    .eq('is_cancelled', false)
    .order('date_time', { ascending: true })

  if (error) {
    console.error('[getPublishedEvents]', error.message)
    return []
  }

  return (data ?? []) as EventWithStats[]
}

// ── Past events (with review snippet) ───────────────────────────────────────

export interface PastEventWithSnippet extends EventWithStats {
  /** A representative high-rated review for the card, if one exists. */
  top_review: {
    rating: number
    review_text: string
    author_name: string
  } | null
  /** Up to 3 photos for the card thumbnail/strip. */
  photos: { image_url: string }[]
}

export interface PastEventsPage {
  events: PastEventWithSnippet[]
  /**
   * ISO date_time of the last event in this page. Pass back as
   * `cursor` to fetch the next page. `null` when there are no more
   * results (the page returned fewer than `pageSize` rows).
   */
  nextCursor: string | null
}

export const PAST_EVENTS_PAGE_SIZE = 60

/**
 * Past, published events ordered most-recent first. Includes cancelled
 * events (tagged via `is_cancelled` on the row) so the archive doesn't
 * silently hide an event an attendee actually booked and remembers.
 *
 * Cursor-paginated by `date_time` (descending). Pass the previous page's
 * `nextCursor` to fetch older events. Page size = `PAST_EVENTS_PAGE_SIZE`.
 */
export async function getPastEvents(
  opts: { cursor?: string | null } = {},
): Promise<PastEventsPage> {
  const supabase = await createServerClient()

  const nowIso = new Date().toISOString()
  let query = supabase
    .from('event_with_stats')
    .select('*')
    .eq('is_published', true)
    .lt('date_time', nowIso)
    .order('date_time', { ascending: false })
    .limit(PAST_EVENTS_PAGE_SIZE)

  if (opts.cursor) {
    // `date_time` is not strictly unique (two events at the same
    // minute would collide on the cursor); at The Social Seen scale
    // this hasn't happened and the UX cost of dropping one event
    // across a page boundary is trivial vs adding a composite cursor.
    query = query.lt('date_time', opts.cursor)
  }

  const { data: events, error } = await query

  if (error) {
    console.error('[getPastEvents]', error.message)
    return { events: [], nextCursor: null }
  }

  const rows = (events ?? []) as EventWithStats[]
  if (rows.length === 0) return { events: [], nextCursor: null }

  const eventIds = rows.map((e) => e.id)

  // Fetch all visible reviews + photos for the page in two parallel
  // queries. Cheaper than N+1 per-card lookups.
  const [reviewsRes, photosRes] = await Promise.all([
    supabase
      .from('event_reviews')
      .select('event_id, rating, review_text, author:profiles!event_reviews_user_id_fkey(full_name)')
      .in('event_id', eventIds)
      .eq('is_visible', true)
      .not('review_text', 'is', null)
      .neq('review_text', '')
      .order('rating', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('event_photos')
      .select('event_id, image_url')
      .in('event_id', eventIds)
      .order('sort_order', { ascending: true }),
  ])

  if (reviewsRes.error) {
    console.error('[getPastEvents:reviews]', reviewsRes.error.message)
  }
  if (photosRes.error) {
    console.error('[getPastEvents:photos]', photosRes.error.message)
  }

  const reviewsByEvent = new Map<string, PastEventWithSnippet['top_review']>()
  for (const r of reviewsRes.data ?? []) {
    if (reviewsByEvent.has(r.event_id as string)) continue // first match (top-rated)
    const author = Array.isArray(r.author) ? r.author[0] : r.author
    reviewsByEvent.set(r.event_id as string, {
      rating: r.rating as number,
      review_text: r.review_text as string,
      author_name: ((author?.full_name as string) ?? 'A member'),
    })
  }

  const photosByEvent = new Map<string, { image_url: string }[]>()
  for (const p of photosRes.data ?? []) {
    const list = photosByEvent.get(p.event_id as string) ?? []
    if (list.length < 3) {
      list.push({ image_url: p.image_url as string })
      photosByEvent.set(p.event_id as string, list)
    }
  }

  const pageEvents = rows.map((e) => ({
    ...e,
    top_review: reviewsByEvent.get(e.id) ?? null,
    photos: photosByEvent.get(e.id) ?? [],
  }))

  // Only advertise a next-cursor when we got a full page — otherwise
  // the "Load more" button would fetch an empty page.
  const nextCursor =
    rows.length === PAST_EVENTS_PAGE_SIZE
      ? (rows[rows.length - 1].date_time as string)
      : null

  return { events: pageEvents, nextCursor }
}

// ── Single event by slug (detail page) ───────────────────────────────────────

/**
 * Fetch a single published event with hosts, inclusions, and computed stats.
 * Returns null if not found or not published.
 */
export async function getEventBySlug(slug: string): Promise<EventDetail | null> {
  const supabase = await createServerClient()

  // 1. Fetch event with nested hosts + inclusions
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select(`
      *,
      event_hosts(
        id, event_id, profile_id, role_label, sort_order, created_at,
        profile:profiles(id, full_name, avatar_url, bio, job_title, company)
      ),
      event_inclusions(
        id, event_id, label, icon, sort_order, created_at
      )
    `)
    .eq('slug', slug)
    .eq('is_published', true)
    .is('deleted_at', null)
    .single()

  if (eventError || !event) {
    if (eventError && eventError.code !== 'PGRST116') {
      // PGRST116 = no rows returned — expected for bad slugs
      console.error('[getEventBySlug]', eventError.message)
    }
    return null
  }

  // 2. Fetch booking count + review stats in parallel (Amendment 3.5)
  const [bookingResult, reviewResult] = await Promise.all([
    supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .eq('status', 'confirmed')
      .is('deleted_at', null),
    supabase
      .from('event_reviews')
      .select('rating')
      .eq('event_id', event.id)
      .eq('is_visible', true),
  ])

  if (bookingResult.error) {
    console.error('[getEventBySlug:bookingCount]', bookingResult.error.message)
  }
  if (reviewResult.error) {
    console.error('[getEventBySlug:reviewStats]', reviewResult.error.message)
  }

  const confirmed = bookingResult.count ?? 0
  const reviews = reviewResult.data ?? []
  const reviewCount = reviews.length
  const avgRating =
    reviewCount > 0
      ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 100) / 100
      : 0

  // 4. Compute spots_left
  const spotsLeft = event.capacity == null ? null : Math.max(event.capacity - confirmed, 0)

  // 5. Sort nested arrays (Supabase doesn't guarantee nested order)
  const hosts = (event.event_hosts ?? [])
    .sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order)
    .map((h: Record<string, unknown>) => ({
      id: h.id,
      event_id: h.event_id,
      profile_id: h.profile_id,
      role_label: h.role_label,
      sort_order: h.sort_order,
      created_at: h.created_at,
      profile: h.profile,
    }))

  const inclusions = (event.event_inclusions ?? [])
    .sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order)

  // 6. Assemble EventDetail
  const { event_hosts: _eh, event_inclusions: _ei, ...eventFields } = event

  return {
    ...eventFields,
    confirmed_count: confirmed,
    avg_rating: avgRating,
    review_count: reviewCount,
    spots_left: spotsLeft,
    hosts,
    inclusions,
  } as EventDetail
}

// ── Event reviews ────────────────────────────────────────────────────────────

/**
 * Fetch visible reviews for an event, with author profile info.
 */
export async function getEventReviews(eventId: string): Promise<ReviewWithAuthor[]> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('event_reviews')
    .select(`
      id, user_id, event_id, rating, review_text, is_visible, created_at, updated_at,
      author:profiles(id, full_name, avatar_url)
    `)
    .eq('event_id', eventId)
    .eq('is_visible', true)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getEventReviews]', error.message)
    return []
  }

  // Supabase returns FK-based joins as arrays; unwrap the single author object
  return (data ?? []).map((row) => ({
    ...row,
    author: Array.isArray(row.author) ? row.author[0] : row.author,
  })) as ReviewWithAuthor[]
}

// ── Event photos ─────────────────────────────────────────────────────────────

/**
 * Fetch photos for an event, ordered by sort_order.
 */
export async function getEventPhotos(eventId: string): Promise<EventPhoto[]> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('event_photos')
    .select('id, event_id, image_url, caption, sort_order, created_at')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[getEventPhotos]', error.message)
    return []
  }

  return (data ?? []) as EventPhoto[]
}

// ── Related events ───────────────────────────────────────────────────────────

/**
 * Fetch up to 3 related events in the same category (excluding the current one).
 */
export async function getRelatedEvents(
  category: EventCategory,
  excludeId: string,
): Promise<EventWithStats[]> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('event_with_stats')
    .select('*')
    .eq('category', category)
    .neq('id', excludeId)
    .eq('is_published', true)
    .eq('is_cancelled', false)
    .order('date_time', { ascending: true })
    .limit(3)

  if (error) {
    console.error('[getRelatedEvents]', error.message)
    return []
  }

  return (data ?? []) as EventWithStats[]
}

// ── User's booking for an event ──────────────────────────────────────────────

/**
 * Fetch the current user's active booking for an event (if any).
 * Returns null if unauthenticated or no active booking exists.
 */
export async function getUserBookingForEvent(eventId: string): Promise<Booking | null> {
  const supabase = await createServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('bookings')
    .select('id, user_id, event_id, status, waitlist_position, price_at_booking, booked_at, created_at, updated_at, deleted_at')
    .eq('event_id', eventId)
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    console.error('[getUserBookingForEvent]', error.message)
    return null
  }

  return (data as Booking) ?? null
}
