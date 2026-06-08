# SYSTEM-DESIGN — Zero-Total (100%-off coupon) Comp Bookings

**Status:** Approved for implementation
**Author:** architect
**Date:** 2026-06-08
**Owner of next step:** backend-developer (then tester)
**Scope:** Fix the Stripe webhook so a 100%-off promotion code (full comp) confirms a paid-event booking end-to-end. Out of scope: partial coupons (flagged below as a separate latent bug).

---

## 1. Problem statement + confirmed root cause

The founder wants to comp new members their first event using **Stripe-Dashboard-managed 100%-off promotion codes** (`allow_promotion_codes: true`; no app-side discount state by design). They tried it on a real paid event and the booking stranded in `pending_payment` and never confirmed.

**Root cause (confirmed against current Stripe docs — see §9 Sources):** for a `mode: 'payment'` Checkout Session whose total is reduced to £0 by a 100%-off promotion code, Stripe:

- sets `session.payment_status = 'no_payment_required'` (NOT `'paid'`),
- does **not** create a PaymentIntent — `session.payment_intent` is `null`
  ("Completed Checkout Sessions that are free won't have an associated PaymentIntent" — Stripe docs),
- still fires `checkout.session.completed` with `session.status = 'complete'` and `session.amount_total = 0`
  ("To fulfill no-cost orders, make sure to handle the `checkout.session.completed` event rather than PaymentIntent events" — Stripe docs).

`handleCheckoutCompleted` in `src/app/api/stripe/webhook/route.ts` rejects this twice and returns early before the confirm UPDATE:

- `route.ts:118` — `if (session.payment_status !== 'paid') return` trips on `'no_payment_required'`.
- `route.ts:132` — `if (!paymentIntentId) return` would also trip (PI is null).

So the `pending_payment → confirmed` UPDATE (`route.ts:147`) never runs. Downstream:

- **Invisible seat:** `event_with_stats.confirmed_count` counts only `status='confirmed'` (`20260507000002_add_revenue_to_event_with_stats.sql:66`); `spots_left = capacity − confirmed_count`. A `pending_payment` row is invisible, so the event still shows free spots / no waitlist pressure.
- **Auto-cancelled:** the reaper (`reap_stale_pending_bookings()` in `20260515095343_reaper_pgcron_schedule.sql:102-105`, mirrored in `src/app/api/admin/cron/reap-stale-bookings/route.ts:108-111`) cancels `pending_payment` rows with `stripe_payment_id IS NULL` older than 35 min. The comp booking is silently reaped.

The fix is **webhook-only** (plus tests). No migration, no RPC change, no client change. Reasoning for each below.

---

## 2. The change to `handleCheckoutCompleted` (decision logic — prose/pseudocode, no TS)

Replace the two early-return gates (`route.ts:118` and `route.ts:132`) with a single fulfillment-eligibility decision derived from Stripe's own recommendation (`payment_status != 'unpaid'`), tightened for our context, plus a **£0-aware confirm UPDATE**.

### 2.1 Eligibility gate

After reading `bookingId` from `session.metadata.booking_id` (unchanged — still hard-reject when absent), decide:

```
isPaidSession  := session.payment_status === 'paid'
isCompSession  := session.payment_status === 'no_payment_required'
                  AND session.status === 'complete'
                  AND session.amount_total === 0

if NOT (isPaidSession OR isCompSession):
    log.warn("checkout.session.completed not fulfillable", payment_status, status, amount_total)
    return            // genuinely unpaid / abandoned / inconsistent → do nothing
```

Rationale for the tightened comp check (vs Stripe's bare `!= 'unpaid'`):

- `status === 'complete'` excludes `expired`/`open` sessions that could theoretically surface `no_payment_required` mid-lifecycle. We only fulfill a *completed* session.
- `amount_total === 0` is the positive signal that this is a genuine full comp, not some other `no_payment_required` shape. It also drives the revenue value in §2.3 — read it once, use it for both the gate and the price.
- We deliberately do **not** fold `'unpaid'` into the eligible set. `'unpaid'` means a payment is expected but hasn't landed (e.g. delayed/async methods) — confirming that would oversell. Reject it, same as today.

### 2.2 Resolve the PaymentIntent (now optional)

```
paymentIntentId := session.payment_intent (as string | id) ?? null
```

For a comp session this is `null` and that is expected — do **not** reject on null any more. Keep the value; it gates the fee-capture and the `stripe_payment_id` write below.

### 2.3 The confirm UPDATE (£0-aware — sets BOTH money columns)

The current UPDATE sets `status`, `stripe_payment_id`, `waitlist_position`. Two changes:

1. **`stripe_payment_id`** — set to `paymentIntentId` (the PI string for paid; **`null` for comp**). Leaving it null for comp is correct and intentional: there is no PaymentIntent to record, refunds never apply (§4.4), and the reaper's `stripe_payment_id IS NULL` predicate is harmless once the row is `confirmed` (§4.7).

2. **`price_at_booking`** — set to `session.amount_total` **only on the comp path**; leave untouched on the paid path.
   - Paid path: do NOT write `price_at_booking`. The RPC snapshot (full face value) already equals what Stripe charged (we pass `priceInPence + bookingFeePence` as one line item with no coupon), so the snapshot is correct. Writing it would be a no-op at best and risks decomposition ambiguity (§5).
   - Comp path: `session.amount_total` is `0`. Set `price_at_booking = 0`.

   > **LOAD-BEARING — must zero `booking_fee_pence` TOO on the comp path.**
   > `bookings` has CHECK `chk_bookings_free_no_booking_fee`:
   > `price_at_booking > 0 OR booking_fee_pence = 0`
   > (`20260517000001_add_bookings_fee_columns.sql:99-101`).
   > `book_event_paid` stamped a **non-zero** `booking_fee_pence` at creation (the event has a real price; the comp only happens later at Stripe). Setting `price_at_booking = 0` while `booking_fee_pence` stays non-zero **violates the CHECK (23514)** and the whole UPDATE fails → booking stays `pending_payment` → reaped. So the comp UPDATE MUST set `booking_fee_pence = 0` in the same statement.
   > With both at 0: `0 > 0 OR 0 = 0` → `TRUE` ✓; `price_at_booking` stays NON-NULL (column is `NOT NULL`) ✓; the view's `SUM(price_at_booking)` adds 0 ✓.

Pseudocode for the UPDATE payload:

```
updatePayload := {
  status: 'confirmed',
  waitlist_position: null,
  stripe_payment_id: paymentIntentId,        // null on comp path
}
if isCompSession:
  updatePayload.price_at_booking  = 0        // == session.amount_total
  updatePayload.booking_fee_pence = 0        // REQUIRED to satisfy chk_bookings_free_no_booking_fee

admin.from('bookings')
  .update(updatePayload)
  .eq('id', bookingId)
  .eq('status', 'pending_payment')           // idempotency guard (see §4.2) — UNCHANGED
  .select('id, user_id, event_id')
  .maybeSingle()
```

The `.eq('status','pending_payment')` optimistic guard is **retained verbatim** — it is the primary idempotency mechanism for the comp path (§4.2).

### 2.4 Post-confirm side-effects (fee capture + email) — guard on PI

```
if NOT updated: return            // already processed / rolled back — UNCHANGED

if paymentIntentId is not null:
    await captureStripeFeeForBooking({ bookingId: updated.id, paymentIntentId })   // §4.5
// else: comp — skip; there is no PaymentIntent and no Stripe fee to capture.

void sendPaidBookingConfirmationEmail({ userId: updated.user_id, eventId: updated.event_id })  // §4.6 — still fires
```

### 2.5 23505 duplicate-PI branch

Keep the existing `if (updErr.code === '23505') return` handler (`route.ts:167`). On the comp path `stripe_payment_id` is null so the `ux_bookings_stripe_payment_id` partial index cannot fire 23505 — the branch is simply unreachable for comp, not harmful. (It still protects the paid path.) No change.

---

## 3. Migrations — NONE required (confirmed)

The founder's suspicion is correct: **no migration is needed.** Verified against the live schema:

| Column | Definition | Comp write | Verdict |
|---|---|---|---|
| `stripe_payment_id` | `text` nullable (`20260422000001:41`) | leave `null` | OK, already nullable |
| `price_at_booking` | `integer NOT NULL DEFAULT 0` (`20260402000006:13`) | set `0` | OK — 0 is non-null, satisfies NOT NULL |
| `booking_fee_pence` | `integer NOT NULL DEFAULT 0` (`20260517000001:68`) | set `0` | OK — required to satisfy CHECK (§2.3) |
| `event_with_stats.revenue_collected` | `SUM(price_at_booking) WHERE status='confirmed'` (`20260507000002:64-66`) | adds `0` | OK — accurate; comp contributes £0 |
| `event_with_stats.confirmed_count` / `spots_left` | counts `status='confirmed'` | row now confirmed | OK — seat becomes visible |

CHECK constraints reviewed: `chk_bookings_waitlist_position` (set null → OK), `chk_bookings_refund_consistency` (`refunded_amount_pence=0` default → OK), `chk_bookings_booking_fee_non_negative` / `chk_bookings_stripe_fee_non_negative` (0 → OK), `chk_bookings_free_no_booking_fee` (both money cols 0 → OK). RLS unchanged — webhook uses the admin client (caller is Stripe, no `auth.uid()`); this is the established and correct trust boundary.

Because there is no migration, the usual post-merge `supabase db push --include-all --linked` step (CLAUDE.md / `project_migration_apply_step`) **does not apply** to this change. Ship is webhook code + tests only. (Operational note: the fix takes effect the moment the new webhook code deploys to Vercel — no DB step gates it.)

---

## 4. Edge cases — resolutions

**1. Webhook confirmation for £0.** Resolved in §2.1–§2.3. Confirm on `payment_status='no_payment_required' AND status='complete' AND amount_total=0`, even with null `payment_intent`. The triple-gate distinguishes a legitimately-confirmable full comp from a genuinely-unpaid/abandoned session (`unpaid`, or non-`complete` status) which is still rejected.

**2. Idempotency WITHOUT a PaymentIntent.** Confirmed: the `.eq('status','pending_payment')` guard alone is sufficient for comp re-delivery. The `ux_bookings_stripe_payment_id` index does NOT dedupe comp rows (their `stripe_payment_id` is null; the index is partial `WHERE stripe_payment_id IS NOT NULL`). Sequence on re-delivery: first delivery flips `pending_payment → confirmed`; second delivery's UPDATE matches `id = bookingId AND status = 'pending_payment'` → **0 rows** → `updated` is null → handler returns at the `if (!updated) return` branch. No double-confirm, no double-email-from-a-second-confirm (the email is fire-and-forget off a successful confirm only). This is the same optimistic-lock pattern already relied on across `cancelBooking`, `abandonPendingCheckout`, and the paid webhook path. State explicitly: **comp idempotency rests entirely on the status guard; that is by design and is sufficient.**

**3. Revenue correctness (RECOMMENDED DEFAULT — adopted).** Record actual cash: set `price_at_booking = session.amount_total (= 0)` on the comp path so `revenue_collected` is accurate (a comp contributes £0, which is the truth). **Scope this to the £0/100% case ONLY.** Do NOT reconcile partial coupons in this change — see §5 for why (decomposition of a discounted single line item into price-vs-fee is ambiguous). Recommendation: **fix only the full-comp case now; flag partial-coupon decomposition as a separate follow-up.**

**4. Refund/cancel path.** Confirmed clean. In `cancelBooking` (`actions.ts:737-738`), `isPaid = (price_at_booking ?? 0) > 0 && !!stripe_payment_id`. For a confirmed comp both operands are falsy (`price_at_booking = 0`, `stripe_payment_id = null`) → `isPaid = false` → `refundEligible = false` → **no `stripe.refunds.create` call**. The booking cancels with `refunded_amount_pence = 0`, satisfying `chk_bookings_refund_consistency`. Nothing attempts to refund £0. The waitlist-notify side-effect still fires correctly (the comp seat frees up). No change required to `cancelBooking`.

**5. `captureStripeFeeForBooking`.** Resolved in §2.4 — call it **only when `paymentIntentId` is not null**. Currently it is called unconditionally after confirm; on the comp path there is no PaymentIntent, so an unconditional call would pass `paymentIntentId: null` (or the literal string `"null"`) to `stripe.paymentIntents.retrieve` and throw — currently caught-and-logged, so harmless to the booking, but it is a guaranteed spurious error per comp. Guard it out. `stripe_fee_pence` stays at its `DEFAULT 0`, which is correct (Stripe took no fee on a £0 order).

**6. Confirmation email.** `sendPaidBookingConfirmationEmail` builds `priceBreakdown` only when `price_at_booking > 0` (`route.ts:330-338`). For a comp, `price_at_booking = 0` → `priceBreakdown = undefined` → the email sends with no price table. **Acceptable for this fix.** The member gets a correct "you're booked" email; it simply omits the £-breakdown, which is honest (they paid nothing). **LOW-PRIORITY follow-up (not in scope):** optionally branch copy to "Your complimentary spot is confirmed" for comp bookings. Recorded here; do not implement now.

**7. Reaper race.** Ordering guarantee: the comp booking is created `pending_payment` with `stripe_payment_id = null` by `book_event_paid` (synchronously, inside `createPaidCheckout`), then the user completes Stripe Checkout, then Stripe POSTs `checkout.session.completed` (seconds later) and the webhook flips it to `confirmed`. The reaper only cancels `pending_payment` rows **older than 35 minutes** (`created_at < now() - interval '35 minutes'`). The webhook confirms in seconds, far inside the 35-min floor, so a race is practically impossible. And once `confirmed`, the reaper's `status = 'pending_payment'` predicate excludes the row permanently. The only way to hit the reaper is if the webhook never arrives for 35 min (Stripe outage / endpoint down) — identical to the existing paid-flow risk, not new to comp, and the correct conservative outcome (free the seat). **No change to the reaper; predicate stays byte-identical across the SQL function and the manual-probe route** (per the SAFETY note in `reap-stale-bookings/route.ts:42-51`).

**8. `book_event_paid` unchanged?** Confirmed correct to leave as-is. The RPC runs at booking creation, **before** any coupon is applied at Stripe — it cannot know a promotion code will be entered, so it must snapshot the full face value (`price_at_booking = event.price`, plus the computed `booking_fee_pence`). The webhook is the **only** place that sees the actual collected amount (`session.amount_total`), so it is the correct and only place to reconcile down to the comp value. Note: `book_event_paid` rejects `v_price = 0` ("Use book_event for free events", `:110-112`) — a comp is therefore always a *paid-priced* event with a 100%-off code, never a £0-priced event. This is exactly the shape the webhook fix handles. No RPC change.

---

## 5. Scope boundary — OUT: partial coupons (latent bug FLAGGED, not fixed)

**In scope:** full comp only — `amount_total === 0` / 100%-off promotion codes.

**Out of scope:** partial coupons (e.g. 50% off). These already confirm fine today because `payment_status` is `'paid'` and a PaymentIntent exists — they sail through the existing paid path. **This fix deliberately does not touch them**, and the comp gate (`amount_total === 0`) excludes them.

### LATENT BUG (record — do NOT fix in this change)

For a partial coupon, the paid path leaves `price_at_booking` at the **full face value** snapshot from `book_event_paid`, but Stripe only collected the discounted amount. Two consequences:

1. **Revenue overcount:** `revenue_collected = SUM(price_at_booking)` counts the full face value, not the discounted cash actually collected.
2. **Over-refund risk:** `cancelBooking` refunds `amount: price_at_booking` (full face value) against a charge that only collected the discounted amount. Stripe would reject a refund exceeding the charge (so it likely errors rather than over-pays real money), but the cancellation would then **fail** for any partially-discounted booking — a real user-facing defect waiting to happen the moment a partial code is used on a cancellable event.

**Why not fix now:** decomposing a single discounted line item (we send `price + fee` as ONE line item, §`SYSTEM-DESIGN-refund-fee-deduction.md` §4) back into a discounted price-vs-fee split is ambiguous — Stripe applies the discount to the combined total, and there is no unambiguous rule for how much of the discount eroded the ticket vs the non-refundable fee. Resolving it properly needs a product decision (does a partial coupon discount the fee at all?) and likely a line-item restructure (separate price + fee line items so Stripe reports each post-discount amount). That is a **separate design + PR**.

**Recommendation:** ship the full-comp fix now; open a follow-up ("partial-coupon price reconciliation") capturing the two consequences above. The founder's stated use case (100%-off first-event comps) is fully served by the in-scope fix; partial coupons are not part of the current comp programme.

> Suggested follow-up note for `docs/FOLLOW-UPS.md` (backend-developer to add, not the architect's file to edit here): "Partial Stripe coupons leave `price_at_booking` at full face value → `revenue_collected` overcounts AND `cancelBooking` attempts a refund larger than the charge (cancellation fails). Needs line-item restructure + product call on whether a discount touches the booking fee. Surfaced in SYSTEM-DESIGN-zero-total-coupon-bookings §5."

---

## 6. Test-case list (for the tester — backend-developer to implement the fix first)

Unit tests for the webhook handler, extending the existing mock-based harness at
`src/app/api/stripe/webhook/__tests__/route.test.ts` (Vitest; `getStripeClient`, `createAdminClient`, `sendEmail` already mocked; chainable Supabase mock with `update/eq/is/select/maybeSingle`). No live DB — assert on the `update(...)` payload and the `.eq('status','pending_payment')` guard, and on whether `paymentIntents.retrieve` was called. (DB-level CHECK behaviour is covered by reasoning in §2.3/§3, not reachable from the mock harness; if a Supabase-local integration test exists for bookings, add the CHECK assertion there — otherwise it is out of scope for the unit suite.)

1. **Comp confirms (happy path).** `checkout.session.completed` with `payment_status='no_payment_required'`, `status='complete'`, `amount_total=0`, `payment_intent=null`, valid `metadata.booking_id`. Mock the UPDATE to return one row. Assert:
   - the UPDATE payload sets `status:'confirmed'`, `waitlist_position:null`, `stripe_payment_id:null`, `price_at_booking:0`, **`booking_fee_pence:0`**;
   - the UPDATE was guarded with `.eq('status','pending_payment')`;
   - `paymentIntents.retrieve` was **NOT** called (no fee capture);
   - `sendEmail` was called (confirmation still sent);
   - response is 200 `{ received: true }`.

2. **Comp re-delivery is idempotent.** Same comp event delivered twice; second delivery's UPDATE returns 0 rows (`maybeSingle → null`). Assert: handler returns without throwing, no second `sendEmail` triggered by the no-op path, response 200. (Documents that the status guard alone dedupes comp — §4.2.)

3. **Genuinely-unpaid session still rejected.** `payment_status='unpaid'` (PI present or null). Assert: **no UPDATE issued**, no email, response 200 (ACK). Add a sibling case for `payment_status='no_payment_required'` but `status='open'` (not `complete`) → also rejected, no UPDATE. And a case `no_payment_required` + `complete` but `amount_total > 0` (inconsistent) → rejected, no UPDATE.

4. **Partial-coupon / normal paid session still confirms as today (regression guard).** `payment_status='paid'`, `status='complete'`, `amount_total>0`, `payment_intent='pi_x'`. Assert:
   - UPDATE payload sets `status:'confirmed'`, `stripe_payment_id:'pi_x'`, `waitlist_position:null`, and does **NOT** include `price_at_booking` or `booking_fee_pence` (paid path leaves the RPC snapshot intact);
   - `paymentIntents.retrieve` **WAS** called with `'pi_x'` (fee capture runs);
   - `sendEmail` called; response 200. (This pins that the fix did not regress the existing paid path — there is already coverage here; extend the assertion to confirm the money columns are untouched.)

5. **`captureStripeFee` skipped when no PI.** Covered by the assertion in case 1 (`paymentIntents.retrieve` not called) and exercised positively in case 4. Optionally add a dedicated assertion that on the comp path the fee-capture UPDATE (`.eq('stripe_fee_pence', 0)`) is never issued.

6. **Missing `booking_id` metadata still hard-rejects (unchanged).** Comp-shaped session but `metadata.booking_id` absent → handler returns early, no UPDATE, 200. (Confirms the new gate didn't move the metadata check.)

Existing tests to keep green (no behaviour change expected): signature-missing 400, bad-signature 401, missing-secret 500, the `admin-mid-checkout-race.test.ts` suite, and the `charge.refunded` reconciliation tests.

---

## 7. Dependency map / sequencing

1. backend-developer edits `src/app/api/stripe/webhook/route.ts` only (handler logic per §2; fee-capture guard per §2.4). No other source file changes. No migration. No RPC. No client/page change.
2. tester adds/updates the cases in §6 against the existing harness.
3. No `supabase db push` step (no migration — §3).
4. Deploy to Vercel; the fix is live on deploy. Manual verification: in Stripe **test mode**, create a 100%-off promotion code, book a paid test event applying the code, confirm the booking lands `confirmed` with `price_at_booking=0` / `stripe_payment_id=null`, the seat shows on `event_with_stats`, and the success page renders "You're booked." Then cancel it and confirm no refund is attempted and it cancels cleanly.

## 8. Risk assessment / rollback

- **Blast radius:** one webhook branch. The paid path is unchanged except that fee-capture is now PI-guarded (a strict improvement — it can no longer throw on a null PI). Rollback is a single revert of the webhook file; no schema to unwind.
- **Primary risk:** the `chk_bookings_free_no_booking_fee` CHECK (§2.3). If the implementer sets `price_at_booking=0` but forgets `booking_fee_pence=0`, the UPDATE throws 23514, the booking stays `pending_payment`, and the reaper cancels it — i.e. the bug appears "unfixed." This is the single most important line in the spec; the §6.1 test asserts `booking_fee_pence:0` explicitly to catch it.
- **Non-risk:** over-confirming an unpaid session. The triple-gate (`no_payment_required` + `complete` + `amount_total===0`) plus the unchanged `unpaid` rejection means only genuine full comps confirm.
- **Out-of-scope risk retained:** partial coupons remain mis-snapshotted (§5). Documented, not regressed by this change.

## 9. Sources (Stripe behaviour verified 2026-06-08)

- No-cost orders — "Completed Checkout Sessions that are free won't have an associated PaymentIntent"; "handle the `checkout.session.completed` event rather than PaymentIntent events"; API version 2023-08-16+ required: <https://docs.stripe.com/payments/checkout/no-cost-orders>
- Fulfillment — recommended gate `payment_status != 'unpaid'` (covers both `paid` and `no_payment_required`); `payment_status ∈ {paid, unpaid, no_payment_required}`: <https://docs.stripe.com/checkout/fulfillment>
- Checkout Session object (`payment_status`, `status`, `amount_total`, `payment_intent`): <https://docs.stripe.com/api/checkout/sessions/object>
