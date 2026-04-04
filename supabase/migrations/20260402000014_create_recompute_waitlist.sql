-- Migration: 014_create_recompute_waitlist
-- Replaces N+1 sequential waitlist position updates with a single atomic
-- bulk recompute. Called by the leaveWaitlist Server Action after a
-- waitlisted booking is cancelled.
-- Uses a CTE with row_number() to reassign positions sequentially.

CREATE OR REPLACE FUNCTION public.recompute_waitlist_positions(
  p_event_id uuid
)
RETURNS void AS $$
BEGIN
  UPDATE public.bookings AS b
  SET waitlist_position = sub.new_pos
  FROM (
    SELECT id,
           row_number() OVER (
             ORDER BY waitlist_position ASC NULLS LAST, booked_at ASC
           ) AS new_pos
    FROM   public.bookings
    WHERE  event_id = p_event_id
      AND  status   = 'waitlisted'
      AND  deleted_at IS NULL
  ) AS sub
  WHERE b.id = sub.id
    AND b.waitlist_position IS DISTINCT FROM sub.new_pos;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- Only authenticated users should call this (via Server Actions)
REVOKE EXECUTE ON FUNCTION public.recompute_waitlist_positions(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.recompute_waitlist_positions(uuid) TO authenticated;
