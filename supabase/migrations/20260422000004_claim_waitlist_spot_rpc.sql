-- Migration: claim_waitlist_spot_rpc (P2-7b)
--
-- Atomic "first-click wins" waitlist claim. The server action layer
-- calls this after a waitlisted user clicks the "spot available" email
-- and the `Claim` CTA on the event page. Under a row lock the RPC:
--
--   1. Finds the caller's current `waitlisted` booking for this event.
--      If absent (they never waitlisted, or already cancelled/promoted),
--      returns an error.
--   2. Checks there's still capacity — any seat claimed in the time
--      between the email going out and now-click?
--         confirmed_count + pending_payment_count < capacity
--      Matches the book_event_paid() capacity model from P2-7a.
--   3. If a seat is free: flips the existing booking row from
--      `waitlisted` → `pending_payment`, clears waitlist_position, and
--      returns the booking_id. The Server Action then creates a fresh
--      Stripe Checkout Session targeting this row (same as a new paid
--      booking).
--   4. If no seat is free: returns a race-lost error so the UI can show
--      "Sorry — someone else just got it. You're still on the waitlist."
--
-- For **free events**: flips straight to `confirmed` (no Stripe step) and
-- returns status='confirmed' so the Server Action can revalidate +
-- return success.
--
-- Race-safety:
--   - `FOR UPDATE` on the event row serialises capacity checks across
--     concurrent claims (two waitlisters clicking at the same instant).
--   - The booking-row transition is `.eq('status', 'waitlisted')` in
--     spirit (we re-read status after the lock), guarding against a
--     stale second claim.
--
-- Email-verified guard preserved for parity with book_event / book_event_paid.

CREATE OR REPLACE FUNCTION public.claim_waitlist_spot(
  p_user_id  uuid,
  p_event_id uuid
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
  -- Auth guard.
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
  END IF;

  -- Email verification gate (parity with book_event + book_event_paid).
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

  -- Find the caller's waitlisted booking for this event. Must exist and
  -- be in waitlisted status — we can't promote someone who was never on
  -- the waitlist, or whose waitlist row was already cancelled.
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

  -- Capacity check — seats are taken by confirmed OR pending_payment
  -- (someone else mid-Checkout). NULL capacity = unlimited (shouldn't
  -- occur for a waitlist claim but handled defensively).
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
  -- Stripe Checkout Session from there.
  --
  -- Free confirmed case nulls waitlist_position (seat is theirs, queue
  -- position is no longer meaningful).
  --
  -- Paid pending_payment case preserves waitlist_position so that if
  -- Stripe creation fails and the Server Action restores the row to
  -- `waitlisted`, the user's queue position is intact. The UI only
  -- reads waitlist_position when status = 'waitlisted', so having a
  -- non-null value on a pending_payment row is semantically harmless.
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

REVOKE EXECUTE ON FUNCTION public.claim_waitlist_spot(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_waitlist_spot(uuid, uuid) TO authenticated;
