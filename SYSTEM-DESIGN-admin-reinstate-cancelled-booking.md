# SYSTEM-DESIGN — Admin reinstate a reaper-cancelled `pending_payment` booking

> Produced by: Architect agent
> Date: 2026-08-08
> Status: **SPEC — ready for backend-developer**
> Branch: `claude/pending-payment-visibility-8a198f` (continued — same feature area: the reaper /
> `pending_payment` lifecycle. See §9 for why I stayed on this branch rather than opening a new one.)
> Precedent: `SYSTEM-DESIGN-admin-waitlist-promotion-payment.md` (base spec + Addendum, "Gap A" /
> "Gap B") — this is **Gap C** in the same lineage. Read that doc first; this one assumes it.

---

## 0. TL;DR

| Item | Detail |
|---|---|
| Incident | Four real bookings (Amaya Kaur, Senam Paya, Christian I, Laura Florez Perez) were auto-cancelled by `reap_stale_pending_bookings()` before the (already-committed, not-yet-deployed) visibility/reminder fix could help them. Admin confirmed the event currently has room — freed by exactly these four cancellations. |
| **Decision #1 — eligibility predicate** | See §1. Six conditions on the booking row, ANDed with "no other active booking for this user+event" and "owning profile is not soft-deleted." **I found a real, previously-unflagged gap while tracing this**: `deleteMyAccount` (`src/app/(member)/profile/privacy-actions.ts`) also cancels `pending_payment` rows and also leaves `cancellation_reason` NULL, indistinguishable from a reap **unless you also check the owning profile's `deleted_at`**. Without that check, an admin could "reinstate" a booking for a member who deleted their account, and the flow would try to email a scrubbed placeholder address (`deleted-<uuid>@deleted.local`). This is the single most important addition in this spec. |
| Decision #2 — capacity re-check | Full lock-and-recount inside a new `SECURITY DEFINER` RPC, `FOR UPDATE` on the `events` row — identical mechanism to `admin_promote_waitlist_to_hold`. Unlike Gap A (which explicitly *skips* the capacity check because a `confirmed` seat is already occupied), this case is the mirror image of Gap A: the seat was genuinely released back to the pool by the reap, so it **is** a new admission and **must** be capacity-checked, exactly like a waitlist promotion. Two admins reinstating two different cancelled rows for the same event serialize on this lock — the second one re-reads the seat count after the first commits and is correctly rejected if now full. |
| Decision #3 — state transition | `cancelled → pending_payment`, `is_admin_hold = true`, fresh Stripe Checkout Session — same shape as Gap A/B, **with one deliberate deviation**: `cancelled_at` is **not** cleared by the transition. It stays as the original reap timestamp. This is not an oversight — it is the load-bearing signal that lets a generic `is_admin_hold = true AND status = 'pending_payment'` row be told apart from the two existing hold origins without a new column (see §3.3). |
| Decision #4 — new RPC/migration needed | **Yes.** `resume-checkout.ts` explicitly only handles a `pending_payment` starting state (confirmed by reading it — it fetches the row, then does `if (booking.status !== 'pending_payment') return error`). A `cancelled` starting state needs its own eligibility checks, its own capacity re-check (resume-checkout has none — it doesn't need one, since the row is already occupying a seat), and its own RPC. One new migration, one new RPC pair (create + release), zero schema changes. |
| Decision #5 — new admin-hold origin | **Yes.** A third entry, `cancelled_reinstatement`, in `ADMIN_HOLD_ORIGINS` (`src/lib/bookings/admin-hold.ts`). Requires widening `AdminHoldOriginConfig.rollbackStatus` to add `'cancelled'`, and a new `priceSource` field (`'event' | 'booking'`) because this origin — uniquely among the three — must charge the booking's **original** `price_at_booking`, not the event's **current** price (see §3.4). `abandonPendingCheckout`'s `from` union gains `'admin_reinstate'` → rolls back to `'cancelled'`. |
| Decision #6 — upper bound on offerability | **No hard RPC-enforced cutoff.** Reasoned in §5 — the event-not-past check already bounds it structurally, and a time cutoff on `cancelled_at` protects against a problem (stale admin judgment) that a UI warning solves better than a hard rejection. Recommend a UX-layer "cancelled N days ago" callout, not a backend gate. |
| Decision #7 — hold expiry | **Same `null`-hardcoded pattern as Gap A** (§6). Reasoned to be *more*, not less, justified here: there is no systemic revert-cron for ANY origin yet, so a shorter deadline with nothing to enforce it is theatre, not safety. What actually matters is that a **manual release action is mandatory, not optional**, for this origin specifically (Gap B's own release RPC can't safely be reused — see §4). |
| New RPCs | `public.admin_reinstate_cancelled_booking_for_payment(p_booking_id, p_booking_fee_pence, p_hold_expires_at)` and `public.admin_release_reinstated_hold_to_cancelled(p_booking_id)`. |
| New migration | `supabase/migrations/20260808000003_admin_reinstate_cancelled_booking_rpcs.sql`. Zero new columns, zero new CHECK constraints — reuses `is_admin_hold`/`admin_hold_expires_at` from `20260713000001`. |
| New TS | `createAdminReinstatementHold()` + `releaseReinstatedBookingHold()` in `admin-hold.ts` (third and fourth public exports alongside the two Gap A/B ones). |
| New email | `reinstatedBookingPaymentLinkTemplate()` in new file `src/lib/email/templates/reinstated-booking-payment-link.ts` — a third, distinct scenario per the task brief; copy is ux-designer's, not mine. |
| New Server Actions | `reinstateCancelledBooking(bookingId)` and `releaseReinstatedHold(bookingId)` in `src/app/(admin)/admin/actions.ts`. |
| New UI | `ReinstateBookingButton.tsx` and `ReleaseReinstatedHoldButton.tsx` in `src/components/admin/`, wired into `BookingsTable.tsx`. |
| RLS changes | None. New RPCs are `SECURITY DEFINER` with in-body admin checks, identical posture to every sibling in this family. |

---

## 1. Decision #1 — the eligibility predicate (safety-critical)

### 1.1 What the reaper actually produces, precisely

Confirmed by reading `reap_stale_pending_bookings()` (`supabase/migrations/20260515095343_reaper_pgcron_schedule.sql`, refined by `20260713000002`) and the manual-probe route (`src/app/api/admin/cron/reap-stale-bookings/route.ts`) — both share byte-identical predicate and write shape:

**Matches (read):**
```sql
status = 'pending_payment' AND stripe_payment_id IS NULL AND deleted_at IS NULL
AND is_admin_hold = false AND created_at < now() - interval '35 minutes'
```
**Writes:**
```sql
status = 'cancelled', cancelled_at = now()
```
`cancellation_reason` is **not** touched — it stays whatever it was (always `NULL` for a row that has never been through the admin event-cancellation flow).

So a genuinely-reaped row looks like: `status = 'cancelled'`, `cancelled_at` = a real timestamp, `cancellation_reason IS NULL`, `stripe_payment_id IS NULL`, `is_admin_hold = false`, `refunded_amount_pence = 0`.

### 1.2 Every other code path that can also produce `status = 'cancelled'` — traced, not assumed

I grepped every `status: 'cancelled'` / `status = 'cancelled'` write site in `src/` and read each one, specifically checking whether it could produce a row indistinguishable from a reap under the naive `cancellation_reason IS NULL` test alone:

| Site | File | Sets `cancellation_reason`? | Sets `cancelled_at`? | Can it touch a `pending_payment` row? | Distinguishable how? |
|---|---|---|---|---|---|
| `reap_stale_pending_bookings()` / manual probe route | migration `20260515095343`, `route.ts:117` | No (stays NULL) | **Yes** | Yes — this is the target case | — (this IS the target) |
| `cancelEventAndRefundBookings` (4 branches: confirmed+refund, confirmed+no-refund, waitlisted, pending_payment) | `admin/actions.ts:1192,1252,1285,1319` | **Yes, always** (`cancellationReason` param) | Yes | Yes (one branch is explicitly the `pending_payment` case) | **`cancellation_reason IS NOT NULL`** — already excluded |
| `createPaidCheckout`'s own Stripe-failure rollback | `events/[slug]/actions.ts:368-372` | No | **No** (`.update({ status: 'cancelled' })` only — verified by reading the exact call) | Yes (guarded `.eq('status', 'pending_payment')`) | **`cancelled_at IS NULL`** for this path — excluded by requiring `cancelled_at IS NOT NULL` |
| Stripe webhook `charge.refunded` handler | `stripe/webhook/route.ts:542-550` | No | Yes | Only rows that **were paid** (looked up by `stripe_payment_id`, and the update itself leaves `stripe_payment_id` untouched — still set) | **`stripe_payment_id IS NOT NULL`** on these rows — excluded by requiring `stripe_payment_id IS NULL` |
| `abandonPendingCheckout` (member clicks "← Back" on Stripe) | `events/[slug]/actions.ts:585-652` | No | No (only sets `status`/`is_admin_hold`/`admin_hold_expires_at`) | Yes, but only rolls back to `'cancelled'` on the **default `'book'`** branch (new-booking abandon) — `'claim'`/`'admin_hold'`/`'admin_remediation'` all roll back to `waitlisted`/`confirmed`, never `cancelled` | Same as `createPaidCheckout` above — no `cancelled_at` set, excluded by `cancelled_at IS NOT NULL` |
| **`deleteMyAccount` (member self-deletes account)** | `(member)/profile/privacy-actions.ts:258-263` | **No** (NULL) | **Yes** (`cancelled_at: now()`) | **Yes — indiscriminately**: `.in('status', ['confirmed', 'waitlisted', 'pending_payment'])`, with **no `stripe_payment_id` filter at all** | **Not distinguishable by any booking-row column alone.** Requires checking the **profile** — see §1.3. This is the one the task brief didn't flag and I found by tracing the actual code, not by assumption. |
| `cancelBooking` (member self-cancel) | `events/[slug]/actions.ts:703-` | No | N/A | **No** — hard-requires `status !== 'confirmed' → reject` at line 737, so it can never touch a `pending_payment` row in the first place (confirmed independently, closing the open question the base spec's Addendum §9 item 4 had flagged but not fully verified) | N/A — structurally can't produce this shape |

### 1.3 The gap I found: `deleteMyAccount` is not distinguishable from a reap by booking-row columns alone

`deleteMyAccount` produces a row that is `status='cancelled'`, `cancelled_at` = a real timestamp, `cancellation_reason IS NULL`, and — critically — it does **not** filter on `stripe_payment_id` before cancelling, so even `stripe_payment_id IS NULL` doesn't reliably separate the two cases for every historical row (though for `pending_payment` specifically, `stripe_payment_id` would in practice be NULL too, since a paid row would be `confirmed` not `pending_payment` — so this particular column doesn't actually help here). **The only reliable signal is the owning profile's `deleted_at`.** `deleteMyAccount` soft-deletes the profile (`profiles.deleted_at = now()`) and scrubs PII, including replacing `email` with `deleted-<user-id>@deleted.local` (verified by reading the exact `UPDATE` at `privacy-actions.ts:384-399`).

Without this check, the failure mode is concrete and bad: an admin sees a "Reinstate" button on a cancelled booking, clicks it, the RPC transitions it to `pending_payment` + `is_admin_hold=true`, `createAdminReinstatementHold` fetches the profile for `ensureStripeCustomer`/the email send, gets `full_name = '[deleted member]'`, `email = 'deleted-<uuid>@deleted.local'` — and either the Stripe customer creation or the email send fails loudly (best case) or silently succeeds and sends a real payment link to a dead mailbox while creating a Stripe Customer under a garbage email (worse case, wastes a Stripe API call and leaves a confusing artifact). Either way, wrong.

### 1.4 A second finding, smaller but worth stating: an active-booking collision is possible

`bookings` has no unique constraint that would prevent this by itself failing loudly in an obviously-attributable way for our specific flow — the actual constraint is a **partial** unique index on `(user_id, event_id) WHERE status != 'cancelled'`, which allows multiple `cancelled` rows for the same user+event to coexist. Practically: after being reaped, a member could have gone on to book the event again through the normal flow (new row, `cancelled_at` NULL on the old row is irrelevant here — the **new** row is a fresh INSERT, unrelated to the old cancelled one). If an admin now reinstates the **old** cancelled row, the UPDATE would attempt to create a second active row for the same `(user_id, event_id)` pair and the partial unique index would reject it with a raw `23505`. The RPC should pre-check this and fail with a clear message rather than letting the raw constraint violation surface.

### 1.5 The full predicate

**Booking-row conditions** (all required):
```sql
b.status               = 'cancelled'
AND b.deleted_at        IS NULL
AND b.cancelled_at      IS NOT NULL      -- excludes createPaidCheckout/abandonPendingCheckout's
                                          -- cancelled_at-less rollback (§1.2)
AND b.cancellation_reason IS NULL        -- excludes cancelEventAndRefundBookings (§1.2)
AND b.stripe_payment_id IS NULL          -- never reinstate around an existing payment record
AND b.refunded_amount_pence = 0          -- belt-and-braces; implied by the above via
                                          -- chk_bookings_refund_consistency, checked again for clarity
AND b.is_admin_hold     = false          -- can't be true on a cancelled row anyway
                                          -- (chk_bookings_admin_hold_requires_pending_payment), but
                                          -- checked explicitly rather than relied upon implicitly
AND b.price_at_booking  > 0              -- paid-event bookings only (see §7 scoping note)
```

**Cross-row conditions:**
```sql
-- No other active booking for this member+event (§1.4)
NOT EXISTS (
  SELECT 1 FROM public.bookings b2
  WHERE b2.event_id = b.event_id AND b2.user_id = b.user_id
    AND b2.id != b.id AND b2.status != 'cancelled' AND b2.deleted_at IS NULL
)

-- Owning profile is not soft-deleted (§1.3 — THE finding)
AND EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = b.user_id AND p.deleted_at IS NULL
)
```

**Recommended additional check, flagged as a judgment call, not silently added:** `profiles.status = 'active'` (the codebase has a `user_status` enum: `'active' | 'suspended' | 'banned'`, `20260420000001`). I recommend also rejecting reinstatement for a `suspended`/`banned` member — offering a fresh payment link to someone the platform has actively suspended seems clearly wrong — but this wasn't explicitly asked for and I haven't traced every place `suspended`/`banned` is enforced elsewhere in the booking flow to confirm it's the established pattern for "should this member be allowed to transact." Flagging for developer confirmation rather than baking in silently (§8, item 1).

**Event-row conditions** (checked under the same lock as capacity, §2):
```sql
e.deleted_at IS NULL AND e.is_cancelled = false AND e.date_time > now() AND e.price > 0
```

### 1.6 Verification query for the four real bookings, before this ships

Run this against production (read-only) once the migration is live, to confirm Amaya/Senam/Christian/Laura's rows actually satisfy the predicate before an admin clicks anything:

```sql
SELECT b.id, b.user_id, b.event_id, b.status, b.cancelled_at, b.cancellation_reason,
       b.stripe_payment_id, b.refunded_amount_pence, b.is_admin_hold, b.price_at_booking,
       p.deleted_at AS profile_deleted_at, p.status AS profile_status
FROM public.bookings b
JOIN public.profiles p ON p.id = b.user_id
WHERE b.status = 'cancelled'
  AND b.cancelled_at IS NOT NULL
  AND b.cancellation_reason IS NULL
  AND b.stripe_payment_id IS NULL
  AND b.is_admin_hold = false
  AND b.deleted_at IS NULL
ORDER BY b.cancelled_at DESC
LIMIT 20;
```

---

## 2. Decision #2 — capacity re-check, atomic

Unlike Gap A (`admin_hold_confirmed_booking_for_payment`, which **deliberately skips** the capacity check because the row is already `confirmed` and therefore already counted as occupying a seat — Addendum §A.1), this case is the structural mirror of `admin_promote_waitlist_to_hold`: the seat was genuinely released back to the pool the moment the reaper cancelled the row, so reinstating it **is** a new admission from capacity's own accounting.

Confirmed against `event_with_stats`'s own definition (`20260713000005_widen_spots_left_to_include_pending_payment.sql`) — the codebase's single established convention for "how many seats are occupied" is `status IN ('confirmed', 'pending_payment')`. The new RPC uses the identical predicate:

```sql
IF v_capacity IS NOT NULL THEN
  SELECT COUNT(*) INTO v_seat_count
  FROM public.bookings
  WHERE event_id = v_event_id AND status IN ('confirmed', 'pending_payment') AND deleted_at IS NULL;

  IF v_seat_count >= v_capacity THEN
    RETURN jsonb_build_object('error', 'Event is at full capacity — cannot reinstate');
  END IF;
END IF;
```

**Atomicity:** this SELECT runs *after* `SELECT ... FROM public.events WHERE id = v_event_id FOR UPDATE` has already taken a row lock on the event. Two admins concurrently reinstating two different cancelled bookings for the *same* event will have their two RPC calls serialize on that lock: the first transaction's `FOR UPDATE` blocks the second until the first commits (or rolls back). The moment the second transaction acquires the lock, its own capacity `SELECT COUNT(*)` re-reads the table fresh — including the first transaction's now-committed `pending_payment` row — and correctly rejects if that pushed the event to capacity. This is the exact TOCTOU-closing mechanism `admin_promote_waitlist_to_hold` already established (base spec §3.1's own comment: "closes the TOCTOU race the old TS-side check-then-update had") — reused here verbatim, not reinvented.

Admin's own statement ("nothing else has taken those spots yet, but that could change") is exactly the scenario this closes: if a fifth member independently books through the normal public flow between the admin loading the bookings page and clicking "Reinstate," the RPC's own fresh count — evaluated under lock, at RPC-call time, not at page-load time — catches it.

---

## 3. Decision #3 — state transition, and why `cancelled_at` is deliberately preserved

### 3.1 The transition

```sql
UPDATE public.bookings
SET    status                = 'pending_payment',
       booking_fee_pence     = p_booking_fee_pence,
       is_admin_hold         = true,
       admin_hold_expires_at = p_hold_expires_at
       -- cancelled_at, cancellation_reason: DELIBERATELY NOT TOUCHED. See §3.2.
WHERE  id = p_booking_id AND status = 'cancelled';
```

Same shape as Gap A/B: lock, validate, transition via a single UPDATE, no waitlist_position concerns (a `cancelled` row from this origin never carries a meaningful `waitlist_position` for this flow's purposes — untouched either way, consistent with the family's "leave it alone unless actively relevant" convention).

### 3.2 Why `cancelled_at` is not cleared — the origin-tracking mechanism

The existing Gap B release RPC, `admin_revert_hold_to_waitlist`, is **origin-agnostic by design** (Addendum §B.1): its predicate is just `is_admin_hold = true AND status = 'pending_payment'`, and it *always* reverts to `waitlisted`. That was correct when there were only two origins and both origins' honest "give up and go back" destination was the same kind of thing conceptually (well, one was `waitlisted` and one was `confirmed` for *creation* rollback, but Gap B's *release* action was only ever built for the waitlist-shaped case — re-read Addendum §B.1: it reverts to `waitlisted` "regardless of origin" specifically because both of the two existing origins are safe to send there... actually, re-checking: Gap A's rows *also* get released via the *same* `admin_revert_hold_to_waitlist` RPC in the existing code, and Addendum §B.1 explicitly argues `waitlisted` is "the only sane exit for ANY hold, regardless of origin" for the *existing two* origins specifically because a Gap-A-remediated member, if abandoned, is safer parked on the waitlist than silently left in a state that could recreate the original bug).

**That reasoning does not extend to a third origin whose true "give up" destination is neither `waitlisted` nor `confirmed`, but `cancelled`.** A member who was reaped, then had their booking reinstated by an admin, then never paid and had the hold released — was **never on the waitlist this cycle** (same class of argument the addendum already made for Gap A vs. `waitlistPromotionTemplate`, applied to state instead of email copy). Reverting them to `waitlisted` would put them in a queue they were never actually in, ahead of members who *are* genuinely waitlisted. The honest release destination is `cancelled` — exactly where they were before the admin's reinstatement attempt.

**Reusing `admin_revert_hold_to_waitlist` for this origin is therefore wrong**, and the DB currently has **no other way to tell the three origins apart** on a `pending_payment` row — `is_admin_hold` is a single boolean, not an origin tag. Two ways to fix this:

- **(A) Add a new column** (`admin_hold_origin text` or similar) that all three creation RPCs stamp. Correct, general, extensible to a hypothetical fourth origin later — but touches two already-shipped, tested RPCs (`admin_promote_waitlist_to_hold`, `admin_hold_confirmed_booking_for_payment`) to add the stamp, plus a migration, for a benefit (perfect general extensibility) this task doesn't need today.
- **(B) Don't clear `cancelled_at` during this origin's own transition, and treat "`pending_payment` with a non-null `cancelled_at`" as the origin marker.** Verified this is unambiguous: no other existing code path ever transitions a row **from** `cancelled` **to** an active status (confirmed by exhaustively re-checking every `status =`/`status:` write site in §1.2 — every other flow either creates a **brand-new** row on re-booking, per the partial unique index, or never un-cancels an existing one). So a `pending_payment` row with `cancelled_at IS NOT NULL` can, today, only have gotten there via this new RPC.

**I chose (B).** Zero schema changes, ships in the urgent slice, and is easy to harden defensively (§3.3) rather than trusted blindly.

### 3.3 The defensive hardening this requires

Two small, additive changes to already-shipped code, both purely protective:

1. **`admin_revert_hold_to_waitlist`** (existing RPC) gets a `CREATE OR REPLACE` adding one line to its guard: `AND cancelled_at IS NULL` to its eligibility check (alongside the existing `is_admin_hold`/`status` check), so it **structurally refuses** to touch a reinstated-cancelled row even if a future UI bug ever routed a click to the wrong Server Action. This is a no-op for the two existing origins (their `pending_payment` holds never have `cancelled_at` set — they transition from `waitlisted`/`confirmed`, neither of which carries a `cancelled_at`).
2. The new **`admin_release_reinstated_hold_to_cancelled`** RPC's own guard requires `cancelled_at IS NOT NULL` as part of its eligibility check (the positive mirror of #1) — so it, symmetrically, refuses to touch a Gap A/B-origin hold.

Together, the two release RPCs are now **mutually exclusive by construction**, not just by UI convention — a defence-in-depth property directly analogous to the `cancelUrlFrom`/`rollbackStatus` lockstep table the base spec already built for the creation side (`ADMIN_HOLD_ORIGINS`).

### 3.4 Decision #3 corollary — which price gets charged (a real judgment call)

Gap A/waitlist-promotion both compute `bookingFeePence = calculateBookingFeePence(event.price)` — the event's **current** price. For this origin, I deviate: the fee (and the ticket price charged) should be computed from the booking's own **preserved** `price_at_booking`, not `event.price`.

Reasoning: this is the same principle `resume-checkout.ts` already established for a temporally-adjacent case (§1 of `SYSTEM-DESIGN-pending-payment-visibility.md`: "reuses the row's own snapshot... so a member who booked before a price change still pays what they originally agreed to"). A reinstated booking is, if anything, a *stronger* case for this than a same-day resume — the gap between original booking and reinstatement could plausibly be longer, and an admin silently re-pricing someone's already-agreed booking to a since-changed `event.price` without telling them would be a worse surprise than the resume-checkout scenario the precedent already protects against.

This requires one small, additive change to `runAdminHoldFlow` (§4.2) — a new `priceSource: 'event' | 'booking'` field on `AdminHoldOriginConfig`, defaulting the two existing origins to `'event'` (their exact current behaviour, byte-for-byte preserved) and this new origin to `'booking'`.

---

## 4. Decision #4/#5 — RPC, migration, and TS orchestration

### 4.1 New RPC — `admin_reinstate_cancelled_booking_for_payment`

Same family shape as `admin_promote_waitlist_to_hold`/`admin_hold_confirmed_booking_for_payment`: admin gate, lock booking, validate, lock event, validate + capacity check, transition. `jsonb_build_object('error', ...)` convention. `SET search_path = public, pg_catalog`.

```sql
CREATE OR REPLACE FUNCTION public.admin_reinstate_cancelled_booking_for_payment(
  p_booking_id        uuid,
  p_booking_fee_pence integer,
  p_hold_expires_at   timestamptz   -- NULL = no auto-revert (see §6)
)
RETURNS jsonb AS $$
DECLARE
  v_is_admin           boolean;
  v_event_id           uuid;
  v_user_id            uuid;
  v_current_status     booking_status;
  v_cancelled_at        timestamptz;
  v_cancellation_reason text;
  v_stripe_payment_id   text;
  v_refunded_pence      integer;
  v_is_admin_hold       boolean;
  v_price_at_booking    integer;
  v_capacity            integer;
  v_price               integer;
  v_event_date          timestamptz;
  v_is_cancelled_event  boolean;
  v_seat_count          integer;
  v_profile_deleted_at  timestamptz;
  v_other_active        boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  IF p_booking_fee_pence < 0 THEN
    RETURN jsonb_build_object('error', 'Invalid booking fee');
  END IF;

  -- Lock the booking row.
  SELECT event_id, user_id, status, cancelled_at, cancellation_reason,
         stripe_payment_id, refunded_amount_pence, is_admin_hold, price_at_booking
  INTO   v_event_id, v_user_id, v_current_status, v_cancelled_at, v_cancellation_reason,
         v_stripe_payment_id, v_refunded_pence, v_is_admin_hold, v_price_at_booking
  FROM   public.bookings
  WHERE  id = p_booking_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Booking not found');
  END IF;

  -- Eligibility predicate — §1.5. Each branch gets its own message so a
  -- refused reinstatement is diagnosable from the toast alone.
  IF v_current_status != 'cancelled' THEN
    RETURN jsonb_build_object('error', 'Only cancelled bookings can be reinstated');
  END IF;
  IF v_cancelled_at IS NULL THEN
    RETURN jsonb_build_object('error', 'This booking was not cancelled by the automatic payment timeout — cannot reinstate');
  END IF;
  IF v_cancellation_reason IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'This booking was cancelled as part of an event cancellation — cannot reinstate');
  END IF;
  IF v_stripe_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'This booking has a payment record — cannot reinstate');
  END IF;
  IF v_refunded_pence > 0 THEN
    RETURN jsonb_build_object('error', 'This booking was refunded — cannot reinstate');
  END IF;
  IF v_is_admin_hold THEN
    RETURN jsonb_build_object('error', 'This booking is already an active hold');
  END IF;
  IF v_price_at_booking IS NULL OR v_price_at_booking <= 0 THEN
    RETURN jsonb_build_object('error', 'This is a free-event booking — reinstate by re-booking directly, not via this tool');
  END IF;

  -- §1.4 — no other active booking for this member+event.
  SELECT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE event_id = v_event_id AND user_id = v_user_id
      AND id != p_booking_id AND status != 'cancelled' AND deleted_at IS NULL
  ) INTO v_other_active;
  IF v_other_active THEN
    RETURN jsonb_build_object('error', 'This member already has an active booking for this event');
  END IF;

  -- §1.3 — THE finding. Owning profile must not be soft-deleted.
  SELECT deleted_at INTO v_profile_deleted_at
  FROM public.profiles WHERE id = v_user_id;
  IF v_profile_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'This member''s account has been deleted — cannot reinstate');
  END IF;

  -- Lock the event row — serialises concurrent reinstatements/promotions/
  -- bookings against this event's capacity (§2).
  SELECT capacity, price, date_time, is_cancelled
  INTO   v_capacity, v_price, v_event_date, v_is_cancelled_event
  FROM   public.events
  WHERE  id = v_event_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;
  IF v_is_cancelled_event THEN
    RETURN jsonb_build_object('error', 'Event is cancelled');
  END IF;
  IF v_event_date < now() THEN
    RETURN jsonb_build_object('error', 'Event has already passed');
  END IF;
  IF v_price = 0 THEN
    RETURN jsonb_build_object('error', 'This is now a free event — reinstate by re-booking directly, not via this tool');
  END IF;

  -- §2 — capacity re-check, this IS a new admission (mirrors
  -- admin_promote_waitlist_to_hold, unlike admin_hold_confirmed_booking_
  -- for_payment which deliberately skips it — see §2 of the design doc).
  IF v_capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO v_seat_count
    FROM public.bookings
    WHERE event_id = v_event_id AND status IN ('confirmed', 'pending_payment') AND deleted_at IS NULL;
    IF v_seat_count >= v_capacity THEN
      RETURN jsonb_build_object('error', 'Event is at full capacity — cannot reinstate');
    END IF;
  END IF;

  -- Transition. cancelled_at / cancellation_reason DELIBERATELY left
  -- untouched — see §3.2/§3.3 of the design doc: the preserved non-NULL
  -- cancelled_at is what lets admin_release_reinstated_hold_to_cancelled
  -- (and admin_revert_hold_to_waitlist's own hardened guard) tell this
  -- origin apart from the other two without a new column.
  UPDATE public.bookings
  SET    status                = 'pending_payment',
         booking_fee_pence     = p_booking_fee_pence,
         is_admin_hold         = true,
         admin_hold_expires_at = p_hold_expires_at
  WHERE  id = p_booking_id AND status = 'cancelled';

  RETURN jsonb_build_object('booking_id', p_booking_id, 'user_id', v_user_id, 'status', 'pending_payment');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION public.admin_reinstate_cancelled_booking_for_payment(uuid, integer, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_reinstate_cancelled_booking_for_payment(uuid, integer, timestamptz) TO authenticated;
```

**Race note on the unique-index collision (§1.4):** even with the pre-check above, a genuinely concurrent new booking could theoretically land in the gap between the `NOT EXISTS` check and the final `UPDATE`. If so, the `UPDATE` itself will fail with `23505` (partial unique index violation) rather than silently succeeding — the TS layer (§4.3) should catch this specific code and surface a friendly retry message, same defensive-catch style already used elsewhere in this codebase for `23505`/`23514` (e.g. the webhook's `charge.refunded` handler).

### 4.2 New release RPC — `admin_release_reinstated_hold_to_cancelled`

Structurally parallel to `admin_revert_hold_to_waitlist` (Addendum §B.3), but:
- Guard requires `cancelled_at IS NOT NULL` (positive mirror of §3.3's hardening on the sibling RPC) instead of the implicit "any hold."
- Reverts to `'cancelled'`, not `'waitlisted'`.
- Does **not** call `recompute_waitlist_positions` — this booking was never on the waitlist this cycle, has no live waitlist entry to renumber.
- Does **not** touch `cancelled_at` on release either — it was never cleared by the create RPC, so it already correctly reflects "when this booking was cancelled" (the original reap), and there's no strong reason to bump it to "now" for a release that produces the exact same terminal state it started from.

```sql
CREATE OR REPLACE FUNCTION public.admin_release_reinstated_hold_to_cancelled(
  p_booking_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_is_admin     boolean;
  v_status       booking_status;
  v_is_hold      boolean;
  v_cancelled_at timestamptz;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  SELECT status, is_admin_hold, cancelled_at
  INTO   v_status, v_is_hold, v_cancelled_at
  FROM   public.bookings
  WHERE  id = p_booking_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Booking not found');
  END IF;

  -- Positive mirror of admin_revert_hold_to_waitlist's new
  -- `cancelled_at IS NULL` guard (§3.3) — this RPC only ever touches a
  -- reinstated-cancelled-origin hold, never a waitlist-promotion or
  -- payment-remediation one.
  IF NOT v_is_hold OR v_status != 'pending_payment' OR v_cancelled_at IS NULL THEN
    RETURN jsonb_build_object(
      'error',
      'This booking is not an active reinstatement hold — it may have already been paid, cancelled, or released.'
    );
  END IF;

  UPDATE public.bookings
  SET    status                = 'cancelled',
         is_admin_hold         = false,
         admin_hold_expires_at = NULL
         -- cancelled_at untouched — already correctly non-NULL from the
         -- original reap; this UPDATE just returns the row to the exact
         -- terminal shape it had before reinstatement.
  WHERE  id = p_booking_id AND status = 'pending_payment' AND is_admin_hold = true;

  RETURN jsonb_build_object('booking_id', p_booking_id, 'status', 'cancelled');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION public.admin_release_reinstated_hold_to_cancelled(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_release_reinstated_hold_to_cancelled(uuid) TO authenticated;
```

Also part of this migration: the one-line `CREATE OR REPLACE` hardening `admin_revert_hold_to_waitlist` with the added `AND cancelled_at IS NULL` guard (§3.3, item 1) — full function body otherwise byte-identical to Addendum §B.3's existing shipped version.

### 4.3 Migration file

`supabase/migrations/20260808000003_admin_reinstate_cancelled_booking_rpcs.sql` — contains:
1. `admin_reinstate_cancelled_booking_for_payment` (§4.1, new)
2. `admin_release_reinstated_hold_to_cancelled` (§4.2, new)
3. `CREATE OR REPLACE FUNCTION admin_revert_hold_to_waitlist` — existing function, one added guard clause (§3.3, item 1)

Header must state plainly (matching the established convention of Gap A/B's own migration header): **zero new columns, zero new enum values, zero RLS changes.** Everything reuses `is_admin_hold`/`admin_hold_expires_at` from `20260713000001`.

**Post-merge:** per `project_migration_apply_step` — CI applies to local Supabase only. After merge, run manually: `supabase db push --include-all --linked`. Verify:
```sql
SELECT proname FROM pg_proc
WHERE proname IN ('admin_reinstate_cancelled_booking_for_payment', 'admin_release_reinstated_hold_to_cancelled');
```
And spot-check the hardened guard didn't regress the existing Gap A/B release path:
```sql
-- Should still find/allow releasing any genuinely-existing waitlist_promotion
-- or payment_remediation hold (cancelled_at IS NULL for those).
SELECT id, status, is_admin_hold, cancelled_at FROM public.bookings
WHERE is_admin_hold = true AND status = 'pending_payment';
```

**Rollback:** `DROP FUNCTION IF EXISTS public.admin_reinstate_cancelled_booking_for_payment(uuid, integer, timestamptz);` and `DROP FUNCTION IF EXISTS public.admin_release_reinstated_hold_to_cancelled(uuid);`, then re-apply `admin_revert_hold_to_waitlist`'s pre-hardening body from Addendum §B.3 if the guard needs reverting too. Not destructive either direction. Any booking already reinstated before a rollback would be stuck `pending_payment`/`is_admin_hold=true` with `cancelled_at` set and no RPC left to release it cleanly to `cancelled` — same accepted residual-state class the base spec already documents for its own rollback story.

### 4.4 TS — `admin-hold.ts` changes

All additive to the already-shipped, tested file. **Constraint that must hold** (same discipline as Addendum §A.4): `createAdminBookingHold` and `createAdminPaymentRemediationHold`'s existing public signatures, behaviour, and test coverage must be preserved byte-for-byte.

1. Widen `AdminHoldOrigin`:
   ```ts
   type AdminHoldOrigin = 'waitlist_promotion' | 'payment_remediation' | 'cancelled_reinstatement'
   ```
2. Widen `AdminHoldOriginConfig`:
   ```ts
   interface AdminHoldOriginConfig {
     rpcName: 'admin_promote_waitlist_to_hold' | 'admin_hold_confirmed_booking_for_payment'
             | 'admin_reinstate_cancelled_booking_for_payment'
     rollbackStatus: 'waitlisted' | 'confirmed' | 'cancelled'   // widened
     /** NEW. 'event' (default-equivalent, existing two origins) charges
      *  event.price (current). 'booking' charges the row's own
      *  price_at_booking (preserved from the original booking) — see
      *  design doc §3.4 for why this origin deviates. */
     priceSource: 'event' | 'booking'
     templateName: string
     notificationType: 'waitlist' | 'reminder'
     renderEmail: (input: AdminHoldEmailContext) => RenderedTemplate
     logLabel: 'createAdminBookingHold' | 'createAdminPaymentRemediationHold' | 'createAdminReinstatementHold'
     cancelUrlFrom: 'admin_hold' | 'admin_remediation' | 'admin_reinstate'   // widened
   }
   ```
3. `waitlist_promotion` and `payment_remediation` entries each gain `priceSource: 'event'` (pure annotation — zero behaviour change, since that's already what they do today).
4. New entry:
   ```ts
   cancelled_reinstatement: {
     rpcName: 'admin_reinstate_cancelled_booking_for_payment',
     rollbackStatus: 'cancelled',   // Stripe/profile failure AFTER the RPC commits — see §4.5
     priceSource: 'booking',
     templateName: 'reinstated_booking_payment_link',
     notificationType: 'reminder',
     renderEmail: reinstatedBookingPaymentLinkTemplate,
     logLabel: 'createAdminReinstatementHold',
     cancelUrlFrom: 'admin_reinstate',
   },
   ```
5. `runAdminHoldFlow` changes (all additive, no behaviour change for the two existing origins):
   - Step 1's booking `.select()` widens to also fetch `price_at_booking` (harmless additive field for the other two origins, which simply won't reference it).
   - Step 3 becomes origin-aware:
     ```ts
     const priceInPence = config.priceSource === 'booking' ? booking.price_at_booking : event.price
     const bookingFeePence = calculateBookingFeePence(priceInPence)
     ```
   - Step 8's `createBookingCheckoutSession({ ..., priceInPence: event.price, ... })` generalises to `priceInPence` (the locally-resolved variable from step 3), not the literal `event.price`.
6. New public export, thin wrapper (mirrors `createAdminPaymentRemediationHold` exactly):
   ```ts
   export async function createAdminReinstatementHold(
     supabaseUserScoped: SupabaseClient,
     bookingId: string,
     options: { holdExpiresAt: Date | null },
   ): Promise<CreateAdminBookingHoldResult> {
     return runAdminHoldFlow('cancelled_reinstatement', supabaseUserScoped, bookingId, options)
   }
   ```
7. New public export, **not** built on `runAdminHoldFlow`/`releaseAdminBookingHold` (§3.2/§3.3 explains why the destinations genuinely differ) — structurally parallel to `releaseAdminBookingHold`, same best-effort Stripe-expire-after-DB-revert ordering (Addendum §B.2's reasoning applies identically — DB-first, Stripe best-effort, same "already paid" heuristic, same Sentry escalation tag):
   ```ts
   export interface ReleaseReinstatedBookingHoldResult {
     success: boolean
     error?: string
     status?: 'cancelled'
   }

   export async function releaseReinstatedBookingHold(
     supabaseUserScoped: SupabaseClient,
     bookingId: string,
   ): Promise<ReleaseReinstatedBookingHoldResult> {
     // 1. DB-side revert FIRST via admin_release_reinstated_hold_to_cancelled — authoritative.
     // 2. THEN best-effort stripe.checkout.sessions.expire() on the outstanding session,
     //    identical non-blocking / "already paid" Sentry-escalation pattern as
     //    releaseAdminBookingHold step 2 (tag: surface: 'releaseReinstatedBookingHold').
     // Full algorithm identical in shape to releaseAdminBookingHold (Addendum §B.4) —
     // not reproduced here to avoid duplicating ~50 lines; implement by mirroring that
     // function with the RPC name and result shape swapped.
   }
   ```

### 4.5 `abandonPendingCheckout` changes (`src/app/events/[slug]/actions.ts`)

Widen the `from` union and the rollback ternary:
```ts
options?: { from?: 'book' | 'claim' | 'admin_hold' | 'admin_remediation' | 'admin_reinstate' }

const rollbackStatus: BookingStatus =
  options?.from === 'admin_remediation'
    ? 'confirmed'
    : options?.from === 'admin_reinstate'
      ? 'cancelled'
      : options?.from === 'claim' || options?.from === 'admin_hold'
        ? 'waitlisted'
        : 'cancelled'
```
Note `'admin_reinstate'` and the default `'book'` case both resolve to `'cancelled'` today — spelled out as its own branch (not folded into the final `: 'cancelled'` fallback) for readability/auditability, and because a future change to either one's target shouldn't silently affect the other. The existing `.update({ is_admin_hold: false, admin_hold_expires_at: null })` clearing is already unconditional and needs no change. `cancelled_at` is deliberately **not** added to this update for the `admin_reinstate` case either — it's already non-NULL from the original reap and stays that way (§3.2's marker is preserved through this path too, for free).

### 4.6 New email template

`src/lib/email/templates/reinstated-booking-payment-link.ts`, exporting `reinstatedBookingPaymentLinkTemplate()`. Same primitives as its two siblings (`COLORS`, `renderButton`, `renderDetailRow`, `renderShell`, `escapeHtml`, `htmlToText`, `getSiteUrl`, `formatPriceExact`), same input shape as `AdminHoldEmailContext` already declared in `admin-hold.ts`.

**Why a third file, not a branch on either sibling** — same three-reason pattern the base spec and Addendum both already applied to justify their own new files, restated for this specific pairing: `waitlistPromotionTemplate` is wrong (never on the waitlist), `confirmedUnpaidPaymentLinkTemplate` is wrong (never held a confirmed seat this cycle — they were told, correctly, that their booking was cancelled), and a new file costs nothing extra.

**Framing, per the task brief's own instruction** (illustrative structure only, not final copy — ux-designer's job, §7):
- This is genuinely the third distinct scenario: not "you're being promoted from a queue" (waitlist_promotion), not "you already have a confirmed seat, just need to pay" (payment_remediation), but **"your spot was actually released when your payment window closed — we've reserved it again for you, but it could go again if you don't confirm."**
- Subject line direction: something conveying "your spot is back" / "second chance," not "you're confirmed" (they are not confirmed — `pending_payment` is not a confirmed state) and not "you're on the waitlist" (they're not).
- Must NOT imply the seat is guaranteed indefinitely — same urgency-block conditional structure as the other two templates (deadline text if `holdExpiresAt` set, neutral "complete payment to secure your spot" if `null` — which, per §6, will be `null` for the foreseeable future).
- Price shown: the booking's own preserved `price_at_booking` + fresh `booking_fee_pence` (per §3.4) — should read naturally as "here's what you'll pay," not draw attention to the fact this is a re-priced-from-history value (it isn't re-priced, but the copy shouldn't need to explain the mechanism either way).

### 4.7 New Server Actions (`src/app/(admin)/admin/actions.ts`)

Structurally identical to `sendPaymentLinkForConfirmedBooking`/`demoteAdminHold` (§Addendum-A.6/§B.5 of the precedent — pre-fetch for revalidate targets + success message only, RPC re-validates everything that matters under lock):

```ts
export async function reinstateCancelledBooking(bookingId: string) {
  const { supabase } = await requireAdmin()
  if (!bookingId) return { error: 'Booking ID is required' }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, event_id, user_id, status')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()
  if (bookingError || !booking) return { error: 'Booking not found' }
  if (booking.status !== 'cancelled') {
    return { error: 'Only cancelled bookings can be reinstated' }
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, slug, price')
    .eq('id', booking.event_id)
    .single()
  if (!event) return { error: 'Event not found' }
  if (event.price === 0) {
    return { error: 'This is a free event — reinstate by booking directly, not via this tool' }
  }

  // holdExpiresAt hardcoded null — see §6. No cron exists to act on a
  // non-null deadline for ANY origin yet; this origin has a mandatory
  // manual release action instead (releaseReinstatedHold below).
  const result = await createAdminReinstatementHold(supabase, bookingId, { holdExpiresAt: null })
  if (!result.success) return { error: result.error }

  const { data: profile } = await supabase
    .from('profiles').select('full_name').eq('id', booking.user_id).single()

  revalidatePath('/admin/events')
  revalidatePath(`/admin/events/${event.id}/bookings`)
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')

  return {
    success: true,
    memberName: profile?.full_name ?? 'Member',
    status: 'pending_payment' as const,
    holdExpiresAt: result.holdExpiresAt ?? null,
  }
}

export async function releaseReinstatedHold(bookingId: string) {
  const { supabase } = await requireAdmin()
  if (!bookingId) return { error: 'Booking ID is required' }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings').select('id, event_id, user_id').eq('id', bookingId).is('deleted_at', null).single()
  if (bookingError || !booking) return { error: 'Booking not found' }

  const result = await releaseReinstatedBookingHold(supabase, bookingId)
  if (!result.success) return { error: result.error }

  const [{ data: event }, { data: profile }] = await Promise.all([
    supabase.from('events').select('slug').eq('id', booking.event_id).single(),
    supabase.from('profiles').select('full_name').eq('id', booking.user_id).single(),
  ])

  revalidatePath('/admin/events')
  revalidatePath(`/admin/events/${booking.event_id}/bookings`)
  if (event?.slug) revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')

  return { success: true, memberName: profile?.full_name ?? 'Member', status: 'cancelled' as const }
}
```

### 4.8 UI wiring

`BookingRow` interface in `BookingsTable.tsx` needs one field it doesn't currently carry: `cancellation_reason: string | null` (it already carries `cancelled_at`, `is_admin_hold`, `admin_hold_expires_at` — verified by reading the current file). Data already flows through today (`getEventBookings`'s `.select()` already includes `cancellation_reason`); only the TS type is missing it — same class of pure-additive fix as Addendum §C.1.

New per-row visibility booleans, reusing the `cancelled_at`-as-origin-marker signal from §3.2/§3.3 (no new data needed — everything is already selected):

```ts
const showReinstate =
  isPaidEvent &&
  booking.status === 'cancelled' &&
  !booking.cancellation_reason &&
  !!booking.cancelled_at &&
  !booking.stripe_payment_id &&
  (booking.refunded_amount_pence ?? 0) === 0

// showDemote (EXISTING, unchanged) now implicitly excludes reinstated holds
// because those never have cancelled_at set to null — wait, they DO have
// cancelled_at set (non-null). Existing showDemote must be NARROWED:
const showDemote =
  booking.is_admin_hold === true && booking.status === 'pending_payment' && !booking.cancelled_at

const showReleaseReinstatement =
  booking.is_admin_hold === true && booking.status === 'pending_payment' && !!booking.cancelled_at
```

**This is a required, not optional, change to the existing `showDemote` line** — without narrowing it, the existing "Release hold" button would show (and, if clicked, now be correctly *rejected* by the RPC's hardened guard from §3.3 — so not unsafe, just confusing/dead-clicking) on a reinstated-origin row instead of the new, correctly-worded release button. Flagging this explicitly since it's a one-line but easy-to-miss edit to already-shipped code.

New components `src/components/admin/ReinstateBookingButton.tsx` and `src/components/admin/ReleaseReinstatedHoldButton.tsx`, following `PromoteButton.tsx`'s exact pattern (`useTransition`, `alert(result.error)`, inline success message, gold/danger visual language already established). `ReleaseReinstatedHoldButton` should keep the `confirm()` guard `DemoteHoldButton` added (Addendum §C.2's own judgment call, still unresolved per that doc's open question #3) — I'd lean toward keeping it here too, arguably even more warranted (this action puts a member who was just given a "second chance" back to fully cancelled, a more final-feeling action than "back to waitlist").

Page wiring (`src/app/(admin)/admin/events/[id]/bookings/page.tsx`) needs no new prop beyond the already-shipped `isPaidEvent` — reused as-is.

---

## 5. Decision #6 — no hard cutoff on how long after cancellation this stays offerable

Considered a hard RPC-enforced cutoff (e.g. "can't reinstate anything cancelled more than N days ago") and rejected it as a backend gate, for reasons parallel to how the base spec reasoned about Stripe session expiry vs. DB deadlines:

- The **event-not-past** check (`v_event_date < now()`) already structurally bounds the *useful* window — a booking cancelled long ago for an event that's since happened is already excluded, with zero extra code.
- A booking cancelled long ago for an event still comfortably in the future is a real, if unusual, case where reinstating is still perfectly legitimate (e.g. an admin doing a backlog cleanup of several old incidents in one sitting) — an arbitrary N-day cutoff would block a genuinely fine action for no safety benefit, since capacity (§2) and eligibility (§1) are already re-checked fresh regardless of age.
- The actual risk aging introduces isn't a data-integrity risk (nothing about the row becomes *unsafe* to reinstate purely by the passage of time — its eligibility predicate is evaluated fresh at click time either way) — it's a **product/judgment** risk: has the member moved on, would re-offering a payment link days or weeks later read as odd or unwanted. That's a UX signal, not a backend constraint.

**Recommendation, not decided here:** the admin bookings table should surface "cancelled 3 hours ago" / "cancelled 12 days ago" as a visible field next to the Reinstate button (data already available — `cancelled_at` is already selected), so the admin's own judgment is informed rather than the system silently refusing. This is explicitly ux-designer/frontend-developer territory (§7).

---

## 6. Decision #7 — hold expiry: `null`, same as Gap A, for a stronger reason than "just follow precedent"

The task brief asks whether urgency (the spot was already lost once) argues for something *shorter* than the Gap A/waitlist-promotion 4h-or-null pattern. My answer: the urgency argument is real, but it argues for a **mandatory manual release path** (which this design has — §4.2/4.7), not for a shorter *automated* deadline, because **there is currently no cron that acts on any non-null deadline for any origin** — `revert_expired_admin_holds` (migration `...000003`) still doesn't exist for Gap A/waitlist-promotion either, three weeks after that gap was first identified. Setting `admin_hold_expires_at` to, say, 1 hour instead of 4 hours (or instead of `null`) would create a DB-side deadline nothing currently reads or enforces — indistinguishable from `null` in every way that matters operationally, except that it would display a false countdown to the admin/member if the UI ever surfaces it literally.

`reinstateCancelledBooking` therefore hardcodes `holdExpiresAt: null`, identically to `promoteFromWaitlist` and `sendPaymentLinkForConfirmedBooking` today. What *does* meaningfully address the urgency concern: the release action (`releaseReinstatedHold`) exists and is a first-class button from day one of this feature (not deferred, unlike Gap B which shipped after the base spec) — an admin who sees a reinstated hold sitting unpaid can manually put it back to `cancelled` (freeing the seat again) at any time, with the exact same DB-first/Stripe-best-effort ordering already established.

**Flagged for future work, not solved here:** when the systemic `revert_expired_admin_holds` cron eventually ships for the other two origins, it will need either a third `WHERE`-branch (`cancelled_at IS NOT NULL` rows revert to `cancelled`, not `waitlisted`) or a dedicated sibling cron — the same "siblings, not shared" call the addendum already made for the cron-vs-manual-release split (Addendum §B.6), extended to a third destination. Not designing that cron here since it's explicitly out of scope and still doesn't exist for the two origins it was originally meant to serve.

---

## 7. Scoping note — paid events only

Both new RPCs reject `event.price = 0` / `booking.price_at_booking <= 0`. A cancelled `pending_payment` row can only have originated on a paid event in the first place (`book_event()`, the free-booking path, never creates a `pending_payment` row — confirmed by the base spec's own §4.2 reasoning: "a free event can never have a `pending_payment` row against it"), so this guard is defensive/belt-and-braces rather than something expected to actually reject a real row for the four members in question — flagged for completeness, not because it's expected to bite.

---

## 8. Open questions / judgment calls for the developer

1. **`profiles.status = 'active'` check (§1.5)** — recommended addition, not silently baked in. Confirm whether reinstating a `suspended`/`banned` member's booking should be blocked at the RPC level, or left to admin judgment (the admin already has to find and click the row manually — some argue that's sufficient friction).
2. **`ReleaseReinstatedHoldButton`'s `confirm()` guard** — recommended (§4.8), mirroring `DemoteHoldButton`'s own still-open question from the precedent doc. Confirm whether to keep it.
3. **Reinstated-hold sweep when the systemic revert-cron eventually ships (§6)** — flagged as a design fork for whoever builds that migration, not resolved here, consistent with how the precedent doc already left the analogous question open for the other two origins (Addendum §B.6, open question #4).
4. **Copy sign-off** — the email template (§4.6) and the button/badge copy on the admin bookings table are explicitly ux-designer's, not resolved here. See §9.
5. **`abandonPendingCheckout`'s three-way-if-else readability** — after this change it has four named branches collapsing to three actual destinations (`confirmed`/`waitlisted`/`cancelled`). Purely a code-clarity nit, not a behaviour concern; flagging in case the developer wants to restructure it as an explicit switch/lookup rather than nested ternaries once a third distinct `from` value exists.

---

## 9. Why this stayed on the `pending-payment-visibility` branch

The task instructed staying unless there's a strong reason to branch separately. There isn't one: this is the same `bookings.pending_payment` lifecycle, touches the same reaper/hold mechanics, and several of the files this spec modifies (`abandonPendingCheckout`, `admin-hold.ts`) are either already modified on this branch (per the visibility spec, not yet implemented as of this writing — confirmed by checking git status, working tree clean, no diff vs. main yet for those specific functions) or immediately adjacent to files that are. Splitting into a second branch would only create a merge-ordering dependency between two branches touching the same functions for no isolation benefit — worse, not better, than one branch.

---

## 10. File manifest

**New migration:**
- `supabase/migrations/20260808000003_admin_reinstate_cancelled_booking_rpcs.sql`

**New application files:**
- `src/lib/email/templates/reinstated-booking-payment-link.ts`
- `src/components/admin/ReinstateBookingButton.tsx`
- `src/components/admin/ReleaseReinstatedHoldButton.tsx`

**Modified files:**
- `src/lib/bookings/admin-hold.ts` — widen `AdminHoldOrigin`/`AdminHoldOriginConfig` (+`priceSource`, +`'cancelled'` rollback target), new `ADMIN_HOLD_ORIGINS.cancelled_reinstatement` entry, `runAdminHoldFlow` origin-aware price resolution, two new exports (`createAdminReinstatementHold`, `releaseReinstatedBookingHold`).
- `src/app/events/[slug]/actions.ts` — `abandonPendingCheckout`'s `from` union + rollback ternary gain `'admin_reinstate'` → `'cancelled'`.
- `src/app/(admin)/admin/actions.ts` — two new Server Actions (`reinstateCancelledBooking`, `releaseReinstatedHold`); new imports.
- `src/components/admin/BookingsTable.tsx` — `BookingRow` gains `cancellation_reason`; new `showReinstate`/`showReleaseReinstatement` visibility booleans; **narrows existing `showDemote`** to exclude `cancelled_at`-marked rows (required, not optional — §4.8).

**Not modified (confirmed, not assumed):**
- `src/types/index.ts` / `AdminEventBooking` — already carries every field this feature reads (`cancellation_reason`, `cancelled_at`, `stripe_payment_id`, `refunded_amount_pence`, `is_admin_hold`, `admin_hold_expires_at`, `price_at_booking`). No type changes needed.
- Any RLS policy.
- `resume-checkout.ts` — confirmed out of scope (§0, decision #4) — untouched.
- `admin_promote_waitlist_to_hold`, `admin_hold_confirmed_booking_for_payment` — untouched (only `admin_revert_hold_to_waitlist` gets the one added guard line, via `CREATE OR REPLACE`, §3.3).

**Test surface (for the tester agent, not written here):** `admin-hold.test.ts` needs a regression pass (existing two origins' behaviour byte-identical) plus new cases for `createAdminReinstatementHold`/`releaseReinstatedBookingHold`, including: eligibility rejections for each branch in §1.5 (especially the deleted-profile case — this is the safety-critical one to actually exercise, not just spec), the capacity race (two concurrent reinstatements for the last paid spot), and the active-booking-collision case (§1.4). A new admin-actions test file needs security-relevant cases (non-admin rejected, wrong-status rejected, event-cancelled rejected, capacity-full rejected). `BookingsTable.test.tsx` needs cases for the narrowed `showDemote` + new `showReinstate`/`showReleaseReinstatement` three-way mutual exclusivity.
