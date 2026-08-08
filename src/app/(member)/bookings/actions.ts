'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { resumePendingBookingCheckout } from '@/lib/bookings/resume-checkout'

// ── Result type ──────────────────────────────────────────────────────────────

interface ActionResult {
  success: boolean
  error?: string
  /**
   * Stripe-hosted Checkout URL. Populated by `resumePendingCheckout` on
   * success — the client MUST navigate to this URL to complete payment.
   * Same optional field already used by the `ActionResult` shape in
   * src/app/events/[slug]/actions.ts (createPaidCheckout /
   * claimWaitlistSpot) — this codebase's established pattern is a
   * small, per-file `ActionResult` type rather than one shared import
   * (see e.g. that file's own copy), so this is a deliberate,
   * structurally-identical duplicate, not a divergence.
   */
  checkoutUrl?: string
}

// ── submitReview ─────────────────────────────────────────────────────────────

/**
 * Submit a review for a past event the user attended.
 * Validates: auth, rating range, text length, past event, confirmed booking,
 * and no duplicate review.
 */
export async function submitReview(input: {
  eventId: string
  rating: number
  reviewText?: string
}): Promise<ActionResult> {
  const { eventId, rating, reviewText } = input

  // ── Input validation ───────────────────────────────────────────────────────

  if (!eventId) {
    return { success: false, error: 'Event ID is required' }
  }

  // Rating must be integer 1–5
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { success: false, error: 'Rating must be a whole number between 1 and 5' }
  }

  // reviewText: optional, max 500 chars (Amendment 7.1)
  if (reviewText != null && reviewText.length > 500) {
    return { success: false, error: 'Review text must be 500 characters or fewer' }
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  const supabase = await createServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // ── Event exists and is in the past (EC-10) ────────────────────────────────

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, slug, date_time')
    .eq('id', eventId)
    .is('deleted_at', null)
    .single()

  if (eventError || !event) {
    return { success: false, error: 'Event not found' }
  }

  if (new Date(event.date_time) >= new Date()) {
    return { success: false, error: 'Reviews can only be submitted for past events' }
  }

  // ── Confirmed booking required (EC-09) ─────────────────────────────────────

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', user.id)
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .maybeSingle()

  if (bookingError) {
    console.error('[submitReview:bookingCheck]', bookingError.message)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  if (!booking) {
    return { success: false, error: 'You can only review events you attended' }
  }

  // ── Duplicate check (friendly error before UNIQUE constraint) ──────────────

  const { data: existing, error: existingError } = await supabase
    .from('event_reviews')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingError) {
    console.error('[submitReview:duplicateCheck]', existingError.message)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  if (existing) {
    return { success: false, error: 'You have already reviewed this event' }
  }

  // ── Insert review ──────────────────────────────────────────────────────────

  const { error: insertError } = await supabase
    .from('event_reviews')
    .insert({
      user_id: user.id,
      event_id: eventId,
      rating,
      review_text: reviewText?.trim() || null,
    })

  if (insertError) {
    console.error('[submitReview:insert]', insertError.message)

    // Handle UNIQUE constraint violation gracefully
    if (insertError.code === '23505') {
      return { success: false, error: 'You have already reviewed this event' }
    }

    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  // ── Revalidate affected paths ──────────────────────────────────────────────

  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')
  revalidatePath('/profile')

  return { success: true }
}

// ── resumePendingCheckout ──────────────────────────────────────────────────

/**
 * Resume payment on a self-service `pending_payment` booking whose
 * original Stripe Checkout was abandoned. Mints a brand-new Checkout
 * Session (never reuses a stale one — see
 * SYSTEM-DESIGN-pending-payment-visibility.md §1) and returns the URL
 * the client must navigate to.
 *
 * Thin auth wrapper over `resumePendingBookingCheckout`
 * (src/lib/bookings/resume-checkout.ts) — see that function's doc
 * comment for the full 11-step algorithm (spec §5.1/§5.2). Also called
 * from `GET /bookings/resume/[bookingId]` (the reminder email's CTA
 * link) — both entry points share this one implementation.
 */
export async function resumePendingCheckout(bookingId: string): Promise<ActionResult> {
  if (!bookingId) {
    return { success: false, error: 'Booking ID is required' }
  }

  const supabase = await createServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  const result = await resumePendingBookingCheckout(supabase, user.id, bookingId)

  if (result.success) {
    revalidatePath('/bookings')
  }

  return {
    success: result.success,
    error: result.error,
    checkoutUrl: result.checkoutUrl,
  }
}
