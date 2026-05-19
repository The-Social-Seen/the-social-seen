# Feature: stop losing money to Stripe fees on paid-booking cancellations

**Agent:** `/project:architect` — produce a `SYSTEM-DESIGN-refund-fee-deduction.md` spec covering schema, RLS, query plan, Server Action contract, webhook handler changes, migration sequence, and the admin-cancelled-event flow. Hand off to `/project:backend-developer` next, then `/project:frontend-developer`, then `/project:tester`, then `/project:code-reviewer`.
**Branch to create:** `feat/refund-fee-deduction` from latest `main`.
**Type:** Feature. Adds a non-refundable booking fee on top of paid ticket prices to absorb Stripe processing costs on cancellations. Spans schema (1 migration), webhook handler (+1 Stripe API call on checkout completion), `cancelBooking` Server Action (refund math change), `createBookingCheckoutSession` (line-item price change), UI in 4–5 places (event card, booking modal/sidebar, cancellation confirm dialog, confirmation email, refund email if it exists), and a new admin "cancel event" flow that bulk-refunds.

**Origin:** 2026-05-17 user conversation. Current state: paid bookings via Stripe Checkout work; `cancelBooking` refunds `price_at_booking` in full (see [src/app/events/[slug]/actions.ts:729](src/app/events/[slug]/actions.ts:729)). We eat Stripe's ~1.5% + 20p fee on every cancellation inside the per-event refund window (default 48h). Product decisions already locked with the user — see "Locked product decisions" below.

---

## Locked product decisions (do NOT re-litigate these)

The user has already made these calls. Architect should design AROUND them, not propose alternatives:

1. **Display:** show the booking fee as an **inclusive total** at point of sale. UI string pattern: *"£20.60 total (incl. £0.60 booking fee)"*. Not a separate line item on the event card price.
2. **Existing paid bookings:** do **not** backfill. Pre-migration bookings have `booking_fee_pence = 0` and continue to refund the full ticket price (current behaviour). Only NEW bookings made after this lands will have a fee.
3. **Admin-cancelled events (event itself is cancelled, not the booking):** the platform **eats the fee**. Customer gets a full refund of `price_at_booking + booking_fee_pence` (everything they paid). The Stripe processing fee is a cost we absorb — it was our cancellation, not theirs.
4. **Fee formula** (starting proposal — refine if you must, but justify):
   ```ts
   // Round up to nearest 10p so displayed total is clean
   const exact = (eventPricePence * 0.015 + 20) / 0.985
   const feePence = Math.ceil(exact / 10) * 10
   ```
   Yields 60p on £20, £1 on £50, £1.80 on £100, £2.60 on £150. Covers Stripe domestic (1.5% + 20p) with a small positive margin to absorb international card variance (3.25% + 20p eats into margin, but rarely below cost).
5. **Refund maths on user-initiated cancellation:** refund = `price_at_booking` exactly. Customer "loses the booking fee" cleanly — never sees a weird amount like £19.49.
6. **Free events:** unaffected. `booking_fee_pence = 0`. No fee on £0 tickets.

---

## What's already in the schema (verified)

Read these files before designing. The existing surface is more built-out than CLAUDE.md suggests (CLAUDE.md still claims "Stripe MOCKED" — that line is stale and will be fixed in this batch's documentation work).

- [supabase/migrations/20260422000001_stripe_payments_schema.sql](supabase/migrations/20260422000001_stripe_payments_schema.sql) — adds `bookings.stripe_payment_id`, `stripe_checkout_session_id`, `profiles.stripe_customer_id`, `pending_payment` enum value, idempotency indexes.
- [supabase/migrations/20260422000002_book_event_paid_rpc.sql](supabase/migrations/20260422000002_book_event_paid_rpc.sql) — `book_event_paid()` RPC.
- [supabase/migrations/20260422000003_bookings_cancellation_columns.sql](supabase/migrations/20260422000003_bookings_cancellation_columns.sql) — `cancelled_at`, `cancellation_reason`, `refunded_amount_pence`, `refunded_at`, `stripe_refund_id`, refund consistency CHECK.
- [supabase/migrations/20260502000001_add_events_refund_window_hours.sql](supabase/migrations/20260502000001_add_events_refund_window_hours.sql) — per-event refund window (0 = non-refundable, default 48).
- [src/app/api/stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) — handles `checkout.session.completed` AND `charge.refunded`. Idempotent.
- [src/app/events/[slug]/actions.ts:635](src/app/events/[slug]/actions.ts:635) — `cancelBooking` Server Action. Line 729 is the one-line bleed: `refundedPence = booking.price_at_booking` issues a full refund.
- [src/lib/stripe/checkout.ts](src/lib/stripe/checkout.ts) — `createBookingCheckoutSession` builds the Stripe Checkout Session. Line items currently pass `unit_amount: priceInPence` directly.
- [src/lib/email/templates/booking-confirmation.ts](src/lib/email/templates/booking-confirmation.ts) — confirmation email template.

---

## Required design output

Architect must produce `SYSTEM-DESIGN-refund-fee-deduction.md` in the repo root (or `docs/`, following whatever pattern other SYSTEM-DESIGN docs use — check first). It must cover the following sections.

### 1. Schema migration

Decide:

- **New column on `bookings`:** `booking_fee_pence integer NOT NULL DEFAULT 0`. Stores the fee we **charged** the customer on top of `price_at_booking`. Set at row creation in `book_event_paid()` RPC.
- **New column on `bookings`:** `stripe_fee_pence integer NOT NULL DEFAULT 0`. Stores the **actual** Stripe processing fee captured by the webhook from the BalanceTransaction. Used only for reporting / admin reconciliation — **NOT used in the refund formula** (we always refund `price_at_booking`, see locked decision 5).
- Anon-visibility decision per CLAUDE.md "secure-by-default" rule: both new columns are PII-adjacent (transaction internals). **Omit from anon GRANT.** Authenticated users see their own via existing RLS.
- Idempotent migration (`ADD COLUMN IF NOT EXISTS`).
- Single CHECK constraint? — `booking_fee_pence >= 0` and `stripe_fee_pence >= 0`. Decide whether to add or leave to application-layer validation. (My read: add them; cheap defence.)
- Migration filename: next-in-sequence, e.g., `20260518000001_add_bookings_fee_columns.sql`.

### 2. Helper / single source of truth for the fee formula

Decide where the formula lives:

- A pure TS function in `src/lib/utils/booking-fee.ts` (recommended — testable, shared between Server Action, webhook, UI).
- Or as a Postgres function (only worth it if the RPC needs to compute it server-side and we don't want the route handler doing it).

Recommend: TS helper. The RPC `book_event_paid()` already takes parameters from the Server Action — pass the pre-computed fee in. Keep the formula in one place.

Constants the helper needs (open question — architect decides whether these are env vars, `lib/constants.ts` entries, or hard-coded in the helper):
- Stripe percentage (1.5% domestic; consider whether to make this configurable)
- Stripe flat (20p)
- Round-up granularity (10p)

### 3. Changes to `book_event_paid()` RPC (or its caller)

Two options:

- **A: pass `booking_fee_pence` as a new RPC argument.** Server Action computes the fee from the event price, passes it in. RPC just persists it. Pros: keeps fee logic out of the DB. Cons: trust the caller to pass the right value.
- **B: compute fee inside the RPC.** RPC reads the event price, computes the fee, persists both. Pros: single source of truth at the DB layer. Cons: duplicates the formula in TS (for display) and SQL (for storage).

Recommend **A**. The TS helper is the single source of truth; the RPC just stores what it's told. Tests cover that the Server Action passes the right value.

### 4. Changes to `createBookingCheckoutSession`

- Add `bookingFeePence` to `CheckoutSessionInput`.
- Change Stripe line_items.unit_amount from `priceInPence` to `priceInPence + bookingFeePence`.
- **Decision needed:** one line item or two?
  - **One line item** (cleaner, shows "£20.60" total in Stripe Checkout): set `unit_amount = price + fee`, `product_data.name = eventTitle`. User sees a single price.
  - **Two line items** (more transparent in Stripe Checkout, but ugly): one for the ticket, one for the booking fee.
  
  Locked decision 1 ("inclusive total") leans toward one line item, but Stripe Checkout will then show only the combined number. Our own pre-checkout UI is where we disclose the breakdown. Architect decides; document the choice.

### 5. Changes to webhook handler (`checkout.session.completed`)

Today the webhook updates the booking row but doesn't capture the actual Stripe fee. Add:

- After confirming the booking, retrieve the PaymentIntent with `expand: ['latest_charge.balance_transaction']`.
- Write the BalanceTransaction's `fee` field to `bookings.stripe_fee_pence`.
- This is for reporting only — the refund formula uses `price_at_booking`, not `stripe_fee_pence`.
- One extra Stripe API call per successful checkout. Latency is irrelevant in a webhook.
- If the BalanceTransaction lookup fails (network blip, race), log + continue — confirmation must not be blocked by reporting metadata.

### 6. Changes to `cancelBooking` Server Action

[src/app/events/[slug]/actions.ts:729](src/app/events/[slug]/actions.ts:729):

- **No change to the formula** per locked decision 5: `refundedPence = booking.price_at_booking`.
- **What MUST change:** the refund call. Currently the code does NOT pass an `amount` to `stripe.refunds.create`, which means Stripe issues a **full refund of the charge** (i.e., refunds `price + fee`, not just `price`). The fix is to pass an explicit `amount: refundedPence` so the refund stops at the ticket price.
- Update the JSDoc to reflect the new behaviour: "Refunds the ticket price. The booking fee is non-refundable on user cancellations."
- The cancellation confirm dialog UX must already say "You'll be refunded £X.XX. The £Y.YY booking fee covers card processing and isn't refundable." — the frontend prompt will pick this up.

### 7. New flow: admin cancels an event

Today: there is no admin-cancel-an-event Server Action that bulk-refunds its bookings. Admin event CRUD (event soft-delete, status change) likely exists but doesn't trigger refunds. Find the existing admin event actions in `src/app/(admin)/admin/actions.ts` and decide:

- New Server Action `cancelEventAndRefundBookings(eventId, reason)` — admin-only (existing admin-auth guard helper), iterates all `status = 'confirmed'` bookings for the event, refunds each at `price_at_booking + booking_fee_pence` (full amount — per locked decision 3, we eat the fee).
- Refund call passes `amount: price + booking_fee_pence`.
- Reconciles each booking row (`status = 'cancelled'`, `refunded_amount_pence = price + booking_fee_pence`, `cancelled_at`, `refunded_at`, `stripe_refund_id`).
- Records `cancellation_reason = 'admin_event_cancelled'` (or similar machine-readable token) so admin reporting can isolate platform-absorbed costs.
- Sends a "your event was cancelled" email to each affected member. New email template needed if one doesn't exist.
- Handle failure modes: a refund mid-loop fails, what then? Recommend: don't abort the whole batch — record failures, ACK back to the admin UI with a "X of Y refunded, see audit log" message and the failed ids surfaced for retry.

### 8. UI surfaces (frontend agent will implement — architect just enumerates)

List every place the fee needs to surface, with the exact copy pattern. The frontend prompt I write after the architect handover will pick these up. At minimum:

- **Event card / event detail page** — price display. Either `£20 (+ booking fee)` footnote or `£20.60 total` depending on what reads cleanest. Architect picks; document the recommendation.
- **BookingModal / BookingSidebar** (paid events only) — final breakdown before "Continue to payment" CTA. Pattern: `Ticket £20.00 / Booking fee £0.60 / Total £20.60`.
- **Stripe Checkout** — handled by line-item config in section 4.
- **Booking confirmation email** — show breakdown: ticket + fee = total.
- **Cancellation confirm dialog** — `"You'll be refunded £20.00 to your card. The £0.60 booking fee covers card processing and isn't refundable. Refunds take 5–10 working days to appear."`
- **Admin: event-cancellation confirm modal** — `"This will cancel the event and refund £X.XX to N members (including booking fees we absorb)."` Confirm before firing the bulk refund.

### 9. Reporting / admin visibility (out of scope for THIS spec — note as follow-up)

Once `stripe_fee_pence` is captured, an admin dashboard could show gross revenue, Stripe fees, refunds (member vs admin-initiated), and net. Out of scope for this spec — note as a follow-up so we don't lose sight of it.

### 10. Documentation updates required

- **CLAUDE.md** — "What's Real vs Mocked" table currently says Stripe is MOCKED. Update to "REAL — Stripe Checkout live in production. Booking fee absorbed via inclusive total; see SYSTEM-DESIGN-refund-fee-deduction.md."
- **SYSTEM-DESIGN.md** — if a master one exists, link the new spec from it.

---

## Edge cases the architect must address

1. **Race: user clicks Cancel twice fast.** Stripe idempotency key already in place ([line 725](src/app/events/[slug]/actions.ts:725)). New behaviour shouldn't break this.
2. **`charge.refunded` webhook fires for a partial refund** (we now issue partial refunds — `price` not `price + fee`). Confirm the webhook handler in [src/app/api/stripe/webhook/route.ts:281](src/app/api/stripe/webhook/route.ts:281) correctly records `refunded_amount_pence = refund.amount` for the partial case. Today it does — the field already takes whatever Stripe sends.
3. **Admin issues a refund manually in Stripe dashboard** for the full amount including booking fee. Webhook fires `charge.refunded` with the full charge amount; the booking row gets `refunded_amount_pence = charged_amount`. Sane. But it means the admin can manually override the "fee is non-refundable" policy from the Stripe dashboard if they want — document this as an intentional escape hatch, not a bug.
4. **Refund window = 0** (non-refundable). No refund issued. `booking_fee_pence` still set on the row (audit trail of what they paid). Cancellation still flips status to `cancelled`. Existing behaviour preserved.
5. **Free event with `price_at_booking = 0`:** `booking_fee_pence = 0`. No Stripe involved. No change to existing flow.
6. **What if `booking_fee_pence` is somehow > 0 on a free-event row?** CHECK constraint or RPC guard? Recommend an `assert (price_at_booking = 0) → (booking_fee_pence = 0)` check at the RPC level.
7. **VAT.** UK admission to cultural events can be 0/exempt; live music is 20%. Out of scope for this spec — flag as a follow-up. The booking fee itself, if treated as a service charge, is 20% VAT inclusive when we cross the threshold. Defer.
8. **Refund delta — actual Stripe fee > our displayed fee** (e.g., AmEx or international card). We absorb the difference. Already covered by the formula's positive margin on UK Visa/MC. Acceptable. Document so we don't bug-report it later.
9. **Stripe rate changes** in the future. The formula constants live in code — one PR to update. No DB migration needed because we don't snapshot the rate, just the actual fee.
10. **Existing `pending_payment` bookings at the time the migration runs.** They'll default to `booking_fee_pence = 0` but the Stripe Checkout session was created with `unit_amount = price` (old code). Architect must decide: do we cancel pending sessions on migration deploy, or let them complete at the old price and accept the one-time fee loss on those bookings? Recommend: let them complete. Pending sessions auto-expire after 30 min anyway (per [checkout.ts:188](src/lib/stripe/checkout.ts:188)).

---

## Out of scope (intentional — architect must not expand into these)

- Reporting dashboards using `stripe_fee_pence` (follow-up).
- VAT handling (follow-up).
- Multi-currency (we're GBP-only).
- Auto-promoting waitlisters when an admin cancels an event (different question — the event doesn't exist any more).
- Refund retry queue with admin UI (overkill for v1; failed refunds surface to admin via existing logs + Sentry).
- Changing the per-event `refund_window_hours` admin UI (out of scope, separate work).
- Adding `application_fee_amount` / Stripe Connect (we're direct charges, not a marketplace).

---

## Done checklist for the architect

- [ ] `SYSTEM-DESIGN-refund-fee-deduction.md` written, covering all 10 sections above.
- [ ] Migration SQL drafted (not run — backend agent runs it).
- [ ] Anon-visibility decision recorded for both new columns, with the migration header comment template ready to drop in.
- [ ] Fee formula helper signature defined (`calculateBookingFeePence(eventPricePence: number): number`).
- [ ] `book_event_paid()` RPC change documented (signature change if option A; SQL change if option B).
- [ ] Webhook handler diff sketched for the BalanceTransaction lookup.
- [ ] `cancelBooking` diff sketched (one-line behaviour change + JSDoc update).
- [ ] `cancelEventAndRefundBookings` Server Action contract defined: arguments, return type, error cases.
- [ ] UI copy strings finalised for all 5+ surfaces (frontend agent pastes these verbatim).
- [ ] All 10 edge cases explicitly addressed in the spec (decision or "intentionally deferred — reason").
- [ ] Open questions (if any) listed at the top for the user to resolve before backend implementation starts.

---

## What I (planner) will do after architect handover

1. Read the spec, sanity-check it against the codebase as it actually is right now.
2. Surface any open questions to the user.
3. Write the backend-developer prompt anchored on the spec's migration + Server Action contracts.
4. Hand off to frontend, tester, reviewer in sequence per the JIT-prompts rule (each prompt drafted only after the prior handover lands).
