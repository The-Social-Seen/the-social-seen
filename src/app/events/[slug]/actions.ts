'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { bookingConfirmationTemplate } from '@/lib/email/templates/booking-confirmation'
import { formatDateFull, formatTime } from '@/lib/utils/dates'
import {
  createBookingCheckoutSession,
  ensureStripeCustomer,
} from '@/lib/stripe/checkout'
import type { BookingStatus } from '@/types'

// ── Result type ────────���─────────────────────────────��──────────────────────

interface ActionResult {
  success: boolean
  error?: string
  bookingId?: string
  status?: BookingStatus
  waitlistPosition?: number | null
  /**
   * Stripe-hosted Checkout URL. Populated for paid events in the
   * pending_payment branch. The client MUST navigate to this URL to
   * complete payment.
   */
  checkoutUrl?: string
}

// ── createBooking ───────────────────────────────────────────────────────────

/**
 * Create a booking via the book_event() RPC function.
 * Handles race-condition-safe booking with row locking.
 */
export async function createBooking(eventId: string): Promise<ActionResult> {
  if (!eventId) {
    return { success: false, error: 'Event ID is required' }
  }

  const supabase = await createServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Call the race-condition-safe RPC function
  const { data, error } = await supabase.rpc('book_event', {
    p_user_id: user.id,
    p_event_id: eventId,
  })

  if (error) {
    console.error('[createBooking]', error.message)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  // book_event() returns jsonb — check for error key
  const result = data as Record<string, unknown>
  if (result.error) {
    return { success: false, error: result.error as string }
  }

  // Revalidate affected pages
  revalidatePath('/events')
  revalidatePath('/bookings')
  revalidatePath('/profile')

  // Booking confirmation email — bonus, not critical. A failure here
  // must NOT roll back the booking. Skip if status is 'no_show' / 'cancelled'
  // (only confirmed/waitlisted/pending_payment trigger a confirmation).
  const bookingStatus = result.status as BookingStatus
  if (
    bookingStatus === 'confirmed' ||
    bookingStatus === 'waitlisted'
  ) {
    void sendBookingConfirmationEmail({
      userId: user.id,
      eventId,
      status: bookingStatus,
      waitlistPosition: (result.waitlist_position as number | null) ?? null,
    })
  }

  return {
    success: true,
    bookingId: result.booking_id as string,
    status: bookingStatus,
    waitlistPosition: (result.waitlist_position as number | null) ?? null,
  }
}

/**
 * Fire-and-forget booking confirmation email. Awaited via `void` from
 * the calling action so a slow Resend response doesn't delay the
 * booking response, but errors are still logged via the send wrapper's
 * notifications audit.
 */
async function sendBookingConfirmationEmail(args: {
  userId: string
  eventId: string
  status: 'confirmed' | 'waitlisted'
  waitlistPosition: number | null
}): Promise<void> {
  try {
    const supabase = await createServerClient()

    // Fetch the bits the template needs in a single round-trip each.
    const [profileRes, eventRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', args.userId)
        .single(),
      supabase
        .from('events')
        .select('title, slug, date_time, venue_name, venue_address, venue_revealed')
        .eq('id', args.eventId)
        .single(),
    ])

    const profile = profileRes.data
    const event = eventRes.data
    if (!profile?.email || !event) {
      console.warn(
        '[createBooking] confirmation email skipped: profile or event missing',
      )
      return
    }

    const tpl = bookingConfirmationTemplate({
      fullName: profile.full_name?.trim() || 'there',
      eventTitle: event.title,
      eventSlug: event.slug,
      eventDate: formatDateFull(event.date_time),
      eventTime: formatTime(event.date_time),
      venueName: event.venue_name,
      venueAddress: event.venue_address,
      venueRevealed: event.venue_revealed,
      status: args.status,
      waitlistPosition: args.waitlistPosition,
    })

    const result = await sendEmail({
      to: profile.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'booking_confirmation',
      relatedProfileId: args.userId,
      tags: [
        { name: 'template', value: 'booking_confirmation' },
        { name: 'status', value: args.status },
      ],
    })
    if (!result.success) {
      console.warn(
        '[createBooking] confirmation email failed:',
        result.error,
      )
    }
  } catch (err) {
    console.warn(
      '[createBooking] confirmation email threw:',
      err instanceof Error ? err.message : err,
    )
  }
}

// ── createPaidCheckout ──────────────────────────────────────────────────────

/**
 * Paid-event booking flow (P2-7a):
 *   1. `book_event_paid` RPC inserts a `pending_payment` row (or
 *      `waitlisted` if the event is full) under a row lock so concurrent
 *      bookings can't oversell.
 *   2. If waitlisted: send a waitlist confirmation email and return —
 *      no Stripe interaction for this booking.
 *   3. If pending_payment: lazy-create the Stripe Customer (first paid
 *      booking for this profile), create a Checkout Session with
 *      metadata.booking_id, stash the session id on the booking row,
 *      and return the Stripe-hosted URL.
 *
 * The client navigates to `checkoutUrl`. Stripe takes over UI. On
 * success Stripe POSTs to our webhook (confirms the booking) and
 * redirects the user to /events/:slug/booking-success. On cancel Stripe
 * redirects to /events/:slug/?cancelled=1.
 *
 * If Stripe fails mid-flow we roll the booking back to `cancelled` so
 * the seat is freed and the user can retry.
 */
export async function createPaidCheckout(
  eventId: string,
): Promise<ActionResult> {
  if (!eventId) {
    return { success: false, error: 'Event ID is required' }
  }

  const supabase = await createServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Race-safe paid booking. Inserts pending_payment or waitlisted.
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'book_event_paid',
    { p_user_id: user.id, p_event_id: eventId },
  )

  if (rpcError) {
    console.error('[createPaidCheckout] RPC error:', rpcError.message)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  const result = rpcData as Record<string, unknown>
  if (result.error) {
    return { success: false, error: result.error as string }
  }

  const bookingId = result.booking_id as string
  const status = result.status as BookingStatus
  const waitlistPosition = (result.waitlist_position as number | null) ?? null

  revalidatePath('/events')
  revalidatePath('/bookings')

  // Waitlisted paid event → no Stripe. Same shape as free-event
  // waitlist response; send the confirmation email and return.
  if (status === 'waitlisted') {
    void sendBookingConfirmationEmail({
      userId: user.id,
      eventId,
      status: 'waitlisted',
      waitlistPosition,
    })
    return { success: true, bookingId, status, waitlistPosition }
  }

  if (status !== 'pending_payment') {
    // Defensive — book_event_paid shouldn't return anything else.
    console.error(
      '[createPaidCheckout] unexpected status from book_event_paid:',
      status,
    )
    return { success: false, error: 'Unexpected booking state' }
  }

  // ── Create Stripe Checkout Session ────────────────────────────────────
  try {
    // Fetch event + profile for Checkout line-items and Customer.
    const [eventRes, profileRes] = await Promise.all([
      supabase
        .from('events')
        .select('title, slug, price')
        .eq('id', eventId)
        .single(),
      supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', user.id)
        .single(),
    ])

    const event = eventRes.data
    const profile = profileRes.data
    if (!event || !profile?.email) {
      throw new Error('Missing event or profile data for checkout')
    }

    // Lazy-customer-create uses the admin client because it writes back
    // to profiles.stripe_customer_id, which the user's own RLS policy
    // allows only on their own row — fine today, but using admin keeps
    // the helper usable from future cron/retry paths too.
    const admin = createAdminClient()
    const stripeCustomerId = await ensureStripeCustomer(admin, {
      userId: user.id,
      email: profile.email,
      fullName: profile.full_name,
    })

    const origin = await resolveOrigin()
    const successUrl = `${origin}/events/${event.slug}/booking-success?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${origin}/events/${event.slug}?cancelled=1`

    const { sessionId, url } = await createBookingCheckoutSession({
      bookingId,
      userId: user.id,
      userEmail: profile.email,
      eventId,
      eventTitle: event.title,
      eventSlug: event.slug,
      priceInPence: event.price,
      successUrl,
      cancelUrl,
      stripeCustomerId,
    })

    // Persist the session id for webhook lookup + audit. Non-critical —
    // the webhook also uses metadata.booking_id, so a failure here
    // doesn't break confirmation.
    const { error: updErr } = await supabase
      .from('bookings')
      .update({ stripe_checkout_session_id: sessionId })
      .eq('id', bookingId)
    if (updErr) {
      console.warn(
        '[createPaidCheckout] Failed to store checkout session id:',
        updErr.message,
      )
    }

    return { success: true, bookingId, status, checkoutUrl: url }
  } catch (err) {
    // Roll the booking back so the seat is freed and the user can retry.
    // Can't DELETE (no hard deletes); instead mark as cancelled.
    console.error(
      '[createPaidCheckout] Stripe flow failed, rolling back booking:',
      err instanceof Error ? err.message : err,
    )
    await supabase
      .from('bookings')
      .update({ status: 'cancelled' as BookingStatus })
      .eq('id', bookingId)
      .eq('status', 'pending_payment') // optimistic guard

    return {
      success: false,
      error: 'Could not start checkout. Please try again.',
    }
  }
}

async function resolveOrigin(): Promise<string> {
  // Prefer the explicit site URL env var (set in production). Fall back
  // to the request's forwarded host — works on localhost + Vercel
  // preview without any config.
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  if (host) return `${proto}://${host}`

  // Nothing found — only safe in local dev. In production this
  // indicates NEXT_PUBLIC_SITE_URL is misconfigured and Stripe would
  // redirect users to localhost (broken flow).
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[createPaidCheckout] No origin found — set NEXT_PUBLIC_SITE_URL. Stripe return URLs will be broken.',
    )
  }
  return 'http://localhost:3000'
}

// ── abandonPendingCheckout ──────────────────────────────────────────────────

/**
 * Called when the user clicks "← Back" out of Stripe's hosted Checkout
 * (Stripe redirects them to our `cancel_url` with `?cancelled=1`). Soft-
 * cancels their still-`pending_payment` booking for this event so the
 * seat is freed immediately, rather than waiting for Stripe's 30-minute
 * session expiry.
 *
 * Idempotent: the `.eq('status', 'pending_payment')` guard means a
 * repeat call (user refreshes) no-ops.
 */
export async function abandonPendingCheckout(
  eventId: string,
): Promise<ActionResult> {
  if (!eventId) {
    return { success: false, error: 'Event ID is required' }
  }

  const supabase = await createServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' as BookingStatus })
    .eq('user_id', user.id)
    .eq('event_id', eventId)
    .eq('status', 'pending_payment')
    .is('deleted_at', null)

  if (error) {
    console.error('[abandonPendingCheckout]', error.message)
    return { success: false, error: 'Could not release the booking' }
  }

  revalidatePath(`/events`)
  revalidatePath('/bookings')
  return { success: true }
}

// ── cancelBooking ────────────────���──────────────────────────────────────────

/**
 * Cancel a confirmed booking. Sets status to 'cancelled'.
 * Per architect spec: no auto-promote, no deleted_at.
 */
export async function cancelBooking(bookingId: string): Promise<ActionResult> {
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

  // Fetch booking to validate ownership and status
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, user_id, event_id, status')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !booking) {
    return { success: false, error: 'Booking not found' }
  }

  // Defence-in-depth: verify ownership (RLS also covers this)
  if (booking.user_id !== user.id) {
    return { success: false, error: 'Unauthorised' }
  }

  if (booking.status !== 'confirmed') {
    return { success: false, error: 'Only confirmed bookings can be cancelled' }
  }

  // Check event hasn't passed
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('date_time, slug')
    .eq('id', booking.event_id)
    .single()

  if (eventError || !event) {
    return { success: false, error: 'Event not found' }
  }

  if (new Date(event.date_time) < new Date()) {
    return { success: false, error: 'Cannot cancel a booking for a past event' }
  }

  // Optimistic lock: WHERE status = 'confirmed' guards against race condition
  const { data: updated, error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' as BookingStatus })
    .eq('id', bookingId)
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .select('id')
    .single()

  if (updateError || !updated) {
    return { success: false, error: 'Booking was already cancelled or modified' }
  }

  revalidatePath('/events')
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')
  revalidatePath('/profile')

  return { success: true }
}

// ── leaveWaitlist ──────────���─────────────────────────────��──────────────────

/**
 * Leave the waitlist for an event. Sets status to 'cancelled' and
 * recomputes waitlist positions for remaining waitlisted bookings.
 */
export async function leaveWaitlist(bookingId: string): Promise<ActionResult> {
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

  // Fetch booking to validate ownership and status
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, user_id, event_id, status')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !booking) {
    return { success: false, error: 'Booking not found' }
  }

  if (booking.user_id !== user.id) {
    return { success: false, error: 'Unauthorised' }
  }

  if (booking.status !== 'waitlisted') {
    return { success: false, error: 'Only waitlisted bookings can leave the waitlist' }
  }

  // Check event hasn't passed
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('date_time, slug')
    .eq('id', booking.event_id)
    .single()

  if (eventError || !event) {
    return { success: false, error: 'Event not found' }
  }

  if (new Date(event.date_time) < new Date()) {
    return { success: false, error: 'Cannot leave waitlist for a past event' }
  }

  // Cancel the waitlisted booking
  const { data: updated, error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' as BookingStatus, waitlist_position: null })
    .eq('id', bookingId)
    .eq('status', 'waitlisted')
    .is('deleted_at', null)
    .select('id')
    .single()

  if (updateError || !updated) {
    return { success: false, error: 'Booking was already cancelled or modified' }
  }

  // Recompute waitlist positions: single bulk decrement for all positions
  // above the leaving user's former position
  await supabase.rpc('recompute_waitlist_positions', {
    p_event_id: booking.event_id,
  })

  revalidatePath('/events')
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')
  revalidatePath('/profile')

  return { success: true }
}
