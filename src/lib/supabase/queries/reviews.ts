import { createServerClient } from '@/lib/supabase/server'
import type { Event } from '@/types'

// ── Top reviews (homepage social proof) ─────────────────────────────────────

export interface HomepageReview {
  id: string
  rating: number
  review_text: string
  created_at: string
  event: { slug: string; title: string }
  author: { full_name: string; avatar_url: string | null }
}

/**
 * Top visible reviews for the homepage social-proof section, ranked by
 * rating (desc) then recency (desc). Filters out hidden reviews
 * (`is_visible = false`) and reviews lacking review text — a 5-star
 * silent rating doesn't make for a useful testimonial card.
 *
 * Default limit is 3; the UI may render fewer if the DB has fewer.
 */
export async function getTopHomepageReviews(
  limit = 3,
): Promise<HomepageReview[]> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('event_reviews')
    .select(`
      id, rating, review_text, created_at,
      author:profiles!event_reviews_user_id_fkey(full_name, avatar_url),
      event:events!event_reviews_event_id_fkey(slug, title)
    `)
    .eq('is_visible', true)
    .not('review_text', 'is', null)
    .neq('review_text', '')
    .order('rating', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[getTopHomepageReviews]', error.message)
    return []
  }

  return (data ?? []).map((row) => {
    const author = Array.isArray(row.author) ? row.author[0] : row.author
    const event = Array.isArray(row.event) ? row.event[0] : row.event
    return {
      id: row.id as string,
      rating: row.rating as number,
      review_text: row.review_text as string,
      created_at: row.created_at as string,
      author: {
        full_name: (author?.full_name as string) ?? 'A member',
        avatar_url: (author?.avatar_url as string | null) ?? null,
      },
      event: {
        slug: (event?.slug as string) ?? '',
        title: (event?.title as string) ?? '',
      },
    }
  })
}

// ── Reviewable events ────────────────────────────────────────────────────────

/** Columns returned for each reviewable event */
type ReviewableEvent = Pick<
  Event,
  'id' | 'slug' | 'title' | 'date_time' | 'venue_name' | 'image_url' | 'category'
>

/**
 * Fetch past events where the authenticated user has a confirmed booking
 * but has NOT yet submitted a review. Used by the bookings page to show
 * "Leave a Review" buttons.
 *
 * Returns an empty array for unauthenticated users.
 */
export async function getReviewableEvents(): Promise<ReviewableEvent[]> {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  // Past events with a confirmed booking and no existing review
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      event:events!inner(
        id, slug, title, date_time, venue_name, image_url, category
      )
    `)
    .eq('user_id', user.id)
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .lt('event.date_time', new Date().toISOString())
    .is('event.deleted_at', null)

  if (error) {
    console.error('[getReviewableEvents]', error.message)
    return []
  }

  // Extract the nested event objects
  const events = (data ?? []).map(
    (row) => (row as unknown as { event: ReviewableEvent }).event,
  )

  // Filter out events the user has already reviewed
  if (events.length === 0) return []

  const eventIds = events.map((e) => e.id)

  const { data: reviewed, error: reviewError } = await supabase
    .from('event_reviews')
    .select('event_id')
    .eq('user_id', user.id)
    .in('event_id', eventIds)

  if (reviewError) {
    console.error('[getReviewableEvents:reviewed]', reviewError.message)
    return []
  }

  const reviewedIds = new Set((reviewed ?? []).map((r) => r.event_id))

  return events.filter((e) => !reviewedIds.has(e.id))
}
