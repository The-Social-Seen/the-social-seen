/**
 * Admin waitlist-promotion / payment-remediation hold mechanism.
 *
 * Three public entry points, all built on the same internal
 * `runAdminHoldFlow()`:
 *
 *   - `createAdminBookingHold()` — promote a WAITLISTED booking on a PAID
 *     event (`promoteFromWaitlist` in
 *     src/app/(admin)/admin/actions.ts). Original feature — see
 *     SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §3.2, §3.3, §4.3.
 *   - `createAdminPaymentRemediationHold()` — remediate a CONFIRMED
 *     booking on a paid event that was never actually charged
 *     (`sendPaymentLinkForConfirmedBooking`, same file). Gap A in the
 *     same doc's "Addendum (2026-07-13, same day)" §A.
 *   - `releaseAdminBookingHold()` — manually revert an active
 *     `pending_payment` hold (of EITHER origin above) back to
 *     `waitlisted` (`demoteAdminHold`, same file). Gap B in the
 *     addendum, §B.
 *
 * Both hold-creation flows never confirm a paid seat for free — they
 * transition the booking to `pending_payment` via an admin-gated RPC,
 * create a Stripe Checkout Session, and email the member a real payment
 * link. The RPC, the rollback destination on failure, and the email
 * template differ by origin; see `ADMIN_HOLD_ORIGINS` below — that
 * lookup table (not two near-duplicate functions) is what makes mixing
 * up the two origins' rollback destinations structurally impossible
 * rather than merely "commented against" (Addendum §A.4).
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
import { getStripeClient } from '@/lib/stripe/server'
import { calculateBookingFeePence } from '@/lib/utils/booking-fee'
import { formatDateFull, formatDateModal, formatTime } from '@/lib/utils/dates'
import { sendEmail } from '@/lib/email/send'
import { waitlistPromotionTemplate } from '@/lib/email/templates/waitlist-promotion'
import { confirmedUnpaidPaymentLinkTemplate } from '@/lib/email/templates/confirmed-unpaid-payment-link'
import type { RenderedTemplate } from '@/lib/email/templates/welcome'

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
// NOT YET WIRED UP to any caller in this pass — promoteFromWaitlist and
// sendPaymentLinkForConfirmedBooking both hardcode holdExpiresAt: null
// until the revert-expired-admin-holds cron (migration 20260713000003,
// spec §6/§8.2) exists to act on a non-null deadline. Exported now so the
// systemic-slice PR is a one-line change per caller (swap `null` for
// `computeHoldExpiresAt(event.date_time)`) rather than needing this
// formula written from scratch later. See Addendum §A.3 for why Gap A
// deliberately stays symmetric with the waitlist-promotion path here.

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
async function resolveSiteOrigin(): Promise<string> {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  if (host) return `${proto}://${host}`

  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[admin-hold] No origin found — set NEXT_PUBLIC_SITE_URL. Stripe return URLs will be broken.',
    )
  }
  return 'http://localhost:3000'
}

// ── Origin config (Addendum §A.4) ───────────────────────────────────────────
//
// The two admin-hold flows (waitlist promotion, confirmed-booking payment
// remediation) share every step except: which RPC transitions the row,
// where to roll back to if Stripe/profile lookup fails AFTER the RPC has
// already committed, and which email template to send. Expressing those
// differences as one lookup table — instead of two near-duplicate
// functions — means a future edit to one origin's rollback destination
// can't accidentally leak into the other by copy-paste.

type AdminHoldOrigin = 'waitlist_promotion' | 'payment_remediation'

/** Fields every hold-notification email needs, regardless of origin.
 *  Deliberately NOT imported from waitlist-promotion.ts (whose
 *  `WaitlistPromotionInput` name is specific to that origin) — kept
 *  local here so the already-shipped, tested waitlist-promotion.ts file
 *  requires zero changes. Both waitlistPromotionTemplate's existing
 *  input type and confirmedUnpaidPaymentLinkTemplate's input type are
 *  structurally identical to this, so TypeScript accepts either as
 *  `renderEmail` below without any explicit coupling. */
interface AdminHoldEmailContext {
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string
  eventTime: string
  priceInPence: number
  bookingFeePence: number
  checkoutUrl: string
  holdExpiresAt: string | null
}

interface AdminHoldOriginConfig {
  rpcName: 'admin_promote_waitlist_to_hold' | 'admin_hold_confirmed_booking_for_payment'
  /** Where to roll back to if Stripe/profile lookup fails AFTER the RPC
   *  already committed the transition. THE field this whole refactor
   *  exists to make foolproof. */
  rollbackStatus: 'waitlisted' | 'confirmed'
  templateName: string
  notificationType: 'waitlist' | 'reminder'
  renderEmail: (input: AdminHoldEmailContext) => RenderedTemplate
  /** Distinguishes the two origins in console.* log prefixes and the
   *  Sentry `tags.surface` value on the Stripe-failure rollback path.
   *  Not part of the illustrative interface in the spec, but required
   *  to satisfy the hard constraint that createAdminBookingHold's
   *  existing observable behaviour (admin-hold.test.ts's INVARIANT
   *  assertion on `tags: { surface: 'createAdminBookingHold' }`) is
   *  preserved byte-for-byte after this refactor. */
  logLabel: 'createAdminBookingHold' | 'createAdminPaymentRemediationHold'
  /** The `from` value on the Stripe cancel_url (step 8 below), so
   *  abandonPendingCheckout (events/[slug]/actions.ts) can tell the two
   *  origins apart if the member clicks "← Back" mid-checkout and roll
   *  back to the correct status. Must stay in lockstep with
   *  `rollbackStatus` above — waitlist_promotion's Stripe-side "← Back"
   *  and its own Stripe-*failure* rollback both land on 'waitlisted';
   *  payment_remediation's both land on 'confirmed'. Restoring a
   *  payment_remediation hold to 'waitlisted' on "← Back" would silently
   *  recreate the original confirmed-without-payment bug in a different
   *  shape (this booking was never waitlisted this cycle) — this field
   *  is what closes that gap. */
  cancelUrlFrom: 'admin_hold' | 'admin_remediation'
}

const ADMIN_HOLD_ORIGINS: Record<AdminHoldOrigin, AdminHoldOriginConfig> = {
  waitlist_promotion: {
    rpcName: 'admin_promote_waitlist_to_hold',
    rollbackStatus: 'waitlisted', // unchanged from today's behaviour
    templateName: 'waitlist_promotion',
    notificationType: 'waitlist',
    renderEmail: waitlistPromotionTemplate,
    logLabel: 'createAdminBookingHold',
    cancelUrlFrom: 'admin_hold', // unchanged value from before this fix
  },
  payment_remediation: {
    rpcName: 'admin_hold_confirmed_booking_for_payment',
    // NOT 'waitlisted' — they were never waitlisted this cycle. If
    // Stripe/profile lookup fails after the RPC already flipped them to
    // pending_payment, the honest rollback is back to 'confirmed'
    // (unpaid) — functionally a no-op that leaves them exactly where
    // they started, still needing remediation, not worse off.
    rollbackStatus: 'confirmed',
    templateName: 'confirmed_unpaid_payment_link',
    notificationType: 'reminder',
    renderEmail: confirmedUnpaidPaymentLinkTemplate,
    logLabel: 'createAdminPaymentRemediationHold',
    cancelUrlFrom: 'admin_remediation',
  },
}

// ── Shared result shape ─────────────────────────────────────────────────

export interface CreateAdminBookingHoldResult {
  success: boolean
  error?: string
  status?: 'pending_payment'
  checkoutUrl?: string
  /** ISO, echoed back for the caller's toast/email copy. */
  holdExpiresAt?: string | null
}

/**
 * Shared flow behind `createAdminBookingHold` and
 * `createAdminPaymentRemediationHold`. Parameterised by `origin` via
 * `ADMIN_HOLD_ORIGINS` — see the module comment above and Addendum §A.4.
 *
 * Algorithm (spec §3.2, unchanged in shape from the pre-refactor
 * `createAdminBookingHold` — only steps 4, 9b, and 10 vary by origin):
 *   1. Fetch the booking (event_id, user_id).
 *   2. Fetch the event. Defensively reject free events (should be
 *      unreachable — both callers branch on price before ever calling
 *      this).
 *   3. Compute the booking fee (single source of truth).
 *   4. Call the origin's RPC via the user-scoped client — auth.uid()
 *      must resolve to the calling admin inside the RPC.
 *   5. Unwrap the RPC's own jsonb error shape.
 *   6-9. Stripe customer + Checkout Session + persistence + email, all
 *      inside one try/catch so ANY failure here (missing profile, Stripe
 *      API error) hits the SAME rollback path — mirrors
 *      createPaidCheckout / claimWaitlistSpot's own try/catch shape.
 *   10. On failure: roll back to `config.rollbackStatus` AND clear
 *      is_admin_hold / admin_hold_expires_at in the SAME UPDATE. This is
 *      the one place copying the existing claimWaitlistSpot rollback
 *      verbatim would be wrong — that rollback only has `status` to
 *      worry about; this one also carries the two hold columns, and
 *      forgetting them here would reproduce the staleness trap the CHECK
 *      constraint (chk_bookings_admin_hold_requires_pending_payment)
 *      exists to prevent, on the very first error path anyone hits.
 *
 * `supabaseUserScoped` MUST come from requireAdmin() (carries the admin's
 * own JWT) — NOT the service-role admin client — because the RPC's
 * in-body admin-role check depends on auth.uid() resolving to the caller.
 */
async function runAdminHoldFlow(
  origin: AdminHoldOrigin,
  supabaseUserScoped: SupabaseClient,
  bookingId: string,
  options: { holdExpiresAt: Date | null },
): Promise<CreateAdminBookingHoldResult> {
  const config = ADMIN_HOLD_ORIGINS[origin]
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

  // Defensive — should be unreachable. Both callers (promoteFromWaitlist,
  // sendPaymentLinkForConfirmedBooking) branch on event.price BEFORE
  // ever calling this helper, and both RPCs also reject free events
  // themselves. Belt-and-braces so a future misuse fails loud and early
  // instead of creating an unpayable hold.
  if (event.price === 0) {
    return {
      success: false,
      error: 'Free events should be confirmed directly, not held',
    }
  }

  // 3. Booking fee — single source of truth, same formula every paid
  // booking path uses.
  const bookingFeePence = calculateBookingFeePence(event.price)

  // 4. Transition via the origin-specific RPC.
  const { data: rpcData, error: rpcError } = await supabaseUserScoped.rpc(
    config.rpcName,
    {
      p_booking_id: bookingId,
      p_booking_fee_pence: bookingFeePence,
      p_hold_expires_at: options.holdExpiresAt?.toISOString() ?? null,
    },
  )

  if (rpcError) {
    console.error(`[${config.logLabel}] RPC error:`, rpcError.message)
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

    // 8. Checkout Session. cancel_url carries &from=<config.cancelUrlFrom>
    // so abandonPendingCheckout (events/[slug]/actions.ts) can tell the
    // two origins apart and restore the booking to the CORRECT prior
    // status if the member clicks "← Back" out of Stripe —
    // waitlist_promotion restores to `waitlisted`, payment_remediation
    // restores to `confirmed` (never `waitlisted`; these bookings were
    // never on the waitlist this cycle — see cancelUrlFrom's own doc
    // comment above). expiresInSeconds is derived from the DB-side
    // deadline so the Stripe-side cutoff always lands 5 minutes before
    // the revert-cron would ever consider reverting the row (§3.3, §6.4).
    const siteOrigin = await resolveSiteOrigin()
    const successUrl = `${siteOrigin}/events/${event.slug}/booking-success?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${siteOrigin}/events/${event.slug}?cancelled=1&from=${config.cancelUrlFrom}`
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
        `[${config.logLabel}] Failed to store checkout session id:`,
        updErr.message,
      )
    }

    // 9b. Email the member their payment link. Self-contained try/catch —
    // the hold + Checkout Session already exist at this point; a failure
    // to send the email must NOT roll either back (project rule: email
    // sends are non-blocking and must never break the triggering action).
    try {
      const tpl = config.renderEmail({
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
        templateName: config.templateName,
        relatedProfileId: booking.user_id,
        recipientUserId: booking.user_id,
        recipientEventId: booking.event_id,
        notificationType: config.notificationType,
        tags: [
          { name: 'template', value: config.templateName },
          { name: 'event_id', value: booking.event_id },
        ],
      })
      if (!emailResult.success) {
        console.warn(
          `[${config.logLabel}] payment-link email failed:`,
          emailResult.error,
        )
      }
    } catch (emailErr) {
      console.warn(
        `[${config.logLabel}] payment-link email threw:`,
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
    // 10. Stripe failure (or missing profile) — roll back to
    // config.rollbackStatus AND clear the two hold columns in the SAME
    // UPDATE, or the row would violate
    // chk_bookings_admin_hold_requires_pending_payment the instant
    // status leaves pending_payment.
    console.error(
      `[${config.logLabel}] Stripe flow failed, restoring to ${config.rollbackStatus}:`,
      err instanceof Error ? err.message : err,
    )
    Sentry.captureException(err, {
      tags: { surface: config.logLabel },
      extra: { bookingId, eventId: booking.event_id, userId: booking.user_id },
      level: 'error',
    })

    await admin
      .from('bookings')
      .update({
        status: config.rollbackStatus,
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

// ── createAdminBookingHold (waitlist-promotion origin) ──────────────────────

/**
 * Promote a waitlisted booking on a PAID event to a `pending_payment`
 * seat hold, and send the member a real Stripe Checkout link.
 *
 * Thin wrapper over `runAdminHoldFlow('waitlist_promotion', ...)` — see
 * that function's doc comment for the full algorithm. Public signature,
 * behavior, and test coverage
 * (src/lib/bookings/__tests__/admin-hold.test.ts) are unchanged from
 * before the Addendum §A.4 refactor.
 */
export async function createAdminBookingHold(
  supabaseUserScoped: SupabaseClient,
  bookingId: string,
  options: { holdExpiresAt: Date | null },
): Promise<CreateAdminBookingHoldResult> {
  return runAdminHoldFlow('waitlist_promotion', supabaseUserScoped, bookingId, options)
}

// ── createAdminPaymentRemediationHold (payment-remediation origin) ──────────

/**
 * Remediate a CONFIRMED booking on a PAID event that was never actually
 * charged — Gap A in
 * SYSTEM-DESIGN-admin-waitlist-promotion-payment.md's addendum. Holds the
 * booking as `pending_payment` (via `admin_hold_confirmed_booking_for_
 * payment`, which requires `status='confirmed' AND stripe_payment_id IS
 * NULL` and deliberately skips the capacity check — see Addendum §A.1)
 * and sends the member a real Stripe Checkout link using a template that
 * does NOT mention the waitlist (they were never on it this cycle).
 *
 * Thin wrapper over `runAdminHoldFlow('payment_remediation', ...)` — see
 * that function's doc comment for the full algorithm.
 */
export async function createAdminPaymentRemediationHold(
  supabaseUserScoped: SupabaseClient,
  bookingId: string,
  options: { holdExpiresAt: Date | null },
): Promise<CreateAdminBookingHoldResult> {
  return runAdminHoldFlow('payment_remediation', supabaseUserScoped, bookingId, options)
}

// ── releaseAdminBookingHold (Gap B — manual release) ─────────────────────────

export interface ReleaseAdminBookingHoldResult {
  success: boolean
  error?: string
  status?: 'waitlisted'
  waitlistPosition?: number | null
}

/**
 * Manually revert an active `pending_payment` admin hold back to
 * `waitlisted` — Gap B in the addendum. Origin-agnostic: works
 * identically whether the hold came from `createAdminBookingHold`
 * (waitlist promotion) or `createAdminPaymentRemediationHold` (payment
 * remediation) — the underlying RPC's predicate is just
 * `is_admin_hold=true AND status='pending_payment'` (Addendum §B.1).
 * Structurally separate from `runAdminHoldFlow`/`ADMIN_HOLD_ORIGINS`
 * (Addendum §B.4): releasing a hold is a fundamentally different
 * operation (reverting an existing hold, not creating one), and there's
 * no RPC-name/rollback-status/email-template axis to share — release has
 * exactly one RPC, one destination, no email in this design.
 *
 * Ordering (Addendum §B.2 — DB-first, Stripe-expire best-effort after):
 *   1. Revert via `admin_revert_hold_to_waitlist` FIRST — this is the
 *      authoritative step. The RPC's own locked
 *      `WHERE is_admin_hold=true AND status='pending_payment'` guard
 *      means the revert only actually happens if the row was still
 *      genuinely an active hold at that instant — if the webhook had
 *      already confirmed the booking microseconds earlier, the RPC
 *      returns a clear error instead of silently matching zero rows.
 *   2. THEN, best-effort, proactively expire the outstanding Stripe
 *      Checkout Session so a stale link can't be paid after the DB-side
 *      revert has already committed. NOT a precondition for step 1 —
 *      that already succeeded by the time this runs. A failure here is
 *      logged (and, if it looks like the session was already paid,
 *      escalated to Sentry) but never rolled back and never surfaced as
 *      an error to the admin: the seat is already correctly freed either
 *      way.
 *
 * `supabaseUserScoped` MUST come from requireAdmin() for the same
 * auth.uid()-in-RPC reason as the two hold-creation flows above.
 */
export async function releaseAdminBookingHold(
  supabaseUserScoped: SupabaseClient,
  bookingId: string,
): Promise<ReleaseAdminBookingHoldResult> {
  // 1. DB-side revert FIRST — authoritative. See Addendum §B.2 for why
  // this must happen before the Stripe-expire call, not after or
  // gated-by-it.
  const { data: rpcData, error: rpcError } = await supabaseUserScoped.rpc(
    'admin_revert_hold_to_waitlist',
    { p_booking_id: bookingId },
  )

  if (rpcError) {
    console.error('[releaseAdminBookingHold] RPC error:', rpcError.message)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  const rpcResult = rpcData as Record<string, unknown>
  if (rpcResult.error) {
    return { success: false, error: rpcResult.error as string }
  }

  // 2. Best-effort: proactively expire the outstanding Stripe Checkout
  // Session so a stale link can't be paid after the DB-side revert has
  // already committed. NOT a precondition for step 1 — that already
  // succeeded. A failure here is logged but never rolled back and never
  // surfaced as an error to the admin: the seat is already correctly
  // freed either way. See Addendum §B.2.
  const admin = createAdminClient()
  const { data: booking } = await admin
    .from('bookings')
    .select('stripe_checkout_session_id')
    .eq('id', bookingId)
    .single()

  const sessionId = booking?.stripe_checkout_session_id
  if (sessionId) {
    try {
      const stripe = getStripeClient()
      await stripe.checkout.sessions.expire(sessionId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      // ── "Already paid" detection ────────────────────────────────────
      //
      // Verified against the installed `stripe` npm package's bundled
      // type defs + source (node_modules/stripe, v22.0.2) — this
      // codebase has no existing precedent for typed Stripe-error
      // inspection to check against beyond the duck-typed
      // `(err as { code?: string }).code === 'resource_missing'` pattern
      // already used in checkout.ts's ensureStripeCustomer, which this
      // mirrors.
      //
      // VERIFIED:
      //   - Checkout/Sessions.d.ts's own doc comment for `.expire()`:
      //     "A Checkout Session can be expired when it is in one of
      //     these statuses: open" — confirming Stripe rejects expire()
      //     on a 'complete' (paid) or already-'expired' session.
      //   - Error.js's generateV1Error(): every Stripe REST error with
      //     statusCode 400 or 404 (other than idempotency_error) becomes
      //     a StripeInvalidRequestError, whose `.code` is Stripe's raw
      //     JSON error code (`raw.code`) passed through verbatim. This
      //     ONE error class covers BOTH "wrong state" (what we want to
      //     detect here) AND "no such session" (a stale/bad id — a
      //     different, non-race scenario) — the class alone can't tell
      //     them apart, only `.code` (or the message) can.
      //
      // NOT VERIFIED (no network access to Stripe's live docs/dashboard
      // from this environment, and Stripe's full `code` enum isn't
      // bundled in the npm package): the EXACT `.code` value Stripe
      // assigns to "cannot expire — already complete/paid" specifically,
      // if it assigns one at all. Many Stripe "wrong state for this
      // operation" errors carry no `code`, only a message — plausible
      // here too.
      //
      // Design: `.code === 'resource_missing'` is a real, precedented
      // EXCLUSION (checkout.ts already uses this exact code for "no such
      // Customer" elsewhere in this codebase) — a missing/bad session id
      // would carry it too, and that is NOT a payment race, just a stale
      // reference, so don't escalate to Sentry for it even if the
      // message happens to match the regex below. Beyond that exclusion,
      // the message-regex is the best available signal for the
      // *positive* "already complete" case — flagged as an assumption,
      // not a certainty, per this task's explicit instruction not to
      // silently present a guess as verified.
      const isResourceMissing =
        err instanceof Error && (err as { code?: string }).code === 'resource_missing'
      const looksAlreadyPaid =
        !isResourceMissing && /complete|paid|succeeded/i.test(message)

      if (looksAlreadyPaid) {
        Sentry.captureException(err, {
          tags: {
            surface: 'releaseAdminBookingHold',
            signal: 'possible_race_paid_after_revert',
          },
          extra: { bookingId, sessionId },
          level: 'error',
        })
      } else {
        console.warn(
          '[releaseAdminBookingHold] Stripe session expire failed (non-blocking):',
          sessionId,
          message,
        )
      }
    }
  }

  return {
    success: true,
    status: 'waitlisted',
    waitlistPosition: (rpcResult.waitlist_position as number | null) ?? null,
  }
}
