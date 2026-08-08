/**
 * Resume-payment flow for a self-service `pending_payment` booking whose
 * original Stripe Checkout Session was abandoned.
 *
 * Two callers, one shared implementation — mirrors `runAdminHoldFlow`'s
 * "one implementation, thin wrappers" shape (src/lib/bookings/admin-hold.ts):
 *   - `resumePendingCheckout` Server Action
 *     (src/app/(member)/bookings/actions.ts) — the "Complete Payment"
 *     button on /bookings.
 *   - `GET /bookings/resume/[bookingId]` Route Handler — the abandoned-
 *     checkout reminder email's CTA link.
 *
 * See SYSTEM-DESIGN-pending-payment-visibility.md §5.1 for the full spec
 * this implements (algorithm steps referenced by number below).
 *
 * Server-only: talks to Stripe and the service-role Supabase client.
 * Never import from a Client Component.
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
import { getStripeClient } from '@/lib/stripe/server'

export interface ResumeCheckoutResult {
  success: boolean
  error?: string
  checkoutUrl?: string
}

// ── Origin resolution ────────────────────────────────────────────────────
//
// Deliberately duplicated (not imported) — this is now the THIRD copy of
// the same ~10-line helper, alongside the private `resolveOrigin` in
// src/app/events/[slug]/actions.ts and `resolveSiteOrigin` in
// src/lib/bookings/admin-hold.ts. Neither existing copy is a good import
// source: the actions.ts copy is private inside a 'use server' file
// (exporting it would turn it into a client-callable Server Action), and
// importing from admin-hold.ts would create a needless coupling between
// two otherwise-independent hold-mechanics modules just to save ten
// lines. This codebase already tolerates this duplication (see
// admin-hold.ts's own doc comment on its copy) — keep all three in sync
// if the origin-resolution strategy ever changes.
async function resolveSiteOrigin(): Promise<string> {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  if (host) return `${proto}://${host}`

  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[resume-checkout] No origin found — set NEXT_PUBLIC_SITE_URL. Stripe return URLs will be broken.',
    )
  }
  return 'http://localhost:3000'
}

// ── Best-effort Stripe session expiry ───────────────────────────────────
//
// Mirrors releaseAdminBookingHold's step 2 (src/lib/bookings/admin-hold.ts):
// non-blocking, logged, never rolled back, escalated to Sentry only if the
// failure looks like "already paid" (a real double-session race, not a
// stale/missing session id). See spec §1.2's "double-session risk"
// discussion for why this only shrinks, not eliminates, that window.
async function bestEffortExpireSession(
  sessionId: string | null | undefined,
  context: { bookingId: string },
): Promise<void> {
  if (!sessionId) return
  try {
    const stripe = getStripeClient()
    await stripe.checkout.sessions.expire(sessionId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isResourceMissing =
      err instanceof Error && (err as { code?: string }).code === 'resource_missing'
    const looksAlreadyPaid =
      !isResourceMissing && /complete|paid|succeeded/i.test(message)

    if (looksAlreadyPaid) {
      Sentry.captureException(err, {
        tags: {
          surface: 'resumePendingBookingCheckout',
          signal: 'possible_race_paid_after_resume',
        },
        extra: { bookingId: context.bookingId, sessionId },
        level: 'error',
      })
    } else {
      console.warn(
        '[resumePendingBookingCheckout] Stripe session expire failed (non-blocking):',
        sessionId,
        message,
      )
    }
  }
}

/**
 * Mint a brand-new Stripe Checkout Session for a self-service
 * `pending_payment` booking, so the member can resume an abandoned
 * checkout. See SYSTEM-DESIGN-pending-payment-visibility.md §1 for why
 * we ALWAYS mint fresh (never hand back a stored/stale session URL).
 *
 * Algorithm (spec §5.1):
 *   1. Fetch the booking via `supabaseUserScoped`.
 *   2. Explicit ownership check — defence in depth on top of RLS.
 *   3. Reject `is_admin_hold` rows (§1.3 — those have their own
 *      admin-managed Stripe link + revert timeline).
 *   4. Reject non-`pending_payment` status.
 *   5. Reject a cancelled/soft-deleted/past event.
 *   6. Best-effort expire the prior session before minting a new one.
 *   7. Lazy-create/reuse the Stripe Customer.
 *   8. Build success/cancel URLs exactly as `createPaidCheckout` does —
 *      no `from=` param (plain self-service resume).
 *   9. Mint the fresh session against the ROW'S OWN price/fee snapshot
 *      (`price_at_booking` / `booking_fee_pence`), not a freshly
 *      recomputed one, so a member who booked before a price change
 *      still pays what they originally agreed to. Default
 *      `expiresInSeconds` (30 min).
 *   10. Optimistic-guarded persist of the new session id — if the row
 *       changed state concurrently (e.g. the reaper's tick landed in the
 *       gap), best-effort expire the just-minted session and report the
 *       booking as gone rather than handing back a checkout URL for a
 *       booking that no longer exists in `pending_payment`.
 *   11. Return `{ success: true, checkoutUrl }`.
 *
 * `supabaseUserScoped` MUST come from the calling user's own session
 * (`createServerClient()` + `auth.getUser()` already resolved) — RLS
 * scopes the initial booking fetch to rows the caller can see, and step
 * 2 adds an explicit ownership check on top as defence in depth (closes
 * the case where an admin's own user-scoped client could otherwise
 * *read* — but must not be allowed to *resume* — someone else's
 * booking through this specific action).
 */
export async function resumePendingBookingCheckout(
  supabaseUserScoped: SupabaseClient,
  userId: string,
  bookingId: string,
): Promise<ResumeCheckoutResult> {
  if (!bookingId) {
    return { success: false, error: 'Booking ID is required' }
  }

  // 1. Fetch the booking via the user-scoped client.
  const { data: booking, error: bookingError } = await supabaseUserScoped
    .from('bookings')
    .select(
      'id, user_id, event_id, status, is_admin_hold, price_at_booking, booking_fee_pence, stripe_checkout_session_id',
    )
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (bookingError || !booking) {
    return { success: false, error: 'Booking not found' }
  }

  // 2. Explicit ownership check — defence in depth on top of RLS.
  if (booking.user_id !== userId) {
    return { success: false, error: 'Unauthorised' }
  }

  // 3. Admin holds are explicitly out of scope (spec §1.3) — they have
  // their own self-contained Stripe link + revert timeline. Giving them
  // a second, independent self-service resume path would let a member
  // race the admin flow.
  if (booking.is_admin_hold === true) {
    return {
      success: false,
      error:
        'This booking is managed by our team — check your email for a payment link, or contact us.',
    }
  }

  // 4. Must still be awaiting payment.
  if (booking.status !== 'pending_payment') {
    return { success: false, error: 'This booking is no longer awaiting payment.' }
  }

  // Admin client from here on — mirrors admin-hold.ts's own pattern of
  // reading the event via the service-role client rather than the
  // caller's RLS-scoped one, so a booking on a currently-unpublished
  // event (shouldn't happen, but not impossible mid-admin-edit) doesn't
  // spuriously fail with "event not found".
  const admin = createAdminClient()

  // 5. Event must still be live and in the future.
  const { data: event, error: eventError } = await admin
    .from('events')
    .select('title, slug, date_time, is_cancelled, deleted_at')
    .eq('id', booking.event_id)
    .single()

  if (eventError || !event || event.deleted_at || event.is_cancelled) {
    return { success: false, error: 'This event has been cancelled.' }
  }
  if (new Date(event.date_time) < new Date()) {
    return { success: false, error: 'This event has already taken place.' }
  }

  // 6. Best-effort expire the prior session before minting a new one —
  // shrinks (doesn't eliminate) the double-session window (spec §1.2).
  await bestEffortExpireSession(booking.stripe_checkout_session_id, { bookingId })

  try {
    // 7. Lazy-create (or reuse) the Stripe Customer.
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('id', userId)
      .single()

    if (profileError || !profile?.email) {
      throw new Error('Missing profile data for checkout')
    }

    const stripeCustomerId = await ensureStripeCustomer(admin, {
      userId,
      email: profile.email,
      fullName: profile.full_name,
    })

    // 8. Success/cancel URLs — same shape as createPaidCheckout. No
    // `from=` param: this is a plain self-service resume, not a claim
    // or admin-hold origin, so abandonPendingCheckout's default 'book'
    // rollback semantics are correct if the member backs out again.
    const siteOrigin = await resolveSiteOrigin()
    const successUrl = `${siteOrigin}/events/${event.slug}/booking-success?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${siteOrigin}/events/${event.slug}?cancelled=1`

    // 9. Mint the fresh session against the row's OWN price/fee
    // snapshot, not a freshly recomputed one. Default expiresInSeconds
    // (30 min) — plain self-service checkout, not an admin hold.
    const { sessionId, url } = await createBookingCheckoutSession({
      bookingId,
      userId,
      userEmail: profile.email,
      eventId: booking.event_id,
      eventTitle: event.title,
      eventSlug: event.slug,
      priceInPence: booking.price_at_booking,
      bookingFeePence: booking.booking_fee_pence,
      successUrl,
      cancelUrl,
      stripeCustomerId,
    })

    // 10. Optimistic guard — the row must STILL be pending_payment at
    // persist time. If zero rows match, the reaper (or a webhook) beat
    // us to it in the gap between step 4's read and here.
    const { data: updated, error: updErr } = await admin
      .from('bookings')
      .update({ stripe_checkout_session_id: sessionId })
      .eq('id', bookingId)
      .eq('status', 'pending_payment')
      .select('id')
      .single()

    if (updErr || !updated) {
      await bestEffortExpireSession(sessionId, { bookingId })
      return {
        success: false,
        error:
          "This booking was just cancelled — check your bookings, or re-book if you'd still like to attend.",
      }
    }

    // 11. Success.
    return { success: true, checkoutUrl: url }
  } catch (err) {
    console.error(
      '[resumePendingBookingCheckout] Stripe flow failed:',
      err instanceof Error ? err.message : err,
    )
    Sentry.captureException(err, {
      tags: { surface: 'resumePendingBookingCheckout' },
      extra: { bookingId, eventId: booking.event_id, userId },
      level: 'error',
    })
    return { success: false, error: 'Could not start checkout. Please try again.' }
  }
}
