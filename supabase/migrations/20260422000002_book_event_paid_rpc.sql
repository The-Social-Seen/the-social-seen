-- Migration: book_event_paid_rpc (P2-7a)
--
-- Companion to book_event() for paid-event bookings. Same race-safe row
-- locking + capacity + duplicate + email_verified semantics, but inserts
-- with status='pending_payment' when a seat is available (caller then
-- creates a Stripe Checkout Session with metadata.booking_id pointing at
-- this row). If the event is at capacity, status='waitlisted' — same as
-- free events — and no Stripe interaction happens for this booking until
-- the waitlist auto-promote lands in P2-7b.
--
-- Rationale for a separate RPC rather than a flag on book_event():
--   - Keeps the free-flow tested path (book_event) unchanged.
--   - Makes auditing clear: every 'pending_payment' row comes from this
--     function, which every paid-event Server Action must go through.
--   - The existing book_event() is still used by free events — no churn
--     to 800+ tests that exercise it.
--
-- SECURITY DEFINER so it runs with the function owner's privileges and
-- respects the auth.uid() guard. Grant is narrow: REVOKE from PUBLIC,
-- GRANT to authenticated.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.book_event_paid(
  p_user_id  uuid,
  p_event_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_email_verified   boolean;
  v_capacity         integer;
  v_confirmed_count  integer;
  v_pending_count    integer;
  v_price            integer;
  v_event_date       timestamptz;
  v_is_cancelled     boolean;
  v_existing_booking uuid;
  v_status           booking_status;
  v_waitlist_pos     integer;
  v_booking_id       uuid;
BEGIN
  -- Caller must be booking for themselves.
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
  END IF;

  -- Email verification gate (same as book_event).
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

  -- Sanity check: this function is only for paid events. Free events
  -- must continue using book_event() which inserts as 'confirmed'.
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
  -- count as occupied. This prevents overselling while Stripe Checkout
  -- sessions are in flight. Expired/abandoned pending_payment rows need
  -- reaping — a follow-up item.
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
    -- booking). Same as free-event waitlist behaviour.
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

REVOKE EXECUTE ON FUNCTION public.book_event_paid(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.book_event_paid(uuid, uuid) TO authenticated;

-- ── Update existing book_event() to reject paid events ─────────────────────
-- Defence in depth: the Server Action layer picks the right RPC based on
-- event.price, but if a developer ever calls book_event() for a paid
-- event directly it would confirm the booking without charging — a
-- revenue leak. Add an early guard.
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
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
  END IF;

  SELECT email_verified INTO v_email_verified
  FROM   public.profiles
  WHERE  id = p_user_id;

  IF NOT COALESCE(v_email_verified, false) THEN
    RETURN jsonb_build_object('error', 'Verify your email before booking');
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

  -- NEW (P2-7a): paid events must go through book_event_paid() so Stripe
  -- can charge. Guard against accidental free-confirmation of paid rows.
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
