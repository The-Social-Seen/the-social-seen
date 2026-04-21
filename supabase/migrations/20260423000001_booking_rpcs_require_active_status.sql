-- Migration: booking_rpcs_require_active_status (P2-8a)
--
-- Extends book_event() and book_event_paid() to reject callers whose
-- profiles.status is not 'active'. The user_status enum was added in
-- migration 20260420000001 (P2-2) with values:
--
--     'active'     — default; booking allowed
--     'suspended'  — can log in, can browse, CANNOT book
--     'banned'     — signed out on every request (middleware) + cannot book
--
-- For defence in depth, the middleware ban-enforcement (P2-8a frontend)
-- is not the only gate: even if a banned user's cookie somehow reaches a
-- Server Action, the RPC refuses. Same for suspended users.
--
-- Free-event booking: `book_event()`.
-- Paid-event booking: `book_event_paid()` AND `claim_waitlist_spot()`
-- (the waitlist-claim path promotes an existing waitlisted row and
-- must also enforce the gate so a user suspended between waitlist-join
-- and spot-open can't claim).
--
-- Idempotent: CREATE OR REPLACE. Preserves the existing GRANT/REVOKE
-- from migration 20260402000012 and 20260422000002.

-- ── book_event() — free events ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.book_event(
  p_user_id  uuid,
  p_event_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_email_verified  boolean;
  v_user_status     user_status;
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
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
  END IF;

  -- Fetch verification + status in one round-trip.
  SELECT email_verified, status
  INTO   v_email_verified, v_user_status
  FROM   public.profiles
  WHERE  id = p_user_id;

  IF NOT COALESCE(v_email_verified, false) THEN
    RETURN jsonb_build_object('error', 'Verify your email before booking');
  END IF;

  -- P2-8a: reject non-active accounts with a copy-tuned message. Banned
  -- users shouldn't normally reach this path (middleware signs them out),
  -- but if they do we refuse. Suspended users are more common — they've
  -- been quietly locked by an admin but can still browse.
  IF v_user_status != 'active' THEN
    RETURN jsonb_build_object(
      'error',
      CASE v_user_status
        WHEN 'suspended' THEN 'Your account is currently suspended. Please contact info@the-social-seen.com.'
        WHEN 'banned'    THEN 'Your account has been closed.'
        ELSE                 'Your account cannot book events.'
      END
    );
  END IF;

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

  IF v_price > 0 THEN
    RETURN jsonb_build_object('error', 'Use book_event_paid for paid events');
  END IF;

  SELECT id INTO v_existing_booking
  FROM   public.bookings
  WHERE  user_id  = p_user_id
    AND  event_id = p_event_id
    AND  status  != 'cancelled'
    AND  deleted_at IS NULL;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'Already booked for this event');
  END IF;

  SELECT COUNT(*)
  INTO   v_confirmed_count
  FROM   public.bookings
  WHERE  event_id = p_event_id
    AND  status   = 'confirmed'
    AND  deleted_at IS NULL;

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

  INSERT INTO public.bookings (user_id, event_id, status, waitlist_position, price_at_booking)
  VALUES (p_user_id, p_event_id, v_status, v_waitlist_pos, v_price)
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'booking_id',        v_booking_id,
    'status',            v_status,
    'waitlist_position', v_waitlist_pos
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;


-- ── book_event_paid() — paid events ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.book_event_paid(
  p_user_id  uuid,
  p_event_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_email_verified   boolean;
  v_user_status      user_status;
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

  SELECT email_verified, status
  INTO   v_email_verified, v_user_status
  FROM   public.profiles
  WHERE  id = p_user_id;

  IF NOT COALESCE(v_email_verified, false) THEN
    RETURN jsonb_build_object('error', 'Verify your email before booking');
  END IF;

  IF v_user_status != 'active' THEN
    RETURN jsonb_build_object(
      'error',
      CASE v_user_status
        WHEN 'suspended' THEN 'Your account is currently suspended. Please contact info@the-social-seen.com.'
        WHEN 'banned'    THEN 'Your account has been closed.'
        ELSE                 'Your account cannot book events.'
      END
    );
  END IF;

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

  IF v_price = 0 THEN
    RETURN jsonb_build_object('error', 'Use book_event for free events');
  END IF;

  SELECT id INTO v_existing_booking
  FROM   public.bookings
  WHERE  user_id  = p_user_id
    AND  event_id = p_event_id
    AND  status  != 'cancelled'
    AND  deleted_at IS NULL;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'Already booked for this event');
  END IF;

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
    v_status := 'waitlisted';
    SELECT COALESCE(MAX(waitlist_position), 0) + 1
    INTO   v_waitlist_pos
    FROM   public.bookings
    WHERE  event_id = p_event_id
      AND  status   = 'waitlisted'
      AND  deleted_at IS NULL;
  END IF;

  INSERT INTO public.bookings (user_id, event_id, status, waitlist_position, price_at_booking)
  VALUES (p_user_id, p_event_id, v_status, v_waitlist_pos, v_price)
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'booking_id',        v_booking_id,
    'status',            v_status,
    'waitlist_position', v_waitlist_pos
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;


-- ── claim_waitlist_spot() — waitlist promotion ────────────────────────────
-- Same status gate. If a user is suspended AFTER joining the waitlist but
-- BEFORE a spot opens, they can't claim. Their waitlisted row stays so
-- re-activation restores normal queue eligibility.
CREATE OR REPLACE FUNCTION public.claim_waitlist_spot(
  p_user_id  uuid,
  p_event_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_email_verified  boolean;
  v_user_status     user_status;
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

  SELECT email_verified, status
  INTO   v_email_verified, v_user_status
  FROM   public.profiles
  WHERE  id = p_user_id;

  IF NOT COALESCE(v_email_verified, false) THEN
    RETURN jsonb_build_object('error', 'Verify your email before booking');
  END IF;

  IF v_user_status != 'active' THEN
    RETURN jsonb_build_object(
      'error',
      CASE v_user_status
        WHEN 'suspended' THEN 'Your account is currently suspended. Please contact info@the-social-seen.com.'
        WHEN 'banned'    THEN 'Your account has been closed.'
        ELSE                 'Your account cannot claim this spot.'
      END
    );
  END IF;

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
    SET    status = 'pending_payment'
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
