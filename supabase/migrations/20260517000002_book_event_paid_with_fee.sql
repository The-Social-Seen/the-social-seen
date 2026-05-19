-- Migration: book_event_paid_with_fee (refund-fee-deduction P2)
--
-- Replaces book_event_paid(uuid, uuid) AND claim_waitlist_spot(uuid, uuid)
-- with 3-arg versions that accept the booking-fee snapshot. The TS helper
-- calculateBookingFeePence() in src/lib/utils/booking-fee.ts is the
-- single source of truth; these RPCs persist whatever the caller passes
-- (after a sanity guard).
--
-- Why DROP + recreate (not overload, not CREATE OR REPLACE with new arg):
--
--   1. PostgreSQL allows overloading by arg count, but the PostgREST RPC
--      layer would then have two functions named book_event_paid that
--      differ only by arg count — supabase.rpc('book_event_paid', { ... })
--      disambiguates by the supplied arg names, which is brittle when a
--      typo could land on the wrong overload.
--
--   2. More importantly: if the old 2-arg version stayed callable, a
--      stale caller (forgotten codepath, half-deployed Edge Function,
--      etc.) could create a paid booking with booking_fee_pence defaulted
--      to 0 — silent revenue leak. Dropping the old signature forces
--      every caller to be updated in the same release.
--
-- The Server Actions src/app/events/[slug]/actions.ts createPaidCheckout
-- and claimWaitlistSpot are updated in the same commit to pass the new
-- p_booking_fee_pence arg.
--
-- ── SECURITY DEFINER search_path posture ─────────────────────────────────
-- Both functions retain `SET search_path = public` (same as the previous
-- 2-arg versions). The stricter `public, pg_catalog` posture introduced
-- for reap_stale_bookings is a separate hardening PR — keeping these
-- consistent with the book_event / book_event_paid / claim_waitlist_spot
-- precedents avoids mixing hardening with feature work. See
-- project_security_definer_search_path_hardening memory note.
--
-- ── Idempotency ──────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS — safe to re-run.
-- CREATE OR REPLACE FUNCTION on the new 3-arg signature — safe to re-run.
-- REVOKE / GRANT are idempotent at the catalog level.
--
-- ── Post-merge ───────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked

-- ────────────────────────────────────────────────────────────────────────
-- book_event_paid(uuid, uuid, integer)
-- ────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.book_event_paid(uuid, uuid);

CREATE OR REPLACE FUNCTION public.book_event_paid(
  p_user_id           uuid,
  p_event_id          uuid,
  p_booking_fee_pence integer
)
RETURNS jsonb AS $$
DECLARE
  v_email_verified   boolean;
  v_capacity         integer;
  v_confirmed_count  integer;
  v_price            integer;
  v_event_date       timestamptz;
  v_is_cancelled     boolean;
  v_existing_booking uuid;
  v_status           booking_status;
  v_waitlist_pos     integer;
  v_booking_id       uuid;
BEGIN
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
  END IF;

  -- Guard: caller must pass a sane fee. The CHECK constraint on the
  -- column blocks negatives at write time, but rejecting at the function
  -- boundary surfaces a clean error to the Server Action rather than a
  -- raw 23514 constraint violation.
  IF p_booking_fee_pence < 0 THEN
    RETURN jsonb_build_object('error', 'Invalid booking fee');
  END IF;

  SELECT email_verified INTO v_email_verified
  FROM   public.profiles
  WHERE  id = p_user_id;

  IF NOT COALESCE(v_email_verified, false) THEN
    RETURN jsonb_build_object('error', 'Verify your email before booking');
  END IF;

  -- Lock the event row — prevents two users simultaneously claiming the
  -- same last paid seat and both ending up with pending_payment rows.
  SELECT capacity, price, date_time, is_cancelled
  INTO   v_capacity, v_price, v_event_date, v_is_cancelled
  FROM   public.events
  WHERE  id = p_event_id AND deleted_at IS NULL
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

  -- Sanity: this function is only for paid events. Free events must
  -- continue using book_event() which inserts as 'confirmed' with no fee.
  IF v_price = 0 THEN
    RETURN jsonb_build_object('error', 'Use book_event for free events');
  END IF;

  -- Prevent duplicate active bookings — including pending_payment rows,
  -- so a user can't start checkout twice for the same event.
  SELECT id INTO v_existing_booking
  FROM   public.bookings
  WHERE  user_id  = p_user_id
    AND  event_id = p_event_id
    AND  status  != 'cancelled'
    AND  deleted_at IS NULL;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'Already booked for this event');
  END IF;

  -- Count seat-holding bookings: both 'confirmed' AND 'pending_payment'
  -- count as occupied. Prevents overselling while Stripe Checkout
  -- sessions are in flight.
  SELECT COUNT(*)
  INTO   v_confirmed_count
  FROM   public.bookings
  WHERE  event_id = p_event_id
    AND  status   IN ('confirmed', 'pending_payment')
    AND  deleted_at IS NULL;

  IF v_capacity IS NULL OR v_confirmed_count < v_capacity THEN
    v_status       := 'pending_payment';
    v_waitlist_pos := NULL;
  ELSE
    -- Paid event is full → waitlist (no Stripe interaction for this
    -- booking yet). Snapshot the fee at creation regardless — when the
    -- user later claims the spot, the value persisted here is what
    -- they paid. (Same fee number is recomputed on claim by the
    -- Server Action, but storing it now means the audit trail is
    -- consistent across the waitlisted → pending_payment transition.)
    v_status := 'waitlisted';
    SELECT COALESCE(MAX(waitlist_position), 0) + 1
    INTO   v_waitlist_pos
    FROM   public.bookings
    WHERE  event_id = p_event_id
      AND  status   = 'waitlisted'
      AND  deleted_at IS NULL;
  END IF;

  INSERT INTO public.bookings (
    user_id, event_id, status, waitlist_position,
    price_at_booking, booking_fee_pence
  )
  VALUES (
    p_user_id, p_event_id, v_status, v_waitlist_pos,
    v_price, p_booking_fee_pence
  )
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'booking_id',        v_booking_id,
    'status',            v_status,
    'waitlist_position', v_waitlist_pos
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.book_event_paid(uuid, uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.book_event_paid(uuid, uuid, integer) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- claim_waitlist_spot(uuid, uuid, integer)
-- ────────────────────────────────────────────────────────────────────────
--
-- Drop + recreate with a fee-arg. The function transitions a waitlisted
-- booking to pending_payment (paid event) or confirmed (free event); the
-- caller computes the current booking fee from event.price and passes it
-- in. The waitlisted row already carries a booking_fee_pence value from
-- the initial book_event_paid call, but the rate could have changed
-- (Stripe rate update, hypothetical experiment) between waitlist creation
-- and claim — so the RPC OVERWRITES the snapshot when transitioning to
-- pending_payment to keep the value consistent with the actual checkout
-- charge.
--
-- For free events, the fee is always 0 and the column is unchanged on
-- transition (the caller will pass 0; the constraint
-- chk_bookings_free_no_booking_fee enforces this).

DROP FUNCTION IF EXISTS public.claim_waitlist_spot(uuid, uuid);

CREATE OR REPLACE FUNCTION public.claim_waitlist_spot(
  p_user_id           uuid,
  p_event_id          uuid,
  p_booking_fee_pence integer
)
RETURNS jsonb AS $$
DECLARE
  v_email_verified  boolean;
  v_capacity        integer;
  v_price           integer;
  v_event_date      timestamptz;
  v_is_cancelled    boolean;
  v_seat_count      integer;
  v_booking_id      uuid;
  v_current_status  booking_status;
BEGIN
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
  END IF;

  -- Guard: defensive negative-fee rejection (column CHECK also catches it).
  IF p_booking_fee_pence < 0 THEN
    RETURN jsonb_build_object('error', 'Invalid booking fee');
  END IF;

  SELECT email_verified INTO v_email_verified
  FROM   public.profiles
  WHERE  id = p_user_id;

  IF NOT COALESCE(v_email_verified, false) THEN
    RETURN jsonb_build_object('error', 'Verify your email before booking');
  END IF;

  -- Lock the event row — serialises concurrent claims.
  SELECT capacity, price, date_time, is_cancelled
  INTO   v_capacity, v_price, v_event_date, v_is_cancelled
  FROM   public.events
  WHERE  id = p_event_id AND deleted_at IS NULL
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

  -- Find the caller's waitlisted booking for this event.
  SELECT id, status
  INTO   v_booking_id, v_current_status
  FROM   public.bookings
  WHERE  user_id  = p_user_id
    AND  event_id = p_event_id
    AND  deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_booking_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No waitlist entry found');
  END IF;

  IF v_current_status != 'waitlisted' THEN
    RETURN jsonb_build_object(
      'error',
      CASE
        WHEN v_current_status IN ('confirmed', 'pending_payment') THEN 'You already have a spot for this event'
        WHEN v_current_status = 'cancelled' THEN 'Your waitlist entry was cancelled'
        ELSE 'Not eligible to claim'
      END
    );
  END IF;

  -- Free-event sanity: a free event with a non-zero fee is a misuse.
  -- (Cannot actually reach this branch — the v_price = 0 branch below
  -- forces fee to 0 — but explicit guard documents the invariant.)
  IF v_price = 0 AND p_booking_fee_pence != 0 THEN
    RETURN jsonb_build_object('error', 'Free events must have zero booking fee');
  END IF;

  -- Capacity check — seats are taken by confirmed OR pending_payment.
  IF v_capacity IS NOT NULL THEN
    SELECT COUNT(*)
    INTO   v_seat_count
    FROM   public.bookings
    WHERE  event_id = p_event_id
      AND  status   IN ('confirmed', 'pending_payment')
      AND  deleted_at IS NULL;

    IF v_seat_count >= v_capacity THEN
      RETURN jsonb_build_object(
        'error',
        'Someone else just claimed this spot. You''re still on the waitlist.'
      );
    END IF;
  END IF;

  -- Transition the booking. Free events go straight to confirmed; paid
  -- events move to pending_payment and the Server Action creates a
  -- Stripe Checkout Session. Paid branch OVERWRITES booking_fee_pence
  -- with the value the caller computed against the current event price
  -- (locks the audit row to what the user will actually be charged at
  -- checkout, even if the snapshot from the original waitlist creation
  -- is now stale).
  IF v_price = 0 THEN
    UPDATE public.bookings
    SET    status            = 'confirmed',
           waitlist_position = NULL
    WHERE  id     = v_booking_id
      AND  status = 'waitlisted';

    RETURN jsonb_build_object(
      'booking_id', v_booking_id,
      'status',     'confirmed'
    );
  ELSE
    UPDATE public.bookings
    SET    status            = 'pending_payment',
           booking_fee_pence = p_booking_fee_pence
    WHERE  id     = v_booking_id
      AND  status = 'waitlisted';

    RETURN jsonb_build_object(
      'booking_id', v_booking_id,
      'status',     'pending_payment'
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.claim_waitlist_spot(uuid, uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_waitlist_spot(uuid, uuid, integer) TO authenticated;
