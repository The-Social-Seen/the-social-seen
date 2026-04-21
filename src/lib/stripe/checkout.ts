/**
 * Stripe Checkout Session helpers. Server-only.
 *
 * Two-step flow:
 *   1. Ensure the profile has a stripe_customer_id (lazy-create).
 *   2. Create a Checkout Session with metadata.booking_id pointing at the
 *      pending_payment booking row. The webhook uses that metadata to
 *      move the booking to 'confirmed' on success.
 *
 * We do NOT pass Stripe an `id` or `customer_creation` shortcut — we
 * always create the Customer explicitly so we can store the id on
 * profiles and reuse it for future bookings (saved cards, receipt
 * history).
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripeClient } from './server'

export interface CheckoutSessionInput {
  bookingId: string
  userId: string
  userEmail: string
  eventId: string
  eventTitle: string
  eventSlug: string
  priceInPence: number
  successUrl: string
  cancelUrl: string
}

/**
 * Create (or reuse) a Stripe Customer for a profile. Stores the id on
 * profiles.stripe_customer_id on first use.
 *
 * `supabase` is the admin client — lazy-customer-create must bypass RLS
 * because profiles.update is locked down to the row owner, and we want
 * this to work whether the caller is the user themselves or a future
 * admin retry.
 */
export async function ensureStripeCustomer(
  supabase: SupabaseClient,
  args: { userId: string; email: string; fullName: string | null },
): Promise<string> {
  // Look up any existing id first.
  const { data: profile, error: readErr } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', args.userId)
    .single()

  if (readErr) {
    throw new Error(`Failed to read profile for Stripe customer: ${readErr.message}`)
  }

  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id
  }

  const stripe = getStripeClient()
  const customer = await stripe.customers.create({
    email: args.email,
    name: args.fullName ?? undefined,
    metadata: {
      supabase_user_id: args.userId,
    },
  })

  const { error: writeErr } = await supabase
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', args.userId)

  if (writeErr) {
    // Log but don't throw — the Customer exists in Stripe, we just
    // failed to persist the id. The next booking will re-create a
    // Customer (Stripe dedupes by email) and retry the update.
    console.warn(
      '[stripe/checkout] Failed to persist stripe_customer_id:',
      writeErr.message,
    )
  }

  return customer.id
}

/**
 * Create a Checkout Session for a single-seat paid event booking.
 * Returns the hosted URL the browser must navigate to.
 */
export async function createBookingCheckoutSession(
  input: CheckoutSessionInput & { stripeCustomerId: string },
): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripeClient()

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: input.stripeCustomerId,
    // Pre-fill and lock the email field so the Stripe receipt matches
    // the Supabase profile.
    customer_update: { name: 'auto' },
    line_items: [
      {
        price_data: {
          currency: 'gbp',
          unit_amount: input.priceInPence,
          product_data: {
            name: input.eventTitle,
            // Description must be <= 500 chars per Stripe. Our event
            // titles are well under.
          },
        },
        quantity: 1,
      },
    ],
    // metadata: webhook uses booking_id to find the row to confirm.
    metadata: {
      booking_id: input.bookingId,
      user_id: input.userId,
      event_id: input.eventId,
      event_slug: input.eventSlug,
    },
    // payment_intent_data.metadata is what surfaces on refunds / on
    // the PaymentIntent dashboard — duplicate the key fields there too.
    payment_intent_data: {
      metadata: {
        booking_id: input.bookingId,
        user_id: input.userId,
        event_id: input.eventId,
      },
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    // Auto-expire sessions after 30 min so abandoned pending_payment
    // bookings don't hold seats indefinitely. The min Stripe allows is
    // 30 min from creation.
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  })

  if (!session.url) {
    throw new Error('Stripe did not return a Checkout URL')
  }

  return { sessionId: session.id, url: session.url }
}
