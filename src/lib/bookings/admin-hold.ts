/**
 * Admin waitlist-promotion payment-hold mechanism.
 *
 * `createAdminBookingHold()` is the reusable "create a payment-link hold"
 * flow used when an admin promotes a waitlisted booking on a PAID event
 * (`promoteFromWaitlist` in src/app/(admin)/admin/actions.ts). Unlike the
 * old behaviour, this never confirms a paid seat for free — it transitions
 * the booking to `pending_payment` via the admin-gated
 * `admin_promote_waitlist_to_hold` RPC, creates a Stripe Checkout Session,
 * and emails the member a real payment link.
 *
 * See SYSTEM-DESIGN-admin-waitlist-promotion-payment.md for the full
 * design (this file implements §3.2, §3.3, §4.3).
 *
 * Server-only: talks to Stripe, the service-role Supabase client, and
 * sends email. Never import from a Client Component.
 */
import 'server-only'
import { headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createBookingCheckoutSession,
  ensureStripeCustomer,
} from '@/lib/stripe/checkout'
import { calculateBookingFeePence } from '@/lib/utils/booking-fee'
import { formatDateFull, formatDateModal, formatTime } from '@/lib/utils/dates'
import { sendEmail } from '@/lib/email/send'
import { waitlistPromotionTemplate } from '@/lib/email/templates/waitlist-promotion'

// ── Stripe Checkout Session expiry (spec §3.3) ──────────────────────────────
//
// createBookingCheckoutSession() hardcodes a 30-minute expires_at window,
// which is fine for a normal self-service checkout but would silently kill
// an admin-created hold — the whole point of a hold with no deadline
// (Amy/Yasemin, "event is tomorrow, no rush") is defeated if the Stripe
// link itself dies in 30 minutes regardless of any DB-side decision.

/** 5-minute buffer: Stripe's own expires_at is set to close STRICTLY
 * before our DB-side admin_hold_expires_at deadline, not equal to it, so
 * a payment can never complete in the gap between "our deadline passes"
 * and "the revert-cron tick actually runs" — see §3.3 / §6.4. */
const STRIPE_EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000 // 5 minutes
const MIN_STRIPE_EXPIRY_SECONDS = 30 * 60 // Stripe's own floor
const MAX_STRIPE_EXPIRY_SECONDS = 24 * 60 * 60 // Stripe's own ceiling

/**
 * Derive the Stripe Checkout Session `expires_at` window (in seconds from
 * now) from the DB-side hold deadline.
 *
 * `holdExpiresAt === null` (no automated revert — Amy/Yasemin today, or
 * any future promotion too close to the event for a 4h window) gets
 * Stripe's most generous option: 24 hours.
 *
 * Otherwise the window ends 5 minutes before `holdExpiresAt`, clamped to
 * Stripe's [30min, 24h] allowed range.
 */
export function computeStripeExpirySeconds(holdExpiresAt: Date | null): number {
  if (holdExpiresAt === null) {
    return MAX_STRIPE_EXPIRY_SECONDS
  }
  const rawSeconds = Math.floor(
    (holdExpiresAt.getTime() - STRIPE_EXPIRY_SAFETY_MARGIN_MS - Date.now()) / 1000,
  )
  return Math.min(
    Math.max(rawSeconds, MIN_STRIPE_EXPIRY_SECONDS),
    MAX_STRIPE_EXPIRY_SECONDS,
  )
}

// ── Auto-revert deadline formula (spec §4.3) ────────────────────────────────
//
// NOT YET WIRED UP to any caller in this pass — promoteFromWaitlist
// hardcodes holdExpiresAt: null until the revert-expired-admin-holds cron
// (migration 20260713000003, spec §6/§8.2) exists to act on a non-null
// deadline. Exported now so the systemic-slice PR is a one-line change
// (swap `null` for `computeHoldExpiresAt(event.date_time)`) rather than
// needing this formula written from scratch later.

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

/**
 * Should a promotion get an automated 4-hour revert deadline, or should a
 * human manage it with no deadline at all?
 *
 * Returns `null` (no automated revert) when the event starts too soon for
 * a 4-hour window plus the Stripe safety margin to make sense — the exact
 * same branch Amy's and Yasemin's "event is tomorrow" case falls into,
 * without needing to special-case them once this is wired up.
 */
export function computeHoldExpiresAt(eventDateTime: Date | string): Date | null {
  const eventDate =
    typeof eventDateTime === 'string' ? new Date(eventDateTime) : eventDateTime
  const msUntilEvent = eventDate.getTime() - Date.now()

  if (msUntilEvent > FOUR_HOURS_MS + STRIPE_EXPIRY_SAFETY_MARGIN_MS) {
    return new Date(Date.now() + FOUR_HOURS_MS)
  }
  return null
}

// ── Origin resolution ────────────────────────────────────────────────────
//
// Deliberately duplicated (not imported) from the private `resolveOrigin`
// helper in src/app/events/[slug]/actions.ts: that file has 'use server'
// at the top, where every export becomes a client-callable Server Action,
// so widening its export surface just to share ~10 lines isn't worth it.
// Keep this in sync with that copy if the origin-resolution strategy ever
// changes.
async function resolveOrigin(): Promise<string> {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  if (host) return `${proto}://${host}`

  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[createAdminBookingHold] No origin found — set NEXT_PUBLIC_SITE_URL. Stripe return URLs will be broken.',
    )
  }
  return 'http://localhost:3000'
}

// ── createAdminBookingHold ───────────────────────────────────────────────

export interface CreateAdminBookingHoldResult {
  success: boolean
  error?: string
  status?: 'pending_payment'
  checkoutUrl?: string
  /** ISO, echoed back for the caller's toast/email copy. */
  holdExpiresAt?: string | null
}

/**
 * Promote a waitlisted booking on a PAID event to a `pending_payment`
 * seat hold, and send the member a real Stripe Checkout link.
 *
 * Algorithm (spec §3.2):
 *   1. Fetch the booking (event_id, user_id).
 *   2. Fetch the event. Defensively reject free events (should be
 *      unreachable — the caller branches before ever calling this).
 *   3. Compute the booking fee (single source of truth).
 *   4. Call admin_promote_waitlist_to_hold via the user-scoped client —
 *      auth.uid() must resolve to the calling admin inside the RPC.
 *   5. Unwrap the RPC's own jsonb error shape.
 *   6-9. Stripe customer + Checkout Session + persistence + email, all
 *      inside one try/catch so ANY failure here (missing profile, Stripe
 *      API error) hits the SAME rollback path — mirrors
 *      createPaidCheckout / claimWaitlistSpot's own try/catch shape.
 *   10. On failure: roll back to `waitlisted` AND clear is_admin_hold /
 *      admin_hold_expires_at in the SAME UPDATE. This is the one place
 *      copying the existing claimWaitlistSpot rollback verbatim would be
 *      wrong — that rollback only has `status` to worry about; this one
 *      also carries the two new hold columns, and forgetting them here
 *      would reproduce the staleness trap the CHECK constraint
 *      (chk_bookings_admin_hold_requires_pending_payment) exists to
 *      prevent, on the very first error path anyone hits.
 *
 * `supabaseUserScoped` MUST come from requireAdmin() (carries the admin's
 * own JWT) — NOT the service-role admin client — because the RPC's
 * in-body admin-role check depends on auth.uid() resolving to the caller.
 */
export async function createAdminBookingHold(
  supabaseUserScoped: SupabaseClient,
  bookingId: string,
  options: { holdExpiresAt: Date | null },
): Promise<CreateAdminBookingHoldResult> {
  const admin = createAdminClient()

  // 1. Fetch the booking.
  const { data: booking, error: bookingError } = await admin
    .from('bookings')
    .select('id, event_id, user_id')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (bookingError || !booking) {
    return { success: false, error: 'Booking not found' }
  }

  // 2. Fetch the event.
  const { data: event, error: eventError } = await admin
    .from('events')
    .select('price, slug, title, date_time, venue_name, venue_address, venue_revealed')
    .eq('id', booking.event_id)
    .is('deleted_at', null)
    .single()

  if (eventError || !event) {
    return { success: false, error: 'Event not found' }
  }

  // Defensive — should be unreachable. promoteFromWaitlist branches on
  // event.price BEFORE ever calling this helper, and the RPC itself also
  // rejects free events. Belt-and-braces so a future misuse fails loud
  // and early instead of creating an unpayable hold.
  if (event.price === 0) {
    return {
      success: false,
      error: 'Free events should be confirmed directly, not held',
    }
  }

  // 3. Booking fee — single source of truth, same formula every paid
  // booking path uses.
  const bookingFeePence = calculateBookingFeePence(event.price)

  // 4. Transition waitlisted → pending_payment via the admin-gated RPC.
  const { data: rpcData, error: rpcError } = await supabaseUserScoped.rpc(
    'admin_promote_waitlist_to_hold',
    {
      p_booking_id: bookingId,
      p_booking_fee_pence: bookingFeePence,
      p_hold_expires_at: options.holdExpiresAt?.toISOString() ?? null,
    },
  )

  if (rpcError) {
    console.error('[createAdminBookingHold] RPC error:', rpcError.message)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  // 5. RPC returns jsonb — check for its own error key.
  const rpcResult = rpcData as Record<string, unknown>
  if (rpcResult.error) {
    return { success: false, error: rpcResult.error as string }
  }

  const holdExpiresAtIso = options.holdExpiresAt?.toISOString() ?? null

  try {
    // 6. Fetch the profile for the Stripe Customer + email.
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('id', booking.user_id)
      .single()

    if (profileError || !profile?.email) {
      throw new Error('Missing profile data for checkout')
    }

    // 7. Lazy-create (or reuse) the Stripe Customer.
    const stripeCustomerId = await ensureStripeCustomer(admin, {
      userId: booking.user_id,
      email: profile.email,
      fullName: profile.full_name,
    })

    // 8. Checkout Session. cancel_url carries &from=admin_hold so
    // abandonPendingCheckout (events/[slug]/actions.ts) restores the
    // booking to `waitlisted` — not `cancelled` — if the member clicks
    // "← Back" out of Stripe. expiresInSeconds is derived from the
    // DB-side deadline so the Stripe-side cutoff always lands 5 minutes
    // before the revert-cron would ever consider reverting the row
    // (§3.3, §6.4).
    const origin = await resolveOrigin()
    const successUrl = `${origin}/events/${event.slug}/booking-success?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${origin}/events/${event.slug}?cancelled=1&from=admin_hold`
    const expiresInSeconds = computeStripeExpirySeconds(options.holdExpiresAt)

    const { sessionId, url } = await createBookingCheckoutSession({
      bookingId,
      userId: booking.user_id,
      userEmail: profile.email,
      eventId: booking.event_id,
      eventTitle: event.title,
      eventSlug: event.slug,
      priceInPence: event.price,
      bookingFeePence,
      successUrl,
      cancelUrl,
      stripeCustomerId,
      expiresInSeconds,
    })

    // 9a. Persist the session id — non-critical, log-and-continue (same
    // pattern as createPaidCheckout / claimWaitlistSpot).
    const { error: updErr } = await admin
      .from('bookings')
      .update({ stripe_checkout_session_id: sessionId })
      .eq('id', bookingId)
    if (updErr) {
      console.warn(
        '[createAdminBookingHold] Failed to store checkout session id:',
        updErr.message,
      )
    }

    // 9b. Email the member their payment link. Self-contained try/catch —
    // the hold + Checkout Session already exist at this point; a failure
    // to send the email must NOT roll either back (project rule: email
    // sends are non-blocking and must never break the triggering action).
    try {
      const tpl = waitlistPromotionTemplate({
        fullName: profile.full_name?.trim() || 'there',
        eventTitle: event.title,
        eventSlug: event.slug,
        eventDate: formatDateFull(event.date_time),
        eventTime: formatTime(event.date_time),
        priceInPence: event.price,
        bookingFeePence,
        checkoutUrl: url,
        holdExpiresAt: holdExpiresAtIso ? formatDateModal(holdExpiresAtIso) : null,
      })

      const emailResult = await sendEmail({
        to: profile.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        templateName: 'waitlist_promotion',
        relatedProfileId: booking.user_id,
        recipientUserId: booking.user_id,
        recipientEventId: booking.event_id,
        notificationType: 'waitlist',
        tags: [
          { name: 'template', value: 'waitlist_promotion' },
          { name: 'event_id', value: booking.event_id },
        ],
      })
      if (!emailResult.success) {
        console.warn(
          '[createAdminBookingHold] promotion email failed:',
          emailResult.error,
        )
      }
    } catch (emailErr) {
      console.warn(
        '[createAdminBookingHold] promotion email threw:',
        emailErr instanceof Error ? emailErr.message : emailErr,
      )
    }

    // 9c. Success.
    return {
      success: true,
      status: 'pending_payment',
      checkoutUrl: url,
      holdExpiresAt: holdExpiresAtIso,
    }
  } catch (err) {
    // 10. Stripe failure (or missing profile) — roll back to waitlisted
    // AND clear the two hold columns in the SAME UPDATE, or the row
    // would violate chk_bookings_admin_hold_requires_pending_payment the
    // instant status leaves pending_payment.
    console.error(
      '[createAdminBookingHold] Stripe flow failed, restoring waitlist entry:',
      err instanceof Error ? err.message : err,
    )
    Sentry.captureException(err, {
      tags: { surface: 'createAdminBookingHold' },
      extra: { bookingId, eventId: booking.event_id, userId: booking.user_id },
      level: 'error',
    })

    await admin
      .from('bookings')
      .update({
        status: 'waitlisted',
        is_admin_hold: false,
        admin_hold_expires_at: null,
      })
      .eq('id', bookingId)
      .eq('status', 'pending_payment') // optimistic guard

    return {
      success: false,
      error: 'Could not start checkout. Please try again.',
    }
  }
}
