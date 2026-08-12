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
import { calculateBookingFeePence } from '@/lib/utils/booking-fee'
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
  /**
   * Machine-readable discriminator for the `'Already booked for this
   * event'` error branch of `createPaidCheckout` (SYSTEM-DESIGN-paid-
   * checkout-confusion-fix.md §2). Lets the client distinguish "you have
   * an in-flight pending_payment checkout for this event" (recoverable —
   * offer Resume/Start Over) from "you're already confirmed" (defensive,
   * success framing) instead of rendering every conflict identically.
   * Populated ONLY on the already-booked error path — never on success,
   * never on any other error. Absent (`undefined`) is a safe fallback to
   * today's plain generic-error rendering.
   */
  errorCode?:
    | 'already_booked_pending'
    | 'already_booked_confirmed'
    | 'already_booked_waitlisted'
    | 'already_booked_other'
  /** Populated only alongside errorCode: 'already_booked_pending'. */
  existingBookingId?: string
  /**
   * ISO timestamp of the conflicting pending_payment booking's
   * `created_at`. Lets the client render a real "complete payment by
   * {time}" deadline (via getPendingPaymentDeadline) instead of omitting
   * the line. Populated only alongside errorCode: 'already_booked_pending'.
   */
  existingBookingCreatedAt?: string
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

  // Read the event BEFORE calling the RPC — we need event.price to
  // compute the booking fee, which the RPC persists alongside the row.
  // The architect's spec §3.5 calls out this read-then-RPC ordering
  // explicitly (was previously read inside the Stripe block).
  const { data: eventForFee, error: eventForFeeError } = await supabase
    .from('events')
    .select('title, slug, price')
    .eq('id', eventId)
    .single()

  if (eventForFeeError || !eventForFee) {
    return { success: false, error: 'Event not found' }
  }

  const bookingFeePence = calculateBookingFeePence(eventForFee.price)

  // Race-safe paid booking. Inserts pending_payment or waitlisted, with
  // the fee snapshot stamped on the row.
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'book_event_paid',
    {
      p_user_id: user.id,
      p_event_id: eventId,
      p_booking_fee_pence: bookingFeePence,
    },
  )

  if (rpcError) {
    console.error('[createPaidCheckout] RPC error:', rpcError.message)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  const result = rpcData as Record<string, unknown>
  if (result.error) {
    const errorMessage = result.error as string

    // SYSTEM-DESIGN-paid-checkout-confusion-fix.md §2: on the "already
    // booked" guard specifically, look up the caller's OWN conflicting
    // row (already visible under bookings_select's `user_id = auth.uid()`
    // RLS — no new grant needed) so the client can distinguish a
    // recoverable in-flight pending_payment checkout from an already-
    // confirmed booking, instead of rendering every conflict identically
    // (the exact contradiction this fix exists to close). Error-path
    // only — never runs on the happy path.
    if (errorMessage === 'Already booked for this event') {
      const { data: existing } = await supabase
        .from('bookings')
        .select('id, status, created_at')
        .eq('user_id', user.id)
        .eq('event_id', eventId)
        .neq('status', 'cancelled')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing?.status === 'pending_payment') {
        return {
          success: false,
          error: errorMessage,
          errorCode: 'already_booked_pending',
          existingBookingId: existing.id,
          existingBookingCreatedAt: existing.created_at,
        }
      }
      if (existing?.status === 'confirmed') {
        return { success: false, error: errorMessage, errorCode: 'already_booked_confirmed' }
      }
      if (existing?.status === 'waitlisted') {
        return { success: false, error: errorMessage, errorCode: 'already_booked_waitlisted' }
      }
      // TOCTOU fallback (row resolved/reaped between the RPC call and
      // this SELECT, or an unexpected status) — safe regressive
      // fallback, no errorCode. UI falls back to the existing generic
      // ErrorAlert path unchanged.
    }

    return { success: false, error: errorMessage }
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
    // Fetch profile for Stripe Customer (event already fetched above
    // for the fee computation; reuse).
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.email) {
      throw new Error('Missing profile data for checkout')
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
    const successUrl = `${origin}/events/${eventForFee.slug}/booking-success?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${origin}/events/${eventForFee.slug}?cancelled=1`

    const { sessionId, url } = await createBookingCheckoutSession({
      bookingId,
      userId: user.id,
      userEmail: profile.email,
      eventId,
      eventTitle: eventForFee.title,
      eventSlug: eventForFee.slug,
      priceInPence: eventForFee.price,
      bookingFeePence,
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
    // Roll back via the same SECURITY DEFINER RPC abandonPendingCheckout
    // uses — this booking is a fresh pending_payment row just inserted by
    // book_event_paid (is_admin_hold=false, waitlist_position=NULL), which
    // is exactly abandon_pending_checkout's "fresh self-service book" ->
    // 'cancelled' branch. See docs/SYSTEM-DESIGN-bookings-write-
    // authorization-hardening.md §3.1 — this is a direct-write hardening
    // fix, not a behavioural change (same rollback outcome as before).
    const { error: rollbackError } = await supabase.rpc(
      'abandon_pending_checkout',
      { p_user_id: user.id, p_event_id: eventId },
    )
    if (rollbackError) {
      console.error(
        '[createPaidCheckout] rollback RPC error:',
        rollbackError.message,
      )
    }

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

  // Read the event BEFORE calling the RPC — we need event.price to
  // compute the booking fee, which the RPC persists onto the row when
  // transitioning waitlisted → pending_payment. Same pattern as
  // createPaidCheckout. Free events get a fee of 0.
  const { data: eventForFee, error: eventForFeeError } = await supabase
    .from('events')
    .select('title, slug, price')
    .eq('id', eventId)
    .single()

  if (eventForFeeError || !eventForFee) {
    return { success: false, error: 'Event not found' }
  }

  const bookingFeePence = calculateBookingFeePence(eventForFee.price)

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'claim_waitlist_spot',
    {
      p_user_id: user.id,
      p_event_id: eventId,
      p_booking_fee_pence: bookingFeePence,
    },
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
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.email) {
      throw new Error('Missing profile data for checkout')
    }

    const admin = createAdminClient()
    const stripeCustomerId = await ensureStripeCustomer(admin, {
      userId: user.id,
      email: profile.email,
      fullName: profile.full_name,
    })

    const origin = await resolveOrigin()
    const successUrl = `${origin}/events/${eventForFee.slug}/booking-success?session_id={CHECKOUT_SESSION_ID}`
    // Cancel goes back to the event page with claim=1 so the waitlist
    // user can try again if they want. `cancelled=1` triggers the
    // abandon-pending handler which flips them back to waitlisted.
    const cancelUrl = `${origin}/events/${eventForFee.slug}?cancelled=1&from=claim`

    const { sessionId, url } = await createBookingCheckoutSession({
      bookingId,
      userId: user.id,
      userEmail: profile.email,
      eventId,
      eventTitle: eventForFee.title,
      eventSlug: eventForFee.slug,
      priceInPence: eventForFee.price,
      bookingFeePence,
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
    // Restore to waitlisted via the same abandon_pending_checkout RPC —
    // this booking was just transitioned waitlisted -> pending_payment by
    // claim_waitlist_spot, which leaves waitlist_position untouched, so
    // this is exactly abandon_pending_checkout's "self-service claim" ->
    // 'waitlisted' branch. See design doc §3.1.
    const { error: rollbackError } = await supabase.rpc(
      'abandon_pending_checkout',
      { p_user_id: user.id, p_event_id: eventId },
    )
    if (rollbackError) {
      console.error(
        '[claimWaitlistSpot] rollback RPC error:',
        rollbackError.message,
      )
    }

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
 * Idempotent: the `abandon_pending_checkout` RPC re-selects the row on
 * every call under a row lock (`FOR UPDATE`) and its own UPDATE carries
 * a `status = 'pending_payment'` guard, so a repeat call (user refreshes)
 * no-ops and returns `{ booking_id: null, status: null }`.
 *
 * ── SECURITY: never trust `options.from` for the rollback decision ──────
 *
 * This function used to pick `rollbackStatus` directly from the caller-
 * supplied `options.from` string. `options.from` is set by
 * BookingCancelledHandler.tsx from the `?from=` URL query parameter —
 * pure client input, with zero server-side corroboration. That was a
 * live P0 vulnerability: any authenticated member with an ordinary
 * self-created `pending_payment` booking (from clicking "Continue to
 * Payment" on ANY paid event) could navigate to
 * `/events/<slug>?cancelled=1&from=admin_remediation` and this function
 * would UPDATE their own row straight to `status='confirmed'` — a real
 * confirmed ticket, `stripe_payment_id` still null, no payment ever
 * made. `from=admin_hold`/`from=claim` similarly let anyone jump their
 * own cancelled booking to the front of a waitlist for free.
 *
 * The fix (and where the logic now lives): the rollback status is
 * derived ENTIRELY from server-side, tamper-proof columns already on
 * the booking row — `is_admin_hold` / `cancelled_at` / `waitlist_position`
 * — inside the `abandon_pending_checkout` SECURITY DEFINER RPC (see
 * `supabase/migrations/20260812180000_abandon_pending_checkout_rpc.sql`
 * and `docs/SYSTEM-DESIGN-abandon-checkout-rpc.md` §2.1 for the full
 * derivation table, ported 1:1 from this function's original TS
 * implementation). Moving the lookup + branch + write into one
 * SECURITY-DEFINER, `FOR UPDATE`-locked transaction also (a) closes the
 * SELECT-then-UPDATE race the code review flagged as a secondary,
 * non-blocking finding, and (b) sidesteps
 * `20260812171530_revoke_bookings_admin_hold_column_write.sql`'s
 * column-level REVOKE on `is_admin_hold`/`admin_hold_expires_at` for
 * `authenticated`/`anon` — a REVOKE that would otherwise reject this
 * function's own admin-hold-clearing UPDATE were it still issued via the
 * user-scoped client, since SECURITY DEFINER functions execute as their
 * owner, not as the calling role.
 *
 * `options.from` is kept ONLY as a post-response diagnostics hint —
 * compared against the RPC's REAL returned status and logged via
 * `console.warn` on mismatch. It is NEVER sent to the RPC and NEVER
 * used to choose the rollback outcome or the response the caller sees.
 *
 * Do NOT reintroduce a shortcut that branches on `options.from` (or any
 * other request/query-string value) here or inside the RPC. If a future
 * admin flow needs a new rollback destination, give the booking row its
 * own durable, server-written marker (mirroring `is_admin_hold` /
 * `cancelled_at` / `waitlist_position`) and branch on THAT, server-side.
 */
export async function abandonPendingCheckout(
  eventId: string,
  options?: {
    from?: 'book' | 'claim' | 'admin_hold' | 'admin_remediation' | 'admin_reinstate'
  },
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

  // All lookup + branch + write logic now lives server-side inside the
  // RPC (SECURITY DEFINER, row-locked). `p_user_id` is still passed
  // explicitly and re-checked against `auth.uid()` inside the function —
  // defence in depth, matching every sibling RPC in this file
  // (book_event_paid, claim_waitlist_spot).
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'abandon_pending_checkout',
    {
      p_user_id: user.id,
      p_event_id: eventId,
    },
  )

  if (rpcError) {
    console.error('[abandonPendingCheckout] RPC error:', rpcError.message)
    return { success: false, error: 'Could not release the booking' }
  }

  const result = rpcData as { error?: string; booking_id?: string | null; status?: BookingStatus | null }

  if (result.error) {
    return { success: false, error: result.error }
  }

  revalidatePath(`/events`)
  revalidatePath('/bookings')

  // Idempotent no-op — already resolved (paid, previously abandoned, or
  // never existed). Preserves the pre-existing shape for this branch: no
  // `status` key. BookingCancelledHandler falls through to its default
  // toast copy either way.
  if (!result.status) {
    return { success: true }
  }

  // Diagnostics only — compared against the RPC's REAL, server-derived
  // outcome, never fed back into any decision. Logged so a mismatch
  // (client claims one origin, server derives another) is visible
  // without being trusted.
  if (options?.from && result.status !== inferredStatusForFromHint(options.from)) {
    console.warn(
      '[abandonPendingCheckout] client-supplied "from" hint did not match server-derived rollback',
      {
        from: options.from,
        derivedRollbackStatus: result.status,
        bookingId: result.booking_id,
      },
    )
  }

  // Echo the REAL outcome back to the caller — BookingCancelledHandler
  // uses this (not the URL's `from` param) to pick toast copy, so the
  // toast can never contradict the database state.
  return { success: true, status: result.status }
}

/**
 * Diagnostics helper only (see the security comment on
 * abandonPendingCheckout above) — maps the client-supplied `from` hint to
 * the rollback status it WOULD imply if it were trusted, purely so a
 * mismatch can be logged. Never used to make the actual rollback
 * decision.
 */
function inferredStatusForFromHint(
  from: NonNullable<Parameters<typeof abandonPendingCheckout>[1]>['from'],
): BookingStatus {
  switch (from) {
    case 'admin_remediation':
      return 'confirmed'
    case 'admin_reinstate':
      return 'cancelled'
    case 'claim':
    case 'admin_hold':
      return 'waitlisted'
    case 'book':
    default:
      return 'cancelled'
  }
}

// ── cancelBooking ────────────────���──────────────────────────────────────────

/**
 * Cancellation policy:
 *   - Free events: status → cancelled, no payment touched.
 *   - Paid events, refund_window_hours = 0: status → cancelled, NO
 *     refund (event is non-refundable by configuration).
 *   - Paid events, hoursUntilEvent > refund_window_hours: status →
 *     cancelled, PARTIAL Stripe refund of price_at_booking ONLY.
 *     The booking_fee_pence is NOT refunded — it covers Stripe's
 *     processing cost on the original charge. stripe_refund_id +
 *     refunded_amount_pence (= price_at_booking) recorded.
 *   - Paid events, hoursUntilEvent ≤ refund_window_hours: status →
 *     cancelled, NO refund. `refundEligible: false` in the result so
 *     the UI can show the policy line without sending a second API
 *     call.
 *
 * `refund_window_hours` is per-event (defaults to 48). 0 is the
 * sentinel for "non-refundable".
 *
 * The booking_fee_pence is non-refundable on USER-initiated cancellation
 * — see SYSTEM-DESIGN-refund-fee-deduction.md. On ADMIN-initiated event
 * cancellation (cancelEventAndRefundBookings) the platform refunds the
 * full price_at_booking + booking_fee_pence; that's a different code
 * path (admin/actions.ts).
 *
 * After a successful cancel (any branch), we fire-and-forget a "spot
 * available" email to every remaining waitlisted member. First-to-pay
 * wins — no staggering, no auto-promote.
 *
 * Refund correctness:
 *   - The refund API call passes an explicit `amount: price_at_booking`
 *     so Stripe issues a PARTIAL refund. Without this, Stripe would
 *     refund the full charge (price + fee) and the platform would lose
 *     the fee — that's the bug this whole feature fixes.
 *   - Refund API call happens BEFORE the status UPDATE. A failed refund
 *     aborts the cancellation (user keeps their spot, sees the error,
 *     can retry or contact support).
 *   - Re-running the action after a successful refund is guarded by the
 *     `.eq('status', 'confirmed')` clause: the second UPDATE no-ops
 *     because the row is already cancelled.
 *   - The partial UNIQUE index `ux_bookings_stripe_refund_id` prevents
 *     the same refund id from being recorded on two rows (defence in
 *     depth; not reachable under normal flow).
 *   - Stripe's idempotency-key semantics: the key (refund-booking-{id})
 *     is unchanged. A second call with the same key returns the SAME
 *     refund object regardless of the new `amount` arg, so a tight
 *     double-click still hits the same partial refund.
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
          // Refund only the ticket price. The booking fee is
          // non-refundable on user-initiated cancellations — it covers
          // Stripe's processing cost on the original charge. WITHOUT
          // this `amount` arg, Stripe would issue a FULL refund of the
          // original charge (price + fee), defeating the whole
          // refund-fee-deduction policy. See
          // SYSTEM-DESIGN-refund-fee-deduction.md §6.
          amount: booking.price_at_booking,
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

  // Final atomic write — moved into the cancel_confirmed_booking SECURITY
  // DEFINER RPC (see docs/SYSTEM-DESIGN-bookings-write-authorization-
  // hardening.md §3.2) so a member can no longer forge `status` /
  // `refunded_amount_pence` etc. via a direct PATCH to the REST API.
  // Everything above (ownership check, event fetch, refund-window math,
  // the Stripe refund call) is unchanged — only this last write moved
  // server-side.
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'cancel_confirmed_booking',
    {
      p_user_id: user.id,
      p_booking_id: bookingId,
      p_refunded_amount_pence: refundedPence,
      p_stripe_refund_id: stripeRefundId,
    },
  )
  const result = rpcData as { error?: string; booking_id?: string } | null

  if (rpcError || !result || result.error) {
    // Edge case: refund went through but the DB update failed. The
    // charge is refunded but the booking still shows confirmed. Admin
    // needs to manually reconcile via the stripe_refund_id we got from
    // the API. Log loudly AND emit to Sentry with a filterable tag.
    if (stripeRefundId) {
      console.error(
        '[cancelBooking] Refund issued but DB update failed — manual reconciliation needed:',
        { bookingId, stripeRefundId, rpcError: rpcError?.message, resultError: result?.error },
      )
      Sentry.captureException(
        new Error('Refund issued but booking UPDATE failed — manual reconciliation needed'),
        {
          tags: { surface: 'refund-reconcile' },
          extra: {
            bookingId,
            stripeRefundId,
            rpcError: rpcError?.message ?? null,
            resultError: result?.error ?? null,
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

  // Cancel the waitlisted booking + recompute positions — both now live
  // inside the leave_waitlist SECURITY DEFINER RPC (one atomic
  // transaction instead of two separate round trips) so a member can no
  // longer forge `status`/`waitlist_position` via a direct PATCH to the
  // REST API. See docs/SYSTEM-DESIGN-bookings-write-authorization-
  // hardening.md §3.3.
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'leave_waitlist',
    { p_user_id: user.id, p_booking_id: bookingId },
  )
  const result = rpcData as { error?: string; booking_id?: string } | null

  if (rpcError || !result || result.error) {
    return { success: false, error: 'Booking was already cancelled or modified' }
  }

  revalidatePath('/events')
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')
  revalidatePath('/profile')

  return { success: true }
}
