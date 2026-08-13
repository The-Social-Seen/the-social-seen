-- Migration: abandon_pending_checkout_rpc
--
-- Replaces the direct TS SELECT-then-UPDATE in abandonPendingCheckout
-- (src/app/events/[slug]/actions.ts) with a SECURITY DEFINER RPC,
-- bringing this function in line with every other booking-state-
-- transition in this codebase (book_event, book_event_paid,
-- claim_waitlist_spot, admin_promote_waitlist_to_hold,
-- admin_hold_confirmed_booking_for_payment,
-- admin_reinstate_cancelled_booking_for_payment,
-- admin_revert_hold_to_waitlist).
--
-- ── Why this migration exists ───────────────────────────────────────────
-- 1. Race condition (secondary, non-blocking finding from the
--    abandonPendingCheckout code review): the TS implementation did a
--    SELECT then a separate UPDATE via the user-scoped client — two
--    round trips, no row lock between them. `FOR UPDATE` here closes
--    that gap by doing the read, the branch, and the write inside one
--    transaction under a row lock.
-- 2. Blocking conflict with
--    20260812171530_revoke_bookings_admin_hold_column_write.sql: that
--    migration revokes UPDATE on (is_admin_hold, admin_hold_expires_at)
--    from `authenticated`/`anon` to close a direct-PATCH tampering
--    vector. abandonPendingCheckout's own UPDATE unconditionally
--    includes both columns in its SET clause on every call (to clear an
--    admin hold as part of cleanup), so once that REVOKE lands the
--    self-service abandon flow breaks for 100% of callers, not just the
--    admin-hold ones. A SECURITY DEFINER function executes as its owner
--    and is immune to that REVOKE, so moving the whole
--    lookup+branch+write inside one resolves both problems at once.
--
-- ── Branch logic ─────────────────────────────────────────────────────────
-- See docs/SYSTEM-DESIGN-abandon-checkout-rpc.md §2.1 for the full
-- derivation table — ported 1:1 from the pre-existing TS security
-- comment. Nothing about the derivation changes; only WHERE it runs
-- (SQL instead of TS) and WHEN the read + write happen (one locked
-- transaction instead of two round trips).
--
-- ── search_path posture ───────────────────────────────────────────────
-- SET search_path = public — matches book_event / book_event_paid /
-- claim_waitlist_spot / the admin-hold RPC family. The stricter
-- `public, pg_catalog` posture used by reap_stale_pending_bookings is a
-- separate hardening PR; mixing it into this fix would conflate
-- hardening with the bug fix — same reasoning documented in
-- 20260517000002_book_event_paid_with_fee.sql.
--
-- ── Relationship to 20260812171530_revoke_bookings_admin_hold_column_write.sql ──
-- That migration's REVOKE needs NO changes and must ship in the SAME PR
-- / same `supabase db push --include-all --linked` run as this one —
-- see docs/SYSTEM-DESIGN-abandon-checkout-rpc.md §7. Neither migration
-- alone is safe to deploy to prod without the other once the
-- accompanying actions.ts change also lands.
--
-- ── Idempotency ──────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION — safe to re-run. REVOKE/GRANT are
-- idempotent at the catalog level.
--
-- ── Post-merge ───────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked

CREATE OR REPLACE FUNCTION public.abandon_pending_checkout(
  p_user_id  uuid,
  p_event_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_booking_id       uuid;
  v_is_admin_hold    boolean;
  v_cancelled_at     timestamptz;
  v_waitlist_pos     integer;
  v_rollback_status  booking_status;
BEGIN
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
  END IF;

  -- Lock the caller's own pending_payment row for this event (if any).
  -- idx_bookings_active (partial unique on (user_id, event_id) WHERE
  -- status != 'cancelled') guarantees at most one non-cancelled row per
  -- (user_id, event_id), so this can never match more than one row.
  SELECT id, is_admin_hold, cancelled_at, waitlist_position
  INTO   v_booking_id, v_is_admin_hold, v_cancelled_at, v_waitlist_pos
  FROM   public.bookings
  WHERE  user_id  = p_user_id
    AND  event_id = p_event_id
    AND  status   = 'pending_payment'
    AND  deleted_at IS NULL
  FOR UPDATE;

  -- Nothing to do — already resolved (paid via webhook, already
  -- abandoned by a prior call, or never existed). Idempotent no-op,
  -- matches the pre-existing TS behaviour of returning success with no
  -- status.
  IF v_booking_id IS NULL THEN
    RETURN jsonb_build_object('booking_id', NULL, 'status', NULL);
  END IF;

  IF v_is_admin_hold THEN
    IF v_cancelled_at IS NOT NULL THEN
      v_rollback_status := 'cancelled';   -- admin_reinstate (Gap C)
    ELSIF v_waitlist_pos IS NOT NULL THEN
      v_rollback_status := 'waitlisted';  -- admin_hold (waitlist promo)
    ELSE
      v_rollback_status := 'confirmed';   -- admin_remediation (Gap A)
    END IF;
  ELSIF v_waitlist_pos IS NOT NULL THEN
    v_rollback_status := 'waitlisted';    -- self-service claim
  ELSE
    v_rollback_status := 'cancelled';     -- fresh self-service book (safe default)
  END IF;

  -- cancelled_at: set only on the freshly-cancelled branch, and only if
  -- not already set (admin_reinstate rows already carry a historical
  -- cancelled_at that must be preserved, not overwritten with now() —
  -- see admin_release_reinstated_hold_to_cancelled's own convention in
  -- 20260808000003_admin_reinstate_cancelled_booking_rpcs.sql).
  UPDATE public.bookings
  SET    status                = v_rollback_status,
         is_admin_hold         = false,
         admin_hold_expires_at = NULL,
         cancelled_at          = CASE
           WHEN v_rollback_status = 'cancelled' AND cancelled_at IS NULL
             THEN now()
           ELSE cancelled_at
         END
  WHERE  id     = v_booking_id
    AND  status = 'pending_payment';

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'status',     v_rollback_status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.abandon_pending_checkout(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.abandon_pending_checkout(uuid, uuid) TO authenticated;
