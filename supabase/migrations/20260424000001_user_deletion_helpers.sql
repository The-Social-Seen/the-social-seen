-- Migration: user_deletion_helpers (P2-8b)
--
-- Supporting DB objects for the GDPR "Delete My Account" flow.
--
-- On account deletion we:
--   1. Soft-delete the profile row (set profiles.deleted_at = now()).
--      Existing RLS policies hide soft-deleted profiles from anon/user
--      queries; admins see them in a deletion queue.
--   2. Cancel any active bookings (they no longer hold a seat / trigger
--      emails). Refund-eligible paid bookings must be refunded via the
--      normal cancel flow BEFORE deletion — this is a user-side flow
--      that the "Delete My Account" action enforces.
--   3. Scrub PII from the `notifications` audit log: clear `body`
--      (contains rendered HTML with name + venue), `recipient_email`,
--      and leave `status` / `template_name` / `sent_at` for audit
--      metrics. Matches the P2-4 follow-up plan.
--
-- Hard delete of the profile row happens on a 30-day cadence — today
-- that's a manual admin action (the deletion queue view added in this
-- batch lists candidates), automated in Phase 3 via pg_cron.
--
-- This migration adds ONE helper: `sanitise_user_notifications(uuid)`
-- which idempotently scrubs PII from notifications rows related to a
-- given profile id. The Server Action calls this RPC via the admin
-- client after flipping `profiles.deleted_at`.

CREATE OR REPLACE FUNCTION public.sanitise_user_notifications(
  p_user_id uuid
)
RETURNS integer AS $$
DECLARE
  v_rows_affected integer := 0;
BEGIN
  -- 1. Rows where THIS user was the sender (system emails use
  --    sent_by = relatedProfileId; P2-4 audit pattern). Scrub body +
  --    recipient_email so the notifications table stops containing
  --    readable PII about the deleted user.
  UPDATE public.notifications
  SET    body            = '[redacted — account deleted]',
         recipient_email = NULL,
         subject         = '[redacted]'
  WHERE  sent_by = p_user_id
    AND  body != '[redacted — account deleted]';
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  -- 2. Rows where the deleted user was the recipient of an admin
  --    announcement (recipient_event_id matches an event they were
  --    booked for — out of scope for a simple scrub; the email itself
  --    doesn't carry their personal data in the rendered body beyond
  --    their first name, already present in `body`). We scrub by
  --    matching recipient_email directly against the profile's email
  --    at the time of deletion — but the profile email is already
  --    gone by this point (the Server Action clears it). So callers
  --    MUST pass the original email separately if they want to catch
  --    these rows; for now, the sent_by scrub is the main surface.
  --
  --    TODO(P3): if/when admin attendee-messaging lands (P2-9), add a
  --    second pass scrubbing by recipient_email.

  RETURN v_rows_affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.sanitise_user_notifications(uuid) FROM PUBLIC;
-- Admin client (service_role) invokes this from the Server Action.
-- Not granted to `authenticated` because users shouldn't be able to
-- scrub arbitrary notification rows.

COMMENT ON FUNCTION public.sanitise_user_notifications(uuid) IS
  'GDPR helper — scrubs PII from notifications rows related to a user_id. Called by the Server Action on account deletion. Returns count of rows updated.';
