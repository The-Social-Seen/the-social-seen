# Feature: refund-fee deduction — backend implementation

**Agent:** `/project:backend-developer`. Hand off to `/project:frontend-developer` next (NOT tester directly — frontend changes are part of the spec and depend on the new RPC signatures + TS helper this agent lands), then `/project:tester`, then `/project:code-reviewer`.
**Branch to create:** `feat/refund-fee-deduction` from latest `main`.
**Type:** Feature. Two new migrations, one new TS helper, four Server Action / library changes, webhook handler expansion, one new email template, one existing email template update, doc updates.

**Origin:** Architect spec at [SYSTEM-DESIGN-refund-fee-deduction.md](SYSTEM-DESIGN-refund-fee-deduction.md), produced 2026-05-17 from [prompts/feature-refund-fee-deduction-architect.md](prompts/feature-refund-fee-deduction-architect.md). All three Open Questions resolved with the architect's recommended defaults — proceed as the spec is written.

---

## Single source of truth

**Read [SYSTEM-DESIGN-refund-fee-deduction.md](SYSTEM-DESIGN-refund-fee-deduction.md) before touching code.**

Every implementation decision is in there. This prompt is your dispatch sheet — what to build, in what order, with what tests, what to NOT touch. Where this prompt and the spec disagree, the spec wins. Where the spec says "backend-developer decides", make the call and document why in code comments.

---

## Required reading order

1. [SYSTEM-DESIGN-refund-fee-deduction.md](SYSTEM-DESIGN-refund-fee-deduction.md) — the whole thing. Long but pre-decided.
2. **CLAUDE.md** — design tokens (you won't touch UI, but you will touch email templates and they share the brand palette), schema rules, database non-negotiables (every table RLS, every column anon-visibility decision documented in migration header).
3. **social-seen-safety-SKILL.md** if it exists at repo root.
4. The existing migrations the spec references — at minimum:
   - [supabase/migrations/20260422000001_stripe_payments_schema.sql](supabase/migrations/20260422000001_stripe_payments_schema.sql)
   - [supabase/migrations/20260422000002_book_event_paid_rpc.sql](supabase/migrations/20260422000002_book_event_paid_rpc.sql)
   - [supabase/migrations/20260422000003_bookings_cancellation_columns.sql](supabase/migrations/20260422000003_bookings_cancellation_columns.sql)
   - [supabase/migrations/20260422000004_claim_waitlist_spot_rpc.sql](supabase/migrations/20260422000004_claim_waitlist_spot_rpc.sql) — you'll be re-creating this RPC with the new arg.
5. [src/app/api/stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) — both handlers.
6. [src/app/events/[slug]/actions.ts](src/app/events/[slug]/actions.ts) — `cancelBooking` (~line 635) and the booking-creation Server Action (search for `book_event_paid` calls).
7. [src/lib/stripe/checkout.ts](src/lib/stripe/checkout.ts) — `createBookingCheckoutSession`.
8. [src/app/(admin)/admin/actions.ts](src/app/(admin)/admin/actions.ts) — find existing `cancelEvent()` (~line 804–828 per architect).
9. [src/lib/email/templates/booking-confirmation.ts](src/lib/email/templates/booking-confirmation.ts) and the rest of `src/lib/email/templates/` to match the house style.
10. Existing `cancelBooking` tests at [src/app/events/[slug]/__tests__/actions.test.ts](src/app/events/[slug]/__tests__/actions.test.ts) — you'll be tightening the Stripe mock assertions.

---

## Implementation order (recommended)

The spec covers what to build. This is the order I want it done so the diff stays bisectable if something breaks.

### Phase A — Schema and helper (foundation)

1. **Migration: `supabase migration new add_bookings_fee_columns`**
   - Add `bookings.booking_fee_pence integer NOT NULL DEFAULT 0`
   - Add `bookings.stripe_fee_pence integer NOT NULL DEFAULT 0`
   - Add 3 CHECK constraints per spec §1.3 (non-negative, free-event-implies-zero-fee, etc.)
   - Anon visibility: **omit both columns from anon GRANT** per CLAUDE.md secure-by-default rule. Header comment must justify this explicitly.
   - Migration header comment: follow the verbose style of `20260422000003_bookings_cancellation_columns.sql`. Spell out semantics of each column, idempotency strategy, anon decision.

2. **Migration: `supabase migration new book_event_paid_with_fee`**
   - DROP + recreate `book_event_paid(uuid, uuid)` as `book_event_paid(uuid, uuid, integer)` with `p_booking_fee_pence` as third arg, persisted to the new column.
   - DROP + recreate `claim_waitlist_spot()` with the same fee-arg treatment. **Do not forget this** — architect's spec §3.4 calls it out specifically because the parallel update is the easiest thing to miss in this batch.
   - Keep all existing locking (`FOR UPDATE`) and idempotency semantics intact — you're adding an arg, not changing the algorithm.
   - SECURITY DEFINER `search_path` posture: follow the spec's recommendation. Per my project memory, precedents (`book_event`, `book_event_paid`, `claim_waitlist_spot`) use `search_path = public` only. Stay consistent with those — do NOT tighten to `public, pg_catalog` here; that's a separate hardening PR.

3. **TS helper: `src/lib/utils/booking-fee.ts`**
   - Export `calculateBookingFeePence(eventPricePence: number): number`.
   - Formula from spec §2.2 — use the exact formula and the spec's rounding-up-to-10p logic.
   - Constants per spec §2.3 — co-locate in this file unless the spec says otherwise.
   - Pure function, no side effects, no I/O. Tester will write the unit tests in their batch; you do NOT need to write tests for THIS helper unless you want sanity coverage as you build. Backend's own integration tests in Phase D matter more.

### Phase B — Server-side wiring

4. **`src/lib/stripe/checkout.ts` — `createBookingCheckoutSession`**
   - Add `bookingFeePence: number` to `CheckoutSessionInput`.
   - Change `line_items[0].unit_amount` to `priceInPence + bookingFeePence`.
   - Add `booking_fee_pence` to both `metadata` and `payment_intent_data.metadata` (spec §4.4).
   - **Single line item, not two** — per OQ-3 resolved default.

5. **Booking Server Action** (where `createBookingCheckoutSession` is called — find the file via grep)
   - Import `calculateBookingFeePence` from `@/lib/utils/booking-fee`.
   - Compute `bookingFeePence = calculateBookingFeePence(event.price)`.
   - Pass it as the third arg to `book_event_paid` RPC.
   - Pass it to `createBookingCheckoutSession`.
   - **Same change in the waitlist-claim Server Action** — `claimWaitlistSpot`. Easy to miss. Architect flagged this.

6. **Webhook handler: [src/app/api/stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) — `handleCheckoutCompleted`**
   - After confirming the booking row, retrieve the PaymentIntent with `expand: ['latest_charge.balance_transaction']`.
   - Write `balance_transaction.fee` to `bookings.stripe_fee_pence` via a follow-up UPDATE (or merge into the existing UPDATE — backend decides).
   - If the BalanceTransaction lookup fails, log + continue. Do NOT block booking confirmation. The spec's §5.4 covers this.
   - **No change** to `handleChargeRefunded` — architect confirmed it already handles partial refunds correctly via `refunded_amount_pence = refund.amount`.

7. **`cancelBooking`: [src/app/events/[slug]/actions.ts:708-727](src/app/events/[slug]/actions.ts)**
   - Add `amount: booking.price_at_booking` to the `stripe.refunds.create` call.
   - Update JSDoc per spec §6.3.
   - **That's it** — `refundedPence = booking.price_at_booking` on line 729 was already correct. The DB UPDATE block is unchanged.

8. **New Server Action: `cancelEventAndRefundBookings`** in `src/app/(admin)/admin/actions.ts`
   - Full contract in spec §7. Read it carefully.
   - Refund amount per booking: `price_at_booking + booking_fee_pence` (full — platform eats Stripe fee per locked decision 3).
   - Use admin-auth guard helper (whatever the existing admin actions use — grep for the pattern).
   - Iterate bookings; don't abort on individual failures. Return per-booking outcomes so the admin UI can show a partial-success state.
   - `cancellation_reason = 'admin_event_cancelled'` on every refunded row.
   - Fire-and-forget the "your event was cancelled" email per affected member (new template, see Phase C).
   - **Do NOT remove existing `cancelEvent()`** — architect's call (spec §0 surprise #5). The admin UI will be wired to the new action by the frontend agent; the old one stays as a no-refund path for draft cancellations.

### Phase C — Emails

9. **New template: `src/lib/email/templates/event-cancelled.ts`**
   - Pattern-match the existing templates (`booking-confirmation.ts`, `waitlist-spot-available.ts`) — `_shared.ts` palette, subject/html/text triple.
   - Content: per spec §8 (the architect's UI copy section will include the email body; if not, write a tight first pass — frontend agent will polish in their batch).
   - State the refund clearly: "We're refunding £X.XX to your card. This usually arrives within 5-10 working days."

10. **Update: `src/lib/email/templates/booking-confirmation.ts`**
    - Add a line breaking down ticket + fee + total in the confirmation email body. Spec §8 will dictate the wording.

### Phase D — Tests (backend's own — tester adds full coverage later)

11. **Tighten `cancelBooking` tests at [src/app/events/[slug]/__tests__/actions.test.ts](src/app/events/[slug]/__tests__/actions.test.ts)**
    - Existing tests that mock `refunds.create` must now assert it was called with `amount: <price_at_booking>`. The architect specifically called this out as the test gotcha that let the bug ship.
    - Add a new case: "paid booking at £20 + 60p fee, cancel >48h out → refund called with `amount: 2000`, `refunded_amount_pence = 2000` in the UPDATE".
    - Existing "cancel inside refund window" test confirms `refunds.create` is still NOT called.

12. **Webhook test additions** at [src/app/api/stripe/webhook/__tests__/route.test.ts](src/app/api/stripe/webhook/__tests__/route.test.ts)
    - Mock `paymentIntents.retrieve` with the BalanceTransaction expansion.
    - Assert `stripe_fee_pence` written to the booking row on `checkout.session.completed`.
    - Add a "BalanceTransaction lookup throws → booking still confirmed, stripe_fee_pence stays 0, error logged" case.

13. **New tests for `cancelEventAndRefundBookings`** in `src/app/(admin)/admin/__tests__/actions-write.test.ts` (or whichever admin test file matches the existing layout)
    - Happy path: 3 confirmed bookings, all refunded full amount, cancellation reason set, emails fired.
    - Partial-failure path: 1 of 3 refund calls throws — 2 booked, 1 surfaced in return value.
    - Authorisation: non-admin caller is rejected.
    - **Do NOT** test `cancelEvent()` — its behaviour is unchanged.

---

## Documentation updates (mandatory — don't skip)

14. **CLAUDE.md "What's Real vs Mocked" table** (around line 316 per architect)
    - Change the Stripe row to REAL with a one-liner about the inclusive booking fee.
    - Per architect's surprise #8: the email row is **also stale** — Resend is live. Fix it in the same commit. Two-row tidy.
    - Cross-link to `SYSTEM-DESIGN-refund-fee-deduction.md` from the Stripe row.

15. **`SYSTEM-DESIGN.md`** at repo root (if it exists)
    - Add a one-line ADR cross-reference per the architect's spec §10 — they wrote what it should say.

16. **`docs/FOLLOW-UPS.md`** (or wherever follow-ups live — grep first)
    - Add entries for: VAT handling, reporting dashboard using `stripe_fee_pence`, admin-cancels-mid-checkout race mitigation, admin-cancelled-event runbook, refund-retry queue.

---

## Verification before reporting done

1. `pnpm tsc --noEmit` — zero errors.
2. `pnpm lint` — clean. **And**: defensive `// eslint-disable-next-line react-hooks/set-state-in-effect` if you touch any `useEffect` with direct `setState`. Per my project memory, CI lint is stricter than local — don't trust local zeros.
3. `pnpm test` — full suite passes. Specifically the four added/tightened test files from Phase D.
4. `pnpm build` — succeeds.
5. **Migration sanity** — `supabase start && supabase db reset` locally (the safe local reset, not prod), confirm both new migrations apply cleanly, then re-run the test suite against the fresh schema. If you don't have local Supabase, document why and let the user know — they can verify on a preview deploy.
6. Manually trace the data flow on paper: paid booking from `book_event_paid(uuid, uuid, integer)` → `bookings.booking_fee_pence` set → Stripe Checkout charges `price + fee` → webhook writes `stripe_fee_pence` → user cancels → `refunds.create({ amount: price })` → `refunded_amount_pence = price` → `chk_bookings_refund_consistency` satisfied. Write a one-paragraph audit of this in your handover summary.

---

## What this PR does NOT do (intentional — frontend / tester picks these up)

- **No UI changes** to `BookingSidebar`, `BookingModal`, event cards, event detail pages, cancellation-confirmed page, or the admin event-cancel UI button. The frontend agent owns all of those — they're already enumerated in spec §8.
- **No backfill** of `booking_fee_pence` for existing bookings (locked decision 2).
- **No reporting dashboard** using `stripe_fee_pence` (deferred — see Phase C #16 follow-ups).
- **No VAT handling** (deferred).
- **No refund-retry queue** (deferred — failed refunds still surface to Sentry).
- **No SECURITY DEFINER `search_path` tightening** — separate hardening PR.
- **No Stripe `application_fee_amount`** — we're direct charges, not a marketplace.
- **No removal of existing `cancelEvent()`** — it stays as the no-refund path for draft cancellations.

---

## PR description requirements

Your PR description **must** include:

1. A "Required post-merge" section with the command:
   ```
   supabase db push --include-all --linked
   ```
   Per my project memory: CI applies migrations to local Supabase only; every migration PR needs this manual step against prod after merge. Without this, the migrations will not be in production.

2. A note that the `STRIPE_API_VERSION` / SDK type defs may need a refresh if `latest_charge.balance_transaction` expansion isn't already typed in the project's Stripe SDK version. Flag if you hit this.

3. The link to the spec doc and the architect's surprises list.

4. Conventional commit prefix: `feat(payments):` — e.g., `feat(payments): non-refundable booking fee absorbs Stripe processing cost on cancellation`.

---

## Done checklist (paste this filled-in to your handover)

- [ ] Branch `feat/refund-fee-deduction` created from `main`.
- [ ] Migration `add_bookings_fee_columns.sql` written, idempotent, anon decision documented in header.
- [ ] Migration `book_event_paid_with_fee.sql` written; DROPs + recreates both `book_event_paid` AND `claim_waitlist_spot` with the new arg.
- [ ] `src/lib/utils/booking-fee.ts` helper written; matches spec §2.2 formula and §2.3 constants location.
- [ ] `createBookingCheckoutSession` accepts `bookingFeePence`; line_items use `price + fee`; metadata records the fee.
- [ ] Booking Server Action computes fee from event price and passes to RPC + Checkout.
- [ ] `claimWaitlistSpot` Server Action does the same — fee passed through. **Don't ship without this.**
- [ ] Webhook `handleCheckoutCompleted` retrieves the PaymentIntent with BalanceTransaction expansion; writes `stripe_fee_pence`; failure of the lookup does not block confirmation.
- [ ] `cancelBooking` passes `amount: booking.price_at_booking` to `refunds.create`. JSDoc updated per spec §6.3.
- [ ] `cancelEventAndRefundBookings` Server Action implemented per spec §7 — admin guard, per-booking iteration, full-amount refund, cancellation reason, per-member email, partial-failure return shape.
- [ ] New email template `event-cancelled.ts` written; existing `booking-confirmation.ts` shows fee breakdown.
- [ ] `cancelBooking` test mocks now assert `refunds.create` was called with the explicit `amount`. New 2000p-refund test passes.
- [ ] Webhook tests cover BalanceTransaction success path + failure-tolerated path.
- [ ] `cancelEventAndRefundBookings` tests cover happy path, partial-failure, and unauthorised caller.
- [ ] CLAUDE.md "What's Real vs Mocked" updated for **both** Stripe and email rows; Stripe row cross-links to the spec.
- [ ] `docs/FOLLOW-UPS.md` (or equivalent) updated with five entries from spec §9.
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm test` passes.
- [ ] `pnpm build` succeeds.
- [ ] Local migration sanity check done (or explicit note if not possible).
- [ ] PR description includes the post-merge `supabase db push` command and the architect-surprises summary.
- [ ] Conventional commit: `feat(payments): non-refundable booking fee absorbs Stripe processing cost on cancellation`.

---

## After your handover

I'll review your diff, then write the frontend prompt anchored on the actual signatures and types you've shipped (per the JIT-prompts rule, downstream prompts are written after the prior agent lands real code). Surface anything in the spec that turned out to be impossible / awkward when you actually hit it — I'd rather hear about it now than discover it in code review.
