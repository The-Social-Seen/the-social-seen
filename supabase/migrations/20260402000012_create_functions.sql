-- Migration: 012_create_functions
-- Creates the book_event() RPC function for race-condition-safe bookings.
-- Amendment 1.4: exact SQL from SYSTEM-DESIGN.md Section 1.
-- Uses SELECT ... FOR UPDATE row locking. SECURITY DEFINER.
-- CREATE OR REPLACE makes this idempotent.

CREATE OR REPLACE FUNCTION public.book_event(
  p_user_id  uuid,
  p_event_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_capacity      integer;
  v_confirmed_count integer;
  v_price         integer;
  v_event_date    timestamptz;
  v_is_cancelled  boolean;
  v_existing_booking uuid;
  v_status        booking_status;
  v_waitlist_pos  integer;
  v_booking_id    uuid;
BEGIN
  -- Guard: caller must be the user they're booking for
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
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

-- Revoke execute from public; only authenticated users should call this RPC
REVOKE EXECUTE ON FUNCTION public.book_event(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.book_event(uuid, uuid) TO authenticated;
