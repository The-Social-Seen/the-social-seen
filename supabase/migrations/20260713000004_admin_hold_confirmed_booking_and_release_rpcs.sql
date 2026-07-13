-- Migration: admin_hold_confirmed_booking_and_release_rpcs
--
-- Two new admin-gated RPCs, both discovered mid-incident — a same-day
-- addendum to the admin waitlist-promotion payment-hold feature shipped
-- in 20260713000001 (columns) and 20260713000002 (admin_promote_waitlist_
-- to_hold + reaper fix). See SYSTEM-DESIGN-admin-waitlist-promotion-
-- payment.md, "Addendum (2026-07-13, same day)" §A, §B, §D for the full
-- design and reasoning — this migration ships §A.2 + §B.3 verbatim.
--
-- ── Zero new columns. Zero new enum values. Zero RLS policy changes. ────────
-- Both gaps below are solved entirely with the `is_admin_hold` /
-- `admin_hold_expires_at` columns and their two CHECK constraints, already
-- shipped in 20260713000001. This migration only adds two new functions.
--
--   1. `public.admin_hold_confirmed_booking_for_payment(p_booking_id,
--      p_booking_fee_pence, p_hold_expires_at)` — Gap A. Two production
--      bookings (Amy Sangam, Yasemin Salp) ended up `status='confirmed'`
--      on a paid event with `stripe_payment_id IS NULL` — the exact bug
--      20260713000002 fixes going forward, except it already happened to
--      them BEFORE that fix existed. `admin_promote_waitlist_to_hold`
--      can't touch them — it hard-rejects anything not `status='waitlisted'`.
--      This RPC is the admin-gated remediation path instead: `confirmed`
--      (unpaid) → `pending_payment`. Same lock/validate/transition shape
--      as `admin_promote_waitlist_to_hold` (its direct sibling), but the
--      precondition is `status='confirmed' AND stripe_payment_id IS NULL`
--      instead of `status='waitlisted'`, and the capacity check is
--      deliberately SKIPPED — the booking already occupies its seat
--      today as 'confirmed', by this codebase's own accounting
--      (admin_promote_waitlist_to_hold's capacity query already counts
--      'confirmed' as an occupied seat); requiring a fresh capacity check
--      here would gate an action that admits no one new, and would
--      perversely block remediation on exactly the at-capacity events
--      most likely to need it. Full argument in Addendum §A.1. Also
--      carries a defensive `price_at_booking > 0` check the base RPC
--      family doesn't need — chk_bookings_free_no_booking_fee would
--      otherwise reject setting a nonzero booking_fee_pence on a
--      historically-anomalous row with price_at_booking <= 0; this turns
--      that into a clear, specific error instead of a raw 23514.
--
--   2. `public.admin_revert_hold_to_waitlist(p_booking_id)` — Gap B. No
--      admin action existed to manually release an active
--      `pending_payment` hold back to `waitlisted` if the member doesn't
--      pay — a stand-in for the still-deferred, still-NOT-being-built 4h
--      auto-revert cron (`revert_expired_admin_holds`, migration
--      `20260713000003`, which does NOT exist and is NOT created or
--      touched by this migration). Origin-agnostic by design: the
--      predicate is just `is_admin_hold=true AND status='pending_payment'`
--      — it doesn't need to know or care whether the hold came from
--      `admin_promote_waitlist_to_hold` or
--      `admin_hold_confirmed_booking_for_payment`. ALWAYS reverts to
--      `waitlisted`, never `confirmed` — reverting a Gap A remediation
--      hold to an unpaid `confirmed` would silently recreate the exact
--      incident this whole feature exists to fix; `waitlisted` is the
--      only safe exit for a hold of any origin. Recomputes waitlist
--      numbering for the affected event afterward (same reasoning as the
--      still-unbuilt revert_expired_admin_holds cron — base spec §2.3,
--      §6.3 — a reverted row's frozen waitlist_position can collide with
--      positions reassigned while it was held).
--
-- ── Numbering note ──────────────────────────────────────────────────────────
-- Deliberately `...000004`, skipping past `...000003` — that filename is
-- reserved for the still-deferred `revert_expired_admin_holds` cron
-- migration (base spec §6.6), which this task explicitly must not create
-- or touch. `000004` has no dependency on `000003` (both RPCs below are
-- fully independent of the cron — see Addendum §B.6 for the explicit
-- decision that the future cron and admin_revert_hold_to_waitlist stay
-- siblings, not a call-through relationship), so this ordering is safe
-- and leaves `000003` cleanly available for whoever eventually builds
-- that PR.
--
-- ── search_path / error-shape / client-selection posture ────────────────────
-- Both functions follow the exact same conventions as their direct
-- sibling `admin_promote_waitlist_to_hold` (20260713000002):
--   - `SET search_path = public, pg_catalog` (the stricter form).
--   - `RETURN jsonb_build_object('error', ...)` on failure, never
--     `RAISE EXCEPTION` — this is the booking-state-transition RPC
--     family (book_event, book_event_paid, claim_waitlist_spot,
--     admin_promote_waitlist_to_hold), called from Server Actions that
--     already unwrap `result.error` — not the PII-read helper family
--     (admin_get_user_phones etc.), which raises exceptions instead.
--   - An in-body `profiles.role = 'admin'` gate keyed on `auth.uid()`,
--     which is why both MUST be called via the `requireAdmin()`-obtained
--     user-scoped Supabase client from the TypeScript side, never
--     `service_role` — `auth.uid()` would be NULL under service_role and
--     the gate would always reject a genuine admin.
--
-- ── No new CHECK constraints needed ──────────────────────────────────────────
-- Both existing constraints from 20260713000001 already cover every
-- write these two functions make, as column-level invariants rather than
-- RPC-specific ones:
--   chk_bookings_admin_hold_requires_pending_payment — satisfied because
--     every UPDATE below sets is_admin_hold and status together in the
--     SAME statement, in both directions (hold-creation in Gap A,
--     release in Gap B).
--   chk_bookings_admin_hold_expiry_requires_flag — vacuously satisfied
--     whenever is_admin_hold=true (Gap A, regardless of whether
--     p_hold_expires_at is NULL) and trivially satisfied when
--     is_admin_hold=false (Gap B always clears admin_hold_expires_at to
--     NULL in the same statement it clears the flag).
--
-- ── Idempotency ───────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION for both — safe to re-run. REVOKE / GRANT
-- are idempotent at the catalog level.
--
-- ── Safety / blast radius ────────────────────────────────────────────────────
-- Purely additive: two new functions, nothing else. No table rewrite, no
-- data migration, no existing function body touched — in particular,
-- `admin_promote_waitlist_to_hold`'s own SQL (20260713000002) is NOT
-- modified by this migration.
--
-- ── Rollback ──────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.admin_hold_confirmed_booking_for_payment(uuid, integer, timestamptz);
--   DROP FUNCTION IF EXISTS public.admin_revert_hold_to_waitlist(uuid);
-- Not destructive either direction — no data loss, only future behaviour
-- changes. Any booking already transitioned via these functions before a
-- rollback would be stuck as pending_payment/is_admin_hold=true with no
-- RPC left to move it — same class of residual state the base spec
-- already accepts for its own rollback story (20260713000002 header).
--
-- ── Post-merge ────────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked
-- Verify:
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('admin_hold_confirmed_booking_for_payment', 'admin_revert_hold_to_waitlist');

-- ────────────────────────────────────────────────────────────────────────
-- 1. admin_hold_confirmed_booking_for_payment(uuid, integer, timestamptz)
--    — Gap A: remediate a CONFIRMED-but-unpaid booking on a paid event.
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_hold_confirmed_booking_for_payment(
  p_booking_id        uuid,
  p_booking_fee_pence integer,
  p_hold_expires_at   timestamptz   -- NULL = no auto-revert (same convention as admin_promote_waitlist_to_hold)
)
RETURNS jsonb AS $$
DECLARE
  v_is_admin          boolean;
  v_event_id          uuid;
  v_user_id           uuid;
  v_current_status    booking_status;
  v_stripe_payment_id text;
  v_price_at_booking  integer;
  v_price             integer;
  v_event_date        timestamptz;
  v_is_cancelled      boolean;
BEGIN
  -- Admin gate — identical pattern to admin_promote_waitlist_to_hold.
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

  -- Lock the booking row.
  SELECT event_id, user_id, status, stripe_payment_id, price_at_booking
  INTO   v_event_id, v_user_id, v_current_status, v_stripe_payment_id, v_price_at_booking
  FROM   public.bookings
  WHERE  id = p_booking_id
    AND  deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Booking not found');
  END IF;

  IF v_current_status != 'confirmed' THEN
    RETURN jsonb_build_object(
      'error',
      CASE
        WHEN v_current_status = 'waitlisted'      THEN 'This booking is still on the waitlist — use Promote instead'
        WHEN v_current_status = 'pending_payment' THEN 'This booking already has a payment link outstanding'
        WHEN v_current_status = 'cancelled'       THEN 'This booking was cancelled'
        WHEN v_current_status = 'no_show'         THEN 'This booking is marked as a no-show'
        ELSE 'Only confirmed bookings can be sent a payment link'
      END
    );
  END IF;

  -- The defining precondition. The row IS 'confirmed' at this point
  -- either way — only stripe_payment_id distinguishes "paid, all good,
  -- leave alone" from "the exact bug this RPC exists to remediate."
  -- Checked as its own branch (not folded into the status CASE above)
  -- because it needs a different, more specific message: sending a
  -- second payment link to someone who has already paid risks a
  -- duplicate charge, which is a materially worse mistake than any of
  -- the status-mismatch cases above.
  IF v_stripe_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'This booking has already been paid');
  END IF;

  -- Lock the event row.
  SELECT price, date_time, is_cancelled
  INTO   v_price, v_event_date, v_is_cancelled
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

  -- Nothing to remediate on a free event — a confirmed seat there is
  -- already correct and final. Mirrors admin_promote_waitlist_to_hold's
  -- own "free events aren't held" guard.
  IF v_price = 0 THEN
    RETURN jsonb_build_object('error', 'This is a free event — nothing to remediate');
  END IF;

  -- Defensive: chk_bookings_free_no_booking_fee
  -- (price_at_booking > 0 OR booking_fee_pence = 0) would reject setting
  -- a nonzero booking_fee_pence on a row whose price_at_booking is <= 0.
  -- That combination should be impossible for a genuinely paid event,
  -- but if some historical data anomaly produced it (e.g. the booking
  -- was created back when the event was priced differently, or a prior
  -- manual data fix went wrong), fail with a clear, specific message
  -- instead of a raw, confusing 23514 constraint-violation error.
  IF v_price_at_booking <= 0 THEN
    RETURN jsonb_build_object(
      'error',
      'This booking has no ticket price on record — cannot collect payment. Needs manual investigation before retrying.'
    );
  END IF;

  -- Deliberately NO capacity check — see
  -- SYSTEM-DESIGN-admin-waitlist-promotion-payment.md Addendum §A.1.
  -- This booking already occupies its seat as 'confirmed' today;
  -- requiring payment for a seat already held is not a new admission.
  -- Gating this on capacity would perversely block remediation on
  -- exactly the at-capacity events most likely to need it (the ones
  -- with a waitlist in the first place).

  -- Transition. waitlist_position is untouched — a 'confirmed' booking
  -- never carries one (the state machine never sets it for this
  -- status), so there is nothing to preserve or null out.
  UPDATE public.bookings
  SET    status                 = 'pending_payment',
         booking_fee_pence      = p_booking_fee_pence,
         is_admin_hold          = true,
         admin_hold_expires_at  = p_hold_expires_at
  WHERE  id                 = p_booking_id
    AND  status             = 'confirmed'
    AND  stripe_payment_id IS NULL;

  RETURN jsonb_build_object(
    'booking_id', p_booking_id,
    'user_id',    v_user_id,
    'status',     'pending_payment'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION public.admin_hold_confirmed_booking_for_payment(uuid, integer, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_hold_confirmed_booking_for_payment(uuid, integer, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 2. admin_revert_hold_to_waitlist(uuid) — Gap B: manually release an
--    active payment hold back to the waitlist.
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
  v_new_position integer;
BEGIN
  -- Admin gate — identical pattern to the other two admin_* RPCs in this family.
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  -- Lock the booking row.
  SELECT event_id, status, is_admin_hold
  INTO   v_event_id, v_status, v_is_hold
  FROM   public.bookings
  WHERE  id = p_booking_id
    AND  deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Booking not found');
  END IF;

  -- Deliberately origin-agnostic — see Addendum §B.1. This RPC doesn't
  -- need to know or care whether the row became a hold via
  -- admin_promote_waitlist_to_hold or admin_hold_confirmed_booking_for_payment.
  -- Also the guard that makes the DB-first Stripe-expiry ordering safe
  -- (Addendum §B.2): if the webhook already confirmed this booking a
  -- moment ago, this branch fires and the caller learns the hold is
  -- already gone, instead of the UPDATE below silently matching zero
  -- rows and returning a falsely-successful response.
  IF NOT v_is_hold OR v_status != 'pending_payment' THEN
    RETURN jsonb_build_object(
      'error',
      'This booking is not an active payment hold — it may have already been paid, cancelled, or reverted.'
    );
  END IF;

  -- Always reverts to 'waitlisted' — never 'confirmed', even for a hold
  -- that originated from admin_hold_confirmed_booking_for_payment (Gap
  -- A). Reverting a remediated hold to an unpaid 'confirmed' would
  -- silently recreate the exact incident this whole feature exists to
  -- fix. 'waitlisted' is the only sane exit for ANY hold, regardless of
  -- origin. See Addendum §B.1.
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
  -- recompute_waitlist_positions is GRANTed to `authenticated` only
  -- (not service_role), but that grant governs external PostgREST
  -- invocation, not this in-body PERFORM from another SECURITY DEFINER
  -- function owned by the same role — identical reasoning already
  -- established for revert_expired_admin_holds' own call (base spec
  -- §6.1). No additional grant needed.
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
