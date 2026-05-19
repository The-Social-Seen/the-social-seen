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
  /**
   * Ticket price ONLY (event.price) — the booking fee is passed
   * separately as bookingFeePence. Stripe charges
   * priceInPence + bookingFeePence as a single line item; the customer
   * sees one inclusive total. Locked decision per
   * SYSTEM-DESIGN-refund-fee-deduction.md §4.
   */
  priceInPence: number
  /**
   * Non-refundable booking fee charged ON TOP of priceInPence. Computed
   * once via calculateBookingFeePence() and passed through to both the
   * book_event_paid RPC (persistence) and here (Stripe line item) so the
   * displayed total and the persisted snapshot are guaranteed identical.
   * Free events: pass 0.
   */
  bookingFeePence: number
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
 *
 * Defensive validation of the saved id: on 2026-04-27 a Stripe account
 * rotation produced a production outage — saved `stripe_customer_id`
 * values from the previous account threw `No such customer` when reused
 * here, blocking every paid checkout until the column was nulled out by
 * hand. To prevent recurrence on any future account/key rotation or DB
 * restore from a pre-rotation snapshot, we now retrieve the saved
 * customer before reusing it. If Stripe responds with
 * `code === 'resource_missing'` (or the Customer was deleted server-
 * side) we null the column and fall through to the create path. Any
 * other error (network, auth, rate limit) propagates — we must NOT
 * silently mask a real Stripe outage as "stale id" or we'll wipe valid
 * ids during a transient incident.
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
    const stripe = getStripeClient()
    let staleId = false
    try {
      const customer = await stripe.customers.retrieve(profile.stripe_customer_id)
      if (!('deleted' in customer) || !customer.deleted) {
        return profile.stripe_customer_id
      }
      // Stripe returned a DeletedCustomer — the id no longer points at a
      // usable record. Null the column for cleanliness and fall through.
      staleId = true
    } catch (err) {
      if (
        err instanceof Error
        && (err as { code?: string }).code === 'resource_missing'
      ) {
        // Stale id from a previous Stripe account / key rotation, or a
        // DB restore from a pre-rotation snapshot.
        staleId = true
      } else {
        // Network, auth error, rate limit, etc. Propagate so the caller
        // sees the real Stripe outage instead of us masking it as a
        // stale-id and wiping a valid column.
        throw err
      }
    }

    if (staleId) {
      // Null the column before falling through to the create path so a
      // future booking attempt won't repeat the Stripe round-trip.
      await supabase
        .from('profiles')
        .update({ stripe_customer_id: null })
        .eq('id', args.userId)
    }
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
          // Single line item with the inclusive total — locked decision
          // per SYSTEM-DESIGN-refund-fee-deduction.md §4. Stripe's hosted
          // checkout shows "Event Title — £20.60"; the pre-checkout
          // sidebar (frontend agent's work) discloses the ticket+fee
          // breakdown to the customer ahead of redirect.
          unit_amount: input.priceInPence + input.bookingFeePence,
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
      // Capture the fee on the Checkout Session too so admin auditing
      // from the Stripe dashboard can see the breakdown without
      // round-tripping to our DB.
      booking_fee_pence: String(input.bookingFeePence),
    },
    // payment_intent_data.metadata is what surfaces on refunds / on
    // the PaymentIntent dashboard — duplicate the key fields there too.
    // Stripe metadata values must be strings; coerce explicitly.
    payment_intent_data: {
      metadata: {
        booking_id: input.bookingId,
        user_id: input.userId,
        event_id: input.eventId,
        // When an admin opens a PaymentIntent in the Stripe dashboard
        // to investigate a refund query, this surfaces immediately
        // "this booking had a £0.60 fee, so the £20 partial-refund is
        // correct". Cheap audit aid.
        booking_fee_pence: String(input.bookingFeePence),
      },
    },
    // User can enter Stripe Dashboard-managed promotion codes at
    // checkout. Codes are managed in Stripe Dashboard → Products →
    // Coupons → Promotion codes, not in this app. Refunds and
    // redemption tracking flow through Stripe's own pipeline — there
    // is no app-side discount-code state, schema, or admin UI.
    allow_promotion_codes: true,
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
