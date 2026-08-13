-- Migration: bookings_status_transition_rpcs
--
-- Phase 1 of docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md.
-- Closes a pre-existing vulnerability (present since `bookings` was
-- created in 20260402000006): no migration has ever REVOKEd column-level
-- INSERT/UPDATE on `status`, `price_at_booking`, or `waitlist_position`
-- for `authenticated`/`anon`, so a member's own session token can PATCH
-- `bookings?id=eq.<own-booking-id>` with `{"status":"confirmed"}` (or
-- POST a brand-new confirmed row for any event) directly via the
-- Supabase REST API, bypassing every RPC's business logic — see the
-- design doc §1 for the full exploit writeup.
--
-- This migration creates 4 new SECURITY DEFINER RPCs so every remaining
-- user-scoped-client direct write to `bookings.status` moves off the
-- table grant and onto an RPC that validates ownership/role, capacity,
-- and state-machine transitions server-side before writing. It does
-- **not** revoke any grant — see design doc §6 for why the REVOKE is a
-- deliberately separate, sequential fast-follow PR (Phase 2), not
-- bundled here. Landing this migration alone is non-breaking in either
-- deploy order: if it lands before the paired `actions.ts` changes, the
-- new functions simply sit unused; if the code lands first, callers get
-- a transient "function does not exist" until this migration catches up.
--
-- ── The 4 functions ───────────────────────────────────────────────────────
--   1. cancel_confirmed_booking  — replaces cancelBooking's final UPDATE
--      (src/app/events/[slug]/actions.ts). Everything before the write
--      (ownership check, event fetch, refund-window math, the Stripe
--      refund call itself) stays in TS; only the last atomic write moves
--      server-side, matching createPaidCheckout's own existing shape of
--      "TS orchestrates I/O, RPC does the atomic write."
--   2. leave_waitlist  — replaces leaveWaitlist's two-step
--      UPDATE-then-separately-call-recompute_waitlist_positions with one
--      atomic RPC. Strict improvement: closes the pre-existing gap where
--      a leave could succeed and the recompute call could independently
--      fail, leaving stale positions.
--   3. admin_promote_waitlist_to_confirmed  — replaces promoteFromWaitlist's
--      free-event branch. Mirrors admin_promote_waitlist_to_hold
--      (20260713000002) almost exactly: same admin-role gate, same
--      row-lock-booking-then-lock-event shape, same widened capacity
--      predicate (`IN ('confirmed','pending_payment')`). Differs by
--      transitioning straight to `confirmed` (free event, no Stripe
--      hold) and defensively rejecting paid events (mirror image of the
--      hold RPC's own "free events should be confirmed directly" guard),
--      so this function can never accidentally give away a paid seat for
--      free.
--   4. set_booking_no_show  — replaces setNoShow's final UPDATE. Admin-
--      gated, past-event-only, and re-validates the source status inside
--      the lock (belt-and-braces alongside the existing TS pre-check,
--      which stays in place unchanged for its snappier, identically-
--      worded error messages in the common case).
--
-- `createPaidCheckout`'s and `claimWaitlistSpot`'s Stripe-failure
-- rollback sites are converted in this same PR too, but need NO new SQL
-- here — per design doc §3.1 they're semantically identical to what the
-- already-shipped `abandon_pending_checkout` RPC
-- (20260812180000_abandon_pending_checkout_rpc.sql) already does, so
-- those two call sites are simply repointed at that existing function in
-- `actions.ts`.
--
-- `price_at_booking` needs zero code changes in this phase — the design
-- doc's exhaustive grep (§2) found its only writer anywhere is the
-- Stripe webhook via service_role. It remains a REVOKE-only target for
-- Phase 2.
--
-- ── search_path posture ───────────────────────────────────────────────────
-- `SET search_path = public` (not the stricter `public, pg_catalog`) —
-- matches today's `abandon_pending_checkout` precedent per this task's
-- explicit brief. This is a deliberate, already-flagged, pre-existing
-- inconsistency across the RPC family (project memory: "SECURITY
-- DEFINER search_path hardening") — not fixed opportunistically here.
--
-- ── Error-shape convention ────────────────────────────────────────────────
-- Returns `jsonb_build_object('error', ...)` on failure, matching the
-- book_event/book_event_paid/claim_waitlist_spot/abandon_pending_checkout/
-- admin_promote_waitlist_to_hold family — not `RAISE EXCEPTION`.
--
-- ── Idempotency ───────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION for all four — safe to re-run. REVOKE/GRANT
-- are idempotent at the catalog level.
--
-- ── Post-merge ─────────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked
-- Verify:
--   SELECT proname FROM pg_proc WHERE proname IN (
--     'cancel_confirmed_booking', 'leave_waitlist',
--     'admin_promote_waitlist_to_confirmed', 'set_booking_no_show'
--   );

-- ────────────────────────────────────────────────────────────────────────
-- 1. cancel_confirmed_booking(uuid, uuid, integer, text)
-- ────────────────────────────────────────────────────────────────────────

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

  -- Lock the caller's own row. Keyed on booking_id (not event_id) because
  -- the TS caller (cancelBooking) already has it and its public contract
  -- takes a bookingId, not an eventId.
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

-- ────────────────────────────────────────────────────────────────────────
-- 2. leave_waitlist(uuid, uuid)
-- ────────────────────────────────────────────────────────────────────────

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

-- ────────────────────────────────────────────────────────────────────────
-- 3. admin_promote_waitlist_to_confirmed(uuid)
-- ────────────────────────────────────────────────────────────────────────

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

  -- NOTE: intentionally no `v_event_date < now()` past-event guard here —
  -- the free branch of promoteFromWaitlist never had one prior to this
  -- migration (unlike admin_promote_waitlist_to_hold's paid branch).
  -- Preserved as-is to avoid an unreviewed behavioural change riding on
  -- a security fix; flagged in the design doc §3.4 as a possible
  -- separate gap for a future PR.

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

-- ────────────────────────────────────────────────────────────────────────
-- 4. set_booking_no_show(uuid, boolean)
-- ────────────────────────────────────────────────────────────────────────

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
