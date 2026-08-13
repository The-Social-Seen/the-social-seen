# SYSTEM DESIGN — `public.bookings` Write-Authorization Hardening

Status: **DESIGN ONLY — not implemented.** Written by the architect agent in
response to a code-review finding while adversarially reviewing today's
`abandon_pending_checkout` fix. Planner to sequence implementation.

Related, already-shipped/approved work this design builds on top of (do not
re-touch):
- `supabase/migrations/20260812171530_revoke_bookings_admin_hold_column_write.sql`
- `supabase/migrations/20260812180000_abandon_pending_checkout_rpc.sql`
- `docs/SYSTEM-DESIGN-abandon-checkout-rpc.md`

---

## 1. The vulnerability

`public.bookings`' RLS + grants (`supabase/migrations/20260402000006_create_bookings.sql`)
have never validated **what** a caller writes, only **whose row** they're
writing:

```sql
CREATE POLICY "bookings_insert" ON public.bookings FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "bookings_update" ON public.bookings FOR UPDATE
  USING (user_id = auth.uid() OR <admin>);   -- NO WITH CHECK
```

No migration has ever `REVOKE`d column-level `INSERT`/`UPDATE` on `status`,
`price_at_booking`, or `waitlist_position` for the Postgres `authenticated`/
`anon` roles (`grep -rn "REVOKE" supabase/migrations/*.sql | grep -i bookings`
— zero hits touching these three columns before this design). Net effect,
confirmed exploitable via a direct `PATCH`/`POST` to
`{SUPABASE_URL}/rest/v1/bookings` with any member's own session token:

- **Exploit A (UPDATE):** `PATCH ...bookings?id=eq.<own-booking-id>` with
  `{"status":"confirmed"}` — turns any of the member's own
  `pending_payment`/`waitlisted` rows into a confirmed ticket, bypassing
  Stripe and every RPC's business logic.
- **Exploit B (INSERT, more severe):** `POST ...bookings` with
  `{"event_id":"<any-event>","status":"confirmed","price_at_booking":0}` —
  fabricates a brand-new confirmed booking for **any** event, including
  sold-out ones. Bypasses `book_event`/`book_event_paid` entirely — no
  capacity check, no duplicate-booking check, no payment.
- **Secondary:** `price_at_booking` tampering corrupts `cancelBooking`'s
  Stripe refund amount (`amount: booking.price_at_booking` — a member could
  inflate this before cancelling to over-refund themselves) and
  `waitlist_position` tampering can fabricate queue position.

This is **pre-existing** (present since the table was created in migration
`20260402000006`), not caused by anything shipped today. It makes the
`abandon_pending_checkout` fix (and the `is_admin_hold` column-revoke)
largely moot: even with that door closed, a member can just PATCH `status`
straight to `'confirmed'` and skip the derivation logic entirely.

---

## 2. Exhaustive inventory of direct writers

Grepped `\.update\(` and `\.insert\(` against `bookings` across
`src/app/events/`, `src/app/(admin)/`, `src/app/(member)/`, `src/app/api/`,
and `src/lib/bookings/`. **Zero** direct `.insert()` calls against
`bookings` exist anywhere in `src/` — `createBooking`, `createPaidCheckout`,
and `claimWaitlistSpot` all create rows exclusively via the `book_event` /
`book_event_paid` / `claim_waitlist_spot` RPCs (all pre-existing
`SECURITY DEFINER`). This substantially simplifies §5.

For `status` / `price_at_booking` / `waitlist_position` specifically:

| # | Writer | File : line | Client | Columns written | Verdict |
|---|--------|-------------|--------|------------------|---------|
| 1 | `createBooking` | `src/app/events/[slug]/actions.ts:53` | user-scoped, via `book_event` RPC | none directly | Clean — no change |
| 2 | `createPaidCheckout` (session-id write) | `actions.ts:344-346` | user-scoped | `stripe_checkout_session_id` only | Not in scope (see §7.1) — no change |
| 3 | `createPaidCheckout` (Stripe-failure rollback) | `actions.ts:368-372` | **user-scoped, direct UPDATE** | `status` | **MUST fix — reuse `abandon_pending_checkout` RPC** |
| 4 | `claimWaitlistSpot` (session-id write) | `actions.ts:520-522` | user-scoped | `stripe_checkout_session_id` only | Not in scope — no change |
| 5 | `claimWaitlistSpot` (Stripe-failure rollback) | `actions.ts:538-542` | **user-scoped, direct UPDATE** | `status` | **MUST fix — reuse `abandon_pending_checkout` RPC** |
| 6 | `abandonPendingCheckout` | `actions.ts:631+` | calls `abandon_pending_checkout` RPC | n/a | Already fixed today, untouched |
| 7 | `cancelBooking` | `actions.ts:900-913` | **user-scoped, direct UPDATE** | `status`, `cancelled_at`, `refunded_amount_pence`, `refunded_at`, `stripe_refund_id` | **MUST fix — new RPC `cancel_confirmed_booking`** |
| 8 | `leaveWaitlist` | `actions.ts:1103-1105` | **user-scoped, direct UPDATE** | `status`, `waitlist_position` | **MUST fix — new RPC `leave_waitlist`** |
| 9 | `promoteFromWaitlist` (paid branch) | `src/app/(admin)/admin/actions.ts:1791` | calls `admin_promote_waitlist_to_hold` RPC via `createAdminBookingHold` | n/a | Already RPC-based, untouched |
| 10 | `promoteFromWaitlist` (**free** branch) | `admin/actions.ts:1836-1838` | **user-scoped, direct UPDATE** (`requireAdmin()`'s `supabase`) | `status`, `waitlist_position` | **MUST fix — new RPC `admin_promote_waitlist_to_confirmed`** |
| 11 | `setNoShow` | `admin/actions.ts:2941-2945` (approx.) | **user-scoped, direct UPDATE** (`requireAdmin()`'s `supabase`) | `status` | **MUST fix — new RPC `set_booking_no_show`** |
| 12 | `cancelEventAndRefundBookings` (4 branches: refund / free-confirmed / waitlisted / pending_payment) | `admin/actions.ts:1240,1300,1333,1367` | `createAdminClient()` (service_role) | `status`, `waitlist_position`, `is_admin_hold`, `admin_hold_expires_at` | Already service_role — unaffected by any REVOKE, no change |
| 13 | `sendPaymentLinkForConfirmedBooking`, `demoteAdminHold`, `reinstateCancelledBooking`, `releaseReinstatedHold` | `admin/actions.ts` (call into `src/lib/bookings/admin-hold.ts`) | user-scoped, but via `.rpc()` to `admin_hold_confirmed_booking_for_payment` / `admin_revert_hold_to_waitlist` / `admin_reinstate_cancelled_booking_for_payment` / `admin_release_reinstated_hold_to_cancelled` | n/a | Already RPC-based (today's precedent family) — untouched |
| 14 | `deleteMyAccount` | `src/app/(member)/profile/privacy-actions.ts:258-263` | `createAdminClient()` (service_role) | `status`, `cancelled_at` | Already service_role — unaffected, no change |
| 15 | Stripe webhook (`handleCheckoutCompleted` etc.) | `src/app/api/stripe/webhook/route.ts:165,226-227,337-340,367,503,508,520,543-544` | `createAdminClient()` (service_role), 4 separate `admin` instantiations | `status`, `price_at_booking` (line 215, comp-booking `£0` write), `stripe_fee_pence`, refund fields | Already service_role — unaffected, no change |
| 16 | `resumePendingBookingCheckout` | `src/lib/bookings/resume-checkout.ts:259-263` | `createAdminClient()` (service_role) | `stripe_checkout_session_id` only | Already service_role, and not an in-scope column — no change |
| 17 | Reaper cron (`reap_stale_pending_bookings`) | `supabase/migrations/20260713000002...sql` (called from `src/app/api/admin/cron/reap-stale-bookings/route.ts:113-116`, defensive path only) | `SECURITY DEFINER` RPC, `admin = createAdminClient()` at TS call site | `status`, `cancelled_at` | Already RPC + service_role — unaffected, no change |
| 18 | `recompute_waitlist_positions` | called from `actions.ts:1118`, `admin/actions.ts:1844` | user-scoped client calling a `SECURITY DEFINER` RPC | `waitlist_position` (bulk) | Already RPC — unaffected, no change |

**Conclusion: exactly 6 call sites (rows 3, 5, 7, 8, 10, 11), across 2
files, are the entire fix surface.** Everything else already follows the
RPC-or-service_role discipline this codebase established across today's
prior three rounds and the `admin_promote_waitlist_to_hold` /
`admin_hold_confirmed_booking_for_payment` family. `price_at_booking` in
particular has **zero** user-scoped-client writers anywhere — its only
writer is the Stripe webhook via service_role (row 15) — so revoking it
requires **no code changes at all**.

---

## 3. Design: converting the 6 sites

### 3.1 Rows 3 & 5 — `createPaidCheckout` / `claimWaitlistSpot` Stripe-failure rollback → **reuse `abandon_pending_checkout`, no new RPC**

This is the one genuinely nice finding: both rollback sites are semantically
identical to what `abandon_pending_checkout` (shipped this morning) already
does.

- `createPaidCheckout`'s catch block rolls a **fresh** `pending_payment` row
  (just inserted by `book_event_paid`, `is_admin_hold=false`,
  `waitlist_position=NULL`) back to `cancelled` on Stripe failure.
  `abandon_pending_checkout`'s derivation table: `is_admin_hold=false`,
  `waitlist_position IS NULL` → `v_rollback_status := 'cancelled'`. **Exact
  match.**
- `claimWaitlistSpot`'s catch block rolls a `pending_payment` row (just
  transitioned by `claim_waitlist_spot`, which — confirmed by reading
  `20260517000002_book_event_paid_with_fee.sql` lines 306-322 — leaves
  `waitlist_position` **untouched** on the waitlisted→pending_payment
  transition) back to `waitlisted`. `abandon_pending_checkout`'s
  derivation: `is_admin_hold=false`, `waitlist_position IS NOT NULL` →
  `v_rollback_status := 'waitlisted'`. **Exact match.**

**Fix:** replace both direct `.update({status:...}).eq('id', bookingId).eq('status','pending_payment')`
calls with:

```ts
await supabase.rpc('abandon_pending_checkout', {
  p_user_id: user.id,
  p_event_id: eventId,
})
```

No new migration needed for these two sites. `abandon_pending_checkout` is
already `SECURITY DEFINER`, already approved, already immune to the planned
REVOKE. This also closes a secondary, previously-unflagged bug: the current
direct-UPDATE rollback in both catch blocks has no row lock (`FOR UPDATE`)
between its own read (implicit, via the `.eq('status','pending_payment')`
guard) and write — `abandon_pending_checkout` does, for free.

One behavioural nuance to verify during implementation: `abandon_pending_checkout`
looks up the row by `(user_id, event_id)` rather than `booking_id` — fine
here, since both call sites already have `eventId` in scope and the
partial-unique index guarantees at most one non-cancelled row per
`(user_id, event_id)`.

### 3.2 Row 7 — `cancelBooking` → new RPC `cancel_confirmed_booking`

Unlike `abandon_pending_checkout`, this flow has a **real external I/O
boundary** (the Stripe refund API call) between validation and the final
write, so — same as `createPaidCheckout` itself already does around
`book_event_paid` — the "read + branch + write in one locked transaction"
pattern from `abandon_pending_checkout` doesn't fully apply. The design
keeps the existing shape (TS does ownership/eligibility reads → calls
Stripe if eligible → RPC does the final atomic write) and only moves the
**last** UPDATE into a `SECURITY DEFINER` function.

```sql
CREATE OR REPLACE FUNCTION public.cancel_confirmed_booking(
  p_user_id               uuid,
  p_booking_id            uuid,
  p_refunded_amount_pence integer,   -- 0 if not refund-eligible
  p_stripe_refund_id      text       -- NULL if no refund was issued
)
RETURNS jsonb AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
  END IF;

  IF p_refunded_amount_pence < 0 THEN
    RETURN jsonb_build_object('error', 'Invalid refund amount');
  END IF;

  -- Lock the caller's own row. Mirrors abandon_pending_checkout's lookup
  -- shape; the partial unique index (idx_bookings_active) guarantees at
  -- most one non-cancelled row per (user_id, event_id), but we key on
  -- booking_id here (not event_id) because the TS caller already has it
  -- and cancelBooking's public contract takes a bookingId, not eventId.
  SELECT id INTO v_booking_id
  FROM   public.bookings
  WHERE  id      = p_booking_id
    AND  user_id = p_user_id
    AND  status  = 'confirmed'
    AND  deleted_at IS NULL
  FOR UPDATE;

  IF v_booking_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Booking was already cancelled or modified');
  END IF;

  UPDATE public.bookings
  SET    status                 = 'cancelled',
         cancelled_at           = now(),
         refunded_amount_pence  = p_refunded_amount_pence,
         refunded_at            = CASE WHEN p_stripe_refund_id IS NOT NULL THEN now() ELSE NULL END,
         stripe_refund_id       = p_stripe_refund_id
  WHERE  id     = v_booking_id
    AND  status = 'confirmed';

  RETURN jsonb_build_object('booking_id', v_booking_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.cancel_confirmed_booking(uuid, uuid, integer, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_confirmed_booking(uuid, uuid, integer, text) TO authenticated;
```

**TS change (`cancelBooking`, `src/app/events/[slug]/actions.ts:900-913`):**
keep everything before the UPDATE exactly as-is (ownership check, event
fetch, refund-window math, the `try { stripe.refunds.create(...) }` block,
and — critically — the "refund succeeded but DB update failed" reconciliation
branch, which must now check `rpcError`/`result.error` instead of
`updateError`/`!updated`, but keeps identical Sentry/logging behaviour).
Replace the `.update({...}).eq(...).eq(...).select().single()` chain with:

```ts
const { data: rpcData, error: rpcError } = await supabase.rpc(
  'cancel_confirmed_booking',
  {
    p_user_id: user.id,
    p_booking_id: bookingId,
    p_refunded_amount_pence: refundedPence,
    p_stripe_refund_id: stripeRefundId,
  },
)
const result = rpcData as Record<string, unknown> | null
if (rpcError || !result || result.error) { /* same reconcile-and-error-return branch as today, keyed off rpcError?.message ?? result?.error */ }
```

`ActionResult` contract (`{ success: true, refundedPence, refundEligible }`
on success / `{ success: false, error }` on failure) is unchanged — this is
purely an internal plumbing swap.

### 3.3 Row 8 — `leaveWaitlist` → new RPC `leave_waitlist`

Folds the existing two-step "UPDATE then separately call
`recompute_waitlist_positions`" into one RPC for atomicity (a strict
improvement — closes the pre-existing gap where a leave could succeed and
the recompute call could independently fail, leaving stale positions; not a
behavioural change visible to the user, who only ever saw `{success:true}`
either way).

```sql
CREATE OR REPLACE FUNCTION public.leave_waitlist(
  p_user_id    uuid,
  p_booking_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_booking_id uuid;
  v_event_id   uuid;
BEGIN
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
  END IF;

  SELECT id, event_id INTO v_booking_id, v_event_id
  FROM   public.bookings
  WHERE  id      = p_booking_id
    AND  user_id = p_user_id
    AND  status  = 'waitlisted'
    AND  deleted_at IS NULL
  FOR UPDATE;

  IF v_booking_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Booking was already cancelled or modified');
  END IF;

  UPDATE public.bookings
  SET    status            = 'cancelled',
         waitlist_position = NULL
  WHERE  id     = v_booking_id
    AND  status = 'waitlisted';

  -- Same recompute already used by leaveWaitlist today — folded into this
  -- transaction instead of a second round trip from TS.
  PERFORM public.recompute_waitlist_positions(v_event_id);

  RETURN jsonb_build_object('booking_id', v_booking_id, 'event_id', v_event_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.leave_waitlist(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.leave_waitlist(uuid, uuid) TO authenticated;
```

**TS change (`leaveWaitlist`, `actions.ts:1103-1120`):** replace the
`.update(...)` chain AND the subsequent `supabase.rpc('recompute_waitlist_positions', ...)`
call with a single `supabase.rpc('leave_waitlist', { p_user_id: user.id, p_booking_id: bookingId })`
call; map `result.error` to the existing `{ success: false, error: ... }`
shape (same message: `'Booking was already cancelled or modified'`).
`ActionResult` contract (`{ success: true }`) unchanged.

### 3.4 Row 10 — `promoteFromWaitlist` free branch → new RPC `admin_promote_waitlist_to_confirmed`

Mirrors `admin_promote_waitlist_to_hold` (`20260713000002`) exactly —
same admin-gate style (`EXISTS (... profiles ... role='admin')` against
`auth.uid()`, not an owner check), same row-lock-booking-then-lock-event
shape, same capacity predicate (`IN ('confirmed','pending_payment')`, per
the widened-capacity fix from that same migration). Difference: transitions
straight to `confirmed` (free event, no Stripe hold) and defensively
rejects paid events (the mirror image of the hold RPC's "free events
should be confirmed directly, not held" guard) so a future caller can never
accidentally give away a paid seat for free through this function.

```sql
CREATE OR REPLACE FUNCTION public.admin_promote_waitlist_to_confirmed(
  p_booking_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_is_admin        boolean;
  v_event_id        uuid;
  v_user_id         uuid;
  v_current_status  booking_status;
  v_capacity        integer;
  v_price           integer;
  v_event_date      timestamptz;
  v_is_cancelled    boolean;
  v_seat_count      integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  SELECT event_id, user_id, status
  INTO   v_event_id, v_user_id, v_current_status
  FROM   public.bookings
  WHERE  id = p_booking_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Booking not found');
  END IF;

  IF v_current_status != 'waitlisted' THEN
    RETURN jsonb_build_object(
      'error',
      CASE
        WHEN v_current_status IN ('confirmed', 'pending_payment') THEN 'This member already has a spot for this event'
        WHEN v_current_status = 'cancelled' THEN 'This booking was cancelled'
        ELSE 'Booking is not waitlisted'
      END
    );
  END IF;

  SELECT capacity, price, date_time, is_cancelled
  INTO   v_capacity, v_price, v_event_date, v_is_cancelled
  FROM   public.events
  WHERE  id = v_event_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;
  IF v_is_cancelled THEN
    RETURN jsonb_build_object('error', 'Event is cancelled');
  END IF;

  -- Sanity: mirror image of admin_promote_waitlist_to_hold's own guard.
  IF v_price != 0 THEN
    RETURN jsonb_build_object('error', 'Paid events must be promoted via a payment hold, not confirmed directly');
  END IF;

  IF v_capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO v_seat_count
    FROM   public.bookings
    WHERE  event_id = v_event_id
      AND  status   IN ('confirmed', 'pending_payment')
      AND  deleted_at IS NULL;
    IF v_seat_count >= v_capacity THEN
      RETURN jsonb_build_object('error', 'Event is at full capacity — cannot promote');
    END IF;
  END IF;

  UPDATE public.bookings
  SET    status = 'confirmed', waitlist_position = NULL
  WHERE  id = p_booking_id AND status = 'waitlisted';

  PERFORM public.recompute_waitlist_positions(v_event_id);

  RETURN jsonb_build_object('booking_id', p_booking_id, 'user_id', v_user_id, 'status', 'confirmed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.admin_promote_waitlist_to_confirmed(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_promote_waitlist_to_confirmed(uuid) TO authenticated;
```

Note: `event_date < now()` past-event guard was **not** present in the
original free-branch TS code (only the paid branch's `admin_promote_waitlist_to_hold`
has it) — preserved as-is, not added, to avoid an unreviewed behavioural
change riding on a security fix. Worth flagging to the developer as a
possible separate gap (an admin could promote a waitlisted booking on a
past free event today) but explicitly out of scope here.

**TS change (`promoteFromWaitlist`, `admin/actions.ts:1824-1838`):** replace
the manual seat-count `.select('id',{count:'exact',head:true})` +
`.update({status:'confirmed', waitlist_position:null})` + the later
`recompute_waitlist_positions` RPC call with one
`supabase.rpc('admin_promote_waitlist_to_confirmed', { p_booking_id: bookingId })`
call. Return shape (`{ success: true, promotedName, status: 'confirmed' as const }`)
unchanged — `promotedName` still comes from the existing separate
`profiles` SELECT that follows.

### 3.5 Row 11 — `setNoShow` → new RPC `set_booking_no_show`

```sql
CREATE OR REPLACE FUNCTION public.set_booking_no_show(
  p_booking_id uuid,
  p_no_show    boolean
)
RETURNS jsonb AS $$
DECLARE
  v_is_admin       boolean;
  v_current_status booking_status;
  v_event_date     timestamptz;
  v_source_status  booking_status;
  v_target_status  booking_status;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  v_source_status := CASE WHEN p_no_show THEN 'confirmed' ELSE 'no_show' END;
  v_target_status := CASE WHEN p_no_show THEN 'no_show'   ELSE 'confirmed' END;

  SELECT b.status, e.date_time
  INTO   v_current_status, v_event_date
  FROM   public.bookings b
  JOIN   public.events e ON e.id = b.event_id
  WHERE  b.id = p_booking_id AND b.deleted_at IS NULL
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Booking not found');
  END IF;

  IF v_event_date > now() THEN
    RETURN jsonb_build_object('error', 'No-show can only be marked for past events');
  END IF;

  IF v_current_status != v_source_status THEN
    RETURN jsonb_build_object(
      'error',
      CASE WHEN p_no_show THEN 'Only confirmed bookings can be marked no-show'
           ELSE 'Only no-show bookings can be reverted' END
    );
  END IF;

  UPDATE public.bookings
  SET    status = v_target_status
  WHERE  id = p_booking_id AND status = v_source_status;

  RETURN jsonb_build_object('booking_id', p_booking_id, 'status', v_target_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.set_booking_no_show(uuid, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_booking_no_show(uuid, boolean) TO authenticated;
```

**TS change (`setNoShow`, `admin/actions.ts` ~line 2910-2950):** the initial
booking fetch (for the up-front "past event" / "wrong source status" error
messages that render before any write is attempted) can stay as a read-only
`.select()` — unaffected by any REVOKE — or be dropped in favour of letting
the RPC be the sole source of truth for both validation and write; keeping
the TS-side pre-check gives snappier, identically-worded error messages
without a round trip in the common "already correct state" case, so I'd
keep it and just swap the final `.update(...)` for
`supabase.rpc('set_booking_no_show', { p_booking_id: bookingId, p_no_show: on })`.
Return shape (`{ success: true }` / `{ error }`) unchanged.

---

## 4. `bookings_insert` — tighten or revoke?

**Revoke `INSERT` entirely.** Per §2's exhaustive grep, there is no
legitimate direct-client-INSERT code path anywhere in `src/` — all booking
creation goes through `book_event`, `book_event_paid`, or
`claim_waitlist_spot`, all pre-existing `SECURITY DEFINER` functions owned
by an elevated role, which bypass table-level grants (and RLS) entirely by
virtue of executing as their owner. A partial `WITH CHECK` tightening
(e.g. "status must be pending_payment or waitlisted, never confirmed")
would still leave Exploit B partially open — a member could still forge a
`waitlisted` or `pending_payment` row for any event with a spoofed
`price_at_booking`/`waitlist_position`, which is materially worse than
"no direct insert at all." A full `REVOKE INSERT` closes Exploit B
completely with zero code changes required (mirrors the `price_at_booking`
finding — the safest fixes here are the ones that need no application code
change at all).

```sql
REVOKE INSERT ON public.bookings FROM authenticated, anon;
```

The existing `bookings_insert` RLS policy is left in place (not dropped) as
documentation/defense-in-depth: if some future migration ever re-grants
table-level `INSERT` to `authenticated` without knowing why it was revoked,
the RLS `WITH CHECK (user_id = auth.uid())` still limits the blast radius
to "can only forge a booking for themselves," not for arbitrary users. I
am **not** recommending also tightening the `WITH CHECK` clause itself
(e.g. restricting `status`) in this pass — it's currently unreachable once
`INSERT` is revoked at the grant layer, and adding dead-code-until-a-future-regrant
logic without a driving need risks its own maintenance confusion. Flagged
as a cheap, low-priority future hardening item, not required now.

---

## 5. The REVOKE statements

Once §3's 6 call sites are converted (and confirmed live in production —
see §7.2 sequencing):

```sql
REVOKE UPDATE (status, price_at_booking, waitlist_position)
  ON public.bookings FROM authenticated, anon;

REVOKE INSERT ON public.bookings FROM authenticated, anon;
```

Both statements are naturally idempotent (Postgres REVOKE of an
already-absent or never-granted privilege is a no-op, not an error) and
belong in **one** migration file — there's no reason to split UPDATE and
INSERT into separate files; they're both "close the gap now that every
legitimate writer has moved off the user-scoped client," a single
conceptual change, unlike the `is_admin_hold` precedent where the RPC
creation and the REVOKE were split across two files for a specific reason
(see next section for why that specific reason doesn't reapply the same
way here).

`anon` is included for defense-in-depth exactly as the `is_admin_hold`
precedent did — `anon` cannot reach `bookings` at all today via RLS
(no anon SELECT/INSERT/UPDATE policy exists), so this has no functional
effect beyond closing the door if a future RLS policy ever loosens that.

---

## 6. Sequencing / bundling — recommendation

The `is_admin_hold` precedent (`20260812171530` + `20260812180000`) bundled
its RPC-creation migration and its REVOKE migration into the **same PR /
same `supabase db push` run**, because the two were tightly coupled in a
way that made a *partial* deploy actively dangerous: `abandonPendingCheckout`'s
old TS code unconditionally wrote `is_admin_hold` on **every single call**
(not just the exploit path), so revoking that column before the RPC
replacement shipped would have broken 100% of ordinary abandon-checkout
traffic, and shipping the RPC without the REVOKE would have left the
original vulnerability open with no forcing function to ever land the
REVOKE.

**This fix is structurally different, and I recommend the opposite
sequencing: two independent, sequential PRs, not one bundled PR.**

- **Phase 1 (safe to ship alone, non-breaking either direction):** the 4
  new RPCs (§3.2-3.5) + the `abandon_pending_checkout` reuse (§3.1) + the
  6 corresponding `actions.ts` call-site edits. This phase does **not**
  touch any grant. If this migration lands in prod before the code deploys
  (or vice versa, briefly), the worst case is a few seconds of "function
  does not exist" (migration-lags-code) or the *old* direct-write code
  path continuing to work exactly as it does today (code-lags-migration —
  genuinely harmless, since nothing is revoked yet). Once deployed, verify
  each of the 6 flows live (cancel a real confirmed free booking, leave a
  real waitlist, promote a free-event waitlist spot, mark/unmark a
  no-show, and — harder to verify live without a real abandoned Stripe
  session — code-review the two rollback-reuse sites carefully, since
  their behaviour is hard to click-test on demand).
- **Phase 2 (fast-follow, only once Phase 1 is confirmed live):** the
  REVOKE migration (§5). By this point every legitimate writer has already
  moved off the user-scoped client, so there is **no** live functionality
  depending on the old grants — the REVOKE is now a pure, low-risk
  hardening step with nothing left to break. This is the safer order
  precisely because (unlike the `is_admin_hold` case) nothing in the
  post-Phase-1 codebase writes these three columns via the user-scoped
  client anymore, so there's no "partial fix still needs the old grant"
  trap to avoid by bundling.

If the planner prefers to match the `is_admin_hold` precedent exactly
(single bundled PR, both migrations landing together) for consistency /
fewer deploy events, that is also defensible — the risk is marginally
higher (a mis-timed `supabase db push` relative to the Vercel deploy would
briefly break more surface area than Phase 1 alone would) but not
unreasonable for a demo-stage project with low concurrent traffic. I'd
flag this as the one open sequencing decision for the planner rather than
picking unilaterally, since it trades off "fewer PRs" against "smaller
blast radius per deploy."

Either way: per the pre-existing operational gap already known in this
codebase (CI only applies migrations to local Supabase; every migration
PR needs a separate **manual** `supabase db push --include-all --linked`
after merge — see project memory "Migrations need manual `supabase db push`
to prod"), whoever merges must run that command **immediately** after
merge, not "at some point later," to minimize the window where Vercel's
already-deployed new code is calling RPCs the linked database doesn't have
yet.

---

## 7. Risk assessment / blast radius

### 7.1 What is explicitly OUT of scope (flagged, not fixed here)

- `stripe_checkout_session_id` is still writable directly by the
  user-scoped client from 2 sites (`createPaidCheckout`, `claimWaitlistSpot`
  session-id persistence) and 1 service_role site (`resume-checkout.ts`).
  A member could tamper with their own row's `stripe_checkout_session_id`
  via direct PATCH — worst case, this corrupts *their own* checkout-session
  bookkeeping (used for `bestEffortExpireSession` and audit) but does not
  let them forge a confirmed/paid state (the webhook's `status='confirmed'`
  write is keyed off `metadata.booking_id` from Stripe's own session
  object, not off this column, and the webhook is service_role). Not
  requested in scope; flagged for a future pass if the team wants full
  column-level lockdown on `bookings`.
- `cancelled_at`, `refunded_amount_pence`, `refunded_at`, `stripe_refund_id`,
  `cancellation_reason`, `booking_fee_pence` remain writable by
  `authenticated` at the grant layer. After §3.2's fix, **no** user-scoped
  code path writes any of these directly any more (the new
  `cancel_confirmed_booking` RPC absorbs all of `cancelBooking`'s writes;
  `deleteMyAccount` already used service_role). This means a *further*
  REVOKE on these columns would now be free (zero code changes needed,
  same as `price_at_booking` in this pass) — worth a dedicated follow-up
  hardening PR, but out of scope for this task's explicit three-column
  brief and I'm not bundling it in to keep this PR's diff reviewable.
- The `search_path = public` (not `public, pg_catalog`) posture matches
  today's `abandon_pending_checkout` precedent per this task's explicit
  instruction, not the stricter posture used by
  `admin_promote_waitlist_to_hold`/`reap_stale_pending_bookings`. This is a
  deliberate, already-flagged, pre-existing inconsistency across the RPC
  family (see project memory "SECURITY DEFINER search_path hardening") —
  not something to fix opportunistically here.
- `promoteFromWaitlist`'s free branch has never had a "can't promote onto a
  past event" guard (unlike its paid-branch sibling); preserved as-is (§3.4).

### 7.2 What could break, and what needs careful testing

This touches **6 live, self-service, revenue-adjacent flows**:
cancel-a-booking (with real Stripe refunds), leave-waitlist, the two
Stripe-checkout abandonment/rollback paths, admin free-event waitlist
promotion, and admin no-show toggling. All 6 currently have test coverage
(`cancel-booking-races.test.ts`, `actions.test.ts` in `events/[slug]`,
`actions-promote-waitlist-paid.test.ts`, `actions.test.ts` /
`actions-moderation.test.ts` in `admin`) that mocks `.update()` chains —
every one of those mocks needs to change to mock `.rpc()` calls instead,
which is a **behavioural assertion change**, not just a mechanical rename;
the reviewer/tester should verify each test still asserts the same
user-visible outcomes (error messages, `ActionResult` shapes) via the new
RPC-call mocking rather than accidentally weakening coverage.

Specific things that need live (or close-to-live, staging) verification
before/after each phase:
1. A real `cancelBooking` on a paid, refund-eligible booking still issues
   exactly one Stripe refund and the DB reflects it — the RPC's `FOR UPDATE`
   lock changes the concurrency behaviour slightly (tighter) vs. today's
   optimistic `.eq('status','confirmed')` guard; should be strictly safer,
   but the "refund succeeded, DB update failed" reconciliation path
   (Sentry-tagged `refund-reconcile`) must still fire correctly if the RPC
   call itself errors after a successful Stripe refund.
2. `leaveWaitlist` on an event with multiple other waitlisted members —
   confirm positions recompute identically to today (now inside the same
   transaction instead of a follow-up call).
3. The `createPaidCheckout`/`claimWaitlistSpot` → `abandon_pending_checkout`
   reuse is the hardest to test on demand (requires actually starting then
   abandoning a real Stripe Checkout session, or reaching the catch block
   via a forced Stripe API failure in a test double) — recommend explicit
   unit tests that stub `createBookingCheckoutSession` to throw and assert
   the RPC is called with the right args, rather than relying on manual
   click-testing alone.
4. `promoteFromWaitlist` free-branch capacity edge case (event exactly at
   capacity) and `setNoShow` toggling both directions.

### 7.3 File count / batch-size guidance (CLAUDE.md: max 15 files/batch)

**Phase 1** (recommended first PR): 2 new migration files would collapse to
roughly:
- 1 migration file (4 new RPCs)
- 2 source files (`src/app/events/[slug]/actions.ts`,
  `src/app/(admin)/admin/actions.ts`)
- ~4-6 test files updated (`cancel-booking-races.test.ts`, `actions.test.ts`
  under `events/[slug]/__tests__`, `actions-promote-waitlist-paid.test.ts`,
  `actions.test.ts`/`actions-moderation.test.ts` under `admin/__tests__`)
- 1 new migration-content test file (`migration-bookings-status-transition-rpcs.test.ts`,
  following the existing `migration-abandon-pending-checkout-rpc.test.ts`
  pattern)

≈ 8-10 files. Comfortably under the 15-file cap.

**Phase 2** (fast-follow PR): 1 migration file (the REVOKE) + 1 new
migration-content test file + this spec doc's own follow-up note. ≈ 2-3
files.

If the planner instead chooses the bundled single-PR approach (§6), total
is ≈ 10-13 files — still under the cap but with zero margin for anything
else in that batch, and I'd recommend against adding any unrelated change
to that PR.

---

## HANDOVER-READY SUMMARY

- **New RPCs to create:** 4 (`cancel_confirmed_booking`, `leave_waitlist`,
  `admin_promote_waitlist_to_confirmed`, `set_booking_no_show`), all
  `SECURITY DEFINER`, `SET search_path = public`, following the
  `book_event_paid`/`abandon_pending_checkout` error-shape convention
  (`jsonb_build_object('error', ...)`).
- **Existing RPC reused (not modified):** `abandon_pending_checkout`, for 2
  additional call sites (`createPaidCheckout` and `claimWaitlistSpot`
  Stripe-failure rollbacks).
- **Migrations:** 2 new files — one creates the 4 RPCs, one does the
  REVOKE (`UPDATE (status, price_at_booking, waitlist_position)` +
  `INSERT`, both `FROM authenticated, anon`). Recommend shipping as 2
  sequential PRs (Phase 1 = RPCs + code switch, Phase 2 = REVOKE
  fast-follow) rather than bundled — see §6 for the reasoning and the
  explicit alternative if the planner prefers to match the `is_admin_hold`
  precedent's bundled approach instead.
- **Source files needing edits:** 2 —
  `src/app/events/[slug]/actions.ts` (4 call sites: `createPaidCheckout`,
  `claimWaitlistSpot`, `cancelBooking`, `leaveWaitlist`) and
  `src/app/(admin)/admin/actions.ts` (2 call sites: `promoteFromWaitlist`
  free branch, `setNoShow`).
- **`price_at_booking` needs zero code changes** — its only writer
  anywhere is the Stripe webhook via `service_role`.
- **Total estimated files touched:** ~10-13 across both phases (spec +
  2 migrations + 2 source files + ~6-8 test files). Under the 15-file/batch
  cap either way; comfortably so if split into the two recommended phases.
