import { createServerClient } from '@/lib/supabase/server'
import type { Event } from '@/types'

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
