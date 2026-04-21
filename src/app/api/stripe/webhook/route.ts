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
      // Future: charge.refunded lands in P2-7b to flip the booking to
      // 'cancelled' when an admin refunds from the Stripe dashboard.
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
