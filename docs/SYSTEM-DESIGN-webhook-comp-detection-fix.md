# SYSTEM-DESIGN — Webhook Comp-Detection Fix + Backfill for Stranded Comp Bookings

**Status:** §3 (webhook fix) — approved, implemented, no further changes needed. §5 (backfill migration) — **REVISED 2026-08-13 (same day) after a code-reviewer Block on the original Phase B auto-correct design.** See "Addendum" immediately below. §5.4–§5.9 as originally written are **SUPERSEDED** by §5.4′–§5.10′; kept in place, struck through in spirit (not literally deleted) for incident-history traceability — do not implement §5.4–§5.9 as written.
**Author:** architect
**Date:** 2026-08-13 (original); revised 2026-08-13 (same day, post code-review)
**Owner of next step:** backend-developer — rewrite the already-authored migration `supabase/migrations/20260813131020_backfill_stranded_comp_bookings_zero_totals.sql` to audit-only per §5.4′–§5.9′ (Phase A stays, Phase B is deleted from this file entirely), then tester updates `src/lib/supabase/__tests__/migration-backfill-stranded-comp-bookings.test.ts` to match (delete/replace the Layer 1c/1f/1g assertions that pin Phase B's existence), then a human operator runs the audit migration, cross-checks candidates against Stripe, and — only once verified — a *separate*, later migration PR performs the actual correction per §5.10′.
**Related:** `docs/SYSTEM-DESIGN-zero-total-coupon-bookings.md` (the 2026-06-08 design this supersedes in part), `docs/FOLLOW-UPS.md` §"Promotion-code-applied fee distortion", migrations `20260713000002` / `20260713000004` (a *different*, already-fixed historical root cause that produces a superficially similar row shape — see §5.2, load-bearing for the backfill's exclusion logic), `docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md` (DESIGN ONLY, not implemented — the reason §5's auto-correct was blocked; see Addendum and §5.11′).

---

## Addendum (2026-08-13, same day) — code-review Block on the original Phase B design, and the revision

**What the reviewer blocked, and why it was right to block it.** The original §5.6 two-phase migration (Phase A = audit/log, Phase B = automatic `UPDATE` zeroing `price_at_booking`/`booking_fee_pence` for every row matching the 5-condition signal, gated only by a "confidence" tag) shipped an automatic correction for a shape that is **not uniquely diagnostic of a genuine £0 comp**. `docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md` §2 (Exploit A), written the same day, independently documents that any member can `PATCH` their own booking's `status` to `'confirmed'` via a direct, authenticated Supabase REST call — no capacity check, no payment, no RPC involved. A member who did this on a `pending_payment` row for a paid event produces a row that is `status='confirmed'`, `stripe_payment_id IS NULL`, `stripe_fee_pence=0`, `price_at_booking>0`, and — critically — **still has `stripe_checkout_session_id IS NOT NULL`**, because `createPaidCheckout` writes that column at session-creation time, before the member ever completes (or abandons) Checkout. That is the exact same 5-condition shape the backfill's WHERE clause was built to catch. The two are indistinguishable from DB signals alone.

The temporal "confidence" tag made this worse, not better: it told a human reader "high confidence, webhook-bug-is-the-only-explanation" for post-cutoff rows, when in fact Exploit A has been reachable since the `bookings` table was created in migration `20260402000006` — there is no "before" for it, and no timestamp discriminates it from a genuine webhook-caused comp. A row minted by Exploit A five minutes after the cutoff would have been auto-corrected and mislabelled "high confidence," which is the opposite of what a confidence tag should do. Per the reviewer's framing: this must not "silently zero its price and fee columns... before anyone reviews it."

**What is NOT affected — confirm before touching anything:**

- **§3 (the webhook code fix, `handleCheckoutCompleted`'s `isCompSession` redefinition) needs NO changes.** The reviewer approved that part standalone. It is a forward-looking fix (stops new stranded rows from being created) and is entirely independent of how the backfill for *existing* stranded rows is designed. **Do not touch `src/app/api/stripe/webhook/route.ts` as part of this revision** — the diff already on this branch for that file is correct and complete.
- §5.1 (the 5-condition candidate signal), §5.2 (why `stripe_checkout_session_id IS NOT NULL` discriminates this bug from the unrelated 2026-07-13 `promoteFromWaitlist` bug class), and §5.3 (the refund-activity / soft-deleted-event exclusions) are **unchanged and still correct** — the *signal* that identifies candidates for human review was never the problem; the problem was skipping the human.
- §5.7 (CHECK constraint interaction) and §5.8 (idempotency reasoning) still apply, unchanged, to whatever migration eventually performs the write — they're just no longer executed automatically inside *this* migration.

**The revision, in one sentence:** convert the migration from "audit, then auto-correct" to "audit only" — Phase B is deleted from the migration entirely, not merely gated more conservatively — and design the actual correction as a second, separate, explicitly-reviewed migration authored later, once a human has verified each candidate against Stripe. See §5.4′–§5.10′ below for the full revised design, and §5.11′ for how this interacts with the (currently unimplemented) write-authorization hardening.

---

## 1. Problem statement

`handleCheckoutCompleted` (`src/app/api/stripe/webhook/route.ts:136-217`) currently gates comp-detection on three ANDed conditions:

```
isPaidSession := session.payment_status === 'paid'
isCompSession := session.payment_status === 'no_payment_required'
                 AND session.status === 'complete'
                 AND session.amount_total === 0
```

Only `isCompSession` zeroes `price_at_booking` / `booking_fee_pence`. Confirmed production evidence: at least 2 members applied a 100%-off promotion code at Stripe-hosted Checkout (`customer.discount.created` events fired 15-40s after the booking's `created_at`), and both — along with 11 more bookings sharing the identical signature on one event alone — ended up:

- `status = 'confirmed'`
- `stripe_payment_id = null`
- `stripe_fee_pence = 0`
- `price_at_booking` and `booking_fee_pence` left at full face value (e.g. £10.00 / £0.40)

**This combination is only reachable through the `isPaidSession` branch.** The `isCompSession` branch is the *only* code path that zeroes the money columns; the `isPaidSession` branch is the *only* code path that writes `stripe_payment_id = null` without also going through the zeroing logic (a genuinely-unpaid session is rejected outright and never reaches either branch — see the `if (!(isPaidSession || isCompSession)) return` guard). Since `isPaidSession` requires `session.payment_status === 'paid'` verbatim, this is a direct logical deduction, not speculation: **for these specific £0-total, promotion-code-discounted Checkout Sessions, Stripe returned `payment_status: 'paid'`, not `'no_payment_required'`, despite `amount_total === 0` and `session.payment_intent === null`.**

## 2. Why `payment_status` disagrees with Stripe's own no-cost-orders documentation here

Stripe's documented contract (verified 2026-06-08, re-verified today — see `docs/SYSTEM-DESIGN-zero-total-coupon-bookings.md` §9 and <https://docs.stripe.com/payments/checkout/no-cost-orders>) says a completed no-cost Checkout Session gets `payment_status: 'no_payment_required'` and no PaymentIntent. That held when the design doc was written and tested in June. It is evidently not holding for *some* live sessions today.

I could not reproduce or definitively pin the exact Stripe-side mechanism from static code review alone (this needs a live Stripe test-mode repro, which is execution work, not architecture — flagged as a test-plan item in §6). Two candidate contributing factors, in order of how well they fit the evidence:

1. **`payment_intent_data` specified at session-creation time.** `createBookingCheckoutSession` (`src/lib/stripe/checkout.ts:210-221`) sets `payment_intent_data.metadata` on every session, unconditionally, at creation — when the total is still the full non-zero ticket price (the customer enters the promotion code later, inside Stripe's *hosted* Checkout UI, not at our session-creation call). This is exactly the two-stage lifecycle no-cost-orders sessions rarely go through in Stripe's own examples (which apply the discount via the `discounts` array *at creation time*, starting from £0). My leading hypothesis: because we told Stripe up front to expect a PaymentIntent (`payment_intent_data`), and the total only collapses to zero *after* creation, on Stripe's hosted page, the session's `payment_status` field may retain a `'paid'`-shaped resolution from the payment-intent-track it was provisioned on, even though the actual PaymentIntent object itself never materializes (`session.payment_intent` correctly ends up `null`). This is consistent with 100% of the evidence: `amount_total = 0`, `payment_intent = null`, but `payment_status` not `no_payment_required`.
2. **Account-level / API-version inconsistency.** Less likely — this account is pinned to `apiVersion: '2026-03-25.dahlia'` (`src/lib/stripe/server.ts:32`), comfortably past the `2023-08-16` minimum for no-cost-order support — but Stripe's documented behaviour for this specific combination (`allow_promotion_codes: true` + `payment_intent_data` + a named `customer`, discount entered post-creation) is not exhaustively specified anywhere in their public docs. Cannot be ruled out without a live repro.

**This ambiguity does not block the fix.** Per the design brief for this change, the redesigned gate must not depend on `payment_status` classification at all for comp detection — see §3. Confirming the exact mechanism (candidate #1 vs #2) is a nice-to-have follow-up for the tester/backend-developer to note in the PR, not a prerequisite.

## 3. Redesigned detection logic (prose/pseudocode — for backend-developer to implement in TS)

### 3.1 The authoritative signal

`session.amount_total` is **Stripe's own server-computed final total** for a `status === 'complete'` session — the actual amount collected (or, for a £0 order, actually owed), after every discount, coupon, and promotion code has been applied. It is never client-supplied and never provisional once `status === 'complete'`. There is no legitimate Stripe flow in which a customer owes money but a *completed* session reports `amount_total === 0` — that would mean Stripe itself thinks the customer paid nothing while believing they owe something, which is definitionally not what "complete" means for a `mode: 'payment'` session. (I deliberately looked for a counter-example — delayed/async payment methods, zero-decimal-currency artifacts, partial captures — and none apply: GBP is not zero-decimal, this integration doesn't use delayed-notification payment methods per §4, and a session's `amount_total` isn't touched by anything downstream of Checkout completion.) So:

```
isComplete   := session.status === 'complete'
isZeroTotal  := session.amount_total === 0

// AUTHORITATIVE comp signal. payment_status is NOT part of this gate —
// see §2 for why it has been observed unreliable in production for this
// exact class of session (promotion code applied post-creation on a
// session that also carries payment_intent_data). status + amount_total
// are Stripe's own final, server-computed source of truth; a string
// classification field is not needed to prove a $0 order is $0.
isCompSession := isComplete AND isZeroTotal
```

### 3.2 Interaction with `isPaidSession` — deliberately NOT touched

```
isPaidSession := session.payment_status === 'paid'   // UNCHANGED
```

Do **not** relax `isPaidSession` to drop the `payment_status === 'paid'` requirement, and do not fold `status === 'complete' && amount_total > 0` into a payment_status-independent "paid" gate. Reason: Stripe's own recommended fulfillment gate (`payment_status != 'unpaid'`, <https://docs.stripe.com/checkout/fulfillment>) exists specifically because **`session.status` can become `'complete'` while `payment_status` is still `'unpaid'`** for delayed-notification payment methods (SEPA Debit, Bacs Debit, vouchers) — the customer has finished the Checkout *flow*, but settlement is asynchronous and can still fail. This account's checkout session doesn't explicitly restrict `payment_method_types` (`src/lib/stripe/checkout.ts:171-237` has no such key), so whatever payment methods are enabled in the Stripe Dashboard apply — if any delayed method is ever turned on, dropping the `payment_status === 'paid'` check would start prematurely fulfilling (confirming) bookings for payments that can still fail. **This risk does not apply to the comp path** — a £0 order has nothing to settle asynchronously; Checkout doesn't even collect a payment method when the total is zero (Stripe's own no-cost-orders doc, quoted in §2/§9 of the June design doc). So the asymmetry is intentional: relax the gate only where it's provably safe to relax (comp), leave it exactly as strict where relaxing it would introduce a real regression (paid).

### 3.3 Eligibility gate and branch precedence

```
if NOT (isCompSession OR isPaidSession):
    log.warn("checkout.session.completed not fulfillable", payment_status, status, amount_total)
    return

// Diagnostics — always log payment_status, never gate on it. This is the
// telemetry that would have caught today's bug immediately: an
// isCompSession=true row where payment_status !== 'no_payment_required'
// is now visible in logs going forward, confirming (or refuting) the §2
// hypothesis empirically over the next few live comp redemptions.
if isCompSession AND session.payment_status !== 'no_payment_required':
    log.info("comp session confirmed via amount_total===0 despite unexpected payment_status", {
      payment_status: session.payment_status, session_id: session.id,
    })
```

**Branch precedence: check `isCompSession` before/independently of `isPaidSession` in the confirm-payload construction — this is already how the code is structured today** (`if (isCompSession) { ...zero both columns... }` is a standalone block after the single shared UPDATE, not an `else` off `isPaidSession`). That structure is exactly right and needs no change: with the redefinition in §3.1, a session where `amount_total === 0` now ALWAYS takes the zeroing branch regardless of whatever `payment_status` Stripe attached to it (even if it also happens to satisfy the old `isPaidSession === 'paid'` check, which is precisely today's bug) — because `isCompSession` is now evaluated purely from `status`/`amount_total`, independent of `isPaidSession`'s truthiness. No `if/else if` restructure needed; the existing `if (isCompSession) { price_at_booking = 0; booking_fee_pence = 0 }` block already has final say over the money columns.

### 3.4 Everything else in `handleCheckoutCompleted` — unchanged

- `paymentIntentId` resolution (`session.payment_intent` as string, else null) — unchanged.
- The confirm `UPDATE` shape, the `.eq('status', 'pending_payment')` idempotency guard, the 23505 duplicate-PI handler — unchanged.
- `captureStripeFeeForBooking` guarded on `paymentIntentId !== null` — unchanged (still correctly skipped for comp, since `isCompSession` sessions still have `paymentIntentId === null` by definition — Stripe never creates a PaymentIntent for a genuine £0 order regardless of the `payment_status` label it attaches).
- `sendPaidBookingConfirmationEmail` — unchanged.

### 3.5 Net diff shape

Only two lines change inside `handleCheckoutCompleted`:

```diff
- const isCompSession =
-   session.payment_status === 'no_payment_required' &&
-   session.status === 'complete' &&
-   session.amount_total === 0
+ const isCompSession =
+   session.status === 'complete' &&
+   session.amount_total === 0
```

Plus the new diagnostic `log.info` in §3.3 (optional but recommended — cheap, high-value telemetry) and updated comments explaining the `payment_status`-is-diagnostics-only posture (the current comments at `route.ts:124-155` explicitly justify the *old* triple-gate and need rewriting, not just the code).

## 4. Async / delayed-payment-method audit (ruling out the one real risk in §3.2)

Checked `src/lib/stripe/checkout.ts` — no `payment_method_types` restriction, meaning whatever is enabled in the Stripe Dashboard's Checkout settings applies. I cannot see the live Dashboard config from here (execution/operator concern, not a code-review one). **Action for backend-developer/tester before shipping:** confirm in the Stripe Dashboard (Settings → Payment methods) that only instant-settlement methods (card, Apple Pay, Google Pay) are enabled for this account. If any delayed-notification method is enabled, that's an *existing* risk independent of this fix (the current `isPaidSession` gate already correctly protects against it by requiring `payment_status === 'paid'`, which this fix does not change) — just worth a sentence in the PR description so it's a known, deliberate non-change.

## 5. Backfill design — stranded comp bookings

### 5.1 Candidate signal (exact WHERE clause, as specified)

```sql
SELECT b.id, b.user_id, b.event_id, b.price_at_booking, b.booking_fee_pence,
       b.stripe_checkout_session_id, b.created_at, p.email, p.full_name,
       e.title, e.slug
FROM   public.bookings b
JOIN   public.profiles p ON p.id = b.user_id
JOIN   public.events   e ON e.id = b.event_id
WHERE  b.status = 'confirmed'
  AND  b.stripe_payment_id IS NULL
  AND  b.stripe_fee_pence = 0
  AND  b.price_at_booking > 0
  AND  b.stripe_checkout_session_id IS NOT NULL
  AND  b.deleted_at IS NULL
ORDER BY b.created_at;
```

Scoped across **all events**, not just the one already scanned — the task's broader-scan ask.

### 5.2 Why this 5-condition signal is safe — and why it is NOT the first time this exact row shape has appeared

Cross-referencing migration history turned up an important, directly relevant precedent: **on 2026-07-13, two other production bookings (Amy Sangam, Yasemin Salp) landed in this exact shape — `status='confirmed'` on a paid event, `stripe_payment_id IS NULL`, full face-value `price_at_booking`** — for a *completely different* root cause: the old `promoteFromWaitlist` admin action confirmed a waitlisted booking on a paid event without ever collecting payment (fixed by `admin_promote_waitlist_to_hold`, migration `20260713000002`; those two specific rows were individually remediated via the one-off `admin_hold_confirmed_booking_for_payment` RPC shipped in `20260713000004`).

This matters for the backfill's safety, not just as colour: **that historical bug class never created a Stripe Checkout Session at all** (the admin action confirmed the booking directly in the database; there was no `createBookingCheckoutSession` call in that path). So those rows have `stripe_checkout_session_id IS NULL`. The 5th condition in the WHERE clause above — `stripe_checkout_session_id IS NOT NULL` — is exactly what discriminates "genuinely went through Stripe Checkout and got mis-classified by the webhook" (this bug) from "never went through Stripe Checkout at all" (the July bug, and, structurally, also what a hand-crafted DB row would look like). This is a second, independent confirmation that the given signal is well-chosen, not just the two now-closed exploit paths named in the brief.

(For completeness: the two July rows have since been remediated through `admin_hold_confirmed_booking_for_payment`, which moves them back to `pending_payment` for a real payment attempt — so by now they either have a real `stripe_payment_id` (paid) or a different status. Either way they no longer match this WHERE clause. Not a concern, but worth the operator spot-checking those two specific member names are absent from the backfill's audit output, as a sanity check that the exclusion logic is behaving as reasoned here.)

### 5.3 Additional exclusions — DB-signal-only, hard-fail out of the auto-fix set

Beyond the 5 base conditions, exclude and separately flag (not silently drop) any row where:

- `b.refunded_amount_pence > 0 OR b.stripe_refund_id IS NOT NULL` — this booking already has refund activity recorded against it. Zeroing `price_at_booking` underneath a non-zero `refunded_amount_pence` produces a nonsensical state (refunded more than the ticket now "costs") and needs a human to reconcile the sequence of events first, not an automated zero.
- Any row whose paired `events` row has `deleted_at IS NOT NULL` — financial correction on a booking for a soft-deleted event needs a human's eyes, not automation.
- Any row where `b.price_at_booking != b.booking_fee_pence + <something implying a partial, non-100%, discount was already partially reconciled>` — not applicable here (no such partial-reconciliation code path exists yet; noted for completeness, not an actual current exclusion).

These are genuine "can't be confident from DB signals alone" cases per the brief and get a distinct `RAISE NOTICE ... SKIPPED — manual review: <reason>` line in the migration's output, listing `id` + `email` + `event.slug`, rather than being silently omitted.

> **⚠ §5.4–§5.9 below are SUPERSEDED — see the Addendum above and §5.4′–§5.11′ below.** Kept verbatim for incident-history traceability (this is what was actually implemented and then blocked in code review); do not use these sections as an implementation reference. Jump to §5.4′.

### 5.4 Temporal confidence tagging — NOT a hard exclusion, an explicit annotation

The brief's own framing treats the 5-condition WHERE clause as the actual candidate criterion, and asks that pre-cutoff rows be **annotated with the residual ambiguity, not papered over** — not that they be excluded outright. Design accordingly: **every row matching §5.1 + passing §5.3 gets fixed**, but the migration computes and logs a `confidence` tag per row based on `created_at` relative to when the two exploit paths named in the brief were closed:

```sql
-- Code-merge timestamp for PR #118 ("fix(bookings): close booking-status
-- tampering vulnerability + fix contradictory checkout UI"), which shipped
-- both closed-exploit-path migrations
-- (20260812171530_revoke_bookings_admin_hold_column_write.sql,
-- 20260812185745_bookings_status_transition_rpcs.sql) in the same commit,
-- cab424d, merged 2026-08-13 09:23:48+01:00.
--
-- IMPORTANT — this is the CODE-MERGE time, not necessarily the
-- PRODUCTION-DEPLOY time. Per this repo's known gap (memory:
-- project_migration_apply_step — CI applies migrations to local Supabase
-- only; production needs a separate manual `supabase db push
-- --include-all --linked`), the actual moment these RLS/RPC changes took
-- effect against the LIVE database could be later than this timestamp.
-- OPERATOR: before running this migration, confirm the actual prod
-- `db push` time from deploy logs / `supabase migration list --linked`
-- and adjust v_fix_cutoff below if it differs materially.
v_fix_cutoff CONSTANT timestamptz := '2026-08-13T09:23:48+01:00';
```

For each matched row:

- `created_at >= v_fix_cutoff` → `confidence = 'high — post-fix, webhook-bug is the only remaining explanation'`.
- `created_at < v_fix_cutoff` → `confidence = 'medium — pre-fix, theoretical exploit-path ambiguity (see §5.2/§5.4 of the design doc); recommend cross-checking this row's Checkout Session in the Stripe Dashboard for a customer.discount.created event before treating as fully closed'`.

Both confidence tiers still get the correction applied (see §5.6 for why), but the tag is preserved in the RAISE NOTICE output so a human reviewing the migration's run log can immediately see which rows carry the lower-confidence caveat and prioritise those for a Stripe-dashboard cross-check.

### 5.5 How many of the known rows fall in each bucket

I do not have production database or Stripe dashboard access from this session (correctly — an architect designs, doesn't execute against prod), so I cannot run the diagnostic SELECT myself. Given what's in the brief:

- The known 13 rows (one event) span **2026-08-05 through 2026-08-13 (today)**.
- The exploit-closing commit merged **2026-08-13 09:23:48+01:00** — i.e., **this morning**, and production `db push` (per this repo's standing process gap) likely landed at or after that instant.
- **Best estimate: all or nearly all of the 13 known rows will tag `confidence = medium (pre-fix)`**, since the fix landed only hours before this design doc was written and the earliest known-bad row is over a week older. Exact split is data-dependent — the backend-developer/operator must run the read-only diagnostic (§5.1's SELECT, with the confidence CASE from §5.4 added) FIRST and report the actual per-row `created_at` vs `v_fix_cutoff` split before applying the corrective UPDATE, per §5.6's two-phase design.
- **Recommendation on how many to touch:** all 13 (and any additional rows the broader, all-events scan turns up) should be included in the correction, tagged `medium` confidence, NOT flagged for exclude-and-manual-review — because (a) the DB signal is a tight 5-condition AND with two independent exclusions of known other bug classes (§5.2, §5.3) already applied, (b) real Stripe-side corroboration (`customer.discount.created`) already exists for 2 of the 13, and (c) the pattern — 13 rows clustered on ONE popular/discounted event over 8 days, not scattered evenly across the whole platform or concentrated in one member's account — is far more consistent with a systemic webhook bug hitting every user of a real promo code than with 13 independent instances of members discovering and exploiting either of the two now-closed vulnerabilities (both of which required deliberately crafting a non-obvious URL query parameter or a hand-authored authenticated REST `PATCH` request — not something an ordinary member stumbles into 13 times on one event). Zero rows are recommended for the hard "exclude + manual review" bucket **unless** the operator's diagnostic run surfaces one that trips §5.3 (refund activity or soft-deleted event) — none are expected from the evidence given, but the migration must still check for and flag them defensively rather than assume none exist.

### 5.6 Two-phase migration, single file, both phases auditable

Repo convention favours migrations for permanent, auditable, clearly-criteria'd data corrections (precedent: `20260715143136_restore_total_attending_on_event_with_stats.sql`, and the commit history's "reconstruct lost total_attending migration file"). This is exactly that shape — a small, tightly-scoped, clearly-criteria'd, one-time data correction that should be a permanent part of schema history (so a future `supabase db reset` replays the exact same fix against any restored/seeded snapshot that happens to carry pre-fix bad rows, and so the incident is documented in the migration log itself, not just in a Slack thread).

Design as **one migration file**, structured as a single `DO $$ ... $$` block with two phases:

**Phase A — audit-and-tag (always runs, pure read + RAISE NOTICE, no writes):**
```
FOR each row matching §5.1 that also fails §5.3:
    RAISE NOTICE 'SKIPPED (manual review) booking % (%, event %): %',
      id, email, event_slug, exclusion_reason;

FOR each row matching §5.1 that passes §5.3:
    RAISE NOTICE 'CANDIDATE booking % (%, event %) created % — confidence=% — price_at_booking=%p booking_fee_pence=%p',
      id, email, event_slug, created_at, confidence_tag, price_at_booking, booking_fee_pence;
```

**Phase B — the correction (UPDATE, scoped to exactly the same passing set as Phase A):**
```sql
WITH corrected AS (
  UPDATE public.bookings b
  SET    price_at_booking  = 0,
         booking_fee_pence = 0
  FROM   (
    -- same predicate as §5.1 + §5.3 exclusions, re-expressed as a
    -- self-contained subquery so the UPDATE's WHERE is provably
    -- identical to what Phase A just logged — no drift between what
    -- was audited and what was written.
    SELECT id FROM public.bookings b2
    JOIN   public.events e2 ON e2.id = b2.event_id
    WHERE  b2.status = 'confirmed'
      AND  b2.stripe_payment_id IS NULL
      AND  b2.stripe_fee_pence = 0
      AND  b2.price_at_booking > 0
      AND  b2.stripe_checkout_session_id IS NOT NULL
      AND  b2.deleted_at IS NULL
      AND  b2.refunded_amount_pence = 0
      AND  b2.stripe_refund_id IS NULL
      AND  e2.deleted_at IS NULL
  ) match
  WHERE  b.id = match.id
  RETURNING b.id, b.user_id, b.event_id
)
SELECT count(*) FROM corrected;  -- surfaced via RAISE NOTICE 'Backfill corrected % booking(s)', (SELECT count(*) FROM corrected);
```

Then a final per-row confirmation notice joining back to `profiles`/`events` for the same auditability the brief asks for:

```
FOR each row in corrected:
    RAISE NOTICE 'CORRECTED booking % (%, event %): price_at_booking 0, booking_fee_pence 0 (was £%.%, £%.%)',
      id, email, event_slug, <old price>, <old fee>;
```

(Old values aren't available post-UPDATE without a prior CTE snapshot — implementer should capture the pre-image via a `SELECT ... INTO` loop, or a temp table, before the UPDATE, so the "was £X" figures in the final notice are real, not placeholders. Exact implementation detail for backend-developer; the audit *requirement* — before/after values visible in the migration run log — is the load-bearing part of this spec, not the specific PL/pgSQL idiom used to capture it.)

### 5.7 CHECK constraint interaction — mirrors the webhook exactly

`chk_bookings_free_no_booking_fee: CHECK (price_at_booking > 0 OR booking_fee_pence = 0)` (`20260517000001_add_bookings_fee_columns.sql:99-101`). Setting **both** `price_at_booking = 0` and `booking_fee_pence = 0` in the same `UPDATE` statement — exactly as shown above — satisfies it (`0 > 0 OR 0 = 0` → `TRUE`), identically to how the webhook's own comp path (§2.3 of the June design doc) already handles this. No other CHECK on `bookings` reads either column (confirmed by grepping `chk_bookings_` constraints in `20260402000006`, `20260422000003`, `20260517000001`, `20260713000001`) — `chk_bookings_refund_consistency` is why §5.3 explicitly excludes rows with any refund activity, sidestepping that constraint entirely rather than reasoning through its exact shape for a case that shouldn't be auto-corrected anyway.

### 5.8 Idempotency

Re-running this migration (e.g. via `supabase db reset` replaying migration history against a fresh/restored DB) is safe: once a row is corrected, `price_at_booking > 0` is no longer true, so it drops out of the WHERE clause on any subsequent run — Phase A's audit loop finds zero candidates, Phase B's `UPDATE ... FROM (subquery)` matches zero rows, `count(*)` reports 0. No `IF NOT EXISTS` needed since this isn't a schema change; the WHERE clause itself is the idempotency guard, matching the pattern already used by the webhook's own `.eq('status', 'pending_payment')` optimistic-lock guard.

### 5.9 Downstream effect (confirms the demo-visible note in the brief)

Once `price_at_booking` reads 0 for these rows, `event_with_stats.revenue_collected` (`SUM(price_at_booking) WHERE status='confirmed'`) stops over-counting phantom revenue for bookings that were never actually paid, and any admin UI surface keyed off `price_at_booking > 0 && stripe_payment_id IS NULL` (e.g. a "Send Payment Link" affordance) stops showing on bookings that are, in truth, already-settled £0 comps — exactly the symptom named in the task brief. No admin/frontend code changes needed for this — it's a pure downstream effect of the data now being correct.

---

---

## 5.4′ Revised: what the migration on this branch must become

`supabase/migrations/20260813131020_backfill_stranded_comp_bookings_zero_totals.sql` already exists on this branch, already implements §5.1–§5.3 and §5.6's Phase A correctly. **The only change required to the existing file is deletion** — remove Phase B (the `UPDATE public.bookings ... SET price_at_booking = 0, booking_fee_pence = 0 ...` statement) and the final per-row `CORRECTED` notice loop that reads its output, in their entirety. Nothing needs to be added; this is a pure subtraction.

What remains, and runs unconditionally on every `db push`/`db reset`, is:

1. The `_backfill_comp_candidates` temp table build (§5.1's 5-condition signal + §5.3's two exclusions applied as `AND` filters, exactly as today).
2. The `SKIPPED (manual review)` notice loop for rows that match the 5-condition signal but fail an exclusion (§5.3) — unchanged, still valuable: a human should see these too, even though nothing will ever auto-correct them.
3. The `CANDIDATE` notice loop for rows that pass everything (§5.1 + §5.3) — unchanged in *shape*, but see §5.4′ below for the required change to what the confidence tag says.
4. A closing summary notice, e.g. `RAISE NOTICE 'Backfill audit found % candidate(s) for manual review (0 corrected — audit-only migration, see docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md §5.10′ for the correction step)', v_candidate_count;` — replaces the old "Backfill corrected % booking(s)" notice, computed via a `SELECT count(*) FROM _backfill_comp_candidates` rather than `GET DIAGNOSTICS ... ROW_COUNT` (there is no longer an `UPDATE` to diagnose).

No `UPDATE` statement targets `public.bookings` anywhere in this file after the revision. The migration becomes pure `SELECT` + `RAISE NOTICE` — zero write risk, safe to re-run indefinitely, safe to replay on `db reset` against any snapshot.

The trailing "operator verify" `SELECT` at the very end of the file (§ "Verify" comment block) should be **deleted** — it existed to confirm Phase B's write took effect ("should return 0" after correction); with no Phase B, that check no longer has a "before/after" to compare. Replace it with a short comment pointing at §5.10′ for what happens next.

## 5.4′ (continued) — the confidence tag survives, but reworded to stop implying safety

Keep the per-row temporal annotation — it is still useful *context* for the human doing the Stripe cross-check (a very recent row is more likely to still have live, easily-searchable Stripe Dashboard activity; an old one might need more digging). But its wording and its role both change:

- **Role:** informational context only. It was never a WHERE-clause filter (that part of the original design was already correct — see §5.4's own text, "NOT a hard exclusion, an explicit annotation") — the problem was never that the tag *gated* anything in the SQL. The problem was that a downstream reader (the migration's own Phase B, and by extension any human skimming the NOTICE log) was invited to *trust* the "high" tier as a safety signal. That invitation must be removed, not just left implicit.
- **Wording:** the "high" tier's text must stop asserting the webhook-bug is "the only remaining explanation." Replace both tiers' text with:

```sql
CASE
  WHEN b.created_at >= v_fix_cutoff
    THEN 'context: created after the PR #118 code-merge time (' || v_fix_cutoff || ') that closed the direct-PATCH status-tampering exploit IN CODE REVIEW — HOWEVER (a) that migration may not yet be live in production, see the known db-push gap noted below, and (b) even once live, this timestamp does NOT rule out this exact exploit for THIS row: the vulnerability has been reachable for the entire lifetime of the bookings table (see docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md), so a pre-cutoff exploit attempt is still possible regardless of when the fix eventually merged. Do not treat this tag as verification — check Stripe directly.'
  ELSE 'context: created before the PR #118 code-merge time (' || v_fix_cutoff || '); no additional inference beyond that.'
END AS temporal_context
```

(Column renamed from `confidence` to `temporal_context` in the temp table and every RAISE NOTICE that references it, to stop future readers pattern-matching on the word "confidence" as if it were a scored trust metric.)

## 5.5′ Why audit-only is sufficient for now, and does not lose any of the original design's value

Everything in §5.1–§5.3 that made the *signal* well-chosen (the 5 conditions, the two exclusions, the discrimination from the unrelated July `promoteFromWaitlist` bug class) is preserved exactly. What's removed is only the automated leap from "this row matches a signal consistent with a genuine £0 comp" to "therefore write to the database." That leap required an assumption — that Exploit A/B are not live — this codebase cannot currently make, because `docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md` is explicitly still DESIGN ONLY. The moment that hardening ships, the same signal becomes trustworthy for automation (see §5.11′) — nothing about today's signal design is being thrown away, only its automatic-execution privilege.

## 5.6′ Two migrations, not two phases in one file

The original §5.6 "two-phase, single file" structure is replaced by **two separate migration files, authored and reviewed at two different times**:

- **Migration 1 (this branch, already exists, needs the Phase B deletion described in §5.4′):** `20260813131020_backfill_stranded_comp_bookings_zero_totals.sql`. Audit-only. Runs automatically on every `db push`/`db reset`. Ships in the same PR as the webhook fix (§3), since it's read-only and carries no write risk.
- **Migration 2 (does not exist yet — see §5.10′ for exactly what it contains and when it gets written):** a new, separate migration, authored only after a human operator has run Migration 1 against production, captured its `CANDIDATE` output, and individually verified each candidate booking's Checkout Session in the Stripe Dashboard. This is the actual correction. It ships as its own PR, reviewed independently, with the operator's Stripe-verified id list baked into the migration text itself as the audit trail (see §5.10′ for why this is the chosen mechanism over the two alternatives).

## 5.7′ (renumber of old §5.7 — CHECK constraint interaction: unchanged, but now applies to Migration 2, not this one)

`chk_bookings_free_no_booking_fee: CHECK (price_at_booking > 0 OR booking_fee_pence = 0)` (`20260517000001_add_bookings_fee_columns.sql:99-101`) still must be satisfied by whatever UPDATE eventually writes these columns — this doesn't change. It's just no longer this migration's concern; it becomes Migration 2's concern, exactly as originally reasoned (§5.7 above, verbatim logic, different file).

## 5.8′ (renumber of old §5.8 — idempotency: applies to Migration 1 as now the *only* form of "idempotency" that matters here)

Migration 1 (audit-only) is trivially idempotent — it never writes, so re-running it (via `db reset` or any replay) just re-prints the same `CANDIDATE`/`SKIPPED` notices against whatever data is present at run time; there is nothing to "drop out of the WHERE clause" because nothing was ever corrected by this file. Migration 2's idempotency is addressed in §5.10′.

## 5.9′ (renumber of old §5.9 — downstream effect: unchanged in *eventual* outcome, deferred in *timing*)

The demo-visible symptom (phantom revenue in `event_with_stats.revenue_collected`, a misleading "Send Payment Link" affordance on already-settled £0 bookings) is still fixed — just not by this PR. It's fixed once Migration 2 lands, after human verification. Flag this explicitly to the planner/product owner: **the visible symptom persists until Migration 2 ships**, which now has an unavoidable human-in-the-loop step in between (Stripe cross-checking, one row at a time) rather than resolving automatically the moment this PR merges. Given the demo-visible answer for this whole piece of work is "no" (per the task brief), this delay has no user-facing urgency — it only affects an admin-facing revenue-accuracy display.

## 5.10′ The correction mechanism — chosen: **option (a), a second migration file with an explicit, human-verified id list**

Recap of the three options the task posed, and the decision:

- **(a) Second migration file, hardcoded verified ids** — **CHOSEN.**
- (b) Documented one-off SQL snippet run manually via psql/SQL editor, not tracked as a migration — rejected as primary mechanism (reasoning below), though its verification *workflow* is still exactly how the operator confirms each id before it goes into (a).
- (c) Something else — not needed; (a) fits.

**Why (a) over (b), given this codebase's conventions:**

1. **Auditability lives in the right place.** This repo's whole migration discipline (`CLAUDE.md` "Database Rules," `social-seen-safety-SKILL.md`) is built around "all schema/data changes go through `supabase/migrations/` files, reviewed via PR, never toggled/run ad hoc." A `psql`/SQL-editor snippet that isn't tracked as a migration is exactly the kind of ad-hoc, unreviewed, out-of-band database write those rules exist to prevent — the same category of action as "toggling RLS in the dashboard instead of a migration," which the rules explicitly forbid for schema changes. Money-column corrections on production booking rows deserve at least that same bar, arguably a higher one.
2. **The id list becomes a permanent, git-blamed incident record**, reviewable by a second human (whoever reviews the PR) in addition to the operator who did the Stripe cross-check — not just a paste-and-run action nobody else sees. Six months from now, "why does booking `<uuid>` have `price_at_booking=0`" has a one-command answer (`git log -S<uuid> -- supabase/migrations/`), rather than depending on whoever ran a manual snippet having saved their terminal history or SQL-editor query log somewhere durable.
3. **Scale fits.** 13 known rows, "likely low double-digits total" per the brief — a literal `ARRAY[...]::uuid[]` of verified ids is completely readable in a PR diff. This is exactly the scale where option (a)'s per-row explicitness is a feature, not friction; it would become the wrong choice at hundreds/thousands of rows (where option (b) or a fully-automated post-hardening version, §5.11′, would be worth revisiting), but that's not this incident.
4. **It composes correctly with `db reset`.** A migration replaying against a freshly-seeded/restored database is a no-op the moment none of the hardcoded ids exist in that snapshot (seed data doesn't contain production UUIDs) — same "safe to replay" property every other migration in this repo has. A psql snippet has no such property and was never going to be re-run against a restored snapshot anyway, which is itself a small argument for *not* pretending it's schema history.

**Design of Migration 2** (author only after the operator has completed Stripe verification — do not write this file speculatively/in advance):

```sql
-- Migration: correct_verified_stranded_comp_bookings
--
-- Human-verified correction for the specific bookings identified by the
-- audit-only migration 20260813131020_backfill_stranded_comp_bookings_
-- zero_totals.sql and individually cross-checked against the Stripe
-- Dashboard by <operator name/email>, <date>, per
-- docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md §5.10′.
--
-- Each id below was confirmed to have a real Stripe Checkout Session with
-- amount_total=0 and a customer.discount.created / 100%-off promotion-code
-- redemption event, ruling out the direct-PATCH status-tampering exploit
-- documented in docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md
-- (unpatched as of this migration — see that doc's Exploit A) as the
-- explanation for this specific row.
--
-- <one line per id: booking id — event slug — member email — Stripe
--  Checkout Session id cross-checked — verified by — date>
-- e.g.:
--   -- a1b2c3d4-... — winter-supper-club-jan — alice@example.com — cs_live_... — mitesh — 2026-08-14
--   -- ...

DO $$
DECLARE
  v_verified_ids CONSTANT uuid[] := ARRAY[
    'a1b2c3d4-...'::uuid
    -- , 'e5f6...'::uuid   (one per verified row)
  ];
  r RECORD;
  v_corrected_count integer := 0;
BEGIN
  -- Belt-and-braces: re-validate every id against the ORIGINAL safety
  -- signal (§5.1 + §5.3) at write time, not just at verification time.
  -- Protects against a row's state having changed in the gap between
  -- Stripe verification and this migration merging/running (e.g. someone
  -- already manually fixed it, or — defensively — it picked up refund
  -- activity in the interim). A verified id that no longer matches the
  -- safety signal is logged and skipped, NOT force-corrected.
  FOR r IN
    SELECT b.id, p.email, e.slug AS event_slug,
           b.price_at_booking AS old_price_at_booking,
           b.booking_fee_pence AS old_booking_fee_pence
    FROM   public.bookings b
    JOIN   public.profiles p ON p.id = b.user_id
    JOIN   public.events   e ON e.id = b.event_id
    WHERE  b.id = ANY(v_verified_ids)
      AND  b.status = 'confirmed'
      AND  b.stripe_payment_id IS NULL
      AND  b.stripe_fee_pence = 0
      AND  b.price_at_booking > 0
      AND  b.stripe_checkout_session_id IS NOT NULL
      AND  b.deleted_at IS NULL
      AND  b.refunded_amount_pence = 0
      AND  b.stripe_refund_id IS NULL
      AND  e.deleted_at IS NULL
  LOOP
    UPDATE public.bookings
    SET    price_at_booking = 0, booking_fee_pence = 0
    WHERE  id = r.id;
    v_corrected_count := v_corrected_count + 1;
    RAISE NOTICE 'CORRECTED (Stripe-verified) booking % (%, event %): price_at_booking 0, booking_fee_pence 0 (was £%, £%)',
      r.id, r.email, r.event_slug,
      to_char(r.old_price_at_booking / 100.0, 'FM999999990.00'),
      to_char(r.old_booking_fee_pence / 100.0, 'FM999999990.00');
  END LOOP;

  -- Any hardcoded id that did NOT come back through the loop above (state
  -- changed since verification, or a typo) — flag loudly, don't silently
  -- no-op.
  FOR r IN
    SELECT id FROM unnest(v_verified_ids) AS id
    WHERE id NOT IN (
      SELECT b.id FROM public.bookings b
      JOIN   public.events e ON e.id = b.event_id
      WHERE  b.status = 'confirmed' AND b.stripe_payment_id IS NULL
        AND  b.stripe_fee_pence = 0 AND b.price_at_booking > 0
        AND  b.stripe_checkout_session_id IS NOT NULL
        AND  b.deleted_at IS NULL AND b.refunded_amount_pence = 0
        AND  b.stripe_refund_id IS NULL AND e.deleted_at IS NULL
    )
  LOOP
    RAISE WARNING 'Verified id % no longer matches the safety signal — NOT corrected, needs re-review', r.id;
  END LOOP;

  RAISE NOTICE 'Verified-id backfill corrected % of % listed booking(s)', v_corrected_count, array_length(v_verified_ids, 1);
END $$;
```

This is deliberately still a `DO $$ ... $$` block (matches this repo's existing convention for one-time data corrections, e.g. this same doc's Migration 1, `20260715143136_restore_total_attending_on_event_with_stats.sql`), still idempotent (re-running finds zero rows the second time, since `price_at_booking > 0` is still part of the re-validation predicate), and still produces a full audit trail in its own NOTICE output — same auditability bar as the original single-file design, just split across two files with a human gate in between.

**Operator workflow (sequencing), end to end:**

1. Merge and `db push` Migration 1 (audit-only, this branch).
2. Operator runs it (or it's already run as part of the push) and captures the full `CANDIDATE`/`SKIPPED` NOTICE output.
3. Operator cross-checks each `CANDIDATE` row's Stripe Checkout Session (search Checkout Sessions or Customers by email in the Stripe Dashboard) for a genuine `customer.discount.created` / 100%-off promotion-code redemption — exactly the verification step originally described in §7c, unchanged.
4. For rows that check out: operator (or backend-developer, on the operator's confirmation) authors Migration 2 with exactly those ids, following §5.10′'s template, and opens a normal reviewed PR.
5. For rows that do NOT check out in Stripe (no matching discount event, or no Checkout Session at all despite `stripe_checkout_session_id IS NOT NULL` — which would itself be a red flag worth escalating): **do not include in Migration 2.** Treat as a suspected Exploit A/B instance and escalate per whatever this team's fraud/incident process is (out of scope for this doc to define — flagged as an open question in the HANDOVER).

## 5.11′ Relationship to `docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md`

That design (status: DESIGN ONLY, not implemented, deliberately deferred to its own future PR) closes Exploit A (direct `PATCH` of `status`) and the `price_at_booking`/`waitlist_position` column-level tampering paths by revoking `UPDATE`/`INSERT` grants on `public.bookings` for `status`, `price_at_booking`, and `waitlist_position` for `authenticated`/`anon`, once every legitimate writer has moved to a `SECURITY DEFINER` RPC (see that doc's §5).

**Once that hardening ships (both phases — the RPC conversions AND the `REVOKE` migration, confirmed live in production, not just merged in git):** a row matching this backfill's exact 5-condition signal can no longer be produced by Exploit A, because the direct-write path that shape depends on will no longer exist at the grant layer. At that point, a *future* occurrence of this exact signature — after that hardening's `REVOKE` is confirmed live — could be trusted as genuinely webhook-bug-caused (or some other still-undiscovered Stripe-side classification bug, but categorically NOT client-side tampering), and a more-automated version of this backfill (e.g. reintroducing something like the original blocked Phase B, or at minimum removing the need for a per-row Stripe cross-check) would become a defensible design.

**This is noted as the condition under which future automation becomes safe — not designed now.** No timeline is implied; this section exists so that the next time this row shape appears (if it ever does again, from any cause), whoever investigates it can quickly check "has the hardening PR shipped and been confirmed live?" before deciding whether the manual-verification workflow in §5.10′ is still required.

---

## 6. Test-case additions (for the tester, after backend-developer implements §3)

Extend the existing harness at `src/app/api/stripe/webhook/__tests__/route.test.ts` (per `docs/SYSTEM-DESIGN-zero-total-coupon-bookings.md` §6, which already lists 6 cases for the original comp fix — keep all of those green, they still describe correct behaviour) with:

1. **The exact bug reproduction.** `payment_status: 'paid'`, `status: 'complete'`, `amount_total: 0`, `payment_intent: null`. Assert: `isCompSession` path taken — `price_at_booking: 0` AND `booking_fee_pence: 0` in the UPDATE payload, `stripe_payment_id: null`, `paymentIntents.retrieve` NOT called. This is the case that was silently missing before and is exactly what shipped the 13 bad rows.
2. **Genuine paid-but-payment_status-lagging session still rejected (regression guard for §3.2).** `payment_status: 'unpaid'`, `status: 'complete'`, `amount_total: 2060` (nonzero). Assert: **no UPDATE issued** — confirms the deliberate asymmetry (comp path relaxed, paid path not) didn't get accidentally over-relaxed.
3. **`no_payment_required` + `complete` + `amount_total: 0` (the originally-designed happy path) still works** — same assertions as case 1, proving the redesign is a superset of the old comp detection, not a replacement that could regress it.
4. Add a live-Stripe-test-mode manual verification step to the deploy checklist (mirrors §7 step 4 of the June design doc): create a 100%-off promotion code, book a paid test event applying it, confirm `price_at_booking = 0` and `booking_fee_pence = 0` land correctly, and — if feasible — inspect the raw `checkout.session.completed` event payload in the Stripe Dashboard's event log for the actual `payment_status` value Stripe assigns, to empirically resolve the §2 hypothesis.

## 7. Dependency map / sequencing (REVISED — see §5.10′ for the correction step this supersedes step 3/4 below)

1. **backend-developer**: edit `src/app/api/stripe/webhook/route.ts` per §3 only. **Already done on this branch — no further action.** No other source file changes needed for the detection fix.
2. **tester**: add the cases in §6 to `src/app/api/stripe/webhook/__tests__/route.test.ts`. **Already done on this branch — no further action.**
3. **backend-developer**: rewrite the existing `supabase/migrations/20260813131020_backfill_stranded_comp_bookings_zero_totals.sql` to audit-only per §5.4′ (delete Phase B and the trailing verify-`SELECT`; keep everything else; rename `confidence` → `temporal_context` and reword per §5.4′). Run `supabase db reset` locally to confirm it applies cleanly and produces the expected `CANDIDATE`/`SKIPPED` NOTICE output against seed data (expect zero matches — production-data-shaped fix, seed data won't trip it).
4. **tester**: update `src/lib/supabase/__tests__/migration-backfill-stranded-comp-bookings.test.ts` to match — delete/replace the "Layer 1c" (Phase B SET-clause), "Layer 1f" (CHECK-constraint-on-the-UPDATE), and "Layer 1g" (Phase-A-precedes-Phase-B-write, before/after pre-image) describe blocks, since there is no longer an UPDATE in this file to assert against. Layers 1a/1b/1d(idempotency-of-the-signal-itself)/1e(temporal tag present, reworded)/1h(no hardcoded ids)/1i can mostly stay, adjusted for the `temporal_context` rename and the new closing "audit found N candidates, 0 corrected" notice text. Add a new assertion: **no `UPDATE` statement targets `public.bookings` anywhere in this file** (inverse of the old Layer 1c invariant) — this is now the single most important safety property this test file protects.
5. This PR (webhook fix, already-approved, + the now-audit-only migration + updated tests) merges and is `db push`'d per the normal process (`memory/project_migration_apply_step.md` — CI does not push to prod).
6. **Operator, manually, after Migration 1 is live:**
   a. Capture Migration 1's full `CANDIDATE`/`SKIPPED` NOTICE output (Supabase dashboard SQL editor run log, or `psql` output).
   b. Cross-check every `CANDIDATE` row's `id`/`email`/`event.slug` against the Stripe Dashboard (search Checkout Sessions or Customers by email) for a genuine `customer.discount.created` / 100%-off promotion-code redemption. This step is now **mandatory for every row**, not just `medium`-tagged ones — the `temporal_context` tag is informational only (§5.4′), never a basis for skipping verification.
   c. For rows that verify: hand the confirmed id list to backend-developer to author Migration 2 (§5.10′'s template) as a new, separately-reviewed PR.
   d. For rows that do NOT verify: do not include in Migration 2; escalate as a suspected Exploit A/B instance (see §5.10′ step 5 — process TBD, flagged as open question).
7. **Operator:** once Migration 2 is reviewed and merged, `db push` it, capture its own `CORRECTED`/`WARNING` NOTICE output as the final audit trail for this incident.

## 8. Risk assessment / rollback

- **Blast radius, webhook fix:** one boolean expression + a diagnostic log line. Rollback = revert the file; the paid path is untouched. Unaffected by this revision.
- **Primary risk, webhook fix:** none identified beyond the delayed-payment-method regression explicitly ruled out in §3.2/§4 by deliberately NOT touching `isPaidSession`.
- **Blast radius, Migration 1 (audit-only, this branch):** zero. Pure `SELECT` + `RAISE NOTICE`. No `UPDATE`/`INSERT`/`DELETE` against any table. Cannot corrupt data, cannot be the vector for the risk described in the Addendum, by construction — this is the entire point of the revision.
- **Blast radius, Migration 2 (correction, written later, per §5.10′):** exactly the hardcoded, individually-verified ids, re-validated against the original safety signal at write time, writing only two already-nullable-safe integer columns to `0`. No status transition, no RLS change, no cascading writes — same shape as originally designed, just gated by human verification instead of a timestamp heuristic.
- **Primary risk, Migration 2:** an id gets into the verified list without the Stripe check actually having ruled out Exploit A/B for that specific row (i.e., the human process fails, not the SQL). Mitigated by: the id list being visible in a reviewed PR diff (a second human — the PR reviewer — can ask "was this actually checked?"), the belt-and-braces re-validation against the original 5-condition-plus-exclusions signal at runtime (§5.10′, catches state drift but NOT a bad verification), and — the durable fix — landing `docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md` so this entire verification burden becomes unnecessary for future occurrences (§5.11′).
- **Rollback for Migration 2:** unchanged in mechanism from the original design — the pre-image is captured and logged in the migration's own NOTICE output at run time, so a wrongly-corrected row can be manually reverted via `UPDATE bookings SET price_at_booking = <logged old value>, booking_fee_pence = <logged old value> WHERE id = '<id>'`. No down-migration needed at this scale.

## 9. Follow-up to file in `docs/FOLLOW-UPS.md` (backend-developer to add post-merge, not this doc's job to edit)

> **Confirm the real Stripe mechanism behind `payment_status !== 'no_payment_required'` on £0 promotion-code sessions.** Source: `SYSTEM-DESIGN-webhook-comp-detection-fix.md` §2. The redesigned webhook gate no longer depends on pinning this down, but the two candidate hypotheses (payment_intent_data provisioned before the discount collapses the total; account/API-version inconsistency) are unconfirmed. Resolve via a Stripe test-mode repro + raw event-payload inspection (§6 item 4) next time a comp code is redeemed in test mode, and update this doc's §2 with the confirmed answer.
