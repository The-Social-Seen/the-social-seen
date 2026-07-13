/**
 * Stripe webhook endpoint.
 *
 * URL (dev):  /api/stripe/webhook
 * URL (prod): https://the-social-seen.vercel.app/api/stripe/webhook
 *
 * What it does:
 *   1. Read the raw request body (NOT parsed JSON — Stripe's signature is
 *      over the raw bytes).
 *   2. Verify the `Stripe-Signature` header against STRIPE_WEBHOOK_SECRET.
 *      Reject with 401 on mismatch.
 *   3. Switch on event.type:
 *        - checkout.session.completed → confirm the matching booking.
 *          Paid path: record the PaymentIntent id (idempotent via the
 *          partial UNIQUE index on bookings.stripe_payment_id).
 *          Comp path (100%-off promotion code → £0 total): Stripe sets
 *          payment_status='no_payment_required' and creates NO
 *          PaymentIntent, so we confirm with stripe_payment_id=null and
 *          zero both money columns. Idempotent via the
 *          .eq('status','pending_payment') optimistic guard. See
 *          docs/SYSTEM-DESIGN-zero-total-coupon-bookings.md.
 *        - Everything else → log + ACK 200 so Stripe doesn't retry.
 *   4. Always return 200 after signature verification succeeds, even if
 *      the handler encountered a database error — otherwise Stripe will
 *      retry indefinitely. Errors go to Sentry + notifications audit.
 *
 * Uses the service-role admin client because:
 *   - The caller is Stripe, not an authenticated user (no auth.uid()).
 *   - We need to UPDATE a booking row which RLS restricts to the row
 *     owner — but the booking owner is not the HTTP caller here.
 *
 * Runtime: explicitly set to Node.js (not Edge) because the Stripe SDK's
 * signature-verification helper uses Node crypto primitives.
 */

import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getStripeClient } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { bookingConfirmationTemplate } from '@/lib/email/templates/booking-confirmation'
import { formatDateFull, formatTime } from '@/lib/utils/dates'

// Next.js 15: explicit runtime declaration. Stripe's SDK expects Node.
export const runtime = 'nodejs'

// Webhooks are short-lived, never cached.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  const sig = req.headers.get('stripe-signature')
  if (!sig) {
    return new NextResponse('Missing stripe-signature header', { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set')
    return new NextResponse('Webhook secret not configured', { status: 500 })
  }

  // Raw body bytes — critical for signature verification.
  const rawBody = await req.text()

  const stripe = getStripeClient()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err) {
    console.warn(
      '[stripe/webhook] Signature verification failed:',
      err instanceof Error ? err.message : err,
    )
    return new NextResponse('Invalid signature', { status: 401 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break
      }
      case 'charge.refunded': {
        // Fires when an admin issues a refund from the Stripe dashboard
        // OR when our own `cancelBooking` flow calls stripe.refunds.create.
        // Either way, this handler reconciles the booking row so the
        // app state matches Stripe state.
        await handleChargeRefunded(event.data.object as Stripe.Charge)
        break
      }
      default:
        // Any event we don't handle — ACK so Stripe stops retrying.
        console.info(`[stripe/webhook] Unhandled event type: ${event.type}`)
    }
  } catch (err) {
    // Log but still 200 to stop Stripe retrying indefinitely. A failed
    // handler is recoverable via the admin retry tooling (P2-9) or by
    // manually re-delivering the event from the Stripe dashboard.
    console.error(
      '[stripe/webhook] Handler threw for event',
      event.type,
      err instanceof Error ? err.message : err,
    )
  }

  return NextResponse.json({ received: true })
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const bookingId = session.metadata?.booking_id
  if (!bookingId) {
    console.error(
      '[stripe/webhook] checkout.session.completed missing booking_id metadata',
      session.id,
    )
    return
  }

  // Fulfillment eligibility. Two confirmable shapes (per Stripe's
  // recommended `payment_status != 'unpaid'` gate, tightened for us — see
  // docs/SYSTEM-DESIGN-zero-total-coupon-bookings.md §2.1):
  //
  //   1. Paid session — the normal flow. payment_status='paid', a
  //      PaymentIntent exists.
  //   2. Comp session — a 100%-off promotion code reduced the total to
  //      £0. Stripe sets payment_status='no_payment_required', creates NO
  //      PaymentIntent (session.payment_intent is null), and still fires
  //      this event with status='complete' / amount_total=0. We require
  //      all three signals so a genuinely-unpaid/abandoned/expired session
  //      (which we still reject, exactly as before) can't slip through.
  const isPaidSession = session.payment_status === 'paid'
  const isCompSession =
    session.payment_status === 'no_payment_required' &&
    session.status === 'complete' &&
    session.amount_total === 0

  if (!(isPaidSession || isCompSession)) {
    // Genuinely unpaid / abandoned / inconsistent — do nothing. Same
    // rejection as the old `payment_status !== 'paid'` gate, now also
    // logging the fields that distinguish a comp from these.
    console.warn(
      '[stripe/webhook] checkout.session.completed not fulfillable:',
      {
        payment_status: session.payment_status,
        status: session.status,
        amount_total: session.amount_total,
      },
    )
    return
  }

  // Resolve the PaymentIntent — present (string) for a paid session, null
  // for a comp. Do NOT reject on null any more: a £0 comp legitimately has
  // no PaymentIntent. This value gates fee capture and the
  // stripe_payment_id write below.
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null

  const admin = createAdminClient()

  // Build the confirm payload. Both paths flip status → confirmed and
  // clear waitlist_position. The comp path additionally zeros BOTH money
  // columns (see below); the paid path leaves the RPC snapshot intact (it
  // already equals what Stripe charged — one line item, no coupon).
  const updatePayload: {
    status: 'confirmed'
    stripe_payment_id: string | null
    waitlist_position: null
    is_admin_hold: false
    admin_hold_expires_at: null
    price_at_booking?: number
    booking_fee_pence?: number
  } = {
    status: 'confirmed',
    // null on the comp path — there is no PaymentIntent to record. The
    // partial UNIQUE index is `WHERE stripe_payment_id IS NOT NULL`, so a
    // null can never collide; comp idempotency rests on the status guard.
    stripe_payment_id: paymentIntentId,
    // Clear waitlist_position now that the booking is a confirmed
    // seat — the P2-7b RPC preserves the position through the
    // pending_payment transition so the user can be restored to
    // waitlist if Stripe fails. On successful payment, position is
    // no longer meaningful.
    waitlist_position: null,
    // Unconditionally clear the admin-hold flag now that the booking is
    // genuinely confirmed via a real Stripe payment (or a £0 comp).
    // Harmless no-op for every non-hold booking (already false/null
    // there). Required for admin-created holds
    // (createAdminBookingHold / admin_promote_waitlist_to_hold) — once
    // status leaves 'pending_payment', chk_bookings_admin_hold_requires_
    // pending_payment demands is_admin_hold=false in the SAME statement.
    // See SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §5 site #1.
    is_admin_hold: false,
    admin_hold_expires_at: null,
  }

  if (isCompSession) {
    // Reconcile to the actual collected amount: £0. session.amount_total
    // is 0 here.
    //
    // LOAD-BEARING — both money columns MUST be zeroed together. CHECK
    // chk_bookings_free_no_booking_fee is `price_at_booking > 0 OR
    // booking_fee_pence = 0`. book_event_paid already stamped a NON-ZERO
    // booking_fee_pence (the event has a real price; the comp only happens
    // later at Stripe). Setting price_at_booking=0 while leaving the fee
    // non-zero violates the CHECK (23514) → the UPDATE fails → the booking
    // stays pending_payment → the reaper cancels it → the fix looks
    // broken. With both at 0: `0 > 0 OR 0 = 0` → TRUE.
    updatePayload.price_at_booking = 0
    updatePayload.booking_fee_pence = 0
  }

  // Idempotency: the partial UNIQUE index ux_bookings_stripe_payment_id
  // means a second UPDATE with the same payment id on a different
  // booking fails with 23505 (paid path only). And we guard with
  // `.eq('status', 'pending_payment')` so re-delivery to an
  // already-confirmed row no-ops gracefully — this guard is the SOLE
  // idempotency mechanism on the comp path (stripe_payment_id is null).
  const { data: updated, error: updErr } = await admin
    .from('bookings')
    .update(updatePayload)
    .eq('id', bookingId)
    .eq('status', 'pending_payment')
    .select('id, user_id, event_id')
    .maybeSingle()

  if (updErr) {
    // 23505 = duplicate stripe_payment_id — almost certainly a webhook
    // re-delivery for an already-confirmed booking. Treat as success.
    if ((updErr as { code?: string }).code === '23505') {
      console.info(
        '[stripe/webhook] Duplicate payment_intent — already processed:',
        paymentIntentId,
      )
      return
    }
    throw new Error(`Failed to confirm booking ${bookingId}: ${updErr.message}`)
  }

  if (!updated) {
    // No row matched — either the booking doesn't exist or was already
    // cancelled / confirmed. Log and move on.
    console.info(
      '[stripe/webhook] No pending_payment booking matched',
      bookingId,
      '(already processed or rolled back)',
    )
    return
  }

  // Capture the ACTUAL Stripe processing fee for reporting. Non-blocking
  // — a failed BalanceTransaction lookup must not block confirmation
  // (which has already happened above). Refund math does NOT use this
  // value; it exists purely for admin reconciliation.
  //
  // Guard on PI: a comp session has no PaymentIntent, so there is no
  // BalanceTransaction and no Stripe fee to capture. An unconditional call
  // would pass null to stripe.paymentIntents.retrieve and throw a spurious
  // (caught-and-logged) error on every comp. stripe_fee_pence stays at its
  // DEFAULT 0, which is correct — Stripe took no fee on a £0 order.
  if (paymentIntentId) {
    await captureStripeFeeForBooking({
      bookingId: updated.id,
      paymentIntentId,
    })
  }

  // Send the confirmation email. Non-blocking — Resend downtime mustn't
  // cause Stripe to retry.
  void sendPaidBookingConfirmationEmail({
    userId: updated.user_id,
    eventId: updated.event_id,
  })
}

/**
 * Retrieves the BalanceTransaction for a PaymentIntent's latest charge
 * and writes the actual processing fee to bookings.stripe_fee_pence.
 *
 * Reporting only — refunds always use price_at_booking, not this value.
 *
 * Failure modes are all logged-and-swallowed. The booking is already
 * confirmed by the time this is called; nothing about the user
 * experience depends on this lookup succeeding. A failed write leaves
 * stripe_fee_pence at the default 0; admin reconciliation tooling can
 * backfill from Stripe if needed.
 *
 * Idempotency: the UPDATE is guarded with `.eq('stripe_fee_pence', 0)`.
 * If a `checkout.session.completed` re-delivery (or a manual ops
 * reconciliation) has already set the column, we don't overwrite.
 * First-write-wins.
 */
async function captureStripeFeeForBooking(args: {
  bookingId: string
  paymentIntentId: string
}): Promise<void> {
  try {
    const stripe = getStripeClient()
    const pi = await stripe.paymentIntents.retrieve(args.paymentIntentId, {
      expand: ['latest_charge.balance_transaction'],
    })

    const latestCharge = pi.latest_charge
    if (!latestCharge || typeof latestCharge === 'string') {
      console.warn(
        '[stripe/webhook] PaymentIntent missing expanded latest_charge:',
        args.paymentIntentId,
      )
      return
    }

    const bt = latestCharge.balance_transaction
    if (!bt || typeof bt === 'string') {
      console.warn(
        '[stripe/webhook] Charge missing expanded balance_transaction:',
        latestCharge.id,
      )
      return
    }

    // BalanceTransaction.fee is in the smallest currency unit (pence for GBP).
    const feePence = bt.fee
    if (typeof feePence !== 'number' || feePence < 0) {
      console.warn(
        '[stripe/webhook] BalanceTransaction has invalid fee:',
        feePence,
      )
      return
    }

    const admin = createAdminClient()
    const { error } = await admin
      .from('bookings')
      .update({ stripe_fee_pence: feePence })
      .eq('id', args.bookingId)
      // First-write-wins: don't overwrite if a later webhook re-delivery
      // or a manual reconciliation has already set the column.
      .eq('stripe_fee_pence', 0)

    if (error) {
      console.warn(
        '[stripe/webhook] Failed to write stripe_fee_pence:',
        error.message,
      )
    }
  } catch (err) {
    // Network blip, Stripe outage, rate limit — log and move on. The
    // booking is confirmed; this is reporting metadata.
    console.warn(
      '[stripe/webhook] captureStripeFeeForBooking threw:',
      err instanceof Error ? err.message : err,
    )
  }
}

async function sendPaidBookingConfirmationEmail(args: {
  userId: string
  eventId: string
}): Promise<void> {
  try {
    const admin = createAdminClient()
    // Look up the most-recent confirmed booking for this user/event so
    // the email can show the ticket+fee breakdown. The booking has just
    // been confirmed by the calling code, so it's guaranteed present.
    const [profileRes, eventRes, bookingRes] = await Promise.all([
      admin
        .from('profiles')
        .select('full_name, email')
        .eq('id', args.userId)
        .single(),
      admin
        .from('events')
        .select('title, slug, date_time, venue_name, venue_address, venue_revealed')
        .eq('id', args.eventId)
        .single(),
      admin
        .from('bookings')
        .select('price_at_booking, booking_fee_pence')
        .eq('user_id', args.userId)
        .eq('event_id', args.eventId)
        .eq('status', 'confirmed')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const profile = profileRes.data
    const event = eventRes.data
    if (!profile?.email || !event) {
      console.warn(
        '[stripe/webhook] confirmation email skipped: profile or event missing',
      )
      return
    }

    // Build the breakdown only for paid bookings (price > 0). Missing
    // bookingRes is non-fatal — we still send the confirmation, just
    // without the price table.
    const booking = bookingRes?.data
    const priceBreakdown =
      booking && booking.price_at_booking > 0
        ? {
            ticketPence: booking.price_at_booking,
            feePence: booking.booking_fee_pence ?? 0,
            totalPence:
              booking.price_at_booking + (booking.booking_fee_pence ?? 0),
          }
        : undefined

    const tpl = bookingConfirmationTemplate({
      fullName: profile.full_name?.trim() || 'there',
      eventTitle: event.title,
      eventSlug: event.slug,
      eventDate: formatDateFull(event.date_time),
      eventTime: formatTime(event.date_time),
      venueName: event.venue_name,
      venueAddress: event.venue_address,
      venueRevealed: event.venue_revealed,
      status: 'confirmed',
      waitlistPosition: null,
      priceBreakdown,
    })

    await sendEmail({
      to: profile.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'booking_confirmation',
      relatedProfileId: args.userId,
      tags: [
        { name: 'template', value: 'booking_confirmation' },
        { name: 'status', value: 'confirmed' },
        { name: 'source', value: 'stripe_webhook' },
      ],
    })
  } catch (err) {
    console.warn(
      '[stripe/webhook] confirmation email threw:',
      err instanceof Error ? err.message : err,
    )
  }
}

// ── Section 2 — charge.refunded (P2-7b) ─────────────────────────────────────

/**
 * Reconcile a Stripe refund back to the booking row. Two triggers:
 *
 *   1. App-initiated: `cancelBooking` calls `stripe.refunds.create`,
 *      sets `bookings.stripe_refund_id` + `refunded_amount_pence`, then
 *      flips status to `cancelled`. Moments later this webhook fires;
 *      we detect the row is already reconciled (stripe_refund_id
 *      matches) and no-op.
 *
 *   2. Admin-initiated: someone issues a refund from the Stripe
 *      dashboard. The app knows nothing about it until this webhook
 *      fires. We look the booking up by `payment_intent_id`, flip its
 *      status to `cancelled`, record the refund details.
 *
 * Idempotency:
 *   - We match the refund by id first — if `stripe_refund_id` already
 *     set on any booking, no-op.
 *   - Otherwise match by `stripe_payment_id` and set the fields.
 *   - The `.is('stripe_refund_id', null)` guard on the UPDATE means a
 *     concurrent duplicate delivery won't overwrite a reconciled row.
 */
async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  // Pull the refund (or refunds) that triggered this event. Stripe
  // docs: charge.refunds is a list; we take the most recent by created
  // time since this event fires per-refund.
  const refunds = charge.refunds?.data ?? []
  if (refunds.length === 0) {
    console.warn(
      '[stripe/webhook] charge.refunded with no refunds in payload',
      charge.id,
    )
    return
  }
  const refund = refunds.reduce((latest, r) =>
    r.created > latest.created ? r : latest,
  )

  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null
  if (!paymentIntentId) {
    console.warn(
      '[stripe/webhook] charge.refunded without a payment_intent',
      charge.id,
    )
    return
  }

  const admin = createAdminClient()

  // Idempotency check — if any booking already has this refund id, we've
  // already reconciled (likely from the cancelBooking Server Action path).
  const { data: existing } = await admin
    .from('bookings')
    .select('id')
    .eq('stripe_refund_id', refund.id)
    .limit(1)
    .maybeSingle()
  if (existing) {
    return
  }

  // Look up the booking by PaymentIntent. This is the path where an
  // admin issued the refund manually in the Stripe dashboard.
  const { data: booking, error: findErr } = await admin
    .from('bookings')
    .select('id, status')
    .eq('stripe_payment_id', paymentIntentId)
    .is('deleted_at', null)
    .is('stripe_refund_id', null) // don't reconcile twice
    .limit(1)
    .maybeSingle()

  if (findErr) {
    throw new Error(
      `Failed to look up booking for refund: ${findErr.message}`,
    )
  }
  if (!booking) {
    console.info(
      '[stripe/webhook] charge.refunded: no matching booking (already reconciled or unknown PI)',
      paymentIntentId,
    )
    return
  }

  const nowIso = new Date().toISOString()
  const { error: updErr } = await admin
    .from('bookings')
    .update({
      status: 'cancelled',
      cancelled_at: nowIso,
      refunded_amount_pence: refund.amount,
      refunded_at: nowIso,
      stripe_refund_id: refund.id,
    })
    .eq('id', booking.id)
    // Optimistic guard — if the row state has diverged since the find,
    // don't overwrite. The caller will see a warning in logs.
    .is('stripe_refund_id', null)

  if (updErr) {
    // 23505 = duplicate stripe_refund_id — somehow another path
    // reconciled in the tiny window between find + update. Treat as
    // already-done.
    if ((updErr as { code?: string }).code === '23505') return
    throw new Error(
      `Failed to reconcile refund ${refund.id} to booking ${booking.id}: ${updErr.message}`,
    )
  }
}
