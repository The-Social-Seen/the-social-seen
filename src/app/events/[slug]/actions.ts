'use server'

import { after } from 'next/server'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { bookingConfirmationTemplate } from '@/lib/email/templates/booking-confirmation'
import { waitlistSpotAvailableTemplate } from '@/lib/email/templates/waitlist-spot-available'
import { formatDateFull, formatTime } from '@/lib/utils/dates'
import * as Sentry from '@sentry/nextjs'
import { getStripeClient } from '@/lib/stripe/server'
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
  /**
   * Cancellation-refund outcome (populated by cancelBooking).
   *   - refundedPence > 0 + refundEligible: full refund issued (cancellation
   *     was outside the event's refund_window_hours).
   *   - refundedPence = 0 + !refundEligible: paid event, cancellation inside
   *     the window OR event marked non-refundable (refund_window_hours = 0).
   *   - undefined: free event or nothing cancellation-related.
   */
  refundedPence?: number
  refundEligible?: boolean
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
    after(() =>
      sendBookingConfirmationEmail({
        userId: user.id,
        eventId,
        status: bookingStatus,
        waitlistPosition: (result.waitlist_position as number | null) ?? null,
      }),
    )
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
    after(() =>
      sendBookingConfirmationEmail({
        userId: user.id,
        eventId,
        status: 'waitlisted',
        waitlistPosition,
      }),
    )
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
    Sentry.captureException(err, {
      tags: { surface: 'createPaidCheckout' },
      extra: { bookingId, eventId, userId: user.id },
      level: 'error',
    })
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

// ── claimWaitlistSpot ───────────────────────────────────────────────────────

/**
 * First-click-wins waitlist claim (P2-7b). Fired when a waitlisted user
 * lands on `/events/[slug]?claim=1` (from the "spot available" email)
 * and clicks the Claim CTA.
 *
 * Flow:
 *   1. `claim_waitlist_spot` RPC atomically checks capacity + transitions
 *      the caller's waitlisted booking to `pending_payment` (paid event)
 *      or `confirmed` (free event) under a row lock.
 *   2. Free events: revalidate, send confirmation email, return success.
 *   3. Paid events: create a Stripe Checkout Session against the same
 *      booking_id (same `checkoutUrl` contract as createPaidCheckout —
 *      the client navigates there). On Stripe failure, roll the booking
 *      back to `waitlisted` (not `cancelled` — their waitlist entry is
 *      restored so the next cancellation email is still relevant).
 */
export async function claimWaitlistSpot(
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

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'claim_waitlist_spot',
    { p_user_id: user.id, p_event_id: eventId },
  )

  if (rpcError) {
    console.error('[claimWaitlistSpot] RPC error:', rpcError.message)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  const result = rpcData as Record<string, unknown>
  if (result.error) {
    return { success: false, error: result.error as string }
  }

  const bookingId = result.booking_id as string
  const status = result.status as BookingStatus

  revalidatePath('/events')
  revalidatePath('/bookings')

  // Free event — confirmed immediately, send confirmation email.
  if (status === 'confirmed') {
    after(() =>
      sendBookingConfirmationEmail({
        userId: user.id,
        eventId,
        status: 'confirmed',
        waitlistPosition: null,
      }),
    )
    return { success: true, bookingId, status }
  }

  if (status !== 'pending_payment') {
    console.error(
      '[claimWaitlistSpot] unexpected status from claim_waitlist_spot:',
      status,
    )
    return { success: false, error: 'Unexpected booking state' }
  }

  // Paid event — create Checkout Session. Mirrors createPaidCheckout's
  // Stripe block, but on failure we restore the booking to `waitlisted`
  // rather than cancelling (the user shouldn't lose their waitlist
  // entry because our payment provider hiccuped).
  try {
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

    const admin = createAdminClient()
    const stripeCustomerId = await ensureStripeCustomer(admin, {
      userId: user.id,
      email: profile.email,
      fullName: profile.full_name,
    })

    const origin = await resolveOrigin()
    const successUrl = `${origin}/events/${event.slug}/booking-success?session_id={CHECKOUT_SESSION_ID}`
    // Cancel goes back to the event page with claim=1 so the waitlist
    // user can try again if they want. `cancelled=1` triggers the
    // abandon-pending handler which flips them back to waitlisted.
    const cancelUrl = `${origin}/events/${event.slug}?cancelled=1&from=claim`

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

    const { error: updErr } = await supabase
      .from('bookings')
      .update({ stripe_checkout_session_id: sessionId })
      .eq('id', bookingId)
    if (updErr) {
      console.warn(
        '[claimWaitlistSpot] Failed to store checkout session id:',
        updErr.message,
      )
    }

    return { success: true, bookingId, status, checkoutUrl: url }
  } catch (err) {
    console.error(
      '[claimWaitlistSpot] Stripe flow failed, restoring waitlist entry:',
      err instanceof Error ? err.message : err,
    )
    // Restore to waitlisted so the user keeps their place.
    await supabase
      .from('bookings')
      .update({ status: 'waitlisted' as BookingStatus })
      .eq('id', bookingId)
      .eq('status', 'pending_payment')

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
  options?: { from?: 'book' | 'claim' },
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

  // When the user arrived via a waitlist claim, rolling their
  // pending_payment row back to `cancelled` would lose their waitlist
  // position AND their eligibility for future "spot available" emails.
  // Restore to `waitlisted` instead. For the regular book-flow abandon,
  // keep the original `cancelled` semantics (they made a new booking and
  // decided not to pay).
  const rollbackStatus: BookingStatus =
    options?.from === 'claim' ? 'waitlisted' : 'cancelled'

  const { error } = await supabase
    .from('bookings')
    .update({ status: rollbackStatus })
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
 * Cancellation policy:
 *   - Free events: status → cancelled, no payment touched.
 *   - Paid events, refund_window_hours = 0: status → cancelled, NO
 *     refund (event is non-refundable by configuration).
 *   - Paid events, hoursUntilEvent > refund_window_hours: status →
 *     cancelled, full Stripe refund issued. stripe_refund_id +
 *     refunded_amount_pence recorded.
 *   - Paid events, hoursUntilEvent ≤ refund_window_hours: status →
 *     cancelled, NO refund. `refundEligible: false` in the result so
 *     the UI can show the policy line without sending a second API
 *     call.
 *
 * `refund_window_hours` is per-event (defaults to 48). 0 is the
 * sentinel for "non-refundable".
 *
 * After a successful cancel (any branch), we fire-and-forget a "spot
 * available" email to every remaining waitlisted member. First-to-pay
 * wins — no staggering, no auto-promote.
 *
 * Refund correctness:
 *   - Refund API call happens BEFORE the status UPDATE. A failed refund
 *     aborts the cancellation (user keeps their spot, sees the error,
 *     can retry or contact support).
 *   - Re-running the action after a successful refund is guarded by the
 *     `.eq('status', 'confirmed')` clause: the second UPDATE no-ops
 *     because the row is already cancelled.
 *   - The partial UNIQUE index `ux_bookings_stripe_refund_id` prevents
 *     the same refund id from being recorded on two rows (defence in
 *     depth; not reachable under normal flow).
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

  // Fetch booking: need price_at_booking + stripe_payment_id for the
  // refund decision, plus the usual ownership / status guards.
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select(
      'id, user_id, event_id, status, price_at_booking, stripe_payment_id, refunded_amount_pence',
    )
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !booking) {
    return { success: false, error: 'Booking not found' }
  }

  if (booking.user_id !== user.id) {
    return { success: false, error: 'Unauthorised' }
  }

  if (booking.status !== 'confirmed') {
    return { success: false, error: 'Only confirmed bookings can be cancelled' }
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('date_time, slug, refund_window_hours')
    .eq('id', booking.event_id)
    .single()

  if (eventError || !event) {
    return { success: false, error: 'Event not found' }
  }

  const eventStart = new Date(event.date_time)
  const now = new Date()
  if (eventStart < now) {
    return { success: false, error: 'Cannot cancel a booking for a past event' }
  }

  // Refund decision. Paid event AND outside the per-event refund window
  // AND we have a payment id AND we haven't already refunded
  // (idempotency). refund_window_hours = 0 → non-refundable.
  const hoursUntilEvent =
    (eventStart.getTime() - now.getTime()) / (1000 * 60 * 60)
  const isPaid =
    (booking.price_at_booking ?? 0) > 0 && !!booking.stripe_payment_id
  const refundEligible =
    isPaid &&
    event.refund_window_hours > 0 &&
    hoursUntilEvent > event.refund_window_hours
  const alreadyRefunded = (booking.refunded_amount_pence ?? 0) > 0

  let stripeRefundId: string | null = null
  let refundedPence = 0

  if (refundEligible && !alreadyRefunded) {
    try {
      const stripe = getStripeClient()
      const refund = await stripe.refunds.create(
        {
          payment_intent: booking.stripe_payment_id!,
          // Reason surfaces in the Stripe dashboard — helpful when an
          // admin is auditing refund volumes.
          reason: 'requested_by_customer',
          metadata: {
            booking_id: booking.id,
            user_id: user.id,
          },
        },
        {
          // Idempotency key tied to the booking id — under a tight race
          // (double-click before the first UPDATE lands), a second call
          // with the same key returns the same refund object instead of
          // creating a second one. Stripe keeps idempotency keys for 24h
          // which is well longer than any reasonable cancel retry window.
          idempotencyKey: `refund-booking-${booking.id}`,
        },
      )
      stripeRefundId = refund.id
      refundedPence = booking.price_at_booking
    } catch (err) {
      // Refund failed — abort cancellation so the user keeps their
      // spot. This is the safe failure mode; user can retry or contact
      // support.
      console.error(
        '[cancelBooking] Stripe refund failed:',
        err instanceof Error ? err.message : err,
      )
      return {
        success: false,
        error: 'We couldn\u2019t process the refund. Please try again or email info@the-social-seen.com.',
      }
    }
  }

  // Status UPDATE — optimistic-locked on current status=confirmed so a
  // concurrent duplicate cancellation no-ops. Records cancel audit +
  // refund details together.
  const { data: updated, error: updateError } = await supabase
    .from('bookings')
    .update({
      status: 'cancelled' as BookingStatus,
      cancelled_at: now.toISOString(),
      refunded_amount_pence: refundedPence,
      refunded_at: stripeRefundId ? now.toISOString() : null,
      stripe_refund_id: stripeRefundId,
    })
    .eq('id', bookingId)
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .select('id')
    .single()

  if (updateError || !updated) {
    // Edge case: refund went through but the DB UPDATE failed. The
    // charge is refunded but the booking still shows confirmed. Admin
    // needs to manually reconcile via the stripe_refund_id we got from
    // the API. Log loudly AND emit to Sentry with a filterable tag.
    if (stripeRefundId) {
      console.error(
        '[cancelBooking] Refund issued but DB update failed — manual reconciliation needed:',
        { bookingId, stripeRefundId, updateError: updateError?.message },
      )
      Sentry.captureException(
        new Error('Refund issued but booking UPDATE failed — manual reconciliation needed'),
        {
          tags: { surface: 'refund-reconcile' },
          extra: {
            bookingId,
            stripeRefundId,
            updateError: updateError?.message ?? null,
          },
          level: 'error',
        },
      )
    }
    return { success: false, error: 'Booking was already cancelled or modified' }
  }

  // Post-response: email waitlisters that a spot is available. Uses
  // next/after so the work continues after the HTTP response is sent.
  // Unlike a bare `void promise` this is explicitly supported by the
  // Next.js runtime (including Vercel serverless) — the platform keeps
  // the function alive until the callback settles. Failures inside the
  // helper never surface to the user; they're logged via the send
  // wrapper's audit trail.
  after(() => notifyWaitlistersOfOpenSpot(booking.event_id))

  revalidatePath('/events')
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')
  revalidatePath('/profile')

  return {
    success: true,
    refundedPence,
    refundEligible,
  }
}

/**
 * Email every waitlisted user for this event that a spot has just
 * opened. First-click-wins — see the waitlistSpotAvailableTemplate
 * copy + the claim_waitlist_spot RPC for the race-safe flow.
 *
 * Uses the admin client so the email-send + audit-log paths aren't
 * constrained by the cancelling user's RLS context (we need to query
 * every waitlister's profile).
 */
async function notifyWaitlistersOfOpenSpot(eventId: string): Promise<void> {
  try {
    const admin = createAdminClient()

    const [eventRes, waitlistersRes] = await Promise.all([
      admin
        .from('events')
        .select('title, slug, date_time, price')
        .eq('id', eventId)
        .single(),
      admin
        .from('bookings')
        .select('user_id, profiles:profiles!inner(full_name, email)')
        .eq('event_id', eventId)
        .eq('status', 'waitlisted')
        .is('deleted_at', null),
    ])

    const event = eventRes.data
    if (!event) {
      console.warn(
        '[notifyWaitlistersOfOpenSpot] event not found:',
        eventId,
      )
      return
    }

    type Row = {
      user_id: string
      profiles: { full_name: string | null; email: string | null } | null
    }

    const rows = (waitlistersRes.data ?? []).map((r: unknown) => {
      const row = r as { user_id: string; profiles: unknown }
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      return {
        user_id: row.user_id,
        profiles: profile as Row['profiles'],
      }
    })

    for (const w of rows) {
      const email = w.profiles?.email
      if (!email) continue

      const tpl = waitlistSpotAvailableTemplate({
        fullName: w.profiles?.full_name ?? 'there',
        eventTitle: event.title,
        eventSlug: event.slug,
        eventDate: formatDateFull(event.date_time),
        eventTime: formatTime(event.date_time),
        priceInPence: event.price,
      })

      await sendEmail({
        to: email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        templateName: 'waitlist_spot_available',
        relatedProfileId: w.user_id,
        tags: [
          { name: 'template', value: 'waitlist_spot_available' },
          { name: 'event_id', value: eventId },
        ],
      })
    }
  } catch (err) {
    console.warn(
      '[notifyWaitlistersOfOpenSpot] threw:',
      err instanceof Error ? err.message : err,
    )
  }
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
