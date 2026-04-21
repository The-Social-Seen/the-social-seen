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
 *        - checkout.session.completed → confirm the matching booking,
 *          record the PaymentIntent id. Idempotent via the partial
 *          UNIQUE index on bookings.stripe_payment_id.
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

  if (session.payment_status !== 'paid') {
    // Unusual — Stripe only fires this event when payment_status=paid
    // for mode=payment sessions. Skip defensively.
    console.warn(
      '[stripe/webhook] checkout.session.completed with unpaid status:',
      session.payment_status,
    )
    return
  }

  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null

  if (!paymentIntentId) {
    console.error(
      '[stripe/webhook] checkout.session.completed missing payment_intent',
      session.id,
    )
    return
  }

  const admin = createAdminClient()

  // Idempotency: the partial UNIQUE index ux_bookings_stripe_payment_id
  // means a second UPDATE with the same payment id on a different
  // booking fails with 23505. And we guard with `.eq('status',
  // 'pending_payment')` so re-delivery to an already-confirmed row
  // no-ops gracefully.
  const { data: updated, error: updErr } = await admin
    .from('bookings')
    .update({
      status: 'confirmed',
      stripe_payment_id: paymentIntentId,
      // Clear waitlist_position now that the booking is a confirmed
      // seat — the P2-7b RPC preserves the position through the
      // pending_payment transition so the user can be restored to
      // waitlist if Stripe fails. On successful payment, position is
      // no longer meaningful.
      waitlist_position: null,
    })
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

  // Send the confirmation email. Non-blocking — Resend downtime mustn't
  // cause Stripe to retry.
  void sendPaidBookingConfirmationEmail({
    userId: updated.user_id,
    eventId: updated.event_id,
  })
}

async function sendPaidBookingConfirmationEmail(args: {
  userId: string
  eventId: string
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const [profileRes, eventRes] = await Promise.all([
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
    ])

    const profile = profileRes.data
    const event = eventRes.data
    if (!profile?.email || !event) {
      console.warn(
        '[stripe/webhook] confirmation email skipped: profile or event missing',
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
      status: 'confirmed',
      waitlistPosition: null,
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
