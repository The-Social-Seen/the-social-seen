/**
 * Booking-fee formula — single source of truth.
 *
 * The platform charges a small non-refundable fee on top of the ticket
 * price at point of sale, so that on user-initiated cancellations (where
 * we refund the ticket price only) the fee absorbs Stripe's processing
 * cost. The same number is persisted to bookings.booking_fee_pence via
 * the book_event_paid() / claim_waitlist_spot() RPCs and shown to the
 * customer in pre-checkout disclosure.
 *
 * Pure function, no I/O. The Server Action calls this once and passes
 * the result to both the RPC (persistence) and createBookingCheckoutSession
 * (Stripe Checkout line item). Computing it in TS once means the
 * displayed total and the persisted snapshot are guaranteed identical.
 *
 * Backed by SYSTEM-DESIGN-refund-fee-deduction.md §2 (formula),
 * §3 (RPC integration), §4 (Stripe line-item), §6 (refund math).
 */

/**
 * Constants for the UK Stripe domestic card rate.
 *
 * Source: stripe.com/gb/pricing — Standard rate for UK cards as of
 * 2026-05-17. International / AmEx cards eat into our margin (3.25% +
 * 20p) but are rare enough that the inclusive total + 10p round-up
 * margin still leaves us roughly cost-neutral on a portfolio basis.
 *
 * If Stripe changes their published rate, update STRIPE_PERCENT or
 * STRIPE_FLAT_PENCE here — no DB migration needed because we don't
 * snapshot the rate, only the resulting fee and the actual fee.
 *
 * Constants are intentionally module-scoped (not exported). The only
 * use case for callers reading them is admin reporting "the rate we
 * targeted", which is a follow-up.
 */
const STRIPE_PERCENT = 0.015     // 1.5%
const STRIPE_FLAT_PENCE = 20     // 20p
const ROUND_UP_PENCE = 10        // Round the final fee up to the nearest 10p

/**
 * Calculate the booking fee we charge a customer to absorb Stripe's
 * processing fee on this charge.
 *
 * Returns the fee in pence, rounded up to the nearest 10p so the
 * displayed inclusive total ends in a clean digit.
 *
 * Solves for: total = (price + fee), where fee covers Stripe's
 * percentage of the WHOLE total + the flat per-transaction cost. Closed
 * form: exact = (price * percent + flat) / (1 - percent). Round up so we
 * never under-absorb the fee.
 *
 * Examples:
 *   eventPricePence = 2000  (£20)   → 60   (£0.60 fee, £20.60 total)
 *   eventPricePence = 5000  (£50)   → 100  (£1.00 fee, £51.00 total)
 *   eventPricePence = 10000 (£100)  → 180  (£1.80 fee, £101.80 total)
 *   eventPricePence = 15000 (£150)  → 250  (£2.50 fee, £152.50 total)
 *
 * Free events: returns 0. The caller (book_event_paid / Server Action)
 * MUST NOT call this for free events, but the guard exists so a misuse
 * doesn't blow up — and the column CHECK constraint
 * chk_bookings_free_no_booking_fee enforces the invariant at the DB
 * layer too.
 *
 * Negative input: returns 0 defensively (callers shouldn't pass
 * negative prices but we don't want a NaN/Infinity propagating into
 * Stripe).
 */
export function calculateBookingFeePence(eventPricePence: number): number {
  if (eventPricePence <= 0) return 0

  const exact =
    (eventPricePence * STRIPE_PERCENT + STRIPE_FLAT_PENCE) /
    (1 - STRIPE_PERCENT)

  return Math.ceil(exact / ROUND_UP_PENCE) * ROUND_UP_PENCE
}
