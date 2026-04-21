-- Migration: book_event_require_verified_email
--
-- Gate booking behind email verification. Updates the book_event() RPC
-- from migration 20260402000012 to reject calls from users whose
-- profiles.email_verified is false.
--
-- Design context (Sprint 1 P2-3):
-- - Supabase Auth is set to mailer_autoconfirm: True so every new user
--   gets a usable session immediately after signup. Supabase's
--   email_confirmed_at column is therefore not a reliable signal for
--   "this user has verified they own their email".
-- - The app-level signal is profiles.email_verified (added by migration
--   20260420000001, defaults to false). The verifyEmailOtp() Server
--   Action flips it to true after a successful 6-digit OTP check.
-- - Clients can client-side-gate the booking UI against the same flag,
--   but that's bypassable by anyone poking the RPC directly. This server-
--   side gate is the authoritative enforcement point.
--
-- Full function replacement via CREATE OR REPLACE — all existing logic
-- is preserved (row lock, capacity check, waitlist, duplicate prevention,
-- atomic insert). Only the email_verified guard is new.
--
-- Idempotent: CREATE OR REPLACE FUNCTION is safe to re-run.

CREATE OR REPLACE FUNCTION public.book_event(
  p_user_id  uuid,
  p_event_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_email_verified  boolean;
  v_capacity        integer;
  v_confirmed_count integer;
  v_price           integer;
  v_event_date      timestamptz;
  v_is_cancelled    boolean;
  v_existing_booking uuid;
  v_status          booking_status;
  v_waitlist_pos    integer;
  v_booking_id      uuid;
BEGIN
  -- Guard: caller must be the user they're booking for
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
  END IF;

  -- Enforce email verification — users must verify their email before booking.
  -- COALESCE guards against the unlikely case of the profile row being missing.
  SELECT email_verified INTO v_email_verified
  FROM   public.profiles
  WHERE  id = p_user_id;

  IF NOT COALESCE(v_email_verified, false) THEN
    RETURN jsonb_build_object('error', 'Verify your email before booking');
  END IF;

  -- Lock the event row to prevent concurrent overbooking
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

  -- Check for existing active booking (prevents duplicates)
  SELECT id INTO v_existing_booking
  FROM   public.bookings
  WHERE  user_id  = p_user_id
    AND  event_id = p_event_id
    AND  status  != 'cancelled'
    AND  deleted_at IS NULL;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'Already booked for this event');
  END IF;

  -- Count confirmed bookings under the same lock
  SELECT COUNT(*)
  INTO   v_confirmed_count
  FROM   public.bookings
  WHERE  event_id = p_event_id
    AND  status   = 'confirmed'
    AND  deleted_at IS NULL;

  -- Determine booking status: confirmed or waitlisted
  IF v_capacity IS NULL OR v_confirmed_count < v_capacity THEN
    v_status       := 'confirmed';
    v_waitlist_pos := NULL;
  ELSE
    v_status := 'waitlisted';
    SELECT COALESCE(MAX(waitlist_position), 0) + 1
    INTO   v_waitlist_pos
    FROM   public.bookings
    WHERE  event_id = p_event_id
      AND  status   = 'waitlisted'
      AND  deleted_at IS NULL;
  END IF;

  -- Atomic insert
  INSERT INTO public.bookings (user_id, event_id, status, waitlist_position, price_at_booking)
  VALUES (p_user_id, p_event_id, v_status, v_waitlist_pos, v_price)
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'booking_id',       v_booking_id,
    'status',           v_status,
    'waitlist_position', v_waitlist_pos
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- EXECUTE grants are unchanged from migration 20260402000012 — still
-- REVOKEd from PUBLIC, GRANTed to authenticated. CREATE OR REPLACE
-- preserves existing grants.
