-- Migration: admin_reinstate_cancelled_booking_rpcs
--
-- "Gap C" in the admin waitlist-promotion / payment-remediation lineage.
-- See SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md for the full
-- design and reasoning (this migration ships §4.1, §4.2, §3.3 item 1
-- verbatim). Precedent: SYSTEM-DESIGN-admin-waitlist-promotion-payment.md
-- (base spec + Addendum, "Gap A" / "Gap B").
--
-- Urgent incident: four real bookings (Amaya Kaur, Senam Paya, Christian
-- I, Laura Florez Perez) were auto-cancelled by
-- `reap_stale_pending_bookings()` before their payment window could be
-- extended. The paid event they were booked on now has room again (freed
-- by exactly these four cancellations). This migration gives admins a
-- gated tool to reinstate an eligible cancelled booking and send a fresh
-- payment link, with full eligibility + capacity re-validation.
--
-- ── Zero new columns. Zero new enum values. Zero RLS policy changes. ────────
-- Reuses `is_admin_hold` / `admin_hold_expires_at` from 20260713000001 and
-- the existing `cancelled_at` / `cancellation_reason` / `stripe_payment_id`
-- / `refunded_amount_pence` columns. This migration only adds two new
-- functions and hardens one existing one via CREATE OR REPLACE.
--
-- Also reuses the existing `public.profiles.status` column (`user_status`
-- enum: 'active' | 'suspended' | 'banned', added in migration
-- 20260420000001_add_profile_registration_fields.sql, first enforced for
-- booking RPCs in 20260423000001_booking_rpcs_require_active_status.sql).
-- §1.5 of the design doc flagged blocking reinstatement for a suspended/
-- banned member as a "recommended, developer to confirm" judgment call
-- rather than baking it in silently — that confirmation has since happened,
-- so `admin_reinstate_cancelled_booking_for_payment` now rejects any
-- owning profile with `status != 'active'` alongside the existing
-- soft-delete check. Still zero new columns — the guard is a plain
-- `SELECT ... status` + `IF` added inside the existing function body.
--
--   1. `public.admin_reinstate_cancelled_booking_for_payment(p_booking_id,
--      p_booking_fee_pence, p_hold_expires_at)` — transitions an eligible
--      `cancelled` row (§1.5 of the design doc: reaped, never refunded,
--      never part of an event cancellation, owning profile not soft-
--      deleted, owning profile.status = 'active' (not suspended/banned —
--      §1.5's "recommended" call, now confirmed required: offering a fresh
--      payment link to a suspended/banned member is wrong), no other
--      active booking for this member+event) to
--      `pending_payment` + `is_admin_hold = true`. Unlike
--      `admin_hold_confirmed_booking_for_payment` (Gap A), this DOES
--      capacity-check under the event row's `FOR UPDATE` lock — the seat
--      was genuinely released back to the pool by the reap, so
--      reinstating it IS a new admission, exactly like
--      `admin_promote_waitlist_to_hold`. `cancelled_at` /
--      `cancellation_reason` are DELIBERATELY left untouched by the
--      transition — the preserved non-NULL `cancelled_at` on a
--      `pending_payment` row is what lets this origin be told apart from
--      the other two hold origins without a new column (design doc §3.2).
--
--   2. `public.admin_release_reinstated_hold_to_cancelled(p_booking_id)` —
--      the mandatory manual release path for this origin. Structurally
--      parallel to `admin_revert_hold_to_waitlist` (Gap B), but reverts to
--      `cancelled` (not `waitlisted` — this booking was never on the
--      waitlist this cycle) and requires `cancelled_at IS NOT NULL` as
--      part of its eligibility guard, so it can only ever touch a
--      reinstated-cancelled-origin hold.
--
--   3. `CREATE OR REPLACE FUNCTION public.admin_revert_hold_to_waitlist`
--      — the EXISTING Gap B function (originally shipped in
--      20260713000004, NOT modified there — that file is left untouched
--      per the "never modify an already-applied migration" rule). One
--      guard clause added: `AND cancelled_at IS NULL`, so it structurally
--      refuses to touch a reinstated-cancelled-origin row even if a
--      future UI bug ever routed a click to the wrong Server Action. This
--      is a no-op for the two existing origins (their `pending_payment`
--      holds never carry a `cancelled_at` — they transition from
--      `waitlisted`/`confirmed`, neither of which sets it). Full body
--      otherwise byte-identical to the shipped 20260713000004 version.
--      Together with #2's positive-mirror guard, the two release RPCs
--      become mutually exclusive by construction, not just by UI
--      convention (design doc §3.3).
--
-- ── search_path / error-shape / client-selection posture ────────────────────
-- All three functions follow the exact same conventions as their direct
-- siblings (admin_promote_waitlist_to_hold, admin_hold_confirmed_booking_
-- for_payment, admin_revert_hold_to_waitlist):
--   - `SET search_path = public, pg_catalog` (the stricter form).
--   - `RETURN jsonb_build_object('error', ...)` on failure, never
--     `RAISE EXCEPTION`.
--   - An in-body `profiles.role = 'admin'` gate keyed on `auth.uid()`,
--     which is why all three MUST be called via the `requireAdmin()`-
--     obtained user-scoped Supabase client from the TypeScript side,
--     never `service_role`.
--
-- ── Idempotency ───────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION for all three — safe to re-run. REVOKE /
-- GRANT are idempotent at the catalog level.
--
-- ── Safety / blast radius ────────────────────────────────────────────────
-- Two brand-new functions + one additive guard clause on an existing
-- function. No table rewrite, no data migration. The hardened guard is a
-- no-op for every row either existing origin has ever produced (verified
-- in the design doc §1.2 by exhaustively tracing every `status =
-- 'cancelled'` / `status: 'cancelled'` write site in the codebase).
--
-- ── Rollback ──────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.admin_reinstate_cancelled_booking_for_payment(uuid, integer, timestamptz);
--   DROP FUNCTION IF EXISTS public.admin_release_reinstated_hold_to_cancelled(uuid);
-- Then re-apply admin_revert_hold_to_waitlist's pre-hardening body from
-- 20260713000004 verbatim if the guard needs reverting too. Not
-- destructive either direction — no data loss, only future behaviour
-- changes. Any booking already reinstated before a rollback would be
-- stuck pending_payment/is_admin_hold=true with cancelled_at set and no
-- RPC left to release it cleanly to cancelled — same accepted residual-
-- state class the base spec already documents for its own rollback story.
--
-- ── Post-merge ────────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked
-- Verify:
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('admin_reinstate_cancelled_booking_for_payment', 'admin_release_reinstated_hold_to_cancelled');
-- And spot-check the hardened guard didn't regress the existing Gap A/B
-- release path (should still find/allow releasing any genuinely-existing
-- waitlist_promotion or payment_remediation hold — cancelled_at IS NULL
-- for those):
--   SELECT id, status, is_admin_hold, cancelled_at FROM public.bookings
--   WHERE is_admin_hold = true AND status = 'pending_payment';
--
-- ── Verification query for the four real bookings (design doc §1.6) ────────
-- Run this against production (read-only) once this migration is live, to
-- confirm Amaya/Senam/Christian/Laura's rows actually satisfy the
-- predicate before an admin clicks anything:
--
--   SELECT b.id, b.user_id, b.event_id, b.status, b.cancelled_at, b.cancellation_reason,
--          b.stripe_payment_id, b.refunded_amount_pence, b.is_admin_hold, b.price_at_booking,
--          p.deleted_at AS profile_deleted_at, p.status AS profile_status
--   FROM public.bookings b
--   JOIN public.profiles p ON p.id = b.user_id
--   WHERE b.status = 'cancelled'
--     AND b.cancelled_at IS NOT NULL
--     AND b.cancellation_reason IS NULL
--     AND b.stripe_payment_id IS NULL
--     AND b.is_admin_hold = false
--     AND b.deleted_at IS NULL
--   ORDER BY b.cancelled_at DESC
--   LIMIT 20;

-- ────────────────────────────────────────────────────────────────────────
-- 1. admin_reinstate_cancelled_booking_for_payment(uuid, integer, timestamptz)
--    — Gap C: reinstate an eligible reaped `cancelled` booking on a paid
--    event, transitioning it to `pending_payment` for a fresh payment link.
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_reinstate_cancelled_booking_for_payment(
  p_booking_id        uuid,
  p_booking_fee_pence integer,
  p_hold_expires_at   timestamptz   -- NULL = no auto-revert (see design doc §6)
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
  v_profile_status      user_status;
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

  -- Eligibility predicate — design doc §1.5. Each branch gets its own
  -- message so a refused reinstatement is diagnosable from the toast
  -- alone.
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

  -- No other active booking for this member+event (design doc §1.4 — the
  -- partial unique index on (user_id, event_id) WHERE status != 'cancelled'
  -- allows multiple cancelled rows to coexist, so a member could have
  -- re-booked through the normal flow after being reaped).
  SELECT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE event_id = v_event_id AND user_id = v_user_id
      AND id != p_booking_id AND status != 'cancelled' AND deleted_at IS NULL
  ) INTO v_other_active;
  IF v_other_active THEN
    RETURN jsonb_build_object('error', 'This member already has an active booking for this event');
  END IF;

  -- THE finding (design doc §1.3). Owning profile must not be soft-
  -- deleted — deleteMyAccount also cancels pending_payment rows leaving
  -- cancellation_reason NULL, indistinguishable from a reap by booking-row
  -- columns alone. Without this check, an admin could "reinstate" a
  -- booking for a member who deleted their account and scrubbed their
  -- email to a deleted-<uuid>@deleted.local placeholder.
  SELECT deleted_at, status INTO v_profile_deleted_at, v_profile_status
  FROM public.profiles WHERE id = v_user_id;
  IF v_profile_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'This member''s account has been deleted — cannot reinstate');
  END IF;

  -- Design doc §1.5 (recommended, now confirmed required). Offering a
  -- fresh payment link to a suspended/banned member is clearly wrong —
  -- block reinstatement for any non-'active' profiles.status (user_status
  -- enum: 'active' | 'suspended' | 'banned', added in migration
  -- 20260423000001_booking_rpcs_require_active_status.sql).
  IF v_profile_status != 'active' THEN
    RETURN jsonb_build_object('error', 'This member''s account is suspended or banned — cannot reinstate');
  END IF;

  -- Lock the event row — serialises concurrent reinstatements/promotions/
  -- bookings against this event's capacity (design doc §2).
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

  -- Capacity re-check (design doc §2) — this IS a new admission (mirrors
  -- admin_promote_waitlist_to_hold, unlike admin_hold_confirmed_booking_
  -- for_payment which deliberately skips it): the seat was genuinely
  -- released back to the pool the moment the reaper cancelled this row.
  IF v_capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO v_seat_count
    FROM public.bookings
    WHERE event_id = v_event_id AND status IN ('confirmed', 'pending_payment') AND deleted_at IS NULL;
    IF v_seat_count >= v_capacity THEN
      RETURN jsonb_build_object('error', 'Event is at full capacity — cannot reinstate');
    END IF;
  END IF;

  -- Transition. cancelled_at / cancellation_reason DELIBERATELY left
  -- untouched — see design doc §3.2/§3.3: the preserved non-NULL
  -- cancelled_at is what lets admin_release_reinstated_hold_to_cancelled
  -- (and admin_revert_hold_to_waitlist's own hardened guard, below) tell
  -- this origin apart from the other two without a new column.
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

-- ────────────────────────────────────────────────────────────────────────
-- 2. admin_release_reinstated_hold_to_cancelled(uuid) — Gap C's own
--    release RPC: manually release an active reinstatement hold back to
--    `cancelled` (NOT `waitlisted` — this booking was never on the
--    waitlist this cycle).
-- ────────────────────────────────────────────────────────────────────────

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
  -- `cancelled_at IS NULL` guard (below) — this RPC only ever touches a
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

-- ────────────────────────────────────────────────────────────────────────
-- 3. admin_revert_hold_to_waitlist(uuid) — EXISTING Gap B function
--    (originally shipped in 20260713000004, unmodified there). Hardened
--    here via CREATE OR REPLACE with exactly one added guard clause:
--    `AND cancelled_at IS NULL`, so it structurally refuses to touch a
--    Gap-C reinstatement hold. Full body otherwise byte-identical to the
--    shipped 20260713000004 version — same signature, same admin gate,
--    same origin-agnostic waitlist-revert destination for the two
--    existing origins.
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_revert_hold_to_waitlist(
  p_booking_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_is_admin     boolean;
  v_event_id     uuid;
  v_status       booking_status;
  v_is_hold      boolean;
  v_cancelled_at timestamptz;
  v_new_position integer;
BEGIN
  -- Admin gate — identical pattern to the other admin_* RPCs in this family.
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  -- Lock the booking row. cancelled_at now also selected — needed for the
  -- new guard clause below (Gap C hardening).
  SELECT event_id, status, is_admin_hold, cancelled_at
  INTO   v_event_id, v_status, v_is_hold, v_cancelled_at
  FROM   public.bookings
  WHERE  id = p_booking_id
    AND  deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Booking not found');
  END IF;

  -- Origin-agnostic across the two ORIGINAL hold origins (waitlist
  -- promotion, payment remediation) — see Addendum §B.1. This RPC
  -- doesn't need to know or care which of THOSE two produced the row.
  --
  -- The added `cancelled_at IS NULL` clause is Gap C's defensive
  -- hardening (SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md §3.3
  -- item 1): a reinstated-cancelled-origin hold (Gap C) DOES carry a
  -- non-NULL cancelled_at (deliberately preserved by
  -- admin_reinstate_cancelled_booking_for_payment — its own honest
  -- "give up" destination is `cancelled`, not `waitlisted`), so this
  -- function must structurally refuse to touch it even if a future UI
  -- bug ever routed a click to the wrong Server Action. This is a no-op
  -- for the two original origins: neither
  -- admin_promote_waitlist_to_hold nor
  -- admin_hold_confirmed_booking_for_payment ever sets cancelled_at when
  -- transitioning a row to pending_payment (they transition FROM
  -- 'waitlisted'/'confirmed', neither of which carries one).
  IF NOT v_is_hold OR v_status != 'pending_payment' OR v_cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'error',
      'This booking is not an active payment hold — it may have already been paid, cancelled, or reverted.'
    );
  END IF;

  -- Always reverts to 'waitlisted' — never 'confirmed', even for a hold
  -- that originated from admin_hold_confirmed_booking_for_payment (Gap
  -- A). Reverting a remediated hold to an unpaid 'confirmed' would
  -- silently recreate the exact incident this whole feature exists to
  -- fix. 'waitlisted' is the only sane exit for either of the TWO
  -- ORIGINAL hold origins. See Addendum §B.1. (Gap C's own honest exit,
  -- 'cancelled', is handled by the new sibling function
  -- admin_release_reinstated_hold_to_cancelled above, not here.)
  UPDATE public.bookings
  SET    status                 = 'waitlisted',
         is_admin_hold          = false,
         admin_hold_expires_at  = NULL
  WHERE  id                     = p_booking_id
    AND  status                 = 'pending_payment'
    AND  is_admin_hold          = true;

  -- Recompute waitlist numbering for the affected event — this
  -- booking's frozen waitlist_position can now collide with positions
  -- reassigned while it was held. Identical reasoning to
  -- revert_expired_admin_holds() (base spec §2.3, §6.3) — deliberately
  -- NOT calling that (still-unbuilt) function; see Addendum §B.6.
  PERFORM public.recompute_waitlist_positions(v_event_id);

  SELECT waitlist_position INTO v_new_position
  FROM   public.bookings
  WHERE  id = p_booking_id;

  RETURN jsonb_build_object(
    'booking_id',         p_booking_id,
    'event_id',           v_event_id,
    'status',             'waitlisted',
    'waitlist_position',  v_new_position
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION public.admin_revert_hold_to_waitlist(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_revert_hold_to_waitlist(uuid) TO authenticated;
