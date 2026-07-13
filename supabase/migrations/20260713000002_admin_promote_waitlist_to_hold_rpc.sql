-- Migration: admin_promote_waitlist_to_hold_rpc
--
-- Fixes the production incident where `promoteFromWaitlist`
-- (src/app/(admin)/admin/actions.ts) confirmed a waitlisted booking on a
-- PAID event with zero payment collection (Amy Sangam / Yasemin Salp,
-- 2026-07-13). See SYSTEM-DESIGN-admin-waitlist-promotion-payment.md for
-- the full design; this migration ships §3.1 + §6.5 together, as the
-- spec's §8.1 "urgent slice" requires both in one file.
--
-- Two things in this migration:
--
--   1. `public.admin_promote_waitlist_to_hold(p_booking_id, p_booking_fee_pence,
--      p_hold_expires_at)` — a NEW function. Admin-gated analogue of
--      `claim_waitlist_spot` (same shape: lock booking, lock event,
--      validate, capacity-check, transition) but with an admin-role
--      check instead of an owner check, and it writes the new
--      `is_admin_hold` / `admin_hold_expires_at` columns
--      (20260713000001) instead of nothing. Transitions
--      waitlisted → pending_payment on a PAID event only — the calling
--      Server Action (`promoteFromWaitlist`) branches free-vs-paid
--      *before* ever calling this, and this function defensively
--      rejects free events too (mirrors book_event_paid's own
--      "use book_event for free events" guard).
--
--   2. `CREATE OR REPLACE public.reap_stale_pending_bookings()` — adds
--      ONE line to the existing WHERE clause: `AND is_admin_hold = false`.
--      Without this, the reaper (20260515095343, every 15 min via
--      pg_cron) would cancel an admin-created hold 35 minutes after
--      promotion — WORSE than the bug being fixed, because the member
--      would be silently kicked off the waitlist entirely with no
--      admin notification. This is why this "urgent" fix can't ship
--      with literally zero migration, despite the original brief's
--      premise — see spec §1 for the full reasoning the architect
--      worked through (three rejected zero-migration alternatives:
--      pausing the reaper cron platform-wide, hardcoding booking IDs
--      into its WHERE clause, and a hand-created Stripe Payment Link
--      that can't carry metadata.booking_id for webhook reconciliation).
--      Every existing row has is_admin_hold=false by column default, so
--      this is a pure no-op for every booking not touched by this
--      feature.
--
-- ── search_path posture (admin_promote_waitlist_to_hold) ────────────────────
-- `SET search_path = public, pg_catalog` — the stricter form used by the
-- reaper (20260515095343), NOT the bare `public` used by
-- book_event_paid/claim_waitlist_spot/admin_get_user_phones. This
-- function has no existing sibling family pulling it toward the older,
-- looser convention (it's brand new), so it follows the newer, stricter
-- precedent. Not a retrofit of anything pre-existing — see project
-- memory "SECURITY DEFINER search_path hardening" for the retrofit that
-- is still outstanding for the OTHER RPCs.
--
-- ── Error-shape convention ────────────────────────────────────────────────
-- Returns `jsonb_build_object('error', ...)`, matching the
-- book_event/book_event_paid/claim_waitlist_spot family (all
-- transition-RPCs called from Server Actions that unwrap `result.error`)
-- — not `RAISE EXCEPTION`, which is the convention used by the PII-read
-- helpers (admin_get_user_phones etc.) that are invoked differently.
--
-- ── Why this RPC is called via the user-scoped client, not service_role ────
-- `auth.uid()` only resolves when the call carries the caller's own JWT.
-- `createAdminBookingHold` (src/lib/bookings/admin-hold.ts) calls this
-- RPC via the `requireAdmin()`-obtained user-scoped client — calling it
-- via `createAdminClient()` (service_role) would make `auth.uid()` NULL
-- inside the function body and the admin-role check would always fail.
-- Same client-selection discipline already established for admin PII
-- reads (project memory: requireAdmin = user-scoped, not service_role).
--
-- ── Capacity-check fix bundled into this RPC ─────────────────────────────
-- The OLD `promoteFromWaitlist` counted `status = 'confirmed'` ONLY when
-- checking capacity — the root cause of the zero-payment bug (an admin
-- could promote past capacity because pending_payment seats already in
-- flight weren't counted). This RPC's capacity check counts
-- `IN ('confirmed', 'pending_payment')`, fixing the predicate AND
-- closing the TOCTOU race the old TS-side check-then-update had (two
-- admins promoting for the same last paid spot simultaneously) by doing
-- the check inside the same row-locked transaction as the transition.
--
-- ── Idempotency ───────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION for both functions — safe to re-run.
-- REVOKE / GRANT are idempotent at the catalog level.
--
-- ── Rollback ──────────────────────────────────────────────────────────────
-- `DROP FUNCTION IF EXISTS public.admin_promote_waitlist_to_hold(uuid, integer, timestamptz);`
-- then re-apply 20260515095343's original reap_stale_pending_bookings()
-- body (without the added predicate) via a follow-up migration if a
-- full revert is ever needed. Not destructive either direction — no
-- data loss, only future behaviour changes.
--
-- ── Post-merge ────────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked
-- Verify:
--   SELECT proname FROM pg_proc WHERE proname = 'admin_promote_waitlist_to_hold';
--   SELECT prosrc FROM pg_proc WHERE proname = 'reap_stale_pending_bookings';
--     -- confirm the returned body contains `is_admin_hold`

-- ────────────────────────────────────────────────────────────────────────
-- 1. admin_promote_waitlist_to_hold(uuid, integer, timestamptz)
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_promote_waitlist_to_hold(
  p_booking_id        uuid,
  p_booking_fee_pence integer,
  p_hold_expires_at   timestamptz   -- NULL = no auto-revert
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
  -- Admin gate — mirrors the RLS admin-check pattern (profiles.role =
  -- 'admin'), NOT an owner check (p_user_id != auth.uid()) like the
  -- member-facing RPCs, because the caller here is an admin acting on
  -- behalf of the booking's owner. Matches admin_get_user_phones'
  -- in-body gate style (20260602000001).
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  IF p_booking_fee_pence < 0 THEN
    RETURN jsonb_build_object('error', 'Invalid booking fee');
  END IF;

  -- Lock the booking row — serialises a double-click on "Promote".
  SELECT event_id, user_id, status
  INTO   v_event_id, v_user_id, v_current_status
  FROM   public.bookings
  WHERE  id = p_booking_id
    AND  deleted_at IS NULL
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

  -- Lock the event row — same rationale as claim_waitlist_spot: serialise
  -- concurrent promotions/claims against the same event's capacity.
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

  IF v_event_date < now() THEN
    RETURN jsonb_build_object('error', 'Event has already passed');
  END IF;

  -- Sanity: this RPC is only for paid events. The Server Action must
  -- branch to a direct confirm for free events without ever calling
  -- this — same invariant book_event_paid enforces for its own callers.
  IF v_price = 0 THEN
    RETURN jsonb_build_object('error', 'Free events should be confirmed directly, not held');
  END IF;

  -- Capacity check — seats are taken by confirmed OR pending_payment.
  -- This is the fix for the bug: the OLD promoteFromWaitlist counted
  -- 'confirmed' only. Moving the check inside this locked RPC fixes the
  -- wrong predicate AND closes the TOCTOU race the old TS-side
  -- check-then-update had (two admins promoting for the same last paid
  -- spot simultaneously).
  IF v_capacity IS NOT NULL THEN
    SELECT COUNT(*)
    INTO   v_seat_count
    FROM   public.bookings
    WHERE  event_id = v_event_id
      AND  status   IN ('confirmed', 'pending_payment')
      AND  deleted_at IS NULL;

    IF v_seat_count >= v_capacity THEN
      RETURN jsonb_build_object('error', 'Event is at full capacity — cannot promote');
    END IF;
  END IF;

  -- Transition. waitlist_position is deliberately left untouched — if
  -- this hold later fails (Stripe error) or expires unpaid, the position
  -- is already sitting on the row ready to be restored with no
  -- re-derivation needed. Mirrors claim_waitlist_spot's rationale
  -- exactly (20260517000002 header comment).
  UPDATE public.bookings
  SET    status                 = 'pending_payment',
         booking_fee_pence      = p_booking_fee_pence,
         is_admin_hold          = true,
         admin_hold_expires_at  = p_hold_expires_at
  WHERE  id     = p_booking_id
    AND  status = 'waitlisted';

  RETURN jsonb_build_object(
    'booking_id', p_booking_id,
    'user_id',    v_user_id,
    'status',     'pending_payment'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION public.admin_promote_waitlist_to_hold(uuid, integer, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_promote_waitlist_to_hold(uuid, integer, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 2. reap_stale_pending_bookings() — one added predicate
-- ────────────────────────────────────────────────────────────────────────

-- Only change vs 20260515095343: adds `AND is_admin_hold = false`.
-- Every existing row has is_admin_hold=false by column default, so this
-- is a pure no-op for every booking not touched by this feature —
-- satisfies "the existing reaper's behavior for regular bookings must
-- not change." CREATE OR REPLACE preserves the function's existing
-- REVOKE/GRANT state, but both are restated below anyway for the same
-- defensive-idempotency reason the original migration did.
CREATE OR REPLACE FUNCTION public.reap_stale_pending_bookings()
RETURNS integer AS $$
DECLARE
  v_reaped integer;
BEGIN
  WITH reaped AS (
    UPDATE public.bookings
       SET status       = 'cancelled',
           cancelled_at = now()
     WHERE status              = 'pending_payment'
       AND stripe_payment_id   IS NULL
       AND deleted_at          IS NULL
       AND is_admin_hold       = false
       AND created_at          < now() - interval '35 minutes'
    RETURNING id
  )
  SELECT count(*) INTO v_reaped FROM reaped;

  RETURN v_reaped;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION public.reap_stale_pending_bookings() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reap_stale_pending_bookings() TO service_role;
